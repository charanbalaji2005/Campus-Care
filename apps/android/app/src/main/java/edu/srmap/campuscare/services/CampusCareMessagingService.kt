package edu.srmap.campuscare.services

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import edu.srmap.campuscare.CampusCareApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/** Receives optional FCM data messages and turns them into local notifications. */
class CampusCareMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        val d = message.data
        val title = d["title"] ?: return
        Notifications.show(
            context = this,
            id = (d["notificationId"] ?: title).hashCode(),
            kind = d["kind"] ?: "update",
            priority = d["priority"] ?: "normal",
            title = title,
            body = d["body"] ?: "",
            link = d["link"]?.takeIf { it.isNotBlank() },
        )
    }

    override fun onNewToken(token: String) {
        val app = application as CampusCareApp
        if (!app.container.session.isSignedIn) return
        CoroutineScope(Dispatchers.IO).launch { PushRegistrar.register(applicationContext, app.container.api) }
    }
}
