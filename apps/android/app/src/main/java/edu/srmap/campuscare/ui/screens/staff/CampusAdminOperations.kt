package edu.srmap.campuscare.ui.screens.staff

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Assignment
import androidx.compose.material.icons.automirrored.rounded.Chat
import androidx.compose.material.icons.rounded.BarChart
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Campaign
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Gavel
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material.icons.rounded.HealthAndSafety
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.HourglassTop
import androidx.compose.material.icons.rounded.Map
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.Psychology
import androidx.compose.material.icons.rounded.School
import androidx.compose.material.icons.rounded.Security
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.Timer
import androidx.compose.material.icons.rounded.Verified
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.data.CaPerson
import edu.srmap.campuscare.data.CaReportRow
import edu.srmap.campuscare.data.CaSosRow
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.CcSelect
import edu.srmap.campuscare.ui.components.ChoiceChips
import edu.srmap.campuscare.ui.components.CountBadge
import edu.srmap.campuscare.ui.components.Divider
import edu.srmap.campuscare.ui.components.EmptyState
import edu.srmap.campuscare.ui.components.IconBadge
import edu.srmap.campuscare.ui.components.InfoBanner
import edu.srmap.campuscare.ui.components.KeyValue
import edu.srmap.campuscare.ui.components.LegendDot
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.MapPin
import edu.srmap.campuscare.ui.components.OsmMap
import edu.srmap.campuscare.ui.components.SectionHeader
import edu.srmap.campuscare.ui.components.SkeletonList
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.components.userMessage
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.Fmt
import androidx.compose.runtime.collectAsState
import edu.srmap.campuscare.ui.navigation.navigateTop
import java.time.LocalTime
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// ============================================================================ 1. Dashboard
@Composable
fun CampusAdminDashboardScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val api = rememberCampusAdminApi()
    val d = rememberLoad { api.dashboard() }
    LaunchedEffect(Unit) { app.realtime.events.collect { e -> if (e.name == "notification" || e.name == "case:updated" || e.name == "announcements:changed") d.reload() } }
    // Operational numbers refresh every minute while the dashboard is open.
    LaunchedEffect(Unit) { while (true) { delay(60_000); d.reload() } }
    val data = d.data
    val user by app.session.user.collectAsState()
    val role = user?.role ?: "admin"
    // Security, Counselling and Reports are bottom-bar tabs: switch to them the same way the bar does.
    val open: (String) -> Unit = { route ->
        if (route in setOf(Routes.CampusAdminSecurity, Routes.CampusAdminCounselling, Routes.CampusAdminReports)) navigateTop(nav, route, role) else nav.navigate(route)
    }
    CcScreen(
        title = data?.let { "${CampusAdminRules.greeting(LocalTime.now().hour)}, ${it.admin.name.substringBefore(' ')}" } ?: "Campus Admin",
        subtitle = data?.let { (listOf(it.admin.roleLabel) + it.campuses.map { c -> c.name }).joinToString(" · ") },
        refreshing = d.refreshing, onRefresh = { d.reload() },
        actions = {
            IconButton(onClick = { nav.navigate(Routes.Notifications) }) {
                Box {
                    Icon(Icons.Rounded.Notifications, contentDescription = "Notifications", tint = CcColors.Forest)
                    if ((data?.unreadNotifications ?: 0) > 0) CountBadge(data!!.unreadNotifications, Modifier.align(Alignment.TopEnd))
                }
            }
        },
    ) {
        LoadContent(d, skeleton = { SkeletonList(6) }) { x ->
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                CaChipRow {
                    if (x.admin.verified) StatusChip("Verified administrator", Tone.Brand, dot = true) else StatusChip("Identity not verified", Tone.Amber, dot = true)
                    StatusChip(if (x.health.database == "ok") "Services online" else "Service degraded", if (x.health.database == "ok") Tone.Teal else Tone.Danger, dot = true)
                }
                if (x.sos.unacknowledged > 0) {
                    InfoBanner("${x.sos.unacknowledged} SOS alert(s) are waiting for a Security responder. Security Officers receive SOS alerts directly.", tone = Tone.Danger, icon = Icons.Rounded.Warning)
                }
                SectionHeader("Emergency SOS · Security", action = "Open", onAction = { nav.navigate(Routes.CampusAdminSos) })
                CaMetricRow {
                    CaMetricCard("Active SOS", "${x.sos.active}", Modifier.weight(1f), Tone.Danger, Icons.Rounded.Warning, onClick = { nav.navigate(Routes.CampusAdminSos) })
                    CaMetricCard("Security on duty", "${x.security.onDuty}/${x.security.officers}", Modifier.weight(1f), Tone.Brand, Icons.Rounded.Security, onClick = { open(Routes.CampusAdminSecurity) })
                }
                SectionHeader("Formal reports · Committee", action = "Open", onAction = { open(Routes.CampusAdminReports) })
                CaMetricRow {
                    CaMetricCard("New reports", "${x.reports.new}", Modifier.weight(1f), Tone.Sky, Icons.AutoMirrored.Rounded.Assignment, onClick = { open(Routes.CampusAdminReports) })
                    CaMetricCard("Under review / in progress", "${x.reports.underReview + x.reports.inProgress}", Modifier.weight(1f), Tone.Violet, Icons.Rounded.Gavel, onClick = { nav.navigate(Routes.CampusAdminCommittees) })
                }
                CaMetricRow {
                    CaMetricCard("Overdue", "${x.reports.overdue}", Modifier.weight(1f), Tone.Rose, Icons.Rounded.Timer, onClick = { nav.navigate(Routes.CampusAdminCommittees) })
                    CaMetricCard("Awaiting assignment", "${x.reports.unassigned}", Modifier.weight(1f), Tone.Amber, Icons.Rounded.HourglassTop, onClick = { nav.navigate(Routes.CampusAdminCommittees) })
                }
                SectionHeader("Counselling", action = "Open", onAction = { open(Routes.CampusAdminCounselling) })
                CaMetricRow {
                    CaMetricCard("Sessions today", "${x.counselling.todaySessions}", Modifier.weight(1f), Tone.Teal, Icons.Rounded.CalendarMonth, onClick = { open(Routes.CampusAdminCounselling) })
                    CaMetricCard("Pending requests", "${x.counselling.pendingRequests}", Modifier.weight(1f), Tone.Amber, Icons.Rounded.Psychology, onClick = { open(Routes.CampusAdminCounselling) })
                }
                x.students?.let { s ->
                    SectionHeader("Students", action = "Open", onAction = { nav.navigate(Routes.CampusAdminStudents) })
                    CaMetricRow {
                        CaMetricCard("Students", "${s.total}", Modifier.weight(1f), Tone.Brand, Icons.Rounded.School, caption = "${s.active} active", onClick = { nav.navigate(Routes.CampusAdminStudents) })
                        CaMetricCard("Awaiting verification", "${s.awaitingVerification}", Modifier.weight(1f), Tone.Amber, Icons.Rounded.Verified, caption = "${s.suspended} suspended", onClick = { nav.navigate(Routes.CampusAdminStudents) })
                    }
                }
                SectionHeader("Quick access")
                val modules = listOf(
                    Triple("Live campus map", "Facilities and permitted live status", Icons.Rounded.Map) to Routes.CampusAdminMap,
                    Triple("Security", "Team, duty and patrols", Icons.Rounded.Shield) to Routes.CampusAdminSecurity,
                    Triple("Committees", "Workload and assignments", Icons.Rounded.Groups) to Routes.CampusAdminCommittees,
                    Triple("Analytics", "Trends and comparisons", Icons.Rounded.BarChart) to Routes.CampusAdminAnalytics,
                    Triple("Announcements", "Read and publish", Icons.Rounded.Campaign) to Routes.CampusAdminAnnouncements,
                    Triple("Messages", "Teams and colleagues", Icons.AutoMirrored.Rounded.Chat) to Routes.CampusAdminMessages,
                )
                val tones = listOf(Tone.Teal, Tone.Brand, Tone.Violet, Tone.Sky, Tone.Amber, Tone.Teal)
                modules.chunked(2).forEachIndexed { row, pair ->
                    CaMetricRow {
                        pair.forEachIndexed { i, (m, route) ->
                            CaModuleCard(m.first, m.second, m.third, tones[row * 2 + i], Modifier.weight(1f), onClick = { open(route) })
                        }
                    }
                }
                CcCard(padding = 8.dp) {
                    edu.srmap.campuscare.ui.components.ListRow("Triage queue", subtitle = "Route new reports to committees", icon = Icons.Rounded.Gavel, tone = Tone.Violet, onClick = { nav.navigate(Routes.AdminTriage) })
                    Divider()
                    edu.srmap.campuscare.ui.components.ListRow("Campus alerts", subtitle = "Broadcast notices and safety check-ins", icon = Icons.Rounded.Campaign, tone = Tone.Danger, onClick = { nav.navigate(Routes.AdminAlerts) })
                    Divider()
                    edu.srmap.campuscare.ui.components.ListRow("Moderation", subtitle = "Hazards, suggestions, lost & found", icon = Icons.Rounded.HealthAndSafety, tone = Tone.Teal, onClick = { nav.navigate(Routes.Moderation) })
                }
                if (x.announcements.isNotEmpty()) {
                    SectionHeader("Announcements", action = "All", onAction = { nav.navigate(Routes.CampusAdminAnnouncements) })
                    CcCard {
                        x.announcements.forEachIndexed { i, a ->
                            if (i > 0) Divider()
                            Column(Modifier.padding(vertical = 6.dp)) {
                                Text(a.title, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink, fontWeight = FontWeight.SemiBold)
                                Text("${Fmt.humanize(a.category)} · ${Fmt.ago(a.createdAt)}", style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint)
                            }
                        }
                    }
                }
                SectionHeader("Recent operational activity")
                if (x.activity.isEmpty()) {
                    CcCard { Text("No SOS or report activity yet on your campus.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft) }
                } else {
                    CcCard {
                        x.activity.forEachIndexed { i, a ->
                            if (i > 0) Divider()
                            Row(Modifier.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                                IconBadge(if (a.kind == "sos") Icons.Rounded.Warning else Icons.Rounded.History, if (a.kind == "sos") Tone.Danger else Tone.Violet, size = 30.dp, iconSize = 16.dp)
                                Spacer(Modifier.width(10.dp))
                                Text(a.label, style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink, modifier = Modifier.weight(1f))
                                Text(Fmt.ago(a.at), style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint)
                            }
                        }
                    }
                }
                Text("Updated ${Fmt.time(x.health.serverTime)} · platform settings stay with the Super Admin portal.", style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint)
                Spacer(Modifier.height(16.dp))
            }
        }
    }
}

