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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.rounded.BarChart
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.FindInPage
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material.icons.rounded.HourglassTop
import androidx.compose.material.icons.rounded.NearMe
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.PriorityHigh
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.TrendingUp
import androidx.compose.material.icons.rounded.Warning
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
import androidx.compose.ui.unit.sp
import edu.srmap.campuscare.data.CommitteeDashboardData
import edu.srmap.campuscare.data.CommitteeRecentReport
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

/**
 * Screen 1: Committee Member Dashboard (Part B)
 *
 * Visual elements matching reference:
 * - Header: Dr. Priya Nair, "Committee Member • Main Campus", notification bell
 * - Purple/Emerald gradient banner: "Confidential Committee Review Portal"
 * - 6 KPI tiles: 8 New (red), 12 Under Review (amber), 6 In Progress (sky),
 *   24 Resolved (emerald), 3 Require Action (purple), 92% Resolution Rate (mint)
 * - 4 Quick Actions: Reports, Students, Investigations, Analytics
 * - Recent Reports list with case numbers, category badges, student info, date, and [View Details]
 */
@Composable
fun CommitteeDashboardScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val user by app.session.user.collectAsState()

    val dashboard = rememberLoad { app.api.committeePortal.dashboard() }

    LaunchedEffect(Unit) {
        app.realtime.events.collect { e ->
            if (e.name == "incident:created" || e.name == "incident:updated" || e.name == "notification") {
                dashboard.reload()
            }
        }
    }

    val memberName = user?.fullName?.ifBlank { null } ?: "Dr. Priya Nair"

    CcScreen(
        title = "Committee Portal",
        onRefresh = { dashboard.reload() },
    ) {
        LoadContent(
            dashboard,
            skeleton = { SkeletonList(4) },
        ) { data ->
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                // Member Header Card
                CommitteeHeaderCard(
                    memberName = memberName,
                    roleTitle = data.roleTitle,
                    onNotificationsClick = { nav.navigate(Routes.Notifications) },
                )

                // Inspiring Purple/Forest Banner
                CommitteeConfidentialBanner()

                // 6 Core KPI Tiles (2 rows of 3)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    StatTile(
                        value = data.newCount.toString(),
                        label = "New",
                        icon = Icons.Rounded.PriorityHigh,
                        tone = Tone.Danger,
                        modifier = Modifier.weight(1f),
                    )
                    StatTile(
                        value = data.underReviewCount.toString(),
                        label = "Under Review",
                        icon = Icons.Rounded.HourglassTop,
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
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    StatTile(
                        value = data.resolvedCount.toString(),
                        label = "Resolved",
                        icon = Icons.Rounded.CheckCircle,
                        tone = Tone.Brand,
                        modifier = Modifier.weight(1f),
                    )
                    StatTile(
                        value = data.requireActionCount.toString(),
                        label = "Action Needed",
                        icon = Icons.Rounded.Warning,
                        tone = Tone.Violet,
                        modifier = Modifier.weight(1f),
                    )
                    StatTile(
                        value = "${data.resolutionRate}%",
                        label = "Resolution Rate",
                        icon = Icons.Rounded.TrendingUp,
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
                    CommitteeActionTile(
                        title = "Reports",
                        icon = Icons.Rounded.Description,
                        tone = Tone.Violet,
                        modifier = Modifier.weight(1f),
                        onClick = { nav.navigate(Routes.CommitteeReports) },
                    )
                    CommitteeActionTile(
                        title = "Students",
                        icon = Icons.Rounded.Groups,
                        tone = Tone.Brand,
                        modifier = Modifier.weight(1f),
                        onClick = { nav.navigate(Routes.CommitteeStudents) },
                    )
                    CommitteeActionTile(
                        title = "Inquiries",
                        icon = Icons.Rounded.FindInPage,
                        tone = Tone.Amber,
                        modifier = Modifier.weight(1f),
                        onClick = {
                            val firstId = data.recentReports.firstOrNull()?.id
                            if (firstId != null) {
                                nav.navigate(Routes.committeeInvestigation(firstId))
                            } else {
                                nav.navigate(Routes.CommitteeReports)
                            }
                        },
                    )
                    CommitteeActionTile(
                        title = "Analytics",
                        icon = Icons.Rounded.BarChart,
                        tone = Tone.Sky,
                        modifier = Modifier.weight(1f),
                        onClick = { nav.navigate(Routes.CommitteeAnalytics) },
                    )
                }

                // Recent Reports List
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    SectionHeader("Recent Incident Reports")
                    TextButton(onClick = { nav.navigate(Routes.CommitteeReports) }) {
                        Text("View all", color = CcColors.Forest, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                    }
                }

                if (data.recentReports.isEmpty()) {
                    CcCard {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Icon(Icons.Rounded.CheckCircle, contentDescription = null, tint = CcColors.Emerald, modifier = Modifier.size(24.dp))
                            Text("No pending student incident reports.", color = CcColors.InkSoft)
                        }
                    }
                } else {
                    data.recentReports.forEachIndexed { idx, report ->
                        RecentReportItemCard(
                            report = report,
                            modifier = Modifier.enterStagger(idx),
                            onClick = { nav.navigate(Routes.committeeReportDetail(report.id)) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun CommitteeHeaderCard(
    memberName: String,
    roleTitle: String,
    onNotificationsClick: () -> Unit,
) {
    CcCard(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Avatar(name = memberName, size = 48.dp)
                Column {
                    Text(
                        text = memberName,
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

@Composable
private fun CommitteeConfidentialBanner() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(
                Brush.horizontalGradient(
                    colors = listOf(Color(0xFF6B21A8), Color(0xFF047857)),
                ),
            )
            .padding(16.dp),
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
                    imageVector = Icons.Rounded.Shield,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(24.dp),
                )
            }

            Column {
                Text(
                    text = "Confidential Review Portal",
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp,
                )
                Text(
                    text = "All proceedings and student reports are legally protected.",
                    color = Color.White.copy(alpha = 0.85f),
                    fontSize = 12.sp,
                )
            }
        }
    }
}

@Composable
private fun CommitteeActionTile(
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
private fun RecentReportItemCard(
    report: CommitteeRecentReport,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    CcCard(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        text = report.caseNumber,
                        fontWeight = FontWeight.Black,
                        fontSize = 13.sp,
                        color = CcColors.Ink,
                    )
                    StatusChip(
                        text = report.statusLabel.uppercase(),
                        tone = when (report.status) {
                            "submitted" -> Tone.Danger
                            "under_review", "in_review" -> Tone.Amber
                            "in_progress", "investigating" -> Tone.Sky
                            "resolved" -> Tone.Brand
                            else -> Tone.Neutral
                        },
                    )
                }

                Text(
                    text = report.title,
                    fontWeight = FontWeight.Bold,
                    fontSize = 14.sp,
                    color = CcColors.Ink,
                )

                Text(
                    text = "${report.categoryLabel} • ${report.location}",
                    style = MaterialTheme.typography.bodySmall,
                    color = CcColors.InkSoft,
                )
            }

            Icon(
                imageVector = Icons.AutoMirrored.Rounded.ArrowForward,
                contentDescription = "Details",
                tint = CcColors.Forest,
                modifier = Modifier.size(20.dp),
            )
        }
    }
}
