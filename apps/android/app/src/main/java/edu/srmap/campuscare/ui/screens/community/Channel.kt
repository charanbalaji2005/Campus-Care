package edu.srmap.campuscare.ui.screens.community

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Chat
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.AddPhotoAlternate
import androidx.compose.material.icons.rounded.Call
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Dashboard
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.Event
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.NotificationsActive
import androidx.compose.material.icons.rounded.NotificationsNone
import androidx.compose.material.icons.rounded.PictureAsPdf
import androidx.compose.material.icons.rounded.Psychology
import androidx.compose.material.icons.rounded.PushPin
import androidx.compose.material.icons.rounded.Schedule
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Tag
import androidx.compose.material.icons.rounded.Verified
import androidx.compose.material.icons.rounded.Visibility
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import edu.srmap.campuscare.R
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.Attachment
import edu.srmap.campuscare.data.ChannelCounsellor
import edu.srmap.campuscare.data.CounsellingConversation
import edu.srmap.campuscare.data.FeedAuthor
import edu.srmap.campuscare.data.FeedChannelRef
import edu.srmap.campuscare.data.FeedLimits
import edu.srmap.campuscare.data.FeedPost
import edu.srmap.campuscare.data.ResourceLink
import edu.srmap.campuscare.data.counsellingChannel
import edu.srmap.campuscare.data.feed
import edu.srmap.campuscare.data.newClientId
import edu.srmap.campuscare.ui.components.Avatar
import edu.srmap.campuscare.ui.components.BottomActionBar
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.CcSelect
import edu.srmap.campuscare.ui.components.CcTextField
import edu.srmap.campuscare.ui.components.ConfirmDialog
import edu.srmap.campuscare.ui.components.Divider
import edu.srmap.campuscare.ui.components.EmptyState
import edu.srmap.campuscare.ui.components.ErrorState
import edu.srmap.campuscare.ui.components.IconBadge
import edu.srmap.campuscare.ui.components.InfoBanner
import edu.srmap.campuscare.ui.components.ListRow
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.ScreenHeader
import edu.srmap.campuscare.ui.components.SectionHeader
import edu.srmap.campuscare.ui.components.SkeletonList
import edu.srmap.campuscare.ui.components.StatTile
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.SwitchRow
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.enterStagger
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.Fmt
import edu.srmap.campuscare.util.readPicked
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset
import kotlinx.coroutines.launch

private val TOPICS = listOf(
    "mental_wellness" to "Mental wellness",
    "stress_management" to "Stress management",
    "exam_anxiety" to "Exam anxiety",
    "relationships" to "Relationships",
    "emotional_wellbeing" to "Emotional well-being",
    "support_resources" to "Support resources",
)

/** Working-hours indicator in words and colour (never colour alone). */
fun availabilityChip(status: String, nextAt: String?): Pair<String, Tone> = when (status) {
    "available" -> "Available now" to Tone.Brand
    "outside_hours" -> (nextAt?.let { "Outside hours · back ${Fmt.dayTime(it)}" } ?: "Outside working hours") to Tone.Amber
    else -> (nextAt?.let { "Away · back ${Fmt.dayTime(it)}" } ?: "Away") to Tone.Neutral
}

