package edu.srmap.campuscare.ui.screens.staff

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Chat
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.EventAvailable
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.School
import androidx.compose.material.icons.rounded.Videocam
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.Appointment
import edu.srmap.campuscare.ui.components.Avatar
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.ChoiceChips
import edu.srmap.campuscare.ui.components.EmptyState
import edu.srmap.campuscare.ui.components.InputDialog
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
import edu.srmap.campuscare.ui.screens.student.appointmentTone
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.Fmt
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale
import kotlinx.coroutines.launch

/**
 * Screen 2: Appointments Schedule
 *
 * Implements the full schedule matching Screen 2 of the reference:
 * - Tabs: Today, Upcoming, Past
 * - Weekly horizontal calendar date picker strip
 * - Filter by mode (All, Online, In-Person)
 * - Appointment cards with rich student context, meeting mode, status, and quick actions
 * - Direct "Start Session" entry into the online counselling room
 * - FAB for managing hours and availability
 */
@Composable
fun CounsellorAppointmentsScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()

    var tabFilter by rememberSaveable { mutableStateOf("today") } // "today", "upcoming", "past"
    var modeFilter by rememberSaveable { mutableStateOf("all") } // "all", "online", "in_person"
    var selectedDate by rememberSaveable { mutableStateOf(LocalDate.now().toString()) }

    val list = rememberLoad { app.api.counselling.appointments() }

    LaunchedEffect(Unit) {
        app.realtime.events.collect { e ->
            if (e.name == "appointment:updated" || e.name == "counselling:request") {
                list.reload()
            }
        }
    }

    var declineTargetId by remember { mutableStateOf<String?>(null) }
    var actionBusy by remember { mutableStateOf(false) }

    fun updateStatus(id: String, status: String, reason: String? = null) {
        scope.launch {
            actionBusy = true
            try {
                app.api.counselling.update(id, status = status, reason = reason)
                list.reload()
                snack.show("Session marked as $status.")
            } catch (e: ApiException) {
                snack.error(e)
            } finally {
                actionBusy = false
            }
        }
    }

    CcScreen(
        title = "Appointments Schedule",
        subtitle = "Manage sessions and consultations",
        refreshing = list.refreshing,
        onRefresh = { list.reload() },
        floating = {
            FloatingActionButton(
                onClick = { nav.navigate(Routes.Availability) },
                containerColor = CcColors.Forest,
                contentColor = Color.White,
                shape = CircleShape,
            ) {
                Icon(Icons.Rounded.Add, contentDescription = "Manage Availability")
            }
        },
    ) {
        // Tab Filters: Today, Upcoming, Past
        ChoiceChips(
            options = listOf(
                "today" to "Today",
                "upcoming" to "Upcoming",
                "past" to "Past",
            ),
            selected = tabFilter,
            onSelect = {
                tabFilter = it
                if (it == "today") selectedDate = LocalDate.now().toString()
            },
        )

        // Weekly horizontal date strip
        WeeklyDateStrip(
            selectedDate = LocalDate.parse(selectedDate),
            onDateSelected = { selectedDate = it.toString() },
        )

        // Mode Filters: All, Online, In-Person
        ChoiceChips(
            options = listOf(
                "all" to "All Modes",
                "online" to "Online Video",
                "in_person" to "In Person",
            ),
            selected = modeFilter,
            onSelect = { modeFilter = it },
        )

        LoadContent(list, skeleton = { SkeletonList(4) }) { allAppointments ->
            val now = Instant.now()
            val parsedSelectedDate = runCatching { LocalDate.parse(selectedDate) }.getOrDefault(LocalDate.now())

            val filtered = allAppointments.filter { a ->
                // Mode filter
                val matchesMode = when (modeFilter) {
                    "online" -> a.mode == "online"
                    "in_person" -> a.mode != "online"
                    else -> true
                }

                val apptInstant = Fmt.parse(a.startAt) ?: now
                val apptDate = apptInstant.atZone(ZoneId.systemDefault()).toLocalDate()

                val matchesTab = when (tabFilter) {
                    "today" -> apptDate == parsedSelectedDate
                    "upcoming" -> apptInstant >= now && (a.status in setOf("confirmed", "rescheduled", "requested"))
                    "past" -> apptInstant < now || a.status in setOf("completed", "cancelled", "missed", "rejected")
                    else -> true
                }

                matchesMode && matchesTab
            }.sortedBy { it.startAt }

            if (filtered.isEmpty()) {
                EmptyState(
                    title = "No appointments found",
                    message = if (tabFilter == "today") "No sessions booked for this day." else "No appointments match your filters.",
                    icon = Icons.Rounded.EventAvailable,
                    tone = Tone.Teal,
                )
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    filtered.forEachIndexed { i, a ->
                        Column(Modifier.enterStagger(i)) {
                            AppointmentScheduleCard(
                                appointment = a,
                                onAccept = { updateStatus(a.id, "confirmed") },
                                onDecline = { declineTargetId = a.id },
                                onStartSession = { nav.navigate(Routes.onlineSession(a.id)) },
                                onViewDetails = { nav.navigate(Routes.appointment(a.id)) },
                                busy = actionBusy,
                            )
                        }
                    }
                }
            }
        }
    }

    declineTargetId?.let { id ->
        InputDialog(
            title = "Decline Appointment",
            message = "Provide a reason to the student explaining why the session cannot take place.",
            label = "Reason for declining",
            confirmLabel = "Decline Session",
            destructive = true,
            loading = actionBusy,
            onDismiss = { declineTargetId = null },
            onConfirm = { reason ->
                declineTargetId = null
                updateStatus(id, "rejected", reason.trim())
            },
        )
    }
}

