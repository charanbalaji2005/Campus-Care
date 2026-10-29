package edu.srmap.campuscare.ui.screens.staff

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Chat
import androidx.compose.material.icons.automirrored.rounded.Help
import androidx.compose.material.icons.automirrored.rounded.Logout
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.BarChart
import androidx.compose.material.icons.rounded.Campaign
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.Gavel
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.Place
import androidx.compose.material.icons.rounded.PrivacyTip
import androidx.compose.material.icons.rounded.School
import androidx.compose.material.icons.rounded.Security
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.BuildConfig
import edu.srmap.campuscare.data.CaAnnouncement
import edu.srmap.campuscare.data.CaOfficer
import edu.srmap.campuscare.data.CaReportRow
import edu.srmap.campuscare.ui.components.Avatar
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.CcSelect
import edu.srmap.campuscare.ui.components.CcTextField
import edu.srmap.campuscare.ui.components.ChoiceChips
import edu.srmap.campuscare.ui.components.ConfirmDialog
import edu.srmap.campuscare.ui.components.Divider
import edu.srmap.campuscare.ui.components.EmptyState
import edu.srmap.campuscare.ui.components.InfoBanner
import edu.srmap.campuscare.ui.components.InputDialog
import edu.srmap.campuscare.ui.components.KeyValue
import edu.srmap.campuscare.ui.components.ListRow
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.MultiChoiceChips
import edu.srmap.campuscare.ui.components.SectionHeader
import edu.srmap.campuscare.ui.components.SkeletonList
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.components.userMessage
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.navigation.rememberSignOut
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.Fmt
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// ============================================================================ 6. Student management
@Composable
fun CampusAdminStudentsScreen() {
    val nav = LocalNav.current
    val api = rememberCampusAdminApi()
    var query by rememberSaveable { mutableStateOf("") }
    var department by rememberSaveable { mutableStateOf("all") }
    var status by rememberSaveable { mutableStateOf("all") }
    var verification by rememberSaveable { mutableStateOf("all") }
    var page by rememberSaveable { mutableIntStateOf(1) }
    val list = rememberLoad(listOf(query, department, status, verification, page)) {
        if (query.isNotBlank()) delay(350)
        api.students(query, department.takeIf { it != "all" }, status.takeIf { it != "all" }, verification.takeIf { it != "all" }, page)
    }
    CcScreen(title = "Students", subtitle = "Your campuses only · every view is audited", onBack = { nav.popBackStack() }, refreshing = list.refreshing, onRefresh = { list.reload() }) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            CaSearchBar(query, { query = it; page = 1 }, "Name, email or student ID")
            ChoiceChips(listOf("all" to "All", "active" to "Active", "pending_verification" to "Email pending", "suspended" to "Suspended"), status, onSelect = { status = it; page = 1 })
            LoadContent(list, skeleton = { SkeletonList(5) }) { x ->
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        CcSelect("Department", listOf("all" to "All departments") + x.departments.map { it to it }, department, onSelect = { department = it; page = 1 }, modifier = Modifier.weight(1f))
                        CcSelect("Verification", listOf("all" to "Any", "pending" to "Pending", "submitted" to "Submitted", "under_review" to "Under review", "needs_info" to "Needs info", "approved" to "Verified", "rejected" to "Rejected"), verification, onSelect = { verification = it; page = 1 }, modifier = Modifier.weight(1f))
                    }
                    Text("${x.total} student(s)", style = MaterialTheme.typography.labelMedium, color = CcColors.InkSoft)
                    if (x.items.isEmpty()) EmptyState("No students found", message = "Try another name, ID or filter.", icon = Icons.Rounded.School)
                    x.items.forEach { s ->
                        CcCard(onClick = { nav.navigate(Routes.campusAdminStudent(s.id)) }, padding = 12.dp) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Avatar(s.name, size = 38.dp)
                                Spacer(Modifier.width(10.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(s.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = CcColors.Ink)
                                    Text(listOfNotNull(s.studentId, s.department, s.academicYear?.let { "Year $it" }).joinToString(" · ").ifBlank { s.email }, style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
                                }
                                Column(horizontalAlignment = Alignment.End) {
                                    CaChip(Fmt.humanize(s.accountStatus), accountBucket(s.accountStatus))
                                    Spacer(Modifier.height(4.dp))
                                    CaChip(verificationLabel(s.verificationStatus), if (s.verificationStatus == "approved") "ok" else if (s.verificationStatus == "rejected") "danger" else "amber")
                                }
                            }
                        }
                    }
                    if (x.total > x.page * x.limit || x.page > 1) {
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            CcButton("Previous", { page-- }, Modifier.weight(1f), kind = ButtonKind.Outline, enabled = x.page > 1)
                            CcButton("Next", { page++ }, Modifier.weight(1f), kind = ButtonKind.Outline, enabled = x.total > x.page * x.limit)
                        }
                    }
                }
            }
        }
    }
}

