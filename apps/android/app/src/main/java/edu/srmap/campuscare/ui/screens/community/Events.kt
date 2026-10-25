package edu.srmap.campuscare.ui.screens.community

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Event
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material.icons.rounded.Place
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.Title
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.R
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.CommunityEvent
import edu.srmap.campuscare.data.EVENT_KINDS
import edu.srmap.campuscare.data.counsellingChannel
import edu.srmap.campuscare.data.feed
import edu.srmap.campuscare.ui.components.BottomActionBar
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.CcSelect
import edu.srmap.campuscare.ui.components.CcTextField
import edu.srmap.campuscare.ui.components.ConfirmDialog
import edu.srmap.campuscare.ui.components.EmptyState
import edu.srmap.campuscare.ui.components.InfoBanner
import edu.srmap.campuscare.ui.components.KeyValue
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.enterStagger
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.Fmt
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.launch

@Composable
fun CommunityEventsScreen(channel: String?) {
    val app = LocalApp.current
    val nav = LocalNav.current
    var whenFilter by rememberSaveable { mutableStateOf("upcoming") }
    val page = rememberLoad(whenFilter) { app.api.feed.events(past = whenFilter == "past", channel = channel) }
    // Verified counsellors can add counselling sessions; other organisers come from the server's canCreate.
    val publisher = rememberLoad(channel) { channel == "counselling" && app.api.counsellingChannel.channel().canPublish }
    OnFeedChanged { page.reload() }
    CcScreen(
        title = if (channel == "counselling") "Counselling sessions" else "Events & campaigns",
        subtitle = "Workshops, awareness campaigns and campus events",
        onBack = { nav.popBackStack() }, refreshing = page.refreshing, onRefresh = { page.reload() },
        floating = { if (page.data?.canCreate == true || publisher.data == true) CreateEventButton(channel) },
    ) {
        AnimatedChips(listOf("upcoming" to "Upcoming", "past" to "Past"), whenFilter, { whenFilter = it })
        LoadContent(page) { p ->
            when {
                p.disabled -> EmptyState("Events are turned off", icon = Icons.Rounded.Event)
                p.items.isEmpty() -> IllustratedEmpty(
                    R.drawable.community_empty_events,
                    if (whenFilter == "past") "No past events" else "No upcoming events",
                    "Safety workshops, awareness campaigns and counselling sessions will appear here.",
                )
                else -> Column(verticalArrangement = Arrangement.spacedBy(10.dp)) { p.items.forEachIndexed { i, e -> EventCard(e, Modifier.enterStagger(i)) } }
            }
        }
    }
}

@Composable
private fun CreateEventButton(channel: String?) {
    val nav = LocalNav.current
    CcButton("New event", { nav.navigate(Routes.communityEventNew(channel)) }, kind = ButtonKind.Brand, leadingIcon = Icons.Rounded.Add)
}

@Composable
private fun EventCard(e: CommunityEvent, modifier: Modifier = Modifier) {
    val nav = LocalNav.current
    CcCard(modifier, onClick = { nav.navigate(Routes.communityEvent(e.id)) }, padding = 12.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            DateBadge(e.startsAt)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    StatusChip(e.kindLabel.ifBlank { Fmt.humanize(e.kind) }, if (e.channel == "counselling") Tone.Violet else Tone.Teal)
                    if (e.status == "cancelled") StatusChip("Cancelled", Tone.Danger)
                    e.myRsvp?.let { StatusChip(if (it == "going") "Going" else "Interested", Tone.Brand) }
                }
                Text(e.title, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink, modifier = Modifier.padding(top = 4.dp), maxLines = 2)
                Text("${Fmt.time(e.startsAt)} · ${e.venue}", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft, maxLines = 1)
                Text("By ${e.organizer} · ${e.going} going", style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint, maxLines = 1)
            }
        }
    }
}

