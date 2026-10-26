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
import android.os.PowerManager
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationAvailability
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import edu.srmap.campuscare.CampusCareApp
import edu.srmap.campuscare.R
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.liveLocation
import edu.srmap.campuscare.util.FilterDecision
import edu.srmap.campuscare.util.Fmt
import edu.srmap.campuscare.util.LocationFilter
import edu.srmap.campuscare.util.LocationHelper
import edu.srmap.campuscare.util.LocationPermissions
import edu.srmap.campuscare.util.LocationQuality
import edu.srmap.campuscare.util.LocationQualityRules
import edu.srmap.campuscare.util.LocationTracking
import edu.srmap.campuscare.util.PermissionLevel
import edu.srmap.campuscare.util.RawFix
import edu.srmap.campuscare.util.ageSeconds
import edu.srmap.campuscare.util.toRawFix
import java.time.Instant
import kotlin.math.max
import kotlin.math.min
import kotlin.random.Random
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Sends live location for the sessions the user explicitly started: an active SOS and/or a
 * time-limited Live Location share (Safe Walk). A persistent notification always says who can see
 * the location; shares have a "Stop sharing" action. Nothing runs when no session is active.
 *
 * - Mode: SOS uses high accuracy every ~4 s; a share uses high accuracy every ~10 s with a 5 m
 *   distance filter (balanced power when Battery Saver is on). Updates stop the moment the last
 *   session ends.
 * - Quality: every fix goes through [LocationFilter]; implausible jumps are not sent. What is sent
 *   is the raw measured fix with its reported accuracy and its age at send time (monotonic clock),
 *   so the server can derive the true capture time and its own quality label.
 * - Delivery: a bounded in-memory queue per session, sent oldest first with exponential backoff
 *   (2 s → 60 s, with jitter). Each point carries an increasing sequence number so retries never
 *   create duplicates. 410/404/403/401 end that session; nothing retries forever.
 */