// ============================================================================ 2. Live campus overview
@Composable
fun CampusAdminMapScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val api = rememberCampusAdminApi()
    var campus by rememberSaveable { mutableStateOf<String?>(null) }
    val m = rememberLoad(campus) { api.map(campus) }
    val places = rememberLoad(m.data?.campus) { m.data?.let { app.api.campusMap.data(it.campus) } }
    CcScreen(title = "Live campus overview", subtitle = "What your permissions allow you to see", onBack = { nav.popBackStack() }, refreshing = m.refreshing, onRefresh = { m.reload(); places.reload() }) {
        LoadContent(m, skeleton = { SkeletonList(3) }) { x ->
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (x.campuses.size > 1) ChoiceChips(x.campuses.map { it.id to it.name }, x.campus, onSelect = { campus = it })
                val mapData = places.data
                if (places.value is edu.srmap.campuscare.ui.components.Load.Err) {
                    InfoBanner("The campus map could not be loaded, so facilities are not shown. SOS numbers below are still live.", tone = Tone.Amber)
                }
                if (mapData != null) {
                    val pins = buildList {
                        mapData.buildings.forEach { b -> add(MapPin("b-${b.id}", b.latitude, b.longitude, b.name, Fmt.humanize(b.category), if (b.isEmergencyLocation) CcColors.Teal else CcColors.Forest)) }
                        x.sosMarkers?.forEach { s -> add(MapPin("s-${s.id}", s.latitude, s.longitude, "SOS ${s.reference}", CampusAdminRules.sosStatusLabel(s.status), CcColors.Sos, "SOS")) }
                        x.responders?.forEach { r -> add(MapPin("r-${r.id}", r.latitude, r.longitude, r.name, Fmt.humanize(r.status), CcColors.Sky)) }
                    }
                    CcCard(padding = 0.dp) {
                        OsmMap(mapData.center.latitude, mapData.center.longitude, mapData.center.zoom, pins, Modifier.fillMaxWidth().height(320.dp),
                            onPinClick = { p -> if (p.id.startsWith("s-")) nav.navigate(Routes.campusAdminSos(p.id.removePrefix("s-"))) })
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        LegendDot(CcColors.Forest, "Facilities")
                        LegendDot(CcColors.Teal, "Emergency points")
                        if (x.sosMarkers != null) LegendDot(CcColors.Sos, "Active SOS")
                        if (x.responders != null) LegendDot(CcColors.Sky, "Responders")
                    }
                }
                CaMetricRow {
                    CaMetricCard("Active SOS on this campus", "${x.activeSos}", Modifier.weight(1f), Tone.Danger, Icons.Rounded.Warning, onClick = { nav.navigate(Routes.CampusAdminSos) })
                    CaMetricCard("Facilities mapped", "${mapData?.buildings?.size ?: 0}", Modifier.weight(1f), Tone.Brand, Icons.Rounded.Map)
                }
                x.sosMarkersReason?.let { CaRestricted(it) }
                x.respondersReason?.let { CaRestricted(it) }
                if (x.activeByArea.isNotEmpty()) {
                    SectionHeader("Active SOS by area")
                    CcCard { CaBarList(x.activeByArea.map { it.area to it.count }, CcColors.Sos, threshold = 1) }
                }
                Spacer(Modifier.height(16.dp))
            }
        }
    }
}