internal fun accountBucket(status: String) = when (status) {
    "active" -> "ok"
    "suspended", "deactivated" -> "danger"
    else -> "amber"
}

internal fun verificationLabel(status: String) = when (status) {
    "approved" -> "Verified"
    "needs_info" -> "Needs info"
    else -> Fmt.humanize(status)
}

@Composable
fun CampusAdminStudentScreen(id: String) {
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val api = rememberCampusAdminApi()
    val d = rememberLoad(id) { api.student(id) }
    var askSuspend by remember { mutableStateOf(false) }
    var askReactivate by remember { mutableStateOf(false) }
    var review by remember { mutableStateOf<Pair<String, String>?>(null) }
    var busy by remember { mutableStateOf(false) }
    fun act(block: suspend () -> Unit, done: String) {
        busy = true
        scope.launch {
            runCatching { block() }.onSuccess { snack.show(done); d.reload() }.onFailure { snack.show(it.userMessage()) }
            busy = false; askSuspend = false; askReactivate = false; review = null
        }
    }
    CcScreen(title = d.data?.name ?: "Student", subtitle = "Student profile", onBack = { nav.popBackStack() }, refreshing = d.refreshing, onRefresh = { d.reload() }) {
        LoadContent(d, skeleton = { SkeletonList(3) }) { s ->
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                CaChipRow {
                    CaChip(Fmt.humanize(s.accountStatus), accountBucket(s.accountStatus))
                    CaChip(verificationLabel(s.verificationStatus), if (s.verificationStatus == "approved") "ok" else "amber")
                    CaChip(if (s.emailVerified) "Email verified" else "Email not verified", if (s.emailVerified) "ok" else "amber")
                }
                CcCard {
                    KeyValue("Email", s.email)
                    KeyValue("Student ID", s.studentId ?: "—")
                    KeyValue("Department", s.department ?: "—")
                    KeyValue("Year", s.academicYear?.toString() ?: "—")
                    KeyValue("Campus", s.campus)
                    KeyValue("Phone", s.phone ?: "—")
                    KeyValue("Joined", Fmt.date(s.createdAt))
                    KeyValue("Last sign-in", s.lastLoginAt?.let { Fmt.ago(it) } ?: "Never")
                    s.suspendedReason?.let { KeyValue("Suspension reason", it) }
                }
                s.restricted?.let { CaRestricted(it) }
                if (s.evidence.isNotEmpty()) {
                    SectionHeader("Identity evidence")
                    s.evidence.forEach { e ->
                        CcCard(padding = 12.dp) {
                            Text("${Fmt.humanize(e.type)} · ${Fmt.humanize(e.status)}", style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink)
                            Text("Submitted ${Fmt.date(e.submittedAt)}" + (e.initialRecommendation?.let { " · your recommendation: ${Fmt.humanize(it)}" } ?: ""), style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
                            if (e.status in listOf("pending", "under_review", "more_info_required")) {
                                Spacer(Modifier.height(6.dp))
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    CcButton("Recommend", { review = e.id to "recommend_approval" }, Modifier.weight(1f), kind = ButtonKind.Soft)
                                    CcButton("Needs info", { review = e.id to "needs_info" }, Modifier.weight(1f), kind = ButtonKind.Outline)
                                }
                            }
                        }
                    }
                    Text("Your recommendation goes to the Super Admin, who makes the verification decision.", style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint)
                }
                if (s.canChangeStatus) {
                    if (s.accountStatus == "suspended") CcButton("Reactivate account", { askReactivate = true }, kind = ButtonKind.Brand, enabled = !busy)
                    else if (s.accountStatus == "active" || s.accountStatus == "pending_verification") CcButton("Suspend account", { askSuspend = true }, kind = ButtonKind.Danger, enabled = !busy)
                }
                Spacer(Modifier.height(16.dp))
            }
        }
    }
    if (askSuspend) InputDialog("Suspend ${d.data?.name}?", "They are signed out everywhere. The reason is recorded in the audit log.", "Reason", "Suspend",
        onConfirm = { reason -> act({ api.setStudentStatus(id, "suspend", reason) }, "Account suspended") }, onDismiss = { askSuspend = false }, destructive = true, loading = busy)
    if (askReactivate) ConfirmDialog("Reactivate ${d.data?.name}?", "They can sign in again (after email verification if it is still pending).", "Reactivate",
        onConfirm = { act({ api.setStudentStatus(id, "reactivate", "Reactivated from the Campus Admin portal") }, "Account reactivated") }, onDismiss = { askReactivate = false }, loading = busy)
    review?.let { (evidenceId, rec) ->
        InputDialog(if (rec == "needs_info") "Ask for more information" else "Recommend approval", "Add a note for the Super Admin.", "Note", "Send",
            onConfirm = { notes -> act({ api.initialReview(evidenceId, rec, notes) }, "Recommendation sent") }, onDismiss = { review = null }, loading = busy)
    }
}

