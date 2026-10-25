package edu.srmap.campuscare.ui.components

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material.icons.rounded.AttachFile
import androidx.compose.material.icons.rounded.Block
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.DoneAll
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.Flag
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.PlayCircle
import androidx.compose.material.icons.rounded.Schedule
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.Attachment
import edu.srmap.campuscare.data.ChatMessage
import edu.srmap.campuscare.data.MediaPolicy
import edu.srmap.campuscare.data.MessagePage
import edu.srmap.campuscare.data.newIdempotencyKey
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.Fmt
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Backend operations for a conversation (case chat, support chat, counselling thread or community channel). */
interface ChatSource {
    val room: String?
    val media: MediaPolicy
    val readOnly: Boolean
    suspend fun load(before: String?): MessagePage
    suspend fun send(body: String, attachmentIds: List<String>, clientId: String): ChatMessage
    suspend fun upload(bytes: ByteArray, name: String, mime: String): Attachment
    fun fileUrl(id: String): String
    suspend fun report(messageId: String, reason: String) {}
    suspend fun block(messageId: String) {}
    suspend fun markRead(lastMessageId: String) {}
    suspend fun otherSideReadAt(): String? = null
}

private data class Outgoing(val clientId: String, val body: String, val attachments: List<Attachment>, val failed: Boolean = false)