// ============================================================================ 3. SOS oversight
@Composable
internal fun SosRowCard(s: CaSosRow, onClick: () -> Unit) {
    CcCard(onClick = onClick, padding = 12.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconBadge(Icons.Rounded.Warning, bucketTone(CampusAdminRules.sosSeverityBucket(s.status)), size = 36.dp, iconSize = 18.dp)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text("SOS ${s.reference}", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = CcColors.Ink)
                Text(listOfNotNull(s.area, Fmt.dateTime(s.createdAt)).joinToString(" · "), style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
            }
            CaChip(Fmt.humanize(s.severity), if (s.severity == "critical" || s.severity == "high") "danger" else "amber")
        }
        Spacer(Modifier.height(8.dp))
        CaChipRow {
            CaChip(CampusAdminRules.sosStatusLabel(s.status), CampusAdminRules.sosSeverityBucket(s.status))
            if (s.acknowledged) CaChip("Acknowledged ${Fmt.time(s.acknowledgedAt)}", "ok")
            if (s.escalationLevel > 0) CaChip("Escalated L${s.escalationLevel}", "danger")
        }
        s.responder?.let { Text("Responder: $it", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft, modifier = Modifier.padding(top = 6.dp)) }
    }
}

@Composable
fun CampusAdminSosScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val api = rememberCampusAdminApi()
    var tab by rememberSaveable { mutableStateOf("active") }
    var severity by rememberSaveable { mutableStateOf("all") }
    var query by rememberSaveable { mutableStateOf("") }
    val list = rememberLoad(Triple(tab, severity, query)) {
        if (query.isNotBlank()) delay(300)
        api.sos(tab, query, severity.takeIf { it != "all" })
    }
    LaunchedEffect(Unit) { app.realtime.events.collect { e -> if (e.name == "notification") list.reload() } }
    CcScreen(title = "SOS oversight", subtitle = "Security Officers respond; you see status", onBack = { nav.popBackStack() }, refreshing = list.refreshing, onRefresh = { list.reload() }) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            ChoiceChips(listOf("active" to "Active", "resolved" to "Resolved", "all" to "All"), tab, onSelect = { tab = it })
            ChoiceChips(listOf("all" to "Any severity", "critical" to "Critical", "high" to "High", "medium" to "Medium", "low" to "Low"), severity, onSelect = { severity = it })
            CaSearchBar(query, { query = it }, "Alert reference or area")
            LoadContent(list, skeleton = { SkeletonList(4) }) { x ->
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    CaMetricRow {
                        CaMetricCard("Active", "${x.metrics.active}", Modifier.weight(1f), Tone.Danger)
                        CaMetricCard("Unacknowledged", "${x.metrics.unacknowledged}", Modifier.weight(1f), Tone.Rose)
                        CaMetricCard("Avg. acknowledge (30d)", CampusAdminRules.duration(x.metrics.avgAcknowledgeSeconds), Modifier.weight(1f), Tone.Teal)
                    }
                    if (!x.canDispatch) CaRestricted("Acknowledging, assigning and resolving SOS alerts is done by Security. Your account has oversight only.")
                    if (x.items.isEmpty()) EmptyState(if (tab == "active") "No active SOS alerts" else "No alerts match", message = "Alerts on your campuses appear here.", icon = Icons.Rounded.CheckCircle)
                    x.items.forEach { s -> SosRowCard(s) { nav.navigate(Routes.campusAdminSos(s.id)) } }
                }
            }
        }
    }
}

