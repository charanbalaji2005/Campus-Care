package edu.srmap.campuscare.ui.screens.common

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.PersonAdd
import androidx.compose.material.icons.rounded.AttachFile
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Fingerprint
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.PlayCircle
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.SwapHoriz
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import edu.srmap.campuscare.data.Api
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.Attachment
import edu.srmap.campuscare.data.ChannelDetail
import edu.srmap.campuscare.data.ChatMessage
import edu.srmap.campuscare.data.Incident
import edu.srmap.campuscare.data.IncidentDetail
import edu.srmap.campuscare.data.MediaPolicy
import edu.srmap.campuscare.data.MessagePage
import edu.srmap.campuscare.data.StaffMember
import edu.srmap.campuscare.data.TimelineItem
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.Catalog
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcSelect
import edu.srmap.campuscare.ui.components.CcTextField
import edu.srmap.campuscare.ui.components.ChatSource
import edu.srmap.campuscare.ui.components.ChatThread
import edu.srmap.campuscare.ui.components.ChoiceChips
import edu.srmap.campuscare.ui.components.ConfirmDialog
import edu.srmap.campuscare.ui.components.Divider
import edu.srmap.campuscare.ui.components.EmptyState
import edu.srmap.campuscare.ui.components.IconBadge
import edu.srmap.campuscare.ui.components.InfoBanner
import edu.srmap.campuscare.ui.components.KeyValue
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.ScreenHeader
import edu.srmap.campuscare.ui.components.ScrollPane
import edu.srmap.campuscare.ui.components.SectionHeader
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.Fmt
import kotlinx.coroutines.launch

// ------------------------------------------------------------------ chat sources

/** Private case chat between the reporter and the assigned handlers. */
class CaseChatSource(private val api: Api, private val caseId: String, override val media: MediaPolicy, override val readOnly: Boolean) : ChatSource {
    override val room: String = "case:$caseId"
    override suspend fun load(before: String?): MessagePage = api.incidents.messages(caseId, before)
    override suspend fun send(body: String, attachmentIds: List<String>, clientId: String): ChatMessage = api.incidents.send(caseId, body, attachmentIds, clientId).message
    override suspend fun upload(bytes: ByteArray, name: String, mime: String): Attachment = api.incidents.uploadAttachment(caseId, bytes, name, mime)
    override fun fileUrl(id: String): String = api.incidents.fileUrl(id)
    override suspend fun markRead(lastMessageId: String) {
        runCatching { api.incidents.markRead(caseId, lastMessageId) }
    }
    override suspend fun otherSideReadAt(): String? = runCatching { api.incidents.readState(caseId).otherSideLastReadAt }.getOrNull()
}

/** Support threads, counselling threads and community channels. */
class ChannelChatSource(private val api: Api, private val detail: ChannelDetail, private val search: String? = null) : ChatSource {
    override val room: String = "chat:${detail.id}"
    override val media: MediaPolicy = detail.media
    override val readOnly: Boolean = detail.readOnly || detail.closed || search != null
    override suspend fun load(before: String?): MessagePage = api.chat.messages(detail.id, before, search)
    override suspend fun send(body: String, attachmentIds: List<String>, clientId: String): ChatMessage = api.chat.send(detail.id, body, attachmentIds, clientId).message
    override suspend fun upload(bytes: ByteArray, name: String, mime: String): Attachment = api.chat.upload(detail.id, bytes, name, mime)
    override fun fileUrl(id: String): String = api.chat.fileUrl(id)
    override suspend fun report(messageId: String, reason: String) {
        api.chat.report(messageId, reason)
    }
    override suspend fun block(messageId: String) {
        api.chat.blockSender(messageId)
    }
}

// ------------------------------------------------------------------ chat screen

