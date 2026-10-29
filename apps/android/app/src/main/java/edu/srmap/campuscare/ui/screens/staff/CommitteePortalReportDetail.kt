package edu.srmap.campuscare.ui.screens.staff

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.material.icons.rounded.AttachFile
import androidx.compose.material.icons.rounded.Call
import androidx.compose.material.icons.rounded.Email
import androidx.compose.material.icons.rounded.Folder
import androidx.compose.material.icons.rounded.Gavel
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.Place
import androidx.compose.material.icons.rounded.Security
import androidx.compose.material.icons.rounded.Warning
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import edu.srmap.campuscare.data.CommitteeEvidenceItem
import edu.srmap.campuscare.data.CommitteeReportDetail
import edu.srmap.campuscare.data.CommitteeTimelineItem
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
 * Screen 3: Report Details & Review (Part B)
 *
 * Visual elements matching reference:
 * - Header: Case `#2026-0871`, title "Verbal Harassment near Library", status badge "NEW", priority "HIGH"
 * - Segmented Tabs: "Details" / "Evidence (3)" / "Actions" / "History"
 * - Student Card: Ananya Reddy (2nd Year - CSE), ID, Email, Phone, and [View Student History] button
 * - Description Card: Full incident narrative and location
 * - Evidence Gallery: cards for attached items
 * - Quick Action Buttons: [Assign Member], [Request Info], [Start Review], and [🚨 Escalate to Security]
 */
