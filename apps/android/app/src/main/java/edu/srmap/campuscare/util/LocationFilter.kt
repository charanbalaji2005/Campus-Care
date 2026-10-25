package edu.srmap.campuscare.util

import kotlin.math.PI
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * One measured location fix, as reported by the device. [timeMs] is on the monotonic clock
 * (elapsedRealtime), so ordering and ages are right even if the phone's wall clock is wrong.
 * Plain Kotlin (no Android types) so the filter can be unit-tested on the JVM.
 */
data class RawFix(
    val latitude: Double,
    val longitude: Double,
    /** Reported horizontal accuracy radius in metres (null = unknown). */
    val accuracyMeters: Double?,
    val timeMs: Long,
    val speedMps: Double? = null,
    val bearingDeg: Double? = null,
    val altitudeMeters: Double? = null,
    val provider: String? = null,
)

/** Quality of a fix for campus-level use. Same thresholds as the server (packages/shared/src/location.ts). */
enum class LocationQuality(val label: String) {
    High("High confidence"),
    Usable("Approximate"),
    Low("Low confidence"),
    Poor("Poor signal"),
    Stale("Stale"),
    Unknown("Accuracy unknown"),
}

/**
 * Configurable heuristics, not guarantees of device performance: up to 15 m high, 40 m usable,
 * 100 m low confidence, beyond that poor for precise dispatch.
 */
data class QualityThresholds(val highMaxMeters: Double = 15.0, val usableMaxMeters: Double = 40.0, val lowMaxMeters: Double = 100.0)

object LocationQualityRules {
    /** Stale after this many seconds, per use. */
    const val SOS_STALE_SECONDS = 60.0
    const val SHARE_STALE_SECONDS = 120.0

    fun classify(accuracyMeters: Double?, ageSeconds: Double?, staleSeconds: Double, t: QualityThresholds = QualityThresholds()): LocationQuality {
        if (ageSeconds != null && ageSeconds > staleSeconds) return LocationQuality.Stale
        val acc = accuracyMeters ?: return LocationQuality.Unknown
        if (!acc.isFinite() || acc <= 0.0) return LocationQuality.Unknown
        return when {
            acc <= t.highMaxMeters -> LocationQuality.High
            acc <= t.usableMaxMeters -> LocationQuality.Usable
            acc <= t.lowMaxMeters -> LocationQuality.Low
            else -> LocationQuality.Poor
        }
    }

    /** Decimal places a coordinate deserves at this uncertainty (1e-5° ≈ 1.1 m); between 3 and 6. */
    fun coordinateDecimals(accuracyMeters: Double?): Int {
        val acc = accuracyMeters ?: return 4
        if (!acc.isFinite() || acc <= 0.0) return 4
        val d = kotlin.math.ceil(kotlin.math.log10(111_320.0 / acc)).toInt()
        return d.coerceIn(3, 6)
    }

    fun formatCoordinates(latitude: Double, longitude: Double, accuracyMeters: Double?): String {
        val d = coordinateDecimals(accuracyMeters)
        return "%.${d}f, %.${d}f".format(java.util.Locale.ROOT, latitude, longitude)
    }
}

/** The smoothed position used for display. Raw measurements are kept separately and are what we send. */
data class LocationEstimate(val latitude: Double, val longitude: Double, val accuracyMeters: Double, val timeMs: Long)

sealed interface FilterDecision {
    data class Accepted(val estimate: LocationEstimate, val reset: Boolean = false) : FilterDecision
    data class Rejected(val reason: String) : FilterDecision
}

/**
 * Accuracy-aware Kalman filter on position (one variance shared by both axes, in metres²).
 *
 * - Each measurement is weighted by its reported uncertainty: a ±5 m fix pulls hard, a ±80 m one barely.
 * - Process noise grows with elapsed time and with the speed the device reports, so genuine movement
 *   is followed rather than averaged away.
 * - A fix is rejected as an outlier only when it is inconsistent with BOTH the combined uncertainty
 *   AND plausible movement (implied speed above [maxPlausibleSpeedMps]). Distance alone never rejects.
 * - If [maxConsecutiveRejects] fixes in a row disagree with the estimate, the device really moved
 *   (or the estimate was wrong): the filter resets to the new measurement instead of locking out.
 * - The reported accuracy of the estimate never claims better than the best recent raw measurement.
 */