// ============================================================================ 7. Security management
@Composable
fun CampusAdminSecurityScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val api = rememberCampusAdminApi()
    val d = rememberLoad { api.security() }
    LaunchedEffect(Unit) { app.realtime.events.collect { e -> if (e.name.startsWith("duty")) d.reload() } }
    var override by remember { mutableStateOf<CaOfficer?>(null) }
    var target by remember { mutableStateOf("off_duty") }
    var busy by remember { mutableStateOf(false) }
    CcScreen(title = "Security management", subtitle = "Duty, patrols and response", refreshing = d.refreshing, onRefresh = { d.reload() }) {
        LoadContent(d, skeleton = { SkeletonList(5) }) { x ->
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                CaMetricRow {
                    CaMetricCard("On duty", "${x.summary.onDuty}/${x.summary.officers}", Modifier.weight(1f), Tone.Brand, Icons.Rounded.Security)
                    CaMetricCard("Responding", "${x.summary.responding}", Modifier.weight(1f), Tone.Amber)
                }
                CaMetricRow {
                    CaMetricCard("Active SOS", "${x.sos.active}", Modifier.weight(1f), Tone.Danger, onClick = { nav.navigate(Routes.CampusAdminSos) })
                    CaMetricCard("Avg. acknowledge", CampusAdminRules.duration(x.sos.avgAcknowledgeSeconds), Modifier.weight(1f), Tone.Teal, caption = "${x.sos.resolved30d} of ${x.sos.raised30d} resolved (30d)")
                }
                SectionHeader("Patrols today")
                if (x.patrols.isEmpty()) Text("No patrols running or completed today.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                x.patrols.forEach { p ->
                    CcCard(padding = 12.dp) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(p.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = CcColors.Ink)
                                Text(listOfNotNull(p.officer, p.shift).joinToString(" · "), style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
                            }
                            CaChip(Fmt.humanize(p.status), if (p.status == "completed") "ok" else "sky")
                        }
                        Spacer(Modifier.height(6.dp))
                        Text("${p.checkpointsDone} of ${p.checkpointsTotal} checkpoints", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
                        Spacer(Modifier.height(4.dp))
                        CaProgress(p.checkpointsDone, p.checkpointsTotal)
                    }
                }
                x.checkpointCompletion?.let { Text("Checkpoint completion: $it%", style = MaterialTheme.typography.labelMedium, color = CcColors.InkSoft) }
                SectionHeader("Security team")
                if (!x.canManageDuty) CaRestricted("Duty changes are made by officers themselves or a supervisor with duty-management permission. Status here comes from the server.")
                if (x.team.isEmpty()) EmptyState("No Security Officers on your campuses", icon = Icons.Rounded.Shield)
                x.team.forEach { o ->
                    CcCard(padding = 12.dp) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Avatar(o.name, size = 36.dp, tone = Tone.Teal)
                            Spacer(Modifier.width(10.dp))
                            Column(Modifier.weight(1f)) {
                                Text(o.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = CcColors.Ink)
                                Text("${o.designation} · ${o.campus} · ${o.sosHandled30d} SOS (30d)", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
                                o.lastHeartbeatAt?.let { Text("Last seen ${Fmt.ago(it)}", style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint) }
                            }
                            CaChip(o.dutyLabel, CampusAdminRules.dutyBucket(o.dutyStatus))
                        }
                        if (x.canManageDuty) {
                            Spacer(Modifier.height(6.dp))
                            CcButton("Change duty status", { override = o; target = if (o.dutyStatus == "off_duty") "on_duty" else "off_duty" }, kind = ButtonKind.Soft)
                        }
                    }
                }
                Spacer(Modifier.height(16.dp))
            }
        }
    }
    override?.let { o ->
        InputDialog("Set ${o.name} ${Fmt.humanize(target).lowercase()}?", "Supervisor overrides are recorded with your reason. The server may refuse if a shift or approval is required.", "Reason", "Confirm",
            onConfirm = { reason ->
                busy = true
                scope.launch {
                    runCatching { api.overrideDuty(o.id, target, reason) }.onSuccess { snack.show("Duty status updated"); d.reload() }.onFailure { snack.show(it.userMessage()) }
                    busy = false; override = null
                }
            }, onDismiss = { override = null }, loading = busy)
    }
}

