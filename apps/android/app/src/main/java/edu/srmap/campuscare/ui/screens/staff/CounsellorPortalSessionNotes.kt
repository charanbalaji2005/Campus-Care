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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.FormatBold
import androidx.compose.material.icons.rounded.FormatItalic
import androidx.compose.material.icons.rounded.FormatListBulleted
import androidx.compose.material.icons.rounded.FormatListNumbered
import androidx.compose.material.icons.rounded.FormatUnderlined
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.RadioButtonUnchecked
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
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
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.ui.components.Avatar
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.CcTextField
import edu.srmap.campuscare.ui.components.ChoiceChips
import edu.srmap.campuscare.ui.components.InfoBanner
import edu.srmap.campuscare.ui.components.InputDialog
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.MultiChoiceChips
import edu.srmap.campuscare.ui.components.SkeletonList
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.Fmt
import java.time.Instant
import kotlinx.coroutines.launch

/**
 * Screen 6: Session Notes Editor
 *
 * Implements clinical session documentation matching Screen 6 of the reference:
 * - Student and appointment context
 * - Rich formatting toolbar
 * - Multiline private notes editor
 * - Interactive key observation tags
 * - Action plan goals with checkboxes
 * - Follow-up review scheduling
 * - Confidentiality assurance
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionNotesEditorScreen(appointmentId: String) {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()

    val appt = rememberLoad(appointmentId) {
        if (appointmentId == "latest") {
            app.api.counselling.appointments().firstOrNull() ?: throw ApiException(404, "not_found", "No appointments available.")
        } else {
            app.api.counselling.appointments().firstOrNull { it.id == appointmentId } ?: throw ApiException(404, "not_found", "Appointment not found.")
        }
    }

    val pastNotes = rememberLoad(appointmentId) {
        if (appointmentId != "latest") app.api.counselling.notes(appointmentId) else emptyList()
    }

    var notesText by rememberSaveable { mutableStateOf("") }
    var followUpTimeframe by rememberSaveable { mutableStateOf("7") } // "none", "7", "14", "30"
    var outcome by rememberSaveable { mutableStateOf("progress") } // "progress", "stable", "monitoring", "referral"

    val selectedObservations = remember {
        mutableStateListOf(
            "Academic Stress",
            "Exam Anxiety",
        )
    }

    val availableObservations = listOf(
        "Academic Stress",
        "Exam Anxiety",
        "Sleep Deprivation",
        "Low Motivation",
        "Positive Coping",
        "Social Withdrawal",
        "Time Management",
    )

    data class ActionItem(val text: String, var done: Boolean = false)
    val actionPlanItems = remember {
        mutableStateListOf(
            ActionItem("Practice 4-7-8 breathing twice daily", true),
            ActionItem("Maintain sleep log for 7 days", false),
            ActionItem("Schedule academic advisor check-in", false),
        )
    }

    var newActionText by remember { mutableStateOf("") }
    var showCustomObsDialog by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }

    fun handleSaveNotes() {
        if (notesText.isBlank()) {
            snack.show("Please enter your clinical observations before saving.")
            return
        }

        scope.launch {
            busy = true
            try {
                val followUpIso = followUpTimeframe.toLongOrNull()?.let { days ->
                    Instant.now().plusSeconds(days * 86_400).toString()
                }

                val planText = buildString {
                    append("Observations: ").append(selectedObservations.joinToString(", ")).append("\n")
                    append("Action Plan:\n")
                    actionPlanItems.forEach { item ->
                        append(if (item.done) "[x] " else "[ ] ").append(item.text).append("\n")
                    }
                    append("Outcome Assessment: ").append(outcome.replaceFirstChar { it.uppercase() })
                }

                val targetId = appt.data?.id ?: appointmentId
                app.api.counselling.addNote(
                    id = targetId,
                    body = notesText.trim(),
                    supportPlan = planText,
                    followUpAt = followUpIso,
                )

                snack.show("Clinical session notes saved securely.")
                pastNotes.reload()
            } catch (e: ApiException) {
                snack.error(e)
            } finally {
                busy = false
            }
        }
    }

    CcScreen(
        title = "Session Notes",
        subtitle = appt.data?.student?.name?.let { "Clinical record for $it" } ?: "Session documentation",
        onBack = { nav.popBackStack() },
        refreshing = appt.refreshing,
        onRefresh = { appt.reload(); pastNotes.reload() },
        actions = {
            CcButton(
                text = "Save Notes",
                onClick = { handleSaveNotes() },
                kind = ButtonKind.Brand,
                loading = busy,
                leadingIcon = Icons.Rounded.Check,
            )
        },
    ) {
        LoadContent(appt, skeleton = { SkeletonList(3) }) { a ->
            // Student Context Card
            CcCard(padding = 14.dp) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Avatar(a.student?.name ?: "Student", tone = Tone.Violet, size = 48.dp)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            text = a.student?.name ?: "Student",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            color = CcColors.Ink,
                        )
                        Text(
                            text = listOfNotNull(a.student?.studentId, a.student?.department).joinToString(" · "),
                            style = MaterialTheme.typography.bodySmall,
                            color = CcColors.InkSoft,
                        )
                        Text(
                            text = "${Fmt.dayTime(a.startAt)} · ${if (a.mode == "online") "Online Video" else "In-Person"}",
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.Medium,
                            color = CcColors.Forest,
                        )
                    }
                }
            }

            // Confidentiality Banner
            InfoBanner(
                message = "Strictly Confidential: These clinical notes are restricted to you. They are never shared with students, faculty, or campus administrators.",
                icon = Icons.Rounded.Lock,
                tone = Tone.Violet,
            )

            // Formatting Toolbar & Clinical Notes TextArea
            CcCard(padding = 12.dp) {
                Text(
                    text = "Clinical Observations & Session Content",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = CcColors.Ink,
                )
                Spacer(Modifier.height(8.dp))

                // Toolbar
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(CcColors.Cream)
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    IconButton(onClick = { notesText += "**Bold Text**" }) {
                        Icon(Icons.Rounded.FormatBold, contentDescription = "Bold", tint = CcColors.Ink)
                    }
                    IconButton(onClick = { notesText += "_Italic Text_" }) {
                        Icon(Icons.Rounded.FormatItalic, contentDescription = "Italic", tint = CcColors.Ink)
                    }
                    IconButton(onClick = { notesText += "__Underlined Text__" }) {
                        Icon(Icons.Rounded.FormatUnderlined, contentDescription = "Underline", tint = CcColors.Ink)
                    }
                    IconButton(onClick = { notesText += "\n• " }) {
                        Icon(Icons.Rounded.FormatListBulleted, contentDescription = "Bullets", tint = CcColors.Ink)
                    }
                    IconButton(onClick = { notesText += "\n1. " }) {
                        Icon(Icons.Rounded.FormatListNumbered, contentDescription = "Numbers", tint = CcColors.Ink)
                    }
                }

                Spacer(Modifier.height(8.dp))

                CcTextField(
                    value = notesText,
                    onValueChange = { notesText = it },
                    label = "Clinical Notes",
                    placeholder = "Document presentation, mental status, reported triggers, interventions used, and student responses...",
                    singleLine = false,
                    minLines = 5,
                    maxLength = 5000,
                )
            }

            // Key Observations Section
            CcCard(padding = 12.dp) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "Key Observations",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                        color = CcColors.Ink,
                    )
                    IconButton(onClick = { showCustomObsDialog = true }) {
                        Icon(Icons.Rounded.Add, contentDescription = "Add Observation", tint = CcColors.Forest)
                    }
                }

                MultiChoiceChips(
                    options = availableObservations.map { it to it },
                    selected = selectedObservations.toSet(),
                    onToggle = { obs ->
                        if (obs in selectedObservations) selectedObservations.remove(obs)
                        else selectedObservations.add(obs)
                    },
                )
            }

            // Agreed Action Plan Section
            CcCard(padding = 12.dp) {
                Text(
                    text = "Agreed Action Plan",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = CcColors.Ink,
                )
                Spacer(Modifier.height(8.dp))

                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    actionPlanItems.forEachIndexed { index, item ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(8.dp))
                                .clickable {
                                    actionPlanItems[index] = item.copy(done = !item.done)
                                }
                                .padding(vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                imageVector = if (item.done) Icons.Rounded.CheckCircle else Icons.Rounded.RadioButtonUnchecked,
                                contentDescription = null,
                                tint = if (item.done) CcColors.Forest else CcColors.InkSoft,
                                modifier = Modifier.size(20.dp),
                            )
                            Spacer(Modifier.width(10.dp))
                            Text(
                                text = item.text,
                                style = MaterialTheme.typography.bodyMedium,
                                color = if (item.done) CcColors.InkSoft else CcColors.Ink,
                                modifier = Modifier.weight(1f),
                            )
                            IconButton(
                                onClick = { actionPlanItems.removeAt(index) },
                                modifier = Modifier.size(28.dp),
                            ) {
                                Icon(Icons.Rounded.Close, contentDescription = "Remove", tint = CcColors.InkSoft, modifier = Modifier.size(16.dp))
                            }
                        }
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CcTextField(
                            value = newActionText,
                            onValueChange = { newActionText = it },
                            label = "Add new action item",
                            modifier = Modifier.weight(1f),
                        )
                        CcButton(
                            text = "Add",
                            onClick = {
                                if (newActionText.isNotBlank()) {
                                    actionPlanItems.add(ActionItem(newActionText.trim()))
                                    newActionText = ""
                                }
                            },
                            kind = ButtonKind.Soft,
                        )
                    }
                }
            }

            // Session Outcome Assessment
            CcCard(padding = 12.dp) {
                Text(
                    text = "Session Outcome Assessment",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = CcColors.Ink,
                )
                Spacer(Modifier.height(8.dp))
                ChoiceChips(
                    options = listOf(
                        "progress" to "Positive Progress",
                        "stable" to "Stable",
                        "monitoring" to "Needs Monitoring",
                        "referral" to "Referral Recommended",
                    ),
                    selected = outcome,
                    onSelect = { outcome = it },
                )
            }

            // Follow-up Review Scheduling
            CcCard(padding = 12.dp) {
                Text(
                    text = "Recommended Follow-up Review",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = CcColors.Ink,
                )
                Spacer(Modifier.height(8.dp))
                ChoiceChips(
                    options = listOf(
                        "none" to "No follow-up",
                        "7" to "In 1 Week",
                        "14" to "In 2 Weeks",
                        "30" to "In 1 Month",
                    ),
                    selected = followUpTimeframe,
                    onSelect = { followUpTimeframe = it },
                )
            }

            // Previously Recorded Notes for this Appointment
            LoadContent(pastNotes, skeleton = { SkeletonList(1) }) { notesList ->
                if (notesList.isNotEmpty()) {
                    Text(
                        text = "Previously Saved Entries (${notesList.size})",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                        color = CcColors.Ink,
                    )
                    notesList.forEach { n ->
                        CcCard(padding = 12.dp) {
                            Text(n.body, style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink)
                            n.supportPlan?.let {
                                Spacer(Modifier.height(6.dp))
                                Text(it, style = MaterialTheme.typography.bodySmall, color = CcColors.Forest)
                            }
                            Spacer(Modifier.height(6.dp))
                            Text(
                                text = "Recorded ${Fmt.dateTime(n.createdAt)}",
                                style = MaterialTheme.typography.labelSmall,
                                color = CcColors.InkFaint,
                            )
                        }
                    }
                }
            }
        }
    }

    if (showCustomObsDialog) {
        InputDialog(
            title = "Add Key Observation",
            message = "Enter a custom observation or symptom tag.",
            label = "Observation tag",
            confirmLabel = "Add Tag",
            onDismiss = { showCustomObsDialog = false },
            onConfirm = { tag ->
                showCustomObsDialog = false
                if (tag.isNotBlank()) selectedObservations.add(tag.trim())
            },
        )
    }
}
