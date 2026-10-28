package edu.srmap.campuscare.ui.screens.student

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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AlarmAdd
import androidx.compose.material.icons.rounded.EventAvailable
import androidx.compose.material.icons.rounded.Flag
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.NotificationsActive
import androidx.compose.material.icons.rounded.Psychology
import androidx.compose.material.icons.rounded.RateReview
import androidx.compose.material.icons.rounded.School
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.StarBorder
import androidx.compose.material.icons.rounded.Translate
import androidx.compose.material.icons.rounded.Verified
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.RadioButton
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.DirectoryCounsellor
import edu.srmap.campuscare.data.FEEDBACK_CATEGORY_LABELS
import edu.srmap.campuscare.data.FEEDBACK_REPORT_REASONS
import edu.srmap.campuscare.data.RatingText
import edu.srmap.campuscare.data.SPECIALIZATION_LABELS
import edu.srmap.campuscare.data.newIdempotencyKey
import edu.srmap.campuscare.data.wellness
import edu.srmap.campuscare.ui.components.Avatar
import edu.srmap.campuscare.ui.components.BottomActionBar
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.CcTextField
import edu.srmap.campuscare.ui.components.ChoiceChips
import edu.srmap.campuscare.ui.components.ConfirmDialog
import edu.srmap.campuscare.ui.components.EmptyState
import edu.srmap.campuscare.ui.components.InfoBanner
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.SectionHeader
import edu.srmap.campuscare.ui.components.SkeletonList
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.SwitchRow
import edu.srmap.campuscare.ui.components.TagCloud
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.enterStagger
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.Fmt
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

private val dayChip = DateTimeFormatter.ofPattern("EEE\nd MMM", Locale.ENGLISH)
private val timeOnly = DateTimeFormatter.ofPattern("h:mm a", Locale.ENGLISH)
private val nextFmt = DateTimeFormatter.ofPattern("EEE d MMM, h:mm a", Locale.ENGLISH)
private val MODE_LABELS = mapOf("in_person" to "In person", "online" to "Online", "phone" to "Phone")

private fun zoneOf(tz: String): ZoneId = runCatching { ZoneId.of(tz) }.getOrDefault(ZoneId.of("Asia/Kolkata"))
private fun nextLabel(iso: String?, tz: String) = Fmt.parse(iso)?.atZone(zoneOf(tz))?.format(nextFmt)

@Composable
private fun AvailabilityChip(c: DirectoryCounsellor) = when (c.availability) {
    "available_now" -> StatusChip("Working now", Tone.Brand, dot = true)
    "unavailable" -> StatusChip("Off duty", Tone.Neutral)
    else -> StatusChip("By appointment", Tone.Teal)
}

/** The counsellor's approved photo (loaded with the session), or their initials. */
@Composable
fun CounsellorPhoto(c: DirectoryCounsellor, size: Dp) {
    val app = LocalApp.current
    val url = c.photoUrl
    if (url == null) {
        Avatar(c.name, tone = Tone.Violet, size = size)
        return
    }
    AsyncImage(
        model = app.client.url(url), imageLoader = app.imageLoader, contentDescription = "Photo of ${c.name}",
        contentScale = ContentScale.Crop, modifier = Modifier.size(size).clip(CircleShape).background(Tone.Violet.bg),
    )
}

@Composable
private fun RatingStars(average: Double, size: Dp = 16.dp) {
    val filled = RatingText.filledStars(average)
    Row(Modifier.semantics(mergeDescendants = true) { contentDescription = "Rated ${"%.1f".format(Locale.ENGLISH, average)} out of 5" }) {
        (1..5).forEach { n ->
            Icon(if (n <= filled) Icons.Rounded.Star else Icons.Rounded.StarBorder, null, tint = if (n <= filled) CcColors.Amber else CcColors.InkFaint, modifier = Modifier.size(size))
        }
    }
}

/** One line for directory cards: stars when public, otherwise a neutral note (never a count below the threshold). */
@Composable
private fun RatingLine(c: DirectoryCounsellor) {
    val r = c.rating
    val avg = r?.takeIf { it.isAvailable }?.average
    Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        if (avg != null) {
            RatingStars(avg, 14.dp)
            Text(" ${RatingText.short(r)}", style = MaterialTheme.typography.labelMedium, color = CcColors.Ink, modifier = Modifier.semantics { contentDescription = RatingText.summary(r) })
        } else {
            Text(RatingText.summary(r), style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
        }
    }
}

