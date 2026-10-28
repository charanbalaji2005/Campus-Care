package edu.srmap.campuscare.ui.screens.student

import android.app.StatusBarManager
import android.content.ComponentName
import android.graphics.drawable.Icon
import android.os.Build
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.R
import edu.srmap.campuscare.services.Notifications
import edu.srmap.campuscare.services.SosTileService
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.InfoBanner
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.SectionHeader
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.LocationPermissions
import edu.srmap.campuscare.util.PermissionLevel
import kotlinx.coroutines.delay

/**
 * Explains the quick ways to start an SOS, what works on this phone, and how to test safely.
 * Android does not let apps detect power-button presses, so that trigger is explained, not offered.
 */
@Composable
fun QuickSosSetupScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val context = LocalContext.current
    val config by app.config.config.collectAsState()
    val sos = config.settings.sos
    var notificationsOk by remember { mutableStateOf(Notifications.canPost(context)) }
    var location by remember { mutableStateOf(LocationPermissions.level(context)) }
    var tileMessage by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        while (true) {
            notificationsOk = Notifications.canPost(context)
            location = LocationPermissions.level(context)
            delay(2_000)
        }
    }

    CcScreen(title = "Quick SOS", subtitle = "Start an SOS in one tap", onBack = { nav.popBackStack() }) {
        if (!sos.enabled) {
            InfoBanner("In-app SOS is paused by university administration. Call Campus Security or 112.", tone = Tone.Amber, icon = Icons.Rounded.Warning)
        } else if (!sos.quickTriggerEnabled) {
            InfoBanner("Your university has set the tile and shortcut to open the SOS screen rather than start the countdown straight away.", tone = Tone.Neutral)
        }

        SectionHeader("How it works")
        CcCard {
            Text(
                "A quick trigger starts a ${sos.countdownSeconds}-second countdown (set by your university). A notification shows the time left with Cancel and Send SOS. " +
                    "When it ends, Campus Security is alerted with your location. Closing the app, locking the phone or swiping the notification away does not stop it — only Cancel does.",
                style = MaterialTheme.typography.bodyMedium,
                color = CcColors.Ink,
            )
        }

        SectionHeader("1. Quick Settings tile (recommended)")
        CcCard {
            Text(
                "Works from the notification shade, even on the lock screen. Swipe down twice, tap the pencil (Edit), and drag “Emergency SOS” into your tiles.",
                style = MaterialTheme.typography.bodyMedium,
                color = CcColors.Ink,
            )
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                Spacer(Modifier.height(10.dp))
                CcButton(
                    text = "Add the tile now",
                    onClick = {
                        val sbm = context.getSystemService(StatusBarManager::class.java)
                        sbm?.requestAddTileService(
                            ComponentName(context, SosTileService::class.java),
                            context.getString(R.string.tile_sos_label),
                            Icon.createWithResource(context, R.drawable.ic_stat_shield),
                            context.mainExecutor,
                        ) { result ->
                            tileMessage = when (result) {
                                StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ADDED -> "Tile added."
                                StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ALREADY_ADDED -> "The tile is already in your Quick Settings."
                                StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_NOT_ADDED -> "The tile was not added."
                                else -> "Add the tile by editing Quick Settings as described above."
                            }
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                    kind = ButtonKind.Outline,
                )
                tileMessage?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft) }
            }
        }

        SectionHeader("2. Home-screen shortcut")
        CcCard {
            Text(
                "Touch and hold the CampusCare icon and choose “Emergency SOS”. Drag it to your home screen for a one-tap shortcut (the phone must be unlocked).",
                style = MaterialTheme.typography.bodyMedium,
                color = CcColors.Ink,
            )
        }

        SectionHeader("What about the power button?")
        InfoBanner(
            "Android does not let apps detect power-button presses, so CampusCare cannot offer a power-button trigger. " +
                "Most phones on Android 12 or later have their own Emergency SOS: press the power button 5 times quickly to call 112 " +
                "(Settings → Safety & emergency → Emergency SOS; names vary by manufacturer). It works without CampusCare and does not alert Campus Security.",
            tone = Tone.Neutral,
            icon = Icons.Rounded.Info,
        )

        SectionHeader("This phone")
        CcCard {
            PermissionRow("Notifications", if (notificationsOk) "Allowed" else "Off — the countdown and its Cancel button cannot be shown", notificationsOk) {
                LocationPermissions.openAppSettings(context)
            }
            Spacer(Modifier.height(10.dp))
            PermissionRow(
                "Location",
                when (location) {
                    PermissionLevel.Precise -> "Precise"
                    PermissionLevel.Approximate -> "Approximate only — responders get a rough area"
                    PermissionLevel.None -> "Off — an SOS is still sent, without your location"
                },
                location == PermissionLevel.Precise,
            ) { LocationPermissions.openAppSettings(context) }
        }

        SectionHeader("Test it safely")
        CcCard {
            Text(
                "Start a countdown and tap Cancel before it ends. Nobody is alerted; the cancelled test is only recorded. " +
                    "Never let a test countdown finish — that alerts Campus Security for real.",
                style = MaterialTheme.typography.bodyMedium,
                color = CcColors.Ink,
            )
        }
        Spacer(Modifier.height(16.dp))
    }
}

@Composable
private fun PermissionRow(label: String, status: String, ok: Boolean, onFix: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
            Text(status, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
        }
        Spacer(Modifier.width(8.dp))
        if (ok) StatusChip("OK", Tone.Brand) else TextButton(onClick = onFix) { Text("Settings") }
    }
}
