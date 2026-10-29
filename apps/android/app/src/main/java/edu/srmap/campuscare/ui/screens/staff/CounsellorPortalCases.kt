package edu.srmap.campuscare.ui.screens.staff

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Folder
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.CounsellorCaseItem
import edu.srmap.campuscare.ui.components.Avatar
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.CcTextField
import edu.srmap.campuscare.ui.components.ChoiceChips
import edu.srmap.campuscare.ui.components.Divider
import edu.srmap.campuscare.ui.components.EmptyState
import edu.srmap.campuscare.ui.components.KeyValue
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.SkeletonList
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.enterStagger
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.Fmt
import kotlinx.coroutines.launch

/**
 * Screen 7: Case Management
 *
 * Implements full case tracking and campus team referral matching Screen 7:
 * - Active, Follow-up, and Closed case queues with real counters
 * - Search by student name, case number, or tagged concern
 * - Detailed case review dialog with observations and support goals
 * - Authorized referrals to campus support teams (Health Center, Academic Advisory, Welfare)
 * - Emergency Escalation workflow for critical crisis management
 */
@Composable
fun CaseManagementScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current

    var tabFilter by rememberSaveable { mutableStateOf("active") } // "active", "follow_up", "closed"
    var searchQuery by rememberSaveable { mutableStateOf("") }

    val casesLoad = rememberLoad(tabFilter) {
        app.api.counselling.cases(status = tabFilter)
    }

    LaunchedEffect(Unit) {
        app.realtime.events.collect { e ->
            if (e.name == "counselling:case" || e.name == "appointment:updated") {
                casesLoad.reload()
            }
        }
    }

    var selectedCaseId by remember { mutableStateOf<String?>(null) }

    CcScreen(
        title = "Case Management",
        subtitle = "Ongoing student care plans and referrals",
        refreshing = casesLoad.refreshing,
        onRefresh = { casesLoad.reload() },
    ) {
        LoadContent(casesLoad, skeleton = { SkeletonList(3) }) { resp ->
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                // Tab row with dynamic counts
                ChoiceChips(
                    options = listOf(
                        "active" to "Active (${resp.counts.active})",
                        "follow_up" to "Follow-up (${resp.counts.followUp})",
                        "closed" to "Closed (${resp.counts.closed})",
                    ),
                    selected = tabFilter,
                    onSelect = { tabFilter = it },
                )

                // Search bar
                CcTextField(
                    value = searchQuery,
                    onValueChange = { searchQuery = it },
                    label = "Search cases by name, number, or concern",
                    leadingIcon = Icons.Rounded.Search,
                )

                val filtered = resp.items.filter { c ->
                    searchQuery.isBlank() ||
                        c.studentName.contains(searchQuery, ignoreCase = true) ||
                        c.caseNumber.contains(searchQuery, ignoreCase = true) ||
                        c.concern.contains(searchQuery, ignoreCase = true)
                }

                if (filtered.isEmpty()) {
                    EmptyState(
                        title = "No cases found",
                        message = if (tabFilter == "active") "No active counselling cases." else "No cases in this queue.",
                        icon = Icons.Rounded.Folder,
                        tone = Tone.Teal,
                    )
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        filtered.forEachIndexed { i, c ->
                            Column(Modifier.enterStagger(i)) {
                                CaseItemCard(
                                    caseItem = c,
                                    onClick = { selectedCaseId = c.id },
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    selectedCaseId?.let { cid ->
        CaseDetailDialog(
            caseId = cid,
            onDismiss = { selectedCaseId = null },
            onUpdated = {
                selectedCaseId = null
                casesLoad.reload()
            },
        )
    }
}

@Composable
private fun CaseItemCard(
    caseItem: CounsellorCaseItem,
    onClick: () -> Unit,
) {
    CcCard(
        onClick = onClick,
        padding = 14.dp,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = caseItem.caseNumber,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Bold,
                    color = CcColors.Forest,
                )
                StatusChip(
                    text = Fmt.humanize(caseItem.status),
                    tone = when (caseItem.status) {
                        "active" -> Tone.Brand
                        "follow_up" -> Tone.Amber
                        else -> Tone.Teal
                    },
                    dot = true,
                )
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                Avatar(caseItem.studentName, tone = Tone.Violet, size = 42.dp)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        text = caseItem.studentName,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = CcColors.Ink,
                    )
                    Text(
                        text = "Concern: ${caseItem.concern}",
                        style = MaterialTheme.typography.bodySmall,
                        color = CcColors.InkSoft,
                    )
                }
                if (caseItem.priority == "high" || caseItem.priority == "critical") {
                    StatusChip(caseItem.priority.uppercase(), Tone.Rose)
                }
            }

            caseItem.reviewDate?.let { rd ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                ) {
                    Text(
                        text = "Review: ${Fmt.date(rd)}",
                        style = MaterialTheme.typography.labelSmall,
                        color = CcColors.InkFaint,
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CaseDetailDialog(
    caseId: String,
    onDismiss: () -> Unit,
    onUpdated: () -> Unit,
) {
    val app = LocalApp.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()

    val caseDetail = rememberLoad(caseId) {
        app.api.counselling.caseDetail(caseId)
    }

    var showReferralDialog by remember { mutableStateOf(false) }
    var showEscalationDialog by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }

    fun updateCaseStatus(newStatus: String) {
        scope.launch {
            busy = true
            try {
                app.api.counselling.updateCase(caseId, status = newStatus)
                snack.show("Case status updated to ${Fmt.humanize(newStatus)}.")
                onUpdated()
            } catch (e: ApiException) {
                snack.error(e)
            } finally {
                busy = false
            }
        }
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth(0.95f)
                .clip(RoundedCornerShape(20.dp)),
            color = CcColors.Surface,
            tonalElevation = 6.dp,
        ) {
            LoadContent(caseDetail, skeleton = { SkeletonList(3) }) { c ->
                Column(
                    modifier = Modifier
                        .padding(20.dp)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    // Header
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column {
                            Text(c.caseNumber, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, color = CcColors.Forest)
                            Text(c.student.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = CcColors.Ink)
                        }
                        IconButton(onClick = onDismiss) {
                            Icon(Icons.Rounded.Close, contentDescription = "Close", tint = CcColors.InkSoft)
                        }
                    }

                    // Key details card
                    CcCard(padding = 12.dp) {
                        KeyValue("Primary Concern", c.concern)
                        KeyValue("Priority", c.priority.replaceFirstChar { it.uppercase() })
                        KeyValue("Status", Fmt.humanize(c.status))
                        c.reviewDate?.let { KeyValue("Next Review Date", Fmt.date(it)) }
                    }

                    // Observations
                    if (c.keyObservations.isNotEmpty()) {
                        CcCard(padding = 12.dp) {
                            Text("Clinical Observations", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = CcColors.Ink)
                            Spacer(Modifier.height(6.dp))
                            c.keyObservations.forEach { obs ->
                                Text("• $obs", style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink)
                            }
                        }
                    }

                    // Support Plan
                    if (c.supportPlan.isNotEmpty()) {
                        CcCard(padding = 12.dp) {
                            Text("Agreed Support Plan", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = CcColors.Ink)
                            Spacer(Modifier.height(6.dp))
                            c.supportPlan.forEach { goal ->
                                Text("• $goal", style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink)
                            }
                        }
                    }

                    // Timeline & Referrals
                    if (c.referrals.isNotEmpty()) {
                        Text("Active Referrals", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = CcColors.Ink)
                        c.referrals.forEach { ref ->
                            CcCard(padding = 10.dp) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Icon(Icons.Rounded.Share, contentDescription = null, tint = CcColors.Forest, modifier = Modifier.size(18.dp))
                                    Spacer(Modifier.width(8.dp))
                                    Column {
                                        Text(ref.team, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                                        Text(ref.reason, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                                        ref.referredAt?.let { Text("Referred ${Fmt.date(it)}", style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint) }
                                    }
                                }
                            }
                        }
                    }

                    Divider()

                    // Action buttons
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        CcButton(
                            text = "Refer Team",
                            onClick = { showReferralDialog = true },
                            modifier = Modifier.weight(1f),
                            kind = ButtonKind.Soft,
                            leadingIcon = Icons.Rounded.Share,
                        )
                        CcButton(
                            text = "Emergency Escalation",
                            onClick = { showEscalationDialog = true },
                            modifier = Modifier.weight(1.3f),
                            kind = ButtonKind.Outline,
                            leadingIcon = Icons.Rounded.Warning,
                        )
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        if (c.status != "closed") {
                            CcButton(
                                text = "Close Case",
                                onClick = { updateCaseStatus("closed") },
                                modifier = Modifier.fillMaxWidth(),
                                kind = ButtonKind.Ghost,
                                loading = busy,
                            )
                        } else {
                            CcButton(
                                text = "Reopen Case",
                                onClick = { updateCaseStatus("active") },
                                modifier = Modifier.fillMaxWidth(),
                                kind = ButtonKind.Brand,
                                loading = busy,
                            )
                        }
                    }
                }

                // Referral Dialog
                if (showReferralDialog) {
                    ReferralSelectionDialog(
                        onDismiss = { showReferralDialog = false },
                        onConfirm = { team, reason ->
                            showReferralDialog = false
                            scope.launch {
                                try {
                                    app.api.counselling.referCase(caseId, team, reason)
                                    snack.show("Referral submitted to $team.")
                                    caseDetail.reload()
                                } catch (e: ApiException) {
                                    snack.error(e)
                                }
                            }
                        },
                    )
                }

                // Emergency Escalation Dialog
                if (showEscalationDialog) {
                    EmergencyEscalationDialog(
                        caseId = caseId,
                        studentName = c.student.name,
                        studentId = c.student.studentId ?: c.student.id,
                        onDismiss = { showEscalationDialog = false },
                        onSuccess = { res ->
                            snack.show("Emergency escalation dispatched. Ref: ${res.incidentRef}")
                            caseDetail.reload()
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun ReferralSelectionDialog(
    onDismiss: () -> Unit,
    onConfirm: (team: String, reason: String) -> Unit,
) {
    var selectedTeam by remember { mutableStateOf("Campus Health Center") }
    var referralReason by remember { mutableStateOf("") }

    val teams = listOf(
        "Campus Health Center",
        "Academic Advisory & Mentorship",
        "Student Welfare Committee",
        "Disability Support Services",
    )

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Refer Student to Campus Support Team") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Select authorized recipient team:", style = MaterialTheme.typography.bodyMedium)
                ChoiceChips(
                    options = teams.map { it to it },
                    selected = selectedTeam,
                    onSelect = { selectedTeam = it },
                )
                CcTextField(
                    value = referralReason,
                    onValueChange = { referralReason = it },
                    label = "Clinical reason for referral",
                    placeholder = "Describe recommended assistance or accommodation required...",
                    singleLine = false,
                    minLines = 2,
                )
            }
        },
        confirmButton = {
            CcButton(
                text = "Submit Referral",
                onClick = {
                    if (referralReason.isNotBlank()) {
                        onConfirm(selectedTeam, referralReason.trim())
                    }
                },
                kind = ButtonKind.Brand,
            )
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    )
}
