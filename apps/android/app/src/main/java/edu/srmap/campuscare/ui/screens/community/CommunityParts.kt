package edu.srmap.campuscare.ui.screens.community

import android.content.Context
import android.content.Intent
import androidx.annotation.DrawableRes
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.OpenInNew
import androidx.compose.material.icons.rounded.Block
import androidx.compose.material.icons.rounded.Bookmark
import androidx.compose.material.icons.rounded.BookmarkBorder
import androidx.compose.material.icons.rounded.Campaign
import androidx.compose.material.icons.rounded.ChatBubbleOutline
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material.icons.rounded.Flag
import androidx.compose.material.icons.rounded.Gavel
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.PersonOff
import androidx.compose.material.icons.rounded.PictureAsPdf
import androidx.compose.material.icons.rounded.Place
import androidx.compose.material.icons.rounded.PushPin
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material.icons.rounded.Verified
import androidx.compose.material.icons.rounded.Visibility
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import coil.compose.AsyncImage
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.Attachment
import edu.srmap.campuscare.data.AuthorPreview
import edu.srmap.campuscare.data.FEED_REPORT_REASONS
import edu.srmap.campuscare.data.FeedPage
import edu.srmap.campuscare.data.FeedPost
import edu.srmap.campuscare.data.counsellingChannel
import edu.srmap.campuscare.data.feed
import edu.srmap.campuscare.data.feedCategoryLabel
import edu.srmap.campuscare.ui.components.Avatar
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcTextField
import edu.srmap.campuscare.ui.components.ConfirmDialog
import edu.srmap.campuscare.ui.components.InfoBanner
import edu.srmap.campuscare.ui.components.InputDialog
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.ui.theme.LocalReducedMotion
import edu.srmap.campuscare.util.Fmt
import edu.srmap.campuscare.util.dial
import edu.srmap.campuscare.util.openUrl
import edu.srmap.campuscare.util.shareText
import java.io.File
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

// ------------------------------------------------------------------ paged feed state

/**
 * A feed that pages with the server's cursor. Items are replaced in place after mutations so
 * counts shown always come from server responses.
 */
@Stable
class PagedFeed(private val scope: CoroutineScope, private val fetch: suspend (cursor: String?) -> FeedPage) {
    var items by mutableStateOf<List<FeedPost>>(emptyList())
        private set
    var pinned by mutableStateOf<List<FeedPost>>(emptyList())
        private set
    var loading by mutableStateOf(true)
        private set
    var refreshing by mutableStateOf(false)
        private set
    var loadingMore by mutableStateOf(false)
        private set
    var error by mutableStateOf<ApiException?>(null)
        private set
    var moreError by mutableStateOf<ApiException?>(null)
        private set
    var disabled by mutableStateOf(false)
        private set
    private var cursor: String? = null
    var endReached by mutableStateOf(false)
        private set
    private var generation = 0

    fun refresh(pull: Boolean = false) {
        val gen = ++generation
        if (pull) refreshing = true else if (items.isEmpty()) loading = true
        scope.launch {
            try {
                val page = fetch(null)
                if (gen != generation) return@launch
                items = page.items
                pinned = page.pinned
                disabled = page.disabled
                cursor = page.nextCursor
                endReached = page.nextCursor == null
                error = null
                moreError = null
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                if (gen == generation) error = e
            } finally {
                if (gen == generation) {
                    loading = false
                    refreshing = false
                }
            }
        }
    }

    fun loadMore() {
        if (loadingMore || endReached || loading) return
        val gen = generation
        val c = cursor ?: return
        loadingMore = true
        moreError = null
        scope.launch {
            try {
                val page = fetch(c)
                if (gen != generation) return@launch
                val seen = (items + pinned).map { it.id }.toSet()
                items = items + page.items.filter { it.id !in seen }
                cursor = page.nextCursor
                endReached = page.nextCursor == null
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                if (gen == generation) moreError = e
            } finally {
                loadingMore = false
            }
        }
    }

    fun replace(post: FeedPost) {
        items = items.map { if (it.id == post.id) post else it }
        pinned = pinned.map { if (it.id == post.id) post else it }
    }

    fun remove(id: String) {
        items = items.filterNot { it.id == id }
        pinned = pinned.filterNot { it.id == id }
    }

