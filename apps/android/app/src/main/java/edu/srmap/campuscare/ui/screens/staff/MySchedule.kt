package edu.srmap.campuscare.ui.screens.staff

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.EventBusy
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.BreakWindowDto
import edu.srmap.campuscare.data.CounsellorScheduleDto
import edu.srmap.campuscare.data.DateOverrideDto
import edu.srmap.campuscare.data.TimeWindowDto
import edu.srmap.campuscare.data.WeeklyWindowDto
import edu.srmap.campuscare.data.wellness
import edu.srmap.campuscare.ui.components.BottomActionBar
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.CcSelect
import edu.srmap.campuscare.ui.components.CcTextField
import edu.srmap.campuscare.ui.components.ChoiceChips
import edu.srmap.campuscare.ui.components.ConfirmDialog
import edu.srmap.campuscare.ui.components.InfoBanner
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.SectionHeader
import edu.srmap.campuscare.ui.components.SkeletonList
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.SwitchRow
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.Fmt
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

private val WEEKDAYS = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")
private val TIMES = (6 * 2..22 * 2).map { "%02d:%02d".format(it / 2, (it % 2) * 30) }
private val TIME_OPTIONS = TIMES.map { it to it }
private val shortDay = DateTimeFormatter.ofPattern("EEE d", Locale.ENGLISH)

/**
 * My Availability: On/Off Duty, daily capacity (default 10), weekly hours, breaks, custom dates and
 * leave. The server validates everything and generates the bookable slots from it.
 */
