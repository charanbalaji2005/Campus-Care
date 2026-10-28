package edu.srmap.campuscare.ui.screens.staff

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Chat
import androidx.compose.material.icons.automirrored.rounded.EventNote
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Event
import androidx.compose.material.icons.rounded.EventAvailable
import androidx.compose.material.icons.rounded.Forum
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material.icons.rounded.HourglassTop
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.Psychology
import androidx.compose.material.icons.rounded.Schedule
import androidx.compose.material.icons.rounded.SupportAgent
import androidx.compose.material.icons.rounded.Videocam
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.Appointment
import edu.srmap.campuscare.data.Availability
import edu.srmap.campuscare.data.WeeklyWindow
import edu.srmap.campuscare.ui.components.Avatar
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.CcSelect
import edu.srmap.campuscare.ui.components.CcTextField
import edu.srmap.campuscare.ui.components.Catalog
import edu.srmap.campuscare.ui.components.ChoiceChips
import edu.srmap.campuscare.ui.components.MultiChoiceChips
import edu.srmap.campuscare.ui.components.Divider
import edu.srmap.campuscare.ui.components.EmptyState
import edu.srmap.campuscare.ui.components.IconBadge
import edu.srmap.campuscare.ui.components.InfoBanner
import edu.srmap.campuscare.ui.components.InputDialog
import edu.srmap.campuscare.ui.components.KeyValue
import edu.srmap.campuscare.ui.components.ListRow
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.SectionHeader
import edu.srmap.campuscare.ui.components.SkeletonList
import edu.srmap.campuscare.ui.components.StatTile
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.SwitchRow
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.enterStagger
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.screens.student.appointmentTone
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.Fmt
import edu.srmap.campuscare.util.openUrl
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset
import kotlinx.coroutines.launch
import androidx.compose.material.icons.rounded.Verified

private val ACTIVE = setOf("requested", "confirmed", "rescheduled")
private val WEEKDAYS = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")
private val HALF_HOURS = (14..43).map { i -> "%02d:%02d".format(i / 2, (i % 2) * 30) } // 07:00 – 21:30

@Composable
fun CounsellorHomeScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val user by app.session.user.collectAsState()
    val stats = rememberLoad { app.api.counselling.stats() }
    val upcoming = rememberLoad { app.api.counselling.appointments(upcoming = true) }
    LaunchedEffect(Unit) { app.realtime.events.collect { e -> if (e.name == "appointment:updated" || e.name == "notification") { stats.reload(); upcoming.reload() } } }
    CcScreen(title = "${Fmt.greeting()}, ${user?.firstName ?: ""}", subtitle = "Your counselling day", refreshing = upcoming.refreshing, onRefresh = { stats.reload(); upcoming.reload() }) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            StatTile("Today", "${stats.data?.today ?: 0}", Modifier.weight(1f), tone = Tone.Violet, icon = Icons.Rounded.Event)
            StatTile("Awaiting reply", "${stats.data?.pending ?: 0}", Modifier.weight(1f), tone = Tone.Amber, icon = Icons.Rounded.HourglassTop)
        }
        LoadContent(upcoming, skeleton = { SkeletonList(3) }) { list ->
            val requests = list.filter { it.status == "requested" }
            val today = list.filter { it.status in setOf("confirmed", "rescheduled") && Fmt.parse(it.startAt)?.atZone(ZoneId.systemDefault())?.toLocalDate() == LocalDate.now() }
            val later = list.filter { it.status in setOf("confirmed", "rescheduled") && it !in today }
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (requests.isNotEmpty()) {
                    SectionHeader("New requests (${requests.size})")
                    requests.forEachIndexed { i, a -> Column(Modifier.enterStagger(i)) { CounsellorAppointmentRow(a) } }
                }
                SectionHeader("Today")
                if (today.isEmpty()) CcCard { Text("No sessions today.", style = MaterialTheme.typography.bodyMedium, color = CcColors.InkSoft) }
                today.forEachIndexed { i, a -> Column(Modifier.enterStagger(requests.size + i)) { CounsellorAppointmentRow(a) } }
                if (later.isNotEmpty()) {
                    SectionHeader("Coming up", action = "All sessions", onAction = { nav.navigate(Routes.CounsellorAppointments) })
                    later.take(5).forEachIndexed { i, a -> Column(Modifier.enterStagger(requests.size + today.size + i)) { CounsellorAppointmentRow(a) } }
                }
            }
        }
        CcCard(padding = 8.dp) {
            ListRow("My Availability & duty", subtitle = "On/off duty, daily capacity, breaks, custom dates", icon = Icons.Rounded.Schedule, tone = Tone.Brand, onClick = { nav.navigate(Routes.MySchedule) })
            Divider()
            ListRow("Profile & weekly hours", subtitle = "Bio, specialisations, languages, slot length", icon = Icons.Rounded.Schedule, tone = Tone.Teal, onClick = { nav.navigate(Routes.Availability) })
            Divider()
            ListRow("My students", subtitle = "Students you've seen and follow-ups", icon = Icons.Rounded.Groups, tone = Tone.Violet, onClick = { nav.navigate(Routes.CounsellorStudents) })
            Divider()
            ListRow("Private student chats", subtitle = "One-to-one conversations students started with you", icon = Icons.Rounded.Forum, tone = Tone.Violet, onClick = { nav.navigate(Routes.CounsellorChats) })
            Divider()
            ListRow("Official Counselling Support", subtitle = "Channel posts, drafts and engagement (verified publishers)", icon = Icons.Rounded.Verified, tone = Tone.Brand, onClick = { nav.navigate(Routes.CounsellingChannel) })
        }
        InfoBanner("Your session notes are private to you. Committees and administrators can't read them.", icon = Icons.Rounded.Lock, tone = Tone.Violet)
    }
}