class LocationFilter(
    private val processNoiseMps: Double = 2.0,
    private val maxPlausibleSpeedMps: Double = 45.0,
    private val gateSigmas: Double = 3.0,
    private val maxConsecutiveRejects: Int = 3,
    private val defaultAccuracyMeters: Double = 100.0,
    private val historySize: Int = 10,
) {
    private var lat = 0.0
    private var lon = 0.0
    private var variance = -1.0 // < 0: not initialised
    private var lastTimeMs = 0L
    private var consecutiveRejects = 0
    private val recent = ArrayDeque<RawFix>()

    /** Last valid raw measurement (diagnostics; also what is uploaded). */
    var lastRaw: RawFix? = null
        private set

    val history: List<RawFix> get() = recent.toList()

    fun reset() {
        variance = -1.0
        consecutiveRejects = 0
        recent.clear()
        lastRaw = null
    }

    fun offer(f: RawFix): FilterDecision {
        if (!isValid(f)) return FilterDecision.Rejected("invalid")
        if (variance >= 0 && f.timeMs <= lastTimeMs) return FilterDecision.Rejected("out_of_order")
        val acc = (f.accuracyMeters?.takeIf { it.isFinite() && it > 0 } ?: defaultAccuracyMeters).coerceAtLeast(1.0)
        if (variance < 0) return init(f, acc, reset = false)

        val dt = (f.timeMs - lastTimeMs) / 1000.0
        val q = max(processNoiseMps, f.speedMps?.takeIf { it.isFinite() && it >= 0 } ?: 0.0)
        val predicted = variance + dt * q * q
        val distance = distanceMeters(lat, lon, f.latitude, f.longitude)
        val inconsistent = distance > gateSigmas * sqrt(predicted + acc * acc)
        val implausible = distance / max(dt, 0.5) > maxPlausibleSpeedMps
        if (inconsistent && implausible) {
            consecutiveRejects++
            if (consecutiveRejects < maxConsecutiveRejects) return FilterDecision.Rejected("outlier")
            return init(f, acc, reset = true) // persistent disagreement: trust the measurements
        }
        consecutiveRejects = 0
        val k = predicted / (predicted + acc * acc)
        lat += k * (f.latitude - lat)
        lon += k * (f.longitude - lon)
        variance = (1 - k) * predicted
        lastTimeMs = f.timeMs
        remember(f)
        return FilterDecision.Accepted(estimate())
    }

    private fun init(f: RawFix, acc: Double, reset: Boolean): FilterDecision {
        if (reset) recent.clear()
        lat = f.latitude
        lon = f.longitude
        variance = acc * acc
        lastTimeMs = f.timeMs
        consecutiveRejects = 0
        remember(f)
        return FilterDecision.Accepted(estimate(), reset)
    }

    private fun remember(f: RawFix) {
        lastRaw = f
        recent.addLast(f)
        while (recent.size > historySize) recent.removeFirst()
    }

    private fun estimate(): LocationEstimate {
        // Never report better precision than the best measurement we actually have.
        val best = recent.mapNotNull { it.accuracyMeters?.takeIf { a -> a > 0 } }.minOrNull() ?: defaultAccuracyMeters
        return LocationEstimate(lat, lon, max(sqrt(variance), best), lastTimeMs)
    }

    companion object {
        fun isValid(f: RawFix): Boolean =
            f.latitude.isFinite() && f.longitude.isFinite() && f.latitude in -90.0..90.0 && f.longitude in -180.0..180.0 &&
                !(f.latitude == 0.0 && f.longitude == 0.0) && (f.accuracyMeters == null || (f.accuracyMeters.isFinite() && f.accuracyMeters >= 0))

        /** Great-circle distance in metres. */
        fun distanceMeters(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
            val r = 6_371_000.0
            val p1 = lat1 * PI / 180
            val p2 = lat2 * PI / 180
            val dp = (lat2 - lat1) * PI / 180
            val dl = (lon2 - lon1) * PI / 180
            val h = sin(dp / 2) * sin(dp / 2) + cos(p1) * cos(p2) * sin(dl / 2) * sin(dl / 2)
            return 2 * r * asin(min(1.0, sqrt(h)))
        }
    }
}
