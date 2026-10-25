package edu.srmap.campuscare.ui.screens.student

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
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
import androidx.compose.material.icons.rounded.Air
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Call
import androidx.compose.material.icons.automirrored.rounded.Chat
import androidx.compose.material.icons.rounded.EventAvailable
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Psychology
import androidx.compose.material.icons.rounded.Spa
import androidx.compose.material.icons.rounded.Videocam
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.Appointment
import edu.srmap.campuscare.ui.components.Avatar
import edu.srmap.campuscare.ui.components.BottomActionBar
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.CcTextField
import edu.srmap.campuscare.ui.components.ChoiceChips
import edu.srmap.campuscare.ui.components.EmptyState
import edu.srmap.campuscare.ui.components.IconBadge
import edu.srmap.campuscare.ui.components.InfoBanner
import edu.srmap.campuscare.ui.components.InputDialog
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.SectionHeader
import edu.srmap.campuscare.ui.components.SkeletonList
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.enterStagger
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.ui.theme.LocalReducedMotion
import edu.srmap.campuscare.util.Fmt
import edu.srmap.campuscare.util.dial
import edu.srmap.campuscare.util.openUrl
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.launch
import androidx.compose.material.icons.rounded.Verified
import edu.srmap.campuscare.data.counsellingChannel
import edu.srmap.campuscare.ui.components.ListRow
import edu.srmap.campuscare.ui.components.Divider

private val ACTIVE_APPT = setOf("requested", "confirmed", "rescheduled")

fun appointmentTone(status: String): Tone = when (status) {
    "confirmed" -> Tone.Brand
    "requested", "rescheduled" -> Tone.Amber
    "completed" -> Tone.Teal
    "rejected", "cancelled", "missed" -> Tone.Neutral
    else -> Tone.Sky
}