// ------------------------------------------------------------------ Official Counselling Support

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CounsellingChannelScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val info = rememberLoad { app.api.counsellingChannel.channel() }
    var topic by rememberSaveable { mutableStateOf("all") }
    var query by rememberSaveable { mutableStateOf("") }
    var applied by rememberSaveable { mutableStateOf("") }
    val feed = rememberPagedFeed(topic to applied) { cursor ->
        val page = app.api.counsellingChannel.posts(topic.takeIf { it != "all" }, applied, cursor)
        edu.srmap.campuscare.data.FeedPage(page.items, page.pinned, page.nextCursor)
    }
    val actions = rememberPostActions(onChanged = feed::replace, onRemoved = feed::remove, onBlocked = { feed.refresh() })
    val list = rememberLazyListState()
    InfiniteScroll(list) { feed.loadMore() }
    OnFeedChanged { feed.refresh() }
    var opening by remember { mutableStateOf<String?>(null) }

    fun message(c: ChannelCounsellor) {
        if (opening != null) return
        scope.launch {
            opening = c.counsellorId
            try {
                val conv = app.api.counsellingChannel.startConversation(c.counsellorId)
                nav.navigate(Routes.chat(conv.id))
            } catch (e: ApiException) {
                snack.error(e)
            } finally {
                opening = null
            }
        }
    }

    Box(Modifier.fillMaxSize().background(CcColors.Cream)) {
        Column(Modifier.fillMaxSize()) {
            ScreenHeader(title = "Counselling Support", subtitle = "Official channel", onBack = { nav.popBackStack() }, actions = {
                val i = info.data
                if (i != null) {
                    IconButton(onClick = {
                        scope.launch {
                            try {
                                app.api.counsellingChannel.follow(!i.following)
                                info.set(i.copy(following = !i.following, followers = i.followers + if (i.following) -1 else 1))
                                snack.show(if (!i.following) "You'll be notified about new posts." else "Notifications turned off for this channel.")
                            } catch (e: ApiException) {
                                snack.error(e)
                            }
                        }
                    }) {
                        Icon(if (i.following) Icons.Rounded.NotificationsActive else Icons.Rounded.NotificationsNone, contentDescription = if (i.following) "Stop notifications" else "Get notified about new posts", tint = CcColors.Forest)
                    }
                }
            })
            PullToRefreshBox(isRefreshing = feed.refreshing, onRefresh = { feed.refresh(pull = true); info.reload() }, modifier = Modifier.weight(1f)) {
                LazyColumn(state = list, contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 110.dp), verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxSize()) {
                    item(key = "hero") {
                        val i = info.data
                        Column(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(Brush.linearGradient(listOf(CcColors.Forest, CcColors.Emerald))).padding(18.dp),
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                IconBadge(Icons.Rounded.Psychology, Tone.Brand, size = 46.dp)
                                Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f)) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text(i?.name ?: "Official Counselling Support", style = MaterialTheme.typography.titleMedium, color = Color.White, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f, fill = false))
                                        Spacer(Modifier.width(6.dp))
                                        Icon(Icons.Rounded.Verified, contentDescription = "Verified", tint = CcColors.Emerald400, modifier = Modifier.size(18.dp))
                                    }
                                    Text("Verified CampusCare counsellors", style = MaterialTheme.typography.labelMedium, color = Color.White.copy(alpha = 0.85f))
                                }
                            }
                            Text(
                                i?.description?.ifBlank { null } ?: "Trusted mental-wellness guidance, support resources, and updates from CampusCare counsellors.",
                                style = MaterialTheme.typography.bodyMedium, color = Color.White, modifier = Modifier.padding(top = 10.dp),
                            )
                            if (i != null) Text("${i.followers} following · ${if (i.following) "You get notifications" else "Tap the bell for notifications"}", style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.8f), modifier = Modifier.padding(top = 6.dp))
                        }
                    }
                    item(key = "notice") {
                        EmergencyNotice(info.data?.emergencyNotice?.ifBlank { null } ?: "This channel is not an emergency service and counsellors may not reply straight away. If you or someone else is in immediate danger, use SOS or call 112.")
                    }
                    info.data?.let { i ->
                        if (i.canPublish) item(key = "publisher") {
                            CcCard(color = CcColors.Mint50) {
                                Text("You're a verified publisher", style = MaterialTheme.typography.titleSmall, color = CcColors.Forest)
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                                    CcButton("New post", { nav.navigate(Routes.channelCompose()) }, Modifier.weight(1f), kind = ButtonKind.Brand, leadingIcon = Icons.Rounded.Add)
                                    CcButton("Dashboard", { nav.navigate(Routes.ChannelDashboard) }, Modifier.weight(1f), kind = ButtonKind.Outline, leadingIcon = Icons.Rounded.Dashboard)
                                }
                            }
                        }
                        item(key = "counsellors") { CounsellorsCard(i.counsellors, opening, ::message) }
                    }
                    item(key = "events") {
                        ListRow("Sessions & workshops", subtitle = "Counselling sessions and wellness events", icon = Icons.Rounded.Event, tone = Tone.Teal, onClick = { nav.navigate(Routes.communityEvents("counselling")) })
                    }
                    item(key = "search") {
                        CcTextField(query, { query = it; if (it.isBlank()) applied = "" }, label = "Search the channel", leadingIcon = Icons.Rounded.Search, onImeAction = { applied = query.trim() })
                    }
                    item(key = "topics") { AnimatedChips(listOf("all" to "All topics") + TOPICS, topic, { topic = it }) }
                    when {
                        feed.loading -> item(key = "sk") { SkeletonList(3) }
                        feed.error != null && feed.items.isEmpty() -> item(key = "err") { ErrorState(feed.error?.message ?: "", onRetry = { feed.refresh() }, offline = feed.error?.isNetwork == true) }
                        feed.items.isEmpty() && feed.pinned.isEmpty() -> item(key = "empty") {
                            IllustratedEmpty(
                                R.drawable.community_empty_channel,
                                if (applied.isNotBlank() || topic != "all") "No posts match" else "No posts yet",
                                "Counsellors share wellness tips, resources and session news here. You can still message a counsellor privately.",
                            )
                        }
                        else -> {
                            if (feed.pinned.isNotEmpty()) item(key = "ph") { Text("Pinned", style = MaterialTheme.typography.titleSmall, color = CcColors.InkSoft) }
                            itemsIndexed(feed.pinned, key = { _, p -> "pin-" + p.id }) { idx, p ->
                                PostCard(p, actions, Modifier.enterStagger(idx), onOpen = { nav.navigate(Routes.communityPost(p.id)) }, onTag = { query = "#$it"; applied = "#$it" }, onEdit = { nav.navigate(Routes.channelCompose(p.id)) })
                            }
                            itemsIndexed(feed.items, key = { _, p -> p.id }) { idx, p ->
                                PostCard(p, actions, Modifier.enterStagger(idx), onOpen = { nav.navigate(Routes.communityPost(p.id)) }, onTag = { query = "#$it"; applied = "#$it" }, onEdit = { nav.navigate(Routes.channelCompose(p.id)) })
                            }
                            item(key = "footer") { PagingFooter(feed) }
                        }
                    }
                }
            }
        }
        CcButton(
            "Talk privately", { nav.navigate(Routes.CounsellorChats) },
            Modifier.align(Alignment.BottomEnd).navigationBarsPadding().padding(16.dp), kind = ButtonKind.Brand, leadingIcon = Icons.AutoMirrored.Rounded.Chat,
        )
    }
}

