package edu.srmap.campuscare.services

import android.content.Context
import android.os.Build
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import edu.srmap.campuscare.BuildConfig
import edu.srmap.campuscare.data.Api
import kotlinx.coroutines.tasks.await

/**
 * Registers this installation with the API. Push is optional: if the build has no
 * google-services.json (Firebase not configured), the device is still registered so the Super Admin
 * sees app versions, and the app relies on in-app + realtime notifications.
 */
object PushRegistrar {
    suspend fun register(context: Context, api: Api) {
        val token: String? = if (FirebaseApp.getApps(context).isNotEmpty()) {
            runCatching {
                FirebaseMessaging.getInstance().isAutoInitEnabled = true
                FirebaseMessaging.getInstance().token.await()
            }.getOrNull()
        } else null
        runCatching { api.mobile.registerDevice(token, BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE, "${Build.MANUFACTURER} ${Build.MODEL}") }
    }

    suspend fun unregister(api: Api) {
        runCatching { api.mobile.unregisterDevice() }
    }
}