/** Counselling (mockup): confidential support, counsellors, my sessions and self-care tools. */
@Composable
fun CounsellingScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val counsellors = rememberLoad { app.api.counselling.counsellors() }
    val appts = rememberLoad { app.api.counselling.appointments() }
    var cancelTarget by remember { mutableStateOf<Appointment?>(null) }
    var busy by remember { mutableStateOf(false) }
    var breathing by remember { mutableStateOf(false) }
    var messaging by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { app.realtime.events.collect { e -> if (e.name == "appointment:updated") appts.reload() } }
    val helpline = app.config.nationalEmergencyNumbers.firstOrNull { it.id == "14416" }

    CcScreen(
        title = "Counselling",
        subtitle = "Talk to someone who cares",
        onBack = { nav.popBackStack() },
        refreshing = appts.refreshing, onRefresh = { appts.reload(); counsellors.reload() },
    ) {
        // Hero
        Box(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(26.dp))
                .background(Brush.linearGradient(listOf(CcColors.VioletSoft, CcColors.Mint50))).padding(20.dp),
        ) {
            Column {
                IconBadge(Icons.Rounded.Spa, Tone.Violet, size = 48.dp)
                Spacer(Modifier.height(10.dp))
                Text("You're not alone", style = MaterialTheme.typography.headlineSmall, color = CcColors.Ink)
                Text("Sessions are confidential. Your counsellor's notes are private to them — not shared with committees or administrators.", style = MaterialTheme.typography.bodyMedium, color = CcColors.InkSoft)
                Spacer(Modifier.height(12.dp))
                CcButton("Book a session", { nav.navigate(Routes.bookSession()) }, kind = ButtonKind.Primary, leadingIcon = Icons.Rounded.CalendarMonth)
            }
        }

        CcCard(padding = 8.dp) {
            ListRow("Message a counsellor", subtitle = "Private one-to-one chat · not an emergency service", icon = Icons.AutoMirrored.Rounded.Chat, tone = Tone.Violet, onClick = { nav.navigate(Routes.CounsellorChats) })
            Divider()
            ListRow("Official Counselling Support", subtitle = "Wellness tips, resources and session news", icon = Icons.Rounded.Verified, tone = Tone.Brand, onClick = { nav.navigate(Routes.CounsellingChannel) })
        }

        // Upcoming & past sessions
        LoadContent(appts, skeleton = { SkeletonList(2) }) { list ->
            val upcoming = list.filter { it.status in ACTIVE_APPT }.sortedBy { it.startAt }
            val past = list.filter { it.status !in ACTIVE_APPT }.sortedByDescending { it.startAt }.take(5)
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                SectionHeader("My sessions")
                if (upcoming.isEmpty()) {
                    CcCard { Text("No upcoming sessions. Book one whenever you're ready.", style = MaterialTheme.typography.bodyMedium, color = CcColors.InkSoft) }
                }
                upcoming.forEach { a -> AppointmentCard(a, onCancel = { cancelTarget = a }) }
                if (past.isNotEmpty()) {
                    Text("Earlier", style = MaterialTheme.typography.titleSmall, color = CcColors.InkSoft, modifier = Modifier.padding(top = 6.dp))
                    past.forEach { a -> AppointmentCard(a, onCancel = null) }
                }
            }
        }

        SectionHeader("Counsellors")
        LoadContent(counsellors, skeleton = { SkeletonList(2) }) { list ->
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (list.isEmpty()) EmptyState("No counsellors listed yet", icon = Icons.Rounded.Psychology, tone = Tone.Violet)
                list.forEachIndexed { i, c ->
                    CcCard(Modifier.enterStagger(i)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Avatar(c.name, tone = Tone.Violet, size = 52.dp)
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(c.name, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                                Text(c.title, style = MaterialTheme.typography.labelMedium, color = CcColors.InkSoft)
                            }
                            StatusChip(if (c.acceptingRequests) "Available" else "Not taking requests", if (c.acceptingRequests) Tone.Brand else Tone.Neutral, dot = true)
                        }
                        if (c.bio.isNotBlank()) Text(c.bio, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft, maxLines = 4, modifier = Modifier.padding(top = 8.dp))
                        Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            CcButton("Message", {
                                if (messaging == null) scope.launch {
                                    messaging = c.id
                                    try {
                                        nav.navigate(Routes.chat(app.api.counsellingChannel.startConversation(c.id).id))
                                    } catch (e: ApiException) {
                                        snack.error(e)
                                    } finally {
                                        messaging = null
                                    }
                                }
                            }, Modifier.weight(1f), kind = ButtonKind.Outline, loading = messaging == c.id, leadingIcon = Icons.AutoMirrored.Rounded.Chat)
                            if (c.acceptingRequests) {
                                CcButton("Book", { nav.navigate(Routes.bookSession(c.id)) }, Modifier.weight(1f), kind = ButtonKind.Soft)
                            }
                        }
                    }
                }
            }
        }

        SectionHeader("Self-care")
        CcCard(onClick = { breathing = true }) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconBadge(Icons.Rounded.Air, Tone.Teal)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text("Breathing exercise", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                    Text("One minute of guided 4-4-6 breathing. Nothing is recorded.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                }
            }
        }
        helpline?.phone?.let { p ->
            InfoBanner(
                "Need to talk right now? ${helpline.name} (${helpline.purpose}).",
                tone = Tone.Violet, icon = Icons.Rounded.Call,
                action = { TextButton(onClick = { context.dial(p) }) { Text("Call $p") } },
            )
        }
    }

    cancelTarget?.let { a ->
        InputDialog(
            "Cancel this session?", "Your counsellor will be told. You can book another time.",
            label = "Reason (optional)", confirmLabel = "Cancel session", minLength = 0, destructive = true, loading = busy,
            onDismiss = { cancelTarget = null },
            onConfirm = { reason ->
                scope.launch {
                    busy = true
                    try {
                        app.api.counselling.update(a.id, status = "cancelled", reason = reason.ifBlank { null })
                        cancelTarget = null
                        snack.show("Session cancelled.")
                        appts.reload()
                    } catch (e: ApiException) {
                        snack.error(e)
                    } finally {
                        busy = false
                    }
                }
            },
        )
    }
    if (breathing) BreathingDialog { breathing = false }
}