// ============================================================================ 8. Committee management
@Composable
fun CampusAdminCommitteesScreen() {
    val nav = LocalNav.current
    val api = rememberCampusAdminApi()
    val d = rememberLoad { api.committees() }
    var assigning by remember { mutableStateOf<CaReportRow?>(null) }
    CcScreen(title = "Committee management", subtitle = "Workload, due dates and assignment", onBack = { nav.popBackStack() }, refreshing = d.refreshing, onRefresh = { d.reload() }) {
        LoadContent(d, skeleton = { SkeletonList(5) }) { x ->
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                val totals = x.committees
                CaMetricRow {
                    CaMetricCard("Awaiting review", "${totals.sumOf { it.new } + (x.unrouted?.new ?: 0)}", Modifier.weight(1f), Tone.Sky)
                    CaMetricCard("Investigating", "${totals.sumOf { it.investigating }}", Modifier.weight(1f), Tone.Violet)
                }
                CaMetricRow {
                    CaMetricCard("Awaiting info", "${totals.sumOf { it.awaitingInformation }}", Modifier.weight(1f), Tone.Amber)
                    CaMetricCard("Overdue", "${totals.sumOf { it.overdue }}", Modifier.weight(1f), Tone.Rose)
                    CaMetricCard("Resolved", "${totals.sumOf { it.resolved }}", Modifier.weight(1f), Tone.Brand)
                }
                x.unrouted?.let { if (it.new > 0) InfoBanner("${it.new} report(s) are not routed to a committee yet. Route them from the triage queue.", tone = Tone.Amber, action = { CcButton("Open triage", { nav.navigate(Routes.AdminTriage) }, kind = ButtonKind.Soft) }) }
                SectionHeader("Committees")
                x.committees.forEach { c ->
                    CcCard(padding = 12.dp) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(c.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = CcColors.Ink)
                                Text(Fmt.humanize(c.type) + (if (c.confidential) " · confidential" else ""), style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
                            }
                            if (c.overdue > 0) CaChip("${c.overdue} overdue", "danger")
                        }
                        Spacer(Modifier.height(6.dp))
                        Text("New ${c.new} · investigating ${c.investigating} · awaiting info ${c.awaitingInformation} · resolved ${c.resolved} · unassigned ${c.unassigned}", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
                        c.nextDue?.let { Text("Next due ${Fmt.date(it)}", style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint) }
                    }
                }
                SectionHeader("Member workload")
                if (x.workload.isEmpty()) Text("No open reports are assigned yet.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                if (x.workload.isNotEmpty()) CcCard { CaBarList(x.workload.map { "${it.name}${if (it.overdue > 0) " (${it.overdue} overdue)" else ""}" to it.open }, CcColors.Violet, threshold = 1) }
                SectionHeader("Waiting for an owner")
                if (x.awaitingAssignment.isEmpty()) EmptyState("Every open report has an owner", icon = Icons.Rounded.CheckCircle)
                x.awaitingAssignment.forEach { r -> ReportRowCard(r, x.canAssign, onOpen = { nav.navigate(Routes.case(r.id)) }, onAssign = { assigning = r }) }
                Spacer(Modifier.height(16.dp))
            }
        }
    }
    assigning?.let { r -> AssignReportDialog(r) { changed -> assigning = null; if (changed) d.reload() } }
}

