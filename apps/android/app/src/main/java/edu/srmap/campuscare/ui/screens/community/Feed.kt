package edu.srmap.campuscare.ui.screens.community

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.DirectionsWalk
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.AddPhotoAlternate
import androidx.compose.material.icons.rounded.Block
import androidx.compose.material.icons.rounded.Bookmarks
import androidx.compose.material.icons.rounded.Call
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.EmojiObjects
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.Event
import androidx.compose.material.icons.rounded.Flag
import androidx.compose.material.icons.rounded.Forum
import androidx.compose.material.icons.rounded.Inventory2
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.Place
import androidx.compose.material.icons.rounded.Psychology
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Tag
import androidx.compose.material.icons.rounded.Verified
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import edu.srmap.campuscare.R
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.Attachment
import edu.srmap.campuscare.data.CommentPage
import edu.srmap.campuscare.data.FEED_CATEGORIES
import edu.srmap.campuscare.data.FeedComment
import edu.srmap.campuscare.data.FeedFeatured
import edu.srmap.campuscare.data.FeedLimits
import edu.srmap.campuscare.data.FeedPost
import edu.srmap.campuscare.data.feed
import edu.srmap.campuscare.data.newClientId
import edu.srmap.campuscare.ui.components.Avatar
import edu.srmap.campuscare.ui.components.BottomActionBar
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.CcTextField
import edu.srmap.campuscare.ui.components.ConfirmDialog
import edu.srmap.campuscare.ui.components.EmptyState
import edu.srmap.campuscare.ui.components.ErrorState
import edu.srmap.campuscare.ui.components.IconBadge
import edu.srmap.campuscare.ui.components.InfoBanner
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.ScreenHeader
import edu.srmap.campuscare.ui.components.SkeletonBlock
import edu.srmap.campuscare.ui.components.SkeletonList
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.SwitchRow
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.enterStagger
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.Fmt
import edu.srmap.campuscare.util.readPicked
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch

private val SCOPES = mapOf("feed" to "Community feed", "mine" to "My posts", "bookmarks" to "Saved posts")

/** Users who may publish official announcements (the server makes the final decision). */
fun canAnnounce(role: String?, permissions: List<String>): Boolean =
    role == "admin" || role == "super_admin" || "announcements:manage" in permissions