@Composable
private fun CounsellorAppointmentRow(a: Appointment) {
    val nav = LocalNav.current
    CcCard(onClick = { nav.navigate(Routes.appointment(a.id)) }) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Avatar(a.student?.name ?: "Student", tone = Tone.Violet)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(a.student?.name ?: "Student", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                Text("${Fmt.dayTime(a.startAt)} · ${if (a.mode == "online") "Online" else "In person"}", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
            }
            StatusChip(Fmt.humanize(a.status), appointmentTone(a.status))
        }
    }
}

@Composable
fun CounsellorAppointmentsScreen() {
    val app = LocalApp.current
    var filter by rememberSaveable { mutableStateOf("upcoming") }
    val list = rememberLoad { app.api.counselling.appointments() }
    CcScreen(title = "Sessions", subtitle = "Requests, upcoming and past", refreshing = list.refreshing, onRefresh = { list.reload() }) {
        ChoiceChips(listOf("requested" to "Requests", "upcoming" to "Upcoming", "past" to "Past"), filter, { filter = it })
        LoadContent(list, skeleton = { SkeletonList(5) }) { all ->
            val now = Instant.now()
            val items = when (filter) {
                "requested" -> all.filter { it.status == "requested" }
                "upcoming" -> all.filter { it.status in setOf("confirmed", "rescheduled") && (Fmt.parse(it.startAt) ?: now) >= now.minusSeconds(3600) }.sortedBy { it.startAt }
                else -> all.filter { it.status !in ACTIVE || (Fmt.parse(it.startAt) ?: now) < now.minusSeconds(3600) }
            }
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (items.isEmpty()) EmptyState("Nothing here", icon = Icons.Rounded.EventAvailable, tone = Tone.Violet)
                items.forEachIndexed { i, a -> Column(Modifier.enterStagger(i)) { CounsellorAppointmentRow(a) } }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppointmentScreen(id: String) {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val appt = rememberLoad(id) { app.api.counselling.appointments().firstOrNull { it.id == id } ?: throw ApiException(404, "not_found", "This appointment is no longer available.") }
    val notes = rememberLoad(id) { app.api.counselling.notes(id) }
    var reasonFor by remember { mutableStateOf<String?>(null) }
    var linkOpen by remember { mutableStateOf(false) }
    var rescheduleOpen by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var noteText by rememberSaveable { mutableStateOf("") }
    var plan by rememberSaveable { mutableStateOf("") }
    var followUpDays by rememberSaveable { mutableStateOf("none") }

    fun update(status: String? = null, reason: String? = null, startAt: String? = null, link: String? = null) {
        scope.launch {
            busy = true
            try {
                appt.set(app.api.counselling.update(id, status, reason, startAt, link))
                snack.show("Appointment updated.")
            } catch (e: ApiException) {
                snack.error(e)
            } finally {
                busy = false
            }
        }
    }

    CcScreen(title = "Session", subtitle = appt.data?.let { Fmt.dayTime(it.startAt) }, onBack = { nav.popBackStack() }, refreshing = appt.refreshing, onRefresh = { appt.reload(); notes.reload() }) {
        LoadContent(appt) { a ->
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                CcCard {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Avatar(a.student?.name ?: "Student", tone = Tone.Violet, size = 52.dp)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(a.student?.name ?: "Student", style = MaterialTheme.typography.titleMedium, color = CcColors.Ink)
                            Text(listOfNotNull(a.student?.studentId, a.student?.department).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                        }
                        StatusChip(Fmt.humanize(a.status), appointmentTone(a.status), dot = true)
                    }
                    KeyValue("When", Fmt.dayTime(a.startAt) + (a.endAt?.let { " – ${Fmt.time(it)}" } ?: ""))
                    KeyValue("Mode", if (a.mode == "online") "Online" else "In person")
                    KeyValue("Student's note", a.reason)
                    KeyValue("Meeting link", a.meetingLink)
                    KeyValue("Status note", a.statusReason)
                }
                if (a.status in ACTIVE) {
                    when (a.status) {
                        "requested" -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            CcButton("Confirm", { if (a.mode == "online" && a.meetingLink.isNullOrBlank()) linkOpen = true else update(status = "confirmed") }, Modifier.weight(1f), kind = ButtonKind.Brand, loading = busy, leadingIcon = Icons.Rounded.Check)
                            CcButton("Decline", { reasonFor = "rejected" }, Modifier.weight(1f), kind = ButtonKind.Outline, leadingIcon = Icons.Rounded.Close)
                        }
                        else -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            CcButton("Completed", { update(status = "completed") }, Modifier.weight(1f), kind = ButtonKind.Brand, loading = busy)
                            CcButton("Missed", { update(status = "missed") }, Modifier.weight(1f), kind = ButtonKind.Outline)
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        CcButton("New time", { rescheduleOpen = true }, Modifier.weight(1f), kind = ButtonKind.Soft, leadingIcon = Icons.Rounded.CalendarMonth)
                        CcButton("Cancel", { reasonFor = "cancelled" }, Modifier.weight(1f), kind = ButtonKind.Ghost)
                    }
                    if (a.mode == "online") CcButton(if (a.meetingLink.isNullOrBlank()) "Add meeting link" else "Change meeting link", { linkOpen = true }, Modifier.fillMaxWidth(), kind = ButtonKind.Soft, leadingIcon = Icons.Rounded.Videocam)
                    a.meetingLink?.takeIf { it.isNotBlank() }?.let { l -> CcButton("Join meeting", { context.openUrl(l) }, Modifier.fillMaxWidth(), kind = ButtonKind.Outline) }
                }
                a.threadId?.let { t -> CcButton("Message student", { nav.navigate(Routes.chat(t)) }, Modifier.fillMaxWidth(), kind = ButtonKind.Soft, leadingIcon = Icons.AutoMirrored.Rounded.Chat) }
                CcButton("Reminders & follow-up tasks", { nav.navigate(Routes.appointmentReminders(a.id, counsellor = true)) }, Modifier.fillMaxWidth(), kind = ButtonKind.Outline)

                SectionHeader("Private notes")
                InfoBanner("Only you can read these notes. They are stored separately and are not visible to administrators or committees.", icon = Icons.Rounded.Lock, tone = Tone.Violet)
                CcCard {
                    CcTextField(noteText, { noteText = it }, label = "Session note", singleLine = false, minLines = 3, maxLength = 5000)
                    CcTextField(plan, { plan = it }, label = "Support plan (optional)", singleLine = false, minLines = 2, maxLength = 2000, modifier = Modifier.padding(top = 8.dp))
                    Text("Follow-up", style = MaterialTheme.typography.labelLarge, color = CcColors.InkSoft, modifier = Modifier.padding(top = 8.dp))
                    ChoiceChips(listOf("none" to "None", "7" to "1 week", "14" to "2 weeks", "30" to "1 month"), followUpDays, { followUpDays = it })
                    CcButton("Save note", {
                        if (noteText.isBlank()) return@CcButton
                        scope.launch {
                            try {
                                val follow = followUpDays.toLongOrNull()?.let { Instant.now().plusSeconds(it * 86_400).toString() }
                                val n = app.api.counselling.addNote(id, noteText.trim(), plan.trim().ifBlank { null }, follow)
                                notes.set(notes.data.orEmpty() + n)
                                noteText = ""; plan = ""; followUpDays = "none"
                            } catch (e: ApiException) {
                                snack.error(e)
                            }
                        }
                    }, Modifier.fillMaxWidth().padding(top = 8.dp), leadingIcon = Icons.AutoMirrored.Rounded.EventNote)
                }
                LoadContent(notes, skeleton = { SkeletonList(1) }) { list ->
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        list.asReversed().forEach { n ->
                            CcCard {
                                Text(n.body, style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink)
                                n.supportPlan?.let { Text("Plan: $it", style = MaterialTheme.typography.bodySmall, color = CcColors.Forest, modifier = Modifier.padding(top = 6.dp)) }
                                Text(listOfNotNull(Fmt.dateTime(n.createdAt), n.followUpAt?.let { "follow up ${Fmt.date(it)}" }).joinToString(" · "), style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint, modifier = Modifier.padding(top = 4.dp))
                            }
                        }
                    }
                }
            }
        }
    }

    reasonFor?.let { target ->
        InputDialog(
            if (target == "rejected") "Decline request" else "Cancel session",
            "The student sees this reason. Suggest another option if you can.",
            label = "Reason for the student", confirmLabel = if (target == "rejected") "Decline" else "Cancel session", destructive = true, loading = busy,
            onDismiss = { reasonFor = null },
            onConfirm = { r -> reasonFor = null; update(status = target, reason = r.trim()) },
        )
    }
    if (linkOpen) {
        InputDialog(
            "Meeting link", "Paste the video meeting link. The student sees it once the session is confirmed.",
            label = "https://…", confirmLabel = "Save & confirm", minLength = 8, multiline = false, initial = appt.data?.meetingLink.orEmpty(),
            onDismiss = { linkOpen = false },
            onConfirm = { l ->
                linkOpen = false
                val status = if (appt.data?.status == "requested") "confirmed" else null
                update(status = status, link = l.trim())
            },
        )
    }
    if (rescheduleOpen) RescheduleDialog(onDismiss = { rescheduleOpen = false }, onPick = { iso -> rescheduleOpen = false; update(status = "rescheduled", startAt = iso, reason = "New time proposed by your counsellor") })
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun RescheduleDialog(onDismiss: () -> Unit, onPick: (String) -> Unit) {
    val today = LocalDate.now().atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
    val dateState = rememberDatePickerState(
        initialSelectedDateMillis = today + 86_400_000,
        selectableDates = object : SelectableDates {
            override fun isSelectableDate(utcTimeMillis: Long) = utcTimeMillis >= today
        },
    )
    var step by remember { mutableStateOf(0) }
    var time by remember { mutableStateOf<String?>("10:00") }
    if (step == 0) {
        DatePickerDialog(
            onDismissRequest = onDismiss,
            confirmButton = { TextButton(onClick = { step = 1 }, enabled = dateState.selectedDateMillis != null) { Text("Next") } },
            dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
        ) { DatePicker(dateState) }
    } else {
        AlertDialog(
            onDismissRequest = onDismiss,
            containerColor = Color.White,
            title = { Text("Choose a time") },
            text = { CcSelect("Start time", HALF_HOURS.map { it to it }, time, { time = it }, leadingIcon = Icons.Rounded.Schedule) },
            confirmButton = {
                TextButton(onClick = {
                    val d = Instant.ofEpochMilli(dateState.selectedDateMillis ?: today).atZone(ZoneOffset.UTC).toLocalDate()
                    val t = LocalTime.parse(time ?: "10:00")
                    onPick(d.atTime(t).atZone(ZoneId.systemDefault()).toInstant().toString())
                }) { Text("Propose") }
            },
            dismissButton = { TextButton(onClick = { step = 0 }) { Text("Back") } },
        )
    }
}

