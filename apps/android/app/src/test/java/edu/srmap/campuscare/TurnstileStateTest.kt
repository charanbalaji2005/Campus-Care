package edu.srmap.campuscare

import edu.srmap.campuscare.ui.components.TurnstilePhase
import edu.srmap.campuscare.ui.components.TurnstileState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Token lifecycle of the background (inline) Turnstile widget. The server still verifies every token. */
class TurnstileStateTest {
    private var now = 1_000L
    private fun state(enabled: Boolean = true) = TurnstileState(enabled, "login", "https://api.example/mobile/turnstile?action=login") { now }.apply { inline = true }

    @Test
    fun aTokenReadyBeforeSubmitIsUsedImmediatelyAndOnlyOnce() {
        val s = state()
        s.complete("tok-1")
        assertEquals(TurnstilePhase.Ready, s.phase)
        val got = mutableListOf<String?>()
        s.run { got += it }
        assertEquals(listOf<String?>("tok-1"), got)
        assertNull(s.pending)
        // Single use: the next attempt (e.g. after a wrong password) waits for a new token.
        assertEquals(1, s.resetRequests)
        s.run { got += it }
        assertTrue(s.pending != null)
        assertEquals(1, got.size)
        s.complete("tok-2")
        assertEquals(listOf<String?>("tok-1", "tok-2"), got)
    }

    @Test
    fun submitBeforeVerificationFinishesWaitsInsteadOfSendingNothing() {
        val s = state()
        val got = mutableListOf<String?>()
        s.run { got += it }
        assertTrue(got.isEmpty())
        s.complete("tok")
        assertEquals(listOf<String?>("tok"), got)
    }

    @Test
    fun doubleTapSubmitsOnce() {
        val s = state()
        var calls = 0
        s.run { calls++ }
        s.run { calls++ }
        s.complete("tok")
        assertEquals(1, calls)
    }

    @Test
    fun aTokenNearCloudflaresFiveMinuteLimitIsNotUsed() {
        val s = state()
        s.complete("old")
        now += TurnstileState.TOKEN_MAX_AGE_MS + 1
        val got = mutableListOf<String?>()
        s.run { got += it }
        assertTrue(got.isEmpty())
        assertEquals(1, s.resetRequests)
        s.complete("fresh")
        assertEquals(listOf<String?>("fresh"), got)
    }

    @Test
    fun expiryAndFailureDropTheToken() {
        val s = state()
        s.complete("tok")
        s.expired()
        assertEquals(TurnstilePhase.Refreshing, s.phase)
        val got = mutableListOf<String?>()
        s.run { got += it }
        assertTrue(got.isEmpty())
        s.failed("Unable to reach the verification service.")
        assertEquals(TurnstilePhase.Failed, s.phase)
        s.complete("after-retry")
        assertEquals(listOf<String?>("after-retry"), got)
    }

    @Test
    fun disabledTurnstileRunsImmediatelyWithoutAToken() {
        val got = mutableListOf<String?>()
        state(enabled = false).run { got += it }
        assertEquals(listOf<String?>(null), got)
    }
}
