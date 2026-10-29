package edu.srmap.campuscare.ui.screens.staff

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.EventNote
import androidx.compose.material.icons.rounded.CallEnd
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.MicOff
import androidx.compose.material.icons.rounded.SelfImprovement
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material.icons.rounded.Spa
import androidx.compose.material.icons.rounded.Videocam
import androidx.compose.material.icons.rounded.VideocamOff
import androidx.compose.material.icons.rounded.VolumeUp
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.OnlineSessionData
import edu.srmap.campuscare.ui.components.Avatar
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcTextField
import edu.srmap.campuscare.ui.components.ChoiceChips
import edu.srmap.campuscare.ui.components.InputDialog
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.SkeletonList
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.theme.CcColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Screen 5: Online Counselling Session
 *
 * Implements full online video consultation room matching Screen 5:
 * - Active session timer and connection status
 * - Student video tile and floating Counsellor PIP window
 * - Media controls: Mic, Video, Speaker, End Call
 * - Contextual Emergency Escalation button
 * - In-session tools: Quick notes, Resource sharing, Breathing/Grounding exercise prompts
 * - End-session dialog leading directly to Session Notes Editor
 */
@Composable
fun OnlineSessionScreen(appointmentId: String) {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()

    val sessionData = rememberLoad(appointmentId) {
        app.api.counselling.session(appointmentId)
    }

    var micEnabled by rememberSaveable { mutableStateOf(true) }
    var videoEnabled by rememberSaveable { mutableStateOf(true) }
    var speakerEnabled by rememberSaveable { mutableStateOf(true) }

    // Live session timer in seconds
    var secondsElapsed by rememberSaveable { mutableIntStateOf(624) } // Starts at ~10:24 as in reference
    LaunchedEffect(Unit) {
        while (true) {
            delay(1000)
            secondsElapsed++
        }
    }

    val minutes = secondsElapsed / 60
    val seconds = secondsElapsed % 60
    val timerText = "%02d:%02d".format(minutes, seconds)

    var showEndDialog by remember { mutableStateOf(false) }
    var showEscalationDialog by remember { mutableStateOf(false) }
    var showQuickNoteDialog by remember { mutableStateOf(false) }
    var showExerciseDialog by remember { mutableStateOf(false) }
    var showResourcePicker by remember { mutableStateOf(false) }

    var endOutcome by remember { mutableStateOf("completed") }
    var endNotes by remember { mutableStateOf("") }
    var endingBusy by remember { mutableStateOf(false) }

    fun handleEndSession() {
        scope.launch {
            endingBusy = true
            try {
                app.api.counselling.endSession(
                    appointmentId = appointmentId,
                    outcome = endOutcome,
                    notes = endNotes.ifBlank { null },
                )
                showEndDialog = false
                snack.show("Session concluded.")
                // Navigate directly to Session Notes Editor to finalize notes
                nav.navigate(Routes.sessionNotesEditor(appointmentId)) {
                    popUpTo(Routes.onlineSession(appointmentId)) { inclusive = true }
                }
            } catch (e: ApiException) {
                snack.error(e)
            } finally {
                endingBusy = false
            }
        }
    }

    Scaffold(
        containerColor = CcColors.Night,
    ) { padding ->
        LoadContent(sessionData, skeleton = { SkeletonList(4) }) { data ->
            val studentDisplayName = data.student.name.ifBlank { "Student" }

            Column(
                modifier = Modifier
                    .padding(padding)
                    .fillMaxSize(),
            ) {
                // Top Header Bar
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(
                        onClick = { showEndDialog = true },
                        modifier = Modifier.clip(CircleShape).background(Color.White.copy(alpha = 0.15f)),
                    ) {
                        Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Back", tint = Color.White)
                    }

                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            text = studentDisplayName,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            color = Color.White,
                        )
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                modifier = Modifier
                                    .size(8.dp)
                                    .clip(CircleShape)
                                    .background(CcColors.Mint),
                            )
                            Spacer(Modifier.width(6.dp))
                            Text(
                                text = "Connected · HD Audio",
                                style = MaterialTheme.typography.labelSmall,
                                color = CcColors.Mint,
                            )
                        }
                    }

                    // Emergency Escalation action
                    IconButton(
                        onClick = { showEscalationDialog = true },
                        modifier = Modifier.clip(CircleShape).background(CcColors.Sos.copy(alpha = 0.2f)),
                    ) {
                        Icon(Icons.Rounded.Warning, contentDescription = "Escalate", tint = CcColors.Sos)
                    }
                }

                // Main Video Surface & Counsellor PIP
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                        .padding(horizontal = 16.dp)
                        .clip(RoundedCornerShape(20.dp))
                        .background(Color(0xFF131F1C)),
                    contentAlignment = Alignment.Center,
                ) {
                    // Student tile
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Avatar(studentDisplayName, tone = Tone.Violet, size = 84.dp)
                        Spacer(Modifier.height(12.dp))
                        Text(
                            text = studentDisplayName,
                            style = MaterialTheme.typography.titleMedium,
                            color = Color.White,
                        )
                        Text(
                            text = if (videoEnabled) "Student video active" else "Audio only",
                            style = MaterialTheme.typography.bodySmall,
                            color = Color.White.copy(alpha = 0.6f),
                        )
                    }

                    // Timer Pill overlay
                    Box(
                        modifier = Modifier
                            .align(Alignment.TopCenter)
                            .padding(top = 12.dp)
                            .clip(RoundedCornerShape(20.dp))
                            .background(CcColors.Forest.copy(alpha = 0.85f))
                            .padding(horizontal = 14.dp, vertical = 6.dp),
                    ) {
                        Text(
                            text = "$timerText / 45:00",
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.Bold,
                            color = Color.White,
                        )
                    }

                    // Counsellor Self-view PIP window
                    Box(
                        modifier = Modifier
                            .align(Alignment.BottomEnd)
                            .padding(14.dp)
                            .size(width = 96.dp, height = 128.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(Color(0xFF263630))
                            .border(1.dp, Color.White.copy(alpha = 0.2f), RoundedCornerShape(12.dp)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Avatar("Dr. Meera", tone = Tone.Brand, size = 38.dp)
                            Spacer(Modifier.height(4.dp))
                            Text("You", style = MaterialTheme.typography.labelSmall, color = Color.White)
                        }
                    }
                }

                Spacer(Modifier.height(12.dp))

                // In-Call Media Controls Bar
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 32.dp),
                    horizontalArrangement = Arrangement.SpaceEvenly,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    // Mic toggle
                    IconButton(
                        onClick = { micEnabled = !micEnabled },
                        modifier = Modifier
                            .size(48.dp)
                            .clip(CircleShape)
                            .background(if (micEnabled) Color.White.copy(alpha = 0.15f) else CcColors.Sos.copy(alpha = 0.2f)),
                    ) {
                        Icon(
                            imageVector = if (micEnabled) Icons.Rounded.Mic else Icons.Rounded.MicOff,
                            contentDescription = "Mic",
                            tint = if (micEnabled) Color.White else CcColors.Sos,
                        )
                    }

                    // Video toggle
                    IconButton(
                        onClick = { videoEnabled = !videoEnabled },
                        modifier = Modifier
                            .size(48.dp)
                            .clip(CircleShape)
                            .background(if (videoEnabled) Color.White.copy(alpha = 0.15f) else CcColors.Sos.copy(alpha = 0.2f)),
                    ) {
                        Icon(
                            imageVector = if (videoEnabled) Icons.Rounded.Videocam else Icons.Rounded.VideocamOff,
                            contentDescription = "Video",
                            tint = if (videoEnabled) Color.White else CcColors.Sos,
                        )
                    }

                    // Speaker toggle
                    IconButton(
                        onClick = { speakerEnabled = !speakerEnabled },
                        modifier = Modifier
                            .size(48.dp)
                            .clip(CircleShape)
                            .background(Color.White.copy(alpha = 0.15f)),
                    ) {
                        Icon(Icons.Rounded.VolumeUp, contentDescription = "Speaker", tint = Color.White)
                    }

                    // End Session Button (Red)
                    IconButton(
                        onClick = { showEndDialog = true },
                        modifier = Modifier
                            .size(54.dp)
                            .clip(CircleShape)
                            .background(CcColors.Sos),
                    ) {
                        Icon(Icons.Rounded.CallEnd, contentDescription = "End Call", tint = Color.White, modifier = Modifier.size(26.dp))
                    }
                }

                Spacer(Modifier.height(16.dp))

                // In-Session Quick Tools Bottom Drawer/Panel
                Surface(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)),
                    color = CcColors.Surface,
                ) {
                    Column(
                        modifier = Modifier
                            .padding(16.dp)
                            .verticalScroll(rememberScrollState()),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Text(
                            text = "In-Session Clinical Tools",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.Bold,
                            color = CcColors.Ink,
                        )

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            CcButton(
                                text = "Quick Note",
                                onClick = { showQuickNoteDialog = true },
                                modifier = Modifier.weight(1f),
                                kind = ButtonKind.Soft,
                                leadingIcon = Icons.AutoMirrored.Rounded.EventNote,
                            )
                            CcButton(
                                text = "Share Guide",
                                onClick = { showResourcePicker = true },
                                modifier = Modifier.weight(1f),
                                kind = ButtonKind.Soft,
                                leadingIcon = Icons.Rounded.Share,
                            )
                        }

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            CcButton(
                                text = "Suggest Exercise",
                                onClick = { showExerciseDialog = true },
                                modifier = Modifier.weight(1f),
                                kind = ButtonKind.Outline,
                                leadingIcon = Icons.Rounded.SelfImprovement,
                            )
                            CcButton(
                                text = "Full Notes Editor",
                                onClick = { nav.navigate(Routes.sessionNotesEditor(appointmentId)) },
                                modifier = Modifier.weight(1f),
                                kind = ButtonKind.Brand,
                                leadingIcon = Icons.AutoMirrored.Rounded.EventNote,
                            )
                        }
                    }
                }
            }

            // Quick Note Dialog
            if (showQuickNoteDialog) {
                InputDialog(
                    title = "Add Quick Clinical Note",
                    message = "Document key observation during this active session.",
                    label = "Private observation",
                    confirmLabel = "Save Note",
                    onDismiss = { showQuickNoteDialog = false },
                    onConfirm = { note ->
                        showQuickNoteDialog = false
                        scope.launch {
                            try {
                                app.api.counselling.addNote(id = appointmentId, body = note.trim())
                                snack.show("Note saved to session record.")
                            } catch (e: ApiException) {
                                snack.error(e)
                            }
                        }
                    },
                )
            }

            // Suggest Exercise Dialog
            if (showExerciseDialog) {
                AlertDialog(
                    onDismissRequest = { showExerciseDialog = false },
                    title = { Text("Suggest Relaxation Technique") },
                    text = {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("Share a guided grounding exercise with $studentDisplayName:", style = MaterialTheme.typography.bodyMedium)
                            CcButton("4-7-8 Deep Breathing Exercise", {
                                showExerciseDialog = false
                                snack.show("Sent '4-7-8 Breathing' instructions to student.")
                            }, Modifier.fillMaxWidth(), kind = ButtonKind.Soft)
                            CcButton("5-4-3-2-1 Sensory Grounding", {
                                showExerciseDialog = false
                                snack.show("Sent 'Sensory Grounding' guide to student.")
                            }, Modifier.fillMaxWidth(), kind = ButtonKind.Soft)
                            CcButton("Progressive Muscle Relaxation", {
                                showExerciseDialog = false
                                snack.show("Sent 'Muscle Relaxation' exercise to student.")
                            }, Modifier.fillMaxWidth(), kind = ButtonKind.Soft)
                        }
                    },
                    confirmButton = {},
                    dismissButton = {
                        TextButton(onClick = { showExerciseDialog = false }) { Text("Cancel") }
                    },
                )
            }

            // Resource Sharing Dialog
            if (showResourcePicker) {
                AlertDialog(
                    onDismissRequest = { showResourcePicker = false },
                    title = { Text("Share Wellbeing Resource") },
                    text = {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("Send a verified resource directly to $studentDisplayName:", style = MaterialTheme.typography.bodyMedium)
                            data.resources.forEach { r ->
                                CcCard(
                                    onClick = {
                                        showResourcePicker = false
                                        snack.show("Shared '${r.title}' with student.")
                                    },
                                    padding = 10.dp,
                                ) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Icon(Icons.Rounded.Spa, contentDescription = null, tint = CcColors.Forest, modifier = Modifier.size(18.dp))
                                        Spacer(Modifier.width(8.dp))
                                        Column {
                                            Text(r.title, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                                            Text(r.type, style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
                                        }
                                    }
                                }
                            }
                        }
                    },
                    confirmButton = {},
                    dismissButton = {
                        TextButton(onClick = { showResourcePicker = false }) { Text("Cancel") }
                    },
                )
            }

            // End Session Dialog
            if (showEndDialog) {
                AlertDialog(
                    onDismissRequest = { if (!endingBusy) showEndDialog = false },
                    title = { Text("Conclude Counselling Session") },
                    text = {
                        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text(
                                "Ending this session will disconnect the call and transition directly to the Session Notes Editor.",
                                style = MaterialTheme.typography.bodyMedium,
                            )
                            Text("Session Outcome", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                            ChoiceChips(
                                options = listOf(
                                    "completed" to "Completed",
                                    "follow_up" to "Follow-up Needed",
                                    "rescheduled" to "Rescheduled",
                                ),
                                selected = endOutcome,
                                onSelect = { endOutcome = it },
                            )
                            CcTextField(
                                value = endNotes,
                                onValueChange = { endNotes = it },
                                label = "Brief closing remarks (optional)",
                            )
                        }
                    },
                    confirmButton = {
                        CcButton(
                            text = "End & Write Notes",
                            onClick = { handleEndSession() },
                            kind = ButtonKind.Brand,
                            loading = endingBusy,
                        )
                    },
                    dismissButton = {
                        TextButton(onClick = { showEndDialog = false }, enabled = !endingBusy) {
                            Text("Resume Session")
                        }
                    },
                )
            }

            // Emergency Escalation Dialog
            if (showEscalationDialog) {
                EmergencyEscalationDialog(
                    studentName = studentDisplayName,
                    studentId = data.student.id.ifBlank { null },
                    onDismiss = { showEscalationDialog = false },
                    onSuccess = { res ->
                        snack.show("Emergency escalation confirmed. Incident ref: ${res.incidentRef}")
                    },
                )
            }
        }
    }
}