/** Find a Counsellor: only counsellors who are on duty and have an open slot are listed (enforced by the server). */
@Composable
fun FindCounsellorScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    var spec by rememberSaveable { mutableStateOf("") }
    var lang by rememberSaveable { mutableStateOf("") }
    var mode by rememberSaveable { mutableStateOf("") }
    var date by rememberSaveable { mutableStateOf("") }
    var typed by rememberSaveable { mutableStateOf("") }
    var query by rememberSaveable { mutableStateOf("") }
    var sort by rememberSaveable { mutableStateOf("name") }
    // Search once typing pauses, not on every keystroke.
    LaunchedEffect(typed) {
        delay(350)
        query = typed.trim()
    }
    val list = rememberLoad(listOf(spec, lang, mode, date, query, sort)) {
        app.api.wellness.directory(spec.ifBlank { null }, lang.ifBlank { null }, mode.ifBlank { null }, date.ifBlank { null }, query.ifBlank { null }, sort)
    }
    val campusZone = ZoneId.of("Asia/Kolkata")
    val week = (0..6).map { LocalDate.now(campusZone).plusDays(it.toLong()) }

    CcScreen(title = "Find a Counsellor", subtitle = "Confidential support from campus counsellors", onBack = { nav.popBackStack() }, refreshing = list.refreshing, onRefresh = { list.reload() }) {
        InfoBanner("Counselling is confidential. Your choice of counsellor is never shared with other students.", icon = Icons.Rounded.Lock, tone = Tone.Violet)
        CcTextField(typed, { typed = it }, label = "Search counsellors", placeholder = "Name, focus, department or language", leadingIcon = Icons.Rounded.Search)
        ChoiceChips(listOf("name" to "A–Z", "availability" to "Soonest free", "rating" to "Top rated"), sort, { sort = it })
        Text("Focus", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterPill("Any", spec.isBlank()) { spec = "" }
            SPECIALIZATION_LABELS.forEach { (k, v) -> FilterPill(v, spec == k) { spec = if (spec == k) "" else k } }
        }
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterPill("Any language", lang.isBlank()) { lang = "" }
            listOf("English", "Telugu", "Hindi", "Tamil").forEach { l -> FilterPill(l, lang == l) { lang = if (lang == l) "" else l } }
            Spacer(Modifier.width(4.dp))
            MODE_LABELS.forEach { (k, v) -> FilterPill(v, mode == k) { mode = if (mode == k) "" else k } }
        }
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterPill("Any day", date.isBlank()) { date = "" }
            week.forEach { d -> FilterPill(if (d == week.first()) "Today" else d.format(DateTimeFormatter.ofPattern("EEE d", Locale.ENGLISH)), date == d.toString()) { date = if (date == d.toString()) "" else d.toString() } }
        }
        LoadContent(list, skeleton = { SkeletonList(3) }) { counsellors ->
            if (counsellors.isEmpty()) {
                EmptyState(
                    "No counsellors match",
                    message = if (spec.isBlank() && lang.isBlank() && mode.isBlank() && date.isBlank() && query.isBlank()) "No counsellor has open times right now. Please check back later, or use Support chat." else "Try another search or remove a filter.",
                    icon = Icons.Rounded.Psychology, tone = Tone.Violet,
                )
            }
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                counsellors.forEachIndexed { i, c ->
                    CcCard(Modifier.enterStagger(i), onClick = { nav.navigate(Routes.counsellorProfile(c.id)) }) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            CounsellorPhoto(c, 52.dp)
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(c.name, style = MaterialTheme.typography.titleMedium, color = CcColors.Ink)
                                Text(listOfNotNull(c.title, c.department).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                            }
                            AvailabilityChip(c)
                        }
                        RatingLine(c)
                        if (c.specializations.isNotEmpty()) {
                            Text(c.specializations.joinToString(" · ") { SPECIALIZATION_LABELS[it] ?: it }, style = MaterialTheme.typography.bodySmall, color = CcColors.Forest, modifier = Modifier.padding(top = 10.dp), maxLines = 2)
                        }
                        Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Rounded.Translate, null, tint = CcColors.InkSoft, modifier = Modifier.size(14.dp))
                            Text(" ${c.languages.joinToString(", ")} · ${c.supportedModes.joinToString(", ") { MODE_LABELS[it] ?: it }}", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft, maxLines = 1)
                        }
                        nextLabel(c.nextAvailableAt, c.timezone)?.let {
                            Text("Next available: $it${if (c.slotsToday > 0) " · ${c.slotsToday} open today" else ""}", style = MaterialTheme.typography.labelMedium, color = CcColors.Ink, modifier = Modifier.padding(top = 6.dp))
                        }
                        Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            CcButton("View profile", { nav.navigate(Routes.counsellorProfile(c.id)) }, Modifier.weight(1f), kind = ButtonKind.Outline)
                            CcButton("Book appointment", { nav.navigate(Routes.counsellorProfile(c.id)) }, Modifier.weight(1f), kind = ButtonKind.Soft, enabled = c.acceptingRequests)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun FilterPill(label: String, on: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.clip(RoundedCornerShape(50)).background(if (on) CcColors.Forest else Color.White)
            .border(1.dp, if (on) CcColors.Forest else CcColors.Line, RoundedCornerShape(50))
            .clickable(role = Role.Checkbox, onClick = onClick).padding(horizontal = 14.dp, vertical = 8.dp),
    ) { Text(label, color = if (on) Color.White else CcColors.Ink, style = MaterialTheme.typography.labelLarge) }
}

