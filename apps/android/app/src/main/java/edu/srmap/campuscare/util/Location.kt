package edu.srmap.campuscare.util

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.os.SystemClock
import androidx.core.content.ContextCompat
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull

/**
 * A device location fix. [elapsedRealtimeNanos] is when the fix was taken on the monotonic clock
 * (not wall time), so its age is correct even if the phone's clock is wrong. A null [elapsedRealtimeNanos]
 * means the age is unknown.
 */
data class Fix(val latitude: Double, val longitude: Double, val accuracy: Double?, val elapsedRealtimeNanos: Long? = null) {
    /** Age of the fix right now in seconds, or null when unknown. */
    val ageSeconds: Double?
        get() = elapsedRealtimeNanos?.let { ((SystemClock.elapsedRealtimeNanos() - it).coerceAtLeast(0L)) / 1_000_000_000.0 }

    /** Older than [STALE_SECONDS]: show it, but say it is stale. */
    val isStale: Boolean get() = (ageSeconds ?: 0.0) > STALE_SECONDS

    companion object {
        const val STALE_SECONDS = 120.0
    }
}

/** "±12 m" (or "accuracy unknown"). */
fun accuracyLabel(meters: Double?): String = meters?.let { "±${it.toInt().coerceAtLeast(1)} m" } ?: "accuracy unknown"

/** "just now", "45 s old", "3 min old". */
fun ageLabel(seconds: Double?): String = when {
    seconds == null -> "age unknown"
    seconds < 10 -> "just now"
    seconds < 90 -> "${seconds.toInt()} s old"
    seconds < 3600 -> "${(seconds / 60).toInt()} min old"
    else -> "${(seconds / 3600).toInt()} h old"
}

object LocationHelper {
    fun hasPermission(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    fun toFix(loc: Location): Fix = Fix(
        loc.latitude, loc.longitude,
        if (loc.hasAccuracy()) loc.accuracy.toDouble() else null,
        loc.elapsedRealtimeNanos.takeIf { it > 0L },
    )

    /**
     * Best-effort current location within [timeoutMs]. Returns null (never throws) when permission is
     * missing, location is off or no fix arrives in time — callers then say "location unavailable".
     * A cached last-known fix may be returned; its [Fix.ageSeconds] says how old it is.
     */
    @SuppressLint("MissingPermission")
    suspend fun current(context: Context, timeoutMs: Long = 6_000): Fix? {
        if (!hasPermission(context)) return null
        val client = LocationServices.getFusedLocationProviderClient(context)
        val cts = CancellationTokenSource()
        val fresh = withTimeoutOrNull(timeoutMs) {
            runCatching { client.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, cts.token).await() }.getOrNull()
        }
        cts.cancel()
        val loc = fresh ?: runCatching { client.lastLocation.await() }.getOrNull() ?: return null
        return toFix(loc)
    }

    /**
     * Battery-friendly location for periodic use (duty heartbeats, keep-alives): balanced power,
     * accepts a cached fix up to [maxAgeMs] old, falls back to the last known fix. Never throws.
     */
    @SuppressLint("MissingPermission")
    suspend fun balanced(context: Context, timeoutMs: Long = 10_000, maxAgeMs: Long = 30_000): Fix? {
        if (!hasPermission(context)) return null
        val client = LocationServices.getFusedLocationProviderClient(context)
        val cts = CancellationTokenSource()
        val request = CurrentLocationRequest.Builder()
            .setPriority(Priority.PRIORITY_BALANCED_POWER_ACCURACY)
            .setMaxUpdateAgeMillis(maxAgeMs)
            .setDurationMillis(timeoutMs)
            .build()
        val fresh = withTimeoutOrNull(timeoutMs + 1_000) {
            runCatching { client.getCurrentLocation(request, cts.token).await() }.getOrNull()
        }
        cts.cancel()
        val loc = fresh ?: runCatching { client.lastLocation.await() }.getOrNull() ?: return null
        return toFix(loc)
    }
}