    fun prepend(post: FeedPost) {
        items = listOf(post) + items.filterNot { it.id == post.id }
    }
}

@Composable
fun rememberPagedFeed(key: Any?, fetch: suspend (cursor: String?) -> FeedPage): PagedFeed {
    val scope = rememberCoroutineScope()
    val feed = remember(key) { PagedFeed(scope, fetch) }
    LaunchedEffect(key) { feed.refresh() }
    return feed
}

/** Tell the screen underneath that its feed changed (it refreshes when shown again). */
fun markFeedChanged(nav: androidx.navigation.NavController) {
    nav.previousBackStackEntry?.savedStateHandle?.set(FEED_CHANGED, true)
}

private const val FEED_CHANGED = "feedChanged"

@Composable
fun OnFeedChanged(onChanged: () -> Unit) {
    val nav = LocalNav.current
    val entry = remember { nav.currentBackStackEntry }
    val flag = remember(entry) { entry?.savedStateHandle?.getStateFlow(FEED_CHANGED, false) }
    val changed by (flag ?: kotlinx.coroutines.flow.MutableStateFlow(false)).collectAsState()
    LaunchedEffect(changed) {
        if (changed) {
            entry?.savedStateHandle?.set(FEED_CHANGED, false)
            onChanged()
        }
    }
}

// ------------------------------------------------------------------ post interactions

/**
 * Reactions, bookmarks, reports, blocking, deletion and pinning for a post. Reactions and bookmarks
 * update optimistically and roll back if the server rejects them.
 */
@Stable
class PostActions(
    private val context: Context,
    private val scope: CoroutineScope,
    private val app: edu.srmap.campuscare.AppContainer,
    private val snack: edu.srmap.campuscare.ui.components.Snack,
    private val onChanged: (FeedPost) -> Unit,
    private val onRemoved: (String) -> Unit,
) {
    var reportTarget by mutableStateOf<ReportTarget?>(null)
    var blockTarget by mutableStateOf<Pair<String, String>?>(null) // via, id
    var deleteTarget by mutableStateOf<FeedPost?>(null)
    var appealTarget by mutableStateOf<FeedPost?>(null)
    var authorTarget by mutableStateOf<Pair<String, String>?>(null)
    private val inFlight = mutableSetOf<String>()

    fun toggleReaction(p: FeedPost) {
        if (p.status != "published" || !inFlight.add("r" + p.id)) return
        val on = p.myReaction == null
        onChanged(p.copy(myReaction = if (on) "like" else null, reactionCount = (p.reactionCount + if (on) 1 else -1).coerceAtLeast(0)))
        scope.launch {
            try {
                val r = if (on) app.api.feed.react(p.id) else app.api.feed.unreact(p.id)
                onChanged(p.copy(myReaction = r.myReaction, reactionCount = r.reactionCount))
            } catch (e: ApiException) {
                onChanged(p)
                snack.error(e)
            } finally {
                inFlight.remove("r" + p.id)
            }
        }
    }

    fun toggleBookmark(p: FeedPost) {
        if (!inFlight.add("b" + p.id)) return
        val on = !p.bookmarked
        onChanged(p.copy(bookmarked = on))
        scope.launch {
            try {
                val r = app.api.feed.bookmark(p.id, on)
                onChanged(p.copy(bookmarked = r.bookmarked))
                snack.show(if (r.bookmarked) "Saved to your bookmarks." else "Removed from bookmarks.")
            } catch (e: ApiException) {
                onChanged(p)
                snack.error(e)
            } finally {
                inFlight.remove("b" + p.id)
            }
        }
    }

    fun share(p: FeedPost) {
        val who = if (p.official) "${p.author.name} (official)" else p.author.name
        val text = buildString {
            append(p.body.take(600))
            if (p.body.length > 600) append("…")
            append("\n\n— $who, shared from the CampusCare community")
        }
        context.shareText("CampusCare community post", text)
    }

    fun setPinned(p: FeedPost, pinned: Boolean) = scope.launch {
        try {
            val updated = if (p.channel != null) app.api.counsellingChannel.update(p.id, mapOf("pinned" to pinned)) else app.api.feed.update(p.id, mapOf("pinned" to pinned))
            onChanged(updated)
            snack.show(if (pinned) "Pinned." else "Unpinned.")
        } catch (e: ApiException) {
            snack.error(e)
        }
    }

    fun delete(p: FeedPost, done: () -> Unit) = scope.launch {
        try {
            if (p.channel != null) app.api.counsellingChannel.delete(p.id) else app.api.feed.delete(p.id)
            onRemoved(p.id)
            snack.show("Post deleted.")
            done()
        } catch (e: ApiException) {
            snack.error(e)
        }
    }

    fun block(via: String, id: String, done: () -> Unit) = scope.launch {
        try {
            val r = app.api.feed.block(via, id)
            snack.show(r.message ?: "Blocked.", long = true)
            done()
        } catch (e: ApiException) {
            snack.error(e)
        }
    }

    fun appeal(p: FeedPost, reason: String, done: () -> Unit) = scope.launch {
        try {
            val r = app.api.feed.appeal("post", p.id, reason)
            snack.show(r.message ?: "Appeal sent.", long = true)
            done()
        } catch (e: ApiException) {
            snack.error(e)
        }
    }
}

