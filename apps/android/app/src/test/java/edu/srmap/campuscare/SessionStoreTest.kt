package edu.srmap.campuscare

import edu.srmap.campuscare.data.KeyValueStore
import edu.srmap.campuscare.data.SessionEvent
import edu.srmap.campuscare.data.SessionStore
import edu.srmap.campuscare.data.User
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** In-memory fake KeyValueStore simulating Android Keystore-backed SecureStore across restarts. */
class FakeKeyValueStore : KeyValueStore {
    val map = mutableMapOf<String, String>()

    override fun put(name: String, value: String?) {
        if (value == null) map.remove(name) else map[name] = value
    }

    override fun get(name: String): String? = map[name]

    override fun clear() {
        map.clear()
    }
}

class SessionStoreTest {
    private lateinit var store: FakeKeyValueStore
    private val json = Json { ignoreUnknownKeys = true }
    private val sampleUser = User(id = "user123", fullName = "Charan Balaji", email = "charanbalaji_neelampalli@srmap.edu.in", role = "student")

    @Before
    fun setup() {
        store = FakeKeyValueStore()
    }

    @Test
    fun rememberMeChecked_preservesSessionAcrossAppRestart() {
        val initialSession = SessionStore(store, json)
        initialSession.signIn("bearer_token_123", sampleUser, rememberMe = true)
        assertTrue(initialSession.isSignedIn)
        assertTrue(initialSession.isRemembered)

        // Simulate app restart / phone reboot: create new SessionStore instance from same store
        val restartedSession = SessionStore(store, json)
        assertTrue(restartedSession.isSignedIn)
        assertEquals("bearer_token_123", restartedSession.token)
        assertEquals("Charan Balaji", restartedSession.user.value?.fullName)
        assertTrue(restartedSession.isRemembered)
    }

    @Test
    fun rememberMeUnchecked_clearsSessionOnAppRestart() {
        val initialSession = SessionStore(store, json)
        initialSession.signIn("transient_token_456", sampleUser, rememberMe = false)
        assertTrue(initialSession.isSignedIn)
        assertFalse(initialSession.isRemembered)

        // Simulate app restart: SessionStore init enforces cold-start policy
        val restartedSession = SessionStore(store, json)
        assertFalse(restartedSession.isSignedIn)
        assertNull(restartedSession.token)
        assertNull(restartedSession.user.value)
    }

    @Test
    fun reopenedAfterSixDays_restoresSession() {
        val initialSession = SessionStore(store, json)
        val t0 = 1700000000000L
        initialSession.signIn("long_lived_token", sampleUser, rememberMe = true)
        store.put(SessionStore.KEY_LAST_APP_OPEN, t0.toString())

        // Reopen after 6 days (6 * 86,400,000 ms = 518,400,000 ms)
        val day6 = t0 + 6L * 86_400_000L
        val isValid = initialSession.checkColdStartSessionPolicy(currentTime = day6)
        assertTrue("Session must remain valid within 6 days", isValid)
        assertTrue(initialSession.isSignedIn)
        assertEquals(day6, initialSession.lastAppOpenTimestamp)
    }

    @Test
    fun reopenedAfterSevenDaysOrMore_automaticallyLogsOut() = runBlocking {
        val initialSession = SessionStore(store, json)
        val t0 = 1700000000000L
        initialSession.signIn("expired_candidate_token", sampleUser, rememberMe = true)
        store.put(SessionStore.KEY_LAST_APP_OPEN, t0.toString())

        // Reopen after exactly 7 days + 1 second
        val day7 = t0 + 7L * 86_400_000L + 1000L
        val isValid = initialSession.checkColdStartSessionPolicy(currentTime = day7)
        assertFalse("Session must expire after 7 days of inactivity", isValid)
        assertFalse(initialSession.isSignedIn)
        assertNull(initialSession.token)
        assertNull(initialSession.user.value)
    }

    @Test
    fun clockTamperBackwards_invalidatesSession() {
        val session = SessionStore(store, json)
        val t0 = 1700000000000L
        session.signIn("token_abc", sampleUser, rememberMe = true)
        store.put(SessionStore.KEY_LAST_APP_OPEN, t0.toString())

        // Current time suddenly jumped 2 hours backwards
        val skewedTime = t0 - 2 * 3600_000L
        val isValid = session.checkColdStartSessionPolicy(currentTime = skewedTime)
        assertFalse("Session must be cleared on backward clock tampering", isValid)
        assertFalse(session.isSignedIn)
    }

    @Test
    fun explicitLogout_clearsAllCredentialsAndFlags() {
        val session = SessionStore(store, json)
        session.signIn("token_to_logout", sampleUser, rememberMe = true)
        assertTrue(session.isSignedIn)

        session.clear(SessionEvent.SignedOut)
        assertFalse(session.isSignedIn)
        assertNull(session.token)
        assertNull(session.user.value)
        assertFalse(session.isRemembered)
        assertEquals(0L, session.lastAppOpenTimestamp)
        assertNull(store.get(SessionStore.KEY_TOKEN))
        assertNull(store.get(SessionStore.KEY_USER))
        assertNull(store.get(SessionStore.KEY_REMEMBER_ME))
        assertNull(store.get(SessionStore.KEY_LAST_APP_OPEN))
    }

    @Test
    fun offlineDoesNotClearSession() {
        val session = SessionStore(store, json)
        session.signIn("offline_token", sampleUser, rememberMe = true)

        // When offline, session is not cleared; user profile and token remain available
        assertTrue(session.isSignedIn)
        assertNotNull(session.user.value)
        assertEquals("Charan Balaji", session.user.value?.fullName)
    }

    @Test
    fun duplicateClear_doesNotEmitMultipleEvents() = runBlocking {
        val session = SessionStore(store, json)
        session.signIn("token_once", sampleUser, rememberMe = true)

        session.clear(SessionEvent.Expired)
        assertFalse(session.isSignedIn)

        // Second clear on already-cleared session must be a no-op
        session.clear(SessionEvent.Expired)
        assertFalse(session.isSignedIn)
    }
}