// ------------------------------------------------------------------ Campus Community (feed)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CommunityScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val user by app.session.user.collectAsState()
    val config by app.config.config.collectAsState()
    var category by rememberSaveable { mutableStateOf("all") }
    var scope by rememberSaveable { mutableStateOf("feed") }
    var searchOpen by rememberSaveable { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    var applied by rememberSaveable { mutableStateOf("") }
    var menuOpen by remember { mutableStateOf(false) }
    val feed = rememberPagedFeed(Triple(category, scope, applied)) { cursor ->
        app.api.feed.posts(category.takeIf { scope == "feed" }, applied.takeIf { scope == "feed" }, cursor, scope)
    }
    val featured = rememberLoad { app.api.feed.featured() }
    val actions = rememberPostActions(onChanged = feed::replace, onRemoved = feed::remove, onBlocked = { feed.refresh() })
    val list = rememberLazyListState()
    InfiniteScroll(list) { feed.loadMore() }
    // A post created or edited on another screen shows up when we come back.
    OnFeedChanged { feed.refresh() }

    Box(Modifier.fillMaxSize().background(CcColors.Cream)) {
        Column(Modifier.fillMaxSize()) {
            ScreenHeader(
                title = "Campus Community",
                subtitle = "Connect, learn, and look out for one another.",
                onBack = { nav.popBackStack() },
                actions = {
                    IconButton(onClick = { searchOpen = !searchOpen; if (!searchOpen && applied.isNotEmpty()) { query = ""; applied = "" } }) {
                        Icon(if (searchOpen) Icons.Rounded.Close else Icons.Rounded.Search, contentDescription = if (searchOpen) "Close search" else "Search posts", tint = CcColors.Ink)
                    }
                    IconButton(onClick = { nav.navigate(Routes.Notifications) }) { Icon(Icons.Rounded.Notifications, contentDescription = "Notifications", tint = CcColors.Ink) }
                    Box {
                        Box(
                            Modifier.padding(horizontal = 4.dp).clip(CircleShape).clickable(role = Role.Button) { menuOpen = true }
                                .semantics { contentDescription = "Your community options" },
                        ) { Avatar(user?.fullName ?: "Me", size = 36.dp) }
                        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                            listOf(
                                Triple("My posts", Icons.Rounded.Person) { scope = "mine" },
                                Triple("Saved posts", Icons.Rounded.Bookmarks) { scope = "bookmarks" },
                                Triple("Blocked accounts", Icons.Rounded.Block) { nav.navigate(Routes.BlockedAccounts) },
                                Triple("Chat channels & tools", Icons.Rounded.Forum) { nav.navigate(Routes.CommunitySpaces) },
                                Triple("Profile", Icons.Rounded.Person) { nav.navigate(Routes.Profile) },
                            ).forEach { (label, icon, go) ->
                                DropdownMenuItem(text = { Text(label) }, leadingIcon = { Icon(icon, null, tint = CcColors.InkSoft) }, onClick = { menuOpen = false; go() })
                            }
                        }
                    }
                },
            )
            PullToRefreshBox(isRefreshing = feed.refreshing, onRefresh = { feed.refresh(pull = true); featured.reload() }, modifier = Modifier.weight(1f)) {
                LazyColumn(state = list, contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 110.dp), verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxSize()) {
                    item(key = "search") {
                        androidx.compose.animation.AnimatedVisibility(visible = searchOpen, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
                            CcTextField(
                                query, { query = it; if (it.isBlank()) applied = "" }, label = "Search posts or #tags", leadingIcon = Icons.Rounded.Search,
                                onImeAction = { applied = query.trim(); scope = "feed" },
                                hint = "Search words in posts, or start with # to find a tag.",
                            )
                        }
                    }
                    if (scope != "feed") {
                        item(key = "scope") {
                            InfoBanner("Showing ${SCOPES[scope]}.", icon = if (scope == "mine") Icons.Rounded.Person else Icons.Rounded.Bookmarks, action = {
                                TextButton(onClick = { scope = "feed" }) { Text("Back to feed") }
                            })
                        }
                    } else {
                        item(key = "chips") { AnimatedChips(listOf("all" to "All") + FEED_CATEGORIES, category, { category = it }) }
                        if (category == "all" && applied.isBlank()) {
                            item(key = "featured") { FeaturedRow(featured.data) }
                            item(key = "spaces") { SpacesRow(config.settings.community.lostFoundEnabled) }
                        }
                        if (applied.isNotBlank()) {
                            item(key = "results") { Text("Results for “$applied”", style = MaterialTheme.typography.titleSmall, color = CcColors.InkSoft) }
                        }
                    }
                    when {
                        feed.loading -> item(key = "skeleton") { SkeletonList(3) }
                        feed.error != null && feed.items.isEmpty() -> item(key = "error") {
                            ErrorState(feed.error?.message ?: "Please try again.", onRetry = { feed.refresh() }, offline = feed.error?.isNetwork == true)
                        }
                        feed.disabled -> item(key = "off") { EmptyState("The community feed is turned off", message = "Your university has paused the feed. Support and safety tools still work.", icon = Icons.Rounded.Forum) }
                        feed.items.isEmpty() && feed.pinned.isEmpty() -> item(key = "empty") {
                            IllustratedEmpty(
                                R.drawable.community_empty_feed,
                                title = when {
                                    applied.isNotBlank() -> "No posts match your search"
                                    scope == "bookmarks" -> "No saved posts yet"
                                    scope == "mine" -> "You haven't posted yet"
                                    category != "all" -> "Nothing in ${FEED_CATEGORIES.firstOrNull { it.first == category }?.second ?: "this category"} yet"
                                    else -> "Be the first to post"
                                },
                                message = if (scope == "bookmarks") "Tap the bookmark on any post to keep it here." else "Share a safety tip, an event or a kind word with your campus.",
                                action = { CcButton("Create post", { nav.navigate(Routes.communityCompose(category = category.takeIf { it != "all" })) }, kind = ButtonKind.Soft, leadingIcon = Icons.Rounded.Add) },
                            )
                        }
                        else -> {
                            if (feed.pinned.isNotEmpty()) item(key = "pinnedHeader") { Text("Pinned announcements", style = MaterialTheme.typography.titleSmall, color = CcColors.InkSoft) }
                            itemsIndexed(feed.pinned, key = { _, p -> "pin-" + p.id }) { i, p ->
                                PostCard(p, actions, Modifier.enterStagger(i), onOpen = { nav.navigate(Routes.communityPost(p.id)) }, onTag = { applyTag(it) { t -> query = t; applied = t; searchOpen = true } }, onEdit = { nav.navigate(Routes.communityCompose(edit = p.id)) })
                            }
                            itemsIndexed(feed.items, key = { _, p -> p.id }) { i, p ->
                                PostCard(p, actions, Modifier.enterStagger(i), onOpen = { nav.navigate(Routes.communityPost(p.id)) }, onTag = { applyTag(it) { t -> query = t; applied = t; searchOpen = true } }, onEdit = { nav.navigate(Routes.communityCompose(edit = p.id)) })
                            }
                            item(key = "footer") { PagingFooter(feed) }
                        }
                    }
                    item(key = "note") {
                        Text(
                            "Community posts are shared by members and are not verified facts. Official university communications carry an “Official” label.",
                            style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint, modifier = Modifier.padding(top = 4.dp),
                        )
                    }
                }
            }
        }
        CcButton(
            "Create post", { nav.navigate(Routes.communityCompose(category = category.takeIf { it != "all" })) },
            Modifier.align(Alignment.BottomEnd).navigationBarsPadding().padding(16.dp),
            kind = ButtonKind.Brand, leadingIcon = Icons.Rounded.Add,
        )
    }
}

