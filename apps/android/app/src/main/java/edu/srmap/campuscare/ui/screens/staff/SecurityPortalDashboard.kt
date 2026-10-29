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
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material.icons.rounded.Navigation
import androidx.compose.material.icons.rounded.NearMe
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.NotificationsActive
import androidx.compose.material.icons.rounded.Place
import androidx.compose.material.icons.rounded.Security
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import edu.srmap.campuscare.data.SecurityDashboardData
import edu.srmap.campuscare.data.SecurityRecentAlert
import edu.srmap.campuscare.ui.components.Avatar
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.SectionHeader
import edu.srmap.campuscare.ui.components.SkeletonList
import edu.srmap.campuscare.ui.components.StatTile
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.enterStagger
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.theme.CcColors
import kotlinx.coroutines.launch

/**
 * Screen 1: Security Officer Dashboard (Part A)
 *
 * Visual elements matching reference:
 * - Officer Kumar avatar, title "Security Officer • Main Campus"
 * - On/Off duty toggle switch with real-time duty state syncing
 * - Red active SOS banner ("1 Active SOS", Location, [View Details])
 * - 3 KPI stat tiles: Alerts Today (amber), In Progress (sky), Resolved (forest)
 * - 4 Quick Actions: Live Map, Patrol, Team, Reports
 * - Recent Alerts card with student details, location, distance, quote, mini map preview,
 *   and [Navigate] / [Acknowledge] action buttons.
 */