// ============================================================================ 9. Reports & analytics
@Composable
fun CampusAdminAnalyticsScreen() {
    val nav = LocalNav.current
    val api = rememberCampusAdminApi()
    var range by rememberSaveable { mutableStateOf(30) }
    val d = rememberLoad(range) { api.analytics(range) }
    CcScreen(title = "Reports & analytics", subtitle = "Your campuses · server-calculated", onBack = { nav.popBackStack() }, refreshing = d.refreshing, onRefresh = { d.reload() }) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            ChoiceChips(CampusAdminRules.RANGES.map { "${it.first}" to it.second }, "$range", onSelect = { range = it.toInt() })
            LoadContent(d, skeleton = { SkeletonList(5) }) { x ->
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    SectionHeader("Formal reports")
                    CaMetricRow {
                        CaMetricCard("New", "${x.reports.total}", Modifier.weight(1f), Tone.Violet, caption = "${CampusAdminRules.change(x.reports.total, x.reports.previous)} vs previous")
                        CaMetricCard("Resolved", "${x.reports.resolved}", Modifier.weight(1f), Tone.Brand)
                        CaMetricCard("Resolution rate", x.reports.resolutionRate?.let { "$it%" } ?: "—", Modifier.weight(1f), Tone.Teal)
                    }
                    if (x.reportTrend.isNotEmpty()) CcCard { Text("Reports over time", style = MaterialTheme.typography.labelMedium, color = CcColors.InkSoft); Spacer(Modifier.height(6.dp)); CaColumnChart(x.reportTrend.map { it.period to it.count }, CcColors.Violet) }
                    if (x.byCategory.isNotEmpty()) CcCard {
                        Text("By category", style = MaterialTheme.typography.labelMedium, color = CcColors.InkSoft)
                        Spacer(Modifier.height(6.dp))
                        CaBarList(x.byCategory.map { Fmt.humanize(it.category) to it.count }, CcColors.Violet, x.smallAggregateThreshold)
                        Text("Counts under ${x.smallAggregateThreshold} are hidden to protect privacy.", style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint, modifier = Modifier.padding(top = 6.dp))
                    }
                    SectionHeader("SOS response (kept separate from reports)")
                    CaMetricRow {
                        CaMetricCard("SOS raised", "${x.sos.raised}", Modifier.weight(1f), Tone.Danger, caption = "${CampusAdminRules.change(x.sos.raised, x.sos.previous)} vs previous")
                        CaMetricCard("Resolved", "${x.sos.resolved}", Modifier.weight(1f), Tone.Brand)
                        CaMetricCard("Avg. acknowledge", CampusAdminRules.duration(x.sos.avgAcknowledgeSeconds), Modifier.weight(1f), Tone.Teal)
                    }
                    if (x.sosTrend.isNotEmpty()) CcCard { Text("SOS over time", style = MaterialTheme.typography.labelMedium, color = CcColors.InkSoft); Spacer(Modifier.height(6.dp)); CaColumnChart(x.sosTrend.map { it.period to it.count }, CcColors.Sos) }
                    SectionHeader("Counselling")
                    CaMetricRow {
                        CaMetricCard("Requests", "${x.counselling.requested}", Modifier.weight(1f), Tone.Sky)
                        CaMetricCard("Completed", "${x.counselling.completed}", Modifier.weight(1f), Tone.Brand)
                        CaMetricCard("Completion", x.counselling.completionRate?.let { "$it%" } ?: "—", Modifier.weight(1f), Tone.Teal)
                    }
                    SectionHeader("Security & students")
                    CaMetricRow {
                        CaMetricCard("Officers on duty", "${x.security.onDuty}/${x.security.officers}", Modifier.weight(1f), Tone.Brand)
                        CaMetricCard("Patrols completed", "${x.security.patrolsCompleted}", Modifier.weight(1f), Tone.Teal)
                    }
                    x.students?.let { s ->
                        CaMetricRow {
                            CaMetricCard("Students", "${s.total}", Modifier.weight(1f), Tone.Brand)
                            CaMetricCard("Verified", "${s.verified}", Modifier.weight(1f), Tone.Teal)
                            CaMetricCard("Suspended", "${s.suspended}", Modifier.weight(1f), Tone.Rose)
                        }
                    }
                    if (x.committeeWorkload.isNotEmpty()) {
                        SectionHeader("Committee workload (open reports)")
                        CcCard { CaBarList(x.committeeWorkload.map { it.committee to it.open }, CcColors.Violet, threshold = 1) }
                    }
                    Text("Institution-wide analytics stay in the Super Admin portal.", style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint)
                    Spacer(Modifier.height(16.dp))
                }
            }
        }
    }
}

// ============================================================================ 10. Announcements
@Composable
fun CampusAdminAnnouncementsScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val api = rememberCampusAdminApi()
    var audience by rememberSaveable { mutableStateOf("all") }
    var query by rememberSaveable { mutableStateOf("") }
    var open by remember { mutableStateOf<CaAnnouncement?>(null) }
    var composing by remember { mutableStateOf(false) }
    val list = rememberLoad(audience to query) {
        if (query.isNotBlank()) delay(300)
        api.announcements(audience, query)
    }
    LaunchedEffect(Unit) { app.realtime.events.collect { e -> if (e.name == "announcements:changed") list.reload() } }
    CcScreen(title = "Announcements", subtitle = "Official notices for your roles and campus", onBack = { nav.popBackStack() }, refreshing = list.refreshing, onRefresh = { list.reload() }) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            ChoiceChips(CampusAdminRules.ANNOUNCEMENT_AUDIENCES, audience, onSelect = { audience = it })
            CaSearchBar(query, { query = it }, "Search announcements")
            LoadContent(list, skeleton = { SkeletonList(4) }) { x ->
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (x.canPublish) CcButton("New announcement", { composing = true }, kind = ButtonKind.Brand, leadingIcon = Icons.Rounded.Add)
                    if (x.items.isEmpty()) EmptyState("No announcements", icon = Icons.Rounded.Campaign)
                    x.items.forEach { a ->
                        CcCard(onClick = {
                            open = a
                            if (!a.read) scope.launch { runCatching { api.markAnnouncementRead(a.id) }; list.reload() }
                        }, padding = 12.dp) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(a.title, style = MaterialTheme.typography.titleSmall, fontWeight = if (a.read) FontWeight.Normal else FontWeight.Bold, color = CcColors.Ink, modifier = Modifier.weight(1f))
                                if (a.priority != "standard") CaChip(Fmt.humanize(a.priority), if (a.priority == "urgent") "danger" else "amber")
                            }
                            Text(a.body.take(140), style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft, maxLines = 2)
                            Spacer(Modifier.height(4.dp))
                            Text(
                                listOf(Fmt.humanize(a.category), if (a.campus == "all") "All campuses" else a.campus, audienceLabel(a.targetRoles), Fmt.date(a.createdAt)).joinToString(" · ") + if (!a.read) " · unread" else "",
                                style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint,
                            )
                        }
                    }
                }
            }
        }
    }
    open?.let { a ->
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { open = null },
            containerColor = androidx.compose.ui.graphics.Color.White,
            title = { Text(a.title) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("${a.authorName ?: "Administration"} · ${Fmt.dateTime(a.createdAt)}", style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint)
                    Text(a.body, style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink)
                    a.attachments.forEach { f -> Text("Attachment: ${f.name}", style = MaterialTheme.typography.labelMedium, color = CcColors.Forest) }
                }
            },
            confirmButton = { CcButton("Close", { open = null }, kind = ButtonKind.Ghost) },
        )
    }
    if (composing) list.data?.let { data ->
        ComposeAnnouncementDialog(data.publishCampuses.map { it.id to it.name }, onDone = { posted -> composing = false; if (posted) { snack.show("Announcement published"); list.reload() } })
    }
}