@Composable
fun CampusAdminSosDetailScreen(id: String) {
    val nav = LocalNav.current
    val api = rememberCampusAdminApi()
    val d = rememberLoad(id) { api.sosDetail(id) }
    CcScreen(title = d.data?.let { "SOS ${it.reference}" } ?: "SOS alert", onBack = { nav.popBackStack() }, refreshing = d.refreshing, onRefresh = { d.reload() }) {
        LoadContent(d, skeleton = { SkeletonList(3) }) { x ->
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                CaChipRow {
                    CaChip(CampusAdminRules.sosStatusLabel(x.status), CampusAdminRules.sosSeverityBucket(x.status))
                    CaChip(Fmt.humanize(x.severity), if (x.severity == "critical" || x.severity == "high") "danger" else "amber")
                }
                CcCard {
                    KeyValue("Raised", Fmt.dateTime(x.createdAt))
                    KeyValue("Campus", x.campus)
                    KeyValue("Area", x.area ?: "Not shared")
                    KeyValue("Acknowledged", if (x.acknowledged) Fmt.dateTime(x.acknowledgedAt) else "Not yet")
                    KeyValue("Assignment", Fmt.humanize(x.assignmentState))
                    KeyValue("Responder", x.responder ?: "None yet")
                    if (x.escalationLevel > 0) KeyValue("Escalation", "Level ${x.escalationLevel}")
                    x.resolvedAt?.let { KeyValue("Resolved", Fmt.dateTime(it)) }
                    x.outcome?.let { KeyValue("Outcome", Fmt.humanize(it)) }
                }
                if (x.latitude != null && x.longitude != null) {
                    CcCard(padding = 0.dp) {
                        OsmMap(x.latitude, x.longitude, 17.0, listOf(MapPin(x.id, x.latitude, x.longitude, "SOS ${x.reference}", null, CcColors.Sos, "SOS")), Modifier.fillMaxWidth().height(220.dp))
                    }
                }
                x.restricted?.let { CaRestricted(it) }
                SectionHeader("Response timeline")
                CcCard { if (x.timeline.isEmpty()) Text("No events recorded yet.", color = CcColors.InkSoft) else CaTimeline(x.timeline) }
                Spacer(Modifier.height(16.dp))
            }
        }
    }
}