@Composable
private fun CounsellorsCard(counsellors: List<ChannelCounsellor>, opening: String?, onMessage: (ChannelCounsellor) -> Unit) {
    val nav = LocalNav.current
    val app = LocalApp.current
    val user by app.session.user.collectAsState()
    CcCard {
        Text("Talk to a counsellor privately", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
        Text("One-to-one and confidential. Messages here never appear in the community.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
        if (counsellors.isEmpty()) {
            NoCounsellorAvailable(Modifier.padding(top = 8.dp))
        }
        counsellors.forEachIndexed { i, c ->
            if (i > 0) Divider(Modifier.padding(vertical = 4.dp))
            Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Avatar(c.name, size = 42.dp, tone = Tone.Violet)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(c.name, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                        Icon(Icons.Rounded.Verified, contentDescription = "Verified counsellor", tint = CcColors.Emerald, modifier = Modifier.padding(start = 4.dp).size(14.dp))
                    }
                    val (label, tone) = availabilityChip(c.availability, c.nextAvailableAt)
                    StatusChip(label, tone, dot = true, modifier = Modifier.padding(top = 2.dp))
                }
                if (user?.role == "student") {
                    CcButton(if (opening == c.counsellorId) "Opening…" else "Message", { onMessage(c) }, kind = ButtonKind.Soft, enabled = opening == null)
                }
            }
        }
        if (counsellors.isNotEmpty() && counsellors.none { it.availability == "available" }) {
            InfoBanner(
                "No counsellor is in working hours right now. You can still send a message — they'll see it when they're back. For urgent help use the contacts below.",
                tone = Tone.Amber, modifier = Modifier.padding(top = 10.dp),
            )
            NoCounsellorAvailable(Modifier.padding(top = 6.dp))
        }
        if (user?.role == "student") {
            TextButton(onClick = { nav.navigate(Routes.bookSession()) }) { Text("Request a counselling appointment") }
        }
    }
}

/** Alternatives when no counsellor is available. */
@Composable
fun NoCounsellorAvailable(modifier: Modifier = Modifier) {
    val nav = LocalNav.current
    Row(modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        CcButton("Campus & helpline contacts", { nav.navigate(Routes.Contacts) }, kind = ButtonKind.Outline, leadingIcon = Icons.Rounded.Call)
        CcButton("Book a session", { nav.navigate(Routes.bookSession()) }, kind = ButtonKind.Ghost, leadingIcon = Icons.Rounded.CalendarMonth)
    }
}

// ------------------------------------------------------------------ private counsellor chats