@Composable
fun ChatScreen(id: String) {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val channel = rememberLoad(id) { app.api.chat.channel(id) }
    var searching by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    var activeQuery by remember { mutableStateOf<String?>(null) }
    var confirmClose by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize().background(CcColors.Cream)) {
        ScreenHeader(
            title = channel.data?.name ?: "Conversation",
            subtitle = channel.data?.let { d ->
                when {
                    d.closed -> "This conversation is closed"
                    d.kind == "community" -> d.description.ifBlank { "Community channel" }
                    else -> "Private · only you and the support team"
                }
            },
            onBack = { nav.popBackStack() },
            actions = {
                IconButton(onClick = { searching = !searching; if (!searching) { query = ""; activeQuery = null } }) {
                    Icon(if (searching) Icons.Rounded.Close else Icons.Rounded.Search, contentDescription = if (searching) "Close search" else "Search messages", tint = CcColors.Ink)
                }
                val d = channel.data
                if (d != null && d.kind == "support_thread" && !d.closed && d.access != "member") {
                    TextButton(onClick = { confirmClose = true }) { Text("Close", color = CcColors.Sos) }
                }
            },
        )
        if (searching) {
            Row(Modifier.padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                CcTextField(query, { query = it }, label = "Search this conversation", leadingIcon = Icons.Rounded.Search, modifier = Modifier.weight(1f), onImeAction = { activeQuery = query.trim().ifBlank { null } })
            }
        }
        channel.data?.let { d ->
            val c = d.counsellor
            if (d.kind == "counselling_thread" && c != null) {
                edu.srmap.campuscare.ui.screens.community.CounsellingThreadBanner(c, student = app.session.user.value?.role == "student")
            }
        }
        LoadContent(channel, modifier = Modifier.weight(1f)) { d ->
            // Re-key on the search so results replace the live thread while searching.
            val source = remember(d, activeQuery) { ChannelChatSource(app.api, d, activeQuery) }
            key(activeQuery) {
            ChatThread(
                source,
                modifier = Modifier.fillMaxSize(),
                privacyNote = when (d.kind) {
                    "community" -> "Be kind. Messages can be reported to moderators."
                    "counselling_thread" -> "Confidential. Only you and your counsellor can read this."
                    else -> null
                },
                emptyText = if (activeQuery != null) "No messages match \"$activeQuery\"." else "No messages yet. Say hello.",
            )
            }
        }
    }
    if (confirmClose) {
        ConfirmDialog(
            title = "Close this conversation?",
            message = "The student can start a new conversation at any time. The history is kept.",
            confirmLabel = "Close", destructive = true,
            onDismiss = { confirmClose = false },
            onConfirm = {
                scope.launch {
                    try {
                        app.api.chat.close(id)
                        confirmClose = false
                        channel.reload()
                    } catch (e: ApiException) {
                        snack.error(e)
                    }
                }
            },
        )
    }
}

// ------------------------------------------------------------------ shared case pieces

@Composable
fun CaseHeaderCard(i: Incident) {
    val cat = Catalog.category(i.category)
    CcCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconBadge(cat.icon, cat.tone)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(i.caseNumber, style = MaterialTheme.typography.labelMedium, color = CcColors.InkSoft)
                Text(i.title.ifBlank { cat.label }, style = MaterialTheme.typography.titleMedium, color = CcColors.Ink)
            }
        }
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            StatusChip(Catalog.statusLabel(i.status), Catalog.statusTone(i.status), dot = true)
            StatusChip(cat.label, cat.tone)
            if (i.urgent) StatusChip("Urgent", Tone.Danger)
            if (i.anonymous) StatusChip("Anonymous", Tone.Neutral)
        }
        i.committee?.let { Text("Handled by ${it.name}", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft, modifier = Modifier.padding(top = 8.dp)) }
        i.dueResolveAt?.let { if (i.status !in setOf("resolved", "closed", "withdrawn", "rejected")) Text("Target resolution: ${Fmt.date(it)}", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft) }
    }
}

