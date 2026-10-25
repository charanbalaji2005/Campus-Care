package edu.srmap.campuscare.ui.screens.community

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Gavel
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.FEED_REPORT_REASONS
import edu.srmap.campuscare.data.QueueItem
import edu.srmap.campuscare.data.feed
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.EmptyState
import edu.srmap.campuscare.ui.components.InfoBanner
import edu.srmap.campuscare.ui.components.InputDialog
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
import kotlinx.coroutines.launch

private fun reasonLabel(key: String) = FEED_REPORT_REASONS.firstOrNull { it.first == key }?.second ?: Fmt.humanize(key)

/**
 * Community moderation (community:moderate): held and reported posts/comments, user reports and
 * appeals. Public feed content only — no access to private chats or counselling conversations.
 */
@Composable
fun CommunityModerationScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    var tab by rememberSaveable { mutableStateOf("queue") }
    val queue = rememberLoad { app.api.feed.moderationQueue() }
    val appeals = rememberLoad { app.api.feed.appeals() }
    var reasonFor by remember { mutableStateOf<Triple<String, String, String>?>(null) } // kind, id, action
    var appealFor by remember { mutableStateOf<Pair<String, String>?>(null) } // id, decision
    var busy by remember { mutableStateOf(false) }

    fun act(kind: String, id: String, action: String, reason: String?) = scope.launch {
        busy = true
        try {
            app.api.feed.moderate(kind, id, action, reason)
            reasonFor = null
            snack.show("Done. The author has been notified.")
            queue.reload()
        } catch (e: ApiException) {
            snack.error(e)
        } finally {
            busy = false
        }
    }

    CcScreen(
        title = "Community moderation", subtitle = "Held and reported feed content", onBack = { nav.popBackStack() },
        refreshing = queue.refreshing || appeals.refreshing, onRefresh = { queue.reload(); appeals.reload() },
    ) {
        InfoBanner("You review public community content only. Private chats and counselling conversations are never shown here. Every decision is recorded in the audit log.", icon = Icons.Rounded.Lock, tone = Tone.Neutral)
        val counts = queue.data?.let { q -> "${q.posts.size + q.comments.size}" } ?: ""
        AnimatedChips(listOf("queue" to "Queue $counts".trim(), "users" to "User reports", "appeals" to "Appeals"), tab, { tab = it })
        when (tab) {
            "queue" -> LoadContent(queue) { q ->
                val items = q.posts + q.comments
                if (items.isEmpty()) EmptyState("Nothing to review", message = "Held and reported content will appear here.", icon = Icons.Rounded.Shield)
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items.forEachIndexed { i, item -> QueueCard(item, Modifier.enterStagger(i), busy, onAct = { action -> if (action == "hide" || action == "remove") reasonFor = Triple(item.kind, item.id, action) else act(item.kind, item.id, action, null) }) }
                }
            }
            "users" -> LoadContent(queue) { q ->
                if (q.users.isEmpty()) EmptyState("No open user reports", icon = Icons.Rounded.Shield)
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    q.users.forEach { r ->
                        CcCard {
                            Text(r.user?.let { "${it.name} · ${Fmt.humanize(it.role)}" } ?: "Former member", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                            StatusChip(reasonLabel(r.reason), Tone.Amber, modifier = Modifier.padding(top = 4.dp))
                            r.details?.let { Text("“$it”", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft, modifier = Modifier.padding(top = 4.dp)) }
                            Text(Fmt.ago(r.createdAt), style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint)
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                                r.postId?.let { pid -> CcButton("Open post", { nav.navigate(Routes.communityPost(pid)) }, kind = ButtonKind.Ghost) }
                                listOf("dismiss" to "Dismiss", "actioned" to "Mark actioned").forEach { (a, label) ->
                                    CcButton(label, {
                                        scope.launch {
                                            try {
                                                app.api.feed.decideUserReport(r.id, a); queue.reload()
                                            } catch (e: ApiException) {
                                                snack.error(e)
                                            }
                                        }
                                    }, kind = if (a == "dismiss") ButtonKind.Outline else ButtonKind.Soft)
                                }
                            }
                        }
                    }
                }
            }
            else -> LoadContent(appeals) { list ->
                if (list.isEmpty()) EmptyState("No pending appeals", icon = Icons.Rounded.Gavel)
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    list.forEach { a ->
                        CcCard {
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                StatusChip(Fmt.humanize(a.targetType), Tone.Neutral)
                                a.content?.decision?.let { StatusChip("Decision: ${Fmt.humanize(it)}", Tone.Danger) }
                            }
                            a.content?.let { c ->
                                Text(c.body, style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink, maxLines = 6, modifier = Modifier.padding(top = 6.dp))
                                c.decisionReason?.let { Text("Reason given: $it", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft) }
                            }
                            Text("Author's appeal: “${a.reason}”", style = MaterialTheme.typography.bodySmall, color = CcColors.Forest, modifier = Modifier.padding(top = 6.dp))
                            if (a.canDecide) {
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                                    CcButton("Restore", { appealFor = a.id to "reversed" }, Modifier.weight(1f), kind = ButtonKind.Brand)
                                    CcButton("Keep decision", { appealFor = a.id to "upheld" }, Modifier.weight(1f), kind = ButtonKind.Outline)
                                }
                            } else {
                                Text("A different moderator must decide this appeal of your own decision.", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft, modifier = Modifier.padding(top = 6.dp))
                            }
                        }
                    }
                }
            }
        }
    }

    reasonFor?.let { (kind, id, action) ->
        InputDialog(
            if (action == "hide") "Hide this $kind?" else "Remove this $kind?",
            "The author sees this reason and can appeal. Avoid repeating personal details.",
            label = "Reason", confirmLabel = if (action == "hide") "Hide" else "Remove", minLength = 3, destructive = true, loading = busy,
            onDismiss = { reasonFor = null }, onConfirm = { act(kind, id, action, it.trim()) },
        )
    }
    appealFor?.let { (id, decision) ->
        InputDialog(
            if (decision == "reversed") "Restore the content?" else "Keep the original decision?", "The author is notified of the outcome.",
            label = "Note (optional)", confirmLabel = "Confirm", minLength = 0, loading = busy,
            onDismiss = { appealFor = null },
            onConfirm = { note ->
                scope.launch {
                    busy = true
                    try {
                        app.api.feed.decideAppeal(id, decision, note.trim().ifBlank { null }); appealFor = null; appeals.reload(); queue.reload()
                    } catch (e: ApiException) {
                        snack.error(e)
                    } finally {
                        busy = false
                    }
                }
            },
        )
    }
}