@Composable
fun SecurityDashboardScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val user by app.session.user.collectAsState()
    val dutyState by app.duty.state.collectAsState()

    val dashboard = rememberLoad { app.api.securityPortal.dashboard() }

    LaunchedEffect(Unit) {
        app.realtime.events.collect { e ->
            if (e.name == "sos:raised" || e.name == "sos:updated" || e.name == "notification") {
                dashboard.reload()
            }
        }
    }

    val officerName = user?.fullName?.ifBlank { null } ?: "Officer Kumar"

    CcScreen(
        title = "Security Dashboard",
        onRefresh = { dashboard.reload() },
    ) {
        LoadContent(
            dashboard,
            skeleton = { SkeletonList(4) },
        ) { data ->
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                // Officer Profile & Duty Switch Header
                SecurityHeaderCard(
                    officerName = officerName,
                    roleTitle = data.roleTitle,
                    isOnDuty = dutyState.onDuty,
                    onToggleDuty = { newDuty ->
                        scope.launch {
                            try {
                                app.duty.setOnDuty(newDuty, reason = if (newDuty) "Officer went on duty" else "Officer went off duty")
                                snack.show(if (newDuty) "You are now ON DUTY" else "You are now OFF DUTY")
                                dashboard.reload()
                            } catch (e: Exception) {
                                snack.show(e.message ?: "Could not update duty status")
                            }
                        }
                    },
                    onNotificationsClick = { nav.navigate(Routes.Notifications) },
                )

                // Urgent 1 Active SOS Banner
                if (data.activeSosCount > 0) {
                    ActiveSosUrgentBanner(
                        count = data.activeSosCount,
                        location = data.recentAlerts.firstOrNull()?.locationLabel ?: "Library Block - Room 202",
                        onClick = {
                            val alertId = data.recentAlerts.firstOrNull()?.id
                            if (alertId != null) {
                                nav.navigate(Routes.securityResponse(alertId))
                            } else {
                                nav.navigate(Routes.SecurityAlerts)
                            }
                        },
                    )
                }

                // 3 Core Metric Tiles
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    StatTile(
                        value = data.todayAlertsCount.toString(),
                        label = "Alerts Today",
                        icon = Icons.Rounded.NotificationsActive,
                        tone = Tone.Amber,
                        modifier = Modifier.weight(1f),
                    )
                    StatTile(
                        value = data.inProgressCount.toString(),
                        label = "In Progress",
                        icon = Icons.Rounded.NearMe,
                        tone = Tone.Sky,
                        modifier = Modifier.weight(1f),
                    )
                    StatTile(
                        value = data.resolvedCount.toString(),
                        label = "Resolved",
                        icon = Icons.Rounded.CheckCircle,
                        tone = Tone.Brand,
                        modifier = Modifier.weight(1f),
                    )
                }

                // Quick Actions Grid
                SectionHeader("Quick Actions")
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    SecurityActionTile(
                        title = "Live Map",
                        icon = Icons.Rounded.Place,
                        tone = Tone.Sky,
                        modifier = Modifier.weight(1f),
                        onClick = { nav.navigate(Routes.SecurityMap) },
                    )
                    SecurityActionTile(
                        title = "Patrol",
                        icon = Icons.Rounded.Security,
                        tone = Tone.Brand,
                        modifier = Modifier.weight(1f),
                        onClick = { nav.navigate(Routes.SecurityPatrol) },
                    )
                    SecurityActionTile(
                        title = "Team",
                        icon = Icons.Rounded.Groups,
                        tone = Tone.Brand,
                        modifier = Modifier.weight(1f),
                        onClick = { nav.navigate(Routes.SecurityTeam) },
                    )
                    SecurityActionTile(
                        title = "Alerts",
                        icon = Icons.Rounded.Warning,
                        tone = Tone.Danger,
                        modifier = Modifier.weight(1f),
                        onClick = { nav.navigate(Routes.SecurityAlerts) },
                    )
                }

                // Recent Alerts Section
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    SectionHeader("Recent Alerts")
                    TextButton(onClick = { nav.navigate(Routes.SecurityAlerts) }) {
                        Text("View all", color = CcColors.Forest, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                    }
                }

                if (data.recentAlerts.isEmpty()) {
                    CcCard {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Icon(Icons.Rounded.CheckCircle, contentDescription = null, tint = CcColors.Emerald, modifier = Modifier.size(24.dp))
                            Text("No active emergency alerts on campus.", color = CcColors.InkSoft)
                        }
                    }
                } else {
                    data.recentAlerts.forEachIndexed { idx, alert ->
                        RecentAlertCard(
                            alert = alert,
                            modifier = Modifier.enterStagger(idx),
                            onViewDetails = { nav.navigate(Routes.securityResponse(alert.id)) },
                            onNavigate = { nav.navigate(Routes.SecurityMap) },
                            onAcknowledge = {
                                scope.launch {
                                    try {
                                        app.api.securityPortal.updateStatus(alert.id, "acknowledged", notes = "Acknowledged from Dashboard")
                                        snack.show("Alert acknowledged")
                                        dashboard.reload()
                                    } catch (e: Exception) {
                                        snack.show(e.message ?: "Failed to acknowledge alert")
                                    }
                                }
                            },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun SecurityHeaderCard(
    officerName: String,
    roleTitle: String,
    isOnDuty: Boolean,
    onToggleDuty: (Boolean) -> Unit,
    onNotificationsClick: () -> Unit,
) {
    CcCard(
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Avatar(
                    name = officerName,
                    size = 48.dp,
                )
                Column {
                    Text(
                        text = officerName,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = CcColors.Ink,
                    )
                    Text(
                        text = roleTitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = CcColors.InkSoft,
                    )
                }
            }

            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                // On duty switch
                Column(horizontalAlignment = Alignment.End) {
                    Text(
                        text = if (isOnDuty) "On Duty" else "Off Duty",
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                        color = if (isOnDuty) CcColors.Emerald else CcColors.InkFaint,
                    )
                    Switch(
                        checked = isOnDuty,
                        onCheckedChange = onToggleDuty,
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = Color.White,
                            checkedTrackColor = CcColors.Emerald,
                            uncheckedThumbColor = Color.White,
                            uncheckedTrackColor = CcColors.InkFaint.copy(alpha = 0.4f),
                        ),
                    )
                }

                IconButton(onClick = onNotificationsClick) {
                    Icon(
                        imageVector = Icons.Rounded.Notifications,
                        contentDescription = "Notifications",
                        tint = CcColors.Forest,
                    )
                }
            }
        }
    }
}