/** Evidence with its integrity fingerprint (SHA-256 recorded at upload). Images preview with the authorised client. */
@Composable
fun EvidenceList(files: List<Attachment>, fileUrl: (String) -> String) {
    val app = LocalApp.current
    if (files.isEmpty()) return
    SectionHeader("Evidence (${files.size})")
    CcCard {
        files.forEachIndexed { idx, f ->
            if (idx > 0) Divider(Modifier.padding(vertical = 8.dp))
            if (f.kind == "image" || f.mimeType.startsWith("image/")) {
                AsyncImage(
                    model = fileUrl(f.id), imageLoader = app.imageLoader, contentDescription = f.name, contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxWidth().height(180.dp).clip(RoundedCornerShape(14.dp)),
                )
                Spacer(Modifier.height(6.dp))
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(if (f.mimeType.startsWith("video/")) Icons.Rounded.PlayCircle else Icons.Rounded.AttachFile, contentDescription = null, tint = CcColors.Forest)
                Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f)) {
                    Text(f.name, style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink)
                    Text(Fmt.bytes(f.sizeBytes), style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
                }
            }
            f.sha256?.let {
                Row(Modifier.padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Rounded.Fingerprint, contentDescription = null, tint = CcColors.InkFaint, modifier = Modifier.size(14.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("SHA-256 ${it.take(16)}…", style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint, fontFamily = FontFamily.Monospace)
                }
            }
        }
    }
}

@Composable
fun CaseTimeline(items: List<TimelineItem>, staff: Boolean) {
    if (items.isEmpty()) return
    SectionHeader("Timeline")
    CcCard {
        items.asReversed().forEachIndexed { idx, t ->
            Row(Modifier.padding(vertical = 8.dp)) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(Modifier.size(12.dp).clip(CircleShape).background(if (idx == 0) CcColors.Emerald else CcColors.Line))
                    if (idx < items.lastIndex) Box(Modifier.width(2.dp).height(36.dp).background(CcColors.Line))
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    val title = when {
                        t.toStatus != null -> "Status: ${Catalog.statusLabel(t.toStatus)}"
                        else -> Fmt.humanize(t.type)
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(title, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink, modifier = Modifier.weight(1f, fill = false))
                        if (staff && !t.studentVisible) {
                            Spacer(Modifier.width(6.dp))
                            Icon(Icons.Rounded.VisibilityOff, contentDescription = "Not visible to the student", tint = CcColors.InkFaint, modifier = Modifier.size(14.dp))
                        }
                    }
                    t.body?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft) }
                    Text("${t.actor.ifBlank { "System" }} · ${Fmt.dateTime(t.createdAt)}", style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint)
                }
            }
        }
    }
}

// ------------------------------------------------------------------ staff case view