/** Shown above a counselling thread: working-hours indicator, appointment request, alternatives. */
@Composable
fun CounsellingThreadBanner(c: edu.srmap.campuscare.data.ThreadCounsellor, student: Boolean) {
    val nav = LocalNav.current
    var expanded by rememberSaveable { mutableStateOf(c.availability != "available") }
    val (label, tone) = availabilityChip(c.availability, c.nextAvailableAt)
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp).clip(RoundedCornerShape(16.dp)).background(Color.White).padding(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            StatusChip(label, tone, dot = true)
            Spacer(Modifier.weight(1f))
            if (student) TextButton(onClick = { expanded = !expanded }) { Text(if (expanded) "Less" else "Options") }
        }
        if (student && expanded) {
            if (c.availabilityMessage.isNotBlank()) Text(c.availabilityMessage, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft, modifier = Modifier.padding(top = 4.dp))
            Text(
                "Not an emergency service — if you or someone else is in immediate danger, use SOS or call campus security / 112.",
                style = MaterialTheme.typography.labelSmall, color = CcColors.Sos, modifier = Modifier.padding(top = 4.dp),
            )
            Row(Modifier.padding(top = 6.dp).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                CcButton("Request appointment", { nav.navigate(Routes.bookSession(c.id)) }, kind = ButtonKind.Soft, leadingIcon = Icons.Rounded.CalendarMonth)
                if (c.availability != "available") CcButton("Other support", { nav.navigate(Routes.Contacts) }, kind = ButtonKind.Outline, leadingIcon = Icons.Rounded.Call)
            }
        }
    }
}

@Composable
fun CounsellorChatsScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val user by app.session.user.collectAsState()
    val student = user?.role == "student"
    val conversations = rememberLoad { app.api.counsellingChannel.conversations() }
    val channel = rememberLoad { app.api.counsellingChannel.channel() }
    var opening by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { app.realtime.events.collect { e -> if (e.name == "chat:message" || e.name == "notification") conversations.reload() } }

    CcScreen(
        title = "Counsellor chat", subtitle = if (student) "Private conversations with campus counsellors" else "Private conversations with students",
        onBack = { nav.popBackStack() }, refreshing = conversations.refreshing, onRefresh = { conversations.reload(); channel.reload() },
    ) {
        InfoBanner(
            if (student) "Only you and your counsellor can read these messages. They are never posted to the community." else "Only you and the student can read these conversations. Community moderators have no access.",
            icon = Icons.Rounded.Lock, tone = Tone.Violet,
        )
        EmergencyNotice("Counsellor chat is not an emergency service and replies may take time. If you or someone else is in immediate danger, use SOS or call campus security / 112.")
        LoadContent(conversations, skeleton = { SkeletonList(2) }) { list ->
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                SectionHeader("Your conversations")
                if (list.isEmpty()) Text(if (student) "No conversations yet. Choose a counsellor below to start one." else "No conversations yet.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                list.forEachIndexed { i, c -> ConversationRow(c, student, Modifier.enterStagger(i)) }
            }
        }
        if (student) {
            SectionHeader("Start a conversation")
            LoadContent(channel, skeleton = { SkeletonList(2) }) { i ->
                CounsellorsCard(i.counsellors, opening) { c ->
                    if (opening != null) return@CounsellorsCard
                    scope.launch {
                        opening = c.counsellorId
                        try {
                            nav.navigate(Routes.chat(app.api.counsellingChannel.startConversation(c.counsellorId).id))
                            conversations.reload()
                        } catch (e: ApiException) {
                            snack.error(e)
                        } finally {
                            opening = null
                        }
                    }
                }
            }
            Text(
                "Messages are kept while your account is active so you and your counsellor can refer back to them, and are handled under the university's counselling confidentiality policy. You can ask your counsellor or the university to delete your data from Profile → Privacy & data.",
                style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint,
            )
        }
    }
}

@Composable
private fun ConversationRow(c: CounsellingConversation, student: Boolean, modifier: Modifier = Modifier) {
    val nav = LocalNav.current
    val name = if (student) c.counsellor?.name ?: "Counsellor" else c.student?.name ?: "Student"
    CcCard(modifier, onClick = { nav.navigate(Routes.chat(c.id)) }, padding = 12.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Avatar(name, size = 42.dp, tone = Tone.Violet)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(name, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                Text(
                    listOfNotNull(
                        if (c.kind == "appointment") "Appointment thread" else null,
                        if (c.closed) "Closed" else null,
                        c.lastMessageAt?.let { "Last message ${Fmt.ago(it)}" } ?: "No messages yet",
                    ).joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft,
                )
                if (student) {
                    val (label, tone) = availabilityChip(c.availability.status, c.availability.nextAvailableAt)
                    StatusChip(label, tone, dot = true, modifier = Modifier.padding(top = 4.dp))
                }
            }
            if (c.unread > 0) StatusChip("${c.unread} new", Tone.Danger)
        }
    }
}

