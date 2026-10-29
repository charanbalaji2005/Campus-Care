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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Call
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Map
import androidx.compose.material.icons.rounded.NearMe
import androidx.compose.material.icons.rounded.Place
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.TabRowDefaults.SecondaryIndicator
import androidx.compose.material3.TabRowDefaults.tabIndicatorOffset
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
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
import edu.srmap.campuscare.data.AssignedOfficerItem
import edu.srmap.campuscare.data.SecuritySosDetailData
import edu.srmap.campuscare.data.SecuritySosTimelineItem
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
import edu.srmap.campuscare.ui.components.SectionHeader
import edu.srmap.campuscare.ui.components.SkeletonList
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.theme.CcColors
import kotlinx.coroutines.launch

/**
 * Screen 4: SOS Response Details & Lifecycle (Part A)
 *
 * Visual elements matching reference:
 * - Alert header `#2026-1042`, status badge "IN PROGRESS", time "10:24 AM"
 * - Segmented Tabs: "Details" / "Updates" / "Team" / "Map"
 * - Student Card with name, department, and direct [Call] button
 * - Location Card: "Library Block - Room 202", Lat/Lng, and [View on Map]
 * - Description quote: "I feel unsafe. Someone is following me near the library."
 * - Assigned Officers list (Officer Kumar (You) - On the way, Officer Ravi, Officer Sita)
 * - Incident Timeline (Alert Triggered -> Acknowledged -> En Route)
 * - Bottom action bar: [Update Status] button with modal dialog
 */