internal fun audienceLabel(roles: List<String>): String =
    if (roles.isEmpty() || "all" in roles) "Everyone" else roles.joinToString(", ") { if (it == "admin") "Campus Admins" else Fmt.humanize(it) + "s" }

@Composable
private fun ComposeAnnouncementDialog(campuses: List<Pair<String, String>>, onDone: (Boolean) -> Unit) {
    val api = rememberCampusAdminApi()
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    var title by remember { mutableStateOf("") }
    var body by remember { mutableStateOf("") }
    var category by remember { mutableStateOf("campus_updates") }
    var priority by remember { mutableStateOf("standard") }
    var campus by remember { mutableStateOf(campuses.firstOrNull()?.first) }
    var roles by remember { mutableStateOf(setOf("all")) }
    var busy by remember { mutableStateOf(false) }
    val valid = title.trim().length >= 3 && body.trim().length >= 3 && campus != null && roles.isNotEmpty()
    androidx.compose.material3.AlertDialog(
        onDismissRequest = { if (!busy) onDone(false) },
        containerColor = androidx.compose.ui.graphics.Color.White,
        title = { Text("New announcement") },
        text = {
            Column(Modifier.heightIn(max = 460.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                run {
                    CcTextField(title, { title = it }, "Title", maxLength = 140)
                    CcTextField(body, { body = it }, "Message", singleLine = false, minLines = 4, maxLength = 5000)
                    CcSelect("Category", listOf("campus_updates", "general", "academic", "events", "safety", "counselling", "emergency").map { it to Fmt.humanize(it) }, category, onSelect = { category = it })
                    CcSelect("Priority", listOf("standard" to "Standard", "important" to "Important", "urgent" to "Urgent"), priority, onSelect = { priority = it })
                    CcSelect("Campus", campuses, campus, onSelect = { campus = it })
                    Text("Audience", style = MaterialTheme.typography.labelMedium, color = CcColors.InkSoft)
                    MultiChoiceChips(listOf("all" to "Everyone", "student" to "Students", "counsellor" to "Counsellors", "committee_member" to "Committee", "security_officer" to "Security", "admin" to "Campus Admins"), roles, onToggle = { r ->
                        roles = if (r == "all") setOf("all") else (roles - "all").let { if (r in it) it - r else it + r }
                    })
                }
            }
        },
        confirmButton = {
            CcButton("Publish", {
                busy = true
                scope.launch {
                    runCatching { api.publishAnnouncement(CampusAdminRules.announcementBody(title, body, category, priority, campus!!, roles.toList())) }
                        .onSuccess { onDone(true) }.onFailure { snack.show(it.userMessage()); busy = false }
                }
            }, enabled = valid && !busy, loading = busy)
        },
        dismissButton = { CcButton("Cancel", { onDone(false) }, kind = ButtonKind.Ghost, enabled = !busy) },
    )
}

// ============================================================================ 11. Messages
@Composable
fun CampusAdminMessagesScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val api = rememberCampusAdminApi()
    var query by rememberSaveable { mutableStateOf("") }
    val d = rememberLoad(query) {
        if (query.isNotBlank()) delay(300)
        api.messages(query)
    }
    LaunchedEffect(Unit) { app.realtime.events.collect { e -> if (e.name == "notification" || e.name.startsWith("chat") || e.name.startsWith("message")) d.reload() } }
    CcScreen(title = "Messages", subtitle = "Only conversations you are part of or authorised for", onBack = { nav.popBackStack() }, refreshing = d.refreshing, onRefresh = { d.reload() }) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            CaSearchBar(query, { query = it }, "Search conversations")
            LoadContent(d, skeleton = { SkeletonList(5) }) { x ->
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (x.groups.isEmpty()) EmptyState("No conversations available", icon = Icons.AutoMirrored.Rounded.Chat)
                    x.groups.forEach { g ->
                        CcCard(onClick = { nav.navigate(Routes.chats(g.category)) }, padding = 12.dp) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(g.label, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = CcColors.Ink)
                                    Text("${g.description} · ${g.count} conversation(s)", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
                                }
                                if (g.unread > 0) StatusChip("${g.unread} unread", Tone.Danger)
                            }
                            g.recent.forEach { c ->
                                Divider()
                                Row(Modifier.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Column(Modifier.weight(1f)) {
                                        Text(c.title, style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink, fontWeight = if (c.unread > 0) FontWeight.Bold else FontWeight.Normal, maxLines = 1)
                                        Text(if (c.locked) "Content restricted" else c.preview ?: "No messages yet", style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint, maxLines = 1)
                                    }
                                    Text(Fmt.ago(c.lastActivityAt), style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint)
                                }
                            }
                        }
                    }
                    Text("Opening a conversation re-checks your access to the underlying report or SOS record.", style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint)
                }
            }
        }
    }
}

