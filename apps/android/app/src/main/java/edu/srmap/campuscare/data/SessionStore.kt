package edu.srmap.campuscare.data

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.Json

/**
 * Central session manager for the CampusCare Android application.
 * Manages Keystore-encrypted bearer credentials, Remember Me persistence across app restarts,
 * 7-day inactivity auto-logout policy, cold-start restoration, and explicit logout.
 */
class SessionStore(private val store: KeyValueStore, private val json: Json) {
    private val _user = MutableStateFlow(store.get(KEY_USER)?.let { runCatching { json.decodeFromString(User.serializer(), it) }.getOrNull() })
    val user: StateFlow<User?> = _user.asStateFlow()

    private val _events = MutableSharedFlow<SessionEvent>(extraBufferCapacity = 4)
    val events: SharedFlow<SessionEvent> = _events.asSharedFlow()

    @Volatile
    var token: String? = store.get(KEY_TOKEN)
        private set

    val isSignedIn: Boolean get() = token != null

    val isRemembered: Boolean get() = store.get(KEY_REMEMBER_ME) == "true"

    val lastAppOpenTimestamp: Long get() = store.get(KEY_LAST_APP_OPEN)?.toLongOrNull() ?: 0L

    init {
        // Cold start verification: if a session exists locally, enforce Remember Me & 7-day inactivity policies
        if (token != null) {
            checkColdStartSessionPolicy()
        }
    }

    /**
     * Cold-start session policy evaluation:
     * 1. If Remember Me is unchecked: do NOT restore the session across app process restarts.
     * 2. If Remember Me is checked: verify that seven consecutive days have not elapsed since
     *    the last qualifying app opening. If 7 days or more have elapsed, auto-logout.
     * 3. Clock tamper check: if current time is more than 1 hour behind last recorded open, invalidate.
     * 4. If valid, update the qualifying app open timestamp.
     *
     * Returns true if session remains active, false if cleared.
     */
    fun checkColdStartSessionPolicy(currentTime: Long = System.currentTimeMillis()): Boolean {
        if (token == null) return false
        val remembered = store.get(KEY_REMEMBER_ME) == "true"
        if (!remembered) {
            // Remember Me was unchecked: clear session on cold start / app restart
            clear(SessionEvent.SignedOut)
            return false
        }
        val lastOpen = lastAppOpenTimestamp
        // Check for backwards clock manipulation (> 1 hour drift)
        if (lastOpen > 0L && currentTime < lastOpen - CLOCK_SKEW_TOLERANCE_MS) {
            clear(SessionEvent.Expired)
            return false
        }
        // 7-day inactivity check: 7 full days or more without opening the app requires login again
        if (lastOpen > 0L && (currentTime - lastOpen) >= SEVEN_DAYS_MS) {
            clear(SessionEvent.Expired)
            return false
        }
        // Session is valid and remembered: record qualifying cold-start app open
        recordAppOpen(currentTime)
        return true
    }

    /**
     * Signs in the user with optional Remember Me persistence.
     * When rememberMe is false, the session is kept for the current process only, and cleared on cold start.
     */
    fun signIn(token: String, user: User, rememberMe: Boolean = true) {
        this.token = token
        store.put(KEY_TOKEN, token)
        store.put(KEY_REMEMBER_ME, rememberMe.toString())
        val now = System.currentTimeMillis()
        store.put(KEY_LAST_APP_OPEN, now.toString())
        updateUser(user)
    }

    /**
     * Updates the last successful app-open timestamp when the user actively opens the app
     * and the session is valid. Background services, silent pushes, or tiles MUST NOT call this.
     */
    fun recordAppOpen(currentTime: Long = System.currentTimeMillis()) {
        if (isSignedIn) {
            store.put(KEY_LAST_APP_OPEN, currentTime.toString())
        }
    }

    fun updateUser(user: User) {
        _user.value = user
        store.put(KEY_USER, json.encodeToString(User.serializer(), user))
    }

    /**
     * Clears local session credentials securely from Keystore-backed storage.
     * Prevents duplicate event emissions if already cleared.
     */
    fun clear(reason: SessionEvent? = null) {
        val wasSignedIn = token != null || _user.value != null
        token = null
        _user.value = null
        store.put(KEY_TOKEN, null)
        store.put(KEY_USER, null)
        store.put(KEY_REMEMBER_ME, null)
        store.put(KEY_LAST_APP_OPEN, null)
        if (wasSignedIn && reason != null) {
            _events.tryEmit(reason)
        }
    }

    companion object {
        const val KEY_TOKEN = "token"
        const val KEY_USER = "user"
        const val KEY_REMEMBER_ME = "remember_me"
        const val KEY_LAST_APP_OPEN = "last_app_open"
        const val SEVEN_DAYS_MS = 7L * 24 * 60 * 60 * 1000L // 604,800,000 ms
        const val CLOCK_SKEW_TOLERANCE_MS = 3600_000L // 1 hour tolerance for device clock drift
    }
}

enum class SessionEvent { Expired, SignedOut, MfaRequired, MfaEnrollmentRequired }
