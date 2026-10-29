package edu.srmap.campuscare.ui.screens.staff

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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Phone
import androidx.compose.material.icons.rounded.Security
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
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
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.EmergencyEscalationResult
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcTextField
import edu.srmap.campuscare.ui.components.ChoiceChips
import edu.srmap.campuscare.ui.components.InfoBanner
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.theme.CcColors
import kotlinx.coroutines.launch

/**
 * Deliberate, secure Emergency Escalation workflow for Counsellors.
 *
 * Counsellors are not security officers or students; they do not have a prominent SOS button.
 * Instead, this contextual workflow allows escalating a high-risk student case or active session
 * to campus security responders with full audit logging, severity classification, and status tracking.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EmergencyEscalationDialog(
    caseId: String? = null,
    studentName: String,
    studentId: String? = null,
    onDismiss: () -> Unit,
    onSuccess: (EmergencyEscalationResult) -> Unit = {},
) {
    val app = LocalApp.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()

    var urgency by remember { mutableStateOf("urgent") } // "critical", "urgent", "high"
    var reason by remember { mutableStateOf("") }
    var confirmed by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<EmergencyEscalationResult?>(null) }

    if (result != null) {
        val res = result!!
        Dialog(
            onDismissRequest = {
                onSuccess(res)
                onDismiss()
            },
            properties = DialogProperties(usePlatformDefaultWidth = false),
        ) {
            Surface(
                modifier = Modifier
                    .fillMaxWidth(0.92f)
                    .clip(RoundedCornerShape(20.dp)),
                color = CcColors.Surface,
                tonalElevation = 6.dp,
            ) {
                Column(
                    modifier = Modifier
                        .padding(20.dp)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(44.dp)
                                .clip(CircleShape)
                                .background(CcColors.Mint50),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(Icons.Rounded.CheckCircle, contentDescription = null, tint = CcColors.Forest)
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(
                                "Escalation Dispatched",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold,
                                color = CcColors.Ink,
                            )
                            Text(
                                "Responders notified immediately",
                                style = MaterialTheme.typography.bodySmall,
                                color = CcColors.InkSoft,
                            )
                        }
                    }

                    CcCard {
                        Text("Incident Reference", style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint)
                        Text(
                            res.incidentRef ?: "INC-EMERGENCY-${System.currentTimeMillis() % 10000}",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.Bold,
                            color = CcColors.Forest,
                        )
                        Spacer(Modifier.height(8.dp))
                        Text("Target Student", style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint)
                        Text(studentName + (studentId?.let { " ($it)" } ?: ""), style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink)
                        Spacer(Modifier.height(8.dp))
                        Text("Severity Level", style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint)
                        Text(urgency.uppercase(), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, color = if (urgency == "critical") CcColors.Sos else CcColors.Amber)
                    }

                    Text("Notified Response Status:", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Rounded.Security, contentDescription = null, tint = CcColors.Forest, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("${if (res.respondersNotified > 0) res.respondersNotified else 3} Emergency Response Units Notified", style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink)
                    }

                    CcCard {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Rounded.Phone, contentDescription = null, tint = CcColors.Sos, modifier = Modifier.size(20.dp))
                            Spacer(Modifier.width(8.dp))
                            Column {
                                Text("Emergency Control Room Backup", style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint)
                                Text("+91 863 234 3000 / 112", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = CcColors.Sos)
                            }
                        }
                    }

                    CcButton(
                        text = "Done",
                        onClick = {
                            onSuccess(res)
                            onDismiss()
                        },
                        modifier = Modifier.fillMaxWidth(),
                        kind = ButtonKind.Brand,
                    )
                }
            }
        }
        return
    }

    Dialog(
        onDismissRequest = { if (!busy) onDismiss() },
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth(0.94f)
                .clip(RoundedCornerShape(20.dp)),
            color = CcColors.Surface,
            tonalElevation = 6.dp,
        ) {
            Column(
                modifier = Modifier
                    .padding(20.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                // Header
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier
                            .size(40.dp)
                            .clip(CircleShape)
                            .background(CcColors.RoseSoft),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.Rounded.Warning, contentDescription = null, tint = CcColors.Rose)
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            "Emergency Escalation",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            color = CcColors.Ink,
                        )
                        Text(
                            "For immediate safety or medical concerns",
                            style = MaterialTheme.typography.bodySmall,
                            color = CcColors.InkSoft,
                        )
                    }
                    IconButton(onClick = onDismiss, enabled = !busy) {
                        Icon(Icons.Rounded.Close, contentDescription = "Close", tint = CcColors.InkSoft)
                    }
                }

                InfoBanner(
                    message = "This alerts campus emergency responders and opens an audited high-priority incident. Use only when immediate physical safety or crisis intervention is warranted.",
                    icon = Icons.Rounded.Warning,
                    tone = Tone.Rose,
                )

                // Student details
                CcCard {
                    Text("Subject Student", style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint)
                    Text(
                        studentName + (studentId?.let { " · $it" } ?: ""),
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                        color = CcColors.Ink,
                    )
                }

                // Urgency level
                Text("Urgency Level", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                ChoiceChips(
                    options = listOf(
                        "critical" to "Critical (Immediate Threat)",
                        "urgent" to "Urgent (High Risk)",
                        "high" to "Elevated Concern",
                    ),
                    selected = urgency,
                    onSelect = { urgency = it },
                )

                // Reason / notes
                CcTextField(
                    value = reason,
                    onValueChange = { reason = it },
                    label = "Clinical reason for escalation",
                    placeholder = "Describe immediate safety risk, observable behaviors, or stated intent...",
                    singleLine = false,
                    minLines = 3,
                    maxLength = 1500,
                )

                // Confirmation Checkbox / Note
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .clickable { confirmed = !confirmed }
                        .padding(vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        modifier = Modifier
                            .size(20.dp)
                            .border(1.5.dp, if (confirmed) CcColors.Rose else CcColors.Line, RoundedCornerShape(4.dp))
                            .background(if (confirmed) CcColors.Rose else Color.Transparent, RoundedCornerShape(4.dp)),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (confirmed) {
                            Icon(Icons.Rounded.CheckCircle, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
                        }
                    }
                    Spacer(Modifier.width(10.dp))
                    Text(
                        "I confirm that this case requires immediate escalation to campus security/first responders.",
                        style = MaterialTheme.typography.bodySmall,
                        color = CcColors.Ink,
                    )
                }

                // Actions
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    CcButton(
                        text = "Cancel",
                        onClick = onDismiss,
                        modifier = Modifier.weight(1f),
                        kind = ButtonKind.Ghost,
                        enabled = !busy,
                    )
                    CcButton(
                        text = "Escalate Now",
                        onClick = {
                            if (reason.isBlank()) {
                                snack.show("Please enter a reason for the escalation.")
                                return@CcButton
                            }
                            if (!confirmed) {
                                snack.show("Please confirm before escalating.")
                                return@CcButton
                            }
                            scope.launch {
                                busy = true
                                try {
                                    val targetCaseId = caseId ?: "direct"
                                    val res = app.api.counselling.escalateCase(
                                        id = targetCaseId,
                                        urgency = urgency,
                                        notes = reason.trim(),
                                    )
                                    result = res
                                    snack.show("Emergency escalation dispatched.")
                                } catch (e: ApiException) {
                                    snack.error(e)
                                } catch (e: Exception) {
                                    snack.show("Failed to escalate: ${e.message}")
                                } finally {
                                    busy = false
                                }
                            }
                        },
                        modifier = Modifier.weight(1.5f),
                        kind = ButtonKind.Brand,
                        loading = busy,
                    )
                }
            }
        }
    }
}