/** Counsellor profile with date → slot → confirm booking. The server re-checks the slot atomically. */
@Composable
fun CounsellorProfileScreen(id: String) {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val profile = rememberLoad(id) { app.api.wellness.profile(id) }
    var day by rememberSaveable { mutableStateOf<String?>(null) }
    var slot by rememberSaveable { mutableStateOf<String?>(null) }
    var mode by rememberSaveable { mutableStateOf("") }
    var reason by rememberSaveable { mutableStateOf("") }
    var allowOther by rememberSaveable { mutableStateOf(true) }
    var confirm by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var dueAt by rememberSaveable { mutableStateOf<String?>(null) }
    var reporting by remember { mutableStateOf<String?>(null) }
    // Same key for retries of one booking attempt, so a resend never creates a second request.
    var attemptKey by rememberSaveable { mutableStateOf(newIdempotencyKey()) }

    if (dueAt != null) {
        CcScreen(title = "Request sent", onBack = { nav.popBackStack() }) {
            EmptyState(
                "Waiting for your counsellor",
                message = "They have an hour to accept. Once they do, you'll get a notification and can message them privately." +
                    if (allowOther) " If they can't take it, another counsellor will be offered your request." else "",
                icon = Icons.Rounded.EventAvailable, tone = Tone.Violet,
                action = { CcButton("Back to counselling", { nav.popBackStack(Routes.Counselling, inclusive = false) }) },
            )
        }
        return
    }

    val c = profile.data
    CcScreen(
        title = c?.name ?: "Counsellor",
        subtitle = c?.title,
        onBack = { nav.popBackStack() },
        refreshing = profile.refreshing, onRefresh = { profile.reload() },
        bottomBar = {
            BottomActionBar {
                CcButton(if (slot == null) "Choose a time to book" else "Book appointment", { confirm = true }, Modifier.weight(1f), enabled = slot != null && c?.acceptingRequests == true, loading = busy)
            }
        },
    ) {
        LoadContent(profile, skeleton = { SkeletonList(3) }) { p ->
            val zone = zoneOf(p.timezone)
            CcCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CounsellorPhoto(p, 64.dp)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(p.name, style = MaterialTheme.typography.titleMedium, color = CcColors.Ink)
                        Text(p.title, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                        Text(listOfNotNull(p.department, "${p.campus.replaceFirstChar { it.uppercase() }} campus").joinToString(" · "), style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
                    }
                    AvailabilityChip(p)
                }
                RatingLine(p)
                if (p.bio.isNotBlank()) Text(p.bio, style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink, modifier = Modifier.padding(top = 10.dp))
                if (p.specializations.isNotEmpty()) Text("Focus: " + p.specializations.joinToString(", ") { SPECIALIZATION_LABELS[it] ?: it }, style = MaterialTheme.typography.bodySmall, color = CcColors.Forest, modifier = Modifier.padding(top = 8.dp))
                Text("Languages: ${p.languages.joinToString(", ")}", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft, modifier = Modifier.padding(top = 4.dp))
                Text(
                    "${p.slotMinutes}-minute sessions · ${p.supportedModes.joinToString(", ") { MODE_LABELS[it] ?: it }}",
                    style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft, modifier = Modifier.padding(top = 4.dp),
                )
            }
            if (p.qualifications.isNotEmpty() || p.yearsExperience != null) {
                SectionHeader("Qualifications")
                CcCard {
                    p.qualifications.forEach { q ->
                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 2.dp)) {
                            Icon(Icons.Rounded.School, null, tint = CcColors.Forest, modifier = Modifier.size(16.dp))
                            Text("  $q", style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink)
                        }
                    }
                    p.yearsExperience?.let { Text("$it years of experience", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft, modifier = Modifier.padding(top = 4.dp)) }
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 6.dp)) {
                        Icon(Icons.Rounded.Verified, null, tint = CcColors.Emerald, modifier = Modifier.size(14.dp))
                        Text(" Verified by the university", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
                    }
                }
            }
            PublicFeedbackSection(p) { reporting = it }

            SectionHeader("Choose a date")
            val days = p.days.filter { it.slots.isNotEmpty() }
            if (days.isEmpty()) {
                CcCard { Text("No open times in the next two weeks. Please choose another counsellor or check back later.", style = MaterialTheme.typography.bodyMedium, color = CcColors.InkSoft) }
            } else {
                val active = days.firstOrNull { it.date == day } ?: days.first()
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    days.forEach { d ->
                        val on = d.date == active.date
                        Box(
                            Modifier.clip(RoundedCornerShape(16.dp)).background(if (on) CcColors.Forest else Color.White)
                                .border(1.dp, if (on) CcColors.Forest else CcColors.Line, RoundedCornerShape(16.dp))
                                .clickable(role = Role.Tab) { day = d.date; slot = null }.padding(horizontal = 14.dp, vertical = 10.dp),
                            contentAlignment = Alignment.Center,
                        ) { Text(LocalDate.parse(d.date).format(dayChip), color = if (on) Color.White else CcColors.Ink, textAlign = TextAlign.Center, style = MaterialTheme.typography.labelLarge) }
                    }
                }
                SectionHeader("Choose a time")
                active.slots.chunked(3).forEach { row ->
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        row.forEach { iso ->
                            val on = iso == slot
                            Box(
                                Modifier.weight(1f).clip(RoundedCornerShape(14.dp)).background(if (on) CcColors.Emerald else CcColors.Mint50)
                                    .clickable(role = Role.RadioButton) { slot = iso; attemptKey = newIdempotencyKey() }.padding(vertical = 12.dp),
                                contentAlignment = Alignment.Center,
                            ) { Text(Instant.parse(iso).atZone(zone).format(timeOnly), color = if (on) Color.White else CcColors.Forest, fontWeight = FontWeight.SemiBold) }
                        }
                        repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
                    }
                }
                Text("${p.slotMinutes}-minute session · times shown in campus time", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
            }

            SectionHeader("How would you like to meet?")
            val modes = p.supportedModes.ifEmpty { listOf("in_person") }
            ChoiceChips(modes.map { it to (MODE_LABELS[it] ?: it) }, mode.takeIf { it in modes } ?: modes.first(), { mode = it })
            CcTextField(reason, { reason = it }, label = "Anything you'd like to share beforehand? (optional)", singleLine = false, minLines = 3, maxLength = 500, hint = "Only your counsellor sees this.")
            SwitchRow(
                "Let another counsellor take it if needed",
                allowOther, { allowOther = it },
                description = "If ${p.name.substringBefore(' ')} declines or doesn't reply within an hour, your request can go to another available counsellor. Turn off to wait for ${p.name.substringBefore(' ')} only.",
            )
        }
    }

    reporting?.let { ref ->
        ReportCommentDialog(
            onDismiss = { reporting = null },
            onReport = { reason ->
                scope.launch {
                    try {
                        app.api.wellness.reportComment(id, ref, reason)
                        snack.show("Thanks. The comment is hidden until someone reviews it.")
                        profile.reload()
                    } catch (e: ApiException) {
                        snack.error(e)
                    } finally {
                        reporting = null
                    }
                }
            },
        )
    }

    if (confirm && c != null && slot != null) {
        val zone = zoneOf(c.timezone)
        val modes = c.supportedModes.ifEmpty { listOf("in_person") }
        val mode = mode.takeIf { it in modes } ?: modes.first()
        ConfirmDialog(
            title = "Request this session?",
            message = "${c.name}\n${Instant.parse(slot!!).atZone(zone).format(nextFmt)} · ${MODE_LABELS[mode] ?: mode}\n\nYour counsellor has an hour to accept.",
            confirmLabel = "Request",
            loading = busy,
            onDismiss = { confirm = false },
            onConfirm = {
                scope.launch {
                    busy = true
                    try {
                        val r = app.api.wellness.book(c.id, slot!!, mode, reason.trim().ifBlank { null }, allowOther, attemptKey)
                        dueAt = r.responseDueAt ?: ""
                    } catch (e: ApiException) {
                        snack.error(e)
                        if (e.status == 409 || e.status == 422) { slot = null; attemptKey = newIdempotencyKey(); profile.reload() }
                    } finally {
                        busy = false
                        confirm = false
                    }
                }
            },
        )
    }
}

