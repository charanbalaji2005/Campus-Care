package edu.srmap.campuscare.ui.screens.staff

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.automirrored.rounded.Chat
import androidx.compose.material.icons.automirrored.rounded.EventNote
import androidx.compose.material.icons.rounded.BarChart
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Campaign
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Folder
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material.icons.rounded.HourglassTop
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.School
import androidx.compose.material.icons.rounded.Spa
import androidx.compose.material.icons.rounded.Videocam
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.data.CounsellorDashboardData
import edu.srmap.campuscare.data.CounsellorUpcomingSession
import edu.srmap.campuscare.ui.components.Avatar
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.SectionHeader
import edu.srmap.campuscare.ui.components.SkeletonList
import edu.srmap.campuscare.ui.components.StatTile
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.enterStagger
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.Fmt

/**
 * Screen 1: Counsellor Dashboard
 *
 * Implements the primary landing screen matching the reference design:
 * - Personalized greeting and counsellor credentials header
 * - Notification badge indicator
 * - Inspiring emerald green banner
 * - 4 core KPI statistics tiles
 * - 8 quick action shortcut tiles
 * - Upcoming sessions list with quick "Start Session" / "View" actions
 * - Active follow-up reminders
 */
@Composable
fun CounsellorHomeScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val user by app.session.user.collectAsState()

    val dashboard = rememberLoad { app.api.counselling.dashboard() }

    LaunchedEffect(Unit) {
        app.realtime.events.collect { e ->
            if (e.name == "appointment:updated" || e.name == "counselling:request" || e.name == "notification") {
                dashboard.reload()
            }
        }
    }

    val counsellorName = user?.fullName?.ifBlank { null } ?: "Dr. Meera Sharma"
    val designation = "Counsellor · Main Campus"

    CcScreen(
        title = "${Fmt.greeting()}, $counsellorName",
        subtitle = designation,
        refreshing = dashboard.refreshing,
        onRefresh = { dashboard.reload() },
        actions = {
            val unreadCount = dashboard.data?.unreadNotifications ?: 0
            IconButton(onClick = { nav.navigate(Routes.Notifications) }) {
                BadgedBox(
                    badge = {
                        if (unreadCount > 0) {
                            Badge(containerColor = CcColors.Sos, contentColor = Color.White) {
                                Text("$unreadCount")
                            }
                        }
                    }
                ) {
                    Icon(
                        imageVector = Icons.Rounded.Notifications,
                        contentDescription = "Notifications",
                        tint = CcColors.Ink,
                    )
                }
            }
        },
    ) {
        // Motivational Emerald Banner
        MotivationalBanner()

        LoadContent(dashboard, skeleton = { SkeletonList(4) }) { data ->
            // 4 KPI Stat Tiles in 2x2 Grid
            CounsellorStatGrid(data)

            // 8 Quick Actions
            QuickActionsSection(data)

            // Upcoming Sessions Section
            UpcomingSessionsSection(data)

            // Follow-up Reminders Section
            if (data.followUpReminders.isNotEmpty()) {
                FollowUpRemindersSection(data)
            }
        }
    }
}

@Composable
private fun MotivationalBanner() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(
                Brush.horizontalGradient(
                    colors = listOf(CcColors.ForestDeep, CcColors.Forest, CcColors.Forest700)
                )
            )
            .padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .background(Color.White.copy(alpha = 0.15f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.Rounded.Spa,
                    contentDescription = null,
                    tint = CcColors.Mint,
                    modifier = Modifier.size(24.dp),
                )
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    text = "You're making a difference!",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    text = "Supporting students for a better and calmer tomorrow.",
                    style = MaterialTheme.typography.bodySmall,
                    color = CcColors.Mint.copy(alpha = 0.9f),
                )
            }
        }
    }
}