@Composable
private fun WeeklyDateStrip(
    selectedDate: LocalDate,
    onDateSelected: (LocalDate) -> Unit,
) {
    val today = LocalDate.now()
    val startOfWeek = selectedDate.minusDays(3)
    val days = (0..6).map { startOfWeek.plusDays(it.toLong()) }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        days.forEach { date ->
            val isSelected = date == selectedDate
            val isToday = date == today

            val dayOfWeek = date.dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.ENGLISH)
            val dayOfMonth = date.dayOfMonth

            Box(
                modifier = Modifier
                    .width(52.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(
                        if (isSelected) CcColors.Forest else if (isToday) CcColors.Mint50 else CcColors.Surface
                    )
                    .border(
                        width = 1.dp,
                        color = if (isSelected) CcColors.Forest else if (isToday) CcColors.Mint else CcColors.Line,
                        shape = RoundedCornerShape(12.dp),
                    )
                    .clickable { onDateSelected(date) }
                    .padding(vertical = 8.dp),
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = dayOfWeek,
                        style = MaterialTheme.typography.labelSmall,
                        color = if (isSelected) Color.White.copy(alpha = 0.8f) else CcColors.InkSoft,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        text = "$dayOfMonth",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = if (isSelected) Color.White else CcColors.Ink,
                    )
                }
            }
        }
    }
}

@Composable
private fun AppointmentScheduleCard(
    appointment: Appointment,
    onAccept: () -> Unit,
    onDecline: () -> Unit,
    onStartSession: () -> Unit,
    onViewDetails: () -> Unit,
    busy: Boolean,
) {
    val nav = LocalNav.current

    CcCard(padding = 14.dp) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            // Student identity row
            Row(verticalAlignment = Alignment.CenterVertically) {
                Avatar(appointment.student?.name ?: "Student", tone = Tone.Violet, size = 46.dp)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        text = appointment.student?.name ?: "Student",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = CcColors.Ink,
                    )
                    Text(
                        text = listOfNotNull(appointment.student?.studentId, appointment.student?.department).joinToString(" · "),
                        style = MaterialTheme.typography.bodySmall,
                        color = CcColors.InkSoft,
                    )
                }
                StatusChip(
                    text = Fmt.humanize(appointment.status),
                    tone = appointmentTone(appointment.status),
                    dot = true,
                )
            }

            // Time & Mode information
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .background(CcColors.Cream)
                    .padding(horizontal = 10.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Rounded.CalendarMonth,
                        contentDescription = null,
                        tint = CcColors.Forest,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(
                        text = Fmt.dayTime(appointment.startAt),
                        style = MaterialTheme.typography.bodySmall,
                        fontWeight = FontWeight.Medium,
                        color = CcColors.Ink,
                    )
                }

                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = if (appointment.mode == "online") Icons.Rounded.Videocam else Icons.Rounded.School,
                        contentDescription = null,
                        tint = CcColors.Forest,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(
                        text = if (appointment.mode == "online") "Online Video" else "Room 203 (In-Person)",
                        style = MaterialTheme.typography.bodySmall,
                        fontWeight = FontWeight.Medium,
                        color = CcColors.Forest,
                    )
                }
            }

            // Reason if present
            appointment.reason?.takeIf { it.isNotBlank() }?.let { reason ->
                Text(
                    text = "Concern: $reason",
                    style = MaterialTheme.typography.bodySmall,
                    color = CcColors.InkSoft,
                    maxLines = 2,
                )
            }

            // Action Buttons
            when (appointment.status) {
                "requested" -> {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        CcButton(
                            text = "Accept",
                            onClick = onAccept,
                            modifier = Modifier.weight(1f),
                            kind = ButtonKind.Brand,
                            leadingIcon = Icons.Rounded.Check,
                            loading = busy,
                        )
                        CcButton(
                            text = "Decline",
                            onClick = onDecline,
                            modifier = Modifier.weight(1f),
                            kind = ButtonKind.Outline,
                            leadingIcon = Icons.Rounded.Close,
                        )
                        CcButton(
                            text = "View",
                            onClick = onViewDetails,
                            modifier = Modifier.weight(0.8f),
                            kind = ButtonKind.Ghost,
                        )
                    }
                }
                "confirmed", "rescheduled" -> {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (appointment.mode == "online") {
                            CcButton(
                                text = "Start Session",
                                onClick = onStartSession,
                                modifier = Modifier.weight(1.3f),
                                kind = ButtonKind.Brand,
                                leadingIcon = Icons.Rounded.Videocam,
                            )
                        }
                        CcButton(
                            text = "View Details",
                            onClick = onViewDetails,
                            modifier = Modifier.weight(1f),
                            kind = ButtonKind.Outline,
                        )
                    }
                }
                else -> {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        CcButton(
                            text = "View Session Record",
                            onClick = onViewDetails,
                            modifier = Modifier.fillMaxWidth(),
                            kind = ButtonKind.Outline,
                        )
                    }
                }
            }
        }
    }
}