// ============================================================================ 12. Profile & settings
@Composable
fun CampusAdminProfileScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val api = rememberCampusAdminApi()
    val signOut = rememberSignOut()
    val d = rememberLoad { api.profile() }
    var confirmOut by remember { mutableStateOf(false) }
    CcScreen(title = "Profile & settings", onBack = { nav.popBackStack() }, refreshing = d.refreshing, onRefresh = { d.reload() }) {
        LoadContent(d, skeleton = { SkeletonList(4) }) { p ->
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                CcCard {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Avatar(p.name, size = 52.dp)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(p.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = CcColors.Ink)
                            Text(listOfNotNull(p.designation, p.roleLabel).joinToString(" · "), style = MaterialTheme.typography.labelMedium, color = CcColors.InkSoft)
                            Text(p.email, style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint)
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    CaChipRow {
                        CaChip(if (p.verificationStatus == "approved") "Verified" else verificationLabel(p.verificationStatus), if (p.verificationStatus == "approved") "ok" else "amber")
                        CaChip(if (p.mfaEnabled) "2-step on" else "2-step off", if (p.mfaEnabled) "ok" else "amber")
                    }
                    Spacer(Modifier.height(6.dp))
                    KeyValue("Campus", p.campuses.joinToString { it.name })
                    p.department?.let { KeyValue("Department", it) }
                }
                SectionHeader("Module access")
                CcCard {
                    val a = p.access
                    listOf(
                        "SOS oversight (status only)" to a.sosOversight, "SOS dispatch & precise location" to (a.sosDispatch || a.liveLocations),
                        "Report oversight & assignment" to a.reportsOversight, "Confidential report content" to a.reportsSensitive,
                        "Counselling metrics" to a.counsellingAggregate, "Counselling records" to a.counsellingNotes,
                        "Student management" to a.studentManagement, "Security duty overview" to a.dutyView, "Duty overrides" to a.dutyManage,
                        "Analytics" to a.analytics, "Publish announcements" to a.announcements,
                    ).forEachIndexed { i, (label, granted) ->
                        if (i > 0) Divider()
                        Row(Modifier.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(label, style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink, modifier = Modifier.weight(1f))
                            CaChip(if (granted) "Granted" else "Not granted", if (granted) "ok" else "neutral")
                        }
                    }
                }
                Text("Permissions come from the server and can only be changed by a Super Admin.", style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint)
                SectionHeader("Settings")
                CcCard(padding = 8.dp) {
                    ListRow("Edit profile", subtitle = "Name, phone and photo", icon = Icons.Rounded.Edit, onClick = { nav.navigate(Routes.EditProfile) })
                    Divider()
                    ListRow("Notification preferences", icon = Icons.Rounded.Notifications, tone = Tone.Sky, onClick = { nav.navigate(Routes.NotificationPrefs) })
                    Divider()
                    ListRow("Privacy", icon = Icons.Rounded.PrivacyTip, tone = Tone.Violet, onClick = { nav.navigate(Routes.Privacy) })
                    Divider()
                    ListRow("Security & sessions", subtitle = "Password, 2-step verification, devices", icon = Icons.Rounded.Lock, tone = Tone.Teal, onClick = { nav.navigate(Routes.Security) })
                    Divider()
                    ListRow("Staff directory", subtitle = "Invite and manage campus staff", icon = Icons.Rounded.Groups, tone = Tone.Brand, onClick = { nav.navigate(Routes.AdminStaff) })
                }
                CaRestricted(p.campusSettings.note)
                SectionHeader("Help")
                CcCard(padding = 8.dp) {
                    ListRow("Help & support", subtitle = p.support.email ?: "Contact the Super Admin", icon = Icons.AutoMirrored.Rounded.Help, tone = Tone.Amber, chevron = false)
                    Divider()
                    ListRow("About", subtitle = "CampusCare College ${BuildConfig.VERSION_NAME} · ${app.config.settings.universityName}", icon = Icons.Rounded.Person, tone = Tone.Neutral, chevron = false)
                }
                CcButton("Sign out", { confirmOut = true }, kind = ButtonKind.Outline, leadingIcon = Icons.AutoMirrored.Rounded.Logout)
                Spacer(Modifier.height(16.dp))
            }
        }
    }
    if (confirmOut) ConfirmDialog("Sign out?", "You will need to sign in again to use CampusCare College.", "Sign out", onConfirm = { confirmOut = false; signOut() }, onDismiss = { confirmOut = false })
}

