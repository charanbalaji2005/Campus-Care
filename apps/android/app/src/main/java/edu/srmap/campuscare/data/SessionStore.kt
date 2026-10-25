package edu.srmap.campuscare.data

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.Json

/** Holds the signed-in user and bearer token. The token is only ever stored encrypted. */
class SessionStore(private val store: SecureStore, private val json: Json) {
    private val _user = MutableStateFlow(store.get(KEY_USER)?.let { runCatching { json.decodeFromString(User.serializer(), it) }.getOrNull() })
    val user: StateFlow<User?> = _user.asStateFlow()

    private val _events = MutableSharedFlow<SessionEvent>(extraBufferCapacity = 4)
    val events: SharedFlow<SessionEvent> = _events.asSharedFlow()

    @Volatile
    var token: String? = store.get(KEY_TOKEN)
        private set

    val isSignedIn: Boolean get() = token != null

    fun signIn(token: String, user: User) {
        this.token = token
        store.put(KEY_TOKEN, token)
        updateUser(user)
    }

    fun updateUser(user: User) {
        _user.value = user
        store.put(KEY_USER, json.encodeToString(User.serializer(), user))
    }

    /** Called on sign-out or when the server says the session is no longer valid. */
    fun clear(reason: SessionEvent? = null) {
        token = null
        _user.value = null
        store.put(KEY_TOKEN, null)
        store.put(KEY_USER, null)
        if (reason != null) _events.tryEmit(reason)
    }

    private companion object {
        const val KEY_TOKEN = "token"
        const val KEY_USER = "user"
    }
}

enum class SessionEvent { Expired, SignedOut, MfaRequired, MfaEnrollmentRequired }
