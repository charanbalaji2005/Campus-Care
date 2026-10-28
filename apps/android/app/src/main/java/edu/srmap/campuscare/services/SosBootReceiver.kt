package edu.srmap.campuscare.services

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * After a reboot, re-offers an SOS countdown that was interrupted before it reached the server.
 * Alerts the server already holds are dispatched by the server and need nothing here.
 */
class SosBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) SosCountdownService.reconcile(context)
    }
}