// ------------------------------------------------------------------ counsellor dashboard

@Composable
fun ChannelDashboardScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val dash = rememberLoad { app.api.counsellingChannel.dashboard() }
    var filter by rememberSaveable { mutableStateOf("all") }
    OnFeedChanged { dash.reload() }
    val actions = rememberPostActions(onChanged = { dash.reload() }, onRemoved = { dash.reload() })
    CcScreen(
        title = "Channel dashboard", subtitle = "Official Counselling Support", onBack = { nav.popBackStack() },
        refreshing = dash.refreshing, onRefresh = { dash.reload() },
        floating = { CcButton("New post", { nav.navigate(Routes.channelCompose()) }, kind = ButtonKind.Brand, leadingIcon = Icons.Rounded.Add) },
    ) {
        LoadContent(dash, skeleton = { SkeletonList(4) }) { d ->
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    StatTile("Published", "${d.totals.published}", Modifier.weight(1f))
                    StatTile("Drafts", "${d.totals.drafts}", Modifier.weight(1f), tone = Tone.Neutral)
                    StatTile("Scheduled", "${d.totals.scheduled}", Modifier.weight(1f), tone = Tone.Sky)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    StatTile("Reactions", "${d.totals.reactions}", Modifier.weight(1f), tone = Tone.Rose)
                    StatTile("Comments", "${d.totals.comments}", Modifier.weight(1f), tone = Tone.Teal)
                    StatTile("Views", "${d.totals.views}", Modifier.weight(1f), tone = Tone.Violet, icon = Icons.Rounded.Visibility)
                }
                Text(
                    "Last 7 days: ${d.totals.reactionsLast7Days} reactions, ${d.totals.commentsLast7Days} comments from students · ${d.followers} following · ${d.totals.bookmarks} saves. " +
                        "Counts only — you never see who viewed, reacted or saved.",
                    style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft,
                )
                AnimatedChips(listOf("all" to "All", "published" to "Published", "draft" to "Drafts", "scheduled" to "Scheduled"), filter, { filter = it })
                val shown = d.posts.filter { filter == "all" || it.status == filter }
                if (shown.isEmpty()) EmptyState("No posts here", message = "Write a wellness tip, resource or session announcement.", icon = Icons.Rounded.Psychology, tone = Tone.Violet)
                shown.forEachIndexed { i, p ->
                    Column(Modifier.enterStagger(i)) {
                        PostCard(p, actions, onOpen = { if (p.status == "published") nav.navigate(Routes.communityPost(p.id)) else nav.navigate(Routes.channelCompose(p.id)) }, onEdit = { nav.navigate(Routes.channelCompose(p.id)) })
                    }
                }
            }
        }
    }
}