@Composable
private fun CounsellorStatGrid(data: CounsellorDashboardData) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            StatTile(
                label = "Today's Sessions",
                value = "${data.stats.todaySessions}",
                modifier = Modifier.weight(1f),
                tone = Tone.Teal,
                icon = Icons.Rounded.CalendarMonth,
            )
            StatTile(
                label = "New Requests",
                value = "${data.stats.newRequests}",
                modifier = Modifier.weight(1f),
                tone = if (data.stats.newRequests > 0) Tone.Amber else Tone.Violet,
                icon = Icons.Rounded.HourglassTop,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            StatTile(
                label = "Active Students",
                value = "${data.stats.activeStudents}",
                modifier = Modifier.weight(1f),
                tone = Tone.Violet,
                icon = Icons.Rounded.Groups,
            )
            StatTile(
                label = "Completion Rate",
                value = "${data.stats.sessionCompletion}%",
                modifier = Modifier.weight(1f),
                tone = Tone.Brand,
                icon = Icons.Rounded.CheckCircle,
            )
        }
    }
}

@Composable
private fun QuickActionsSection(data: CounsellorDashboardData) {
    val nav = LocalNav.current

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SectionHeader("Quick Actions")

        // Row 1
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            QuickActionItem(
                title = "Appointments",
                icon = Icons.Rounded.CalendarMonth,
                tone = Tone.Teal,
                modifier = Modifier.weight(1f),
                onClick = { nav.navigate(Routes.CounsellorAppointments) },
            )
            QuickActionItem(
                title = "Requests",
                icon = Icons.Rounded.HourglassTop,
                tone = Tone.Amber,
                badgeCount = data.stats.newRequests,
                modifier = Modifier.weight(1f),
                onClick = { nav.navigate(Routes.CounsellorRequests) },
            )
            QuickActionItem(
                title = "Students",
                icon = Icons.Rounded.School,
                tone = Tone.Violet,
                modifier = Modifier.weight(1f),
                onClick = { nav.navigate(Routes.CounsellorStudents) },
            )
            QuickActionItem(
                title = "Notes",
                icon = Icons.AutoMirrored.Rounded.EventNote,
                tone = Tone.Brand,
                modifier = Modifier.weight(1f),
                onClick = {
                    val targetId = data.upcomingSessions.firstOrNull()?.id ?: "latest"
                    nav.navigate(Routes.sessionNotesEditor(targetId))
                },
            )
        }

        // Row 2
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            QuickActionItem(
                title = "Cases",
                icon = Icons.Rounded.Folder,
                tone = Tone.Sky,
                modifier = Modifier.weight(1f),
                onClick = { nav.navigate(Routes.CounsellorCases) },
            )
            QuickActionItem(
                title = "Resources",
                icon = Icons.Rounded.Spa,
                tone = Tone.Teal,
                modifier = Modifier.weight(1f),
                onClick = { nav.navigate(Routes.ResourcesLibrary) },
            )
            QuickActionItem(
                title = "Announce",
                icon = Icons.Rounded.Campaign,
                tone = Tone.Violet,
                modifier = Modifier.weight(1f),
                onClick = { nav.navigate(Routes.ChannelDashboard) },
            )
            QuickActionItem(
                title = "Reports",
                icon = Icons.Rounded.BarChart,
                tone = Tone.Brand,
                modifier = Modifier.weight(1f),
                onClick = { nav.navigate(Routes.ReportsAnalytics) },
            )
        }
    }
}

