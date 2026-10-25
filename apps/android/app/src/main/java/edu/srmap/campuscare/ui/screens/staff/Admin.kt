package edu.srmap.campuscare.ui.screens.staff

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Assignment
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Campaign
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Email
import androidx.compose.material.icons.rounded.EmojiObjects
import androidx.compose.material.icons.rounded.Flag
import androidx.compose.material.icons.rounded.Gavel
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.HourglassTop
import androidx.compose.material.icons.rounded.Inventory2
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.PersonAdd
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.Timer
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.Hazard
import edu.srmap.campuscare.data.Suggestion
import edu.srmap.campuscare.ui.components.BottomActionBar
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.Catalog
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.CcSelect
import edu.srmap.campuscare.ui.components.CcTextField
import edu.srmap.campuscare.ui.components.ChoiceChips
import edu.srmap.campuscare.ui.components.ConfirmDialog
import edu.srmap.campuscare.ui.components.Divider
import edu.srmap.campuscare.ui.components.EmptyState
import edu.srmap.campuscare.ui.components.IconBadge
import edu.srmap.campuscare.ui.components.InfoBanner
import edu.srmap.campuscare.ui.components.ListRow
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.SectionHeader
import edu.srmap.campuscare.ui.components.SkeletonList
import edu.srmap.campuscare.ui.components.StatTile
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.SwitchRow
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.enterStagger
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.screens.student.AnnouncementCard
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.Fmt
import java.time.Instant
import kotlinx.coroutines.launch

/** Administrator dashboard (mobile). Platform configuration lives on the Super Admin website. */
@Composable
fun AdminHomeScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val o = rememberLoad { app.api.admin.overview() }
    LaunchedEffect(Unit) { app.realtime.events.collect { e -> if (e.name == "notification" || e.name == "case:updated") o.reload() } }
    CcScreen(title = "Administration", subtitle = "Campus safety at a glance", refreshing = o.refreshing, onRefresh = { o.reload() }) {
        LoadContent(o, skeleton = { SkeletonList(4) }) { d ->
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (d.alerts.activeSos > 0) {
                    InfoBanner("${d.alerts.activeSos} active SOS alert${if (d.alerts.activeSos == 1) "" else "s"} — Campus Security is handling them.", tone = Tone.Danger, icon = Icons.Rounded.Warning)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    StatTile("New today", "${d.incidents.today}", Modifier.weight(1f), icon = Icons.AutoMirrored.Rounded.Assignment)
                    StatTile("Awaiting triage", "${d.incidents.pending}", Modifier.weight(1f), tone = Tone.Amber, icon = Icons.Rounded.HourglassTop)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    StatTile("Overdue", "${d.incidents.overdue}", Modifier.weight(1f), tone = Tone.Rose, icon = Icons.Rounded.Timer)
                    StatTile("Not acknowledged", "${d.incidents.unacknowledged}", Modifier.weight(1f), tone = Tone.Violet, icon = Icons.Rounded.Flag)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    StatTile("In progress", "${d.incidents.inProgress}", Modifier.weight(1f), tone = Tone.Sky)
                    StatTile("Resolved", "${d.incidents.resolved}", Modifier.weight(1f), tone = Tone.Teal)
                }
                CcCard(padding = 8.dp) {
                    ListRow("Triage queue", subtitle = "Route new reports", icon = Icons.Rounded.Gavel, tone = Tone.Amber, onClick = { nav.navigate(Routes.AdminTriage) })
                    Divider()
                    ListRow("Campus alerts", subtitle = "Broadcast notices and safety check-ins", icon = Icons.Rounded.Campaign, tone = Tone.Danger, onClick = { nav.navigate(Routes.AdminAlerts) })
                    Divider()
                    ListRow("Announcements & events", icon = Icons.Rounded.Campaign, tone = Tone.Sky, onClick = { nav.navigate(Routes.AdminAnnouncements) })
                    Divider()
                    ListRow("Staff", subtitle = "${d.users.staff} staff · ${d.users.pendingStaff} invited · ${d.users.students} students", icon = Icons.Rounded.Groups, tone = Tone.Violet, onClick = { nav.navigate(Routes.AdminStaff) })
                    Divider()
                    ListRow("Moderation", subtitle = "Reports, hazards, suggestions, lost & found", icon = Icons.Rounded.Shield, tone = Tone.Teal, onClick = { nav.navigate(Routes.Moderation) })
                }
                if (d.recentActivity.isNotEmpty()) {
                    SectionHeader("Recent activity")
                    CcCard {
                        d.recentActivity.take(8).forEachIndexed { i, a ->
                            if (i > 0) Divider()
                            Row(Modifier.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                                IconBadge(Icons.Rounded.History, Tone.Neutral, size = 30.dp, iconSize = 16.dp)
                                Spacer(Modifier.width(10.dp))
                                Text(Fmt.humanize(a.action.replace('.', ' ')), style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink, modifier = Modifier.weight(1f))
                                Text(Fmt.ago(a.at), style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint)
                            }
                        }
                    }
                }
                InfoBanner("Platform settings, security policy and audit logs are managed by the Super Admin on the CampusCare website.", tone = Tone.Neutral)
            }
        }
    }
}