@Composable
private fun DateBadge(iso: String?) {
    val d = Fmt.parse(iso)?.atZone(ZoneId.systemDefault())
    Column(
        Modifier.size(58.dp).clip(RoundedCornerShape(16.dp)).background(CcColors.Mint).semantics { contentDescription = Fmt.date(iso) },
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
    ) {
        Text(d?.format(DateTimeFormatter.ofPattern("MMM"))?.uppercase() ?: "—", style = MaterialTheme.typography.labelSmall, color = CcColors.Forest)
        Text(d?.dayOfMonth?.toString() ?: "", style = MaterialTheme.typography.titleLarge, color = CcColors.Forest, fontWeight = FontWeight.Bold)
    }
}

@Composable
fun CommunityEventScreen(id: String) {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val event = rememberLoad(id) { app.api.feed.event(id) }
    var busy by remember { mutableStateOf(false) }
    var confirmCancel by remember { mutableStateOf(false) }

    fun rsvp(status: String) = scope.launch {
        busy = true
        try {
            event.set(app.api.feed.rsvp(id, status))
            snack.show(when (status) { "going" -> "You're going. We'll remind you a day before."; "interested" -> "Marked as interested."; else -> "RSVP removed." })
        } catch (e: ApiException) {
            snack.error(e)
        } finally {
            busy = false
        }
    }

    CcScreen(title = event.data?.title ?: "Event", subtitle = event.data?.kindLabel, onBack = { nav.popBackStack() }, refreshing = event.refreshing, onRefresh = { event.reload() }) {
        LoadContent(event) { e ->
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (e.status == "cancelled") InfoBanner("This event was cancelled by the organiser.", tone = Tone.Danger)
                CcCard {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        DateBadge(e.startsAt)
                        Spacer(Modifier.width(12.dp))
                        Column {
                            Text(Fmt.dayTime(e.startsAt), style = MaterialTheme.typography.titleMedium, color = CcColors.Ink)
                            Text("until ${Fmt.dayTime(e.endsAt)}", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                        }
                    }
                    Row(Modifier.padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Rounded.Place, contentDescription = null, tint = CcColors.InkSoft, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(e.venue, style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink)
                    }
                    KeyValue("Organiser", e.organizer)
                    KeyValue("Attending", "${e.going} going · ${e.interested} interested" + (e.capacity?.let { " · $it places" } ?: ""))
                    Text(e.description, style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink, modifier = Modifier.padding(top = 8.dp))
                }
                if (!e.past && e.status == "published") {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        CcButton(
                            if (e.myRsvp == "going") "Going ✓" else "I'm going", { rsvp(if (e.myRsvp == "going") "none" else "going") }, Modifier.weight(1f),
                            kind = if (e.myRsvp == "going") ButtonKind.Brand else ButtonKind.Primary, enabled = !busy, leadingIcon = Icons.Rounded.CheckCircle,
                        )
                        CcButton(
                            if (e.myRsvp == "interested") "Interested ✓" else "Interested", { rsvp(if (e.myRsvp == "interested") "none" else "interested") }, Modifier.weight(1f),
                            kind = if (e.myRsvp == "interested") ButtonKind.Soft else ButtonKind.Outline, enabled = !busy, leadingIcon = Icons.Rounded.Star,
                        )
                    }
                }
                if (e.canManage && e.status == "published" && !e.past) {
                    CcButton("Cancel event", { confirmCancel = true }, Modifier.fillMaxWidth(), kind = ButtonKind.Ghost)
                }
            }
        }
    }
    if (confirmCancel) {
        ConfirmDialog(
            "Cancel this event?", "Everyone who RSVP'd will be notified.", confirmLabel = "Cancel event", destructive = true,
            onDismiss = { confirmCancel = false },
            onConfirm = {
                scope.launch {
                    try {
                        app.api.feed.cancelEvent(id); confirmCancel = false; event.reload(); markFeedChanged(nav)
                    } catch (e: ApiException) {
                        snack.error(e)
                    }
                }
            },
        )
    }
}