@Composable
private fun QuickActionItem(
    title: String,
    icon: ImageVector,
    tone: Tone,
    modifier: Modifier = Modifier,
    badgeCount: Int = 0,
    onClick: () -> Unit,
) {
    val bg = when (tone) {
        Tone.Brand -> CcColors.Mint50
        Tone.Teal -> CcColors.TealSoft
        Tone.Violet -> CcColors.VioletSoft
        Tone.Amber -> CcColors.AmberSoft
        Tone.Sky -> CcColors.SkySoft
        Tone.Rose, Tone.Danger -> CcColors.RoseSoft
        else -> CcColors.Cream
    }
    val iconTint = when (tone) {
        Tone.Brand -> CcColors.Forest
        Tone.Teal -> CcColors.Teal
        Tone.Violet -> CcColors.Violet
        Tone.Amber -> CcColors.Amber
        Tone.Sky -> CcColors.Sky
        Tone.Rose, Tone.Danger -> CcColors.Rose
        else -> CcColors.InkSoft
    }

    CcCard(
        modifier = modifier,
        onClick = onClick,
        padding = 10.dp,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            BadgedBox(
                badge = {
                    if (badgeCount > 0) {
                        Badge(containerColor = CcColors.Amber, contentColor = Color.White) {
                            Text("$badgeCount")
                        }
                    }
                }
            ) {
                Box(
                    modifier = Modifier
                        .size(38.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(bg),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(icon, contentDescription = null, tint = iconTint, modifier = Modifier.size(20.dp))
                }
            }
            Spacer(Modifier.height(6.dp))
            Text(
                text = title,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Medium,
                color = CcColors.Ink,
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun UpcomingSessionsSection(data: CounsellorDashboardData) {
    val nav = LocalNav.current

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            SectionHeader("Upcoming Sessions")
            TextButton(onClick = { nav.navigate(Routes.CounsellorAppointments) }) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("View all", style = MaterialTheme.typography.labelMedium, color = CcColors.Forest)
                    Spacer(Modifier.width(4.dp))
                    Icon(Icons.AutoMirrored.Rounded.ArrowForward, contentDescription = null, tint = CcColors.Forest, modifier = Modifier.size(14.dp))
                }
            }
        }

        if (data.upcomingSessions.isEmpty()) {
            CcCard {
                Text(
                    text = "No sessions scheduled for today. Enjoy your downtime!",
                    style = MaterialTheme.typography.bodyMedium,
                    color = CcColors.InkSoft,
                )
            }
        } else {
            data.upcomingSessions.forEachIndexed { i, s ->
                Column(Modifier.enterStagger(i)) {
                    DashboardSessionCard(s)
                }
            }
        }
    }
}

@Composable
private fun DashboardSessionCard(s: CounsellorUpcomingSession) {
    val nav = LocalNav.current

    CcCard(
        onClick = { nav.navigate(Routes.appointment(s.id)) },
        padding = 12.dp,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Avatar(s.studentName, tone = Tone.Violet, size = 44.dp)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        text = s.studentName,
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                        color = CcColors.Ink,
                    )
                    Text(
                        text = s.studentDepartment.ifBlank { "SRM University-AP" },
                        style = MaterialTheme.typography.bodySmall,
                        color = CcColors.InkSoft,
                    )
                }
                StatusChip(Fmt.humanize(s.status), if (s.status == "confirmed") Tone.Brand else Tone.Sky, dot = true)
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = if (s.mode == "online") Icons.Rounded.Videocam else Icons.Rounded.School,
                        contentDescription = null,
                        tint = CcColors.Forest,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(
                        text = "${Fmt.dayTime(s.startAt)} · ${if (s.mode == "online") "Online Video" else "In Person"}",
                        style = MaterialTheme.typography.bodySmall,
                        fontWeight = FontWeight.Medium,
                        color = CcColors.Forest,
                    )
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (s.mode == "online") {
                    CcButton(
                        text = "Start Session",
                        onClick = { nav.navigate(Routes.onlineSession(s.id)) },
                        modifier = Modifier.weight(1.2f),
                        kind = ButtonKind.Brand,
                        leadingIcon = Icons.Rounded.Videocam,
                    )
                }
                CcButton(
                    text = "View Details",
                    onClick = { nav.navigate(Routes.appointment(s.id)) },
                    modifier = Modifier.weight(1f),
                    kind = ButtonKind.Outline,
                )
            }
        }
    }
}

@Composable
private fun FollowUpRemindersSection(data: CounsellorDashboardData) {
    val nav = LocalNav.current

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SectionHeader("Follow-Up Reminders")

        data.followUpReminders.forEach { r ->
            CcCard(
                onClick = { nav.navigate(Routes.appointment(r.appointmentId)) },
                padding = 12.dp,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier
                            .size(36.dp)
                            .clip(CircleShape)
                            .background(CcColors.AmberSoft),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.Rounded.HourglassTop, contentDescription = null, tint = CcColors.Amber, modifier = Modifier.size(18.dp))
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            text = r.studentName,
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.SemiBold,
                            color = CcColors.Ink,
                        )
                        Text(
                            text = "Follow up scheduled",
                            style = MaterialTheme.typography.bodySmall,
                            color = CcColors.InkSoft,
                        )
                    }
                    r.followUpAt?.let { StatusChip("Due ${Fmt.date(it)}", Tone.Amber) }
                }
            }
        }
    }
}