/** Ratings, themes and approved comments; below the privacy threshold only a neutral note. */
@Composable
private fun PublicFeedbackSection(p: DirectoryCounsellor, onReport: (String) -> Unit) {
    val r = p.rating
    SectionHeader("Student feedback")
    CcCard {
        if (r == null || !r.isAvailable) {
            Text(RatingText.threshold(r?.minimum ?: p.feedbackMinimum), style = MaterialTheme.typography.bodyMedium, color = CcColors.InkSoft)
            return@CcCard
        }
        val avg = r.average
        if (avg != null) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("%.1f".format(Locale.ENGLISH, avg), style = MaterialTheme.typography.headlineMedium, color = CcColors.Ink, fontWeight = FontWeight.Bold)
                Spacer(Modifier.width(10.dp))
                Column {
                    RatingStars(avg, 18.dp)
                    Text("${r.ratingCount} rating${if (r.ratingCount == 1) "" else "s"}", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
                }
            }
        } else {
            Text(RatingText.summary(r), style = MaterialTheme.typography.bodyMedium, color = CcColors.InkSoft)
        }
        r.distribution?.let { dist ->
            val total = dist.values.sum().coerceAtLeast(1)
            Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                (5 downTo 1).forEach { n ->
                    val count = dist[n.toString()] ?: 0
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = "$n stars: $count" }) {
                        Text("$n★", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft, modifier = Modifier.width(28.dp))
                        LinearProgressIndicator(
                            progress = { count.toFloat() / total },
                            modifier = Modifier.weight(1f).height(6.dp).clip(CircleShape), color = CcColors.Emerald, trackColor = CcColors.Mint,
                        )
                        Text(" $count", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft, modifier = Modifier.width(28.dp))
                    }
                }
            }
        }
        if (r.themes.isNotEmpty()) {
            Text("What students mention", style = MaterialTheme.typography.labelMedium, color = CcColors.InkSoft, modifier = Modifier.padding(top = 10.dp, bottom = 6.dp))
            TagCloud(r.themes.map { "${FEEDBACK_CATEGORY_LABELS[it.category] ?: it.category} · ${it.count}" }, tone = Tone.Teal)
        }
    }
    if (p.comments.isNotEmpty()) {
        p.comments.forEach { cm ->
            CcCard {
                Text("\u201C${cm.text}\u201D", style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Anonymous student", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft, modifier = Modifier.weight(1f))
                    TextButton(onClick = { onReport(cm.ref) }) {
                        Icon(Icons.Rounded.Flag, null, modifier = Modifier.size(14.dp), tint = CcColors.InkSoft)
                        Text(" Report", style = MaterialTheme.typography.labelMedium, color = CcColors.InkSoft)
                    }
                }
            }
        }
    }
    Text(
        "Feedback is anonymous and comes only from students after a completed session. Comments are shared with the student's permission and checked by staff first.",
        style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint,
    )
}