/** Only authorised organisers reach this (the server checks again). */
@Composable
fun CommunityEventNewScreen(channel: String?) {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    var title by rememberSaveable { mutableStateOf("") }
    var description by rememberSaveable { mutableStateOf("") }
    var kind by rememberSaveable { mutableStateOf<String?>(if (channel == "counselling") "counselling_session" else null) }
    var venue by rememberSaveable { mutableStateOf("") }
    var organizer by rememberSaveable { mutableStateOf(if (channel == "counselling") "CampusCare Counselling" else "") }
    var date by rememberSaveable { mutableStateOf(LocalDate.now().plusDays(1).toString()) }
    var start by rememberSaveable { mutableStateOf("16:00") }
    var end by rememberSaveable { mutableStateOf("17:00") }
    var capacity by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var errors by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    val kinds = if (channel == "counselling") EVENT_KINDS.filter { it.first == "counselling_session" || it.first == "workshop" } else EVENT_KINDS

    CcScreen(
        title = "New event", subtitle = if (channel == "counselling") "Official Counselling Support" else "Official campus event", onBack = { nav.popBackStack() },
        bottomBar = {
            BottomActionBar {
                CcButton("Publish event", {
                    val day = runCatching { LocalDate.parse(date.trim()) }.getOrNull()
                    val s = runCatching { LocalTime.parse(start.trim()) }.getOrNull()
                    val e = runCatching { LocalTime.parse(end.trim()) }.getOrNull()
                    errors = buildMap {
                        if (title.trim().length < 3) put("title", "Add a title")
                        if (description.trim().length < 10) put("description", "Describe the event")
                        if (kind == null) put("kind", "Choose a type")
                        if (venue.trim().length < 2) put("venue", "Where is it?")
                        if (organizer.trim().length < 2) put("organizer", "Who is organising it?")
                        if (day == null) put("date", "Use YYYY-MM-DD")
                        if (s == null) put("start", "Use HH:MM")
                        if (e == null || (s != null && !e.isAfter(s))) put("end", "Must be after the start")
                    }
                    if (errors.isNotEmpty()) return@CcButton
                    scope.launch {
                        busy = true
                        try {
                            val zone = ZoneId.systemDefault()
                            val created = app.api.feed.createEvent(
                                mapOf(
                                    "title" to title.trim(), "description" to description.trim(), "kind" to kind, "venue" to venue.trim(), "organizer" to organizer.trim(),
                                    "startsAt" to day!!.atTime(s).atZone(zone).toInstant().toString(), "endsAt" to day.atTime(e).atZone(zone).toInstant().toString(),
                                    "capacity" to capacity.toIntOrNull(), "channel" to channel?.takeIf { it == "counselling" },
                                ),
                            )
                            markFeedChanged(nav)
                            nav.navigate(Routes.communityEvent(created.id)) { popUpTo(Routes.CommunityEventNew) { inclusive = true } }
                        } catch (ex: ApiException) {
                            if (ex.fields.isNotEmpty()) errors = ex.fields
                            snack.error(ex)
                        } finally {
                            busy = false
                        }
                    }
                }, Modifier.weight(1f), kind = ButtonKind.Brand, loading = busy)
            }
        },
    ) {
        InfoBanner("Official events are visible to everyone on campus and notify channel followers.", icon = Icons.Rounded.Groups)
        CcTextField(title, { title = it }, label = "Title", leadingIcon = Icons.Rounded.Title, error = errors["title"], maxLength = 120)
        CcSelect("Type", kinds, kind, { kind = it }, error = errors["kind"])
        CcTextField(description, { description = it }, label = "Description", singleLine = false, minLines = 4, maxLength = 2000, error = errors["description"])
        CcTextField(venue, { venue = it }, label = "Venue", leadingIcon = Icons.Rounded.Place, error = errors["venue"], maxLength = 160)
        CcTextField(organizer, { organizer = it }, label = "Organiser", error = errors["organizer"], maxLength = 120)
        CcTextField(date, { date = it }, label = "Date (YYYY-MM-DD)", leadingIcon = Icons.Rounded.Event, error = errors["date"])
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            CcTextField(start, { start = it }, label = "Starts (HH:MM)", error = errors["start"], modifier = Modifier.weight(1f))
            CcTextField(end, { end = it }, label = "Ends (HH:MM)", error = errors["end"], modifier = Modifier.weight(1f))
        }
        CcTextField(capacity, { capacity = it.filter(Char::isDigit) }, label = "Capacity (optional)", keyboardType = androidx.compose.ui.text.input.KeyboardType.Number)
    }
}