@Composable
fun CommitteeReportDetailScreen(reportId: String) {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var selectedTab by remember { mutableStateOf("Details") }
    var showEscalateDialog by remember { mutableStateOf(false) }

    val reportLoad = rememberLoad(reportId) {
        app.api.committeePortal.reportDetail(reportId)
    }

    CcScreen(
        title = "Report Details",
        onRefresh = { reportLoad.reload() },
    ) {
        LoadContent(
            reportLoad,
            skeleton = { SkeletonList(count = 4) },
        ) { data ->
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                // Top Header Card with Case Number and Status
                ReportHeaderCard(data = data)

                // Segmented Tabs
                val tabs = listOf("Details", "Evidence (${data.evidence.size})", "Actions", "History")
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
                                    fontSize = 12.sp,
                                )
                            },
                        )
                    }
                }

                when (selectedTab) {
                    "Details" -> {
                        // Student Reporter Card
                        StudentReporterCard(
                            data = data,
                            onViewHistory = {
                                nav.navigate(Routes.committeeStudents(data.id))
                            },
                            onCall = {
                                if (data.student.phone.isNotBlank()) {
                                    val intent = Intent(Intent.ACTION_DIAL, Uri.parse("tel:${data.student.phone}"))
                                    context.startActivity(intent)
                                } else {
                                    snack.show("Phone number not available")
                                }
                            },
                        )

                        // Incident Description Card
                        CcCard(modifier = Modifier.fillMaxWidth()) {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(
                                    text = "Incident Narrative",
                                    fontWeight = FontWeight.Bold,
                                    style = MaterialTheme.typography.titleSmall,
                                    color = CcColors.Ink,
                                )
                                Text(
                                    text = data.description,
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = CcColors.Ink,
                                )
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
                                            tint = CcColors.Forest,
                                            modifier = Modifier.size(16.dp),
                                        )
                                        Text(
                                            text = data.location,
                                            style = MaterialTheme.typography.bodySmall,
                                            color = CcColors.InkSoft,
                                        )
                                    }

                                    StatusChip(
                                        text = data.priority.uppercase(),
                                        tone = if (data.priority == "high" || data.priority == "critical") Tone.Danger else Tone.Sky,
                                    )
                                }
                            }
                        }

                        // Evidence Gallery Thumbnail Grid
                        if (data.evidence.isNotEmpty()) {
                            SectionHeader("Evidence Files")
                            EvidenceGalleryRow(evidence = data.evidence)
                        }

                        // Actions & Workflow Section
                        SectionHeader("Review Workflow Actions")
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            CcButton(
                                text = "Start Review",
                                onClick = { nav.navigate(Routes.committeeInvestigation(data.id)) },
                                kind = ButtonKind.Primary,
                                modifier = Modifier.weight(1f),
                            )
                            CcButton(
                                text = "Involved Students",
                                onClick = { nav.navigate(Routes.committeeStudents(data.id)) },
                                kind = ButtonKind.Outline,
                                modifier = Modifier.weight(1f),
                            )
                        }

                        // Mandatory Section 1.C: Emergency Escalation Exception Button
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(12.dp))
                                .background(Color(0xFFFEF2F2))
                                .border(1.dp, Color(0xFFFCA5A5), RoundedCornerShape(12.dp))
                                .padding(12.dp),
                        ) {
                            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                                ) {
                                    Icon(
                                        imageVector = Icons.Rounded.Warning,
                                        contentDescription = null,
                                        tint = CcColors.Sos,
                                        modifier = Modifier.size(18.dp),
                                    )
                                    Text(
                                        text = "Immediate Threat Escalation",
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 13.sp,
                                        color = CcColors.Sos,
                                    )
                                }
                                Text(
                                    text = "If this report indicates an ongoing safety risk, escalate directly to on-duty Security Officers.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = CcColors.Ink,
                                )
                                CcButton(
                                    text = "🚨 Escalate to Security",
                                    onClick = { showEscalateDialog = true },
                                    kind = ButtonKind.Danger,
                                    modifier = Modifier.fillMaxWidth(),
                                )
                            }
                        }
                    }

                    "Evidence (${data.evidence.size})" -> {
                        SectionHeader("Attached Evidence & Files")
                        if (data.evidence.isEmpty()) {
                            CcCard {
                                Text("No evidence files submitted with this report.", color = CcColors.InkSoft)
                            }
                        } else {
                            data.evidence.forEach { file ->
                                EvidenceItemCard(file = file)
                            }
                        }
                    }

                    "Actions" -> {
                        SectionHeader("Investigation & Decisions")
                        CcButton(
                            text = "Open Investigation Form",
                            onClick = { nav.navigate(Routes.committeeInvestigation(data.id)) },
                            kind = ButtonKind.Primary,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }

                    "History" -> {
                        SectionHeader("Case Activity History")
                        CommitteeHistoryTimeline(timeline = data.timeline)
                    }
                }
            }
        }
    }

    // Emergency Escalation Dialog (Strict Section 1.C Rule)
    if (showEscalateDialog) {
        EmergencyEscalationDialog(
            caseNumber = reportLoad.data?.caseNumber ?: reportId,
            onDismiss = { showEscalateDialog = false },
            onConfirmEscalate = { urgency, notes ->
                scope.launch {
                    try {
                        val result = app.api.committeePortal.escalate(reportId, urgency, notes)
                        snack.show("Emergency escalation dispatched to Security Officers (${result.incidentRef})")
                        showEscalateDialog = false
                        reportLoad.reload()
                    } catch (e: Exception) {
                        snack.show(e.message ?: "Failed to escalate incident")
                    }
                }
            },
        )
    }
}

@Composable
private fun ReportHeaderCard(data: CommitteeReportDetail) {
    CcCard(modifier = Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = data.caseNumber,
                    fontWeight = FontWeight.Black,
                    fontSize = 17.sp,
                    color = CcColors.Ink,
                )
                StatusChip(
                    text = data.statusBadge,
                    tone = when (data.status) {
                        "submitted" -> Tone.Danger
                        "under_review", "in_review" -> Tone.Amber
                        "in_progress", "investigating" -> Tone.Sky
                        "resolved" -> Tone.Brand
                        else -> Tone.Neutral
                    },
                )
            }

            Text(
                text = data.title,
                fontWeight = FontWeight.Bold,
                fontSize = 16.sp,
                color = CcColors.Ink,
            )

            Text(
                text = "Category: ${data.categoryLabel.ifBlank { data.category }}",
                style = MaterialTheme.typography.bodySmall,
                color = CcColors.Forest,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

@Composable
private fun StudentReporterCard(
    data: CommitteeReportDetail,
    onViewHistory: () -> Unit,
    onCall: () -> Unit,
) {
    CcCard(modifier = Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
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
                            fontSize = 14.sp,
                            color = CcColors.Ink,
                        )
                        Text(
                            text = "${data.student.department} • ${data.student.studentId}",
                            style = MaterialTheme.typography.bodySmall,
                            color = CcColors.InkSoft,
                        )
                    }
                }

                if (data.student.phone.isNotBlank()) {
                    Box(
                        modifier = Modifier
                            .size(34.dp)
                            .clip(CircleShape)
                            .background(CcColors.Forest.copy(alpha = 0.1f))
                            .clickable(onClick = onCall),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            imageVector = Icons.Rounded.Call,
                            contentDescription = "Call",
                            tint = CcColors.Forest,
                            modifier = Modifier.size(16.dp),
                        )
                    }
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = data.student.email,
                    style = MaterialTheme.typography.bodySmall,
                    color = CcColors.InkSoft,
                )

                TextButton(onClick = onViewHistory) {
                    Text(
                        text = "View Student History",
                        color = CcColors.Forest,
                        fontWeight = FontWeight.Bold,
                        fontSize = 12.sp,
                    )
                }
            }
        }
    }
}

