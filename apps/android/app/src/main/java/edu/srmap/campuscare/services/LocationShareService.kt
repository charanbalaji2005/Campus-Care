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
import edu.srmap.campuscare.util.Fmt
import edu.srmap.campuscare.util.LocationHelper
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.time.Instant

/**
 * Sends location updates for an active, consented, time-limited share. A persistent notification
 * always shows who can see the location and offers "Stop sharing". The share also stops on the
 * server at its expiry time even if this service is killed.
 */
class LocationShareService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var shareId: String? = null
    private var expiresAt: Instant? = null
    private val callback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            val loc = result.lastLocation ?: return
            val id = shareId ?: return
            if (expiresAt?.isBefore(Instant.now()) == true) {
                stopSelf()
                return
            }
            val api = (application as CampusCareApp).container.api
            scope.launch {
                try {
                    api.safety.updateShare(id, loc.latitude, loc.longitude, if (loc.hasAccuracy()) loc.accuracy.toDouble() else null)
                } catch (e: ApiException) {
                    if (e.status == 410 || e.status == 404) stopSelf() // expired or stopped elsewhere
                }
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    @SuppressLint("MissingPermission")
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            val id = shareId ?: intent.getStringExtra(EXTRA_ID)
            val api = (application as CampusCareApp).container.api
            if (id != null) scope.launch { runCatching { api.safety.stopShare(id) } }
            stopSelf()
            return START_NOT_STICKY
        }
        shareId = intent?.getStringExtra(EXTRA_ID) ?: return START_NOT_STICKY
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
        ServiceCompat.startForeground(
            this, NOTIFICATION_ID, notification,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0,
        )

        if (!LocationHelper.hasPermission(this)) {
            stopSelf()
            return START_NOT_STICKY
        }
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 30_000L).setMinUpdateIntervalMillis(15_000L).build()
        LocationServices.getFusedLocationProviderClient(this).requestLocationUpdates(request, callback, Looper.getMainLooper())
        return START_REDELIVER_INTENT
    }

    override fun onDestroy() {
        LocationServices.getFusedLocationProviderClient(this).removeLocationUpdates(callback)
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        private const val NOTIFICATION_ID = 4101
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