// ============================================================================ 4. Formal-report oversight
@Composable
internal fun ReportRowCard(r: CaReportRow, canAssign: Boolean, onOpen: () -> Unit, onAssign: () -> Unit) {
    CcCard(onClick = onOpen, padding = 12.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconBadge(Icons.AutoMirrored.Rounded.Assignment, Tone.Violet, size = 36.dp, iconSize = 18.dp)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(r.reference, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = CcColors.Ink)
                Text("${Fmt.humanize(r.category)} · ${r.committee ?: "Not yet routed"}", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
            }
            CaChip(r.statusLabel.ifBlank { Fmt.humanize(r.status) }, CampusAdminRules.reportBucket(r.group, r.overdue))
        }
        if (r.overdue || r.urgent || r.confidential) {
            Spacer(Modifier.height(6.dp))
            CaChipRow {
                if (r.overdue) CaChip("Overdue", "danger")
                if (r.urgent) CaChip("Urgent", "amber")
                if (r.confidential) CaChip("Confidential", "neutral")
            }
        }
        Spacer(Modifier.height(6.dp))
        Text(
            (if (r.assigned) "Owner: ${r.handler}" else "Unassigned") + (r.dueResolveAt?.let { " · due ${Fmt.date(it)}" } ?: ""),
            style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint,
        )
        if (canAssign && !r.assigned && r.committeeId != null && r.group != "resolved" && r.group != "closed") {
            Spacer(Modifier.height(6.dp))
            CcButton("Assign owner", onAssign, kind = ButtonKind.Soft)
        }
    }
}

