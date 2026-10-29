package edu.srmap.campuscare.ui.screens.staff

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Logout
import androidx.compose.material.icons.rounded.Gavel
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.Security
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
import edu.srmap.campuscare.ui.components.SectionHeader
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.navigation.rememberSignOut
import edu.srmap.campuscare.ui.theme.CcColors

/**
 * Screen 8: Committee Member Profile & Settings (Part B)
 */
@Composable
fun CommitteeProfileScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val user by app.session.user.collectAsState()
    val signOut = rememberSignOut()

    val memberName = user?.fullName?.ifBlank { null } ?: "Dr. Priya Nair"

    CcScreen(title = "Profile & Settings") {
        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
            // Member Profile Card
            CcCard(modifier = Modifier.fillMaxWidth()) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Avatar(name = memberName, size = 60.dp)
                    Column {
                        Text(
                            text = memberName,
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                            color = CcColors.Ink,
                        )
                        Text(
                            text = "Committee Member • Main Campus",
                            style = MaterialTheme.typography.bodyMedium,
                            color = CcColors.InkSoft,
                        )
                        Spacer(Modifier.height(4.dp))
                        StatusChip(
                            text = "AUTHORIZED MEMBER",
                            tone = Tone.Violet,
                        )
                    }
                }
            }

            // Committee Assignments Card
            SectionHeader("Active Committee Roles")
            CcCard(modifier = Modifier.fillMaxWidth()) {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    CommitteeInfoRow(label = "Internal Complaints Committee (ICC)", value = "Voting Member")
                    CommitteeInfoRow(label = "Anti-Ragging Committee", value = "Inquiry Officer")
                    CommitteeInfoRow(label = "Member ID", value = "#COM-2024-42")
                    CommitteeInfoRow(label = "Statutory Jurisdiction", value = "All SRM Campuses")
                }
            }

            // Confidentiality Card
            CcCard(modifier = Modifier.fillMaxWidth()) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        text = "Statutory Confidentiality Policy",
                        fontWeight = FontWeight.Bold,
                        style = MaterialTheme.typography.titleSmall,
                        color = CcColors.Ink,
                    )
                    Text(
                        text = "All committee proceedings, evidence files, and identity records of complainants and respondents are protected under university bylaws and Indian legal privacy mandates.",
                        style = MaterialTheme.typography.bodySmall,
                        color = CcColors.InkSoft,
                    )
                }
            }

            // Account Settings
            SectionHeader("Account & Security")
            CcCard(modifier = Modifier.fillMaxWidth()) {
                Column {
                    ListRow(
                        title = "Notification Preferences",
                        subtitle = "Alert sounds and case updates",
                        icon = Icons.Rounded.Notifications,
                        tone = Tone.Amber,
                        onClick = { nav.navigate(Routes.NotificationPrefs) },
                    )
                    ListRow(
                        title = "Privacy & Logs",
                        subtitle = "Auditable review session records",
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
private fun CommitteeInfoRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text = label, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
        Text(text = value, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold, color = CcColors.Ink)
    }
}

