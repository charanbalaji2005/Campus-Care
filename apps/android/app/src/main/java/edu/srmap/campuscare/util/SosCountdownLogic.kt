package edu.srmap.campuscare.util

import kotlinx.serialization.Serializable
import kotlin.math.min

/** Where one quick-trigger SOS countdown on this phone stands. */
@Serializable
enum class SosCountdownState { Counting, Sent, Cancelled, Undelivered }

/**
 * One SOS countdown, persisted so it survives process death and reboots. Times are wall-clock epoch
 * milliseconds because they must outlive a restart. [deadlineMs] starts as a local estimate and is
 * replaced by the server's dispatch time (converted to this phone's clock) once the server holds the
 * countdown. [eventId] is also the server idempotency key, so retries never create a second alert.
 * Plain Kotlin (no Android types) so the rules can be unit-tested on the JVM.
 */
@Serializable
data class SosCountdownEvent(
    val eventId: String,
    val source: String,
    val startedAtMs: Long,
    val deadlineMs: Long,
    val countdownSeconds: Int,
    val notifyTrusted: Boolean = true,
    /** Set once the server accepted the event: it then holds the countdown and dispatches on its own. */
    val alertId: String? = null,
    val state: SosCountdownState = SosCountdownState.Counting,
    val sendNowRequested: Boolean = false,
    val sendNowDelivered: Boolean = false,
    val cancelledAtMs: Long? = null,
    val attempts: Int = 0,
    /** First time a send was due but could not reach the server (start of the retry window). */
    val firstFailureAtMs: Long? = null,
    val lastError: String? = null,
) {
    val active: Boolean get() = state == SosCountdownState.Counting

    fun secondsLeft(nowMs: Long): Int = ((deadlineMs - nowMs + 999) / 1000).toInt().coerceAtLeast(0)

    /** The alert must go out now: the countdown ended or the person tapped Send SOS. */
    fun due(nowMs: Long): Boolean = sendNowRequested || nowMs >= deadlineMs
}

/** What to do with a saved countdown when the app starts again after its process ended. */
enum class SosRecovery {
    /** Finished, cancelled or too old: nothing to do. */
    None,

    /** The server already holds this alert and dispatches it by itself: just show its status. */
    ServerHolds,

    /** It never reached the server and nobody cancelled it: ask the person (never send silently later). */
    AskToSend,
}

object SosCountdownRules {
    const val MIN_SECONDS = 3
    const val MAX_SECONDS = 30
    const val DEFAULT_SECONDS = 10

    /** How long after a send fell due the phone keeps retrying before it reports "not delivered". */
    const val RETRY_WINDOW_MS = 120_000L

    /** An undelivered countdown older than this is not offered for sending after a restart. */
    const val RECOVERY_WINDOW_MS = 30 * 60_000L

    /** Same bounds the server enforces; a missing or corrupt cached value falls back to the default. */
    fun countdownSeconds(configured: Int?): Int = (configured ?: DEFAULT_SECONDS).coerceIn(MIN_SECONDS, MAX_SECONDS)

    /**
     * Starts a countdown. A trigger while one is already counting (repeated tile taps, a shortcut
     * after the tile) joins the running countdown instead of creating a second alert.
     */
    fun start(existing: SosCountdownEvent?, nowMs: Long, configuredSeconds: Int?, source: String, eventId: String, notifyTrusted: Boolean): Pair<SosCountdownEvent, Boolean> {
        if (existing != null && existing.active) return existing to false
        val seconds = countdownSeconds(configuredSeconds)
        return SosCountdownEvent(
            eventId = eventId,
            source = source,
            startedAtMs = nowMs,
            deadlineMs = nowMs + seconds * 1000L,
            countdownSeconds = seconds,
            notifyTrusted = notifyTrusted,
        ) to true
    }

    /** Cancel affects only a countdown still running. A sent alert is never silently retracted. */
    fun cancel(e: SosCountdownEvent, nowMs: Long): SosCountdownEvent =
        if (e.active) e.copy(state = SosCountdownState.Cancelled, cancelledAtMs = nowMs) else e

    fun requestSendNow(e: SosCountdownEvent): SosCountdownEvent = if (e.active) e.copy(sendNowRequested = true) else e

    /** A fresh attempt after "not delivered" (the person tapped Send SOS / Retry). */
    fun retry(e: SosCountdownEvent, nowMs: Long): SosCountdownEvent =
        if (e.state == SosCountdownState.Undelivered) e.copy(state = SosCountdownState.Counting, sendNowRequested = true, attempts = 0, firstFailureAtMs = null, lastError = null, deadlineMs = nowMs) else e

    /** The server accepted the event and runs the countdown; its deadline wins over the local estimate. */
    fun accepted(e: SosCountdownEvent, alertId: String, serverDeadlineMs: Long?): SosCountdownEvent =
        e.copy(alertId = alertId, deadlineMs = serverDeadlineMs ?: e.deadlineMs, attempts = 0, firstFailureAtMs = null, lastError = null)

    fun sent(e: SosCountdownEvent): SosCountdownEvent = if (e.state == SosCountdownState.Cancelled) e else e.copy(state = SosCountdownState.Sent, lastError = null)

    /** A failed network attempt; after [RETRY_WINDOW_MS] of failing while due, it is reported as not delivered. */
    fun failedAttempt(e: SosCountdownEvent, nowMs: Long, error: String): SosCountdownEvent {
        val firstFailure = if (e.due(nowMs)) e.firstFailureAtMs ?: nowMs else null
        val next = e.copy(attempts = e.attempts + 1, firstFailureAtMs = firstFailure, lastError = error)
        return if (firstFailure != null && nowMs - firstFailure >= RETRY_WINDOW_MS) next.copy(state = SosCountdownState.Undelivered) else next
    }

    /** The server refused for a reason retrying cannot fix (SOS paused, signed out). */
    fun undelivered(e: SosCountdownEvent, error: String): SosCountdownEvent = e.copy(state = SosCountdownState.Undelivered, lastError = error)

    /** 2 s, 4 s, 8 s … capped at 15 s, so a dropped connection is retried promptly. */
    fun retryDelayMs(attempts: Int): Long = min(15_000L, 2_000L shl (attempts - 1).coerceIn(0, 4))

    fun recover(e: SosCountdownEvent?, nowMs: Long): SosRecovery = when {
        e == null -> SosRecovery.None
        e.state == SosCountdownState.Sent || e.state == SosCountdownState.Cancelled -> SosRecovery.None
        e.alertId != null && e.state == SosCountdownState.Counting -> SosRecovery.ServerHolds
        nowMs - e.startedAtMs > RECOVERY_WINDOW_MS -> SosRecovery.None
        else -> SosRecovery.AskToSend
    }
}