/** Case workspace for committee members, responders and admins: details, chat, internal notes and actions. */
@Composable
fun CaseScreen(id: String) {
    val app = LocalApp.current
    val nav = LocalNav.current
    var tab by remember { mutableStateOf("overview") }
    val detail = rememberLoad(id) { app.api.incidents.detail(id) }
    LaunchedEffect(id) {
        app.realtime.events.collect { e -> if (e.name == "case:updated" && e.payload.optString("id") == id) detail.reload() }
    }

    Column(Modifier.fillMaxSize().background(CcColors.Cream)) {
        ScreenHeader(title = detail.data?.incident?.caseNumber ?: "Case", subtitle = detail.data?.incident?.let { Catalog.category(it.category).label }, onBack = { nav.popBackStack() })
        val perms = detail.data?.permissions
        val tabs = buildList {
            add("overview" to "Overview")
            if (perms?.canChat == true) add("chat" to "Chat with student")
            if (perms?.canAddNotes == true) add("notes" to "Internal notes")
        }
        ChoiceChips(tabs, tab, { tab = it }, Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
        LoadContent(detail, modifier = Modifier.weight(1f)) { d ->
            when (tab) {
                "chat" -> {
                    val media = app.config.config.value.settings.chatMedia["case"] ?: MediaPolicy()
                    val source = remember(d.incident.id) { CaseChatSource(app.api, d.incident.id, media, readOnly = d.incident.status in setOf("closed", "withdrawn", "rejected")) }
                    ChatThread(source, Modifier.fillMaxSize(), privacyNote = if (d.incident.anonymous) "Anonymous report — the student's identity is protected." else null)
                }
                "notes" -> NotesPane(id)
                else -> StaffOverview(d, onChanged = { detail.reload() })
            }
        }
    }
}

@Composable
private fun StaffOverview(d: IncidentDetail, onChanged: () -> Unit) {
    val app = LocalApp.current
    var statusOpen by remember { mutableStateOf(false) }
    var assignOpen by remember { mutableStateOf(false) }
    val i = d.incident
    ScrollPane {
        CaseHeaderCard(i)
        if (i.redacted) InfoBanner("Some details are hidden because of your access level.", tone = Tone.Neutral, icon = Icons.Rounded.Lock)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (d.permissions.canUpdateStatus && Catalog.transitions[i.status].orEmpty().isNotEmpty()) {
                CcButton("Update status", { statusOpen = true }, Modifier.weight(1f), kind = ButtonKind.Primary, leadingIcon = Icons.Rounded.SwapHoriz)
            }
            if (d.permissions.canAssign) {
                CcButton(if (i.assignee == null) "Assign" else "Reassign", { assignOpen = true }, Modifier.weight(1f), kind = ButtonKind.Outline, leadingIcon = Icons.Rounded.PersonAdd)
            }
        }
        CcCard {
            KeyValue("Assigned to", i.assignee?.name ?: "Not assigned yet")
            KeyValue("Severity", Fmt.humanize(i.severity))
            KeyValue("Priority", Fmt.humanize(i.priority))
            KeyValue("Reported", Fmt.dateTime(i.createdAt))
            KeyValue("Incident date", Fmt.date(i.incidentDate))
            KeyValue("Location", i.location)
            KeyValue("Acknowledge by", i.dueAcknowledgeAt?.let { Fmt.dateTime(it) + if (i.acknowledgedAt != null) " (done)" else "" })
            KeyValue("Preferred contact", i.preferredContact?.let { Fmt.humanize(it) })
        }
        i.reporter?.let { r ->
            if (!i.anonymous) {
                SectionHeader("Reporter")
                CcCard {
                    KeyValue("Name", r.name)
                    KeyValue("Student ID", r.studentId)
                    KeyValue("Department", r.department)
                    KeyValue("Email", r.email)
                    KeyValue("Phone", r.phone)
                }
            }
        }
        SectionHeader("What happened")
        CcCard {
            Text(i.description ?: "—", style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink)
            i.involvedParties?.takeIf { it.isNotBlank() }?.let { KeyValue("People involved", it) }
        }
        EvidenceList(i.evidence) { app.api.incidents.fileUrl(it) }
        CaseTimeline(d.timeline, staff = true)
    }
    if (statusOpen) StatusDialog(i, onDismiss = { statusOpen = false }, onDone = { statusOpen = false; onChanged() })
    if (assignOpen) AssignDialog(i, onDismiss = { assignOpen = false }, onDone = { assignOpen = false; onChanged() })
}

@Composable
private fun StatusDialog(i: Incident, onDismiss: () -> Unit, onDone: () -> Unit) {
    val app = LocalApp.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val options = Catalog.transitions[i.status].orEmpty()
    var target by remember { mutableStateOf(options.firstOrNull()) }
    var note by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val needsReason = target in setOf("rejected", "escalated")
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Color.White,
        title = { Text("Update status", style = MaterialTheme.typography.headlineSmall) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                CcSelect("New status", options.map { it to Catalog.statusLabel(it) }, target, { target = it })
                CcTextField(note, { note = it }, label = "Message to the student (optional)", singleLine = false, minLines = 2, maxLength = 1000)
                CcTextField(reason, { reason = it }, label = if (needsReason) "Reason (required, internal)" else "Internal reason (optional)", singleLine = false, maxLength = 500)
                Text("AI tools never decide outcomes. Status changes are recorded in the audit log.", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
            }
        },
        confirmButton = {
            CcButton("Save", {
                val t = target ?: return@CcButton
                if (needsReason && reason.trim().length < 3) {
                    snack.show("Add a reason for this change.")
                    return@CcButton
                }
                scope.launch {
                    busy = true
                    try {
                        app.api.incidents.changeStatus(i.id, t, note.trim().ifBlank { null }, reason.trim().ifBlank { null })
                        snack.show("Status updated to ${Catalog.statusLabel(t)}.")
                        onDone()
                    } catch (e: ApiException) {
                        snack.error(e)
                    } finally {
                        busy = false
                    }
                }
            }, loading = busy)
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel", color = CcColors.InkSoft) } },
    )
}