@Composable
private fun ReportCommentDialog(onDismiss: () -> Unit, onReport: (String) -> Unit) {
    var reason by remember { mutableStateOf("identifying") }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Color.White,
        title = { Text("Report this comment?", style = MaterialTheme.typography.headlineSmall) },
        text = {
            Column {
                Text("It will be hidden from this profile until staff review it.", style = MaterialTheme.typography.bodyMedium, color = CcColors.InkSoft)
                FEEDBACK_REPORT_REASONS.forEach { (k, v) ->
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable(role = Role.RadioButton) { reason = k }.padding(vertical = 2.dp),
                    ) {
                        RadioButton(selected = reason == k, onClick = null)
                        Text(v, style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink)
                    }
                }
            }
        },
        confirmButton = { CcButton("Report", { onReport(reason) }) },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel", color = CcColors.InkSoft) } },
    )
}

/** Banner on the counselling home when a completed session can still get feedback. */
@Composable
fun PendingFeedbackBanner() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val pending = rememberLoad { runCatching { app.api.wellness.pendingFeedback() }.getOrDefault(emptyList()) }
    val first = pending.data?.firstOrNull() ?: return
    InfoBanner(
        "How was your session with ${first.counsellor}? Feedback is optional and can be anonymous.",
        title = "Share feedback", icon = Icons.Rounded.RateReview, tone = Tone.Violet,
        action = { CcButton("Give feedback", { nav.navigate(Routes.feedback(first.appointmentId)) }, kind = ButtonKind.Soft) },
    )
}