/**
 * Full conversation UI: history with "load older", realtime updates (with polling fallback),
 * optimistic sending with retry, image/video attachments only when the Super Admin allows them,
 * read receipts and report/block actions.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ChatThread(source: ChatSource, modifier: Modifier = Modifier, privacyNote: String? = null, emptyText: String = "No messages yet. Say hello.") {
    val app = LocalApp.current
    val snack = LocalSnack.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val messages = remember { mutableStateListOf<ChatMessage>() }
    val outgoing = remember { mutableStateListOf<Outgoing>() }
    var hasMore by remember { mutableStateOf(false) }
    var cursor by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var text by remember { mutableStateOf("") }
    val pendingFiles = remember { mutableStateListOf<Attachment>() }
    var uploading by remember { mutableStateOf(false) }
    var readAt by remember { mutableStateOf<String?>(null) }
    var reportTarget by remember { mutableStateOf<ChatMessage?>(null) }
    val listState = rememberLazyListState()
    val connected by app.realtime.connected.collectAsState()

    fun merge(page: List<ChatMessage>) {
        val known = messages.map { it.id }.toSet()
        page.filter { it.id !in known }.forEach { m ->
            messages.add(m)
            outgoing.removeAll { o -> o.clientId == m.clientMessageId }
        }
        messages.sortBy { it.createdAt ?: "" }
    }

    suspend fun refreshLatest() {
        try {
            val page = source.load(null)
            if (messages.isEmpty()) {
                hasMore = page.hasMore
                cursor = page.nextCursor
            }
            merge(page.items)
            loadError = null
            page.items.lastOrNull()?.let { runCatching { source.markRead(it.id) } }
            readAt = runCatching { source.otherSideReadAt() }.getOrNull()
        } catch (e: ApiException) {
            if (messages.isEmpty()) loadError = e.message
        } finally {
            loading = false
        }
    }

    LaunchedEffect(source) {
        source.room?.let { app.realtime.subscribe(it) }
        refreshLatest()
    }
    // Realtime: refetch when the server says this conversation changed.
    LaunchedEffect(source) {
        app.realtime.events.collect { e ->
            val id = e.payload.optString("channelId").ifBlank { e.payload.optString("caseId") }.ifBlank { e.payload.optString("id") }
            if ((e.name == "chat:message" || e.name == "case:message" || e.name == "case:updated") && id.isNotBlank() && source.room?.endsWith(":$id") == true) refreshLatest()
        }
    }
    // Fallback polling when the realtime connection is down.
    LaunchedEffect(source, connected) {
        while (!connected) {
            delay(15_000)
            refreshLatest()
        }
    }
    LaunchedEffect(messages.size, outgoing.size) {
        val last = messages.size + outgoing.size + (if (hasMore) 1 else 0) - 1
        if (last >= 0 && listState.layoutInfo.totalItemsCount > 0) runCatching { listState.animateScrollToItem(last) }
    }

    val pickMedia = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            uploading = true
            try {
                val cr = context.contentResolver
                val mime = cr.getType(uri) ?: "application/octet-stream"
                val bytes = cr.openInputStream(uri)?.use { it.readBytes() } ?: throw ApiException(-1, "read_failed", "Could not read that file.")
                val name = uri.lastPathSegment?.substringAfterLast('/') ?: "attachment"
                pendingFiles.add(source.upload(bytes, name, mime))
            } catch (e: ApiException) {
                snack.show(e.message ?: "Upload failed.", long = true)
            } finally {
                uploading = false
            }
        }
    }

    fun send(retry: Outgoing? = null) {
        val o = retry?.copy(failed = false) ?: Outgoing(newIdempotencyKey(), text.trim(), pendingFiles.toList())
        if (o.body.isEmpty() && o.attachments.isEmpty()) return
        if (retry == null) {
            text = ""
            pendingFiles.clear()
            outgoing.add(o)
        } else {
            val idx = outgoing.indexOfFirst { it.clientId == o.clientId }
            if (idx >= 0) outgoing[idx] = o
        }
        scope.launch {
            try {
                val m = source.send(o.body, o.attachments.map { it.id }, o.clientId)
                merge(listOf(m))
                outgoing.removeAll { it.clientId == o.clientId }
            } catch (e: ApiException) {
                val idx = outgoing.indexOfFirst { it.clientId == o.clientId }
                if (idx >= 0) outgoing[idx] = o.copy(failed = true)
                snack.show(e.message ?: "Message not sent.")
            }
        }
    }

    Column(modifier.fillMaxSize()) {
        privacyNote?.let {
            Row(
                Modifier.fillMaxWidth().background(CcColors.Mint50).padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Rounded.Lock, contentDescription = null, tint = CcColors.Forest, modifier = Modifier.size(14.dp))
                Spacer(Modifier.width(6.dp))
                Text(it, style = MaterialTheme.typography.labelSmall, color = CcColors.Forest, modifier = Modifier.weight(1f))
                LiveDot(connected)
            }
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when {
                loading -> SkeletonList(4)
                loadError != null -> ErrorState(loadError ?: "", onRetry = { loading = true; scope.launch { refreshLatest() } })
                messages.isEmpty() && outgoing.isEmpty() -> EmptyState(emptyText, message = "Messages are private to the people in this conversation.")
                else -> LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    if (hasMore) {
                        item {
                            TextButton(onClick = {
                                scope.launch {
                                    try {
                                        val older = source.load(cursor)
                                        hasMore = older.hasMore
                                        cursor = older.nextCursor
                                        merge(older.items)
                                    } catch (e: ApiException) {
                                        snack.show(e.message ?: "Could not load older messages.")
                                    }
                                }
                            }, modifier = Modifier.fillMaxWidth()) { Text("Load earlier messages") }
                        }
                    }
                    items(messages, key = { it.id }) { m ->
                        Bubble(
                            mine = m.mine, sender = m.senderLabel, body = if (m.hidden) "Message hidden by a moderator" else m.body,
                            attachments = m.attachments, fileUrl = source::fileUrl, time = Fmt.time(m.createdAt),
                            hidden = m.hidden, read = m.mine && readAt != null && (m.createdAt ?: "") <= (readAt ?: ""),
                            onLongPress = if (m.canReport) ({ reportTarget = m }) else null,
                        )
                    }
                    items(outgoing, key = { it.clientId }) { o ->
                        Bubble(
                            mine = true, sender = "You", body = o.body, attachments = o.attachments, fileUrl = source::fileUrl,
                            time = if (o.failed) "Not sent · tap to retry" else "Sending…", pending = !o.failed, failed = o.failed,
                            onClick = if (o.failed) ({ send(o) }) else null,
                        )
                    }
                }
            }
        }
        if (source.readOnly) {
            Row(Modifier.fillMaxWidth().background(CcColors.CreamDeep).padding(14.dp).navigationBarsPadding(), horizontalArrangement = Arrangement.Center) {
                Icon(Icons.Rounded.Lock, contentDescription = null, tint = CcColors.InkSoft, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Text("This conversation is read-only.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
            }
        } else {
            Composer(
                text = text, onText = { text = it }, onSend = { send() },
                media = source.media, uploading = uploading, pending = pendingFiles,
                onRemove = { a -> pendingFiles.removeAll { it.id == a.id } },
                onAttach = {
                    val type = when {
                        source.media.images && source.media.videos -> ActivityResultContracts.PickVisualMedia.ImageAndVideo
                        source.media.videos -> ActivityResultContracts.PickVisualMedia.VideoOnly
                        else -> ActivityResultContracts.PickVisualMedia.ImageOnly
                    }
                    pickMedia.launch(PickVisualMediaRequest(type))
                },
            )
        }
    }

    reportTarget?.let { target ->
        var menuOpen by remember(target.id) { mutableStateOf(true) }
        var reasonDialog by remember(target.id) { mutableStateOf(false) }
        if (menuOpen) {
            Box {
                DropdownMenu(expanded = true, onDismissRequest = { menuOpen = false; reportTarget = null }) {
                    DropdownMenuItem(text = { Text("Report message") }, leadingIcon = { Icon(Icons.Rounded.Flag, null) }, onClick = { menuOpen = false; reasonDialog = true })
                    DropdownMenuItem(text = { Text("Block sender") }, leadingIcon = { Icon(Icons.Rounded.Block, null) }, onClick = {
                        menuOpen = false
                        reportTarget = null
                        scope.launch {
                            try { source.block(target.id); snack.show("Sender blocked. You won't see their messages.") } catch (e: ApiException) { snack.error(e) }
                        }
                    })
                }
            }
        }
        if (reasonDialog) {
            InputDialog(
                title = "Report this message", message = "A moderator will review it. The sender is not told who reported it.",
                label = "What's wrong?", confirmLabel = "Report",
                onConfirm = { reason ->
                    reasonDialog = false
                    reportTarget = null
                    scope.launch { try { source.report(target.id, reason); snack.show("Reported. Thank you.") } catch (e: ApiException) { snack.error(e) } }
                },
                onDismiss = { reasonDialog = false; reportTarget = null },
            )
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun Bubble(
    mine: Boolean,
    sender: String,
    body: String,
    attachments: List<Attachment>,
    fileUrl: (String) -> String,
    time: String,
    hidden: Boolean = false,
    pending: Boolean = false,
    failed: Boolean = false,
    read: Boolean = false,
    onClick: (() -> Unit)? = null,
    onLongPress: (() -> Unit)? = null,
) {
    val app = LocalApp.current
    AnimatedVisibility(visible = true, enter = fadeIn() + slideInVertically { it / 3 }) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
            Column(horizontalAlignment = if (mine) Alignment.End else Alignment.Start, modifier = Modifier.widthIn(max = 300.dp)) {
                if (!mine) Text(sender, style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft, modifier = Modifier.padding(start = 10.dp, bottom = 2.dp))
                Column(
                    Modifier
                        .clip(RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp, bottomStart = if (mine) 18.dp else 4.dp, bottomEnd = if (mine) 4.dp else 18.dp))
                        .background(
                            when {
                                failed -> CcColors.SosSoft
                                hidden -> CcColors.CreamDeep
                                mine -> CcColors.Forest
                                else -> Color.White
                            },
                        )
                        .combinedClickable(onClick = { onClick?.invoke() }, onLongClick = onLongPress)
                        .padding(horizontal = 14.dp, vertical = 10.dp)
                        .animateContentSize(),
                ) {
                    attachments.forEach { a ->
                        if (a.kind == "image") {
                            AsyncImage(
                                model = fileUrl(a.id), imageLoader = app.imageLoader, contentDescription = a.name, contentScale = ContentScale.Crop,
                                modifier = Modifier.padding(bottom = 6.dp).size(220.dp, 160.dp).clip(RoundedCornerShape(12.dp)),
                            )
                        } else {
                            Row(Modifier.padding(bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(if (a.kind == "video") Icons.Rounded.PlayCircle else Icons.Rounded.AttachFile, contentDescription = null, tint = if (mine) Color.White else CcColors.Forest)
                                Spacer(Modifier.width(6.dp))
                                Text("${a.name} · ${Fmt.bytes(a.sizeBytes)}", style = MaterialTheme.typography.bodySmall, color = if (mine) Color.White else CcColors.Ink)
                            }
                        }
                    }
                    if (body.isNotBlank()) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            if (hidden) {
                                Icon(Icons.Rounded.VisibilityOff, contentDescription = null, tint = CcColors.InkSoft, modifier = Modifier.size(14.dp))
                                Spacer(Modifier.width(4.dp))
                            }
                            Text(body, style = MaterialTheme.typography.bodyMedium, color = if (mine && !failed) Color.White else CcColors.Ink)
                        }
                    }
                }
                Row(Modifier.padding(horizontal = 8.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                    when {
                        pending -> Icon(Icons.Rounded.Schedule, contentDescription = "Sending", tint = CcColors.InkFaint, modifier = Modifier.size(12.dp))
                        failed -> Icon(Icons.Rounded.ErrorOutline, contentDescription = "Failed", tint = CcColors.Sos, modifier = Modifier.size(12.dp))
                        read -> Icon(Icons.Rounded.DoneAll, contentDescription = "Read", tint = CcColors.Emerald, modifier = Modifier.size(12.dp))
                    }
                    Spacer(Modifier.width(3.dp))
                    Text(time, style = MaterialTheme.typography.labelSmall, color = if (failed) CcColors.Sos else CcColors.InkFaint)
                }
            }
        }
    }
}

@Composable
private fun Composer(
    text: String,
    onText: (String) -> Unit,
    onSend: () -> Unit,
    media: MediaPolicy,
    uploading: Boolean,
    pending: List<Attachment>,
    onRemove: (Attachment) -> Unit,
    onAttach: () -> Unit,
) {
    val snack = LocalSnack.current
    Column(Modifier.fillMaxWidth().background(Color.White).imePadding().navigationBarsPadding()) {
        if (pending.isNotEmpty()) {
            Row(Modifier.padding(start = 12.dp, end = 12.dp, top = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                pending.forEach { a ->
                    Row(
                        Modifier.clip(RoundedCornerShape(12.dp)).background(CcColors.Mint).padding(start = 10.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(a.name.take(18), style = MaterialTheme.typography.labelSmall, color = CcColors.Forest)
                        IconButton(onClick = { onRemove(a) }, modifier = Modifier.size(24.dp)) { Icon(Icons.Rounded.Close, contentDescription = "Remove ${a.name}", modifier = Modifier.size(14.dp)) }
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp), verticalAlignment = Alignment.Bottom) {
            val allowed = media.images || media.videos
            IconButton(
                onClick = { if (allowed) onAttach() else snack.show("Image and video sending is turned off by your administrator.") },
                modifier = Modifier.size(48.dp),
            ) {
                if (uploading) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = CcColors.Emerald)
                else Icon(Icons.Rounded.AttachFile, contentDescription = if (allowed) "Attach photo or video" else "Attachments are turned off", tint = if (allowed) CcColors.Forest else CcColors.InkFaint)
            }
            OutlinedTextField(
                value = text,
                onValueChange = { if (it.length <= 4000) onText(it) },
                modifier = Modifier.weight(1f).heightIn(min = 48.dp, max = 140.dp),
                placeholder = { Text("Type a message…", color = CcColors.InkFaint) },
                shape = RoundedCornerShape(24.dp),
                colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = CcColors.Emerald, unfocusedBorderColor = CcColors.Line, focusedContainerColor = CcColors.Cream, unfocusedContainerColor = CcColors.Cream),
            )
            Spacer(Modifier.width(6.dp))
            val canSend = text.isNotBlank() || pending.isNotEmpty()
            IconButton(
                onClick = onSend,
                enabled = canSend,
                modifier = Modifier.size(48.dp).clip(CircleShape).background(if (canSend) CcColors.Forest else CcColors.CreamDeep),
            ) {
                Icon(Icons.AutoMirrored.Rounded.Send, contentDescription = "Send", tint = if (canSend) Color.White else CcColors.InkFaint)
            }
        }
        Spacer(Modifier.height(2.dp))
    }
}
