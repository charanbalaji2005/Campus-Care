package edu.srmap.campuscare.data

import edu.srmap.campuscare.util.RawFix
import edu.srmap.campuscare.util.ageSeconds
import kotlinx.serialization.Serializable

@Serializable
data class SosLocationResult(val accepted: Boolean = false, val duplicate: Boolean = false, val outOfOrder: Boolean = false, val quality: String? = null)

/** Live location uploads for an active SOS or share. Raw measured fixes only — never map-matched. */
class LiveLocationApi(private val c: ApiClient) {
    /** Body for one fix; the age is computed at send time so queued points keep their real capture time. */
    fun body(fix: RawFix, seq: Long?, clientQuality: String?): Map<String, Any?> = mapOf(
        "latitude" to fix.latitude,
        "longitude" to fix.longitude,
        "accuracyMeters" to fix.accuracyMeters,
        "locationAgeSeconds" to fix.ageSeconds().coerceAtMost(3600.0),
        "clientSeq" to seq,
        "speedMps" to fix.speedMps?.takeIf { it in 0.0..150.0 },
        "headingDeg" to fix.bearingDeg?.takeIf { it in 0.0..360.0 },
        "altitudeMeters" to fix.altitudeMeters?.takeIf { it in -1000.0..10000.0 },
        "source" to when (fix.provider) { "gps" -> "gps"; "network" -> "network"; "fused" -> "fused"; else -> "unknown" },
        "clientQuality" to clientQuality,
    ).filterValues { it != null }

    suspend fun sos(alertId: String, fix: RawFix, seq: Long?, clientQuality: String?): SosLocationResult =
        c.post("/safety/sos/$alertId/location", body(fix, seq, clientQuality))

    suspend fun share(shareId: String, fix: RawFix, seq: Long?, clientQuality: String?): Ignored =
        c.patch("/safety/location-share/$shareId", body(fix, seq, clientQuality))

    suspend fun startShare(minutes: Int, audience: String, fix: RawFix): LocationShareInfo =
        c.post("/safety/location-share", mapOf("durationMinutes" to minutes, "audience" to audience) + body(fix, null, null))
}

val Api.liveLocation: LiveLocationApi get() = LiveLocationApi(client)
