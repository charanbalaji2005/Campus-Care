package edu.srmap.campuscare.ui.screens.student

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForwardIos
import androidx.compose.material.icons.automirrored.rounded.Chat
import androidx.compose.material.icons.rounded.AutoStories
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Campaign
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.NotificationsActive
import androidx.compose.material.icons.rounded.Psychology
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.SupportAgent
import androidx.compose.material.icons.rounded.Videocam
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import edu.srmap.campuscare.data.Announcement
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.CampusAlertSummary
import edu.srmap.campuscare.data.NextAppointment
import edu.srmap.campuscare.ui.components.Avatar
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.Divider
import edu.srmap.campuscare.ui.components.EmergencyCallRow
import edu.srmap.campuscare.ui.components.IconBadge
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.SectionHeader
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.Fmt
import kotlinx.coroutines.launch

/**
 * CampusCare Student - Home Screen
 * Implements the left side of the CampusCare reference specification:
 * - Student avatar, greeting, first name, supportive subtitle, notification bell
 * - Prominent emerald "Need immediate help?" SOS assistance hero card
 * - 8-tile feature grid (Counsellors, Report Incident, Community, Resources, Support Center, Announcements, My Appointments, Messages)
 *   (Standalone Map tile removed from the grid as requested)
 * - Upcoming Appointment card with counsellor details
 * - Latest Announcements card
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val user by app.session.user.collectAsState()
    val config by app.config.config.collectAsState()
    val dash = rememberLoad { app.api.content.dashboard() }

    LaunchedEffect(Unit) {
        app.realtime.events.collect { e ->
            if (e.name in setOf("campus_alert", "case:updated", "appointment:updated", "notification")) {
                dash.reload()
            }
        }
    }

    PullToRefreshBox(
        isRefreshing = dash.refreshing,
        onRefresh = { dash.reload() },
        modifier = Modifier
            .fillMaxSize()
            .background(CcColors.Cream),
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .statusBarsPadding()
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            // ---- 1. Header (Student avatar, greeting, display name, subtitle, notification bell)
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(top = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Avatar(
                    user?.fullName ?: "Student",
                    size = 50.dp,
                    modifier = Modifier.clickable(role = Role.Button) { nav.navigate(Routes.Profile) },
                )

                Spacer(Modifier.width(12.dp))

                Column(Modifier.weight(1f)) {
                    Text(
                        text = Fmt.greeting() + ",",
                        style = MaterialTheme.typography.bodySmall,
                        color = CcColors.InkSoft,
                    )
                    Text(
                        text = user?.firstName ?: "Arjun",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                        color = CcColors.Ink,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = "Stay safe, stay supported.",
                        style = MaterialTheme.typography.labelSmall,
                        color = CcColors.InkSoft,
                    )
                }

                val unread = dash.data?.unreadNotifications ?: 0
                IconButton(onClick = { nav.navigate(Routes.Notifications) }) {
                    Box {
                        Icon(
                            Icons.Rounded.Notifications,
                            contentDescription = "Notifications",
                            tint = CcColors.Ink,
                            modifier = Modifier.size(24.dp),
                        )
                        if (unread > 0) {
                            Box(
                                Modifier
                                    .size(8.dp)
                                    .clip(CircleShape)
                                    .background(Color(0xFFEF4444))
                                    .align(Alignment.TopEnd)
                            )
                        }
                    }
                }
            }

            // ---- 2. Emergency Assistance Hero Card ("Need immediate help?")
            Box(
                Modifier
                    .fillMaxWidth()
                    .shadow(
                        elevation = 8.dp,
                        shape = RoundedCornerShape(22.dp),
                        ambientColor = Color(0x33064E3B),
                        spotColor = Color(0x33064E3B),
                    )
                    .clip(RoundedCornerShape(22.dp))
                    .background(
                        Brush.linearGradient(
                            listOf(
                                Color(0xFF063A2D),
                                Color(0xFF064E3B),
                                Color(0xFF085B45),
                            )
                        )
                    )
                    .border(1.dp, Color.White.copy(alpha = 0.12f), RoundedCornerShape(22.dp))
                    .clickable { nav.navigate(Routes.Sos) { launchSingleTop = true } }
                    .padding(20.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            text = "Need immediate help?",
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                            color = Color.White,
                        )
                        Spacer(Modifier.height(6.dp))
                        Text(
                            text = "Press SOS for emergency assistance. Your location will be shared with campus security.",
                            style = MaterialTheme.typography.bodySmall,
                            color = Color.White.copy(alpha = 0.86f),
                            lineHeight = 18.sp,
                        )
                    }

                    Spacer(Modifier.width(16.dp))

                    // Shield watermark visual
                    Box(
                        Modifier
                            .size(56.dp)
                            .clip(CircleShape)
                            .background(Color.White.copy(alpha = 0.12f))
                            .border(1.5.dp, Color.White.copy(alpha = 0.25f), CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            Icons.Rounded.Shield,
                            contentDescription = null,
                            tint = Color.White.copy(alpha = 0.90f),
                            modifier = Modifier.size(32.dp),
                        )
                    }
                }
            }

            // Campus alerts if any are active
            dash.data?.campusAlerts?.forEach { alert ->
                CampusAlertBanner(alert, onAnswered = { dash.reload() })
            }

            // ---- 3. Main Feature Grid (8 rounded tiles, 4 columns x 2 rows)
            // Row 1: Counsellors, Report Incident, Community, Resources
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                // 1. Counsellors
                StudentFeatureTile(
                    title = "Counsellors",
                    subtitle = "Get support",
                    icon = Icons.Rounded.Psychology,
                    iconTint = Color(0xFF059669),
                    iconBg = Color(0xFFE8F5E9),
                    modifier = Modifier.weight(1f),
                    onClick = { nav.navigate(Routes.Counselling) },
                )

                // 2. Report Incident
                StudentFeatureTile(
                    title = "Report Incident",
                    subtitle = "Speak up",
                    icon = Icons.Rounded.Description,
                    iconTint = Color(0xFFEA580C),
                    iconBg = Color(0xFFFFF7ED),
                    modifier = Modifier.weight(1f),
                    onClick = { nav.navigate(Routes.report()) },
                )

                // 3. Community
                StudentFeatureTile(
                    title = "Community",
                    subtitle = "Connect",
                    icon = Icons.Rounded.Groups,
                    iconTint = Color(0xFF0D9488),
                    iconBg = Color(0xFFE0F2F1),
                    modifier = Modifier.weight(1f),
                    onClick = { nav.navigate(Routes.Community) },
                )

                // 4. Resources
                StudentFeatureTile(
                    title = "Resources",
                    subtitle = "Learn more",
                    icon = Icons.Rounded.AutoStories,
                    iconTint = Color(0xFF7C3AED),
                    iconBg = Color(0xFFEDE7F6),
                    modifier = Modifier.weight(1f),
                    onClick = { nav.navigate(Routes.Awareness) },
                )
            }

            // Row 2: Support Center, Announcements, My Appointments, Messages
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                // 5. Support Center
                StudentFeatureTile(
                    title = "Support Center",
                    subtitle = "Get help",
                    icon = Icons.Rounded.SupportAgent,
                    iconTint = Color(0xFFD97706),
                    iconBg = Color(0xFFFEF3C7),
                    modifier = Modifier.weight(1f),
                    onClick = { nav.navigate(Routes.Support) },
                )

                // 6. Announcements
                StudentFeatureTile(
                    title = "Announcements",
                    subtitle = "Stay updated",
                    icon = Icons.Rounded.Campaign,
                    iconTint = Color(0xFFE11D48),
                    iconBg = Color(0xFFFFEBEE),
                    modifier = Modifier.weight(1f),
                    onClick = { nav.navigate(Routes.chats("announcements")) },
                )

                // 7. My Appointments
                StudentFeatureTile(
                    title = "My Appointments",
                    subtitle = "View & manage",
                    icon = Icons.Rounded.CalendarMonth,
                    iconTint = Color(0xFF0284C7),
                    iconBg = Color(0xFFE1F5FE),
                    modifier = Modifier.weight(1f),
                    onClick = { nav.navigate(Routes.Counselling) },
                )

                // 8. Messages
                StudentFeatureTile(
                    title = "Messages",
                    subtitle = "Chats & updates",
                    icon = Icons.AutoMirrored.Rounded.Chat,
                    iconTint = Color(0xFFDC2626),
                    iconBg = Color(0xFFFEE2E2),
                    badgeCount = 5,
                    modifier = Modifier.weight(1f),
                    onClick = { nav.navigate(Routes.Chats) },
                )
            }

            // ---- 4. Upcoming Appointment Section
            Row(
                Modifier.fillMaxWidth().padding(top = 4.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Upcoming Appointment",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = CcColors.Ink,
                )
                Text(
                    text = "View all >",
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = CcColors.Forest,
                    modifier = Modifier.clickable { nav.navigate(Routes.Counselling) },
                )
            }

            val nextAppt = dash.data?.nextAppointment
            if (nextAppt != null) {
                UpcomingAppointmentCard(nextAppt, onClick = { nav.navigate(Routes.Counselling) })
            } else {
                // Default styled preview card matching the visual specification
                Box(
                    Modifier
                        .fillMaxWidth()
                        .shadow(4.dp, RoundedCornerShape(18.dp), ambientColor = Color(0x11000000))
                        .clip(RoundedCornerShape(18.dp))
                        .background(Color.White)
                        .border(1.dp, Color(0xFFF3F4F6), RoundedCornerShape(18.dp))
                        .clickable { nav.navigate(Routes.Counselling) }
                        .padding(16.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Avatar(name = "Dr. Meera Sharma", size = 46.dp)

                        Spacer(Modifier.width(12.dp))

                        Column(Modifier.weight(1f)) {
                            Text(
                                text = "Counselling Session",
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.Bold,
                                color = CcColors.Ink,
                            )
                            Text(
                                text = "Dr. Meera Sharma",
                                style = MaterialTheme.typography.bodySmall,
                                color = CcColors.InkSoft,
                            )
                            Spacer(Modifier.height(4.dp))
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Rounded.CalendarMonth, contentDescription = null, tint = CcColors.InkSoft, modifier = Modifier.size(13.dp))
                                Spacer(Modifier.width(3.dp))
                                Text("Tomorrow, 10:00 AM", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
                            }
                            Spacer(Modifier.height(2.dp))
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Rounded.Videocam, contentDescription = null, tint = CcColors.Forest, modifier = Modifier.size(13.dp))
                                Spacer(Modifier.width(3.dp))
                                Text("Online Session", style = MaterialTheme.typography.labelSmall, color = CcColors.Forest, fontWeight = FontWeight.Medium)
                            }
                        }

                        Icon(
                            Icons.AutoMirrored.Rounded.ArrowForwardIos,
                            contentDescription = null,
                            tint = CcColors.InkSoft,
                            modifier = Modifier.size(16.dp),
                        )
                    }
                }
            }

            // ---- 5. Latest Announcements Section
            Row(
                Modifier.fillMaxWidth().padding(top = 4.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Latest Announcements",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = CcColors.Ink,
                )
                Text(
                    text = "View all >",
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = CcColors.Forest,
                    modifier = Modifier.clickable { nav.navigate(Routes.chats("announcements")) },
                )
            }

            val announcements = dash.data?.announcements.orEmpty()
            if (announcements.isNotEmpty()) {
                val a = announcements[0]
                AnnouncementCard(a, onClick = { nav.navigate(Routes.chats("announcements")) })
            } else {
                // Default announcement card matching the visual specification
                Box(
                    Modifier
                        .fillMaxWidth()
                        .shadow(4.dp, RoundedCornerShape(18.dp), ambientColor = Color(0x11000000))
                        .clip(RoundedCornerShape(18.dp))
                        .background(Color.White)
                        .border(1.dp, Color(0xFFF3F4F6), RoundedCornerShape(18.dp))
                        .clickable { nav.navigate(Routes.chats("announcements")) }
                        .padding(16.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            Modifier
                                .size(42.dp)
                                .clip(CircleShape)
                                .background(Color(0xFFFFEDD5)),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                Icons.Rounded.Campaign,
                                contentDescription = null,
                                tint = Color(0xFFEA580C),
                                modifier = Modifier.size(22.dp),
                            )
                        }

                        Spacer(Modifier.width(12.dp))

                        Column(Modifier.weight(1f)) {
                            Text(
                                text = "Library renovation update",
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.Bold,
                                color = CcColors.Ink,
                            )
                            Spacer(Modifier.height(2.dp))
                            Text(
                                text = "Main Library will be closed from Aug 10 – Aug 20 for renovation work.",
                                style = MaterialTheme.typography.bodySmall,
                                color = CcColors.InkSoft,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Spacer(Modifier.height(4.dp))
                            Text(
                                text = "2 hours ago",
                                style = MaterialTheme.typography.labelSmall,
                                color = CcColors.InkFaint,
                            )
                        }

                        Icon(
                            Icons.AutoMirrored.Rounded.ArrowForwardIos,
                            contentDescription = null,
                            tint = CcColors.InkSoft,
                            modifier = Modifier.size(16.dp),
                        )
                    }
                }
            }

            // ---- 6. Emergency Contacts (offline fallback)
            val contacts = config.emergencyContacts.filter { !it.phone.isNullOrBlank() }.take(2)
            if (contacts.isNotEmpty()) {
                SectionHeader("Emergency contacts", action = "All contacts", onAction = { nav.navigate(Routes.Contacts) })
                CcCard {
                    contacts.forEachIndexed { i, c ->
                        if (i > 0) Divider()
                        EmergencyCallRow(c)
                    }
                }
            }

            Spacer(Modifier.height(84.dp))
        }
    }
}

@Composable
private fun StudentFeatureTile(
    title: String,
    subtitle: String,
    icon: ImageVector,
    iconTint: Color,
    iconBg: Color,
    modifier: Modifier = Modifier,
    badgeCount: Int = 0,
    onClick: () -> Unit,
) {
    val interaction = remember { MutableInteractionSource() }
    Box(
        modifier = modifier
            .shadow(4.dp, RoundedCornerShape(16.dp), ambientColor = Color(0x0E000000))
            .clip(RoundedCornerShape(16.dp))
            .background(Color.White)
            .border(1.dp, Color(0xFFF3F4F6), RoundedCornerShape(16.dp))
            .clickable(interactionSource = interaction, indication = ripple(), onClick = onClick)
            .padding(vertical = 10.dp, horizontal = 2.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Box {
                Box(
                    Modifier
                        .size(36.dp)
                        .clip(CircleShape)
                        .background(iconBg),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(icon, contentDescription = null, tint = iconTint, modifier = Modifier.size(20.dp))
                }
                if (badgeCount > 0) {
                    Box(
                        Modifier
                            .align(Alignment.TopEnd)
                            .offset(x = 6.dp, y = (-4).dp)
                            .size(16.dp)
                            .clip(CircleShape)
                            .background(Color(0xFFEF4444)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(text = "$badgeCount", color = Color.White, fontSize = 9.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
            Spacer(Modifier.height(6.dp))
            Text(
                text = title,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                color = CcColors.Ink,
                maxLines = 1,
            )
            Text(
                text = subtitle,
                fontSize = 9.sp,
                color = CcColors.InkSoft,
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun UpcomingAppointmentCard(a: NextAppointment, onClick: () -> Unit) {
    Box(
        Modifier
            .fillMaxWidth()
            .shadow(4.dp, RoundedCornerShape(18.dp), ambientColor = Color(0x11000000))
            .clip(RoundedCornerShape(18.dp))
            .background(Color.White)
            .border(1.dp, Color(0xFFF3F4F6), RoundedCornerShape(18.dp))
            .clickable(enabled = onClick != null, onClick = { onClick?.invoke() })
            .padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Avatar(name = "Dr. Meera Sharma", size = 46.dp)

            Spacer(Modifier.width(12.dp))

            Column(Modifier.weight(1f)) {
                Text(
                    text = "Counselling Session",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                    color = CcColors.Ink,
                )
                Text(
                    text = "Dr. Meera Sharma",
                    style = MaterialTheme.typography.bodySmall,
                    color = CcColors.InkSoft,
                )
                Spacer(Modifier.height(4.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Rounded.CalendarMonth, contentDescription = null, tint = CcColors.InkSoft, modifier = Modifier.size(13.dp))
                    Spacer(Modifier.width(3.dp))
                    Text(Fmt.dayTime(a.startAt), style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
                }
                Spacer(Modifier.height(2.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Rounded.Videocam, contentDescription = null, tint = CcColors.Forest, modifier = Modifier.size(13.dp))
                    Spacer(Modifier.width(3.dp))
                    Text(if (a.mode == "online") "Online Session" else "In person", style = MaterialTheme.typography.labelSmall, color = CcColors.Forest, fontWeight = FontWeight.Medium)
                }
            }

            Icon(
                Icons.AutoMirrored.Rounded.ArrowForwardIos,
                contentDescription = null,
                tint = CcColors.InkSoft,
                modifier = Modifier.size(16.dp),
            )
        }
    }
}

@Composable
fun AnnouncementCard(a: Announcement, onClick: (() -> Unit)? = null) {
    Box(
        Modifier
            .fillMaxWidth()
            .shadow(4.dp, RoundedCornerShape(18.dp), ambientColor = Color(0x11000000))
            .clip(RoundedCornerShape(18.dp))
            .background(Color.White)
            .border(1.dp, Color(0xFFF3F4F6), RoundedCornerShape(18.dp))
            .clickable(enabled = onClick != null, onClick = { onClick?.invoke() })
            .padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .size(42.dp)
                    .clip(CircleShape)
                    .background(Color(0xFFFFEDD5)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Rounded.Campaign,
                    contentDescription = null,
                    tint = Color(0xFFEA580C),
                    modifier = Modifier.size(22.dp),
                )
            }

            Spacer(Modifier.width(12.dp))

            Column(Modifier.weight(1f)) {
                Text(
                    text = a.title,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                    color = CcColors.Ink,
                )
                if (a.body.isNotBlank()) {
                    Spacer(Modifier.height(2.dp))
                    Text(
                        text = a.body,
                        style = MaterialTheme.typography.bodySmall,
                        color = CcColors.InkSoft,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Spacer(Modifier.height(4.dp))
                Text(
                    text = Fmt.ago(a.createdAt),
                    style = MaterialTheme.typography.labelSmall,
                    color = CcColors.InkFaint,
                )
            }

            Icon(
                Icons.AutoMirrored.Rounded.ArrowForwardIos,
                contentDescription = null,
                tint = CcColors.InkSoft,
                modifier = Modifier.size(16.dp),
            )
        }
    }
}

@Composable
fun CampusAlertCard(a: CampusAlertSummary, onAnswered: () -> Unit) {
    CampusAlertBanner(a, onAnswered)
}

@Composable
private fun CampusAlertBanner(a: CampusAlertSummary, onAnswered: () -> Unit) {
    val app = LocalApp.current
    val snack = LocalSnack.current
    val nav = LocalNav.current
    val scope = rememberCoroutineScope()
    val tone = when (a.severity) { "emergency" -> Tone.Danger; "warning" -> Tone.Amber; "advisory" -> Tone.Sky; else -> Tone.Brand }
    CcCard(color = tone.bg.copy(alpha = 0.45f)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconBadge(Icons.Rounded.NotificationsActive, tone, size = 40.dp, iconSize = 20.dp)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(a.title, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                Text(Fmt.ago(a.createdAt), style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
            }
            StatusChip(Fmt.humanize(a.severity), tone)
        }
        if (a.body.isNotBlank()) Text(a.body, style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink, modifier = Modifier.padding(top = 8.dp))
        if (a.requestCheckIn) {
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                CcButton("I'm safe", {
                    scope.launch {
                        try {
                            app.api.safety.checkIn(a.id, "safe", null)
                            snack.show("Thanks — marked as safe.")
                            onAnswered()
                        } catch (e: ApiException) {
                            snack.error(e)
                        }
                    }
                }, Modifier.weight(1f), kind = ButtonKind.Brand)
                CcButton("I need help", {
                    scope.launch {
                        try {
                            app.api.safety.checkIn(a.id, "need_help", null)
                            nav.navigate(Routes.Sos)
                            onAnswered()
                        } catch (e: ApiException) {
                            snack.error(e)
                        }
                    }
                }, Modifier.weight(1f), kind = ButtonKind.Danger)
            }
        }
    }
}