@Composable
private fun EvidenceGalleryRow(evidence: List<CommitteeEvidenceItem>) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        evidence.take(3).forEach { file ->
            Box(
                modifier = Modifier
                    .weight(1f)
                    .height(80.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(CcColors.Cream)
                    .border(1.dp, CcColors.InkSoft.copy(alpha = 0.2f), RoundedCornerShape(10.dp))
                    .padding(8.dp),
                contentAlignment = Alignment.Center,
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Icon(
                        imageVector = Icons.Rounded.AttachFile,
                        contentDescription = null,
                        tint = CcColors.Forest,
                        modifier = Modifier.size(22.dp),
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        text = file.name,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Medium,
                        color = CcColors.Ink,
                        maxLines = 1,
                    )
                }
            }
        }
    }
}

@Composable
private fun EvidenceItemCard(file: CommitteeEvidenceItem) {
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
                Icon(
                    imageVector = Icons.Rounded.AttachFile,
                    contentDescription = null,
                    tint = CcColors.Forest,
                )
                Column {
                    Text(
                        text = file.name,
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp,
                        color = CcColors.Ink,
                    )
                    Text(
                        text = file.mimeType ?: "Attachment",
                        style = MaterialTheme.typography.bodySmall,
                        color = CcColors.InkSoft,
                    )
                }
            }

            StatusChip(text = "ATTACHED", tone = Tone.Sky)
        }
    }
}

@Composable
private fun CommitteeHistoryTimeline(timeline: List<CommitteeTimelineItem>) {
    CcCard(modifier = Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (timeline.isEmpty()) {
                Text("No activity logged yet.", color = CcColors.InkSoft)
            } else {
                timeline.forEachIndexed { idx, item ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            modifier = Modifier
                                .size(8.dp)
                                .clip(CircleShape)
                                .background(if (idx == timeline.size - 1) CcColors.Emerald else CcColors.InkSoft),
                        )
                        Text(
                            text = item.body.ifBlank { item.type },
                            style = MaterialTheme.typography.bodySmall,
                            color = CcColors.Ink,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun EmergencyEscalationDialog(
    caseNumber: String,
    onDismiss: () -> Unit,
    onConfirmEscalate: (urgency: String, notes: String) -> Unit,
) {
    var notes by remember { mutableStateOf("") }
    var urgency by remember { mutableStateOf("critical") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("🚨 Escalate to Security Officers", fontWeight = FontWeight.Bold, color = CcColors.Sos) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    text = "This will immediately dispatch an emergency SOS alert strictly to authorized on-duty Security Officers, linking this case ($caseNumber).",
                    style = MaterialTheme.typography.bodySmall,
                    color = CcColors.Ink,
                )
                CcTextField(
                    value = notes,
                    onValueChange = { notes = it },
                    label = "Urgent Reason / Context",
                    placeholder = "Describe immediate threat requiring security intervention...",
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            CcButton(
                text = "Dispatch Security Alert",
                onClick = { onConfirmEscalate(urgency, notes) },
                kind = ButtonKind.Danger,
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

