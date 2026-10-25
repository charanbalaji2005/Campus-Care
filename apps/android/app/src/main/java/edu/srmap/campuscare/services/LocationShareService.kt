package edu.srmap.campuscare.services

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import edu.srmap.campuscare.CampusCareApp
import edu.srmap.campuscare.R
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.util.Fix
import edu.srmap.campuscare.util.Fmt
import edu.srmap.campuscare.util.LocationHelper
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.time.Instant

/**
 * Sends location updates for an active, consented, time-limited share. A persistent notification
 * always shows who can see the location and offers "Stop sharing". The share also stops on the
 * server at its expiry time even if this service is killed.
 *
 * Battery: updates arrive at most every 15–20 s and only after moving ~10 m; while standing still a
 * balanced-power keep-alive fix is sent about once a minute so responders can tell the share is alive.
 * Every update carries the fix's accuracy and its age (monotonic clock), never a device timestamp.
 */
class LocationShareService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var shareId: String? = null
    private var expiresAt: Instant? = null
    private var keepAliveJob: Job? = null
    @Volatile private var lastSentElapsedMs = 0L
    @Volatile private var stopped = false
    private val callback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            val loc = result.lastLocation ?: return
            send(LocationHelper.toFix(loc))
        }
    }

    private fun send(fix: Fix) {
        val id = shareId ?: return
        if (stopped) return
        if (expiresAt?.isBefore(Instant.now()) == true) {
            stopSharing(notifyServer = false)
            return
        }
        // Location permission withdrawn in system settings: stop the share instead of leaving a stale position up.
        if (!LocationHelper.hasPermission(this)) {
            stopSharing(notifyServer = true)
            return
        }
        lastSentElapsedMs = SystemClock.elapsedRealtime()
        val api = (application as CampusCareApp).container.api
        scope.launch {
            try {
                api.safety.updateShare(id, fix.latitude, fix.longitude, fix.accuracy, fix.ageSeconds)
            } catch (e: ApiException) {
                // Expired, stopped elsewhere, or no longer allowed: stop at once.
                if (e.status == 410 || e.status == 404 || e.status == 403 || e.status == 401) stopSharing(notifyServer = false)
            }
        }
    }

    private fun stopSharing(notifyServer: Boolean) {
        if (stopped) return
        stopped = true
        val id = shareId
        if (notifyServer && id != null) {
            val api = (application as CampusCareApp).container.api
            scope.launch {
                runCatching { api.safety.stopShare(id) }
                stopSelf()
            }
        } else {
            stopSelf()
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    @SuppressLint("MissingPermission")
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            // Consent withdrawn from the notification: stop updates first, then tell the server.
            LocationServices.getFusedLocationProviderClient(this).removeLocationUpdates(callback)
            keepAliveJob?.cancel()
            val id = shareId ?: intent.getStringExtra(EXTRA_ID)
            stopped = true
            val api = (application as CampusCareApp).container.api
            if (id != null) {
                scope.launch {
                    runCatching { api.safety.stopShare(id) }
                    stopSelf()
                }
            } else {
                stopSelf()
            }
            return START_NOT_STICKY
        }
        shareId = intent?.getStringExtra(EXTRA_ID) ?: return START_NOT_STICKY
        stopped = false
        expiresAt = intent.getStringExtra(EXTRA_EXPIRES)?.let { Fmt.parse(it) }
        val audience = intent.getStringExtra(EXTRA_AUDIENCE) ?: "security"

        val stop = PendingIntent.getService(
            this, 1, Intent(this, LocationShareService::class.java).setAction(ACTION_STOP).putExtra(EXTRA_ID, shareId),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val who = if (audience == "security") "Campus Security" else "your trusted contacts"
        val notification = NotificationCompat.Builder(this, Notifications.SERVICE)
            .setSmallIcon(R.drawable.ic_stat_shield)
            .setContentTitle("Sharing your live location")
            .setContentText("Visible to $who until ${Fmt.time(expiresAt?.toString())}")
            .setOngoing(true)
            .setContentIntent(Notifications.contentIntent(this, "/student/safe-walk"))
            .addAction(0, "Stop sharing", stop)
            .build()
        try {
            ServiceCompat.startForeground(
                this, NOTIFICATION_ID, notification,
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0,
            )
        } catch (e: Exception) {
            // Location permission missing or the system refused a location service now: end the share cleanly.
            stopSharing(notifyServer = true)
            return START_NOT_STICKY
        }

        if (!LocationHelper.hasPermission(this)) {
            // Permission denied or withdrawn: end the share so nobody sees a position that will never update.
            stopSharing(notifyServer = true)
            return START_NOT_STICKY
        }
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 20_000L)
            .setMinUpdateIntervalMillis(15_000L)
            .setMinUpdateDistanceMeters(10f)
            .setWaitForAccurateLocation(false)
            .build()
        val client = LocationServices.getFusedLocationProviderClient(this)
        client.removeLocationUpdates(callback)
        client.requestLocationUpdates(request, callback, Looper.getMainLooper())
        if (keepAliveJob?.isActive != true) {
            keepAliveJob = scope.launch {
                while (isActive) {
                    delay(KEEP_ALIVE_MS)
                    if (SystemClock.elapsedRealtime() - lastSentElapsedMs >= KEEP_ALIVE_MS) {
                        LocationHelper.balanced(this@LocationShareService)?.let { send(it) }
                    }
                }
            }
        }
        return START_REDELIVER_INTENT
    }

    override fun onDestroy() {
        LocationServices.getFusedLocationProviderClient(this).removeLocationUpdates(callback)
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        private const val NOTIFICATION_ID = 4101
        private const val KEEP_ALIVE_MS = 60_000L
        private const val EXTRA_ID = "share_id"
        private const val EXTRA_EXPIRES = "expires_at"
        private const val EXTRA_AUDIENCE = "audience"
        private const val ACTION_STOP = "edu.srmap.campuscare.STOP_SHARE"

        fun start(context: Context, shareId: String, expiresAt: String, audience: String) {
            val i = Intent(context, LocationShareService::class.java)
                .putExtra(EXTRA_ID, shareId).putExtra(EXTRA_EXPIRES, expiresAt).putExtra(EXTRA_AUDIENCE, audience)
            ContextCompat.startForegroundService(context, i)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, LocationShareService::class.java))
        }
    }
}
