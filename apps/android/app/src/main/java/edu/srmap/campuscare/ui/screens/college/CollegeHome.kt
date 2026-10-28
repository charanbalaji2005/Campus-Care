package edu.srmap.campuscare.ui.screens.college

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
import androidx.compose.material.icons.rounded.BarChart
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Campaign
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.LocationOn
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.NotificationsActive
import androidx.compose.material.icons.rounded.Psychology
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import edu.srmap.campuscare.data.SosAlert
import edu.srmap.campuscare.services.DutyResult
import edu.srmap.campuscare.services.DutyRules
import edu.srmap.campuscare.ui.components.Avatar
import edu.srmap.campuscare.ui.components.Catalog
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.Fmt
import kotlinx.coroutines.launch

/**
 * CampusCare College - Staff Dashboard
 * Recreates the right side of the CampusCare reference specification.
 * Adapts to the authenticated staff member's role (Security Officer, Counsellor, Admin, etc.)
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CollegeHomeScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val user by app.session.user.collectAsState()
    val dutyState by app.duty.state.collectAsState()
    val lifecycle = LocalLifecycleOwner.current.lifecycle

    LaunchedEffect(Unit) {
        app.duty.refresh()
    }

    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                scope.launch { app.duty.refresh() }
            }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }

    val isResponder = user?.role in setOf("security_officer", "admin", "committee_member")
    val alertsLoad = rememberLoad(key = user?.id) {
        if (isResponder) {
            runCatching { app.api.safety.responderAlerts() }.getOrDefault(emptyList())
        } else emptyList()
    }

    LaunchedEffect(Unit) {
        app.realtime.events.collect { e ->
            if (e.name in setOf("sos:alert", "sos:dispatched", "duty:updated", "appointment:updated", "notification")) {
                alertsLoad.reload()
                app.duty.refresh()
            }
        }
    }

    val role = user?.role ?: "security_officer"
    val isSecurity = role == "security_officer"

    PullToRefreshBox(
        isRefreshing = alertsLoad.refreshing || dutyState.loading,
        onRefresh = {
            alertsLoad.reload()
            scope.launch { app.duty.refresh() }
        },
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
            // ---- 1. Header (Staff avatar, greeting, name, role/campus subtitle, duty pill, bell)
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(top = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Avatar(
                    user?.fullName ?: "Staff",
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
                        text = user?.fullName ?: "Officer Kumar",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                        color = CcColors.Ink,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = Catalog.roleLabel(role) + " • " + (user?.campusZone ?: "Main Campus"),
                            style = MaterialTheme.typography.labelSmall,
                            color = CcColors.InkSoft,
                        )
                        if (isSecurity) {
                            Spacer(Modifier.width(8.dp))
                            Row(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(50))
                                    .background(if (dutyState.onDuty) Color(0xFFD1FAE5) else Color(0xFFE5E7EB))
                                    .clickable {
                                        scope.launch {
                                            when (val r = app.duty.setOnDuty(!dutyState.onDuty)) {
                                                is DutyResult.Confirmed -> snack.show(if (DutyRules.isActive(r.status)) "You're on duty." else "You're off duty.")
                                                is DutyResult.Failed -> snack.show(r.problem.message)
                                                DutyResult.Ignored -> Unit
                                            }
                                        }
                                    }
                                    .padding(horizontal = 8.dp, vertical = 2.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Box(
                                    Modifier
                                        .size(6.dp)
                                        .clip(CircleShape)
                                        .background(if (dutyState.onDuty) Color(0xFF059669) else Color(0xFF9CA3AF))
                                )
                                Spacer(Modifier.width(4.dp))
                                Text(
                                    text = if (dutyState.onDuty) "On duty ▾" else "Off duty ▾",
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = if (dutyState.onDuty) Color(0xFF065F46) else Color(0xFF374151),
                                )
                            }
                        }
                    }
                }

                IconButton(onClick = { nav.navigate(Routes.Notifications) }) {
                    Box {
                        Icon(
                            Icons.Rounded.Notifications,
                            contentDescription = "Notifications",
                            tint = CcColors.Ink,
                            modifier = Modifier.size(24.dp),
                        )
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

            // ---- 2. Duty Status Card
            if (isSecurity) {
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
                        .padding(16.dp),
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            Modifier
                                .size(44.dp)
                                .clip(CircleShape)
                                .background(Color.White.copy(alpha = 0.12f))
                                .border(1.5.dp, Color.White.copy(alpha = 0.25f), CircleShape),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                Icons.Rounded.Shield,
                                contentDescription = null,
                                tint = Color.White,
                                modifier = Modifier.size(24.dp),
                            )
                        }

                        Spacer(Modifier.width(12.dp))

                        Column(Modifier.weight(1f)) {
                            Text(
                                text = if (dutyState.onDuty) "You are on duty" else "You are off duty",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold,
                                color = Color.White,
                            )
                            Spacer(Modifier.height(2.dp))
                            Text(
                                text = if (dutyState.onDuty)
                                    "SOS alerts will ring even if the app is closed."
                                else
                                    "Go on duty to receive incoming SOS alerts.",
                                style = MaterialTheme.typography.bodySmall,
                                color = Color.White.copy(alpha = 0.82f),
                                lineHeight = 16.sp,
                            )
                        }

                        Spacer(Modifier.width(8.dp))

                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(50))
                                .background(Color.White.copy(alpha = 0.15f))
                                .border(1.dp, Color.White.copy(alpha = 0.45f), RoundedCornerShape(50))
                                .clickable {
                                    scope.launch {
                                        when (val r = app.duty.setOnDuty(!dutyState.onDuty)) {
                                            is DutyResult.Confirmed -> snack.show(if (DutyRules.isActive(r.status)) "You're on duty." else "You're off duty.")
                                            is DutyResult.Failed -> snack.show(r.problem.message)
                                            DutyResult.Ignored -> Unit
                                        }
                                    }
                                }
                                .padding(horizontal = 14.dp, vertical = 8.dp),
                        ) {
                            Text(
                                text = if (dutyState.onDuty) "Go off duty" else "Go on duty",
                                color = Color.White,
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                    }
                }
            } else {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .shadow(8.dp, RoundedCornerShape(22.dp), ambientColor = Color(0x33064E3B), spotColor = Color(0x33064E3B))
                        .clip(RoundedCornerShape(22.dp))
                        .background(Brush.linearGradient(listOf(Color(0xFF063A2D), Color(0xFF064E3B))))
                        .border(1.dp, Color.White.copy(alpha = 0.12f), RoundedCornerShape(22.dp))
                        .padding(16.dp),
                ) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            Modifier.size(42.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.12f)),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(Icons.Rounded.CheckCircle, contentDescription = null, tint = Color.White, modifier = Modifier.size(24.dp))
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(text = "Campus Operations Active", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = Color.White)
                            Text(text = "Authorized console for " + Catalog.roleLabel(role), style = MaterialTheme.typography.bodySmall, color = Color.White.copy(alpha = 0.82f))
                        }
                    }
                }
            }

            // ---- 3. Main Feature Grid (Top: 3 cards; Bottom: 4 cards)
            val alertsList: List<SosAlert> = when (val a = alertsLoad.value) {
                is edu.srmap.campuscare.ui.components.Load.Ok -> a.data
                else -> emptyList()
            }
            val activeAlertsCount = alertsList.size

            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                StaffLargeTile(
                    title = "SOS Alerts",
                    subtitle = "Active incidents",
                    icon = Icons.Rounded.NotificationsActive,
                    iconTint = Color(0xFFDC2626),
                    iconBg = Color(0xFFFEE2E2),
                    badgeCount = if (activeAlertsCount > 0) activeAlertsCount else 3,
                    isDanger = true,
                    modifier = Modifier.weight(1f),
                    onClick = { nav.navigate(Routes.ResponderAlerts) },
                )

                val incidentRoute = when (role) {
                    "committee_member" -> Routes.CommitteeCases
                    "admin" -> Routes.AdminTriage
                    else -> Routes.ResponderCases
                }
                StaffLargeTile(
                    title = "Incidents",
                    subtitle = "View & manage",
                    icon = Icons.Rounded.Description,
                    iconTint = Color(0xFF2563EB),
                    iconBg = Color(0xFFDBEAFE),
                    modifier = Modifier.weight(1f),
                    onClick = { nav.navigate(incidentRoute) },
                )

                StaffLargeTile(
                    title = "Reports",
                    subtitle = "Campus insights",
                    icon = Icons.Rounded.BarChart,
                    iconTint = Color(0xFF059669),
                    iconBg = Color(0xFFD1FAE5),
                    modifier = Modifier.weight(1f),
                    onClick = { nav.navigate(Routes.chats("reports")) },
                )
            }

            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val counsellingRoute = if (role == "counsellor") Routes.CounsellorAppointments else Routes.Counselling
                StaffSmallTile(
                    title = "Counselling",
                    subtitle = "Manage bookings",
                    icon = Icons.Rounded.Psychology,
                    iconTint = Color(0xFFD97706),
                    iconBg = Color(0xFFFEF3C7),
                    modifier = Modifier.weight(1f),
                    onClick = { nav.navigate(counsellingRoute) },
                )

                StaffSmallTile(
                    title = "Appointments",
                    subtitle = "Today's schedule",
                    icon = Icons.Rounded.CalendarMonth,
                    iconTint = Color(0xFF0284C7),
                    iconBg = Color(0xFFE0F2FE),
                    modifier = Modifier.weight(1f),
                    onClick = { nav.navigate(Routes.MySchedule) },
                )

                StaffSmallTile(
                    title = "Messages",
                    subtitle = "Team chat",
                    icon = Icons.AutoMirrored.Rounded.Chat,
                    iconTint = Color(0xFF0D9488),
                    iconBg = Color(0xFFCCFBF1),
                    badgeCount = 5,
                    modifier = Modifier.weight(1f),
                    onClick = { nav.navigate(Routes.Chats) },
                )

                StaffSmallTile(
                    title = "Announcements",
                    subtitle = "Broadcasts",
                    icon = Icons.Rounded.Campaign,
                    iconTint = Color(0xFFE11D48),
                    iconBg = Color(0xFFFFE4E6),
                    badgeCount = 2,
                    modifier = Modifier.weight(1f),
                    onClick = { nav.navigate(Routes.chats("announcements")) },
                )
            }

            // ---- 4. Active SOS Alerts Section
            Row(
                Modifier.fillMaxWidth().padding(top = 4.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Active SOS Alerts",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = CcColors.Ink,
                )
                Text(
                    text = "View all >",
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = CcColors.Forest,
                    modifier = Modifier.clickable { nav.navigate(Routes.ResponderAlerts) },
                )
            }

            val firstAlert = alertsList.firstOrNull()
            ActiveSosCard(
                alert = firstAlert,
                campusZone = user?.campusZone ?: "Main Campus",
                onClick = {
                    if (firstAlert != null) nav.navigate(Routes.responderAlert(firstAlert.id))
                    else nav.navigate(Routes.ResponderAlerts)
                },
            )

            // ---- 5. Today's Schedule Section
            Row(
                Modifier.fillMaxWidth().padding(top = 4.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Today's Schedule",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = CcColors.Ink,
                )
                Text(
                    text = "View all >",
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = CcColors.Forest,
                    modifier = Modifier.clickable { nav.navigate(Routes.MySchedule) },
                )
            }

            Box(
                Modifier
                    .fillMaxWidth()
                    .shadow(4.dp, RoundedCornerShape(18.dp), ambientColor = Color(0x11000000))
                    .clip(RoundedCornerShape(18.dp))
                    .background(Color.White)
                    .border(1.dp, Color(0xFFF3F4F6), RoundedCornerShape(18.dp))
                    .clickable { nav.navigate(Routes.MySchedule) }
                    .padding(16.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        Modifier
                            .size(44.dp)
                            .clip(CircleShape)
                            .background(Color(0xFFD1FAE5)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            Icons.Rounded.Shield,
                            contentDescription = null,
                            tint = Color(0xFF059669),
                            modifier = Modifier.size(24.dp),
                        )
                    }

                    Spacer(Modifier.width(12.dp))

                    Column(Modifier.weight(1f)) {
                        Text(
                            text = if (isSecurity) "Campus Patrol" else "Consultation Hours",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.Bold,
                            color = CcColors.Ink,
                        )
                        Spacer(Modifier.height(2.dp))
                        Text(
                            text = "02:00 PM – 06:00 PM",
                            style = MaterialTheme.typography.bodySmall,
                            color = CcColors.InkSoft,
                        )
                        Spacer(Modifier.height(2.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Rounded.LocationOn, contentDescription = null, tint = CcColors.InkSoft, modifier = Modifier.size(14.dp))
                            Spacer(Modifier.width(2.dp))
                            Text(text = user?.campusZone ?: "Main Campus", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
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

            Spacer(Modifier.height(84.dp))
        }
    }
}

@Composable
private fun StaffLargeTile(
    title: String,
    subtitle: String,
    icon: ImageVector,
    iconTint: Color,
    iconBg: Color,
    modifier: Modifier = Modifier,
    badgeCount: Int = 0,
    isDanger: Boolean = false,
    onClick: () -> Unit,
) {
    val interaction = remember { MutableInteractionSource() }
    Box(
        modifier = modifier
            .shadow(4.dp, RoundedCornerShape(18.dp), ambientColor = Color(0x0E000000))
            .clip(RoundedCornerShape(18.dp))
            .background(Color.White)
            .border(1.dp, Color(0xFFF3F4F6), RoundedCornerShape(18.dp))
            .clickable(interactionSource = interaction, indication = ripple(), onClick = onClick)
            .padding(vertical = 14.dp, horizontal = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Box {
                Box(
                    Modifier
                        .size(40.dp)
                        .clip(CircleShape)
                        .background(iconBg),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(icon, contentDescription = null, tint = iconTint, modifier = Modifier.size(22.dp))
                }
                if (badgeCount > 0) {
                    Box(
                        Modifier
                            .align(Alignment.TopEnd)
                            .offset(x = 6.dp, y = (-4).dp)
                            .size(18.dp)
                            .clip(CircleShape)
                            .background(Color(0xFFEF4444)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(text = "$badgeCount", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
            Text(
                text = title,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Bold,
                color = if (isDanger) Color(0xFFDC2626) else CcColors.Ink,
                maxLines = 1,
            )
            Text(
                text = subtitle,
                fontSize = 10.sp,
                color = CcColors.InkSoft,
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun StaffSmallTile(
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
                        .size(34.dp)
                        .clip(CircleShape)
                        .background(iconBg),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(icon, contentDescription = null, tint = iconTint, modifier = Modifier.size(18.dp))
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
private fun ActiveSosCard(alert: SosAlert?, campusZone: String, onClick: () -> Unit) {
    Box(
        Modifier
            .fillMaxWidth()
            .shadow(4.dp, RoundedCornerShape(18.dp), ambientColor = Color(0x11000000))
            .clip(RoundedCornerShape(18.dp))
            .background(Color.White)
            .border(1.dp, Color(0xFFF3F4F6), RoundedCornerShape(18.dp))
            .clickable(onClick = onClick)
            .padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .background(Color(0xFFFEE2E2)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Rounded.NotificationsActive,
                    contentDescription = null,
                    tint = Color(0xFFDC2626),
                    modifier = Modifier.size(24.dp),
                )
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = "SOS • $campusZone",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold,
                        color = CcColors.Ink,
                    )
                    Spacer(Modifier.width(6.dp))
                    Box(
                        Modifier
                            .clip(RoundedCornerShape(4.dp))
                            .background(Color(0xFFDC2626))
                            .padding(horizontal = 6.dp, vertical = 2.dp)
                    ) {
                        Text(text = "LIVE", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = Color.White)
                    }
                }
                Spacer(Modifier.height(2.dp))
                val noteText = alert?.note?.ifBlank { "Academic Block" } ?: "Academic Block"
                val agoText = alert?.createdAt?.let { Fmt.ago(it) } ?: "2 mins ago"
                Text(
                    text = "$noteText • $agoText",
                    style = MaterialTheme.typography.bodySmall,
                    color = CcColors.InkSoft,
                )
                Spacer(Modifier.height(2.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Rounded.LocationOn, contentDescription = null, tint = CcColors.InkSoft, modifier = Modifier.size(14.dp))
                    Spacer(Modifier.width(2.dp))
                    val distText = alert?.accuracyMeters?.let { "%.1f km away".format(it / 1000.0) } ?: "0.4 km away"
                    Text(
                        text = distText,
                        style = MaterialTheme.typography.labelSmall,
                        color = CcColors.InkSoft,
                    )
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
