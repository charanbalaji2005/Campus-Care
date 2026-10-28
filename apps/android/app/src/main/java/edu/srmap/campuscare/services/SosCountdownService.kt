package edu.srmap.campuscare.services

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import edu.srmap.campuscare.BuildConfig
import edu.srmap.campuscare.CampusCareApp
import edu.srmap.campuscare.R
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.util.Fmt
import edu.srmap.campuscare.util.LocationHelper
import edu.srmap.campuscare.util.ServerClock
import edu.srmap.campuscare.util.SosCountdownEvent
import edu.srmap.campuscare.util.SosCountdownRules
import edu.srmap.campuscare.util.SosCountdownState
import edu.srmap.campuscare.util.SosRecovery
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import java.time.Instant
import java.util.UUID

/** How the SOS screen was reached (tile, shortcut), handed over by the deep-link router. */
object SosTrigger {
    @Volatile var pendingSource: String? = null

    fun consume(): String? = pendingSource.also { pendingSource = null }
}

/**
 * The saved countdown (at most one at a time), shared by the service, the SOS screen and the
 * notification actions. Persisted on every change so process death or a reboot never loses it.
 */
object SosCountdownStore {
    private const val PREFS = "cc_sos_countdown"
    private const val KEY = "event"
    private val json = Json { ignoreUnknownKeys = true }
    private val _event = MutableStateFlow<SosCountdownEvent?>(null)
    val event: StateFlow<SosCountdownEvent?> = _event.asStateFlow()
    @Volatile private var loaded = false

    fun load(context: Context): SosCountdownEvent? {
        if (!loaded) {
            val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)
            _event.value = raw?.let { runCatching { json.decodeFromString(SosCountdownEvent.serializer(), it) }.getOrNull() }
            loaded = true
        }
        return _event.value
    }

    fun save(context: Context, e: SosCountdownEvent) {
        // commit(): the next step may be a process kill, so the state must be on disk first.
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json.encodeToString(SosCountdownEvent.serializer(), e)).commit()
        _event.value = e
        loaded = true
    }
}

/**
 * Runs an SOS countdown outside any screen, so it keeps going when the app is backgrounded, the
 * screen locks or the SOS screen is closed.
 *
 * The event is sent to the server straight away as a "pending" alert with a server-side countdown
 * (duration from the Super Admin settings, never from the phone). The server dispatches it when the
 * countdown ends even if this phone dies or goes offline, and Cancel / Send SOS act on it atomically.
 * If the server cannot be reached, the phone keeps counting locally and retries (same idempotency
 * key, so never a second alert); if it still cannot deliver, it says so plainly and offers a call.
 *
 * The notification shows a live countdown with Cancel and Send SOS. Dismissing it is not a cancel.
 */