data class ReportTarget(val type: String, val id: String, val via: String? = null, val label: String)

@Composable
fun rememberPostActions(onChanged: (FeedPost) -> Unit, onRemoved: (String) -> Unit, onBlocked: () -> Unit = {}): PostActions {
    val app = LocalApp.current
    val snack = LocalSnack.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val actions = remember { PostActions(context, scope, app, snack, onChanged, onRemoved) }
    PostActionDialogs(actions, onBlocked)
    return actions
}

@Composable
private fun PostActionDialogs(a: PostActions, onBlocked: () -> Unit) {
    var busy by remember { mutableStateOf(false) }
    a.reportTarget?.let { t -> ReportDialog(t, onDismiss = { a.reportTarget = null }) }
    a.blockTarget?.let { (via, id) ->
        ConfirmDialog(
            "Block this person?",
            "You won't see their posts or comments, and they can't comment on yours. They are not told. You can unblock them later from Community → Blocked accounts.",
            confirmLabel = "Block", destructive = true, loading = busy,
            onDismiss = { a.blockTarget = null },
            onConfirm = {
                busy = true
                a.block(via, id) { a.blockTarget = null; onBlocked() }.invokeOnCompletion { busy = false }
            },
        )
    }
    a.deleteTarget?.let { p ->
        ConfirmDialog(
            "Delete this post?", "It will be removed for everyone, including its comments. This can't be undone.",
            confirmLabel = "Delete", destructive = true, loading = busy,
            onDismiss = { a.deleteTarget = null },
            onConfirm = {
                busy = true
                a.delete(p) { a.deleteTarget = null }.invokeOnCompletion { busy = false }
            },
        )
    }
    a.appealTarget?.let { p ->
        InputDialog(
            "Appeal this decision", "A different moderator will look at your post again. Explain why you think it should be visible.",
            label = "Why should it be restored?", confirmLabel = "Send appeal", minLength = 10, loading = busy,
            onDismiss = { a.appealTarget = null },
            onConfirm = { reason ->
                busy = true
                a.appeal(p, reason.trim()) { a.appealTarget = null }.invokeOnCompletion { busy = false }
            },
        )
    }
    a.authorTarget?.let { (via, id) ->
        AuthorSheet(via, id, onDismiss = { a.authorTarget = null }, onBlock = { a.authorTarget = null; a.blockTarget = via to id }, onReport = {
            a.authorTarget = null
            a.reportTarget = ReportTarget("user", id, via, "this person")
        })
    }
}

// ------------------------------------------------------------------ post card