/** Picks a member of the report's committee and assigns them through the existing (audited) case endpoint. */
@Composable
internal fun AssignReportDialog(report: CaReportRow, onDone: (Boolean) -> Unit) {
    val api = rememberCampusAdminApi()
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val staff = rememberLoad(report.id) { api.assignableStaff(report.id) }
    var pick by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    androidx.compose.material3.AlertDialog(
        onDismissRequest = { if (!busy) onDone(false) },
        containerColor = androidx.compose.ui.graphics.Color.White,
        title = { Text("Assign ${report.reference}") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Choose a member of ${report.committee ?: "the committee"}. The assignment is recorded in the case history and audit log.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                val people: List<CaPerson> = staff.data.orEmpty()
                if (staff.data != null && people.isEmpty()) Text("This committee has no active members.", color = CcColors.Sos)
                if (people.isNotEmpty()) CcSelect("Committee member", people.map { it.id to it.name }, pick, onSelect = { pick = it })
            }
        },
        confirmButton = {
            CcButton("Assign", {
                val who = pick ?: return@CcButton
                busy = true
                scope.launch {
                    runCatching { api.assign(report.id, report.committeeId!!, who, "Assigned from the Campus Admin portal") }
                        .onSuccess { snack.show("Assigned"); onDone(true) }
                        .onFailure { snack.show(it.userMessage()); busy = false }
                }
            }, enabled = pick != null && !busy, loading = busy)
        },
        dismissButton = { CcButton("Cancel", { onDone(false) }, kind = ButtonKind.Ghost, enabled = !busy) },
    )
}

@Composable
fun CampusAdminReportsScreen() {
    val nav = LocalNav.current
    val api = rememberCampusAdminApi()
    var tab by rememberSaveable { mutableStateOf("open") }
    var category by rememberSaveable { mutableStateOf("all") }
    var sort by rememberSaveable { mutableStateOf("newest") }
    var query by rememberSaveable { mutableStateOf("") }
    var assigning by remember { mutableStateOf<CaReportRow?>(null) }
    val list = rememberLoad(listOf(tab, category, sort, query)) {
        if (query.isNotBlank()) delay(300)
        api.reports(tab, category.takeIf { it != "all" }, query, sort)
    }
    CcScreen(title = "Formal reports", subtitle = "Handled by Committees · metadata only", refreshing = list.refreshing, onRefresh = { list.reload() }) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            ChoiceChips(CampusAdminRules.REPORT_TABS, tab, onSelect = { tab = it })
            CaSearchBar(query, { query = it }, "Case number")
            LoadContent(list, skeleton = { SkeletonList(4) }) { x ->
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        CcSelect("Category", listOf("all" to "All categories") + x.categories.map { it.category to Fmt.humanize(it.category) }, category, onSelect = { category = it }, modifier = Modifier.weight(1f))
                        CcSelect("Sort", listOf("newest" to "Newest", "oldest" to "Oldest", "due" to "Due soonest"), sort, onSelect = { sort = it }, modifier = Modifier.weight(1f))
                    }
                    CaMetricRow {
                        CaMetricCard("Open", "${x.metrics.open}", Modifier.weight(1f), Tone.Violet)
                        CaMetricCard("Overdue", "${x.metrics.overdue}", Modifier.weight(1f), Tone.Rose)
                        CaMetricCard("Resolution rate", x.metrics.resolutionRate?.let { "$it%" } ?: "—", Modifier.weight(1f), Tone.Brand)
                    }
                    Text("Average resolution (30d): ${x.metrics.avgResolutionDays?.let { "$it days" } ?: "—"} · ${x.metrics.created} new, ${x.metrics.resolvedInRange} resolved", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
                    if (!x.canReadSensitive) CaRestricted("Report descriptions, evidence and investigation notes stay in the Committee workflow. Opening a report shows only what your permissions allow.")
                    if (x.items.isEmpty()) EmptyState("No reports here", message = "Reports from your campuses appear here as committees work on them.", icon = Icons.Rounded.CheckCircle)
                    x.items.forEach { r -> ReportRowCard(r, x.canAssign, onOpen = { nav.navigate(Routes.case(r.id)) }, onAssign = { assigning = r }) }
                    if (x.total > x.items.size) Text("Showing ${x.items.size} of ${x.total}. Narrow the filters to see others.", style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint)
                }
            }
        }
    }
    assigning?.let { r -> AssignReportDialog(r) { changed -> assigning = null; if (changed) list.reload() } }
}

