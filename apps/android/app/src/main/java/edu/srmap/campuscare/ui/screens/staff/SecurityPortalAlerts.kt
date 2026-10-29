package edu.srmap.campuscare.ui.screens.staff

import android.content.Intent
import android.net.Uri
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
import androidx.compose.material.icons.rounded.Call
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Navigation
import androidx.compose.material.icons.rounded.NearMe
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.Place
import androidx.compose.material.icons.rounded.Search
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import edu.srmap.campuscare.data.SecuritySosAlertItem
import edu.srmap.campuscare.ui.components.Avatar
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.CcTextField
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.SkeletonList
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.enterStagger
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.theme.CcColors
import kotlinx.coroutines.launch

/**
 * Screen 2: Active SOS Alerts (Part A)
 *
 * Visual elements matching reference:
 * - Header: "Active SOS Alerts", "Real-time emergency requests", notification bell
 * - Search bar: "Search alerts by student, location, ID..."
 * - Tabs: Active (2) / Resolved (14)
 * - Emergency SOS cards with red HIGH badge, student details, location, phone call CTA,
 *   quote, and [Navigate] / [Acknowledge] action buttons.
 */
@Composable
fun SecurityAlertsScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var activeTab by remember { mutableStateOf("active") }
    var searchQuery by remember { mutableStateOf("") }

    val alertsLoad = rememberLoad(activeTab to searchQuery) {
        app.api.securityPortal.alerts(tab = activeTab, q = searchQuery.ifBlank { null })
    }

    LaunchedEffect(Unit) {
        app.realtime.events.collect { e ->
            if (e.name == "sos:raised" || e.name == "sos:updated") {
                alertsLoad.reload()
            }
        }
    }

    CcScreen(
        title = "Active SOS Alerts",
        subtitle = "Real-time emergency requests",
        actions = {
            IconButton(onClick = { nav.navigate(Routes.Notifications) }) {
                Icon(
                    imageVector = Icons.Rounded.Notifications,
                    contentDescription = "Notifications",
                    tint = CcColors.Forest,
                )
            }
        },
        onRefresh = { alertsLoad.reload() },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            // Search Input
            CcTextField(
                value = searchQuery,
                onValueChange = { searchQuery = it },
                label = "Search",
                placeholder = "Search alerts by student, location, ID...",
                leadingIcon = Icons.Rounded.Search,
                modifier = Modifier.fillMaxWidth(),
            )

            // Segmented Tabs: Active / Resolved
            TabRow(
                selectedTabIndex = if (activeTab == "active") 0 else 1,
                containerColor = Color.Transparent,
                contentColor = CcColors.Forest,
                indicator = { tabPositions ->
                    val idx = if (activeTab == "active") 0 else 1
                    SecondaryIndicator(
                        Modifier.tabIndicatorOffset(tabPositions[idx]),
                        color = CcColors.Forest,
                        height = 3.dp,
                    )
                },
                divider = {},
            ) {
                Tab(
                    selected = activeTab == "active",
                    onClick = { activeTab = "active" },
                    text = {
                        Text(
                            text = "Active",
                            fontWeight = if (activeTab == "active") FontWeight.Bold else FontWeight.Medium,
                            color = if (activeTab == "active") CcColors.Forest else CcColors.InkSoft,
                        )
                    },
                )
                Tab(
                    selected = activeTab == "resolved",
                    onClick = { activeTab = "resolved" },
                    text = {
                        Text(
                            text = "Resolved",
                            fontWeight = if (activeTab == "resolved") FontWeight.Bold else FontWeight.Medium,
                            color = if (activeTab == "resolved") CcColors.Forest else CcColors.InkSoft,
                        )
                    },
                )
            }

            // Alerts Content
            LoadContent(
                alertsLoad,
                skeleton = { SkeletonList(3) },
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
                                text = if (activeTab == "active") "No active SOS alerts" else "No resolved alerts",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold,
                                color = CcColors.Ink,
                            )
                            Text(
                                text = "Campus safety is secure.",
                                style = MaterialTheme.typography.bodySmall,
                                color = CcColors.InkSoft,
                            )
                        }
                    }
                } else {
                    data.items.forEachIndexed { idx, item ->
                        SosAlertDetailCard(
                            item = item,
                            modifier = Modifier.enterStagger(idx),
                            onCardClick = { nav.navigate(Routes.securityResponse(item.id)) },
                            onCallStudent = {
                                if (item.studentPhone.isNotBlank()) {
                                    val intent = Intent(Intent.ACTION_DIAL, Uri.parse("tel:${item.studentPhone}"))
                                    context.startActivity(intent)
                                } else {
                                    snack.show("Student phone number not available")
                                }
                            },
                            onNavigate = { nav.navigate(Routes.SecurityMap) },
                            onAcknowledge = {
                                scope.launch {
                                    try {
                                        app.api.securityPortal.updateStatus(item.id, "acknowledged", notes = "Acknowledged by officer")
                                        snack.show("Alert ${item.alertNumber} acknowledged")
                                        alertsLoad.reload()
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
private fun SosAlertDetailCard(
    item: SecuritySosAlertItem,
    modifier: Modifier = Modifier,
    onCardClick: () -> Unit,
    onCallStudent: () -> Unit,
    onNavigate: () -> Unit,
    onAcknowledge: () -> Unit,
) {
    CcCard(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onCardClick),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            // Header: Alert ID and Badges
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = item.alertNumber,
                        fontWeight = FontWeight.Black,
                        fontSize = 15.sp,
                        color = CcColors.Ink,
                    )
                    StatusChip(
                        text = item.severity.uppercase(),
                        tone = if (item.severity == "critical") Tone.Danger else Tone.Amber,
                    )
                }

                StatusChip(
                    text = item.status.replace('_', ' ').uppercase(),
                    tone = when (item.status) {
                        "resolved" -> Tone.Brand
                        "en_route", "acknowledged" -> Tone.Sky
                        else -> Tone.Danger
                    },
                )
            }

            // Student Information
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Avatar(name = item.studentName, size = 42.dp)
                    Column {
                        Text(
                            text = item.studentName,
                            fontWeight = FontWeight.Bold,
                            style = MaterialTheme.typography.bodyLarge,
                            color = CcColors.Ink,
                        )
                        Text(
                            text = item.studentDept,
                            style = MaterialTheme.typography.bodySmall,
                            color = CcColors.InkSoft,
                        )
                    }
                }

                // Call Student Action Button
                if (item.studentPhone.isNotBlank()) {
                    Box(
                        modifier = Modifier
                            .size(36.dp)
                            .clip(CircleShape)
                            .background(CcColors.Forest.copy(alpha = 0.1f))
                            .clickable(onClick = onCallStudent),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            imageVector = Icons.Rounded.Call,
                            contentDescription = "Call Student",
                            tint = CcColors.Forest,
                            modifier = Modifier.size(18.dp),
                        )
                    }
                }
            }

            // Location & Distance
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
                    text = item.locationLabel,
                    fontWeight = FontWeight.Medium,
                    fontSize = 13.sp,
                    color = CcColors.Ink,
                )
                Text(
                    text = "• ${item.distanceKm} km away",
                    fontSize = 12.sp,
                    color = CcColors.InkSoft,
                )
            }

            // Quote Box
            if (item.description.isNotBlank()) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(CcColors.Cream)
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                ) {
                    Text(
                        text = "\"${item.description}\"",
                        style = MaterialTheme.typography.bodySmall,
                        color = CcColors.Ink,
                        fontStyle = FontStyle.Italic,
                    )
                }
            }

            // Action Buttons
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
                if (item.status in listOf("queued", "sent", "sending")) {
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
                        onClick = onCardClick,
                        leadingIcon = Icons.AutoMirrored.Rounded.ArrowForward,
                        kind = ButtonKind.Soft,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }
    }
}
