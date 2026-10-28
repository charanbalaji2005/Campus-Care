package edu.srmap.campuscare

import edu.srmap.campuscare.util.SosCountdownEvent
import edu.srmap.campuscare.util.SosCountdownRules
import edu.srmap.campuscare.util.SosCountdownState
import edu.srmap.campuscare.util.SosRecovery
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/** Rules of the quick-trigger SOS countdown (pure logic; the server holds the real deadline once reached). */
class SosCountdownRulesTest {
    private val t0 = 1_700_000_000_000L
    private fun started(seconds: Int? = 10) = SosCountdownRules.start(null, t0, seconds, "quick_tile", "e-1", notifyTrusted = true).first

    @Test
    fun usesTheConfiguredDurationWithinTheServerBounds() {
        assertEquals(10, started(10).countdownSeconds)
        assertEquals(t0 + 15_000, started(15).deadlineMs)
        assertEquals(3, started(1).countdownSeconds)
        assertEquals(30, started(90).countdownSeconds)
        assertEquals(SosCountdownRules.DEFAULT_SECONDS, started(null).countdownSeconds) // never fetched yet
    }

    @Test
    fun repeatedTriggersJoinTheRunningCountdown() {
        val first = started()
        val (again, isNew) = SosCountdownRules.start(first, t0 + 400, 10, "shortcut", "e-2", true)
        assertFalse(isNew)
        assertSame(first, again)
        // Once it is over, a new trigger is a new event.
        val (next, isNew2) = SosCountdownRules.start(SosCountdownRules.cancel(first, t0 + 1_000), t0 + 2_000, 10, "in_app", "e-3", true)
        assertTrue(isNew2)
        assertEquals("e-3", next.eventId)
    }

    @Test
    fun countsDownAndFallsDueAtTheDeadlineOrOnSendNow() {
        val e = started()
        assertEquals(10, e.secondsLeft(t0))
        assertEquals(1, e.secondsLeft(t0 + 9_001))
        assertFalse(e.due(t0 + 9_999))
        assertTrue(e.due(t0 + 10_000))
        assertTrue(SosCountdownRules.requestSendNow(e).due(t0 + 1))
    }

    @Test
    fun theServerDeadlineReplacesTheLocalEstimate() {
        val e = SosCountdownRules.accepted(started(), "alert-1", t0 + 10_800)
        assertEquals("alert-1", e.alertId)
        assertEquals(t0 + 10_800, e.deadlineMs)
    }

    @Test
    fun cancelStopsOnlyARunningCountdownAndNeverRetractsASentAlert() {
        val cancelled = SosCountdownRules.cancel(started(), t0 + 3_000)
        assertEquals(SosCountdownState.Cancelled, cancelled.state)
        assertEquals(t0 + 3_000, cancelled.cancelledAtMs)
        val sent = SosCountdownRules.sent(SosCountdownRules.accepted(started(), "a", null))
        assertSame(sent, SosCountdownRules.cancel(sent, t0 + 20_000))
        assertEquals(SosCountdownState.Sent, sent.state)
        // A late "sent" never overrides a cancel that already happened.
        assertEquals(SosCountdownState.Cancelled, SosCountdownRules.sent(cancelled).state)
    }

    @Test
    fun offlineRetriesForAWindowThenReportsNotDelivered() {
        var e = started()
        // Before the deadline, failures are retried without starting the "not delivered" clock.
        e = SosCountdownRules.failedAttempt(e, t0 + 2_000, "Network unreachable")
        assertEquals(null, e.firstFailureAtMs)
        assertTrue(e.active)
        e = SosCountdownRules.failedAttempt(e, t0 + 10_000, "Network unreachable")
        assertEquals(t0 + 10_000, e.firstFailureAtMs)
        e = SosCountdownRules.failedAttempt(e, t0 + 10_000 + SosCountdownRules.RETRY_WINDOW_MS - 1, "Network unreachable")
        assertTrue(e.active)
        e = SosCountdownRules.failedAttempt(e, t0 + 10_000 + SosCountdownRules.RETRY_WINDOW_MS, "Network unreachable")
        assertEquals(SosCountdownState.Undelivered, e.state)
        // Retry from the notification sends at once, same event id (server idempotency key).
        val retry = SosCountdownRules.retry(e, t0 + 200_000)
        assertTrue(retry.active)
        assertTrue(retry.due(t0 + 200_000))
        assertEquals("e-1", retry.eventId)
        assertEquals(listOf(2_000L, 4_000L, 8_000L, 15_000L, 15_000L), (1..5).map { SosCountdownRules.retryDelayMs(it) })
    }

    @Test
    fun recoveryAfterRestartNeverSendsSilently() {
        assertEquals(SosRecovery.None, SosCountdownRules.recover(null, t0))
        // Server holds it: it dispatches without the phone.
        assertEquals(SosRecovery.ServerHolds, SosCountdownRules.recover(SosCountdownRules.accepted(started(), "a", null), t0 + 60_000))
        // Never reached the server and never cancelled: ask the person.
        assertEquals(SosRecovery.AskToSend, SosCountdownRules.recover(started(), t0 + 60_000))
        assertEquals(SosRecovery.None, SosCountdownRules.recover(started(), t0 + SosCountdownRules.RECOVERY_WINDOW_MS + 1))
        assertEquals(SosRecovery.None, SosCountdownRules.recover(SosCountdownRules.cancel(started(), t0 + 1), t0 + 60_000))
    }

    @Test
    fun theSavedEventSurvivesSerialisation() {
        val e = SosCountdownRules.accepted(SosCountdownRules.requestSendNow(started()), "alert-9", t0 + 9_000)
        val json = Json { ignoreUnknownKeys = true }
        assertEquals(e, json.decodeFromString(SosCountdownEvent.serializer(), json.encodeToString(SosCountdownEvent.serializer(), e)))
    }
}