@Composable
fun PostCard(
    p: FeedPost,
    actions: PostActions?,
    modifier: Modifier = Modifier,
    onOpen: (() -> Unit)? = null,
    onTag: ((String) -> Unit)? = null,
    onEdit: (() -> Unit)? = null,
    expanded: Boolean = false,
) {
    val app = LocalApp.current
    val context = LocalContext.current
    val official = p.official
    CcCard(modifier, onClick = onOpen, padding = 14.dp, color = if (official) CcColors.Mint50 else Color.White) {
        // Author row: who posted, verified role (icon + words, never colour alone), when, category.
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.clip(CircleShape).clickable(enabled = actions != null && !p.mine, role = Role.Button) { actions?.authorTarget = "post" to p.id }
                    .semantics { contentDescription = "View ${p.author.name}'s profile" },
            ) { Avatar(p.author.name, size = 42.dp, tone = if (p.author.verified) Tone.Brand else if (p.author.badge == "staff") Tone.Sky else Tone.Neutral) }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(p.author.name, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    if (p.author.verified) {
                        Spacer(Modifier.width(4.dp))
                        Icon(Icons.Rounded.Verified, contentDescription = "Verified", tint = CcColors.Emerald, modifier = Modifier.size(16.dp))
                    }
                }
                Text(
                    listOfNotNull(p.author.roleLabel.ifBlank { null }, Fmt.ago(p.publishedAt ?: p.createdAt), if (p.editedAt != null) "edited" else null).joinToString(" · "),
                    style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft, maxLines = 1,
                )
            }
            if (actions != null) PostMenu(p, actions, onEdit)
        }
        Row(Modifier.padding(top = 8.dp).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            if (p.pinned) StatusChip("Pinned", Tone.Amber)
            if (official) StatusChip(if (p.channel != null) "Official · ${p.channel.name}" else "Official announcement", Tone.Brand, dot = true)
            val label = p.topicLabel ?: feedCategoryLabel(p.category).takeIf { p.channel == null }
            label?.let { StatusChip(it, Tone.Neutral) }
            statusLabel(p.status)?.let { (text, tone) -> StatusChip(text, tone) }
        }
        p.moderationNote?.let {
            InfoBanner(it, tone = if (p.status == "pending_review") Tone.Amber else Tone.Danger, icon = Icons.Rounded.Gavel, modifier = Modifier.padding(top = 8.dp))
        }
        if (p.status == "scheduled" && p.scheduledAt != null) {
            Text("Scheduled for ${Fmt.dayTime(p.scheduledAt)}", style = MaterialTheme.typography.labelMedium, color = CcColors.Sky, modifier = Modifier.padding(top = 6.dp))
        }
        Text(
            p.body, style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink,
            maxLines = if (expanded) Int.MAX_VALUE else 8, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 8.dp),
        )
        if (!expanded && p.body.length > 420) Text("Read more", style = MaterialTheme.typography.labelLarge, color = CcColors.Emerald, modifier = Modifier.padding(top = 2.dp))
        if (p.tags.isNotEmpty()) TagRow(p.tags, onTag)
        p.locationLabel?.let { loc ->
            Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.Place, contentDescription = null, tint = CcColors.InkSoft, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(4.dp))
                Text(loc, style = MaterialTheme.typography.labelMedium, color = CcColors.InkSoft)
            }
        }
        AttachmentsView(p.attachments, app.api.feed::fileUrl, expanded)
        p.resourceLinks.forEach { l ->
            Row(
                Modifier.padding(top = 6.dp).fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color.White).border(1.dp, CcColors.Line, RoundedCornerShape(12.dp))
                    .clickable(role = Role.Button) { context.openUrl(l.url) }.padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Rounded.Link, contentDescription = null, tint = CcColors.Forest, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f)) {
                    Text(l.title, style = MaterialTheme.typography.labelLarge, color = CcColors.Forest, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(l.url.removePrefix("https://").substringBefore('/'), style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft, maxLines = 1)
                }
                Icon(Icons.AutoMirrored.Rounded.OpenInNew, contentDescription = "Opens in browser", tint = CcColors.InkFaint, modifier = Modifier.size(16.dp))
            }
        }
        if (actions != null) {
            Row(Modifier.padding(top = 6.dp).fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                LikeButton(p.myReaction != null, p.reactionCount, enabled = p.status == "published") { actions.toggleReaction(p) }
                CountButton(Icons.Rounded.ChatBubbleOutline, p.commentCount, "Comments", onClick = onOpen)
                Spacer(Modifier.weight(1f))
                p.viewCount?.let { v ->
                    Icon(Icons.Rounded.Visibility, contentDescription = null, tint = CcColors.InkFaint, modifier = Modifier.size(16.dp))
                    Text(" $v", style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint, modifier = Modifier.semantics { contentDescription = "$v views" })
                    Spacer(Modifier.width(4.dp))
                }
                IconButton(onClick = { actions.toggleBookmark(p) }, modifier = Modifier.semantics { stateDescription = if (p.bookmarked) "Saved" else "Not saved" }) {
                    Icon(if (p.bookmarked) Icons.Rounded.Bookmark else Icons.Rounded.BookmarkBorder, contentDescription = if (p.bookmarked) "Remove bookmark" else "Bookmark", tint = if (p.bookmarked) CcColors.Forest else CcColors.InkSoft)
                }
                if (p.status == "published") {
                    IconButton(onClick = { actions.share(p) }) { Icon(Icons.Rounded.Share, contentDescription = "Share", tint = CcColors.InkSoft) }
                }
            }
        }
    }
}

