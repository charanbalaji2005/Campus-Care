package edu.srmap.campuscare.ui.screens.staff

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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.Gavel
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.Place
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.TabRowDefaults.SecondaryIndicator
import androidx.compose.material3.TabRowDefaults.tabIndicatorOffset
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import edu.srmap.campuscare.data.CommitteeReportItem
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.CcTextField
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

/**
 * Screen 2: Incident Reports Queue (Part B)
 *
 * Visual elements matching reference:
 * - Header: "Incident Reports", "Review and investigate student reports", notification bell
 * - Search bar: "Search reports by case number, student, category..."
 * - Tabs: New / Under Review / In Progress / Resolved / Closed
 * - Detailed report cards with case number, category, description, and status chip
 */
@Composable
fun CommitteeReportsScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current

    var selectedTab by remember { mutableStateOf("new") }
    var searchQuery by remember { mutableStateOf("") }

    val reportsLoad = rememberLoad(selectedTab to searchQuery) {
        app.api.committeePortal.reports(tab = selectedTab, q = searchQuery.ifBlank { null })
    }

    LaunchedEffect(Unit) {
        app.realtime.events.collect { e ->
            if (e.name == "incident:created" || e.name == "incident:updated") {
                reportsLoad.reload()
            }
        }
    }

    CcScreen(
        title = "Incident Reports",
        subtitle = "Review and investigate student reports",
        actions = {
            IconButton(onClick = { nav.navigate(Routes.Notifications) }) {
                Icon(
                    imageVector = Icons.Rounded.Notifications,
                    contentDescription = "Notifications",
                    tint = CcColors.Forest,
                )
            }
        },
        onRefresh = { reportsLoad.reload() },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            // Search Input
            CcTextField(
                value = searchQuery,
                onValueChange = { searchQuery = it },
                label = "Search",
                placeholder = "Search by case #, title, category...",
                leadingIcon = Icons.Rounded.Search,
                modifier = Modifier.fillMaxWidth(),
            )

            // Segmented Tabs
            val tabs = listOf(
                Pair("new", "New"),
                Pair("under_review", "Under Review"),
                Pair("in_progress", "In Progress"),
                Pair("resolved", "Resolved"),
                Pair("closed", "Closed"),
            )

            TabRow(
                selectedTabIndex = tabs.indexOfFirst { it.first == selectedTab }.coerceAtLeast(0),
                containerColor = Color.Transparent,
                contentColor = CcColors.Forest,
                indicator = { tabPositions ->
                    val idx = tabs.indexOfFirst { it.first == selectedTab }.coerceAtLeast(0)
                    SecondaryIndicator(
                        Modifier.tabIndicatorOffset(tabPositions[idx]),
                        color = CcColors.Forest,
                        height = 3.dp,
                    )
                },
                divider = {},
            ) {
                tabs.forEach { (key, label) ->
                    Tab(
                        selected = selectedTab == key,
                        onClick = { selectedTab = key },
                        text = {
                            Text(
                                text = label,
                                fontWeight = if (selectedTab == key) FontWeight.Bold else FontWeight.Medium,
                                color = if (selectedTab == key) CcColors.Forest else CcColors.InkSoft,
                                fontSize = 12.sp,
                            )
                        },
                    )
                }
            }

            LoadContent(
                reportsLoad,
                skeleton = { SkeletonList(count = 4) },
            ) { data ->
                if (data.items.isEmpty()) {
                    CcCard {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.Center,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 24.dp),
                        ) {
                            Icon(
                                imageVector = Icons.Rounded.CheckCircle,
                                contentDescription = null,
                                tint = CcColors.Emerald,
                                modifier = Modifier.size(44.dp),
                            )
                            Spacer(Modifier.height(8.dp))
                            Text(
                                text = "No reports found in this category",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold,
                                color = CcColors.Ink,
                            )
                        }
                    }
                } else {
                    data.items.forEachIndexed { idx, item ->
                        ReportQueueCard(
                            item = item,
                            modifier = Modifier.enterStagger(idx),
                            onClick = { nav.navigate(Routes.committeeReportDetail(item.id)) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ReportQueueCard(
    item: CommitteeReportItem,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    CcCard(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            // Header with Case Number and Status Badge
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = item.caseNumber,
                        fontWeight = FontWeight.Black,
                        fontSize = 14.sp,
                        color = CcColors.Ink,
                    )
                    StatusChip(
                        text = item.statusBadge.uppercase(),
                        tone = when (item.status) {
                            "submitted" -> Tone.Danger
                            "under_review", "in_review" -> Tone.Amber
                            "in_progress", "investigating" -> Tone.Sky
                            "resolved" -> Tone.Brand
                            else -> Tone.Neutral
                        },
                    )
                }

                StatusChip(
                    text = item.categoryLabel.ifBlank { item.category },
                    tone = Tone.Violet,
                )
            }

            // Report Title
            Text(
                text = item.title,
                fontWeight = FontWeight.Bold,
                fontSize = 15.sp,
                color = CcColors.Ink,
            )

            // Description Snippet
            if (item.description.isNotBlank()) {
                Text(
                    text = item.description,
                    style = MaterialTheme.typography.bodySmall,
                    color = CcColors.InkSoft,
                    maxLines = 2,
                )
            }

            // Location & Timestamp
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Icon(
                        imageVector = Icons.Rounded.Place,
                        contentDescription = null,
                        tint = CcColors.InkSoft,
                        modifier = Modifier.size(14.dp),
                    )
                    Text(
                        text = item.location,
                        style = MaterialTheme.typography.bodySmall,
                        color = CcColors.InkSoft,
                    )
                }

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    Text(
                        text = "Review",
                        color = CcColors.Forest,
                        fontWeight = FontWeight.Bold,
                        fontSize = 12.sp,
                    )
                    Icon(
                        imageVector = Icons.AutoMirrored.Rounded.ArrowForward,
                        contentDescription = null,
                        tint = CcColors.Forest,
                        modifier = Modifier.size(14.dp),
                    )
                }
            }
        }
    }
}

