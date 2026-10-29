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
import androidx.compose.material.icons.rounded.BarChart
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.TrendingUp
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import edu.srmap.campuscare.data.CommitteeAnalyticsData
import edu.srmap.campuscare.data.CommitteeReportsByTypeItem
import edu.srmap.campuscare.data.CommitteeStatusOverviewItem
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.SectionHeader
import edu.srmap.campuscare.ui.components.SkeletonList
import edu.srmap.campuscare.ui.components.StatTile
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.theme.CcColors

/**
 * Screen 6: Reports & Analytics (Part B)
 *
 * Visual elements matching reference:
 * - Header: "Reports & Analytics"
 * - Period Selector: Month / Semester / Year
 * - Metric Tiles: Total Reports, New, Resolved, Resolution Rate
 * - Reports by Type (Bar chart / category breakdown with colored progress bars)
 * - Status Overview distribution
 */
@Composable
fun CommitteeAnalyticsScreen() {
    val app = LocalApp.current

    var selectedRange by remember { mutableStateOf("month") }

    val analyticsLoad = rememberLoad(selectedRange) {
        app.api.committeePortal.analytics(range = selectedRange)
    }

    CcScreen(
        title = "Reports & Analytics",
        subtitle = "Incident volume and resolution trends",
        onRefresh = { analyticsLoad.reload() },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            // Period Selector Chips
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                listOf(
                    Pair("month", "This Month"),
                    Pair("semester", "This Semester"),
                    Pair("year", "This Year"),
                ).forEach { (key, label) ->
                    val isSel = selectedRange == key
                    FilterChip(
                        selected = isSel,
                        onClick = { selectedRange = key },
                        label = { Text(label, fontSize = 12.sp) },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = CcColors.Forest,
                            selectedLabelColor = Color.White,
                        ),
                    )
                }
            }

            LoadContent(
                analyticsLoad,
                skeleton = { SkeletonList(count = 4) },
            ) { data ->
                // Summary Metric Tiles
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    StatTile(
                        value = data.totalReports.toString(),
                        label = "Total Reports",
                        icon = Icons.Rounded.Description,
                        tone = Tone.Violet,
                        modifier = Modifier.weight(1f),
                    )
                    StatTile(
                        value = data.newReports.toString(),
                        label = "New Reports",
                        icon = Icons.Rounded.BarChart,
                        tone = Tone.Danger,
                        modifier = Modifier.weight(1f),
                    )
                    StatTile(
                        value = data.resolvedReports.toString(),
                        label = "Resolved",
                        icon = Icons.Rounded.CheckCircle,
                        tone = Tone.Brand,
                        modifier = Modifier.weight(1f),
                    )
                }

                // Reports by Type Section
                SectionHeader("Reports by Incident Type")
                CcCard(modifier = Modifier.fillMaxWidth()) {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        data.reportsByType.forEach { cat ->
                            CategoryBarRow(item = cat, maxCount = data.totalReports.coerceAtLeast(1))
                        }
                    }
                }

                // Status Overview Section
                SectionHeader("Status Distribution")
                CcCard(modifier = Modifier.fillMaxWidth()) {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        data.statusOverview.forEach { statusItem ->
                            StatusDistributionRow(item = statusItem)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CategoryBarRow(item: CommitteeReportsByTypeItem, maxCount: Int) {
    val barColor = runCatching { Color(android.graphics.Color.parseColor(item.color)) }.getOrDefault(CcColors.Forest)

    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = item.category,
                fontWeight = FontWeight.SemiBold,
                fontSize = 13.sp,
                color = CcColors.Ink,
            )
            Text(
                text = "${item.count} reports",
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                color = barColor,
            )
        }

        LinearProgressIndicator(
            progress = { (item.count.toFloat() / maxCount.toFloat()).coerceIn(0f, 1f) },
            modifier = Modifier
                .fillMaxWidth()
                .height(8.dp)
                .clip(RoundedCornerShape(4.dp)),
            color = barColor,
            trackColor = barColor.copy(alpha = 0.15f),
        )
    }
}

@Composable
private fun StatusDistributionRow(item: CommitteeStatusOverviewItem) {
    val dotColor = runCatching { Color(android.graphics.Color.parseColor(item.color)) }.getOrDefault(CcColors.Forest)

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(10.dp)
                    .clip(CircleShape)
                    .background(dotColor),
            )
            Text(
                text = item.status,
                fontWeight = FontWeight.Medium,
                fontSize = 13.sp,
                color = CcColors.Ink,
            )
        }

        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = "${item.count} reports",
                fontSize = 12.sp,
                color = CcColors.InkSoft,
            )
            Text(
                text = "${item.percentage}%",
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                color = CcColors.Ink,
            )
        }
    }
}