@Composable
fun AvailabilityScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val avail = rememberLoad { app.api.counselling.availability() }
    CcScreen(title = "Availability", subtitle = "When students can book you", onBack = { nav.popBackStack() }) {
        LoadContent(avail) { a ->
            val windows = remember(a) { mutableStateListOf<WeeklyWindow>().apply { addAll(a.weekly) } }
            val blocked = remember(a) { mutableStateListOf<String>().apply { addAll(a.blockedDates) } }
            var slot by remember(a) { mutableStateOf(a.slotMinutes.toString()) }
            var maxDaily by remember(a) { mutableStateOf((a.maxDailySessions.takeIf { it > 0 } ?: 10).toString()) }
            val specs = remember(a) { mutableStateListOf<String>().apply { addAll(a.specializations) } }
            val langs = remember(a) { mutableStateListOf<String>().apply { addAll(a.languages) } }
            var accepting by remember(a) { mutableStateOf(a.acceptingRequests) }
            var title by remember(a) { mutableStateOf(a.title.orEmpty()) }
            var bio by remember(a) { mutableStateOf(a.bio.orEmpty()) }
            var newDay by remember { mutableStateOf<String?>("1") }
            var newStart by remember { mutableStateOf<String?>("09:00") }
            var newEnd by remember { mutableStateOf<String?>("13:00") }
            var blockedInput by remember { mutableStateOf("") }
            var busy by remember { mutableStateOf(false) }
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                CcCard { SwitchRow("Accepting new requests", accepting, { accepting = it }, description = "Turn off when you're on leave or fully booked.") }
                SectionHeader("Weekly hours")
                CcCard {
                    if (windows.isEmpty()) Text("No hours set — students can't book you.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                    windows.sortedWith(compareBy({ it.weekday }, { it.start })).forEach { w ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("${WEEKDAYS[w.weekday]}  ${w.start} – ${w.end}", style = MaterialTheme.typography.bodyLarge, color = CcColors.Ink, modifier = Modifier.weight(1f))
                            IconButton(onClick = { windows.remove(w) }) { Icon(Icons.Rounded.Delete, contentDescription = "Remove ${WEEKDAYS[w.weekday]} ${w.start}") }
                        }
                    }
                    Divider(Modifier.padding(vertical = 8.dp))
                    CcSelect("Day", WEEKDAYS.mapIndexed { i, d -> "$i" to d }, newDay, { newDay = it })
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                        CcSelect("From", HALF_HOURS.map { it to it }, newStart, { newStart = it }, Modifier.weight(1f))
                        CcSelect("To", HALF_HOURS.map { it to it }, newEnd, { newEnd = it }, Modifier.weight(1f))
                    }
                    CcButton("Add hours", {
                        val d = newDay?.toIntOrNull() ?: return@CcButton
                        val s = newStart ?: return@CcButton
                        val e = newEnd ?: return@CcButton
                        if (e <= s) {
                            snack.show("End time must be after start time.")
                            return@CcButton
                        }
                        windows.add(WeeklyWindow(d, s, e))
                    }, Modifier.fillMaxWidth().padding(top = 8.dp), kind = ButtonKind.Soft, leadingIcon = Icons.Rounded.Add)
                }
                Text("Session length", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                ChoiceChips(listOf("30" to "30 min", "45" to "45 min", "50" to "50 min", "60" to "60 min", "90" to "90 min"), slot, { slot = it })
                Text("Daily session limit", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                ChoiceChips((listOf("2", "3", "4", "5", "6", "8", "10", "12") + maxDaily).distinct().sortedBy { it.toIntOrNull() ?: 0 }.map { it to it }, maxDaily, { maxDaily = it })
                Text("Students can't book more than this many sessions with you on one day.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                SectionHeader("Time off")
                CcCard {
                    blocked.sorted().forEach { d ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(d, style = MaterialTheme.typography.bodyLarge, color = CcColors.Ink, modifier = Modifier.weight(1f))
                            IconButton(onClick = { blocked.remove(d) }) { Icon(Icons.Rounded.Delete, contentDescription = "Remove $d") }
                        }
                    }
                    CcTextField(blockedInput, { blockedInput = it }, label = "Add a date (YYYY-MM-DD)", leadingIcon = Icons.Rounded.CalendarMonth, onImeAction = {
                        val v = blockedInput.trim()
                        if (Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(v) && v !in blocked) { blocked.add(v); blockedInput = "" } else snack.show("Use the format 2026-12-24.")
                    })
                }
                SectionHeader("Specialisations")
                MultiChoiceChips(Catalog.counsellingTypes, specs.toSet(), { k -> if (k in specs) specs.remove(k) else specs.add(k) })
                SectionHeader("Languages")
                MultiChoiceChips(Catalog.languages.map { it to it }, langs.toSet(), { l -> if (l in langs) langs.remove(l) else langs.add(l) })
                SectionHeader("Profile shown to students")
                CcTextField(title, { title = it }, label = "Title", leadingIcon = Icons.Rounded.Person, maxLength = 80)
                CcTextField(bio, { bio = it }, label = "Short bio", singleLine = false, minLines = 3, maxLength = 600)
                CcButton("Save availability", {
                    scope.launch {
                        busy = true
                        try {
                            if (specs.isEmpty() || langs.isEmpty()) {
                                snack.show("Choose at least one specialisation and one language.")
                                return@launch
                            }
                            val updated = a.copy(
                                weekly = windows.toList(), slotMinutes = slot.toIntOrNull() ?: 50, blockedDates = blocked.toList(), acceptingRequests = accepting,
                                title = title.trim(), bio = bio.trim(), maxDailySessions = maxDaily.toIntOrNull() ?: 10, specializations = specs.toList(), languages = langs.toList(),
                            )
                            app.api.counselling.saveAvailability(updated)
                            avail.set(updated)
                            snack.show("Availability saved.")
                        } catch (e: ApiException) {
                            snack.error(e)
                        } finally {
                            busy = false
                        }
                    }
                }, Modifier.fillMaxWidth(), loading = busy)
            }
        }
    }
}