@Composable
fun AdminAlertsScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val alerts = rememberLoad { app.api.admin.campusAlerts() }
    var composing by remember { mutableStateOf(false) }
    var ending by remember { mutableStateOf<String?>(null) }
    CcScreen(
        title = "Campus alerts", subtitle = "Reach every student instantly", onBack = { nav.popBackStack() },
        refreshing = alerts.refreshing, onRefresh = { alerts.reload() },
        bottomBar = { BottomActionBar { CcButton("New alert", { composing = true }, Modifier.weight(1f), kind = ButtonKind.Danger, leadingIcon = Icons.Rounded.Campaign) } },
    ) {
        LoadContent(alerts) { list ->
            if (list.isEmpty()) EmptyState("No active alerts", icon = Icons.Rounded.CheckCircle)
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                list.forEach { a ->
                    CcCard {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(a.title, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink, modifier = Modifier.weight(1f))
                            StatusChip(Fmt.humanize(a.severity), when (a.severity) { "emergency" -> Tone.Danger; "warning" -> Tone.Amber; else -> Tone.Sky })
                        }
                        Text(a.body, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft, modifier = Modifier.padding(top = 4.dp))
                        if (a.requestCheckIn) {
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 8.dp)) {
                                StatusChip("${a.checkIns.safe} safe", Tone.Brand, dot = true)
                                StatusChip("${a.checkIns.need_help} need help", if (a.checkIns.need_help > 0) Tone.Danger else Tone.Neutral, dot = true)
                                a.recipients?.let { StatusChip("$it recipients", Tone.Neutral) }
                            }
                        }
                        Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text("Sent ${Fmt.ago(a.createdAt)}", style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint, modifier = Modifier.weight(1f))
                            TextButton(onClick = { ending = a.id }) { Text("End alert", color = CcColors.Sos) }
                        }
                    }
                }
            }
        }
    }
    if (composing) ComposeAlertDialog(onDismiss = { composing = false }, onSent = { composing = false; alerts.reload() })
    ending?.let { id ->
        ConfirmDialog("End this alert?", "It will no longer show to students.", confirmLabel = "End alert", destructive = true,
            onDismiss = { ending = null },
            onConfirm = {
                scope.launch {
                    try {
                        app.api.admin.endAlert(id); ending = null; alerts.reload()
                    } catch (e: ApiException) {
                        snack.error(e)
                    }
                }
            },
        )
    }
}