// ============================================================================ 5. Counselling overview
@Composable
fun CampusAdminCounsellingScreen() {
    val nav = LocalNav.current
    val api = rememberCampusAdminApi()
    var range by rememberSaveable { mutableStateOf(30) }
    val d = rememberLoad(range) { api.counselling(range) }
    CcScreen(title = "Counselling overview", subtitle = "Capacity and appointments · no private records", refreshing = d.refreshing, onRefresh = { d.reload() }) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            ChoiceChips(CampusAdminRules.RANGES.map { "${it.first}" to it.second }, "$range", onSelect = { range = it.toInt() })
            LoadContent(d, skeleton = { SkeletonList(4) }) { x ->
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    CaRestricted(x.privacy)
                    CaMetricRow {
                        CaMetricCard("Sessions today", "${x.metrics.todaySessions}", Modifier.weight(1f), Tone.Teal, Icons.Rounded.CalendarMonth)
                        CaMetricCard("Pending requests", "${x.metrics.pendingRequests}", Modifier.weight(1f), Tone.Amber, Icons.Rounded.HourglassTop)
                    }
                    CaMetricRow {
                        CaMetricCard("Upcoming", "${x.metrics.upcoming}", Modifier.weight(1f), Tone.Sky)
                        CaMetricCard("Completed (${range}d)", "${x.metrics.completed}", Modifier.weight(1f), Tone.Brand, caption = x.metrics.completionRate?.let { "$it% completion" })
                    }
                    SectionHeader("Capacity today")
                    CcCard {
                        Text("${x.capacity.bookedToday} of ${x.capacity.today} slots booked · ${x.capacity.available} available", style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink)
                        Spacer(Modifier.height(8.dp))
                        CaProgress(x.capacity.bookedToday, x.capacity.today, CcColors.Teal)
                    }
                    SectionHeader("Follow-up plans")
                    CaMetricRow {
                        CaMetricCard("In follow-up", "${x.followUps.active}", Modifier.weight(1f), Tone.Violet)
                        CaMetricCard("Open cases", "${x.followUps.openCases}", Modifier.weight(1f), Tone.Sky)
                        CaMetricCard("Closed", "${x.followUps.closed}", Modifier.weight(1f), Tone.Brand)
                    }
                    SectionHeader("Counsellor availability & workload")
                    if (x.counsellors.isEmpty()) EmptyState("No counsellors on your campuses", icon = Icons.Rounded.Psychology)
                    x.counsellors.forEach { c ->
                        CcCard(padding = 12.dp) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(c.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = CcColors.Ink)
                                    Text(c.designation, style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
                                }
                                CaChip(if (!c.accepting) "Not accepting" else if (c.worksToday) "Available today" else "Off today", if (!c.accepting) "neutral" else if (c.worksToday) "ok" else "amber")
                            }
                            Spacer(Modifier.height(6.dp))
                            Text("Today ${c.today}/${c.dailyCapacity} · this week ${c.week} · ${c.pendingRequests} pending", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
                            if (c.utilisation != null) { Spacer(Modifier.height(6.dp)); CaProgress(c.today, c.dailyCapacity, CcColors.Teal) }
                        }
                    }
                    SectionHeader("Upcoming sessions")
                    if (x.upcoming.isEmpty()) Text("No upcoming sessions.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                    else CcCard {
                        x.upcoming.forEachIndexed { i, s ->
                            if (i > 0) Divider()
                            Row(Modifier.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(Fmt.dateTime(s.startAt), style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink)
                                    Text("${s.counsellor} · ${Fmt.humanize(s.mode)}", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
                                }
                                CaChip(Fmt.humanize(s.status), "sky")
                            }
                        }
                    }
                    if (!x.canManageSchedules) Text("Schedules are managed by each counsellor; this view is read-only.", style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint)
                    Spacer(Modifier.height(16.dp))
                }
            }
        }
    }
}