@Composable
fun CounsellingFeedbackScreen(appointmentId: String) {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val notice = rememberLoad { app.api.wellness.feedbackNotice().notice }
    var anonymous by rememberSaveable { mutableStateOf(true) }
    var rating by rememberSaveable { mutableStateOf(0) }
    var cats by rememberSaveable { mutableStateOf(listOf<String>()) }
    var comment by rememberSaveable { mutableStateOf("") }
    var concern by rememberSaveable { mutableStateOf(false) }
    var share by rememberSaveable { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var sent by remember { mutableStateOf(false) }

    if (sent) {
        CcScreen(title = "Thank you", onBack = { nav.popBackStack() }) {
            EmptyState(
                "Feedback received",
                message = if (anonymous) "It was saved without your name." else "It was saved with your name, as you chose.",
                icon = Icons.Rounded.RateReview, tone = Tone.Violet,
                action = { CcButton("Done", { nav.popBackStack() }) },
            )
        }
        return
    }
    CcScreen(
        title = "Session feedback", subtitle = "Optional · helps improve counselling", onBack = { nav.popBackStack() },
        bottomBar = {
            BottomActionBar {
                CcButton("Submit", {
                    scope.launch {
                        busy = true
                        try {
                            app.api.wellness.submitFeedback(appointmentId, anonymous, rating.takeIf { it > 0 }, cats, comment.trim().ifBlank { null }, concern, share && !concern && comment.isNotBlank())
                            sent = true
                        } catch (e: ApiException) {
                            snack.error(e)
                            if (e.status == 409) nav.popBackStack()
                        } finally {
                            busy = false
                        }
                    }
                }, Modifier.weight(1f), loading = busy, enabled = rating > 0 || cats.isNotEmpty() || comment.isNotBlank())
            }
        },
    ) {
        SwitchRow("Submit anonymously", anonymous, { anonymous = it }, description = "Your counsellor never sees your name with anonymous feedback.")
        notice.data?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft) }
        SectionHeader("Rating (optional)")
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            (1..5).forEach { n ->
                Icon(
                    if (n <= rating) Icons.Rounded.Star else Icons.Rounded.StarBorder, null,
                    tint = if (n <= rating) CcColors.Amber else CcColors.InkFaint,
                    modifier = Modifier.size(40.dp).clip(RoundedCornerShape(50)).clickable(role = Role.RadioButton) { rating = if (rating == n) 0 else n }
                        .semantics { contentDescription = "$n star${if (n > 1) "s" else ""}" }.padding(4.dp),
                )
            }
        }
        SectionHeader("What stood out?")
        FEEDBACK_CATEGORY_LABELS.entries.chunked(2).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { (k, v) ->
                    Box(Modifier.weight(1f)) { FilterPill(v, k in cats) { cats = if (k in cats) cats - k else cats + k } }
                }
            }
        }
        CcTextField(comment, { comment = it }, label = "Comments (optional)", singleLine = false, minLines = 3, maxLength = 2000)
        if (comment.isNotBlank() && !concern) {
            SwitchRow(
                "Share an anonymised version on their profile",
                share, { share = it },
                description = "Off by default. Names, numbers, emails and links are removed and staff review it before other students can see it. Your rating and topics count anonymously either way, once enough students have given feedback.",
            )
        }
        SwitchRow(
            "I want to report a concern",
            concern, { concern = it },
            description = "For conduct, safety or privacy concerns. This goes to authorised staff, not to the counsellor, and may be followed up under campus policy.",
        )
    }
}