@Composable
private fun ComposeAlertDialog(onDismiss: () -> Unit, onSent: () -> Unit) {
    val app = LocalApp.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    var title by remember { mutableStateOf("") }
    var body by remember { mutableStateOf("") }
    var severity by remember { mutableStateOf("advisory") }
    var checkIn by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Color.White,
        title = { Text("New campus alert") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                CcTextField(title, { title = it }, label = "Title", maxLength = 140)
                CcTextField(body, { body = it }, label = "Message", singleLine = false, minLines = 3, maxLength = 2000)
                ChoiceChips(listOf("info" to "Info", "advisory" to "Advisory", "warning" to "Warning", "emergency" to "Emergency"), severity, { severity = it })
                SwitchRow("Ask students to check in", checkIn, { checkIn = it }, description = "Students answer \"I'm safe\" or \"I need help\".")
                if (confirm) InfoBanner("This notifies every student immediately. Tap Send again to confirm.", tone = Tone.Danger, icon = Icons.Rounded.Warning)
            }
        },
        confirmButton = {
            CcButton(if (confirm) "Send now" else "Send", {
                if (title.trim().length < 3 || body.trim().length < 3) {
                    snack.show("Add a title and message.")
                    return@CcButton
                }
                if (!confirm) {
                    confirm = true
                    return@CcButton
                }
                scope.launch {
                    busy = true
                    try {
                        app.api.admin.publishAlert(title.trim(), body.trim(), severity, checkIn); snack.show("Alert sent."); onSent()
                    } catch (e: ApiException) {
                        snack.error(e)
                    } finally {
                        busy = false
                    }
                }
            }, kind = ButtonKind.Danger, loading = busy)
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
fun AdminAnnouncementsScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val list = rememberLoad { app.api.admin.announcements() }
    var composing by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<String?>(null) }
    CcScreen(
        title = "Announcements", subtitle = "Notices and event safety information", onBack = { nav.popBackStack() },
        refreshing = list.refreshing, onRefresh = { list.reload() },
        bottomBar = { BottomActionBar { CcButton("New announcement", { composing = true }, Modifier.weight(1f), leadingIcon = Icons.Rounded.Add) } },
    ) {
        LoadContent(list) { items ->
            if (items.isEmpty()) EmptyState("No announcements", icon = Icons.Rounded.Campaign)
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items.forEach { a ->
                    Column {
                        AnnouncementCard(a)
                        Row {
                            if (!a.published) StatusChip("Draft", Tone.Neutral, modifier = Modifier.padding(top = 4.dp))
                            Spacer(Modifier.weight(1f))
                            TextButton(onClick = { deleting = a.id }) { Text("Delete", color = CcColors.Sos) }
                        }
                    }
                }
            }
        }
    }
    if (composing) {
        var title by remember { mutableStateOf("") }
        var body by remember { mutableStateOf("") }
        var kind by remember { mutableStateOf("notice") }
        var pinned by remember { mutableStateOf(false) }
        var venue by remember { mutableStateOf("") }
        var daysAhead by remember { mutableStateOf("1") }
        var safety by remember { mutableStateOf("") }
        var busy by remember { mutableStateOf(false) }
        AlertDialog(
            onDismissRequest = { composing = false },
            containerColor = Color.White,
            title = { Text("New announcement") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    ChoiceChips(listOf("notice" to "Notice", "event" to "Event"), kind, { kind = it })
                    CcTextField(title, { title = it }, label = "Title", maxLength = 140)
                    CcTextField(body, { body = it }, label = "Details", singleLine = false, minLines = 3, maxLength = 5000)
                    if (kind == "event") {
                        CcTextField(venue, { venue = it }, label = "Venue", maxLength = 200)
                        CcSelect("When", listOf("0" to "Today", "1" to "Tomorrow", "2" to "In 2 days", "7" to "Next week"), daysAhead, { daysAhead = it })
                        CcTextField(safety, { safety = it }, label = "Event safety contact", placeholder = "Name and phone", maxLength = 120)
                    }
                    SwitchRow("Pin to top", pinned, { pinned = it })
                }
            },
            confirmButton = {
                CcButton("Publish", {
                    if (title.trim().length < 3 || body.trim().length < 3) {
                        snack.show("Add a title and details.")
                        return@CcButton
                    }
                    scope.launch {
                        busy = true
                        try {
                            app.api.admin.createAnnouncement(
                                buildMap<String, Any?> {
                                    put("title", title.trim()); put("body", body.trim()); put("pinned", pinned); put("published", true); put("kind", kind)
                                    if (kind == "event") {
                                        put("eventAt", Instant.now().plusSeconds((daysAhead.toLongOrNull() ?: 1L) * 86_400).toString())
                                        put("venue", venue.trim()); put("safetyContact", safety.trim())
                                    }
                                },
                            )
                            composing = false; list.reload(); snack.show("Published.")
                        } catch (e: ApiException) {
                            snack.error(e)
                        } finally {
                            busy = false
                        }
                    }
                }, loading = busy)
            },
            dismissButton = { TextButton(onClick = { composing = false }) { Text("Cancel") } },
        )
    }
    deleting?.let { id ->
        ConfirmDialog("Delete announcement?", "Students will no longer see it.", confirmLabel = "Delete", destructive = true,
            onDismiss = { deleting = null },
            onConfirm = {
                scope.launch {
                    try {
                        app.api.admin.deleteAnnouncement(id); deleting = null; list.reload()
                    } catch (e: ApiException) {
                        snack.error(e)
                    }
                }
            },
        )
    }
}