private fun applyTag(tag: String, set: (String) -> Unit) = set("#$tag")

/** Calls [onEnd] when the list is scrolled near its last item. */
@Composable
fun InfiniteScroll(state: LazyListState, onEnd: () -> Unit) {
    val nearEnd by remember { derivedStateOf { val info = state.layoutInfo; info.totalItemsCount > 0 && (info.visibleItemsInfo.lastOrNull()?.index ?: 0) >= info.totalItemsCount - 3 } }
    LaunchedEffect(state) { snapshotFlow { nearEnd }.distinctUntilChanged().filter { it }.collect { onEnd() } }
}

@Composable
fun PagingFooter(feed: PagedFeed) {
    when {
        feed.loadingMore -> SkeletonBlock(height = 120.dp)
        feed.moreError != null -> Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(feed.moreError?.message ?: "Couldn't load more.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
            TextButton(onClick = { feed.loadMore() }) { Text("Try again") }
        }
        feed.endReached && feed.items.size > 4 -> Text("You're all caught up.", style = MaterialTheme.typography.labelMedium, color = CcColors.InkFaint, modifier = Modifier.fillMaxWidth().padding(8.dp))
    }
}

/** Featured safety banner: official pinned announcements, campaigns, upcoming events and the counselling channel. */
@Composable
private fun FeaturedRow(f: FeedFeatured?) {
    val nav = LocalNav.current
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        f?.announcements?.take(3)?.forEachIndexed { i, a ->
            FeatureCard(
                "Official announcement", a.body.lineSequence().first().take(90), "From ${a.author.name}", Icons.Rounded.Verified,
                listOf(CcColors.Forest, CcColors.Emerald), Modifier.enterStagger(i),
            ) { nav.navigate(Routes.communityPost(a.id)) }
        }
        FeatureCard(
            "Official Counselling Support", "Wellness tips, resources and private chats with counsellors.", "Verified counsellors", Icons.Rounded.Psychology,
            listOf(CcColors.Violet, CcColors.Teal), Modifier.enterStagger(1),
        ) { nav.navigate(Routes.CounsellingChannel) }
        f?.events?.firstOrNull()?.let { e ->
            FeatureCard("Upcoming · ${Fmt.dayTime(e.startsAt)}", e.title, e.venue, Icons.Rounded.Event, listOf(CcColors.Teal, CcColors.Emerald400), Modifier.enterStagger(2)) {
                nav.navigate(Routes.communityEvent(e.id))
            }
        }
        FeatureCard("Stay safe after dark", "Start a Safe Walk so trusted contacts know you got home.", "Safety tools", Icons.AutoMirrored.Rounded.DirectionsWalk, listOf(CcColors.ForestDeep, CcColors.Teal), Modifier.enterStagger(3)) {
            nav.navigate(Routes.SafeWalk)
        }
        FeatureCard("Know your emergency contacts", "Verified campus numbers that work without internet.", "Campus security", Icons.Rounded.Call, listOf(CcColors.SosDeep, CcColors.Rose), Modifier.enterStagger(4)) {
            nav.navigate(Routes.Contacts)
        }
    }
}