@Composable
fun SecurityResponseDetailScreen(alertId: String) {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var selectedTab by remember { mutableStateOf("Details") }
    var showStatusModal by remember { mutableStateOf(false) }

    val alertDetailLoad = rememberLoad(alertId) {
        app.api.securityPortal.alertDetail(alertId)
    }

    CcScreen(
        title = "Response Details",
        onRefresh = { alertDetailLoad.reload() },
    ) {
        LoadContent(
            alertDetailLoad,
            skeleton = { SkeletonList(4) },
        ) { data ->
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                // Top Header Card with ID & Status
                AlertSummaryHeaderCard(data = data)

                // Segmented Tabs
                val tabs = listOf("Details", "Updates", "Team", "Map")
                TabRow(
                    selectedTabIndex = tabs.indexOf(selectedTab).coerceAtLeast(0),
                    containerColor = Color.Transparent,
                    contentColor = CcColors.Forest,
                    indicator = { tabPositions ->
                        val idx = tabs.indexOf(selectedTab).coerceAtLeast(0)
                        SecondaryIndicator(
                            Modifier.tabIndicatorOffset(tabPositions[idx]),
                            color = CcColors.Forest,
                            height = 3.dp,
                        )
                    },
                    divider = {},
                ) {
                    tabs.forEach { tab ->
                        Tab(
                            selected = selectedTab == tab,
                            onClick = { selectedTab = tab },
                            text = {
                                Text(
                                    text = tab,
                                    fontWeight = if (selectedTab == tab) FontWeight.Bold else FontWeight.Medium,
                                    color = if (selectedTab == tab) CcColors.Forest else CcColors.InkSoft,
                                    fontSize = 13.sp,
                                )
                            },
                        )
                    }
                }

                when (selectedTab) {
                    "Details" -> {
                        // Student Card with Direct Call Button
                        StudentContactCard(
                            data = data,
                            onCallStudent = {
                                if (data.student.phone.isNotBlank()) {
                                    val intent = Intent(Intent.ACTION_DIAL, Uri.parse("tel:${data.student.phone}"))
                                    context.startActivity(intent)
                                } else {
                                    snack.show("Student phone number not available")
                                }
                            },
                        )

                        // Location Card
                        LocationDetailsCard(
                            data = data,
                            onViewOnMap = { nav.navigate(Routes.SecurityMap) },
                        )

                        // Description Quote
                        if (data.description.isNotBlank()) {
                            CcCard {
                                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Text(
                                        text = "Student Note",
                                        fontWeight = FontWeight.Bold,
                                        style = MaterialTheme.typography.titleSmall,
                                        color = CcColors.Ink,
                                    )
                                    Box(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .clip(RoundedCornerShape(8.dp))
                                            .background(CcColors.Cream)
                                            .padding(12.dp),
                                    ) {
                                        Text(
                                            text = "\"${data.description}\"",
                                            style = MaterialTheme.typography.bodyMedium,
                                            color = CcColors.Ink,
                                            fontStyle = FontStyle.Italic,
                                        )
                                    }
                                }
                            }
                        }

                        // Assigned Officers Section
                        SectionHeader("Assigned Officers")
                        data.assignedOfficers.forEach { officer ->
                            AssignedOfficerRow(officer = officer)
                        }

                        // Timeline Section
                        SectionHeader("Incident Timeline")
                        IncidentTimelineView(timeline = data.timeline)
                    }

                    "Updates" -> {
                        SectionHeader("Incident Log & Updates")
                        IncidentTimelineView(timeline = data.timeline)
                    }

                    "Team" -> {
                        SectionHeader("Response Team")
                        data.assignedOfficers.forEach { officer ->
                            AssignedOfficerRow(officer = officer)
                        }
                    }

                    "Map" -> {
                        CcCard {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(
                                    text = "Location Preview",
                                    fontWeight = FontWeight.Bold,
                                    style = MaterialTheme.typography.titleSmall,
                                    color = CcColors.Ink,
                                )
                                Text(
                                    text = "${data.locationLabel} (${data.latitude}° N, ${data.longitude}° E)",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = CcColors.InkSoft,
                                )
                                CcButton(
                                    text = "Open in Campus Map",
                                    onClick = { nav.navigate(Routes.SecurityMap) },
                                    leadingIcon = Icons.Rounded.Place,
                                    kind = ButtonKind.Primary,
                                    modifier = Modifier.fillMaxWidth(),
                                )
                            }
                        }
                    }
                }

                Spacer(Modifier.height(8.dp))

                // Bottom Update Status Action
                CcButton(
                    text = "Update Status",
                    onClick = { showStatusModal = true },
                    leadingIcon = Icons.Rounded.CheckCircle,
                    kind = ButtonKind.Primary,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }

    // Status Update Dialog
    if (showStatusModal) {
        StatusUpdateDialog(
            currentStatus = alertDetailLoad.data?.status ?: "en_route",
            onDismiss = { showStatusModal = false },
            onUpdate = { newStatus, notes, outcome ->
                scope.launch {
                    try {
                        app.api.securityPortal.updateStatus(alertId, newStatus, notes, outcome)
                        snack.show("Status updated to ${newStatus.replace('_', ' ')}")
                        showStatusModal = false
                        alertDetailLoad.reload()
                    } catch (e: Exception) {
                        snack.show(e.message ?: "Failed to update status")
                    }
                }
            },
        )
    }
}

@Composable
private fun AlertSummaryHeaderCard(data: SecuritySosDetailData) {
    CcCard(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column {
                Text(
                    text = data.alertNumber,
                    fontWeight = FontWeight.Black,
                    fontSize = 18.sp,
                    color = CcColors.Ink,
                )
                Text(
                    text = "High Priority • SOS Alert",
                    style = MaterialTheme.typography.bodySmall,
                    color = CcColors.Sos,
                    fontWeight = FontWeight.SemiBold,
                )
            }

            StatusChip(
                text = data.statusLabel.uppercase(),
                tone = when (data.status) {
                    "resolved" -> Tone.Brand
                    "en_route", "acknowledged" -> Tone.Sky
                    else -> Tone.Danger
                },
            )
        }
    }
}

@Composable
private fun StudentContactCard(
    data: SecuritySosDetailData,
    onCallStudent: () -> Unit,
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
                Avatar(name = data.student.name, size = 44.dp)
                Column {
                    Text(
                        text = data.student.name,
                        fontWeight = FontWeight.Bold,
                        style = MaterialTheme.typography.bodyLarge,
                        color = CcColors.Ink,
                    )
                    Text(
                        text = data.student.department,
                        style = MaterialTheme.typography.bodySmall,
                        color = CcColors.InkSoft,
                    )
                }
            }

            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(20.dp))
                    .background(CcColors.Forest)
                    .clickable(onClick = onCallStudent)
                    .padding(horizontal = 14.dp, vertical = 8.dp),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Icon(
                        imageVector = Icons.Rounded.Call,
                        contentDescription = "Call",
                        tint = Color.White,
                        modifier = Modifier.size(16.dp),
                    )
                    Text(
                        text = "Call",
                        color = Color.White,
                        fontWeight = FontWeight.Bold,
                        fontSize = 13.sp,
                    )
                }
            }
        }
    }
}