private val INVITABLE = listOf("counsellor" to "Counsellor", "committee_member" to "Committee member", "security_officer" to "Campus Security", "moderator" to "Community moderator")

@Composable
fun AdminStaffScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    var role by rememberSaveable { mutableStateOf("staff") }
    var q by rememberSaveable { mutableStateOf("") }
    var applied by rememberSaveable { mutableStateOf("") }
    val users = rememberLoad(role to applied) { app.api.admin.users(applied, role.takeIf { it != "staff" }) }
    var inviting by remember { mutableStateOf(false) }
    val domain = app.config.settings.accountEmailDomain
    CcScreen(
        title = "People", subtitle = "Staff accounts and students", onBack = { nav.popBackStack() },
        refreshing = users.refreshing, onRefresh = { users.reload() },
        bottomBar = { BottomActionBar { CcButton("Invite staff", { inviting = true }, Modifier.weight(1f), leadingIcon = Icons.Rounded.PersonAdd) } },
    ) {
        CcTextField(q, { q = it; if (it.isBlank()) applied = "" }, label = "Search name or email", leadingIcon = Icons.Rounded.Search, onImeAction = { applied = q.trim() })
        ChoiceChips(listOf("staff" to "Everyone") + INVITABLE + ("student" to "Students"), role, { role = it })
        LoadContent(users) { page ->
            if (page.items.isEmpty()) EmptyState("No people found", icon = Icons.Rounded.Person)
            CcCard(padding = 8.dp) {
                page.items.forEachIndexed { i, u ->
                    if (i > 0) Divider()
                    ListRow(
                        u.fullName, subtitle = "${Catalog.roleLabel(u.role)} · ${u.email}" + (u.lastLoginAt?.let { " · seen ${Fmt.ago(it)}" } ?: ""),
                        icon = Icons.Rounded.Person, tone = if (u.accountStatus == "active") Tone.Brand else Tone.Neutral,
                        trailing = { if (u.accountStatus != "active") StatusChip(Fmt.humanize(u.accountStatus), Tone.Amber) },
                    )
                }
            }
            Text("Role changes, suspensions and Super Admin accounts are managed on the website.", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
        }
    }
    if (inviting) {
        var name by remember { mutableStateOf("") }
        var email by remember { mutableStateOf("") }
        var newRole by remember { mutableStateOf<String?>("counsellor") }
        var dept by remember { mutableStateOf("") }
        var busy by remember { mutableStateOf(false) }
        var err by remember { mutableStateOf<String?>(null) }
        AlertDialog(
            onDismissRequest = { inviting = false },
            containerColor = Color.White,
            title = { Text("Invite staff") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    CcTextField(name, { name = it }, label = "Full name", leadingIcon = Icons.Rounded.Person, maxLength = 120)
                    CcTextField(email, { email = it; err = null }, label = "University email", placeholder = "name@$domain", leadingIcon = Icons.Rounded.Email, keyboardType = KeyboardType.Email, error = err)
                    CcSelect("Role", INVITABLE, newRole, { newRole = it })
                    CcTextField(dept, { dept = it }, label = "Department (optional)", maxLength = 120)
                    Text("They'll get an email to set a password. Only @$domain addresses can be invited.", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
                }
            },
            confirmButton = {
                CcButton("Send invite", {
                    val e = email.trim().lowercase()
                    if (!e.endsWith("@$domain")) {
                        err = "Use an @$domain address"
                        return@CcButton
                    }
                    if (name.trim().length < 2) {
                        snack.show("Enter their name.")
                        return@CcButton
                    }
                    scope.launch {
                        busy = true
                        try {
                            app.api.admin.invite(name.trim(), e, newRole ?: "counsellor", dept.trim().ifBlank { null })
                            inviting = false; users.reload(); snack.show("Invitation sent to $e.")
                        } catch (ex: ApiException) {
                            err = ex.fields["email"]
                            snack.error(ex)
                        } finally {
                            busy = false
                        }
                    }
                }, loading = busy)
            },
            dismissButton = { TextButton(onClick = { inviting = false }) { Text("Cancel") } },
        )
    }
}

