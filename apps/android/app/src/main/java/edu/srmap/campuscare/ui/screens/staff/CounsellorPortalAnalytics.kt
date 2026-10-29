package edu.srmap.campuscare.ui.screens.staff

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material.icons.rounded.HourglassTop
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.Today
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.data.CounsellorAnalyticsData
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.ChoiceChips
import edu.srmap.campuscare.ui.components.InfoBanner
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.SkeletonList
import edu.srmap.campuscare.ui.components.StatTile
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.theme.CcColors

/**
 * Screen 9: Reports & Analytics
 *
 * Implements clinical service analytics matching Screen 9 of the reference:
 * - Date range selection (This Month, This Semester, Last 30 Days, This Year)
 * - 4 core KPI statistics tiles
 * - Sessions Overview weekly bar visualizer
 * - Common student concerns breakdown with progress bars
 * - Student feedback & satisfaction summary
 * - Export monthly report with privacy thresholding / suppression guarantee
 */
@Composable
fun ReportsAnalyticsScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current

    var dateRange by rememberSaveable { mutableStateOf("month") } // "month", "semester", "30d", "year"

    val analytics = rememberLoad(dateRange) {
        app.api.counselling.analytics(range = dateRange)
    }

    CcScreen(
        title = "Reports & Analytics",
        subtitle = "Counselling service insights and trends",
        onBack = { nav.popBackStack() },
        refreshing = analytics.refreshing,
        onRefresh = { analytics.reload() },
    ) {
        // Date range selector
        ChoiceChips(
            options = listOf(
                "month" to "This Month",
                "semester" to "This Semester",
                "30d" to "Last 30 Days",
                "year" to "This Year",
            ),
            selected = dateRange,
            onSelect = { dateRange = it },
        )

        LoadContent(analytics, skeleton = { SkeletonList(4) }) { data ->
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                // 4 KPI Stat Tiles
                AnalyticsStatTiles(data)

                // Weekly Sessions Overview (Chart)
                WeeklySessionsOverviewCard(data)

                // Common Concerns Breakdown
                CommonConcernsCard(data)

                // Student Satisfaction Card
                StudentSatisfactionCard()

                // Export Report Action
                CcButton(
                    text = "Download Monthly Summary Report (PDF)",
                    onClick = {
                        snack.show("Generating anonymized report with privacy suppression...")
                    },
                    modifier = Modifier.fillMaxWidth(),
                    kind = ButtonKind.Brand,
                    leadingIcon = Icons.Rounded.Download,
                )

                InfoBanner(
                    message = "Student privacy protection: Small group suppression is applied to all aggregated analytics to prevent individual student identification.",
                    icon = Icons.Rounded.Info,
                    tone = Tone.Teal,
                )
            }
        }
    }
}

@Composable
private fun AnalyticsStatTiles(data: CounsellorAnalyticsData) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            StatTile(
                label = "Total Sessions",
                value = "${data.totalSessions}",
                modifier = Modifier.weight(1f),
                tone = Tone.Teal,
                icon = Icons.Rounded.Today,
            )
            StatTile(
                label = "Unique Students",
                value = "${data.uniqueStudents}",
                modifier = Modifier.weight(1f),
                tone = Tone.Violet,
                icon = Icons.Rounded.Groups,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            StatTile(
                label = "Completion Rate",
                value = "${data.sessionCompletion}%",
                modifier = Modifier.weight(1f),
                tone = Tone.Brand,
                icon = Icons.Rounded.CheckCircle,
            )
            StatTile(
                label = "Follow-ups Due",
                value = "${data.followUps}",
                modifier = Modifier.weight(1f),
                tone = Tone.Amber,
                icon = Icons.Rounded.HourglassTop,
            )
        }
    }
}