@Composable
private fun FeatureCard(eyebrow: String, title: String, footer: String, icon: ImageVector, colors: List<Color>, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Column(
        modifier.width(250.dp).height(150.dp).clip(RoundedCornerShape(22.dp)).background(Brush.linearGradient(colors))
            .clickable(role = Role.Button, onClick = onClick).padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text(eyebrow, style = MaterialTheme.typography.labelMedium, color = Color.White.copy(alpha = 0.92f), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Spacer(Modifier.height(8.dp))
        Text(title, style = MaterialTheme.typography.titleMedium, color = Color.White, fontWeight = FontWeight.Bold, maxLines = 3, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        Text(footer, style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.85f), maxLines = 1)
    }
}

@Composable
private fun SpacesRow(lostFound: Boolean) {
    val nav = LocalNav.current
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        SpaceChip("Events", Icons.Rounded.Event, Tone.Teal) { nav.navigate(Routes.communityEvents()) }
        SpaceChip("Counsellor chat", Icons.Rounded.Psychology, Tone.Violet) { nav.navigate(Routes.CounsellorChats) }
        if (lostFound) SpaceChip("Lost & Found board", Icons.Rounded.Inventory2, Tone.Amber) { nav.navigate(Routes.LostFound) }
        SpaceChip("Report a hazard", Icons.Rounded.Warning, Tone.Rose) { nav.navigate(Routes.Hazard) }
        SpaceChip("Channels & ideas", Icons.Rounded.EmojiObjects, Tone.Sky) { nav.navigate(Routes.CommunitySpaces) }
    }
}

@Composable
private fun SpaceChip(label: String, icon: ImageVector, tone: Tone, onClick: () -> Unit) {
    Row(
        Modifier.clip(RoundedCornerShape(16.dp)).background(Color.White).clickable(role = Role.Button, onClick = onClick).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconBadge(icon, tone, size = 28.dp, iconSize = 16.dp)
        Spacer(Modifier.width(8.dp))
        Text(label, style = MaterialTheme.typography.labelLarge, color = CcColors.Ink)
    }
}

// ------------------------------------------------------------------ create / edit post