// ------------------------------------------------------------------ moderation (moderators & admins)

@Composable
fun ModerationScreen() {
    var tab by rememberSaveable { mutableStateOf("chat") }
    CcScreen(title = "Moderation", subtitle = "Keep community spaces safe") {
        ChoiceChips(listOf("chat" to "Chat reports", "hazards" to "Hazards", "suggestions" to "Suggestions", "lostfound" to "Lost & found"), tab, { tab = it })
        when (tab) {
            "hazards" -> HazardQueue()
            "suggestions" -> SuggestionQueue()
            "lostfound" -> LostFoundQueue()
            else -> ChatReportQueue()
        }
    }
}

@Composable
private fun ChatReportQueue() {
    val app = LocalApp.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val reports = rememberLoad { app.api.chat.moderationReports("open") }
    LoadContent(reports) { list ->
        if (list.isEmpty()) EmptyState("Nothing to review", message = "Reported messages appear here.", icon = Icons.Rounded.CheckCircle)
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            list.forEachIndexed { i, r ->
                CcCard(Modifier.enterStagger(i)) {
                    Text("#${r.channel ?: "channel"} · ${Fmt.ago(r.createdAt)}", style = MaterialTheme.typography.labelMedium, color = CcColors.InkSoft)
                    r.message?.let { m ->
                        Text("${m.senderLabel}: ${m.body}", style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink, modifier = Modifier.padding(top = 6.dp))
                        if (m.hidden) StatusChip("Already hidden", Tone.Neutral, modifier = Modifier.padding(top = 4.dp))
                    }
                    Text("Reason: ${r.reason}", style = MaterialTheme.typography.bodySmall, color = CcColors.Rose, modifier = Modifier.padding(top = 6.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                        listOf("hide" to "Hide message", "dismiss" to "Dismiss").forEach { (action, label) ->
                            CcButton(label, {
                                scope.launch {
                                    try {
                                        app.api.chat.moderate(r.id, action); reports.reload()
                                    } catch (e: ApiException) {
                                        snack.error(e)
                                    }
                                }
                            }, Modifier.weight(1f), kind = if (action == "hide") ButtonKind.Danger else ButtonKind.Outline, leadingIcon = if (action == "hide") Icons.Rounded.VisibilityOff else null)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun HazardQueue() {
    val app = LocalApp.current
    var status by rememberSaveable { mutableStateOf("open") }
    val list = rememberLoad(status) { app.api.community.manageHazards(status) }
    var reviewing by remember { mutableStateOf<Hazard?>(null) }
    ChoiceChips(listOf("open" to "New", "verified" to "Verified", "in_progress" to "In progress", "resolved" to "Resolved"), status, { status = it })
    LoadContent(list) { items ->
        if (items.isEmpty()) EmptyState("No hazards here", icon = Icons.Rounded.CheckCircle)
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items.forEach { h ->
                CcCard(onClick = { reviewing = h }) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(Catalog.hazardCategories.firstOrNull { it.first == h.category }?.second ?: h.category, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink, modifier = Modifier.weight(1f))
                        StatusChip(Fmt.humanize(h.status), Tone.Amber)
                    }
                    Text(h.locationLabel, style = MaterialTheme.typography.labelMedium, color = CcColors.InkSoft)
                    Text(h.description, style = MaterialTheme.typography.bodySmall, color = CcColors.Ink, modifier = Modifier.padding(top = 4.dp))
                    Text("${Fmt.ago(h.createdAt)}${if (h.anonymous) " · anonymous" else ""}${if (h.latitude != null) " · pinned on map" else ""}", style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint, modifier = Modifier.padding(top = 4.dp))
                }
            }
        }
    }
    reviewing?.let { h -> ReviewDialog("Review hazard", listOf("verified" to "Verified (show on map)", "in_progress" to "Being fixed", "resolved" to "Resolved", "rejected" to "Reject"), h.status, "Public note (shown on the map)", onDismiss = { reviewing = null }) { st, note ->
        app.api.community.reviewHazard(h.id, st, note); reviewing = null; list.reload()
    } }
}

@Composable
private fun SuggestionQueue() {
    val app = LocalApp.current
    var status by rememberSaveable { mutableStateOf("new") }
    val list = rememberLoad(status) { app.api.community.manageSuggestions(status) }
    var reviewing by remember { mutableStateOf<Suggestion?>(null) }
    ChoiceChips(listOf("new" to "New", "reviewed" to "Reviewed", "planned" to "Planned", "done" to "Done"), status, { status = it })
    LoadContent(list) { items ->
        if (items.isEmpty()) EmptyState("No suggestions here", icon = Icons.Rounded.EmojiObjects)
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items.forEach { s ->
                CcCard(onClick = { reviewing = s }) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(Fmt.humanize(s.category), style = MaterialTheme.typography.labelLarge, color = CcColors.InkSoft, modifier = Modifier.weight(1f))
                        StatusChip(Fmt.humanize(s.status), Tone.Sky)
                    }
                    Text(s.text, style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink, modifier = Modifier.padding(top = 4.dp))
                    s.response?.let { Text("Response: $it", style = MaterialTheme.typography.bodySmall, color = CcColors.Forest) }
                }
            }
        }
    }
    reviewing?.let { s -> ReviewDialog("Respond to suggestion", listOf("reviewed" to "Reviewed", "planned" to "Planned", "done" to "Done (show in “You said, we did”)", "declined" to "Declined"), s.status, "Response to the community", onDismiss = { reviewing = null }) { st, note ->
        app.api.community.reviewSuggestion(s.id, st, note); reviewing = null; list.reload()
    } }
}

@Composable
private fun LostFoundQueue() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val list = rememberLoad { app.api.community.manageLostFound() }
    LoadContent(list) { items ->
        if (items.isEmpty()) EmptyState("No listings", icon = Icons.Rounded.Inventory2)
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items.forEach { item ->
                CcCard(onClick = { nav.navigate(Routes.lostFoundItem(item.id)) }) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(item.title, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink, modifier = Modifier.weight(1f))
                        StatusChip(Fmt.humanize(item.status), Tone.Neutral)
                    }
                    Text("${if (item.type == "lost") "Lost" else "Found"} · ${item.location} · ${Fmt.ago(item.createdAt)}", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                    if (item.status != "removed") {
                        TextButton(onClick = {
                            scope.launch {
                                try {
                                    app.api.community.setLostFoundStatus(item.id, "removed", "Community guidelines"); list.reload()
                                } catch (e: ApiException) {
                                    snack.error(e)
                                }
                            }
                        }) { Text("Remove listing", color = CcColors.Sos) }
                    }
                }
            }
        }
    }
}

@Composable
private fun ReviewDialog(
    title: String,
    options: List<Pair<String, String>>,
    current: String,
    noteLabel: String,
    onDismiss: () -> Unit,
    onSave: suspend (String, String?) -> Unit,
) {
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    var status by remember { mutableStateOf<String?>(options.firstOrNull { it.first != current }?.first ?: current) }
    var note by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Color.White,
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                CcSelect("Status", options, status, { status = it })
                CcTextField(note, { note = it }, label = noteLabel, singleLine = false, minLines = 2, maxLength = 1000)
            }
        },
        confirmButton = {
            CcButton("Save", {
                val st = status ?: return@CcButton
                scope.launch {
                    busy = true
                    try {
                        onSave(st, note.trim().ifBlank { null })
                    } catch (e: ApiException) {
                        snack.error(e)
                    } finally {
                        busy = false
                    }
                }
            }, loading = busy)
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
