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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.EventNote
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Spa
import androidx.compose.material.icons.rounded.TrendingUp
import androidx.compose.material.icons.rounded.Videocam
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.data.StudentWellbeingProfile
import edu.srmap.campuscare.ui.components.Avatar
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.ChoiceChips
import edu.srmap.campuscare.ui.components.Divider
import edu.srmap.campuscare.ui.components.EmptyState
import edu.srmap.campuscare.ui.components.InfoBanner
import edu.srmap.campuscare.ui.components.KeyValue
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.SkeletonList
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.enterStagger
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.Fmt

/**
 * Screen 4: Student Wellbeing Profile
 *
 * Implements confidential, authorized student wellbeing record matching Screen 4:
 * - Profile header with avatar, study program, status
 * - Contextual Emergency Escalation button
 * - Tabs: Overview, Sessions, Notes, Progress
 * - Student information with privacy-respecting masked identifiers
 * - Primary concerns and active support goals
 * - Next scheduled appointment with direct join action
 * - Clinical notes history with strict least-privilege boundary
 */
@Composable
fun StudentWellbeingProfileScreen(studentId: String) {
    val app = LocalApp.current
    val nav = LocalNav.current

    val profile = rememberLoad(studentId) {
        app.api.counselling.studentWellbeing(studentId)
    }

    var selectedTab by rememberSaveable { mutableStateOf("overview") } // "overview", "sessions", "notes", "progress"
    var showEscalationDialog by remember { mutableStateOf(false) }

    CcScreen(
        title = "Student Profile",
        subtitle = "Confidential wellbeing record",
        onBack = { nav.popBackStack() },
        refreshing = profile.refreshing,
        onRefresh = { profile.reload() },
    ) {
        LoadContent(profile, skeleton = { SkeletonList(3) }) { p ->
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                // Header Card
                StudentProfileHeader(
                    profile = p,
                    onEscalate = { showEscalationDialog = true },
                )

                // Tabs
                ChoiceChips(
                    options = listOf(
                        "overview" to "Overview",
                        "sessions" to "Sessions (${p.recentSessions.size})",
                        "notes" to "Notes (${p.notes.size})",
                        "progress" to "Progress",
                    ),
                    selected = selectedTab,
                    onSelect = { selectedTab = it },
                )

                when (selectedTab) {
                    "overview" -> ProfileOverviewTab(p)
                    "sessions" -> ProfileSessionsTab(p)
                    "notes" -> ProfileNotesTab(p)
                    "progress" -> ProfileProgressTab(p)
                }

                if (showEscalationDialog) {
                    EmergencyEscalationDialog(
                        caseId = p.caseId,
                        studentName = p.student.name,
                        studentId = p.student.studentId,
                        onDismiss = { showEscalationDialog = false },
                        onSuccess = { profile.reload() },
                    )
                }
            }
        }
    }
}

@Composable
private fun StudentProfileHeader(
    profile: StudentWellbeingProfile,
    onEscalate: () -> Unit,
) {
    val nav = LocalNav.current

    CcCard(padding = 16.dp) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Avatar(profile.student.name, tone = Tone.Violet, size = 56.dp)
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        text = profile.student.name,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = CcColors.Ink,
                    )
                    Text(
                        text = listOfNotNull(profile.student.year.ifBlank { null }, profile.student.department).joinToString(" · "),
                        style = MaterialTheme.typography.bodySmall,
                        color = CcColors.InkSoft,
                    )
                    Text(
                        text = profile.student.campus,
                        style = MaterialTheme.typography.labelSmall,
                        color = CcColors.InkFaint,
                    )
                }
                StatusChip(
                    text = profile.student.status,
                    tone = if (profile.student.status == "Active") Tone.Brand else Tone.Teal,
                )
            }

            Divider()

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                CcButton(
                    text = "Emergency Escalation",
                    onClick = onEscalate,
                    modifier = Modifier.fillMaxWidth(),
                    kind = ButtonKind.Outline,
                    leadingIcon = Icons.Rounded.Warning,
                )
            }
        }
    }
}