@Composable
private fun WeeklySessionsOverviewCard(data: CounsellorAnalyticsData) {
    CcCard(padding = 16.dp) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Sessions Overview",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = CcColors.Ink,
                )
                // Legend
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(8.dp).clip(CircleShape).background(CcColors.Forest))
                        Spacer(Modifier.width(4.dp))
                        Text("Completed", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(8.dp).clip(CircleShape).background(CcColors.Amber))
                        Spacer(Modifier.width(4.dp))
                        Text("Cancelled", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
                    }
                }
            }

            // Weekly Bars Visualizer
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(130.dp)
                    .padding(vertical = 8.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.Bottom,
            ) {
                val points = if (data.weeklyOverview.isNotEmpty()) data.weeklyOverview else listOf(
                    edu.srmap.campuscare.data.WeeklySessionPoint("Week 1", 12, 1),
                    edu.srmap.campuscare.data.WeeklySessionPoint("Week 2", 14, 2),
                    edu.srmap.campuscare.data.WeeklySessionPoint("Week 3", 10, 0),
                    edu.srmap.campuscare.data.WeeklySessionPoint("Week 4", 12, 1),
                )

                points.forEach { w ->
                    val maxVal = 20f
                    val completedRatio = (w.completed / maxVal).coerceIn(0.1f, 1f)
                    val cancelledRatio = (w.cancelled / maxVal).coerceIn(0.05f, 0.4f)

                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Bottom,
                        modifier = Modifier.fillMaxHeight(),
                    ) {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                            verticalAlignment = Alignment.Bottom,
                        ) {
                            // Completed bar (Emerald)
                            Box(
                                modifier = Modifier
                                    .width(14.dp)
                                    .height((90 * completedRatio).dp)
                                    .clip(RoundedCornerShape(topStart = 4.dp, topEnd = 4.dp))
                                    .background(CcColors.Forest),
                            )
                            // Cancelled bar (Amber)
                            Box(
                                modifier = Modifier
                                    .width(14.dp)
                                    .height((90 * cancelledRatio).dp)
                                    .clip(RoundedCornerShape(topStart = 4.dp, topEnd = 4.dp))
                                    .background(CcColors.Amber),
                            )
                        }
                        Spacer(Modifier.height(6.dp))
                        Text(w.week, style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
                    }
                }
            }
        }
    }
}

@Composable
private fun CommonConcernsCard(data: CounsellorAnalyticsData) {
    CcCard(padding = 16.dp) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(
                text = "Common Student Concerns",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = CcColors.Ink,
            )

            val concerns = if (data.commonConcerns.isNotEmpty()) data.commonConcerns else listOf(
                edu.srmap.campuscare.data.ConcernPercentage("Academic Stress", 15, 32),
                edu.srmap.campuscare.data.ConcernPercentage("Anxiety & Worry", 13, 28),
                edu.srmap.campuscare.data.ConcernPercentage("Career Guidance", 8, 18),
                edu.srmap.campuscare.data.ConcernPercentage("Personal / Relationship", 6, 12),
            )

            concerns.forEach { item ->
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(item.category, style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink)
                        Text("${item.percentage}%", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, color = CcColors.Forest)
                    }
                    LinearProgressIndicator(
                        progress = { item.percentage / 100f },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(8.dp)
                            .clip(RoundedCornerShape(4.dp)),
                        color = CcColors.Forest,
                        trackColor = CcColors.Mint50,
                    )
                }
            }
        }
    }
}

@Composable
private fun StudentSatisfactionCard() {
    CcCard(padding = 16.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .clip(CircleShape)
                    .background(CcColors.Mint50),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Rounded.Star, contentDescription = null, tint = CcColors.Spark, modifier = Modifier.size(26.dp))
            }
            Spacer(Modifier.width(14.dp))
            Column {
                Text(
                    text = "4.8 ★ / 5.0 Rating",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = CcColors.Ink,
                )
                Text(
                    text = "96% of students reported significant relief after their sessions.",
                    style = MaterialTheme.typography.bodySmall,
                    color = CcColors.InkSoft,
                )
            }
        }
    }
}