class SosCountdownService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val lock = Mutex()
    private val wake = Channel<Unit>(Channel.CONFLATED)
    private var loop: Job? = null
    /** A Cancel is still talking to the server: the service must not stop under it. */
    @Volatile private var cancelInFlight = false
    private val app get() = application as CampusCareApp

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val current = SosCountdownStore.load(this)
        // Every start must reach startForeground promptly, whatever the action.
        if (!goForeground(current ?: placeholder())) {
            stopSelf()
            return START_NOT_STICKY
        }
        when (intent?.action) {
            ACTION_START -> scope.launch {
                lock.withLock {
                    val (e, isNew) = SosCountdownRules.start(
                        SosCountdownStore.load(this@SosCountdownService), System.currentTimeMillis(),
                        app.container.config.config.value.settings.sos.countdownSeconds,
                        intent.getStringExtra(EXTRA_SOURCE) ?: "in_app", UUID.randomUUID().toString(), intent.getBooleanExtra(EXTRA_NOTIFY_TRUSTED, true),
                    )
                    if (isNew) debug("countdown started (${e.source}, ${e.countdownSeconds}s)") else debug("trigger joined the running countdown")
                    persist(e)
                }
                ensureLoop()
            }
            ACTION_CANCEL -> scope.launch { cancel() }
            ACTION_SEND_NOW -> scope.launch {
                lock.withLock {
                    val e = SosCountdownStore.load(this@SosCountdownService) ?: return@withLock
                    val next = if (e.state == SosCountdownState.Undelivered) SosCountdownRules.retry(e, System.currentTimeMillis()) else SosCountdownRules.requestSendNow(e)
                    persist(next)
                }
                ensureLoop()
                wake.trySend(Unit)
            }
            // Restarted by the system after the process was killed: carry on with the saved countdown.
            else -> ensureLoop()
        }
        return START_REDELIVER_INTENT
    }

    private fun ensureLoop() {
        if (loop?.isActive == true) return
        loop = scope.launch { runCountdown() }
    }

    /** Drives the saved event until it is sent, cancelled or reported as not delivered. */
    private suspend fun runCountdown() {
        while (scope.isActive) {
            val e = SosCountdownStore.load(this) ?: break
            if (!e.active) break
            val now = System.currentTimeMillis()
            when {
                e.alertId == null -> raise(e, now)
                e.sendNowRequested && !e.sendNowDelivered -> dispatchNow(e)
                now >= e.deadlineMs || e.sendNowDelivered -> confirmDispatched(e)
                else -> withTimeoutOrNull(e.deadlineMs - now) { wake.receive() }
            }
        }
        finish()
    }

    /** First contact: the server takes over the countdown. Once it is due, an immediate send instead. */
    private suspend fun raise(e: SosCountdownEvent, now: Long) {
        val due = e.due(now)
        val curBefore = SosCountdownStore.load(this)
        if (curBefore?.state == SosCountdownState.Cancelled) {
            debug("aborting raise: user cancelled before fix")
            return
        }
        val fix = if (hasLocationPermission()) LocationHelper.current(this, timeoutMs = 2_000) else null
        val curAfter = SosCountdownStore.load(this)
        if (curAfter?.state == SosCountdownState.Cancelled) {
            debug("aborting raise: user cancelled during fix")
            return
        }
        try {
            val alert = app.container.api.safety.raiseSos(
                key = e.eventId,
                lat = fix?.latitude, lng = fix?.longitude, accuracy = fix?.accuracy,
                unavailableReason = if (fix != null) null else if (!hasLocationPermission()) "permission_denied" else "no_fix",
                notifyTrusted = e.notifyTrusted,
                countdownMode = if (due) "client" else "server",
                locationAgeSeconds = fix?.ageSeconds,
                triggerSource = e.source,
            )
            val serverDeadline = Fmt.parse(alert.dispatchAt)?.toEpochMilli()?.let { it - (ServerClock.nowMs() - System.currentTimeMillis()) }
            var cancelOnServer = false
            lock.withLock {
                val cur = SosCountdownStore.load(this) ?: return
                if (cur.state == SosCountdownState.Cancelled) {
                    cancelOnServer = true // Cancel was tapped while this request was in flight
                } else {
                    val accepted = SosCountdownRules.accepted(cur, alert.id, if (due) null else serverDeadline)
                    persist(if (alert.status != "pending") SosCountdownRules.sent(accepted) else accepted)
                }
            }
            if (cancelOnServer) {
                runCatching { app.container.api.safety.cancelCountdown(alert.id) }
                return
            }
            debug("server accepted the countdown (status ${alert.status})")
            // Live location for responders (pending alerts accept it too). May be refused while in the background;
            // the alert already carries the first fix and the status screen restarts tracking when opened.
            runCatching { LocationShareService.startSos(this, alert.id) }
        } catch (err: ApiException) {
            if (err.isNetwork || err.status >= 500 && err.code != "sos_disabled") {
                lock.withLock {
                    val cur = SosCountdownStore.load(this) ?: return
                    if (cur.active) persist(SosCountdownRules.failedAttempt(cur, System.currentTimeMillis(), err.message ?: "Network unreachable"))
                }
                val cur = SosCountdownStore.load(this)
                if (cur?.active == true) {
                    val wait = if (cur.due(System.currentTimeMillis())) SosCountdownRules.retryDelayMs(cur.attempts) else minOf(SosCountdownRules.retryDelayMs(cur.attempts), cur.deadlineMs - System.currentTimeMillis()).coerceAtLeast(500)
                    withTimeoutOrNull(wait) { wake.receive() }
                }
            } else {
                lock.withLock {
                    val cur = SosCountdownStore.load(this) ?: return
                    if (cur.active) persist(SosCountdownRules.undelivered(cur, err.message ?: "The alert could not be sent."))
                }
            }
        }
    }

    private suspend fun dispatchNow(e: SosCountdownEvent) {
        try {
            app.container.api.safety.dispatchNow(e.alertId!!)
            lock.withLock { SosCountdownStore.load(this)?.let { if (it.active) persist(it.copy(sendNowDelivered = true)) } }
        } catch (err: ApiException) {
            // The server still dispatches at its own deadline, so a failed "send now" is not fatal.
            debug("send-now failed: ${err.code}")
            lock.withLock { SosCountdownStore.load(this)?.let { if (it.active) persist(it.copy(sendNowDelivered = true)) } }
        }
    }

    /** The deadline passed: the server has dispatched it (or does so within its next sweep). Confirm it. */
    private suspend fun confirmDispatched(e: SosCountdownEvent) {
        repeat(5) {
            val alert = runCatching { app.container.api.safety.sos(e.alertId!!) }.getOrNull()
            if (alert != null && alert.status != "pending") {
                lock.withLock {
                    val cur = SosCountdownStore.load(this) ?: return
                    persist(if (alert.status == "cancelled") SosCountdownRules.cancel(cur, System.currentTimeMillis()) else SosCountdownRules.sent(cur))
                }
                return
            }
            delay(2_000)
        }
        // Could not confirm (offline now): the server holds the alert and will dispatch it regardless.
        lock.withLock { SosCountdownStore.load(this)?.let { if (it.active) persist(SosCountdownRules.sent(it).copy(lastError = "unconfirmed")) } }
    }

    private suspend fun cancel() {
        cancelInFlight = true
        try {
            cancelOnce()
        } finally {
            cancelInFlight = false
        }
        if (loop?.isActive != true) finish() else wake.trySend(Unit)
    }

    private suspend fun cancelOnce() {
        var toCancel: SosCountdownEvent? = null
        lock.withLock {
            val e = SosCountdownStore.load(this) ?: return@withLock
            if (e.active) {
                toCancel = SosCountdownRules.cancel(e, System.currentTimeMillis()).also { persist(it) }
                debug("cancelled by the user")
            }
            // Already sent: nothing to cancel here; finish() shows the "sent" notice with a way to the status screen.
        }
        val c = toCancel ?: return
        try {
            if (c.alertId != null) app.container.api.safety.cancelCountdown(c.alertId)
            else app.container.api.safety.countdownCancelled(c.eventId, c.source, Instant.ofEpochMilli(c.startedAtMs).toString(), Instant.ofEpochMilli(c.cancelledAtMs ?: System.currentTimeMillis()).toString())
        } catch (err: ApiException) {
            if (err.code == "already_dispatched") {
                // The countdown ended on the server first: it was sent. Never retract it silently.
                lock.withLock { SosCountdownStore.load(this)?.let { persist(it.copy(state = SosCountdownState.Sent, lastError = null)) } }
            }
            // Offline cancel of an event the server never received: recorded locally only.
        }
    }

    private fun finish() {
        if (cancelInFlight) return // cancel() finishes once its server call is done
        val e = SosCountdownStore.load(this)
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        e?.let { showFinal(it) }
        stopSelf()
    }

    private fun persist(e: SosCountdownEvent) {
        SosCountdownStore.save(this, e)
        if (e.active) NotificationManagerCompat.from(this).let { nm -> if (Notifications.canPost(this)) runCatching { nm.notify(NOTIFICATION_ID, countdownNotification(e)) } }
    }

    private fun goForeground(e: SosCountdownEvent): Boolean {
        val n = countdownNotification(e)
        // Location type keeps the first fix available in the background; otherwise a short service (Android 14+).
        val types = buildList {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && hasLocationPermission()) add(ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) add(ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE)
            add(0)
        }
        for (type in types) {
            try {
                ServiceCompat.startForeground(this, NOTIFICATION_ID, n, type)
                return true
            } catch (err: Exception) {
                debug("startForeground type $type refused: ${err.javaClass.simpleName}")
            }
        }
        return false
    }

    /** Android 14+ short services must stop when told; whatever is unsent is reported, never claimed as sent. */
    override fun onTimeout(startId: Int) {
        scope.launch {
            lock.withLock {
                SosCountdownStore.load(this@SosCountdownService)?.let { e ->
                    if (e.active && e.alertId == null) persist(SosCountdownRules.undelivered(e, "The alert could not reach the server in time."))
                }
            }
            loop?.cancel()
            finish()
        }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private fun placeholder() = SosCountdownEvent("starting", "in_app", System.currentTimeMillis(), System.currentTimeMillis() + SosCountdownRules.DEFAULT_SECONDS * 1000L, SosCountdownRules.DEFAULT_SECONDS)

    private fun hasLocationPermission() =
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun countdownNotification(e: SosCountdownEvent): Notification {
        val message = app.container.config.config.value.settings.sos.quickTriggerMessage
        val failing = e.lastError != null && e.alertId == null
        return NotificationCompat.Builder(this, Notifications.EMERGENCY)
            .setSmallIcon(R.drawable.ic_stat_shield)
            .setColor(0xFFDC2626.toInt())
            .setContentTitle("CampusCare Emergency SOS")
            .setContentText(if (failing) "No connection yet — retrying. Call Campus Security if you can." else message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(if (failing) "No connection yet — retrying. Call Campus Security if you can." else message))
            .setSubText(if (e.due(System.currentTimeMillis())) "Sending…" else "Sending in")
            // A live countdown drawn by the system (no per-second updates needed).
            .setWhen(e.deadlineMs)
            .setShowWhen(true)
            .setUsesChronometer(!e.due(System.currentTimeMillis()))
            .setChronometerCountDown(true)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            // Lock screen: no coordinates or personal details are ever in this notification.
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(Notifications.contentIntent(this, "/student/emergency"))
            .addAction(0, "Cancel", action(ACTION_CANCEL, 1))
            .addAction(0, "Send SOS", action(ACTION_SEND_NOW, 2))
            .build()
    }

    private fun showFinal(e: SosCountdownEvent) {
        if (!Notifications.canPost(this)) return
        val nm = NotificationManagerCompat.from(this)
        nm.cancel(NOTIFICATION_ID)
        val b = NotificationCompat.Builder(this, Notifications.EMERGENCY)
            .setSmallIcon(R.drawable.ic_stat_shield)
            .setColor(0xFFDC2626.toInt())
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
        when (e.state) {
            SosCountdownState.Sent -> b.setContentTitle("SOS sent to Campus Security")
                .setContentText(if (e.lastError == "unconfirmed") "The server has your alert and dispatches it even while you are offline. Open CampusCare for status." else "Responders are being alerted. Open CampusCare for status.")
                .setContentIntent(Notifications.contentIntent(this, "/student/emergency?alert=${e.alertId}"))
            SosCountdownState.Cancelled -> b.setContentTitle("SOS cancelled").setContentText("No alert was sent.").setTimeoutAfter(8_000)
                .setContentIntent(Notifications.contentIntent(this, "/student/emergency"))
            SosCountdownState.Undelivered -> b.setContentTitle("SOS NOT delivered")
                .setContentText((e.lastError ?: "No connection.") + " Call Campus Security or 112 now.")
                .setStyle(NotificationCompat.BigTextStyle().bigText((e.lastError ?: "No connection.") + " Call Campus Security or 112 now."))
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setOngoing(true)
                .setContentIntent(Notifications.contentIntent(this, "/student/emergency"))
                .addAction(0, "Retry SOS", action(ACTION_SEND_NOW, 3))
                .addAction(0, "Call", dialIntent())
            SosCountdownState.Counting -> return
        }
        runCatching { nm.notify(FINAL_NOTIFICATION_ID, b.build()) }
    }

    private fun action(action: String, code: Int): PendingIntent =
        PendingIntent.getForegroundService(this, code, Intent(this, SosCountdownService::class.java).setAction(action), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    private fun dialIntent(): PendingIntent {
        val phone = app.container.config.config.value.emergencyContacts.firstOrNull { (it.category == "security" || it.category == "emergency") && !it.phone.isNullOrBlank() }?.phone ?: "112"
        return PendingIntent.getActivity(this, 4, Intent(Intent.ACTION_DIAL, Uri.parse("tel:$phone")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE)
    }

    private fun debug(msg: String) {
        if (BuildConfig.DEBUG) Log.d("CampusCareSos", msg)
    }

    companion object {
        private const val NOTIFICATION_ID = 4301
        private const val FINAL_NOTIFICATION_ID = 4302
        private const val ACTION_START = "edu.srmap.campuscare.SOS_COUNTDOWN_START"
        private const val ACTION_CANCEL = "edu.srmap.campuscare.SOS_COUNTDOWN_CANCEL"
        private const val ACTION_SEND_NOW = "edu.srmap.campuscare.SOS_COUNTDOWN_SEND_NOW"
        private const val EXTRA_SOURCE = "source"
        private const val EXTRA_NOTIFY_TRUSTED = "notify_trusted"

        /**
         * Starts (or joins) a countdown. Must be called while the app may start a foreground service:
         * from a visible screen, a notification action or the Quick Settings tile. Returns false if the
         * system refused, so the caller can fall back to opening the SOS screen.
         */
        fun start(context: Context, source: String, notifyTrusted: Boolean = true): Boolean = runCatching {
            ContextCompat.startForegroundService(context, Intent(context, SosCountdownService::class.java).setAction(ACTION_START).putExtra(EXTRA_SOURCE, source).putExtra(EXTRA_NOTIFY_TRUSTED, notifyTrusted))
        }.isSuccess

        fun cancel(context: Context) {
            val cur = SosCountdownStore.load(context)
            if (cur != null && cur.active) {
                SosCountdownStore.save(context, SosCountdownRules.cancel(cur, System.currentTimeMillis()))
            }
            LocationShareService.stopAll(context)
            runCatching { ContextCompat.startForegroundService(context, Intent(context, SosCountdownService::class.java).setAction(ACTION_CANCEL)) }
        }

        fun sendNow(context: Context) {
            runCatching { ContextCompat.startForegroundService(context, Intent(context, SosCountdownService::class.java).setAction(ACTION_SEND_NOW)) }
        }

        /**
         * After a restart: an SOS that never reached the server and was never cancelled is offered
         * again with a notification (never sent silently, minutes later, without the person's say).
         */
        @SuppressLint("MissingPermission")
        fun reconcile(context: Context) {
            val e = SosCountdownStore.load(context) ?: return
            val stale = e.active && System.currentTimeMillis() > e.deadlineMs + 60_000 // a live service would have finished
            if (!(stale || e.state == SosCountdownState.Undelivered)) return
            if (SosCountdownRules.recover(e, System.currentTimeMillis()) != SosRecovery.AskToSend) return
            if (e.active) SosCountdownStore.save(context, SosCountdownRules.undelivered(e, "Your SOS countdown was interrupted before it reached Campus Security."))
            if (!Notifications.canPost(context)) return
            val send = PendingIntent.getForegroundService(context, 5, Intent(context, SosCountdownService::class.java).setAction(ACTION_SEND_NOW), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            val n = NotificationCompat.Builder(context, Notifications.EMERGENCY)
                .setSmallIcon(R.drawable.ic_stat_shield)
                .setColor(0xFFDC2626.toInt())
                .setContentTitle("Your SOS may not have been sent")
                .setContentText("It was interrupted before reaching Campus Security. Send it now if you still need help.")
                .setStyle(NotificationCompat.BigTextStyle().bigText("It was interrupted before reaching Campus Security. Send it now if you still need help."))
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setContentIntent(Notifications.contentIntent(context, "/student/emergency"))
                .addAction(0, "Send SOS", send)
                .build()
            runCatching { NotificationManagerCompat.from(context).notify(FINAL_NOTIFICATION_ID, n) }
        }
    }
}