private fun statusLabel(status: String): Pair<String, Tone>? = when (status) {
    "pending_review" -> "Under review" to Tone.Amber
    "hidden" -> "Hidden by moderators" to Tone.Danger
    "removed" -> "Removed" to Tone.Danger
    "draft" -> "Draft" to Tone.Neutral
    "scheduled" -> "Scheduled" to Tone.Sky
    else -> null
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TagRow(tags: List<String>, onTag: ((String) -> Unit)?) {
    FlowRow(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        tags.forEach { t ->
            Text(
                "#$t", style = MaterialTheme.typography.labelMedium, color = CcColors.Teal,
                modifier = Modifier.clip(RoundedCornerShape(8.dp)).then(if (onTag != null) Modifier.clickable(role = Role.Button) { onTag(t) } else Modifier).padding(horizontal = 2.dp, vertical = 2.dp),
            )
        }
    }
}

@Composable
private fun PostMenu(p: FeedPost, a: PostActions, onEdit: (() -> Unit)?) {
    var open by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true }) { Icon(Icons.Rounded.MoreVert, contentDescription = "More options", tint = CcColors.InkSoft) }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            fun item(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, danger: Boolean = false, onClick: () -> Unit) = @Composable {
                DropdownMenuItem(
                    text = { Text(label, color = if (danger) CcColors.Sos else CcColors.Ink) },
                    leadingIcon = { Icon(icon, contentDescription = null, tint = if (danger) CcColors.Sos else CcColors.InkSoft) },
                    onClick = { open = false; onClick() },
                )
            }
            if (p.canEdit && onEdit != null) item("Edit post", Icons.Rounded.Edit, onClick = onEdit)()
            if (p.canPin) item(if (p.pinned) "Unpin" else "Pin to top", Icons.Rounded.PushPin) { a.setPinned(p, !p.pinned) }()
            if (p.canAppeal) item("Appeal decision", Icons.Rounded.Gavel) { a.appealTarget = p }()
            if (p.canDelete) item("Delete post", Icons.Rounded.Delete, danger = true) { a.deleteTarget = p }()
            if (!p.mine) {
                item("Report post", Icons.Rounded.Flag) { a.reportTarget = ReportTarget("post", p.id, label = "this post") }()
                item("Report user", Icons.Rounded.PersonOff) { a.reportTarget = ReportTarget("user", p.id, via = "post", label = "this person") }()
                if (!(p.official && p.author.badge != null)) item("Block user", Icons.Rounded.Block, danger = true) { a.blockTarget = "post" to p.id }()
            }
        }
    }
}

/** Heart that pops briefly when tapped (skipped with reduced motion). */
@Composable
fun LikeButton(liked: Boolean, count: Int, enabled: Boolean = true, onClick: () -> Unit) {
    val reduced = LocalReducedMotion.current
    val scale = remember { Animatable(1f) }
    var taps by remember { mutableStateOf(0) }
    LaunchedEffect(taps) {
        if (taps > 0 && !reduced) {
            scale.animateTo(1.3f, tween(90))
            scale.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy))
        }
    }
    val tint by animateColorAsState(if (liked) CcColors.Rose else CcColors.InkSoft, label = "like")
    Row(
        Modifier.clip(RoundedCornerShape(50)).clickable(enabled = enabled, role = Role.Button, onClick = { taps++; onClick() })
            .heightIn(min = 48.dp).padding(horizontal = 10.dp)
            .semantics(mergeDescendants = true) { contentDescription = if (liked) "Unlike. $count reactions" else "Like. $count reactions" },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(if (liked) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder, contentDescription = null, tint = tint, modifier = Modifier.size(22.dp).scale(scale.value))
        Spacer(Modifier.width(4.dp))
        Text("$count", style = MaterialTheme.typography.labelLarge, color = CcColors.InkSoft)
    }
}