@Composable
private fun AppointmentCard(a: Appointment, onCancel: (() -> Unit)?) {
    val nav = LocalNav.current
    val context = LocalContext.current
    CcCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconBadge(if (a.mode == "online") Icons.Rounded.Videocam else Icons.Rounded.EventAvailable, appointmentTone(a.status))
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(Fmt.dayTime(a.startAt), style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                Text("${a.counsellor?.name ?: "Counsellor"} · ${if (a.mode == "online") "Online" else "In person"}", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
            }
            StatusChip(Fmt.humanize(a.status), appointmentTone(a.status))
        }
        a.statusReason?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft, modifier = Modifier.padding(top = 6.dp)) }
        if (a.status in ACTIVE_APPT) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 10.dp)) {
                a.threadId?.let { t -> CcButton("Message", { nav.navigate(Routes.chat(t)) }, kind = ButtonKind.Soft, leadingIcon = Icons.AutoMirrored.Rounded.Chat) }
                a.meetingLink?.takeIf { it.isNotBlank() && a.status == "confirmed" }?.let { link -> CcButton("Join", { context.openUrl(link) }, kind = ButtonKind.Brand, leadingIcon = Icons.Rounded.Videocam) }
                onCancel?.let { CcButton("Cancel", it, kind = ButtonKind.Ghost) }
            }
        }
    }
}

