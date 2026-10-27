package edu.srmap.campuscare.util

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.net.Uri
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import com.google.android.gms.location.LocationAvailability
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import edu.srmap.campuscare.BuildConfig
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/** What the operating system currently allows. Never bypassed: we only ask, explain, or point to Settings. */
enum class PermissionLevel { None, Approximate, Precise }

object LocationPermissions {
    fun level(context: Context): PermissionLevel = when {
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED -> PermissionLevel.Precise
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED -> PermissionLevel.Approximate
        else -> PermissionLevel.None
    }

    /** Location services (GPS / network location) switched on in system settings. */
    fun locationEnabled(context: Context): Boolean {
        val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return false
        return LocationManagerCompat.isLocationEnabled(lm)
    }

    fun openAppSettings(context: Context) {
        context.startActivity(
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }

    fun openLocationSettings(context: Context) {
        runCatching { context.startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            .onFailure { openAppSettings(context) }
    }
}

fun Location.toRawFix(): RawFix = RawFix(
    latitude = latitude,
    longitude = longitude,
    accuracyMeters = if (hasAccuracy()) accuracy.toDouble() else null,
    // Monotonic capture time: correct even if the phone's wall clock is wrong.
    timeMs = if (elapsedRealtimeNanos > 0) elapsedRealtimeNanos / 1_000_000 else SystemClock.elapsedRealtime(),
    speedMps = if (hasSpeed()) speed.toDouble() else null,
    bearingDeg = if (hasBearing()) bearing.toDouble() else null,
    altitudeMeters = if (hasAltitude()) altitude else null,
    provider = provider,
)

fun RawFix.ageSeconds(now: Long = SystemClock.elapsedRealtime()): Double = ((now - timeMs).coerceAtLeast(0L)) / 1000.0

/**
 * State of the background safety tracker (SOS and live shares), observed by the UI. The raw measured
 * fix is what responders receive; the filtered estimate only smooths what is drawn on screen.
 */
data class TrackingState(
    val sosId: String? = null,
    val shareId: String? = null,
    val shareAudience: String? = null,
    val shareExpiresAt: String? = null,
    val permission: PermissionLevel = PermissionLevel.None,
    val locationEnabled: Boolean = true,
    /** The fused provider reports that no location can be determined right now (e.g. indoors, GPS off). */
    val signalAvailable: Boolean = true,
    val raw: RawFix? = null,
    val estimate: LocationEstimate? = null,
    /** Time-ordered accepted raw fixes for the route trail (bounded). */
    val trail: List<RawFix> = emptyList(),
    val rejectedFixes: Int = 0,
    val lastUploadOkAtMs: Long? = null,
    val pendingUploads: Int = 0,
    val lastUploadError: String? = null,
) {
    val active: Boolean get() = sosId != null || shareId != null

    fun quality(staleSeconds: Double, now: Long = SystemClock.elapsedRealtime()): LocationQuality =
        raw?.let { LocationQualityRules.classify(it.accuracyMeters, it.ageSeconds(now), staleSeconds) } ?: LocationQuality.Unknown
}

object LocationTracking {
    private val _state = MutableStateFlow(TrackingState())
    val state: StateFlow<TrackingState> = _state.asStateFlow()

    internal fun update(f: (TrackingState) -> TrackingState) = _state.update(f)
}

/** A fix for the screen that is open: raw measurement, smoothed estimate, and whether acquisition is running. */
data class LiveFix(val raw: RawFix, val estimate: LocationEstimate)

/**
 * Foreground-only location for the screen that is visible (e.g. SOS before sending): high accuracy
 * while shown, stopped the moment the screen leaves. Each new valid fix replaces older ones.
 */
@SuppressLint("MissingPermission")
@Composable
fun rememberLiveFix(enabled: Boolean, intervalMs: Long = 3_000, priority: Int = Priority.PRIORITY_HIGH_ACCURACY): State<LiveFix?> {
    val context = LocalContext.current
    val state = remember { mutableStateOf<LiveFix?>(null) }
    DisposableEffect(enabled) {
        if (!enabled || LocationPermissions.level(context) == PermissionLevel.None) return@DisposableEffect onDispose { }
        val filter = LocationFilter()
        val client = LocationServices.getFusedLocationProviderClient(context)
        val callback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                result.locations.sortedBy { it.elapsedRealtimeNanos }.forEach { loc ->
                    val raw = loc.toRawFix()
                    val d = filter.offer(raw)
                    if (BuildConfig.DEBUG) {
                        // Debug builds only: precise coordinates must never reach release logs or analytics.
                        Log.d("CampusCareLocation", "fix ${raw.provider} %.6f,%.6f ±%s m age %.1fs -> %s".format(
                            raw.latitude, raw.longitude, raw.accuracyMeters?.toInt() ?: "?", raw.ageSeconds(),
                            if (d is FilterDecision.Rejected) "rejected: ${d.reason}" else "accepted",
                        ))
                    }
                    if (d is FilterDecision.Accepted) state.value = LiveFix(raw, d.estimate)
                }
            }

            override fun onLocationAvailability(availability: LocationAvailability) = Unit
        }
        val request = LocationRequest.Builder(priority, intervalMs).setMinUpdateIntervalMillis(intervalMs / 2).setWaitForAccurateLocation(false).build()
        runCatching { client.requestLocationUpdates(request, callback, Looper.getMainLooper()) }
        onDispose { client.removeLocationUpdates(callback) }
    }
    return state
}