@Composable
fun CommunityComposeScreen(editId: String?, initialCategory: String?) {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val user by app.session.user.collectAsState()
    val announcer = canAnnounce(user?.role, user?.permissions.orEmpty())
    val editing = editId != null
    var body by rememberSaveable { mutableStateOf("") }
    var category by rememberSaveable { mutableStateOf(initialCategory?.takeIf { c -> FEED_CATEGORIES.any { it.first == c } && (c != "announcements" || announcer) }) }
    var tags by rememberSaveable { mutableStateOf("") }
    var withPlace by rememberSaveable { mutableStateOf(false) }
    var place by rememberSaveable { mutableStateOf("") }
    var official by rememberSaveable { mutableStateOf(false) }
    val clientId = rememberSaveable { newClientId() }
    val images = remember { mutableStateListOf<Attachment>() }
    var uploading by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var errors by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var confirmDiscard by remember { mutableStateOf(false) }
    var crisis by remember { mutableStateOf<String?>(null) }
    var loaded by rememberSaveable { mutableStateOf(!editing) }
    var original by remember { mutableStateOf<FeedPost?>(null) }

    LaunchedEffect(editId) {
        if (editId != null && !loaded) {
            try {
                val p = app.api.feed.post(editId)
                original = p
                body = p.body; category = p.category; tags = p.tags.joinToString(" ") { "#$it" }
                withPlace = p.locationLabel != null; place = p.locationLabel.orEmpty(); official = p.official
                loaded = true
            } catch (e: ApiException) {
                snack.error(e); nav.popBackStack()
            }
        }
    }
    val dirty = if (editing) original?.let { body != it.body || category != it.category } ?: false else body.isNotBlank() || images.isNotEmpty() || tags.isNotBlank()
    BackHandler(enabled = dirty && !busy) { confirmDiscard = true }

    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(FeedLimits.MAX_ATTACHMENTS)) { uris ->
        scope.launch {
            uploading = true
            for (u in uris.take(FeedLimits.MAX_ATTACHMENTS - images.size)) {
                try {
                    val f = readPicked(context, u, FeedLimits.ATTACHMENT_MAX_MB * 1024L * 1024L)
                    images.add(app.api.feed.uploadImage(f.bytes, f.name, f.mime))
                } catch (e: ApiException) {
                    snack.error(e)
                }
            }
            uploading = false
        }
    }
    val tagList = tags.split(' ', ',').map { it.trim().removePrefix("#") }.filter { it.isNotBlank() }

    fun submit() {
        errors = buildMap {
            if (body.trim().length < 3) put("body", "Write at least 3 characters")
            if (category == null) put("category", "Choose a category")
            if (tagList.size > FeedLimits.MAX_TAGS) put("tags", "Use up to ${FeedLimits.MAX_TAGS} tags")
            if (withPlace && place.trim().length < 2) put("place", "Type the place name, or turn this off")
        }
        if (errors.isNotEmpty() || busy) return
        scope.launch {
            busy = true
            try {
                val location = if (withPlace) place.trim() else null
                if (editId != null) {
                    app.api.feed.update(editId, mapOf("body" to body.trim(), "category" to category, "tags" to tagList, "locationLabel" to (location ?: "")))
                    snack.show("Post updated.")
                    markFeedChanged(nav)
                    nav.popBackStack()
                } else {
                    val r = app.api.feed.create(
                        mapOf(
                            "body" to body.trim(), "category" to category, "tags" to tagList, "attachmentIds" to images.map { it.id },
                            "locationLabel" to location, "official" to (official || category == "announcements"), "clientId" to clientId,
                        ),
                    )
                    snack.show(r.message ?: "Posted.", long = r.held)
                    markFeedChanged(nav)
                    if (r.crisisSupport != null) crisis = r.crisisSupport else nav.popBackStack()
                }
            } catch (e: ApiException) {
                if (e.fields.isNotEmpty()) errors = e.fields
                snack.error(e)
            } finally {
                busy = false
            }
        }
    }

    CcScreen(
        title = if (editing) "Edit post" else "Create post",
        subtitle = "Share with your campus community",
        onBack = { if (dirty) confirmDiscard = true else nav.popBackStack() },
        bottomBar = {
            BottomActionBar {
                CcButton("Cancel", { if (dirty) confirmDiscard = true else nav.popBackStack() }, Modifier.weight(1f), kind = ButtonKind.Ghost)
                CcButton(if (editing) "Save" else "Post", ::submit, Modifier.weight(1f), kind = ButtonKind.Brand, loading = busy, enabled = !uploading && loaded, leadingIcon = Icons.AutoMirrored.Rounded.Send)
            }
        },
    ) {
        InfoBanner(
            "Do not share passwords, private contact details, confidential counselling information, or another person's sensitive information.",
            tone = Tone.Amber, icon = Icons.Rounded.Lock, title = "Before you post",
        )
        CcTextField(
            body, { body = it }, label = "What would you like to share?", singleLine = false, minLines = 5,
            maxLength = FeedLimits.POST_MAX_CHARS, error = errors["body"], enabled = loaded,
        )
        Text("Category", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
        AnimatedChips(FEED_CATEGORIES.filter { it.first != "announcements" || announcer }, category ?: "", { category = it })
        errors["category"]?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = CcColors.Sos) }
        if (announcer && !editing && category != "announcements") {
            SwitchRow("Publish as an official announcement", official, { official = it }, description = "Shown with an Official label. Only authorised university accounts can do this.")
        }
        CcTextField(tags, { tags = it }, label = "Tags (optional)", placeholder = "#night-safety #library", leadingIcon = Icons.Rounded.Tag, error = errors["tags"], hint = "Up to ${FeedLimits.MAX_TAGS} tags, separated by spaces.")

        SwitchRow(
            "Add a place name", withPlace, { withPlace = it },
            description = "Optional. Only the words you type are shared — never your GPS location.",
        )
        if (withPlace) {
            CcTextField(place, { place = it }, label = "Place", placeholder = "e.g. Library walkway", leadingIcon = Icons.Rounded.Place, error = errors["place"], maxLength = 120)
            if (place.isNotBlank()) Text("This will be shown on your post: 📍 ${place.trim()}", style = MaterialTheme.typography.labelMedium, color = CcColors.Forest)
        }

        if (!editing) {
            Text("Images (optional, up to ${FeedLimits.MAX_ATTACHMENTS} · JPG, PNG or WEBP · ${FeedLimits.ATTACHMENT_MAX_MB} MB each)", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                images.forEach { img ->
                    Box {
                        AsyncImage(
                            model = app.api.feed.fileUrl(img.id), imageLoader = app.imageLoader, contentDescription = "Selected image", contentScale = ContentScale.Crop,
                            modifier = Modifier.size(92.dp).clip(RoundedCornerShape(14.dp)),
                        )
                        IconButton(onClick = { images.remove(img) }, modifier = Modifier.align(Alignment.TopEnd).size(30.dp).background(CcColors.Ink.copy(alpha = 0.55f), CircleShape)) {
                            Icon(Icons.Rounded.Close, contentDescription = "Remove image", tint = Color.White, modifier = Modifier.size(16.dp))
                        }
                    }
                }
                if (images.size < FeedLimits.MAX_ATTACHMENTS) {
                    CcButton(if (uploading) "Uploading…" else "Add image", { pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, kind = ButtonKind.Soft, leadingIcon = Icons.Rounded.AddPhotoAlternate, enabled = !uploading)
                }
            }
            Text("Make sure images don't show other people's faces, ID cards or private details without their consent.", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
        }
    }

    if (confirmDiscard) {
        ConfirmDialog(
            "Discard this post?", "Your changes haven't been posted and will be lost.", confirmLabel = "Discard", destructive = true,
            onDismiss = { confirmDiscard = false }, onConfirm = { confirmDiscard = false; nav.popBackStack() },
        )
    }
    crisis?.let { CrisisDialog(it, onDismiss = { crisis = null; nav.popBackStack() }) }
}

