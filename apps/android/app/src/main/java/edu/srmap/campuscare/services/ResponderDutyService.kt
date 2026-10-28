package edu.srmap.campuscare.services

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import edu.srmap.campuscare.BuildConfig
import edu.srmap.campuscare.CampusCareApp
import edu.srmap.campuscare.R
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.DutyOverview
import edu.srmap.campuscare.data.HeartbeatResult
import edu.srmap.campuscare.data.RealtimeEvent
import edu.srmap.campuscare.util.LocationHelper
import edu.srmap.campuscare.util.ServerClock
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.Collections

/**
 * "On duty" mode for Campus Security. The server decides whether the responder is on duty; this
 * service only runs while it says so. It
 *  - sends a heartbeat at once and then every `heartbeatIntervalSeconds` (server policy), so dispatch
 *    knows the phone is reachable — with a balanced-power location only when the responder opted in;
 *  - keeps the realtime channel open so SOS offers ring immediately even without Firebase push;
 *  - stops itself (and clears local state) when the server reports the responder is no longer on duty.
 */
class ResponderDutyService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var heartbeatJob: Job? = null
    private var eventsJob: Job? = null
    @Volatile private var currentStatus: String = "on_duty"
    /** Alerts offered to this responder, so a later broadcast for the same alert never downgrades the ring. */
    private val assignedToMe: MutableSet<String> = Collections.synchronizedSet(mutableSetOf())

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val container = (application as CampusCareApp).container
        if (intent?.action == ACTION_OFF_DUTY) {
            scope.launch { goOffDuty() }
            return START_NOT_STICKY
        }
        if (!container.session.isSignedIn || !isOnDuty(this)) {
            stopAndClear()
            return START_NOT_STICKY
        }
        if (!enterForeground()) {
            stopSelf()
            return START_NOT_STICKY
        }
        container.realtime.connect()
        container.realtime.subscribe("responders:all")
        if (eventsJob?.isActive != true) eventsJob = scope.launch { container.realtime.events.collect { handleEvent(it) } }
        if (heartbeatJob?.isActive != true) heartbeatJob = scope.launch { heartbeatLoop() }
        return START_STICKY
    }

    /**
     * Location is part of the foreground-service type only when the responder may share it and the
     * permission is granted (Android 14 rejects a location FGS otherwise). Falls back to remote messaging only.
     */
    private fun enterForeground(): Boolean {
        val notification = buildNotification(currentStatus)
        val wantsLocation = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && locationAllowed(this) && LocationHelper.hasPermission(this)
        val messaging = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING else 0
        val types = if (wantsLocation) messaging or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else messaging
        return try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, types)
            true
        } catch (e: Exception) {
            // e.g. a location FGS may not start from the background on Android 14+: keep alerts, drop location.
            runCatching { ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, messaging) }.isSuccess
        }
    }

    private fun buildNotification(status: String): Notification {
        val offDuty = PendingIntent.getService(
            this, 2, Intent(this, ResponderDutyService::class.java).setAction(ACTION_OFF_DUTY),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val (title, text) = when (status) {
            "on_break" -> "On break — still on shift" to "Dispatch won't offer you new alerts until you're back on duty."
            "busy" -> "Busy — on shift" to "Dispatch prefers other responders while you're busy."
            "responding" -> "Responding to an emergency" to "Open CampusCare for the alert details."
            "stale" -> "Reconnecting to dispatch…" to "Dispatch lost your heartbeat. Check your connection."
            else -> "On duty — receiving SOS alerts" to "Alerts assigned to you will ring on this phone."
        }
        return NotificationCompat.Builder(this, Notifications.SERVICE)
            .setSmallIcon(R.drawable.ic_stat_shield)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setContentIntent(Notifications.contentIntent(this, "/security/alerts"))
            .addAction(0, "Go off duty", offDuty)
            .build()
    }

    private fun updateNotification(status: String) {
        if (status == currentStatus) return
        currentStatus = status
        if (!Notifications.canPost(this)) return
        try {
            NotificationManagerCompat.from(this).notify(NOTIFICATION_ID, buildNotification(status))
        } catch (e: SecurityException) {
            // Notification permission revoked.
        }
    }

    // ------------------------------------------------------------------ heartbeats
    private suspend fun heartbeatLoop() {
        val api = (application as CampusCareApp).container.api
        // Refresh policy and consent first (best effort): the service may have been restarted by the system.
        try {
            val duty = api.duty.mine()
            storePolicy(this, duty)
            controller().onServerOverview(duty)
            if (!isActiveStatus(duty.availability.status)) {
                stopAndClear()
                return
            }
            updateNotification(duty.availability.status)
        } catch (e: ApiException) {
            if (isFatal(e)) {
                onFatal(e)
                return
            }
            // Offline or server trouble: keep running on the cached state; the heartbeat loop reconciles.
        }
        while (scope.isActive) {
            val waitMs = try {
                val r = sendHeartbeat()
                ServerClock.update(r.serverTime)
                prefs(this).edit()
                    .putInt(KEY_INTERVAL, r.heartbeatIntervalSeconds)
                    .putLong(KEY_LAST_HEARTBEAT, System.currentTimeMillis())
                    .apply()
                updateNotification(r.status)
                controller().onServerStatus(r.status, applyToDevice = false)
                r.heartbeatIntervalSeconds.coerceIn(10, 600) * 1000L
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                if (isFatal(e)) {
                    onFatal(e)
                    return
                }
                // Offline or server trouble: try again sooner so dispatch sees us before the stale threshold.
                interval(this).coerceAtMost(20) * 1000L
            } catch (e: Exception) {
                interval(this) * 1000L
            }
            delay(waitMs)
        }
    }

    private suspend fun sendHeartbeat(): HeartbeatResult {
        val api = (application as CampusCareApp).container.api
        // Position only with explicit consent, server policy and OS permission. Balanced power, not continuous GPS.
        val fix = if (locationAllowed(this) && LocationHelper.hasPermission(this)) LocationHelper.balanced(this) else null
        // A fix of unknown or very old age is never sent as if it were current.
        val usable = fix?.takeIf { f -> f.ageSeconds?.let { it <= MAX_FIX_AGE_SECONDS } == true }
        return api.duty.heartbeat(usable?.latitude, usable?.longitude, usable?.accuracy, usable?.ageSeconds, batteryPercent(), BuildConfig.VERSION_NAME)
    }

    private fun batteryPercent(): Int? =
        (getSystemService(Context.BATTERY_SERVICE) as? BatteryManager)?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)?.takeIf { it in 0..100 }

    private fun controller() = (application as CampusCareApp).container.duty

    private fun isFatal(e: ApiException) = e.status == 401 || e.status == 403 || (e.status == 409 && e.code == "not_on_duty")

    /** Signed out, no longer permitted, or the server says duty has ended: stop ringing on this phone. */
    private fun onFatal(e: ApiException) {
        if (e.code == "not_on_duty") controller().onServerStatus("off_duty", applyToDevice = false)
        stopAndClear()
    }

    /** "Go off duty" from the notification goes through the same flow as the switch; the service keeps running if the server refuses. */
    private suspend fun goOffDuty() {
        when (val r = controller().setOnDuty(false, reason = "Ended from the duty notification")) {
            is DutyResult.Confirmed, DutyResult.Ignored -> Unit // confirmed: DutyController already stopped this service
            // Signed out or no longer a responder: nothing more this phone can do on duty.
            is DutyResult.Failed -> if (r.problem.httpStatus == 401 || r.problem.httpStatus == 403) stopAndClear() else showStillOnDuty(r.problem.message)
        }
    }

    private fun showStillOnDuty(message: String) =
        Notifications.show(this, NOTIFICATION_ID + 1, "duty", "high", "You're still on duty", message, "/security/alerts")

    // ------------------------------------------------------------------ realtime
    private fun handleEvent(e: RealtimeEvent) {
        when (e.name) {
            // Addressed to this responder only (user room): ring loudly.
            "sos:assigned" -> {
                val alertId = e.payload.str("alertId") ?: return
                val number = e.payload.str("alertNumber") ?: "SOS"
                assignedToMe.add(alertId)
                val secs = ServerClock.secondsUntil(e.payload.str("ackDeadlineAt"))?.takeIf { it > 0 }
                Notifications.show(
                    this, Notifications.sosId(alertId), "sos", "critical",
                    "SOS $number — assigned to you",
                    "Acknowledge now${secs?.let { " (within $it s)" } ?: ""} or it moves to another responder.",
                    "/security/alerts/$alertId",
                )
            }
            // Broadcast to every responder: informational only; dispatch rings the assigned responder.
            "sos:new" -> {
                val alertId = e.payload.str("id") ?: return
                if (alertId in assignedToMe) return
                val number = e.payload.str("alertNumber") ?: "SOS"
                Notifications.show(
                    this, Notifications.sosId(alertId), "sos_broadcast", "normal",
                    "New SOS $number on campus", "Dispatch is assigning a responder. Open to view the queue.",
                    "/security/alerts/$alertId",
                )
            }
            "sos:assignment_closed" -> {
                val alertId = e.payload.str("alertId") ?: return
                assignedToMe.remove(alertId)
                Notifications.cancel(this, Notifications.sosId(alertId))
            }
            "duty:updated" -> {
                val me = (application as CampusCareApp).container.session.user.value?.id
                val who = e.payload.str("userId")
                if (me != null && who != null && who != me) return
                if (e.payload.has("locationConsent")) prefs(this).edit().putBoolean(KEY_CONSENT, e.payload.optBoolean("locationConsent")).apply()
                val status = e.payload.str("status") ?: return
                controller().onServerStatus(status, applyToDevice = false)
                if (isActiveStatus(status)) updateNotification(status) else stopAndClear()
            }
        }
    }

    private fun stopAndClear() {
        setOnDuty(this, false)
        assignedToMe.clear()
        runCatching { ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE) }
        stopSelf()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        private const val NOTIFICATION_ID = 4102
        private const val ACTION_OFF_DUTY = "edu.srmap.campuscare.OFF_DUTY"
        private const val KEY_ON_DUTY = "on_duty"
        private const val KEY_INTERVAL = "duty_heartbeat_interval"
        private const val KEY_CONSENT = "duty_location_consent"
        private const val KEY_POLICY_LOCATION = "duty_location_policy"
        private const val KEY_LAST_HEARTBEAT = "duty_last_heartbeat_ms"
        private const val MAX_FIX_AGE_SECONDS = 3_600.0

        fun isActiveStatus(status: String) = DutyRules.isActive(status)

        private fun prefs(context: Context) = context.getSharedPreferences("cc_prefs", Context.MODE_PRIVATE)

        /**
         * Cached mirror of the server's last confirmed duty state, only so the service can resume after a
         * restart or reboot (it re-reads the server first). Screens read DutyController instead.
         */
        fun isOnDuty(context: Context) = prefs(context).getBoolean(KEY_ON_DUTY, false)

        fun setOnDuty(context: Context, on: Boolean) {
            prefs(context).edit().putBoolean(KEY_ON_DUTY, on).apply()
        }

        private fun interval(context: Context): Int = prefs(context).getInt(KEY_INTERVAL, 45).coerceIn(10, 600)

        /** Location may be attached to heartbeats only with consent and while dispatch policy allows it. */
        private fun locationAllowed(context: Context) = prefs(context).getBoolean(KEY_CONSENT, false) && prefs(context).getBoolean(KEY_POLICY_LOCATION, false)

        /** Wall-clock time of the last accepted heartbeat from this phone (for display), or 0. */
        fun lastHeartbeatMs(context: Context): Long = prefs(context).getLong(KEY_LAST_HEARTBEAT, 0L)

        /** Stores the server's policy and the responder's consent for the service to use. */
        fun storePolicy(context: Context, duty: DutyOverview) {
            ServerClock.update(duty.serverTime)
            prefs(context).edit()
                .putInt(KEY_INTERVAL, duty.policy.heartbeatIntervalSeconds)
                .putBoolean(KEY_CONSENT, duty.availability.locationConsent)
                .putBoolean(KEY_POLICY_LOCATION, duty.policy.responderLocationSharing)
                .apply()
        }

        fun setLocationConsent(context: Context, consent: Boolean) {
            prefs(context).edit().putBoolean(KEY_CONSENT, consent).apply()
        }

        /** Starts or stops the service so it matches a server-confirmed duty status. Only DutyController calls these. */
        fun sync(context: Context, duty: DutyOverview) {
            storePolicy(context, duty)
            sync(context, duty.availability.status)
        }

        fun sync(context: Context, status: String) {
            if (isActiveStatus(status)) start(context) else stop(context)
        }

        fun start(context: Context) {
            setOnDuty(context, true)
            try {
                ContextCompat.startForegroundService(context, Intent(context, ResponderDutyService::class.java))
            } catch (e: IllegalStateException) {
                // Android 12+ refuses a foreground service started from the background; the cached state
                // lets the next app open or reboot resume it, and dispatch marks the phone stale meanwhile.
            }
        }

        /** After a reboot: resume only if this phone was on duty; the service then re-reads the server and stops if duty ended. */
        fun resumeAfterBoot(context: Context) {
            if (isOnDuty(context)) start(context)
        }

        fun stop(context: Context) {
            setOnDuty(context, false)
            context.stopService(Intent(context, ResponderDutyService::class.java))
        }
    }
}

/** Production [DutyDevice]: the duty service runs exactly while the server says the responder is on duty. */
class ServiceDutyDevice(private val context: Context) : DutyDevice {
    override fun apply(overview: DutyOverview) = ResponderDutyService.sync(context, overview)
    override fun applyStatus(status: String) = ResponderDutyService.sync(context, status)
}

/** JSON string field, treating missing, null and blank values as absent. */
private fun JSONObject.str(key: String): String? = if (!has(key) || isNull(key)) null else optString(key).takeIf { it.isNotBlank() }
