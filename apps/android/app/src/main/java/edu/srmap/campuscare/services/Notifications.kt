package edu.srmap.campuscare.services

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import edu.srmap.campuscare.MainActivity
import edu.srmap.campuscare.R

/** Notification channels by urgency, so people can tune them in system settings. */
object Notifications {
    const val EMERGENCY = "emergency"
    const val SAFETY = "safety"
    const val UPDATES = "updates"
    const val MESSAGES = "messages"
    const val SERVICE = "service"

    fun createChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannels(
            listOf(
                NotificationChannel(EMERGENCY, context.getString(R.string.channel_emergency), NotificationManager.IMPORTANCE_HIGH).apply {
                    description = context.getString(R.string.channel_emergency_desc)
                    enableVibration(true)
                    vibrationPattern = longArrayOf(0, 600, 250, 600, 250, 600)
                    lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE
                },
                NotificationChannel(SAFETY, context.getString(R.string.channel_safety), NotificationManager.IMPORTANCE_HIGH).apply {
                    description = context.getString(R.string.channel_safety_desc)
                },
                NotificationChannel(UPDATES, context.getString(R.string.channel_updates), NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = context.getString(R.string.channel_updates_desc)
                },
                NotificationChannel(MESSAGES, context.getString(R.string.channel_messages), NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = context.getString(R.string.channel_messages_desc)
                },
                NotificationChannel(SERVICE, context.getString(R.string.channel_service), NotificationManager.IMPORTANCE_LOW).apply {
                    description = context.getString(R.string.channel_service_desc)
                },
            ),
        )
    }

    fun channelFor(kind: String, priority: String): String = when {
        priority == "critical" || kind == "sos" -> EMERGENCY
        kind in setOf("safe_walk", "check_in", "campus_alert", "location") -> SAFETY
        kind in setOf("chat_message", "case_message", "support_thread") -> MESSAGES
        else -> UPDATES
    }

    fun contentIntent(context: Context, link: String?): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = Uri.parse("campuscare://open").buildUpon().appendQueryParameter("link", link ?: "/").build()
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        return PendingIntent.getActivity(context, (link ?: "").hashCode(), intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    fun canPost(context: Context): Boolean =
        Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    /** Shows a notification. Text is already privacy-safe (the server never puts case content in titles). */
    fun show(context: Context, id: Int, kind: String, priority: String, title: String, body: String, link: String?) {
        if (!canPost(context)) return
        val channel = channelFor(kind, priority)
        val n = NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_stat_shield)
            .setColor(if (channel == EMERGENCY) 0xFFDC2626.toInt() else 0xFF064E3B.toInt())
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(contentIntent(context, link))
            .setPriority(if (channel == EMERGENCY || channel == SAFETY) NotificationCompat.PRIORITY_MAX else NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(if (channel == EMERGENCY) NotificationCompat.CATEGORY_ALARM else NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(id, n)
        } catch (e: SecurityException) {
            // Permission revoked between the check and the call.
        }
    }
}