@Composable
private fun LocationDetailsCard(
    data: SecuritySosDetailData,
    onViewOnMap: () -> Unit,
) {
    CcCard(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Box(
                    modifier = Modifier
                        .size(38.dp)
                        .clip(CircleShape)
                        .background(CcColors.Sos.copy(alpha = 0.12f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = Icons.Rounded.Place,
                        contentDescription = null,
                        tint = CcColors.Sos,
                        modifier = Modifier.size(20.dp),
                    )
                }

                Column {
                    Text(
                        text = data.locationLabel,
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp,
                        color = CcColors.Ink,
                    )
                    Text(
                        text = "${data.latitude}° N, ${data.longitude}° E",
                        fontSize = 11.sp,
                        color = CcColors.InkSoft,
                    )
                }
            }

            TextButton(onClick = onViewOnMap) {
                Text(
                    text = "View on Map",
                    color = CcColors.Forest,
                    fontWeight = FontWeight.Bold,
                    fontSize = 12.sp,
                )
            }
        }
    }
}

@Composable
private fun AssignedOfficerRow(officer: AssignedOfficerItem) {
    CcCard(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Avatar(name = officer.name, size = 34.dp)
                Text(
                    text = officer.name,
                    fontWeight = FontWeight.Bold,
                    fontSize = 13.sp,
                    color = CcColors.Ink,
                )
            }

            StatusChip(
                text = officer.status,
                tone = if (officer.status == "On site") Tone.Brand else Tone.Sky,
            )
        }
    }
}

@Composable
private fun IncidentTimelineView(timeline: List<SecuritySosTimelineItem>) {
    CcCard(modifier = Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            timeline.forEachIndexed { idx, item ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        modifier = Modifier
                            .size(10.dp)
                            .clip(CircleShape)
                            .background(if (idx == timeline.size - 1) CcColors.Emerald else CcColors.InkSoft),
                    )
                    Text(
                        text = item.label,
                        style = MaterialTheme.typography.bodySmall,
                        fontWeight = FontWeight.Medium,
                        color = CcColors.Ink,
                    )
                }
            }
        }
    }
}

@Composable
private fun StatusUpdateDialog(
    currentStatus: String,
    onDismiss: () -> Unit,
    onUpdate: (status: String, notes: String, outcome: String) -> Unit,
) {
    var selectedStatus by remember { mutableStateOf(currentStatus) }
    var notes by remember { mutableStateOf("") }
    var outcome by remember { mutableStateOf("assisted") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Update SOS Status", fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Select response stage:", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)

                listOf(
                    Pair("en_route", "En Route to Location"),
                    Pair("on_site", "Arrived On Site"),
                    Pair("resolved", "Resolved & Completed"),
                ).forEach { (st, label) ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(if (selectedStatus == st) CcColors.Forest.copy(alpha = 0.12f) else Color.Transparent)
                            .clickable { selectedStatus = st }
                            .padding(horizontal = 10.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = label,
                            fontWeight = if (selectedStatus == st) FontWeight.Bold else FontWeight.Normal,
                            color = if (selectedStatus == st) CcColors.Forest else CcColors.Ink,
                        )
                    }
                }

                CcTextField(
                    value = notes,
                    onValueChange = { notes = it },
                    label = "Officer Notes",
                    placeholder = "Describe current situation or actions taken...",
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            CcButton(
                text = "Save",
                onClick = { onUpdate(selectedStatus, notes, outcome) },
                kind = ButtonKind.Primary,
            )
        },
        dismissButton = {
            CcButton(
                text = "Cancel",
                onClick = onDismiss,
                kind = ButtonKind.Outline,
            )
        },
    )
}