/** Reminders for one appointment: the person's own reminders, plus a quick way to add one. */
@Composable
fun AppointmentRemindersScreen(appointmentId: String, counsellor: Boolean) {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val list = rememberLoad(appointmentId) { app.api.wellness.reminders(appointmentId) }
    var note by rememberSaveable { mutableStateOf("") }
    var forStudent by rememberSaveable { mutableStateOf(false) }
    var busy by remember { mutableStateOf<String?>(null) }
    val campus = ZoneId.of("Asia/Kolkata")
    val options = listOf("Tomorrow" to 1L, "In 3 days" to 3L, "In a week" to 7L, "In 2 weeks" to 14L)

    CcScreen(title = "Reminders", subtitle = "Notifications never mention counselling", onBack = { nav.popBackStack() }, refreshing = list.refreshing, onRefresh = { list.reload() }) {
        LoadContent(list, skeleton = { SkeletonList(2) }) { rows ->
            if (rows.isEmpty()) CcCard { Text("No reminders yet.", style = MaterialTheme.typography.bodyMedium, color = CcColors.InkSoft) }
            rows.forEach { r ->
                CcCard {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Rounded.NotificationsActive, null, tint = CcColors.Forest)
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(Fmt.dayTime(r.dueAt), style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                            Text(r.note ?: r.kind.replace('_', ' ').replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                        }
                        if (r.status == "sent") StatusChip("Sent", Tone.Neutral)
                        else if (r.mine) CcButton("Cancel", {
                            scope.launch {
                                busy = r.id
                                try { app.api.wellness.cancelReminder(r.id); list.reload() } catch (e: ApiException) { snack.error(e) } finally { busy = null }
                            }
                        }, kind = ButtonKind.Ghost, loading = busy == r.id)
                    }
                }
            }
        }
        SectionHeader("Add a reminder")
        CcTextField(note, { note = it }, label = if (counsellor) "Private note for yourself (optional)" else "Note (optional)", maxLength = 500, hint = "Notes are never shown in the notification.")
        if (counsellor) SwitchRow("Remind the student instead", forStudent, { forStudent = it }, description = "They get a neutral reminder to check in or book a follow-up. Your note is not sent.")
        options.chunked(2).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { (label, days) ->
                    CcButton(label, {
                        scope.launch {
                            busy = label
                            try {
                                val due = LocalDate.now(campus).plusDays(days).atTime(10, 0).atZone(campus).toInstant().truncatedTo(ChronoUnit.SECONDS).toString()
                                app.api.wellness.addReminder(appointmentId, due, if (forStudent) "student" else "self", note.trim().ifBlank { null }.takeIf { !forStudent })
                                note = ""
                                snack.show("Reminder set for $label (10:00 AM)")
                                list.reload()
                            } catch (e: ApiException) { snack.error(e) } finally { busy = null }
                        }
                    }, Modifier.weight(1f), kind = ButtonKind.Outline, leadingIcon = Icons.Rounded.AlarmAdd, loading = busy == label)
                }
            }
        }
    }
}