@Composable
fun CounsellorStudentsScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val list = rememberLoad { app.api.counselling.myStudents() }
    var q by rememberSaveable { mutableStateOf("") }
    CcScreen(title = "My students", subtitle = "Students you have seen", onBack = { nav.popBackStack() }, refreshing = list.refreshing, onRefresh = { list.reload() }) {
        CcTextField(q, { q = it }, label = "Search by name or ID", leadingIcon = Icons.Rounded.Person)
        LoadContent(list) { items ->
            val shown = items.filter { q.isBlank() || it.name.contains(q, true) || (it.studentId ?: "").contains(q, true) }
            if (shown.isEmpty()) EmptyState("No students yet", icon = Icons.Rounded.Psychology, tone = Tone.Violet)
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                shown.forEach { s ->
                    CcCard {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Avatar(s.name, tone = Tone.Violet)
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(s.name, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                                Text(listOfNotNull(s.studentId, s.department).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                                Text("${s.sessions} session${if (s.sessions == 1) "" else "s"} · last ${Fmt.date(s.lastSession)}", style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint)
                            }
                            s.followUpAt?.let { StatusChip("Follow up ${Fmt.date(it)}", if ((Fmt.parse(it) ?: Instant.MAX) < Instant.now()) Tone.Rose else Tone.Sky) }
                        }
                    }
                }
            }
        }
    }
}

