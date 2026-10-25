package edu.srmap.campuscare

import android.app.Application
import edu.srmap.campuscare.services.Notifications
import org.osmdroid.config.Configuration

class CampusCareApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        Notifications.createChannels(this)
        // OpenStreetMap tile policy requires an identifying user agent.
        Configuration.getInstance().userAgentValue = "CampusCare-Android/${BuildConfig.VERSION_NAME}"
        Configuration.getInstance().osmdroidBasePath = cacheDir
    }
}