// ------------------------------------------------------------------ counsellor composer

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChannelComposeScreen(editId: String?) {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val user by app.session.user.collectAsState()
    val editing = editId != null
    var body by rememberSaveable { mutableStateOf("") }
    var topic by rememberSaveable { mutableStateOf<String?>(null) }
    var tags by rememberSaveable { mutableStateOf("") }
    var commentsEnabled by rememberSaveable { mutableStateOf(true) }
    var pinned by rememberSaveable { mutableStateOf(false) }
    var scheduleAt by rememberSaveable { mutableStateOf<String?>(null) }
    val links = remember { mutableStateListOf<ResourceLink>() }
    val files = remember { mutableStateListOf<Attachment>() }
    val clientId = rememberSaveable { newClientId() }
    var status by remember { mutableStateOf("draft") }
    var loaded by rememberSaveable { mutableStateOf(!editing) }
    var uploading by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var errors by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var preview by remember { mutableStateOf<String?>(null) } // action being confirmed
    var linkDialog by remember { mutableStateOf(false) }
    var datePicker by remember { mutableStateOf(false) }
    var timePickerFor by remember { mutableStateOf<LocalDate?>(null) }
    var confirmDiscard by remember { mutableStateOf(false) }
    var dirty by remember { mutableStateOf(false) }

    LaunchedEffect(editId) {
        if (editId != null && !loaded) {
            try {
                val p = app.api.feed.post(editId)
                body = p.body; topic = p.topic; tags = p.tags.joinToString(" ") { "#$it" }; commentsEnabled = p.commentsEnabled; pinned = p.pinned
                links.clear(); links.addAll(p.resourceLinks); files.clear(); files.addAll(p.attachments)
                status = p.status; scheduleAt = p.scheduledAt
                loaded = true
            } catch (e: ApiException) {
                snack.error(e); nav.popBackStack()
            }
        }
    }
    BackHandler(enabled = dirty && !busy) { confirmDiscard = true }
    val published = editing && status == "published"

    val pickImages = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(FeedLimits.MAX_ATTACHMENTS)) { uris -> upload(uris, files, context, scope, app, snack) { uploading = it; dirty = true } }
    val pickPdf = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri -> if (uri != null) upload(listOf(uri), files, context, scope, app, snack) { uploading = it; dirty = true } }
    val tagList = tags.split(' ', ',').map { it.trim().removePrefix("#") }.filter { it.isNotBlank() }

    fun validate(): Boolean {
        errors = buildMap {
            if (body.trim().length < 3) put("body", "Write at least 3 characters")
            if (topic == null) put("topic", "Choose a topic")
            if (tagList.size > FeedLimits.MAX_TAGS) put("tags", "Use up to ${FeedLimits.MAX_TAGS} tags")
        }
        return errors.isEmpty()
    }

    fun save(action: String) {
        if (busy) return
        scope.launch {
            busy = true
            try {
                val payload = mutableMapOf<String, Any?>(
                    "body" to body.trim(), "topic" to topic, "tags" to tagList, "resourceLinks" to links.map { mapOf("title" to it.title, "url" to it.url) },
                    "commentsEnabled" to commentsEnabled, "pinned" to pinned,
                )
                if (!published) {
                    payload["status"] = action
                    payload["scheduledAt"] = if (action == "scheduled") scheduleAt else null
                }
                if (editId == null) {
                    payload["attachmentIds"] = files.map { it.id }
                    payload["clientId"] = clientId
                    app.api.counsellingChannel.create(payload)
                } else {
                    app.api.counsellingChannel.update(editId, payload)
                }
                dirty = false
                snack.show(
                    when (action) {
                        "published" -> if (published) "Post updated." else "Published as Official Counselling Support."
                        "scheduled" -> "Scheduled for ${Fmt.dayTime(scheduleAt)}."
                        else -> "Draft saved."
                    },
                )
                markFeedChanged(nav)
                nav.popBackStack()
            } catch (e: ApiException) {
                if (e.fields.isNotEmpty()) errors = e.fields
                snack.error(e)
            } finally {
                busy = false
                preview = null
            }
        }
    }

    CcScreen(
        title = if (editing) "Edit official post" else "New official post",
        subtitle = "Official Counselling Support",
        onBack = { if (dirty) confirmDiscard = true else nav.popBackStack() },
        bottomBar = {
            BottomActionBar {
                if (!published) CcButton("Save draft", { if (validate()) save("draft") }, Modifier.weight(1f), kind = ButtonKind.Ghost, enabled = loaded && !uploading)
                CcButton(
                    if (published) "Preview & save" else "Preview & publish", { if (validate()) preview = "published" }, Modifier.weight(1.4f),
                    kind = ButtonKind.Brand, enabled = loaded && !uploading, leadingIcon = Icons.Rounded.Visibility,
                )
            }
        },
    ) {
        // The identity indicator is shown before anything is published.
        PostingAsBanner()
        CcSelect("Topic", TOPICS, topic, { topic = it; dirty = true }, error = errors["topic"])
        CcTextField(body, { body = it; dirty = true }, label = "Wellness tip, resource or announcement", singleLine = false, minLines = 6, maxLength = FeedLimits.POST_MAX_CHARS, error = errors["body"], enabled = loaded)
        CcTextField(tags, { tags = it; dirty = true }, label = "Tags (optional)", placeholder = "#exam-stress #sleep", leadingIcon = Icons.Rounded.Tag, error = errors["tags"])

        SectionHeader("Trusted resource links")
        links.forEachIndexed { i, l ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.Link, contentDescription = null, tint = CcColors.Forest)
                Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f)) {
                    Text(l.title, style = MaterialTheme.typography.labelLarge, color = CcColors.Ink)
                    Text(l.url, style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft, maxLines = 1)
                }
                IconButton(onClick = { links.removeAt(i); dirty = true }) { Icon(Icons.Rounded.Close, contentDescription = "Remove link", tint = CcColors.InkSoft) }
            }
        }
        if (links.size < FeedLimits.MAX_RESOURCE_LINKS) CcButton("Add link", { linkDialog = true }, kind = ButtonKind.Soft, leadingIcon = Icons.Rounded.Link)

        if (!editing) {
            SectionHeader("Images & documents")
            Text("JPG, PNG or WEBP images and PDF documents · up to ${FeedLimits.MAX_ATTACHMENTS} files, ${FeedLimits.ATTACHMENT_MAX_MB} MB each. Files are checked by the server.", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                files.forEach { f ->
                    Box {
                        if (f.mimeType.startsWith("image/")) {
                            AsyncImage(model = app.api.feed.fileUrl(f.id), imageLoader = app.imageLoader, contentDescription = "Attached image", contentScale = ContentScale.Crop, modifier = Modifier.size(92.dp).clip(RoundedCornerShape(14.dp)))
                        } else {
                            Column(Modifier.size(92.dp).clip(RoundedCornerShape(14.dp)).background(CcColors.RoseSoft).padding(8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                                Icon(Icons.Rounded.PictureAsPdf, contentDescription = null, tint = CcColors.Rose)
                                Text(f.name, style = MaterialTheme.typography.labelSmall, color = CcColors.Ink, maxLines = 3)
                            }
                        }
                        IconButton(onClick = { files.remove(f) }, modifier = Modifier.align(Alignment.TopEnd).size(30.dp).background(CcColors.Ink.copy(alpha = 0.55f), CircleShape)) {
                            Icon(Icons.Rounded.Close, contentDescription = "Remove ${f.name}", tint = Color.White, modifier = Modifier.size(16.dp))
                        }
                    }
                }
            }
            if (files.size < FeedLimits.MAX_ATTACHMENTS) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    CcButton(if (uploading) "Uploading…" else "Add image", { pickImages.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, kind = ButtonKind.Soft, leadingIcon = Icons.Rounded.AddPhotoAlternate, enabled = !uploading)
                    CcButton("Add PDF", { pickPdf.launch("application/pdf") }, kind = ButtonKind.Soft, leadingIcon = Icons.Rounded.PictureAsPdf, enabled = !uploading)
                }
            }
        }

        SwitchRow("Allow comments", commentsEnabled, { commentsEnabled = it; dirty = true }, description = "Students can ask questions under the post. You'll be notified.")
        SwitchRow("Pin to the top of the channel", pinned, { pinned = it; dirty = true }, description = "Up to ${FeedLimits.MAX_PINNED} pinned posts for key resources and upcoming sessions.")
        if (!published) {
            SwitchRow("Schedule for later", scheduleAt != null, { on -> if (on) datePicker = true else scheduleAt = null; dirty = true })
            scheduleAt?.let { at ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Rounded.Schedule, contentDescription = null, tint = CcColors.Sky)
                    Spacer(Modifier.width(6.dp))
                    Text("Goes live ${Fmt.dayTime(at)}", style = MaterialTheme.typography.labelLarge, color = CcColors.Sky, modifier = Modifier.weight(1f))
                    TextButton(onClick = { datePicker = true }) { Text("Change") }
                }
            }
        }
        Text(
            "Never include students' names, case details or anything from private counselling conversations. Posts are public to all signed-in campus users.",
            style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft,
        )
    }

    preview?.let {
        val action = if (scheduleAt != null && !published) "scheduled" else "published"
        AlertDialog(
            onDismissRequest = { if (!busy) preview = null },
            containerColor = CcColors.Cream,
            title = { Text("Preview", style = MaterialTheme.typography.titleLarge) },
            text = {
                Column(Modifier.heightIn(max = 520.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    PostingAsBanner()
                    PostCard(
                        FeedPost(
                            id = "preview", body = body.trim(), topic = topic, topicLabel = TOPICS.firstOrNull { t -> t.first == topic }?.second, tags = tagList.map { t -> t.lowercase() },
                            attachments = files.toList(), resourceLinks = links.toList(), official = true, channel = FeedChannelRef("counselling", "Official Counselling Support"),
                            author = FeedAuthor(user?.fullName ?: "", "Verified counsellor", "counsellor", true), pinned = pinned,
                            status = if (action == "scheduled") "scheduled" else "published", scheduledAt = scheduleAt, publishedAt = Instant.now().toString(),
                        ),
                        actions = null, expanded = true,
                    )
                }
            },
            confirmButton = {
                CcButton(
                    when { published -> "Save changes"; action == "scheduled" -> "Schedule"; else -> "Post as Official Counselling Support" },
                    { save(action) }, kind = ButtonKind.Brand, loading = busy, leadingIcon = Icons.AutoMirrored.Rounded.Send,
                )
            },
            dismissButton = { TextButton(onClick = { preview = null }, enabled = !busy) { Text("Keep editing") } },
        )
    }
    if (linkDialog) LinkDialog(onDismiss = { linkDialog = false }) { l -> links.add(l); dirty = true; linkDialog = false }
    if (datePicker) {
        val state = rememberDatePickerState(selectableDates = object : androidx.compose.material3.SelectableDates {
            override fun isSelectableDate(utcTimeMillis: Long) = utcTimeMillis >= LocalDate.now().atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli() &&
                utcTimeMillis <= LocalDate.now().plusDays(90).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
        })
        DatePickerDialog(
            onDismissRequest = { datePicker = false },
            confirmButton = {
                TextButton(onClick = {
                    state.selectedDateMillis?.let { ms -> timePickerFor = Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate() }
                    datePicker = false
                }) { Text("Next") }
            },
            dismissButton = { TextButton(onClick = { datePicker = false }) { Text("Cancel") } },
        ) { DatePicker(state) }
    }
    timePickerFor?.let { day ->
        val t = rememberTimePickerState(initialHour = 9, initialMinute = 0)
        AlertDialog(
            onDismissRequest = { timePickerFor = null },
            containerColor = Color.White,
            title = { Text("Publish time") },
            text = { TimePicker(t) },
            confirmButton = {
                TextButton(onClick = {
                    val at = day.atTime(LocalTime.of(t.hour, t.minute)).atZone(ZoneId.systemDefault()).toInstant()
                    if (at.isBefore(Instant.now().plusSeconds(120))) snack.show("Choose a time at least a few minutes from now.")
                    else { scheduleAt = at.toString(); timePickerFor = null }
                }) { Text("Set") }
            },
            dismissButton = { TextButton(onClick = { timePickerFor = null }) { Text("Cancel") } },
        )
    }
    if (confirmDiscard) {
        ConfirmDialog(
            "Discard changes?", "Your post hasn't been saved. Save it as a draft to keep it.", confirmLabel = "Discard", destructive = true,
            onDismiss = { confirmDiscard = false }, onConfirm = { confirmDiscard = false; nav.popBackStack() },
        )
    }
}