@Composable
private fun ActiveSosUrgentBanner(
    count: Int,
    location: String,
    onClick: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(
                Brush.horizontalGradient(
                    colors = listOf(Color(0xFFDC2626), Color(0xFFEF4444)),
                ),
            )
            .clickable(onClick = onClick)
            .padding(16.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Box(
                    modifier = Modifier
                        .size(40.dp)
                        .clip(CircleShape)
                        .background(Color.White.copy(alpha = 0.2f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = Icons.Rounded.NotificationsActive,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(24.dp),
                    )
                }

                Column {
                    Text(
                        text = "$count Active SOS Alert",
                        color = Color.White,
                        fontWeight = FontWeight.Black,
                        fontSize = 16.sp,
                    )
                    Text(
                        text = location,
                        color = Color.White.copy(alpha = 0.9f),
                        fontSize = 12.sp,
                    )
                }
            }

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    text = "View",
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                    fontSize = 13.sp,
                )
                Icon(
                    imageVector = Icons.AutoMirrored.Rounded.ArrowForward,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(16.dp),
                )
            }
        }
    }
}

@Composable
private fun SecurityActionTile(
    title: String,
    icon: ImageVector,
    tone: Tone,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    CcCard(
        modifier = modifier.clickable(onClick = onClick),
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 4.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .clip(CircleShape)
                    .background(tone.bg),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = tone.fg,
                    modifier = Modifier.size(20.dp),
                )
            }
            Spacer(Modifier.height(6.dp))
            Text(
                text = title,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
                color = CcColors.Ink,
            )
        }
    }
}

@Composable
private fun RecentAlertCard(
    alert: SecurityRecentAlert,
    modifier: Modifier = Modifier,
    onViewDetails: () -> Unit,
    onNavigate: () -> Unit,
    onAcknowledge: () -> Unit,
) {
    CcCard(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onViewDetails),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            // Header with Alert ID, Badge and Time
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = alert.alertNumber,
                        fontWeight = FontWeight.Black,
                        fontSize = 14.sp,
                        color = CcColors.Ink,
                    )
                    StatusChip(
                        text = alert.severity.uppercase(),
                        tone = if (alert.severity == "critical") Tone.Danger else Tone.Amber,
                    )
                }

                StatusChip(
                    text = alert.status.replace('_', ' ').uppercase(),
                    tone = when (alert.status) {
                        "resolved" -> Tone.Brand
                        "en_route", "acknowledged" -> Tone.Sky
                        else -> Tone.Danger
                    },
                )
            }

            // Student Info
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Avatar(name = alert.studentName, size = 38.dp)
                Column {
                    Text(
                        text = alert.studentName,
                        fontWeight = FontWeight.Bold,
                        style = MaterialTheme.typography.bodyMedium,
                        color = CcColors.Ink,
                    )
                    Text(
                        text = alert.studentDept,
                        style = MaterialTheme.typography.bodySmall,
                        color = CcColors.InkSoft,
                    )
                }
            }

            // Location with distance
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon(
                    imageVector = Icons.Rounded.Place,
                    contentDescription = null,
                    tint = CcColors.Sos,
                    modifier = Modifier.size(16.dp),
                )
                Text(
                    text = alert.locationLabel,
                    fontWeight = FontWeight.Medium,
                    fontSize = 13.sp,
                    color = CcColors.Ink,
                )
                if (alert.distanceKm != null) {
                    Text(
                        text = "• ${alert.distanceKm} km away",
                        fontSize = 12.sp,
                        color = CcColors.InkSoft,
                    )
                }
            }

            // Student Note Quote
            if (alert.description.isNotBlank()) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(CcColors.Cream)
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                ) {
                    Text(
                        text = "\"${alert.description}\"",
                        style = MaterialTheme.typography.bodySmall,
                        color = CcColors.Ink,
                        fontStyle = androidx.compose.ui.text.font.FontStyle.Italic,
                    )
                }
            }

            // Action buttons: [Navigate] [Acknowledge]
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                CcButton(
                    text = "Navigate",
                    onClick = onNavigate,
                    leadingIcon = Icons.Rounded.Navigation,
                    kind = ButtonKind.Outline,
                    modifier = Modifier.weight(1f),
                )
                if (alert.requiresAck || alert.status in listOf("queued", "sent", "sending")) {
                    CcButton(
                        text = "Acknowledge",
                        onClick = onAcknowledge,
                        leadingIcon = Icons.Rounded.CheckCircle,
                        kind = ButtonKind.Primary,
                        modifier = Modifier.weight(1f),
                    )
                } else {
                    CcButton(
                        text = "Details",
                        onClick = onViewDetails,
                        leadingIcon = Icons.AutoMirrored.Rounded.ArrowForward,
                        kind = ButtonKind.Soft,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }
    }
}