// ============================================================================ 13. More & Administration Hub
@Composable
fun CampusAdminMoreScreen() {
    val nav = LocalNav.current
    val api = rememberCampusAdminApi()
    val d = rememberLoad { api.dashboard() }
    CcScreen(
        title = "More",
        subtitle = "Operations, management and settings",
        refreshing = d.refreshing,
        onRefresh = { d.reload() },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            SectionHeader("Management & Operations")
            CcCard(padding = 8.dp) {
                ListRow(
                    "Student Management",
                    subtitle = "Student directory, identity verification, account status",
                    icon = Icons.Rounded.School,
                    tone = Tone.Brand,
                    onClick = { nav.navigate(Routes.CampusAdminStudents) },
                )
                Divider()
                ListRow(
                    "Committee Management",
                    subtitle = "Workload, case assignment, SLA and due dates",
                    icon = Icons.Rounded.Groups,
                    tone = Tone.Violet,
                    onClick = { nav.navigate(Routes.CampusAdminCommittees) },
                )
                Divider()
                ListRow(
                    "Live Campus Overview",
                    subtitle = "Interactive campus map, facility zones, responder locations",
                    icon = Icons.Rounded.Place,
                    tone = Tone.Teal,
                    onClick = { nav.navigate(Routes.CampusAdminMap) },
                )
                Divider()
                ListRow(
                    "Emergency SOS Oversight",
                    subtitle = "Alert logs, responder assignments, response timeline",
                    icon = Icons.Rounded.Warning,
                    tone = Tone.Danger,
                    onClick = { nav.navigate(Routes.CampusAdminSos) },
                )
            }

            SectionHeader("Insights & Communication")
            CcCard(padding = 8.dp) {
                ListRow(
                    "Reports & Analytics",
                    subtitle = "Cross-role performance trends, SLA compliance, volume metrics",
                    icon = Icons.Rounded.BarChart,
                    tone = Tone.Sky,
                    onClick = { nav.navigate(Routes.CampusAdminAnalytics) },
                )
                Divider()
                ListRow(
                    "Campus Announcements",
                    subtitle = "Official broadcasts, role-targeted notices, safety alerts",
                    icon = Icons.Rounded.Campaign,
                    tone = Tone.Amber,
                    onClick = { nav.navigate(Routes.CampusAdminAnnouncements) },
                )
                Divider()
                ListRow(
                    "Messages & Communication",
                    subtitle = "Direct, committee, and cross-departmental messaging channels",
                    icon = Icons.AutoMirrored.Rounded.Chat,
                    tone = Tone.Teal,
                    onClick = { nav.navigate(Routes.CampusAdminMessages) },
                )
            }

            SectionHeader("Administration & Settings")
            CcCard(padding = 8.dp) {
                ListRow(
                    "Profile & Settings",
                    subtitle = "Account credentials, authorized module access, campus scope",
                    icon = Icons.Rounded.Person,
                    tone = Tone.Neutral,
                    onClick = { nav.navigate(Routes.CampusAdminProfile) },
                )
                Divider()
                ListRow(
                    "Triage Queue",
                    subtitle = "Route incoming student reports to relevant committees",
                    icon = Icons.Rounded.Gavel,
                    tone = Tone.Violet,
                    onClick = { nav.navigate(Routes.AdminTriage) },
                )
                Divider()
                ListRow(
                    "Staff Directory",
                    subtitle = "Security officers, counsellors, and committee members",
                    icon = Icons.Rounded.Groups,
                    tone = Tone.Brand,
                    onClick = { nav.navigate(Routes.AdminStaff) },
                )
            }
            Spacer(Modifier.height(16.dp))
        }
    }
}
