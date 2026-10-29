package edu.srmap.campuscare.ui.screens.staff

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Logout
import androidx.compose.material.icons.rounded.Badge
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.Security
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import edu.srmap.campuscare.ui.components.Avatar
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.ListRow
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.SectionHeader
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.navigation.rememberSignOut
import edu.srmap.campuscare.ui.theme.CcColors
import kotlinx.coroutines.launch

/**
 * Screen 8: Security Officer Profile & Settings (Part A)
 */
@Composable
fun SecurityProfileScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val user by app.session.user.collectAsState()
    val dutyState by app.duty.state.collectAsState()
    val signOut = rememberSignOut()

    val officerName = user?.fullName?.ifBlank { null } ?: "Officer Kumar"

    CcScreen(title = "Profile & Settings") {
        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
            // Profile Card
            CcCard(modifier = Modifier.fillMaxWidth()) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Avatar(name = officerName, size = 60.dp)
                    Column {
                        Text(
                            text = officerName,
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                            color = CcColors.Ink,
                        )
                        Text(
                            text = "Security Officer • Main Campus",
                            style = MaterialTheme.typography.bodyMedium,
                            color = CcColors.InkSoft,
                        )
                        Spacer(Modifier.height(4.dp))
                        StatusChip(
                            text = if (dutyState.onDuty) "ON DUTY" else "OFF DUTY",
                            tone = if (dutyState.onDuty) Tone.Brand else Tone.Neutral,
                        )
                    }
                }
            }

            // Duty Status Toggle
            CcCard(modifier = Modifier.fillMaxWidth()) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column {
                        Text(
                            text = "Responder Duty Status",
                            fontWeight = FontWeight.Bold,
                            fontSize = 14.sp,
                            color = CcColors.Ink,
                        )
                        Text(
                            text = if (dutyState.onDuty) "You are actively receiving SOS dispatches" else "You are not receiving new dispatches",
                            style = MaterialTheme.typography.bodySmall,
                            color = CcColors.InkSoft,
                        )
                    }

                    Switch(
                        checked = dutyState.onDuty,
                        onCheckedChange = { newDuty ->
                            scope.launch {
                                try {
                                    app.duty.setOnDuty(newDuty, reason = if (newDuty) "Officer active" else "Officer off duty")
                                    snack.show(if (newDuty) "Switched to ON DUTY" else "Switched to OFF DUTY")
                                } catch (e: Exception) {
                                    snack.show(e.message ?: "Failed to change duty status")
                                }
                            }
                        },
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = Color.White,
                            checkedTrackColor = CcColors.Emerald,
                            uncheckedThumbColor = Color.White,
                            uncheckedTrackColor = CcColors.InkFaint.copy(alpha = 0.4f),
                        ),
                    )
                }
            }

            // Credentials Card
            SectionHeader("Security Credentials")
            CcCard(modifier = Modifier.fillMaxWidth()) {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    CredentialField(label = "Officer ID", value = "#SEC-2024-89")
                    CredentialField(label = "Campus Zone", value = user?.campusZone ?: "Main Campus")
                    CredentialField(label = "Primary Radio Channel", value = "Control Room (Ch 1)")
                    CredentialField(label = "Shift", value = "Day Shift (09:00 AM - 05:00 PM)")
                }
            }

            // Quick Actions & Settings
            SectionHeader("Account Settings")
            CcCard(modifier = Modifier.fillMaxWidth()) {
                Column {
                    ListRow(
                        title = "Notification Preferences",
                        subtitle = "Alert sounds, vibrations and push priority",
                        icon = Icons.Rounded.Notifications,
                        tone = Tone.Amber,
                        onClick = { nav.navigate(Routes.NotificationPrefs) },
                    )
                    ListRow(
                        title = "Privacy & Location Sharing",
                        subtitle = "Responder location broadcast settings",
                        icon = Icons.Rounded.Lock,
                        tone = Tone.Sky,
                        onClick = { nav.navigate(Routes.Privacy) },
                    )
                    ListRow(
                        title = "Security & MFA",
                        subtitle = "Password, authenticator app and security logs",
                        icon = Icons.Rounded.Security,
                        tone = Tone.Brand,
                        onClick = { nav.navigate(Routes.Security) },
                    )
                }
            }

            // Sign Out Button
            CcButton(
                text = "Sign Out",
                onClick = signOut,
                leadingIcon = Icons.AutoMirrored.Rounded.Logout,
                kind = ButtonKind.Outline,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun CredentialField(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text = label, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
        Text(text = value, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold, color = CcColors.Ink)
    }
}