@Composable
fun MyScheduleScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val loaded = rememberLoad { app.api.wellness.schedule() }
    val feedback = rememberLoad { runCatching { app.api.wellness.feedbackSummary() }.getOrNull() }
    var draft by remember { mutableStateOf<CounsellorScheduleDto?>(null) }
    LaunchedEffect(loaded.data) { loaded.data?.let { draft = it } }
    var saving by remember { mutableStateOf(false) }
    var dutyBusy by remember { mutableStateOf(false) }
    var confirmOff by remember { mutableStateOf(false) }
    var dutyWarning by remember { mutableStateOf<String?>(null) }
    var copyFrom by remember { mutableStateOf<Int?>(null) }
    var newDate by remember { mutableStateOf("") }

    fun setDuty(on: Boolean) = scope.launch {
        dutyBusy = true
        try {
            val r = app.api.wellness.setDuty(on)
            dutyWarning = r.warning
            snack.show(if (on) "You are on duty. Students can book you again." else "You are off duty. No new requests will be assigned.")
            loaded.reload()
        } catch (e: ApiException) { snack.error(e) } finally { dutyBusy = false }
    }

    CcScreen(
        title = "My Availability", subtitle = "Duty, hours and daily capacity", onBack = { nav.popBackStack() },
        refreshing = loaded.refreshing, onRefresh = { loaded.reload(); feedback.reload() },
        bottomBar = {
            BottomActionBar {
                CcButton("Save schedule", {
                    val d = draft ?: return@CcButton
                    scope.launch {
                        saving = true
                        try {
                            app.api.wellness.saveSchedule(d)
                            snack.show("Schedule saved")
                            loaded.reload()
                        } catch (e: ApiException) { snack.error(e) } finally { saving = false }
                    }
                }, Modifier.weight(1f), loading = saving, enabled = draft != null && draft != loaded.data)
            }
        },
    ) {
        LoadContent(loaded, skeleton = { SkeletonList(4) }) { s ->
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                val d = draft ?: s
                CcCard {
                SwitchRow(
                    if (s.onDuty) "On duty" else "Off duty", s.onDuty,
                    { on -> if (on) setDuty(true) else confirmOff = true },
                    description = if (s.onDuty) "Students can book open slots and new requests can be assigned to you." else "No new slots or requests. Your booked appointments and open conversations stay as they are.",
                    enabled = !dutyBusy,
                )
                dutyWarning?.let { InfoBanner(it, tone = Tone.Amber, modifier = Modifier.padding(top = 8.dp)) }
            }

            SectionHeader("Next 14 days")
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                s.days.forEach { day ->
                    Column(
                        Modifier.clip(RoundedCornerShape(14.dp)).background(if (day.remaining == 0) CcColors.CreamDeep else CcColors.Mint50).padding(horizontal = 12.dp, vertical = 8.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(LocalDate.parse(day.date).format(shortDay), style = MaterialTheme.typography.labelMedium, color = CcColors.Ink)
                        Text("${day.booked}/${day.capacity}", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = if (day.remaining == 0) CcColors.InkSoft else CcColors.Forest)
                        Text(if (day.openSlots == 0) "no slots" else "${day.openSlots} open", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft, textAlign = TextAlign.Center)
                    }
                }
            }

            SectionHeader("Appointments per day")
            Row(verticalAlignment = Alignment.CenterVertically) {
                CcButton("−", { draft = d.copy(maxDailySessions = (d.maxDailySessions - 1).coerceAtLeast(1)) }, kind = ButtonKind.Outline)
                Text("${d.maxDailySessions}", style = MaterialTheme.typography.headlineSmall, color = CcColors.Ink, modifier = Modifier.padding(horizontal = 20.dp))
                CcButton("+", { draft = d.copy(maxDailySessions = (d.maxDailySessions + 1).coerceAtMost(24)) }, kind = ButtonKind.Outline)
                Spacer(Modifier.width(12.dp))
                Text("Default 10 · up to 24", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
            }
            Text("Session length", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
            ChoiceChips(listOf("30", "45", "50", "60").map { it to "$it min" }, d.slotMinutes.toString(), { draft = d.copy(slotMinutes = it.toInt()) })

            SectionHeader("Weekly hours")
            (1..6).plus(0).forEach { wd ->
                val windows = d.weekly.withIndex().filter { it.value.weekday == wd }
                CcCard(padding = 12.dp) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(WEEKDAYS[wd], style = MaterialTheme.typography.titleSmall, color = CcColors.Ink, modifier = Modifier.weight(1f))
                        if (windows.isNotEmpty()) IconButton(onClick = { copyFrom = wd }) { Icon(Icons.Rounded.ContentCopy, "Copy ${WEEKDAYS[wd]} to other days", tint = CcColors.InkSoft) }
                        IconButton(onClick = { draft = d.copy(weekly = d.weekly + WeeklyWindowDto(wd, "09:00", "17:00")) }) { Icon(Icons.Rounded.Add, "Add hours on ${WEEKDAYS[wd]}", tint = CcColors.Forest) }
                    }
                    if (windows.isEmpty()) Text("Not working", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                    windows.forEach { (i, w) ->
                        TimeRow(w.start, w.end,
                            onChange = { a, b -> draft = d.copy(weekly = d.weekly.toMutableList().also { it[i] = w.copy(start = a, end = b) }) },
                            onRemove = { draft = d.copy(weekly = d.weekly.filterIndexed { j, _ -> j != i }) })
                    }
                }
            }

            SectionHeader("Breaks", action = "Add", onAction = { draft = d.copy(breaks = d.breaks + BreakWindowDto(null, "13:00", "14:00")) })
            if (d.breaks.isEmpty()) Text("No breaks. Slots never overlap a break.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
            d.breaks.forEachIndexed { i, b ->
                CcCard(padding = 12.dp) {
                    CcSelect("Applies to", listOf("all" to "Every working day") + WEEKDAYS.mapIndexed { n, l -> n.toString() to l }, b.weekday?.toString() ?: "all",
                        { v -> draft = d.copy(breaks = d.breaks.toMutableList().also { it[i] = b.copy(weekday = v.toIntOrNull()) }) })
                    TimeRow(b.start, b.end,
                        onChange = { a, e -> draft = d.copy(breaks = d.breaks.toMutableList().also { it[i] = b.copy(start = a, end = e) }) },
                        onRemove = { draft = d.copy(breaks = d.breaks.filterIndexed { j, _ -> j != i }) })
                }
            }

            SectionHeader("Leave & custom dates")
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                CcTextField(newDate, { newDate = it.take(10) }, label = "Date (YYYY-MM-DD)", modifier = Modifier.weight(1f))
            }
            val validDate = runCatching { LocalDate.parse(newDate) }.getOrNull()?.takeIf { !it.isBefore(LocalDate.now()) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                CcButton("Day off", {
                    draft = d.copy(blockedDates = (d.blockedDates + newDate).distinct().sorted()); newDate = ""
                }, Modifier.weight(1f), kind = ButtonKind.Outline, enabled = validDate != null, leadingIcon = Icons.Rounded.EventBusy)
                CcButton("Custom hours", {
                    draft = d.copy(dateOverrides = d.dateOverrides.filter { it.date != newDate } + DateOverrideDto(newDate, false, listOf(TimeWindowDto("10:00", "13:00")))); newDate = ""
                }, Modifier.weight(1f), kind = ButtonKind.Outline, enabled = validDate != null)
            }
            d.blockedDates.forEach { date ->
                CcCard(padding = 12.dp) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("$date · day off", style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink, modifier = Modifier.weight(1f))
                        IconButton(onClick = { draft = d.copy(blockedDates = d.blockedDates - date) }) { Icon(Icons.Rounded.Delete, "Remove $date", tint = CcColors.InkSoft) }
                    }
                }
            }
            d.dateOverrides.forEachIndexed { i, o ->
                CcCard(padding = 12.dp) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("${o.date} · custom hours", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink, modifier = Modifier.weight(1f))
                        IconButton(onClick = { draft = d.copy(dateOverrides = d.dateOverrides.filterIndexed { j, _ -> j != i }) }) { Icon(Icons.Rounded.Delete, "Remove ${o.date}", tint = CcColors.InkSoft) }
                    }
                    o.windows.forEachIndexed { wi, w ->
                        TimeRow(w.start, w.end,
                            onChange = { a, b -> draft = d.copy(dateOverrides = d.dateOverrides.toMutableList().also { it[i] = o.copy(windows = o.windows.toMutableList().also { l -> l[wi] = TimeWindowDto(a, b) }) }) },
                            onRemove = { draft = d.copy(dateOverrides = d.dateOverrides.toMutableList().also { it[i] = o.copy(windows = o.windows.filterIndexed { j, _ -> j != wi }, closed = o.windows.size <= 1) }) })
                    }
                }
            }

            if (s.upcoming.isNotEmpty()) {
                SectionHeader("Upcoming appointments")
                s.upcoming.take(10).forEach { u ->
                    CcCard(padding = 12.dp) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(Fmt.dayTime(u.startAt), style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink, modifier = Modifier.weight(1f))
                            StatusChip(u.status.replaceFirstChar { it.uppercase() }, if (u.status == "requested") Tone.Amber else Tone.Brand)
                        }
                    }
                }
            }

            SectionHeader("Your feedback")
            val f = feedback.data
            CcCard {
                if (f == null || f.count < f.minimumForDetails) {
                    Text(
                        "Feedback appears here once at least ${f?.minimumForDetails ?: 3} students have shared it, so no single comment can be traced back.",
                        style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft,
                    )
                } else {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Rounded.Star, null, tint = CcColors.Amber)
                        Text(" ${f.averageRating ?: "—"} · ${f.count} responses", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                    }
                    f.comments.take(5).forEach { Text("“$it”", style = MaterialTheme.typography.bodySmall, color = CcColors.Ink, modifier = Modifier.padding(top = 6.dp)) }
                }
            }
        }
    }
}

    if (confirmOff) {
        ConfirmDialog(
            title = "Go off duty?",
            message = "Students won't be able to book you and no new requests will be assigned to you. Appointments you have already accepted are not cancelled — attend, reschedule or ask a coordinator to reassign them.",
            confirmLabel = "Go off duty",
            loading = dutyBusy,
            onDismiss = { confirmOff = false },
            onConfirm = { confirmOff = false; setDuty(false) },
        )
    }

    val from = copyFrom
    val d = draft
    if (from != null && d != null) {
        var targets by remember(from) { mutableStateOf((1..5).filter { it != from }.toSet()) }
        AlertDialog(
            onDismissRequest = { copyFrom = null },
            title = { Text("Copy ${WEEKDAYS[from]} hours to…") },
            text = {
                Column {
                    (1..6).plus(0).filter { it != from }.forEach { wd ->
                        SwitchRow(WEEKDAYS[wd], wd in targets, { on -> targets = if (on) targets + wd else targets - wd })
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    val source = d.weekly.filter { it.weekday == from }
                    draft = d.copy(weekly = d.weekly.filter { it.weekday !in targets } + targets.flatMap { t -> source.map { it.copy(weekday = t) } })
                    copyFrom = null
                }) { Text("Copy") }
            },
            dismissButton = { TextButton(onClick = { copyFrom = null }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun TimeRow(start: String, end: String, onChange: (String, String) -> Unit, onRemove: () -> Unit) {
    Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        CcSelect("From", TIME_OPTIONS, start, { onChange(it, end) }, Modifier.weight(1f))
        CcSelect("To", TIME_OPTIONS, end, { onChange(start, it) }, Modifier.weight(1f), error = if (end <= start) "Must end later" else null)
        IconButton(onClick = onRemove) { Icon(Icons.Rounded.Delete, "Remove these hours", tint = CcColors.InkSoft) }
    }
}