class LocationShareService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val filter = LocationFilter()
    private val lock = Mutex()
    private val wake = Channel<Unit>(Channel.CONFLATED)
    private val queue = ArrayDeque<Pending>()

    private var shareId: String? = null
    private var shareExpires: Instant? = null
    private var shareAudience: String = "security"
    private var sosId: String? = null
    private var requestedMode: Mode? = null
    private var lastSeq = 0L
    private val lastQueued = mutableMapOf<String, RawFix>()
    private var workerJob: Job? = null
    private var tickJob: Job? = null

    private enum class Mode { Sos, Share, ShareSaver }
    private data class Pending(val kind: String, val sessionId: String, val fix: RawFix, val seq: Long)

    private val callback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            // Batched results are processed in capture order so the trail stays time-ordered.
            result.locations.sortedBy { it.elapsedRealtimeNanos }.forEach { handle(it.toRawFix()) }
        }

        override fun onLocationAvailability(availability: LocationAvailability) {
            LocationTracking.update { it.copy(signalAvailable = availability.isLocationAvailable) }
        }
    }

    private val api get() = (application as CampusCareApp).container.api

    // ------------------------------------------------------------------ fixes

    @Synchronized
    private fun handle(raw: RawFix) {
        val decision = filter.offer(raw)
        if (decision !is FilterDecision.Accepted) {
            LocationTracking.update { it.copy(rejectedFixes = it.rejectedFixes + 1) }
            return
        }
        LocationTracking.update { s ->
            s.copy(raw = raw, estimate = decision.estimate, trail = (if (decision.reset) emptyList() else s.trail).plus(raw).takeLast(TRAIL_SIZE))
        }
        scope.launch {
            lock.withLock {
                sosId?.let { if (shouldQueue("sos", raw, minIntervalMs = 4_000, minMoveM = 5.0)) enqueue("sos", it, raw) }
                shareId?.let {
                    if (shareExpires?.isBefore(Instant.now()) == true) endShare(notifyServer = false)
                    else if (shouldQueue("share", raw, minIntervalMs = 12_000, minMoveM = 10.0)) enqueue("share", it, raw)
                }
            }
            wake.trySend(Unit)
        }
    }

    /** Send when enough time has passed, the person moved meaningfully, or the quality category improved. */
    private fun shouldQueue(kind: String, raw: RawFix, minIntervalMs: Long, minMoveM: Double): Boolean {
        val prev = lastQueued[kind] ?: return true
        if (raw.timeMs - prev.timeMs >= minIntervalMs) return true
        val moved = LocationFilter.distanceMeters(prev.latitude, prev.longitude, raw.latitude, raw.longitude)
        if (moved >= max(minMoveM, raw.accuracyMeters ?: 0.0)) return true
        val q = { f: RawFix -> LocationQualityRules.classify(f.accuracyMeters, 0.0, Double.MAX_VALUE).ordinal }
        return q(raw) < q(prev)
    }

    private fun enqueue(kind: String, sessionId: String, raw: RawFix) {
        lastQueued[kind] = raw
        // Increasing per device even across service restarts (tenths of a second), so the server can de-duplicate retries.
        lastSeq = max(lastSeq + 1, (System.currentTimeMillis() / 100) % 1_000_000_000)
        queue.addLast(Pending(kind, sessionId, raw, lastSeq))
        // Bounded: under a long outage keep the most recent points per session.
        while (queue.count { it.kind == kind } > MAX_QUEUE) queue.removeAt(queue.indexOfFirst { it.kind == kind })
        LocationTracking.update { it.copy(pendingUploads = queue.size) }
    }

    // ------------------------------------------------------------------ delivery

    private fun startWorker() {
        if (workerJob?.isActive == true) return
        workerJob = scope.launch {
            var backoffMs = 0L
            while (isActive) {
                if (backoffMs > 0) delay(backoffMs)
                val next = lock.withLock {
                    // Points older than 30 minutes are no use to responders any more.
                    queue.removeAll { it.fix.ageSeconds() > 1800 }
                    queue.firstOrNull()
                }
                if (next == null) {
                    LocationTracking.update { it.copy(pendingUploads = 0) }
                    backoffMs = 0
                    wake.receive()
                    continue
                }
                val quality = LocationQualityRules.classify(next.fix.accuracyMeters, next.fix.ageSeconds(), staleFor(next.kind)).name.lowercase()
                try {
                    if (next.kind == "sos") api.liveLocation.sos(next.sessionId, next.fix, next.seq, quality)
                    else api.liveLocation.share(next.sessionId, next.fix, next.seq, quality)
                    lock.withLock { queue.remove(next) }
                    backoffMs = 0
                    LocationTracking.update { it.copy(lastUploadOkAtMs = SystemClock.elapsedRealtime(), lastUploadError = null, pendingUploads = queue.size) }
                } catch (e: ApiException) {
                    when {
                        e.status == 410 || e.status == 404 || e.status == 403 || e.status == 401 -> lock.withLock {
                            // Session over (alert closed, share expired/stopped, or no longer allowed): stop it now.
                            queue.removeAll { it.kind == next.kind && it.sessionId == next.sessionId }
                            if (next.kind == "sos") endSos() else endShare(notifyServer = false)
                        }
                        e.status == 422 || e.status == 400 -> lock.withLock { queue.remove(next) } // malformed point: drop it
                        else -> {
                            backoffMs = min(MAX_BACKOFF_MS, if (backoffMs == 0L) 2_000 else backoffMs * 2) + Random.nextLong(0, 1_000)
                            LocationTracking.update { it.copy(lastUploadError = if (e.isNetwork) "Offline — will retry" else (e.message ?: "Upload failed — will retry")) }
                        }
                    }
                }
            }
        }
    }

    private fun staleFor(kind: String) = if (kind == "sos") LocationQualityRules.SOS_STALE_SECONDS else LocationQualityRules.SHARE_STALE_SECONDS

    // ------------------------------------------------------------------ lifecycle

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP_SHARE -> scope.launch { lock.withLock { endShare(notifyServer = intent.getBooleanExtra(EXTRA_NOTIFY, true)); stopIfIdle() } }
            ACTION_STOP_SOS -> scope.launch { lock.withLock { endSos(); stopIfIdle() } }
            ACTION_STOP_ALL -> scope.launch { lock.withLock { endSos(); endShare(notifyServer = false); stopIfIdle() } }
            ACTION_START_SOS -> intent.getStringExtra(EXTRA_ID)?.let { sosId = it }
            ACTION_START_SHARE, null -> {
                // null action: redelivered start intent after the system restarted the service.
                val id = intent?.getStringExtra(EXTRA_ID)
                if (id != null) {
                    shareId = id
                    shareExpires = intent.getStringExtra(EXTRA_EXPIRES)?.let { Fmt.parse(it) }
                    shareAudience = intent.getStringExtra(EXTRA_AUDIENCE) ?: "security"
                }
            }
        }
        if (intent?.action == ACTION_STOP_SHARE || intent?.action == ACTION_STOP_SOS || intent?.action == ACTION_STOP_ALL) return START_NOT_STICKY
        if (sosId == null && shareId == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        publishSessions()
        if (!goForeground()) return START_NOT_STICKY
        if (LocationPermissions.level(this) == PermissionLevel.None) {
            onPermissionLost()
            return START_NOT_STICKY
        }
        applyMode()
        startWorker()
        startTicks()
        return START_REDELIVER_INTENT
    }

    private fun publishSessions() {
        LocationTracking.update {
            it.copy(
                sosId = sosId, shareId = shareId, shareAudience = shareId?.let { shareAudience }, shareExpiresAt = shareExpires?.toString(),
                permission = LocationPermissions.level(this), locationEnabled = LocationPermissions.locationEnabled(this),
            )
        }
    }

    private fun goForeground(): Boolean {
        val n = buildNotification()
        return try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, n, if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0)
            true
        } catch (e: Exception) {
            // Permission missing or the system refused a location service right now: end sessions cleanly.
            onPermissionLost()
            false
        }
    }

    private fun buildNotification(): android.app.Notification {
        val sos = sosId
        val who = if (shareAudience == "security") "Campus Security" else "your trusted contacts"
        val b = NotificationCompat.Builder(this, Notifications.SERVICE)
            .setSmallIcon(R.drawable.ic_stat_shield)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
        if (sos != null) {
            b.setContentTitle("SOS active — sending your location")
                .setContentText("Campus Security responders see your live location until the alert is closed.")
                .setContentIntent(Notifications.contentIntent(this, "/student/emergency?alert=$sos"))
        } else {
            b.setContentTitle("Sharing your live location")
                .setContentText("Visible to $who until ${Fmt.time(shareExpires?.toString())}")
                .setContentIntent(Notifications.contentIntent(this, "/student/safe-walk"))
        }
        if (shareId != null) {
            val stop = PendingIntent.getService(
                this, 1, Intent(this, LocationShareService::class.java).setAction(ACTION_STOP_SHARE).putExtra(EXTRA_NOTIFY, true),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            b.addAction(0, "Stop sharing", stop)
        }
        return b.build()
    }

    @SuppressLint("MissingPermission")
    private fun applyMode() {
        val saver = (getSystemService(Context.POWER_SERVICE) as? PowerManager)?.isPowerSaveMode == true
        val mode = when {
            sosId != null -> Mode.Sos
            saver -> Mode.ShareSaver
            else -> Mode.Share
        }
        if (mode == requestedMode) return
        requestedMode = mode
        val request = when (mode) {
            Mode.Sos -> LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 4_000L).setMinUpdateIntervalMillis(2_000L).setMinUpdateDistanceMeters(0f)
            Mode.Share -> LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 10_000L).setMinUpdateIntervalMillis(5_000L).setMinUpdateDistanceMeters(5f)
            Mode.ShareSaver -> LocationRequest.Builder(Priority.PRIORITY_BALANCED_POWER_ACCURACY, 20_000L).setMinUpdateIntervalMillis(10_000L).setMinUpdateDistanceMeters(10f)
        }.setWaitForAccurateLocation(false).build()
        val client = LocationServices.getFusedLocationProviderClient(this)
        client.removeLocationUpdates(callback)
        runCatching { client.requestLocationUpdates(request, callback, Looper.getMainLooper()) }.onFailure { onPermissionLost() }
    }

    /** Every 10 s: permission, location switch, share expiry; once a minute: keep-alive fix when stationary. */
    private fun startTicks() {
        if (tickJob?.isActive == true) return
        tickJob = scope.launch {
            var n = 0
            while (isActive) {
                delay(10_000)
                n++
                val perm = LocationPermissions.level(this@LocationShareService)
                LocationTracking.update { it.copy(permission = perm, locationEnabled = LocationPermissions.locationEnabled(this@LocationShareService)) }
                if (perm == PermissionLevel.None) {
                    onPermissionLost()
                    continue
                }
                lock.withLock { if (shareExpires?.isBefore(Instant.now()) == true) endShare(notifyServer = false) }
                launchMain { applyMode() }
                if (n % 6 == 0) {
                    val raw = filter.lastRaw
                    // Stationary (no new fixes): take a fresh balanced fix so viewers can tell the session is alive.
                    if (raw == null || raw.ageSeconds() > 45) LocationHelper.balanced(this@LocationShareService, maxAgeMs = 15_000)?.let { f ->
                        handle(RawFix(f.latitude, f.longitude, f.accuracy, f.elapsedRealtimeNanos?.div(1_000_000) ?: SystemClock.elapsedRealtime(), provider = "fused"))
                    }
                }
            }
        }
    }

    private fun launchMain(block: () -> Unit) {
        android.os.Handler(Looper.getMainLooper()).post(block)
    }

    /** Location permission withdrawn in system settings: a share ends (no stale position left up); an SOS stays raised without location. */
    private fun onPermissionLost() {
        LocationServices.getFusedLocationProviderClient(this).removeLocationUpdates(callback)
        requestedMode = null
        LocationTracking.update { it.copy(permission = PermissionLevel.None) }
        scope.launch {
            lock.withLock {
                endShare(notifyServer = true)
                if (sosId != null) {
                    sosId = null
                    LocationTracking.update { it.copy(sosId = null) }
                }
                stopIfIdle()
            }
        }
    }

    private fun endShare(notifyServer: Boolean) {
        val id = shareId ?: return
        shareId = null
        shareExpires = null
        lastQueued.remove("share")
        queue.removeAll { it.kind == "share" }
        LocationTracking.update { it.copy(shareId = null, shareAudience = null, shareExpiresAt = null, pendingUploads = queue.size) }
        if (notifyServer) scope.launch { runCatching { api.safety.stopShare(id) } }
        stopIfIdle()
    }

    private fun endSos() {
        sosId ?: return
        sosId = null
        lastQueued.remove("sos")
        queue.removeAll { it.kind == "sos" }
        LocationTracking.update { it.copy(sosId = null, pendingUploads = queue.size) }
        stopIfIdle()
    }

    private fun stopIfIdle() {
        if (sosId != null || shareId != null) {
            launchMain {
                requestedMode = null
                applyMode()
                androidx.core.app.NotificationManagerCompat.from(this).let { nm ->
                    if (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(this, android.Manifest.permission.POST_NOTIFICATIONS) == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                        nm.notify(NOTIFICATION_ID, buildNotification())
                    }
                }
            }
            return
        }
        LocationServices.getFusedLocationProviderClient(this).removeLocationUpdates(callback)
        requestedMode = null
        filter.reset()
        LocationTracking.update { it.copy(raw = null, estimate = null, trail = emptyList(), pendingUploads = 0, lastUploadError = null) }
        launchMain {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    override fun onDestroy() {
        LocationServices.getFusedLocationProviderClient(this).removeLocationUpdates(callback)
        LocationTracking.update { it.copy(sosId = null, shareId = null, shareAudience = null, shareExpiresAt = null, pendingUploads = 0) }
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        private const val NOTIFICATION_ID = 4101
        private const val MAX_QUEUE = 40
        private const val MAX_BACKOFF_MS = 60_000L
        private const val TRAIL_SIZE = 200
        private const val EXTRA_ID = "share_id"
        private const val EXTRA_EXPIRES = "expires_at"
        private const val EXTRA_AUDIENCE = "audience"
        private const val EXTRA_NOTIFY = "notify_server"
        private const val ACTION_START_SHARE = "edu.srmap.campuscare.START_SHARE"
        private const val ACTION_STOP_SHARE = "edu.srmap.campuscare.STOP_SHARE"
        private const val ACTION_START_SOS = "edu.srmap.campuscare.START_SOS_LOCATION"
        private const val ACTION_STOP_SOS = "edu.srmap.campuscare.STOP_SOS_LOCATION"
        private const val ACTION_STOP_ALL = "edu.srmap.campuscare.STOP_ALL_LOCATION"

        /** Start (or replace) the live share the user just consented to. */
        fun start(context: Context, shareId: String, expiresAt: String, audience: String) {
            val i = Intent(context, LocationShareService::class.java).setAction(ACTION_START_SHARE)
                .putExtra(EXTRA_ID, shareId).putExtra(EXTRA_EXPIRES, expiresAt).putExtra(EXTRA_AUDIENCE, audience)
            ContextCompat.startForegroundService(context, i)
        }

        /** Send live location for the user's own active SOS until it is closed. */
        fun startSos(context: Context, alertId: String) {
            if (LocationPermissions.level(context) == PermissionLevel.None) return
            if (LocationTracking.state.value.sosId == alertId) return
            ContextCompat.startForegroundService(context, Intent(context, LocationShareService::class.java).setAction(ACTION_START_SOS).putExtra(EXTRA_ID, alertId))
        }

        /** Stop the live share locally (the caller has already told the server). An active SOS keeps sending. */
        fun stop(context: Context) {
            if (LocationTracking.state.value.shareId == null && LocationTracking.state.value.sosId == null) return
            runCatching { context.startService(Intent(context, LocationShareService::class.java).setAction(ACTION_STOP_SHARE).putExtra(EXTRA_NOTIFY, false)) }
        }

        fun stopSos(context: Context) {
            if (LocationTracking.state.value.sosId == null) return
            runCatching { context.startService(Intent(context, LocationShareService::class.java).setAction(ACTION_STOP_SOS)) }
        }

        fun stopAll(context: Context) {
            if (!LocationTracking.state.value.active) return
            runCatching { context.startService(Intent(context, LocationShareService::class.java).setAction(ACTION_STOP_ALL)) }
        }
    }
}