@Composable
private fun CountButton(icon: androidx.compose.ui.graphics.vector.ImageVector, count: Int, label: String, onClick: (() -> Unit)?) {
    Row(
        Modifier.clip(RoundedCornerShape(50)).then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
            .heightIn(min = 48.dp).padding(horizontal = 10.dp).semantics(mergeDescendants = true) { contentDescription = "$label: $count" },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = CcColors.InkSoft, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(4.dp))
        Text("$count", style = MaterialTheme.typography.labelLarge, color = CcColors.InkSoft)
    }
}

/** Images inline; PDF documents (official posts only) as rows that open in a viewer app. */
@Composable
fun AttachmentsView(files: List<Attachment>, fileUrl: (String) -> String, large: Boolean) {
    if (files.isEmpty()) return
    val app = LocalApp.current
    val images = files.filter { it.mimeType.startsWith("image/") }
    val docs = files - images.toSet()
    if (images.isNotEmpty()) {
        Row(Modifier.padding(top = 8.dp).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            images.forEach { f ->
                AsyncImage(
                    model = fileUrl(f.id), imageLoader = app.imageLoader, contentDescription = "Image attached to the post", contentScale = ContentScale.Crop,
                    modifier = Modifier
                        .then(if (images.size == 1) Modifier.fillMaxWidth() else Modifier.width(220.dp))
                        .height(if (large) 240.dp else 180.dp).clip(RoundedCornerShape(16.dp)).background(CcColors.CreamDeep),
                )
            }
        }
    }
    docs.forEach { f -> DocumentRow(f) }
}

@Composable
private fun DocumentRow(f: Attachment) {
    val app = LocalApp.current
    val snack = LocalSnack.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var opening by remember { mutableStateOf(false) }
    Row(
        Modifier.padding(top = 6.dp).fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color.White).border(1.dp, CcColors.Line, RoundedCornerShape(12.dp))
            .clickable(enabled = !opening, role = Role.Button) {
                scope.launch {
                    opening = true
                    try {
                        val bytes = app.api.client.download("/community/files/${f.id}")
                        val dir = File(context.cacheDir, "exports").apply { mkdirs() }
                        val file = File(dir, f.name.replace(Regex("[^A-Za-z0-9._-]"), "_").ifBlank { "document.pdf" }).apply { writeBytes(bytes) }
                        val uri = FileProvider.getUriForFile(context, context.packageName + ".files", file)
                        val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, f.mimeType).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        context.startActivity(Intent.createChooser(view, f.name).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    } catch (e: ApiException) {
                        snack.error(e)
                    } catch (e: android.content.ActivityNotFoundException) {
                        snack.show("Install a PDF viewer to open this document.")
                    } finally {
                        opening = false
                    }
                }
            }
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Rounded.PictureAsPdf, contentDescription = null, tint = CcColors.Rose, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) {
            Text(f.name, style = MaterialTheme.typography.labelLarge, color = CcColors.Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(if (opening) "Opening…" else Fmt.bytes(f.sizeBytes), style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
        }
    }
}

// ------------------------------------------------------------------ report, author preview