@Composable
private fun QueueCard(item: QueueItem, modifier: Modifier, busy: Boolean, onAct: (String) -> Unit) {
    val nav = LocalNav.current
    CcCard(modifier) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            StatusChip(Fmt.humanize(item.kind), Tone.Neutral)
            StatusChip(if (item.status == "pending_review") "Held for review" else Fmt.humanize(item.status), if (item.status == "pending_review") Tone.Amber else Tone.Danger)
            if (item.official) StatusChip("Official", Tone.Brand)
        }
        Text("${item.authorLabel} · ${Fmt.humanize(item.authorRole)} · ${Fmt.ago(item.createdAt)}", style = MaterialTheme.typography.labelMedium, color = CcColors.InkSoft, modifier = Modifier.padding(top = 6.dp))
        Text(item.body, style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink, maxLines = 8, modifier = Modifier.padding(top = 4.dp))
        if (item.attachments > 0) Text("${item.attachments} image(s) attached — open the post to view.", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
        if (item.holdFlags.isNotEmpty()) Text("Screening: " + item.holdFlags.joinToString { Fmt.humanize(it) }, style = MaterialTheme.typography.labelMedium, color = CcColors.Amber, modifier = Modifier.padding(top = 4.dp))
        item.reasons.forEach { r -> Text("${reasonLabel(r.reason)} × ${r.count}", style = MaterialTheme.typography.labelMedium, color = CcColors.Sos) }
        item.details.forEach { d -> Text("“$d”", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft) }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 8.dp)) {
            if (item.status == "pending_review" && item.reasons.isEmpty()) CcButton("Approve", { onAct("approve") }, Modifier.weight(1f), kind = ButtonKind.Brand, enabled = !busy)
            else if (item.status == "hidden") CcButton("Restore", { onAct("restore") }, Modifier.weight(1f), kind = ButtonKind.Brand, enabled = !busy)
            else CcButton("Dismiss", { onAct("dismiss") }, Modifier.weight(1f), kind = ButtonKind.Outline, enabled = !busy)
            if (item.status != "hidden") CcButton("Hide", { onAct("hide") }, Modifier.weight(1f), kind = ButtonKind.Soft, enabled = !busy)
            CcButton("Remove", { onAct("remove") }, Modifier.weight(1f), kind = ButtonKind.Danger, enabled = !busy)
        }
        val postId = if (item.kind == "post") item.id else item.postId
        postId?.let { CcButton("Open in context", { nav.navigate(Routes.communityPost(it)) }, kind = ButtonKind.Ghost) }
    }
}