@Composable
private fun AssignDialog(i: Incident, onDismiss: () -> Unit, onDone: () -> Unit) {
    val app = LocalApp.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val user = app.session.user.value
    val canMove = user?.permissions?.contains("incidents:triage") == true || user?.role == "admin"
    val committees = rememberLoad { if (canMove) runCatching { app.api.admin.committees() }.getOrDefault(emptyList()) else emptyList() }
    var committeeId by remember { mutableStateOf(i.committee?.id) }
    val staff = rememberLoad(committeeId) { committeeId?.let { app.api.incidents.assignableStaff(i.id, it) } ?: emptyList<StaffMember>() }
    var assignee by remember { mutableStateOf(i.assignee?.id) }
    var reason by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Color.White,
        title = { Text("Assign case", style = MaterialTheme.typography.headlineSmall) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                val committeeOptions = (committees.data.orEmpty().map { it.id to it.name } + listOfNotNull(i.committee?.let { it.id to it.name })).distinctBy { it.first }
                CcSelect("Committee", committeeOptions, committeeId, { committeeId = it; assignee = null })
                CcSelect("Case owner", staff.data.orEmpty().map { it.id to "${it.name} · ${Catalog.roleLabel(it.role)}" }, assignee, { assignee = it }, placeholder = "Committee (no single owner)")
                CcTextField(reason, { reason = it }, label = "Reason (recorded)", maxLength = 500)
            }
        },
        confirmButton = {
            CcButton("Assign", {
                val c = committeeId ?: return@CcButton
                scope.launch {
                    busy = true
                    try {
                        app.api.incidents.assign(i.id, c, assignee, reason.trim().ifBlank { null })
                        snack.show("Case assigned.")
                        onDone()
                    } catch (e: ApiException) {
                        snack.error(e)
                    } finally {
                        busy = false
                    }
                }
            }, loading = busy, enabled = committeeId != null)
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel", color = CcColors.InkSoft) } },
    )
}

@Composable
private fun NotesPane(caseId: String) {
    val app = LocalApp.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val notes = rememberLoad(caseId) { app.api.incidents.notes(caseId) }
    var text by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    ScrollPane(refreshing = notes.refreshing, onRefresh = { notes.reload() }) {
        InfoBanner("Internal notes are only visible to staff handling this case. The student never sees them.", tone = Tone.Violet, icon = Icons.Rounded.Lock)
        CcTextField(text, { text = it }, label = "Add a note", singleLine = false, minLines = 3, maxLength = 4000)
        CcButton("Save note", {
            if (text.isBlank()) return@CcButton
            scope.launch {
                busy = true
                try {
                    val n = app.api.incidents.addNote(caseId, text.trim())
                    notes.set(notes.data.orEmpty() + n)
                    text = ""
                } catch (e: ApiException) {
                    snack.error(e)
                } finally {
                    busy = false
                }
            }
        }, Modifier.fillMaxWidth(), loading = busy)
        LoadContent(notes) { list ->
            if (list.isEmpty()) {
                EmptyState("No internal notes yet", icon = Icons.Rounded.Lock, tone = Tone.Violet)
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    list.asReversed().forEach { n ->
                        CcCard {
                            Text(n.body, style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink)
                            Text("${n.author} · ${Fmt.dateTime(n.createdAt)}", style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint, modifier = Modifier.padding(top = 6.dp))
                        }
                    }
                }
            }
        }
    }
}
