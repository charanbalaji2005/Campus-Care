package edu.srmap.campuscare

import android.content.Context
import coil.ImageLoader
import edu.srmap.campuscare.data.Api
import edu.srmap.campuscare.data.ApiClient
import edu.srmap.campuscare.data.ConfigRepository
import edu.srmap.campuscare.data.Realtime
import edu.srmap.campuscare.data.SecureStore
import edu.srmap.campuscare.data.SessionStore
import edu.srmap.campuscare.services.DutyController
import edu.srmap.campuscare.services.ServiceDutyDevice
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.json.Json

data class A11yPrefs(val reduceMotion: Boolean = false, val largeText: Boolean = false, val haptics: Boolean = true)

/** Manual dependency container (kept simple on purpose — no annotation processing). */
class AppContainer(context: Context) {
    val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        coerceInputValues = true
        isLenient = true
    }
    val secureStore = SecureStore(context)
    val session = SessionStore(secureStore, json)
    val client = ApiClient(BuildConfig.API_BASE_URL, session, json)
    val api = Api(client)
    val config = ConfigRepository(context, api, json)
    val realtime = Realtime(api, config)
    /** Responder duty status as the server last confirmed it; shared by every screen and the duty service. */
    val duty = DutyController(api.duty, ServiceDutyDevice(context.applicationContext))
    val prefs = context.getSharedPreferences("cc_prefs", Context.MODE_PRIVATE)

    /** Coil uses the API's OkHttp client so private images load with the bearer token. */
    val imageLoader: ImageLoader = ImageLoader.Builder(context)
        .okHttpClient(client.http)
        .crossfade(true)
        .build()

    /** In-app accessibility preferences (stored on the device only). */
    val a11y = MutableStateFlow(
        A11yPrefs(
            reduceMotion = prefs.getBoolean("a11y_reduce_motion", false),
            largeText = prefs.getBoolean("a11y_large_text", false),
            haptics = prefs.getBoolean("a11y_haptics", true),
        ),
    )

    fun setA11y(value: A11yPrefs) {
        a11y.value = value
        prefs.edit()
            .putBoolean("a11y_reduce_motion", value.reduceMotion)
            .putBoolean("a11y_large_text", value.largeText)
            .putBoolean("a11y_haptics", value.haptics)
            .apply()
    }

    var onboardingSeen: Boolean
        get() = prefs.getBoolean("onboarding_seen", false)
        set(value) = prefs.edit().putBoolean("onboarding_seen", value).apply()

    var rememberedEmail: String?
        get() = prefs.getString("remembered_email", null)
        set(value) = prefs.edit().apply {
            if (value.isNullOrBlank()) remove("remembered_email") else putString("remembered_email", value.trim().lowercase())
        }.apply()
}

