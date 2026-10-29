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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.Gavel
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.theme.CcColors
import kotlinx.coroutines.launch

/**
 * Screen 4: Investigation & Actions (Part B)
 *
 * Form fields:
 * - Assign Member (dropdown)
 * - Due Date (date input)
 * - Internal Investigation Notes (multi-line)
 * - Status Selection (Under Review, In Progress, Action Required, Resolved, Closed)
 * - Findings & Resolution Summary
 * - [Save Changes] action button
 */
@Composable
fun CommitteeInvestigationScreen(reportId: String) {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()

    var assignedToName by remember { mutableStateOf("Dr. Priya Nair (You)") }
    var assignedToMenuExpanded by remember { mutableStateOf(false) }

    var dueDate by remember { mutableStateOf("2026-11-05") }
    var investigationNotes by remember { mutableStateOf("") }
    var findings by remember { mutableStateOf("") }

    var selectedStatus by remember { mutableStateOf("in_progress") }
    var statusMenuExpanded by remember { mutableStateOf(false) }

    val reportLoad = rememberLoad(reportId) {
        app.api.committeePortal.reportDetail(reportId)
    }

    CcScreen(
        title = "Investigation & Actions",
        subtitle = "Case record update",
    ) {
        LoadContent(
            reportLoad,
            skeleton = { SkeletonList(count = 3) },
        ) { data ->
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                // Header with Case Reference
                CcCard(modifier = Modifier.fillMaxWidth()) {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(
                            text = data.caseNumber,
                            fontWeight = FontWeight.Black,
                            fontSize = 16.sp,
                            color = CcColors.Ink,
                        )
                        Text(
                            text = data.title,
                            fontWeight = FontWeight.Bold,
                            fontSize = 14.sp,
                            color = CcColors.InkSoft,
                        )
                    }
                }

                SectionHeader("Investigation Parameters")

                // Assign Committee Member Dropdown
                Box {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("Assigned Member", style = MaterialTheme.typography.labelMedium, color = CcColors.Ink)
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(10.dp))
                                .background(Color.White)
                                .clickable { assignedToMenuExpanded = true }
                                .padding(horizontal = 14.dp, vertical = 12.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(assignedToName, style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink)
                            Icon(Icons.Rounded.ExpandMore, contentDescription = null, tint = CcColors.Forest)
                        }
                    }

                    DropdownMenu(
                        expanded = assignedToMenuExpanded,
                        onDismissRequest = { assignedToMenuExpanded = false },
                    ) {
                        listOf("Dr. Priya Nair (You)", "Dr. Kavya S", "Prof. Ramesh Kumar", "Adv. Suresh Babu").forEach { member ->
                            DropdownMenuItem(
                                text = { Text(member) },
                                onClick = {
                                    assignedToName = member
                                    assignedToMenuExpanded = false
                                },
                            )
                        }
                    }
                }

                // Due Date Field
                CcTextField(
                    value = dueDate,
                    onValueChange = { dueDate = it },
                    label = "Target Resolution Due Date (YYYY-MM-DD)",
                    leadingIcon = Icons.Rounded.CalendarMonth,
                    modifier = Modifier.fillMaxWidth(),
                )

                // Status Transition Dropdown
                val statusOptions = listOf(
                    Pair("under_review", "Under Review"),
                    Pair("in_progress", "In Progress / Active Inquiry"),
                    Pair("awaiting_information", "Awaiting Information"),
                    Pair("resolved", "Resolved"),
                    Pair("closed", "Closed"),
                )

                Box {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("Investigation Status", style = MaterialTheme.typography.labelMedium, color = CcColors.Ink)
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(10.dp))
                                .background(Color.White)
                                .clickable { statusMenuExpanded = true }
                                .padding(horizontal = 14.dp, vertical = 12.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            val label = statusOptions.firstOrNull { it.first == selectedStatus }?.second ?: selectedStatus
                            Text(label, style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink, fontWeight = FontWeight.Bold)
                            Icon(Icons.Rounded.ExpandMore, contentDescription = null, tint = CcColors.Forest)
                        }
                    }

                    DropdownMenu(
                        expanded = statusMenuExpanded,
                        onDismissRequest = { statusMenuExpanded = false },
                    ) {
                        statusOptions.forEach { (st, label) ->
                            DropdownMenuItem(
                                text = { Text(label) },
                                onClick = {
                                    selectedStatus = st
                                    statusMenuExpanded = false
                                },
                            )
                        }
                    }
                }

                SectionHeader("Confidential Findings")

                // Internal Investigation Notes Textarea
                CcTextField(
                    value = investigationNotes,
                    onValueChange = { investigationNotes = it },
                    label = "Internal Investigation Notes",
                    placeholder = "Record interviews, witness statements, CCTV review timestamps...",
                    modifier = Modifier.fillMaxWidth(),
                )

                // Resolution Summary
                CcTextField(
                    value = findings,
                    onValueChange = { findings = it },
                    label = "Findings & Action Taken",
                    placeholder = "Document disciplinary decision, mediation outcome, or restorative plan...",
                    modifier = Modifier.fillMaxWidth(),
                )

                Spacer(Modifier.height(8.dp))

                // Save Changes Button
                CcButton(
                    text = "Save Changes",
                    onClick = {
                        scope.launch {
                            try {
                                app.api.committeePortal.updateInvestigation(
                                    id = reportId,
                                    dueDate = dueDate,
                                    notes = investigationNotes.ifBlank { null },
                                    status = selectedStatus,
                                    findings = findings.ifBlank { null },
                                )
                                snack.show("Investigation updated for ${data.caseNumber}")
                                nav.popBackStack()
                            } catch (e: Exception) {
                                snack.show(e.message ?: "Failed to update investigation")
                            }
                        }
                    },
                    leadingIcon = Icons.Rounded.CheckCircle,
                    kind = ButtonKind.Primary,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