// ------------------------------------------------------------------ post details and comments

@Composable
fun CommunityPostScreen(id: String) {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val post = rememberLoad(id) { app.api.feed.post(id) }
    var comments by remember { mutableStateOf<CommentPage?>(null) }
    var commentsError by remember { mutableStateOf<ApiException?>(null) }
    var loadingMore by remember { mutableStateOf(false) }
    var text by rememberSaveable { mutableStateOf("") }
    var replyTo by remember { mutableStateOf<FeedComment?>(null) }
    var editing by remember { mutableStateOf<FeedComment?>(null) }
    var clientId by rememberSaveable { mutableStateOf(newClientId()) }
    var sending by remember { mutableStateOf(false) }
    var deleteTarget by remember { mutableStateOf<FeedComment?>(null) }
    var crisis by remember { mutableStateOf<String?>(null) }

    suspend fun loadComments() {
        try {
            comments = app.api.feed.comments(id, null)
            commentsError = null
        } catch (e: ApiException) {
            commentsError = e
        }
    }
    LaunchedEffect(id) { loadComments() }
    val actions = rememberPostActions(
        onChanged = { post.set(it); markFeedChanged(nav) },
        onRemoved = { markFeedChanged(nav); nav.popBackStack() },
        onBlocked = { markFeedChanged(nav); nav.popBackStack() },
    )
    OnFeedChanged { post.reload() }

    fun send() {
        val body = text.trim()
        if (body.isEmpty() || sending) return
        scope.launch {
            sending = true
            try {
                val target = editing
                if (target != null) {
                    app.api.feed.editComment(target.id, body)
                    editing = null
                } else {
                    val r = app.api.feed.comment(id, body, replyTo?.id, clientId)
                    post.data?.let { post.set(it.copy(commentCount = r.commentCount)) }
                    r.message?.let { snack.show(it, long = true) }
                    r.crisisSupport?.let { crisis = it }
                    replyTo = null
                }
                text = ""
                clientId = newClientId()
                loadComments()
            } catch (e: ApiException) {
                snack.error(e)
            } finally {
                sending = false
            }
        }
    }

    Column(Modifier.fillMaxSize().background(CcColors.Cream)) {
        ScreenHeader(title = post.data?.let { if (it.official) "Official post" else "Post" } ?: "Post", subtitle = post.data?.author?.name, onBack = { nav.popBackStack() })
        LoadContent(post, modifier = Modifier.weight(1f)) { p ->
            LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxSize()) {
                item(key = "post") {
                    PostCard(p, actions, expanded = true, onEdit = { nav.navigate(if (p.channel != null) Routes.channelCompose(p.id) else Routes.communityCompose(edit = p.id)) })
                }
                item(key = "header") { Text("Comments (${p.commentCount})", style = MaterialTheme.typography.titleMedium, color = CcColors.Ink) }
                val page = comments
                when {
                    !p.commentsEnabled -> item(key = "off") { InfoBanner("Comments are turned off for this post.", tone = Tone.Neutral) }
                    commentsError != null && page == null -> item(key = "cerr") { ErrorState(commentsError?.message ?: "", onRetry = { scope.launch { loadComments() } }, offline = commentsError?.isNetwork == true) }
                    page == null -> item(key = "cload") { SkeletonList(2) }
                    page.items.isEmpty() -> item(key = "cempty") { Text("No comments yet. Start a kind, helpful conversation.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft) }
                    else -> {
                        itemsIndexed(page.items, key = { _, c -> c.id }) { i, c ->
                            Column(Modifier.enterStagger(i), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                CommentRow(c, onReply = { replyTo = c; editing = null }, onEdit = { editing = c; replyTo = null; text = c.body }, onDelete = { deleteTarget = c }, actions = actions)
                                c.replies.forEach { r ->
                                    Box(Modifier.padding(start = 28.dp)) {
                                        CommentRow(r, onReply = { replyTo = c; editing = null }, onEdit = { editing = r; replyTo = null; text = r.body }, onDelete = { deleteTarget = r }, actions = actions)
                                    }
                                }
                            }
                        }
                        page.nextCursor?.let { cursor ->
                            item(key = "cmore") {
                                CcButton("Load more comments", {
                                    scope.launch {
                                        loadingMore = true
                                        try {
                                            val more = app.api.feed.comments(id, cursor)
                                            comments = page.copy(items = page.items + more.items.filter { m -> page.items.none { it.id == m.id } }, nextCursor = more.nextCursor)
                                        } catch (e: ApiException) {
                                            snack.error(e)
                                        } finally {
                                            loadingMore = false
                                        }
                                    }
                                }, Modifier.fillMaxWidth(), kind = ButtonKind.Ghost, loading = loadingMore)
                            }
                        }
                    }
                }
            }
        }
        val p = post.data
        if (p != null && p.commentsEnabled && p.status == "published") {
            CommentComposer(
                text, { text = it },
                context = when {
                    editing != null -> "Editing your comment"
                    replyTo != null -> "Replying to ${replyTo?.author?.name}"
                    else -> null
                },
                onCancelContext = { replyTo = null; if (editing != null) { editing = null; text = "" } },
                sending = sending, onSend = ::send,
            )
        }
    }

    deleteTarget?.let { c ->
        ConfirmDialog(
            "Delete this comment?", "It will be removed for everyone.", confirmLabel = "Delete", destructive = true,
            onDismiss = { deleteTarget = null },
            onConfirm = {
                scope.launch {
                    try {
                        val r = app.api.feed.deleteComment(c.id)
                        r.commentCount?.let { n -> post.data?.let { post.set(it.copy(commentCount = n)) } }
                        deleteTarget = null
                        loadComments()
                    } catch (e: ApiException) {
                        snack.error(e)
                    }
                }
            },
        )
    }
    crisis?.let { CrisisDialog(it, onDismiss = { crisis = null }) }
}

@Composable
private fun CommentRow(c: FeedComment, onReply: () -> Unit, onEdit: () -> Unit, onDelete: () -> Unit, actions: PostActions) {
    var menu by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth()) {
        Box(Modifier.clip(CircleShape).clickable(enabled = !c.mine, role = Role.Button) { actions.authorTarget = "comment" to c.id }) {
            Avatar(c.author.name, size = 34.dp, tone = if (c.author.verified) Tone.Brand else Tone.Neutral)
        }
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f).clip(RoundedCornerShape(16.dp)).background(Color.White).padding(horizontal = 12.dp, vertical = 8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(c.author.name, style = MaterialTheme.typography.labelLarge, color = CcColors.Ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                if (c.author.verified) Icon(Icons.Rounded.Verified, contentDescription = "Verified", tint = CcColors.Emerald, modifier = Modifier.padding(start = 4.dp).size(14.dp))
                if (c.isPostAuthor) StatusChip("Author", Tone.Neutral, modifier = Modifier.padding(start = 6.dp))
                Spacer(Modifier.weight(1f))
                Box {
                    IconButton(onClick = { menu = true }, modifier = Modifier.size(32.dp)) { Icon(Icons.Rounded.MoreVert, contentDescription = "Comment options", tint = CcColors.InkFaint, modifier = Modifier.size(18.dp)) }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        if (c.canEdit) DropdownMenuItem(text = { Text("Edit") }, leadingIcon = { Icon(Icons.Rounded.Edit, null) }, onClick = { menu = false; onEdit() })
                        if (c.canDelete) DropdownMenuItem(text = { Text("Delete", color = CcColors.Sos) }, leadingIcon = { Icon(Icons.Rounded.Delete, null, tint = CcColors.Sos) }, onClick = { menu = false; onDelete() })
                        if (!c.mine) {
                            DropdownMenuItem(text = { Text("Report comment") }, leadingIcon = { Icon(Icons.Rounded.Flag, null) }, onClick = { menu = false; actions.reportTarget = ReportTarget("comment", c.id, label = "this comment") })
                            DropdownMenuItem(text = { Text("Block user", color = CcColors.Sos) }, leadingIcon = { Icon(Icons.Rounded.Block, null, tint = CcColors.Sos) }, onClick = { menu = false; actions.blockTarget = "comment" to c.id })
                        }
                    }
                }
            }
            Text(c.body, style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink)
            c.moderationNote?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = CcColors.Amber, modifier = Modifier.padding(top = 4.dp)) }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(Fmt.ago(c.createdAt) + if (c.editedAt != null) " · edited" else "", style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint)
                if (c.status == "published") TextButton(onClick = onReply) { Text("Reply", style = MaterialTheme.typography.labelMedium) }
            }
        }
    }
}