private fun upload(
    uris: List<android.net.Uri>, into: MutableList<Attachment>, context: android.content.Context, scope: kotlinx.coroutines.CoroutineScope,
    app: edu.srmap.campuscare.AppContainer, snack: edu.srmap.campuscare.ui.components.Snack, busy: (Boolean) -> Unit,
) {
    scope.launch {
        busy(true)
        for (u in uris.take(FeedLimits.MAX_ATTACHMENTS - into.size)) {
            try {
                val f = readPicked(context, u, FeedLimits.ATTACHMENT_MAX_MB * 1024L * 1024L)
                into.add(app.api.feed.uploadImage(f.bytes, f.name, f.mime))
            } catch (e: ApiException) {
                snack.error(e)
            }
        }
        busy(false)
    }
}

@Composable
private fun PostingAsBanner() {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(CcColors.Mint).padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Rounded.Verified, contentDescription = null, tint = CcColors.Forest)
        Spacer(Modifier.width(8.dp))
        Column {
            Text("Post as Official Counselling Support", style = MaterialTheme.typography.titleSmall, color = CcColors.Forest)
            Text("Shown with the verified badge. Your name and the time are recorded in the audit log.", style = MaterialTheme.typography.labelSmall, color = CcColors.Forest700)
        }
    }
}

@Composable
private fun LinkDialog(onDismiss: () -> Unit, onAdd: (ResourceLink) -> Unit) {
    var title by remember { mutableStateOf("") }
    var url by remember { mutableStateOf("https://") }
    var error by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Color.White,
        title = { Text("Add a trusted link") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                CcTextField(title, { title = it }, label = "Title", maxLength = 80)
                CcTextField(url, { url = it.trim() }, label = "Link (https only)", error = error, keyboardType = androidx.compose.ui.text.input.KeyboardType.Uri)
                Text("Only link to trusted sources such as university pages or recognised helplines.", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
            }
        },
        confirmButton = {
            TextButton(onClick = {
                val ok = url.startsWith("https://") && android.util.Patterns.WEB_URL.matcher(url).matches()
                when {
                    title.trim().length < 2 -> error = "Give the link a title"
                    !ok -> error = "Enter a valid https:// link"
                    else -> onAdd(ResourceLink(title.trim(), url))
                }
            }) { Text("Add") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
