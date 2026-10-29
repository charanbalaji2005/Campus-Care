package edu.srmap.campuscare.ui.screens.staff

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.EventNote
import androidx.compose.material.icons.automirrored.rounded.Help
import androidx.compose.material.icons.automirrored.rounded.Logout
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.Schedule
import androidx.compose.material.icons.rounded.Verified
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.ui.components.Avatar
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.Divider
import edu.srmap.campuscare.ui.components.ListRow
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.SectionHeader
import edu.srmap.campuscare.ui.components.SwitchRow
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.navigation.rememberSignOut
import edu.srmap.campuscare.ui.theme.CcColors
import kotlinx.coroutines.launch

/**
 * Screen 11: Counsellor Profile & Settings
 *
 * Implements professional profile & settings matching Screen 11:
 * - Counsellor verified credential card
 * - Instant Availability toggle (Accepting student bookings / On leave)
 * - Navigation to Profile editing, Working Hours, Templates, Notification Preferences, Privacy & Sign Out
 */
@Composable
fun CounsellorProfileSettingsScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val user by app.session.user.collectAsState()
    val signOut = rememberSignOut()

    val availabilityLoad = rememberLoad { app.api.counselling.availability() }

    var acceptingBookings by remember(availabilityLoad.data) {
        mutableStateOf(availabilityLoad.data?.acceptingRequests ?: true)
    }

    var showSignOutConfirm by remember { mutableStateOf(false) }
    var showTemplatesDialog by remember { mutableStateOf(false) }
    var showProtocolsDialog by remember { mutableStateOf(false) }

    fun toggleAccepting(newState: Boolean) {
        acceptingBookings = newState
        scope.launch {
            try {
                val current = availabilityLoad.data ?: return@launch
                val updated = current.copy(acceptingRequests = newState)
                app.api.counselling.saveAvailability(updated)
                availabilityLoad.set(updated)
                snack.show(if (newState) "Now accepting new student bookings." else "Booking status set to paused / on leave.")
            } catch (e: ApiException) {
                acceptingBookings = !newState
                snack.error(e)
            }
        }
    }

    val counsellorName = user?.fullName?.ifBlank { null } ?: "Dr. Meera Sharma"

    CcScreen(
        title = "Profile & Settings",
        subtitle = "Professional credentials and preferences",
        onBack = { nav.popBackStack() },
        refreshing = availabilityLoad.refreshing,
        onRefresh = { availabilityLoad.reload() },
    ) {
        // Profile Header Card
        CcCard(padding = 16.dp) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Avatar(counsellorName, tone = Tone.Brand, size = 56.dp)
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                text = counsellorName,
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold,
                                color = CcColors.Ink,
                            )
                            Spacer(Modifier.width(6.dp))
                            Icon(
                                imageVector = Icons.Rounded.Verified,
                                contentDescription = "Verified Staff",
                                tint = CcColors.Forest,
                                modifier = Modifier.size(18.dp),
                            )
                        }
                        Text(
                            text = "Licensed Senior Counsellor · PhD Clinical Psychology",
                            style = MaterialTheme.typography.bodySmall,
                            color = CcColors.InkSoft,
                        )
                        Text(
                            text = "SRM University-AP · Main Campus",
                            style = MaterialTheme.typography.labelSmall,
                            color = CcColors.InkFaint,
                        )
                    }
                }

                Divider()

                SwitchRow(
                    title = "Accepting New Student Bookings",
                    checked = acceptingBookings,
                    onCheckedChange = { toggleAccepting(it) },
                    description = "When toggled off, students cannot book new consultation slots.",
                )
            }
        }

        // Section: Clinical Profile & Hours
        SectionHeader("Clinical Profile & Schedule")
        CcCard(padding = 8.dp) {
            ListRow(
                title = "Edit Clinical Profile",
                subtitle = "Bio, specialisations, languages, and consultation modes",
                icon = Icons.Rounded.Person,
                tone = Tone.Teal,
                onClick = { nav.navigate(Routes.Availability) },
            )
            Divider()
            ListRow(
                title = "Working Hours & Schedule",
                subtitle = "Weekly slots, buffer time, duration, and time-off",
                icon = Icons.Rounded.Schedule,
                tone = Tone.Violet,
                onClick = { nav.navigate(Routes.MySchedule) },
            )
        }

        // Section: Clinical Tools & Protocols
        SectionHeader("Clinical Tools & Protocols")
        CcCard(padding = 8.dp) {
            ListRow(
                title = "Session Note Templates",
                subtitle = "Pre-configured templates for intake and crisis notes",
                icon = Icons.AutoMirrored.Rounded.EventNote,
                tone = Tone.Brand,
                onClick = { showTemplatesDialog = true },
            )
            Divider()
            ListRow(
                title = "Emergency Escalation Protocols",
                subtitle = "Authorized responder routing and crisis escalation rules",
                icon = Icons.Rounded.Warning,
                tone = Tone.Rose,
                onClick = { showProtocolsDialog = true },
            )
        }

        // Section: Preferences & Compliance
        SectionHeader("Preferences & Security")
        CcCard(padding = 8.dp) {
            ListRow(
                title = "Notification Preferences",
                subtitle = "Session reminders, student requests, and chat alerts",
                icon = Icons.Rounded.Notifications,
                tone = Tone.Sky,
                onClick = { nav.navigate(Routes.NotificationPrefs) },
            )
            Divider()
            ListRow(
                title = "Privacy & Confidentiality Policy",
                subtitle = "Protected health record and student data policy",
                icon = Icons.Rounded.Lock,
                tone = Tone.Teal,
                onClick = { nav.navigate(Routes.Privacy) },
            )
        }

        // Section: Help & Account
        SectionHeader("Support & Session")
        CcCard(padding = 8.dp) {
            ListRow(
                title = "Help & Campus Directory",
                subtitle = "Emergency contacts and support helpline",
                icon = Icons.AutoMirrored.Rounded.Help,
                tone = Tone.Brand,
                onClick = { snack.show("Campus Help Directory: +91 863 234 3000") },
            )
            Divider()
            ListRow(
                title = "Sign Out",
                subtitle = "Safely end your counsellor session",
                icon = Icons.AutoMirrored.Rounded.Logout,
                tone = Tone.Rose,
                onClick = { showSignOutConfirm = true },
            )
        }
    }

    // Sign out confirmation dialog
    if (showSignOutConfirm) {
        AlertDialog(
            onDismissRequest = { showSignOutConfirm = false },
            title = { Text("Sign Out of CampusCare") },
            text = { Text("Are you sure you want to sign out of your counsellor session?") },
            confirmButton = {
                CcButton(
                    text = "Sign Out",
                    onClick = {
                        showSignOutConfirm = false
                        signOut()
                    },
                    kind = ButtonKind.Brand,
                )
            },
            dismissButton = {
                TextButton(onClick = { showSignOutConfirm = false }) { Text("Cancel") }
            },
        )
    }

    // Note Templates Dialog
    if (showTemplatesDialog) {
        AlertDialog(
            onDismissRequest = { showTemplatesDialog = false },
            title = { Text("Session Note Templates") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Standardized clinical documentation formats:", style = MaterialTheme.typography.bodyMedium)
                    CcCard(padding = 10.dp) {
                        Text("SOAP Intake Note", fontWeight = FontWeight.Bold)
                        Text("Subjective, Objective, Assessment, Plan structured documentation.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                    }
                    CcCard(padding = 10.dp) {
                        Text("Crisis Safety Intervention", fontWeight = FontWeight.Bold)
                        Text("Documenting immediate safety risk, coping plan, and support contacts.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showTemplatesDialog = false }) { Text("Close") }
            },
        )
    }

    // Protocols Dialog
    if (showProtocolsDialog) {
        AlertDialog(
            onDismissRequest = { showProtocolsDialog = false },
            title = { Text("Emergency Escalation Protocols") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "In situations of immediate self-harm or physical threat, use the Emergency Escalation workflow located directly inside the active session, student profile, or case card.",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Text(
                        "Escalations automatically dispatch to: Control Room, Duty Security Officer, and Medical First Responders with full incident auditing.",
                        style = MaterialTheme.typography.bodySmall,
                        color = CcColors.InkSoft,
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = { showProtocolsDialog = false }) { Text("Got it") }
            },
        )
    }
}