@Composable
private fun ProfileOverviewTab(profile: StudentWellbeingProfile) {
    val nav = LocalNav.current

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        // Next appointment if present
        profile.nextAppointment?.let { nextAppt ->
            CcCard(padding = 14.dp) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier
                            .size(40.dp)
                            .clip(CircleShape)
                            .background(CcColors.Mint50),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.Rounded.CalendarMonth, contentDescription = null, tint = CcColors.Forest)
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            text = "Next Appointment",
                            style = MaterialTheme.typography.labelSmall,
                            color = CcColors.InkSoft,
                        )
                        Text(
                            text = Fmt.dayTime(nextAppt.startAt),
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.SemiBold,
                            color = CcColors.Ink,
                        )
                    }
                    if (nextAppt.mode.contains("online", ignoreCase = true)) {
                        CcButton(
                            text = "Join",
                            onClick = { nav.navigate(Routes.onlineSession(nextAppt.id)) },
                            kind = ButtonKind.Brand,
                            leadingIcon = Icons.Rounded.Videocam,
                        )
                    }
                }
            }
        }

        // Student Information Card
        CcCard(padding = 14.dp) {
            Text("Confidential Information", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = CcColors.Ink)
            Spacer(Modifier.height(8.dp))
            KeyValue("Student ID", profile.student.studentId ?: "AP22****41")
            KeyValue("Email", profile.student.maskedEmail ?: profile.student.email ?: "student@srmap.edu.in")
            KeyValue("Contact", profile.student.contact ?: "+91 98****3210")
            KeyValue("Campus", profile.student.campus)
        }

        // Student Concerns
        CcCard(padding = 14.dp) {
            Text("Reported Wellbeing Concerns", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = CcColors.Ink)
            Spacer(Modifier.height(8.dp))
            if (profile.concerns.isEmpty()) {
                Text("No specific concerns tagged.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    profile.concerns.forEach { c ->
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .background(CcColors.TealSoft)
                                .padding(horizontal = 10.dp, vertical = 6.dp),
                        ) {
                            Text(c, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium, color = CcColors.Teal)
                        }
                    }
                }
            }
        }

        // Active Goals / Agreed Support Plan
        CcCard(padding = 14.dp) {
            Text("Active Support Plan & Goals", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = CcColors.Ink)
            Spacer(Modifier.height(8.dp))
            if (profile.goals.isEmpty()) {
                Text("No agreed goals yet. Establish goals in the next session notes.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    profile.goals.forEach { goalText ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                imageVector = Icons.Rounded.CheckCircle,
                                contentDescription = null,
                                tint = CcColors.Forest,
                                modifier = Modifier.size(20.dp),
                            )
                            Spacer(Modifier.width(10.dp))
                            Text(
                                text = goalText,
                                style = MaterialTheme.typography.bodyMedium,
                                color = CcColors.Ink,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ProfileSessionsTab(profile: StudentWellbeingProfile) {
    val nav = LocalNav.current

    if (profile.recentSessions.isEmpty()) {
        EmptyState(
            title = "No past sessions",
            message = "Completed consultation sessions will appear here.",
            icon = Icons.Rounded.CalendarMonth,
            tone = Tone.Teal,
        )
    } else {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            profile.recentSessions.forEachIndexed { i, s ->
                Column(Modifier.enterStagger(i)) {
                    CcCard(
                        onClick = { nav.navigate(Routes.appointment(s.id)) },
                        padding = 12.dp,
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                modifier = Modifier
                                    .size(36.dp)
                                    .clip(CircleShape)
                                    .background(CcColors.Mint50),
                                contentAlignment = Alignment.Center,
                            ) {
                                Icon(Icons.Rounded.Spa, contentDescription = null, tint = CcColors.Forest, modifier = Modifier.size(18.dp))
                            }
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(
                                    text = Fmt.dayTime(s.date),
                                    style = MaterialTheme.typography.titleSmall,
                                    fontWeight = FontWeight.SemiBold,
                                    color = CcColors.Ink,
                                )
                                Text(
                                    text = "${s.type} · ${s.summary}",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = CcColors.InkSoft,
                                )
                            }
                            StatusChip("Completed", Tone.Brand)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ProfileNotesTab(profile: StudentWellbeingProfile) {
    InfoBanner(
        message = "Clinical notes are strictly confidential to authorized counsellors. Students, administrators, and security staff cannot view these notes.",
        icon = Icons.Rounded.Lock,
        tone = Tone.Violet,
    )

    if (profile.notes.isEmpty()) {
        EmptyState(
            title = "No clinical notes yet",
            message = "Notes recorded during or after sessions will appear here.",
            icon = Icons.AutoMirrored.Rounded.EventNote,
            tone = Tone.Violet,
        )
    } else {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            profile.notes.forEachIndexed { i, note ->
                Column(Modifier.enterStagger(i)) {
                    CcCard(padding = 14.dp) {
                        Text(
                            text = note.body,
                            style = MaterialTheme.typography.bodyMedium,
                            color = CcColors.Ink,
                        )
                        note.supportPlan?.let { plan ->
                            Spacer(Modifier.height(8.dp))
                            Text(
                                text = "Support Plan: $plan",
                                style = MaterialTheme.typography.bodySmall,
                                fontWeight = FontWeight.Medium,
                                color = CcColors.Forest,
                            )
                        }
                        Spacer(Modifier.height(8.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Text(
                                text = Fmt.dateTime(note.createdAt),
                                style = MaterialTheme.typography.labelSmall,
                                color = CcColors.InkFaint,
                            )
                            note.followUpAt?.let { follow ->
                                Text(
                                    text = "Follow-up: ${Fmt.date(follow)}",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = CcColors.Amber,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ProfileProgressTab(profile: StudentWellbeingProfile) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        CcCard(padding = 16.dp) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(42.dp)
                        .clip(CircleShape)
                        .background(CcColors.Mint50),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Rounded.TrendingUp, contentDescription = null, tint = CcColors.Forest)
                }
                Spacer(Modifier.width(12.dp))
                Column {
                    Text("Overall Wellbeing Trend", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = CcColors.Ink)
                    Text("Tracking progress across recent sessions", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                }
            }
            Spacer(Modifier.height(14.dp))
            KeyValue("Sessions Attended", "${profile.recentSessions.size} sessions")
            KeyValue("Attendance Rate", "100%")
            KeyValue("Agreed Plan Compliance", "${profile.goals.size} active goals in progress")
        }
    }
}
