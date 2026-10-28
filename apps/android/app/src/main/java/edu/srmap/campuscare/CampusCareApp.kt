package edu.srmap.campuscare

import android.app.Application
import edu.srmap.campuscare.services.Notifications
import edu.srmap.campuscare.services.SosCountdownService
import org.osmdroid.config.Configuration

class CampusCareApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        Notifications.createChannels(this)
        // An SOS countdown interrupted before it reached the server is offered again, never sent silently.
        SosCountdownService.reconcile(this)
        // OpenStreetMap tile policy requires an identifying user agent.
        Configuration.getInstance().userAgentValue = "CampusCare-Android/${BuildConfig.VERSION_NAME}"
        Configuration.getInstance().osmdroidBasePath = cacheDir
    }
}