@Composable
private fun CommentComposer(text: String, onText: (String) -> Unit, context: String?, onCancelContext: () -> Unit, sending: Boolean, onSend: () -> Unit) {
    Column(Modifier.fillMaxWidth().background(Color.White).navigationBarsPadding().imePadding().padding(horizontal = 12.dp, vertical = 8.dp)) {
        context?.let {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(it, style = MaterialTheme.typography.labelMedium, color = CcColors.Forest, modifier = Modifier.weight(1f))
                IconButton(onClick = onCancelContext, modifier = Modifier.size(32.dp)) { Icon(Icons.Rounded.Close, contentDescription = "Cancel", tint = CcColors.InkSoft, modifier = Modifier.size(16.dp)) }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            CcTextField(text, onText, label = "Add a comment", singleLine = false, maxLength = FeedLimits.COMMENT_MAX_CHARS, modifier = Modifier.weight(1f))
            Spacer(Modifier.width(6.dp))
            IconButton(onClick = onSend, enabled = text.isNotBlank() && !sending, modifier = Modifier.size(48.dp).clip(CircleShape).background(if (text.isNotBlank() && !sending) CcColors.Forest else CcColors.CreamDeep)) {
                Icon(Icons.AutoMirrored.Rounded.Send, contentDescription = "Send comment", tint = Color.White)
            }
        }
    }
}

// ------------------------------------------------------------------ blocked accounts

@Composable
fun BlockedAccountsScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val list = rememberLoad { app.api.feed.blocks() }
    CcScreen(title = "Blocked accounts", subtitle = "You don't see their posts, comments or messages", onBack = { nav.popBackStack() }, refreshing = list.refreshing, onRefresh = { list.reload() }) {
        LoadContent(list) { items ->
            if (items.isEmpty()) EmptyState("You haven't blocked anyone", icon = Icons.Rounded.Block)
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items.forEach { b ->
                    CcCard {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Avatar(b.name, size = 40.dp, tone = Tone.Neutral)
                            Spacer(Modifier.width(10.dp))
                            Column(Modifier.weight(1f)) {
                                Text(b.name, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                                Text("Blocked ${Fmt.ago(b.createdAt)}", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
                            }
                            CcButton("Unblock", {
                                scope.launch {
                                    try {
                                        app.api.feed.unblock(b.id); list.reload(); snack.show("Unblocked.")
                                    } catch (e: ApiException) {
                                        snack.error(e)
                                    }
                                }
                            }, kind = ButtonKind.Outline)
                        }
                    }
                }
            }
        }
    }
}
