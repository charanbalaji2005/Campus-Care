package edu.srmap.campuscare.services

import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import edu.srmap.campuscare.CampusCareApp
import edu.srmap.campuscare.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * "On duty" mode for Campus Security. Keeps the realtime connection to the responders room open
 * so new SOS alerts ring immediately even when Firebase push is not configured.
 */
class ResponderDutyService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            setOnDuty(this, false)
            stopSelf()
            return START_NOT_STICKY
        }
        val stop = PendingIntent.getService(this, 2, Intent(this, ResponderDutyService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(this, Notifications.SERVICE)
            .setSmallIcon(R.drawable.ic_stat_shield)
            .setContentTitle("On duty — receiving SOS alerts")
            .setContentText("New emergency alerts will ring on this phone.")
            .setOngoing(true)
            .setContentIntent(Notifications.contentIntent(this, "/security/alerts"))
            .addAction(0, "Go off duty", stop)
            .build()
        ServiceCompat.startForeground(
            this, NOTIFICATION_ID, notification,
            if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING else 0,
        )
        val container = (application as CampusCareApp).container
        container.realtime.connect()
        container.realtime.subscribe("responders:all")
        scope.launch {
            container.realtime.events.collect { e ->
                if (e.name == "sos:new") {
                    val number = e.payload.optString("alertNumber", "SOS")
                    val id = e.payload.optString("id")
                    Notifications.show(this@ResponderDutyService, number.hashCode(), "sos", "critical", "SOS $number — respond now", "An emergency alert needs a responder.", "/security/alerts/$id")
                }
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        private const val NOTIFICATION_ID = 4102
        private const val ACTION_STOP = "edu.srmap.campuscare.OFF_DUTY"

        fun isOnDuty(context: Context) = context.getSharedPreferences("cc_prefs", Context.MODE_PRIVATE).getBoolean("on_duty", false)

        fun setOnDuty(context: Context, on: Boolean) {
            context.getSharedPreferences("cc_prefs", Context.MODE_PRIVATE).edit().putBoolean("on_duty", on).apply()
        }

        fun start(context: Context) {
            setOnDuty(context, true)
            ContextCompat.startForegroundService(context, Intent(context, ResponderDutyService::class.java))
        }

        fun stop(context: Context) {
            setOnDuty(context, false)
            context.stopService(Intent(context, ResponderDutyService::class.java))
        }
    }
}