@Composable
fun ReportDialog(t: ReportTarget, onDismiss: () -> Unit) {
    val app = LocalApp.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    var reason by rememberSaveable { mutableStateOf<String?>(null) }
    var details by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var crisis by remember { mutableStateOf<String?>(null) }
    if (crisis != null) {
        CrisisDialog(crisis!!, onDismiss = { crisis = null; onDismiss() })
        return
    }
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        containerColor = Color.White,
        title = { Text("Report ${t.label}", style = MaterialTheme.typography.titleLarge) },
        text = {
            Column(Modifier.heightIn(max = 460.dp).verticalScroll(rememberScrollState())) {
                Text("Moderators review every report. The author is not told who reported it.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                Spacer(Modifier.height(6.dp))
                FEED_REPORT_REASONS.forEach { (key, label) ->
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).selectable(selected = reason == key, role = Role.RadioButton) { reason = key }.heightIn(min = 44.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = reason == key, onClick = null, colors = RadioButtonDefaults.colors(selectedColor = CcColors.Forest))
                        Spacer(Modifier.width(8.dp))
                        Text(label, style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink)
                    }
                }
                if (reason == "self_harm" || reason == "threat") {
                    InfoBanner("If someone is in immediate danger, use SOS or call campus security / 112 now. Reports are not an emergency service.", tone = Tone.Danger, modifier = Modifier.padding(vertical = 6.dp))
                }
                CcTextField(details, { details = it }, label = "Details (optional)", singleLine = false, minLines = 2, maxLength = 500)
            }
        },
        confirmButton = {
            CcButton("Send report", {
                val r = reason ?: return@CcButton snack.show("Choose a reason.")
                scope.launch {
                    busy = true
                    try {
                        val res = app.api.feed.report(t.type, t.id, r, details.trim().ifBlank { null }, t.via)
                        snack.show(if (res.duplicate) "You already reported this. Moderators will review it." else res.message ?: "Thanks for reporting.", long = true)
                        if (res.crisisSupport != null) crisis = res.crisisSupport else onDismiss()
                    } catch (e: ApiException) {
                        snack.error(e)
                    } finally {
                        busy = false
                    }
                }
            }, kind = ButtonKind.Danger, loading = busy, enabled = reason != null)
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text("Cancel", color = CcColors.InkSoft) } },
    )
}

/** Shown when text mentions self-harm: points to immediate help, never blocks the person. */
@Composable
fun CrisisDialog(message: String, onDismiss: () -> Unit) {
    val nav = LocalNav.current
    val context = LocalContext.current
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Color.White,
        icon = { Icon(Icons.Rounded.Favorite, contentDescription = null, tint = CcColors.Violet) },
        title = { Text("You're not alone", textAlign = TextAlign.Center) },
        text = { Text(message, style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink) },
        confirmButton = {
            Column(horizontalAlignment = Alignment.End) {
                CcButton("Open SOS", { onDismiss(); nav.navigate(Routes.Sos) }, kind = ButtonKind.Danger)
                TextButton(onClick = { context.dial("112") }) { Text("Call 112", color = CcColors.Sos) }
                TextButton(onClick = { onDismiss(); nav.navigate(Routes.CounsellorChats) }) { Text("Talk to a counsellor", color = CcColors.Violet) }
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Close", color = CcColors.InkSoft) } },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AuthorSheet(via: String, id: String, onDismiss: () -> Unit, onBlock: () -> Unit, onReport: () -> Unit) {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    var preview by remember { mutableStateOf<AuthorPreview?>(null) }
    var failed by remember { mutableStateOf<String?>(null) }
    var opening by remember { mutableStateOf(false) }
    LaunchedEffect(via, id) {
        try {
            preview = app.api.feed.author(via, id)
        } catch (e: ApiException) {
            failed = e.message
        }
    }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = CcColors.Cream) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            val p = preview
            when {
                failed != null -> Text(failed ?: "", color = CcColors.InkSoft)
                p == null -> Text("Loading…", color = CcColors.InkSoft, modifier = Modifier.padding(24.dp))
                else -> {
                    Avatar(p.name, size = 72.dp, tone = if (p.verified) Tone.Brand else Tone.Neutral)
                    Spacer(Modifier.height(10.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(p.name, style = MaterialTheme.typography.titleLarge, color = CcColors.Ink)
                        if (p.verified) {
                            Spacer(Modifier.width(6.dp))
                            Icon(Icons.Rounded.Verified, contentDescription = "Verified", tint = CcColors.Emerald)
                        }
                    }
                    Text(p.roleLabel, style = MaterialTheme.typography.labelLarge, color = if (p.verified) CcColors.Forest else CcColors.InkSoft)
                    val facts = listOfNotNull(p.department, p.memberSince?.let { "Member since $it" }, p.posts?.let { "$it posts" })
                    if (facts.isNotEmpty()) Text(facts.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft, modifier = Modifier.padding(top = 4.dp))
                    if (p.official) StatusChip("Official university account", Tone.Brand, modifier = Modifier.padding(top = 8.dp))
                    if (p.blocked) StatusChip("You blocked this person", Tone.Neutral, modifier = Modifier.padding(top = 8.dp))
                    Spacer(Modifier.height(16.dp))
                    p.counsellorId?.let { cid ->
                        CcButton("Message privately", {
                            scope.launch {
                                opening = true
                                try {
                                    val c = app.api.counsellingChannel.startConversation(cid)
                                    onDismiss()
                                    nav.navigate(Routes.chat(c.id))
                                } catch (e: ApiException) {
                                    snack.error(e)
                                } finally {
                                    opening = false
                                }
                            }
                        }, Modifier.fillMaxWidth(), kind = ButtonKind.Brand, loading = opening)
                        Text("Private and separate from the community feed.", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft, modifier = Modifier.padding(top = 4.dp, bottom = 8.dp))
                    }
                    if (!p.isSelf) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            CcButton("Report", onReport, Modifier.weight(1f), kind = ButtonKind.Outline, leadingIcon = Icons.Rounded.Flag)
                            if (!p.blocked && !(p.official && p.verified)) CcButton("Block", onBlock, Modifier.weight(1f), kind = ButtonKind.Ghost, leadingIcon = Icons.Rounded.Block)
                        }
                    }
                }
            }
        }
    }
}

