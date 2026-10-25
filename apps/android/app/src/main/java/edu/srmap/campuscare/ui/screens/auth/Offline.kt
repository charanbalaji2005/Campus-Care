package edu.srmap.campuscare.ui.screens.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CloudOff
import androidx.compose.material.icons.rounded.Sms
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.Divider
import edu.srmap.campuscare.ui.components.EmergencyCallRow
import edu.srmap.campuscare.ui.components.InfoBanner
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.SectionHeader
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.util.LocationHelper
import edu.srmap.campuscare.util.composeSms
import kotlinx.coroutines.launch

/**
 * Works without signing in and without the server: shows the cached university emergency
 * numbers (last copy from the Super Admin's configuration) plus national numbers, with direct
 * dialling and an SMS fallback the person sends themselves.
 */
@Composable
fun OfflineEmergencyScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val context = LocalContext.current
    val config by app.config.config.collectAsState()
    val reachable by app.config.reachable.collectAsState()
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { app.config.refresh() }

    val campus = config.emergencyContacts.filter { !it.phone.isNullOrBlank() }
    CcScreen(
        title = "Emergency help",
        subtitle = "Calling works even when CampusCare is offline",
        onBack = { nav.popBackStack() },
    ) {
        InfoBanner(
            "If you are in immediate danger, call now. Your phone's dialer opens with the number filled in.",
            tone = Tone.Danger, icon = Icons.Rounded.Warning, title = "In danger right now?",
        )
        if (!reachable) {
            InfoBanner("CampusCare can't reach the server right now. These numbers are saved on your phone.", tone = Tone.Amber, icon = Icons.Rounded.CloudOff)
        }
        if (campus.isNotEmpty()) {
            SectionHeader("${config.settings.universityName} emergency contacts")
            CcCard {
                campus.forEachIndexed { i, c ->
                    if (i > 0) Divider()
                    EmergencyCallRow(c)
                }
            }
        }
        SectionHeader("National helplines")
        CcCard {
            app.config.nationalEmergencyNumbers.forEachIndexed { i, c ->
                if (i > 0) Divider()
                EmergencyCallRow(c)
            }
        }
        SectionHeader("Send a text instead")
        CcCard {
            Text("Opens your messaging app with a pre-written message (including your location if available). You choose who to send it to.")
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                CcButton(
                    "Compose SMS",
                    {
                        val primary = campus.firstOrNull { it.category == "security" || it.category == "emergency" }?.phone
                        scope.launch {
                            // Location is best-effort (short timeout); the message never waits long for it.
                            val fix = LocationHelper.current(context, timeoutMs = 3_000)
                            val loc = fix?.let { " My location: https://maps.google.com/?q=${it.latitude},${it.longitude}" } ?: ""
                            context.composeSms(listOfNotNull(primary), "I need help. This is an emergency. Please call me back.$loc")
                        }
                    },
                    kind = ButtonKind.Outline,
                    leadingIcon = Icons.Rounded.Sms,
                )
            }
        }
    }
}
