package edu.srmap.campuscare.services

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.service.quicksettings.TileService
import edu.srmap.campuscare.CampusCareApp
import edu.srmap.campuscare.MainActivity

/**
 * Quick Settings tile for Emergency SOS. Works from the notification shade, including on the lock
 * screen. When the Super Admin allows quick triggers and the person is signed in, a tap starts the
 * SOS countdown straight away (notification with Cancel / Send SOS) without unlocking or opening the
 * app. Otherwise, or if Android refuses to start the countdown from here, it opens the SOS screen.
 */
class SosTileService : TileService() {
    override fun onClick() {
        super.onClick()
        val app = application as CampusCareApp
        val quick = app.container.config.config.value.settings.sos.let { it.enabled && it.quickTriggerEnabled }
        if (quick && app.container.session.isSignedIn && SosCountdownService.start(this, source = "quick_tile")) return
        open()
    }

    private fun open() {
        val intent = Intent(this, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = Uri.parse("campuscare://student/emergency?source=quick_tile")
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startActivityAndCollapse(PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(intent)
        }
    }
}