// ------------------------------------------------------------------ chips, empty states

/** Category chips with an animated selected state (colour + gentle scale). */
@Composable
fun AnimatedChips(options: List<Pair<String, String>>, selected: String, onSelect: (String) -> Unit, modifier: Modifier = Modifier) {
    val reduced = LocalReducedMotion.current
    Row(modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { (value, label) ->
            val active = value == selected
            val bg by animateColorAsState(if (active) CcColors.Forest else Color.White, tween(if (reduced) 0 else 220), label = "chipBg")
            val fg by animateColorAsState(if (active) Color.White else CcColors.Ink, tween(if (reduced) 0 else 220), label = "chipFg")
            val scale by animateFloatAsState(if (active && !reduced) 1.04f else 1f, spring(stiffness = 600f), label = "chipScale")
            Box(
                Modifier
                    .scale(scale)
                    .clip(RoundedCornerShape(50))
                    .background(bg)
                    .border(1.dp, if (active) CcColors.Forest else CcColors.Line, RoundedCornerShape(50))
                    .selectable(selected = active, role = Role.Tab) { onSelect(value) }
                    .heightIn(min = 40.dp)
                    .padding(horizontal = 16.dp)
                    .widthIn(min = 40.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(label, color = fg, style = MaterialTheme.typography.labelLarge, fontWeight = if (active) FontWeight.Bold else FontWeight.Medium, maxLines = 1)
            }
        }
    }
}

/** Empty state with a lightweight WebP illustration. */
@Composable
fun IllustratedEmpty(@DrawableRes image: Int, title: String, message: String?, modifier: Modifier = Modifier, action: (@Composable () -> Unit)? = null) {
    Column(modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Image(painterResource(image), contentDescription = null, modifier = Modifier.fillMaxWidth(0.8f).height(170.dp), contentScale = ContentScale.Fit)
        Text(title, style = MaterialTheme.typography.titleMedium, color = CcColors.Ink, textAlign = TextAlign.Center)
        message?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = CcColors.InkSoft, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 4.dp)) }
        action?.let { Spacer(Modifier.height(14.dp)); it() }
    }
}

/** Fixed notice: these spaces are not an emergency service. */
@Composable
fun EmergencyNotice(text: String, modifier: Modifier = Modifier) {
    val nav = LocalNav.current
    InfoBanner(
        text, tone = Tone.Danger, icon = Icons.Rounded.Campaign, modifier = modifier,
        action = {
            Row {
                TextButton(onClick = { nav.navigate(Routes.Sos) }) { Text("SOS", color = CcColors.Sos, fontWeight = FontWeight.Bold) }
                TextButton(onClick = { nav.navigate(Routes.Contacts) }) { Text("Campus contacts", color = CcColors.Sos) }
            }
        },
    )
}