/** Staff conversation inbox: support threads (assigned to me or my service) and counselling threads. */
@Composable
fun InboxScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val overview = rememberLoad { app.api.chat.overview() }
    var filter by rememberSaveable { mutableStateOf("open") }
    LaunchedEffect(Unit) { app.realtime.events.collect { e -> if (e.name == "chat:message" || e.name == "notification") overview.reload() } }
    CcScreen(title = "Messages", subtitle = "Student conversations", refreshing = overview.refreshing, onRefresh = { overview.reload() }) {
        ChoiceChips(listOf("open" to "Open", "mine" to "Assigned to me", "closed" to "Closed"), filter, { filter = it })
        LoadContent(overview) { o ->
            val threads = o.threads.filter {
                when (filter) {
                    "mine" -> it.assigned && !it.closed
                    "closed" -> it.closed
                    else -> !it.closed
                }
            }
            if (threads.isEmpty()) EmptyState("No conversations", message = "New student messages appear here.", icon = Icons.Rounded.Forum)
            CcCard(padding = 8.dp) {
                threads.forEachIndexed { i, t ->
                    if (i > 0) Divider()
                    ListRow(
                        t.studentName ?: t.name,
                        subtitle = listOfNotNull(t.name.takeIf { t.studentName != null }, t.lastMessageAt?.let { Fmt.ago(it) }).joinToString(" · "),
                        icon = if (t.kind == "counselling_thread") Icons.Rounded.Psychology else Icons.Rounded.SupportAgent,
                        tone = if (t.kind == "counselling_thread") Tone.Violet else Tone.Teal,
                        trailing = { if (t.unread > 0) StatusChip("${t.unread}", Tone.Danger) },
                        onClick = { nav.navigate(Routes.chat(t.id)) },
                    )
                }
            }
        }
    }
}