/** Calm, animated 4-4-6 breathing guide. Purely on-device; respects reduced motion. */
@Composable
private fun BreathingDialog(onDismiss: () -> Unit) {
    val reduced = LocalReducedMotion.current
    val t = rememberInfiniteTransition(label = "breath")
    val scale by t.animateFloat(
        initialValue = 0.6f, targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(4_000, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "breathScale",
    )
    var phaseText by remember { mutableStateOf("Breathe in") }
    var cycles by remember { mutableIntStateOf(0) }
    LaunchedEffect(Unit) {
        while (cycles < 6) {
            phaseText = "Breathe in"; kotlinx.coroutines.delay(4_000)
            phaseText = "Hold"; kotlinx.coroutines.delay(4_000)
            phaseText = "Breathe out slowly"; kotlinx.coroutines.delay(6_000)
            cycles++
        }
        phaseText = "Well done"
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Color.White,
        title = { Text("Breathe with me", style = MaterialTheme.typography.headlineSmall) },
        text = {
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                Box(Modifier.size(200.dp), contentAlignment = Alignment.Center) {
                    Box(
                        Modifier.size(190.dp).scale(if (reduced) 0.8f else scale).clip(CircleShape)
                            .background(Brush.radialGradient(listOf(CcColors.Mint, CcColors.TealSoft, CcColors.Mint50))),
                    )
                    Text(phaseText, style = MaterialTheme.typography.titleMedium, color = CcColors.Forest, textAlign = TextAlign.Center)
                }
                Text("Cycle ${minOf(cycles + 1, 6)} of 6", style = MaterialTheme.typography.labelMedium, color = CcColors.InkSoft)
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Done") } },
    )
}

// ------------------------------------------------------------------ booking

private val dayFmt = DateTimeFormatter.ofPattern("EEE\nd MMM", Locale.ENGLISH)
private val timeFmt = DateTimeFormatter.ofPattern("h:mm a", Locale.ENGLISH)

@Composable
fun BookSessionScreen(counsellorId: String?) {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val counsellors = rememberLoad { app.api.counselling.counsellors().filter { it.acceptingRequests } }
    var selected by rememberSaveable { mutableStateOf(counsellorId) }
    val slots = rememberLoad(selected) { selected?.let { app.api.counselling.slots(it) } }
    var day by rememberSaveable(selected) { mutableStateOf<String?>(null) }
    var slot by rememberSaveable(selected) { mutableStateOf<String?>(null) }
    var mode by rememberSaveable { mutableStateOf("in_person") }
    var reason by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var done by remember { mutableStateOf(false) }
    val zone = ZoneId.systemDefault()

    if (done) {
        CcScreen(title = "Request sent", onBack = { nav.popBackStack() }) {
            EmptyState(
                "Session requested",
                message = "Your counsellor will confirm or suggest another time. You'll get a notification.",
                icon = Icons.Rounded.EventAvailable, tone = Tone.Violet,
                action = { CcButton("Back to counselling", { nav.popBackStack() }) },
            )
        }
        return
    }

    CcScreen(
        title = "Book a session",
        subtitle = "Choose a time that works for you",
        onBack = { nav.popBackStack() },
        bottomBar = {
            BottomActionBar {
                CcButton(
                    "Request session",
                    {
                        val c = selected ?: return@CcButton
                        val s = slot ?: return@CcButton
                        scope.launch {
                            busy = true
                            try {
                                app.api.counselling.request(c, s, mode, reason.trim().ifBlank { null })
                                done = true
                            } catch (e: ApiException) {
                                snack.error(e)
                                if (e.code == "slot_taken" || e.status == 409) slots.reload()
                            } finally {
                                busy = false
                            }
                        }
                    },
                    Modifier.weight(1f), enabled = selected != null && slot != null, loading = busy,
                )
            }
        },
    ) {
        InfoBanner("What you share in counselling stays confidential, except where someone's safety is at serious risk.", icon = Icons.Rounded.Lock, tone = Tone.Violet)
        Text("Counsellor", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
        LoadContent(counsellors, skeleton = { SkeletonList(2) }) { list ->
            if (list.isEmpty()) {
                EmptyState("No counsellors are taking requests right now", message = "Try again later, or use Support chat.", icon = Icons.Rounded.Psychology, tone = Tone.Violet)
            }
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                list.forEach { c ->
                    val on = c.id == selected
                    Column(
                        Modifier.width(130.dp).clip(RoundedCornerShape(18.dp))
                            .background(if (on) CcColors.VioletSoft else Color.White)
                            .border(if (on) 2.dp else 1.dp, if (on) CcColors.Violet else CcColors.Line, RoundedCornerShape(18.dp))
                            .clickable(role = Role.RadioButton) { selected = c.id }.padding(12.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Avatar(c.name, tone = Tone.Violet)
                        Text(c.name, style = MaterialTheme.typography.labelLarge, color = CcColors.Ink, textAlign = TextAlign.Center, maxLines = 2, modifier = Modifier.padding(top = 6.dp))
                        Text(c.title, style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft, textAlign = TextAlign.Center, maxLines = 1)
                    }
                }
            }
        }
        if (selected != null) {
            Text("Date & time", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
            LoadContent(slots, skeleton = { SkeletonList(1) }) { s ->
                val byDay = s?.slots.orEmpty().mapNotNull { iso -> Fmt.parse(iso)?.let { iso to it.atZone(zone) } }.groupBy { it.second.toLocalDate() }
                if (byDay.isEmpty()) {
                    CcCard { Text("No free times in the next two weeks. Try another counsellor or check back later.", style = MaterialTheme.typography.bodyMedium, color = CcColors.InkSoft) }
                } else {
                    val days = byDay.keys.sorted()
                    val activeDay = days.firstOrNull { it.toString() == day } ?: days.first()
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            days.forEach { d ->
                                val on = d == activeDay
                                Box(
                                    Modifier.clip(RoundedCornerShape(16.dp)).background(if (on) CcColors.Forest else Color.White)
                                        .border(1.dp, if (on) CcColors.Forest else CcColors.Line, RoundedCornerShape(16.dp))
                                        .clickable(role = Role.Tab) { day = d.toString(); slot = null }.padding(horizontal = 14.dp, vertical = 10.dp),
                                    contentAlignment = Alignment.Center,
                                ) { Text(d.format(dayFmt), color = if (on) Color.White else CcColors.Ink, textAlign = TextAlign.Center, style = MaterialTheme.typography.labelLarge) }
                            }
                        }
                        val times = byDay[activeDay].orEmpty()
                        times.chunked(3).forEach { row ->
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                row.forEach { (iso, z) ->
                                    val on = iso == slot
                                    Box(
                                        Modifier.weight(1f).clip(RoundedCornerShape(14.dp)).background(if (on) CcColors.Emerald else CcColors.Mint50)
                                            .clickable(role = Role.RadioButton) { slot = iso }.padding(vertical = 12.dp),
                                        contentAlignment = Alignment.Center,
                                    ) { Text(z.format(timeFmt), color = if (on) Color.White else CcColors.Forest, fontWeight = FontWeight.SemiBold) }
                                }
                                repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
                            }
                        }
                        Text("${s?.slotMinutes ?: 50}-minute session", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
                    }
                }
            }
        }
        Text("How would you like to meet?", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
        ChoiceChips(listOf("in_person" to "In person", "online" to "Online"), mode, { mode = it })
        CcTextField(reason, { reason = it }, label = "Anything you'd like to share beforehand? (optional)", singleLine = false, minLines = 3, maxLength = 500, hint = "Only your counsellor sees this.")
    }
}
