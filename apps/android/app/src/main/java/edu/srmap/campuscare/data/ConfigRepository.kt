package edu.srmap.campuscare.data

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.Json

/**
 * Remote configuration from the Super Admin website (feature switches, minimum app version,
 * banners, emergency numbers). The last good copy is cached so the emergency screen and direct
 * calling keep working when the server is unreachable ("service outage mode").
 */
class ConfigRepository(context: Context, private val api: Api, private val json: Json) {
    private val prefs = context.getSharedPreferences("cc_config", Context.MODE_PRIVATE)

    private val _config = MutableStateFlow(
        prefs.getString(KEY, null)?.let { runCatching { json.decodeFromString(MobileConfig.serializer(), it) }.getOrNull() } ?: MobileConfig(),
    )
    val config: StateFlow<MobileConfig> = _config.asStateFlow()

    private val _reachable = MutableStateFlow(true)
    /** False when the last attempt to reach the server failed (outage or no connectivity). */
    val reachable: StateFlow<Boolean> = _reachable.asStateFlow()

    val settings: PublicSettings get() = _config.value.settings

    suspend fun refresh(): MobileConfig? = try {
        val fresh = api.mobile.config()
        _config.value = fresh
        _reachable.value = true
        prefs.edit().putString(KEY, json.encodeToString(MobileConfig.serializer(), fresh)).apply()
        fresh
    } catch (e: ApiException) {
        if (e.isNetwork || e.status >= 500) _reachable.value = false
        null
    }

    fun markReachable(ok: Boolean) {
        _reachable.value = ok
    }

    /** Built-in fallback numbers, always shown in addition to the university's verified contacts. */
    val nationalEmergencyNumbers = listOf(
        EmergencyContact(id = "112", name = "Emergency (all services)", phone = "112", category = "emergency", purpose = "Police, fire and ambulance"),
        EmergencyContact(id = "181", name = "Women Helpline", phone = "181", category = "helpline", purpose = "24×7 support for women"),
        EmergencyContact(id = "108", name = "Ambulance", phone = "108", category = "medical", purpose = "Medical emergencies"),
        EmergencyContact(id = "14416", name = "Tele-MANAS", phone = "14416", category = "helpline", purpose = "Free 24×7 mental health support"),
    )

    private companion object {
        const val KEY = "mobile_config"
    }
}
