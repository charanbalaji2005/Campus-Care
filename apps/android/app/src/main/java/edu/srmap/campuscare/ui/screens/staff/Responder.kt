package edu.srmap.campuscare.ui.screens.staff

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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.DirectionsRun
import androidx.compose.material.icons.automirrored.rounded.DirectionsWalk
import androidx.compose.material.icons.automirrored.rounded.NoteAdd
import androidx.compose.material.icons.rounded.Call
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.HealthAndSafety
import androidx.compose.material.icons.rounded.LocationOff
import androidx.compose.material.icons.rounded.MyLocation
import androidx.compose.material.icons.rounded.Navigation
import androidx.compose.material.icons.rounded.PersonAdd
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.automirrored.rounded.TrendingUp
import androidx.compose.material.icons.rounded.Visibility
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.SosAlert
import edu.srmap.campuscare.services.ResponderDutyService
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.Catalog
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.CcSelect
import edu.srmap.campuscare.ui.components.CcTextField
import edu.srmap.campuscare.ui.components.ChoiceChips
import edu.srmap.campuscare.ui.components.Divider
import edu.srmap.campuscare.ui.components.EmptyState
import edu.srmap.campuscare.ui.components.IconBadge
import edu.srmap.campuscare.ui.components.InfoBanner
import edu.srmap.campuscare.ui.components.InputDialog
import edu.srmap.campuscare.ui.components.KeyValue
import edu.srmap.campuscare.ui.components.LegendDot
import edu.srmap.campuscare.ui.components.ListRow
import edu.srmap.campuscare.ui.components.LiveDot
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.MapPin
import edu.srmap.campuscare.ui.components.OsmMap
import edu.srmap.campuscare.ui.components.ScreenHeader
import edu.srmap.campuscare.ui.components.SectionHeader
import edu.srmap.campuscare.ui.components.SkeletonList
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.SwitchRow
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.enterStagger
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.components.rememberPulse
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.Fmt
import edu.srmap.campuscare.util.dial
import edu.srmap.campuscare.util.openUrl
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val OPEN_SOS = setOf("queued", "sending", "sent", "acknowledged", "en_route", "failed")

private fun elapsed(iso: String?, nowMs: Long): String {
    val start = Fmt.parse(iso) ?: return "—"
    val secs = ((nowMs - start.toEpochMilli()) / 1000).coerceAtLeast(0)
    return if (secs >= 3600) "${secs / 3600}h ${(secs % 3600) / 60}m" else "${secs / 60}m ${secs % 60}s"
}

/** Responder mobile view: live SOS queue with on-duty switch. */
@Composable
fun ResponderAlertsScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val context = LocalContext.current
    val live by app.realtime.connected.collectAsState()
    var showAll by rememberSaveable { mutableStateOf(false) }
    val alerts = rememberLoad(showAll) { app.api.safety.responderAlerts(all = showAll) }
    val walks = rememberLoad { runCatching { app.api.safety.overdueWalks() }.getOrDefault(emptyList()) }
    var onDuty by remember { mutableStateOf(ResponderDutyService.isOnDuty(context)) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    DisposableEffect(Unit) {
        app.realtime.subscribe("responders:all")
        onDispose { if (!ResponderDutyService.isOnDuty(context)) app.realtime.unsubscribe("responders:all") }
    }
    LaunchedEffect(Unit) { app.realtime.events.collect { e -> if (e.name == "sos:new" || e.name == "sos:updated") { alerts.reload(); walks.reload() } } }
    LaunchedEffect(Unit) { while (true) { delay(1_000); now = System.currentTimeMillis() } }
    LaunchedEffect(live) { while (!live) { delay(10_000); alerts.reload() } }

    CcScreen(
        title = "SOS alerts", subtitle = "Campus Security responder",
        refreshing = alerts.refreshing, onRefresh = { alerts.reload(); walks.reload() },
        actions = { LiveDot(live, Modifier.padding(end = 12.dp)) },
    ) {
        CcCard(color = if (onDuty) CcColors.Mint50 else CcColors.AmberSoft) {
            SwitchRow(
                if (onDuty) "On duty — receiving alerts" else "Off duty", onDuty,
                { on -> onDuty = on; if (on) ResponderDutyService.start(context) else ResponderDutyService.stop(context) },
                description = "While on duty, new SOS alerts ring through even when the app is closed.",
            )
        }
        ChoiceChips(listOf("open" to "Active", "all" to "Recent (24h)"), if (showAll) "all" else "open", { showAll = it == "all" })
        LoadContent(alerts, skeleton = { SkeletonList(3) }) { list ->
            val shown = if (showAll) list else list.filter { it.status in OPEN_SOS }
            if (shown.isEmpty()) EmptyState("No active alerts", message = "New SOS alerts appear here instantly.", icon = Icons.Rounded.Shield)
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                shown.sortedWith(compareBy<SosAlert> { if (it.status in setOf("sent", "queued", "sending", "failed")) 0 else 1 }.thenByDescending { it.createdAt }).forEachIndexed { i, a ->
                    AlertRow(a, now, Modifier.enterStagger(i)) { nav.navigate(Routes.responderAlert(a.id)) }
                }
            }
        }
        walks.data?.takeIf { it.isNotEmpty() }?.let { list ->
            SectionHeader("Overdue Safe Walks")
            CcCard(padding = 8.dp) {
                list.forEachIndexed { i, w ->
                    if (i > 0) Divider()
                    ListRow(
                        w.student ?: "Student", subtitle = "To ${w.destination} · expected ${Fmt.time(w.expectedArrivalAt)} · ${Fmt.humanize(w.status)}",
                        icon = Icons.AutoMirrored.Rounded.DirectionsWalk, tone = Tone.Rose,
                        trailing = { w.phone?.let { p -> TextButton(onClick = { context.dial(p) }) { Text("Call") } } },
                    )
                }
            }
        }
    }
}

@Composable
private fun AlertRow(a: SosAlert, now: Long, modifier: Modifier, onClick: () -> Unit) {
    val unacked = a.status in setOf("sent", "queued", "sending", "failed")
    val pulse = if (unacked) rememberPulse(0.8f, 1.2f, 800) else 1f
    CcCard(modifier, onClick = onClick, color = if (unacked) CcColors.SosSoft else Color.White) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(46.dp), contentAlignment = Alignment.Center) {
                Box(Modifier.size(40.dp).scale(pulse).clip(CircleShape).background(Catalog.sosTone(a.status).fg.copy(alpha = 0.2f)))
                IconBadge(Icons.Rounded.Warning, Catalog.sosTone(a.status), size = 34.dp, iconSize = 18.dp)
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(a.student?.fullName ?: "Student", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                Text("${a.alertNumber} · ${a.student?.hostel ?: "Location ${if (a.locationAvailable) "shared" else "unknown"}"}", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(elapsed(a.createdAt, now), style = MaterialTheme.typography.titleSmall, color = if (unacked) CcColors.Sos else CcColors.Ink, fontWeight = FontWeight.Bold)
                Text("ago", style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint)
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 8.dp)) {
            StatusChip(Catalog.sosLabels[a.status] ?: a.status, Catalog.sosTone(a.status), dot = true)
            if (a.escalationLevel > 0) StatusChip("Escalated L${a.escalationLevel}", Tone.Amber)
            if (a.assignedToMe) StatusChip("Assigned to you", Tone.Sky)
        }
    }
}

@Composable
fun ResponderAlertScreen(id: String) {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val alert = rememberLoad(id) { app.api.safety.responderAlert(id) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var busy by remember { mutableStateOf<String?>(null) }
    var noteOpen by remember { mutableStateOf(false) }
    var resolveOpen by remember { mutableStateOf(false) }
    var assignOpen by remember { mutableStateOf(false) }
    DisposableEffect(id) {
        app.realtime.subscribe("sos:$id")
        onDispose { app.realtime.unsubscribe("sos:$id") }
    }
    LaunchedEffect(id) { app.realtime.events.collect { e -> if ((e.name == "sos:updated" || e.name == "sos:location") && e.payload.optString("id") == id) alert.reload() } }
    LaunchedEffect(Unit) { while (true) { delay(1_000); now = System.currentTimeMillis() } }

    fun act(name: String, block: suspend () -> SosAlert) {
        scope.launch {
            busy = name
            try {
                alert.set(block())
            } catch (e: ApiException) {
                snack.error(e)
            } finally {
                busy = null
            }
        }
    }

    Column(Modifier.fillMaxSize().background(CcColors.Cream)) {
        ScreenHeader(alert.data?.alertNumber ?: "SOS", subtitle = alert.data?.let { "Raised ${elapsed(it.createdAt, now)} ago" }, onBack = { nav.popBackStack() })
        LoadContent(alert, modifier = Modifier.weight(1f)) { a ->
            CcScreenBody {
                CcCard(color = Catalog.sosTone(a.status).bg.copy(alpha = 0.6f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(Catalog.sosLabels[a.status] ?: a.status, style = MaterialTheme.typography.titleLarge, color = CcColors.Ink)
                            a.acknowledgedByName?.let { Text("Acknowledged by $it", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft) }
                        }
                        Text(elapsed(a.createdAt, now), fontSize = 26.sp, fontWeight = FontWeight.Black, color = if (a.acknowledgedAt == null) CcColors.Sos else CcColors.Forest)
                    }
                    if (a.status == "cancelled") InfoBanner("The student cancelled this alert (marked themselves safe). Confirm before standing down.", tone = Tone.Amber, icon = Icons.Rounded.Warning, modifier = Modifier.padding(top = 8.dp))
                }

                // Student
                CcCard {
                    KeyValue("Student", a.student?.fullName)
                    KeyValue("Student ID", a.student?.studentId)
                    KeyValue("Hostel", a.student?.hostel)
                    a.student?.phone?.let { p -> CcButton("Call $p", { context.dial(p) }, Modifier.fillMaxWidth().padding(top = 6.dp), kind = ButtonKind.Danger, leadingIcon = Icons.Rounded.Call) }
                }

                // Location
                if (a.locationAvailable && a.latitude != null && a.longitude != null) {
                    CcCard(padding = 0.dp) {
                        OsmMap(
                            a.latitude, a.longitude, 17.5,
                            pins = listOf(MapPin(a.id, a.latitude, a.longitude, a.student?.fullName ?: "SOS", "±${a.accuracyMeters?.toInt() ?: "?"} m", CcColors.Sos, "SOS")),
                            circles = a.accuracyMeters?.let { listOf(edu.srmap.campuscare.ui.components.AccuracyCircle(a.latitude, a.longitude, it, CcColors.Sos)) } ?: emptyList(),
                            modifier = Modifier.fillMaxWidth().height(220.dp), showMyLocation = true,
                        )
                        // Measured position with its uncertainty and age — the student may be anywhere inside the circle.
                        val q = a.locationQuality?.let { runCatching { edu.srmap.campuscare.util.LocationQuality.valueOf(it.replaceFirstChar { c -> c.uppercase() }) }.getOrNull() }
                        Text(
                            "${edu.srmap.campuscare.util.LocationQualityRules.formatCoordinates(a.latitude, a.longitude, a.accuracyMeters)} · ±${a.accuracyMeters?.toInt() ?: "?"} m" +
                                (q?.let { " · ${it.label}" } ?: "") + (a.locationAt?.let { " · captured ${Fmt.ago(it)}" } ?: "") +
                                if (a.locationUpdateCount > 1) " · live (${a.locationUpdateCount} updates)" else "",
                            style = MaterialTheme.typography.labelMedium,
                            color = if (q == edu.srmap.campuscare.util.LocationQuality.Stale || q == edu.srmap.campuscare.util.LocationQuality.Poor) CcColors.Sos else CcColors.InkSoft,
                            modifier = Modifier.padding(start = 12.dp, end = 12.dp, top = 10.dp),
                        )
                        Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            // geo: URI opens whichever maps app the responder has (OsmAnd, Organic Maps, Google Maps…).
                            CcButton("Navigate", { context.openUrl("geo:${a.latitude},${a.longitude}?q=${a.latitude},${a.longitude}(SOS)") }, Modifier.weight(1f), kind = ButtonKind.Primary, leadingIcon = Icons.Rounded.Navigation)
                        }
                    }
                } else {
                    InfoBanner("Location unavailable (${a.locationUnavailableReason?.let { Fmt.humanize(it) } ?: "not shared"}). Call the student.", tone = Tone.Amber, icon = Icons.Rounded.LocationOff)
                }

                // Actions
                if (a.status in OPEN_SOS) {
                    if (a.acknowledgedAt == null) {
                        CcButton("Acknowledge", { act("ack") { app.api.safety.acknowledge(id) } }, Modifier.fillMaxWidth().height(60.dp), kind = ButtonKind.Danger, loading = busy == "ack", leadingIcon = Icons.Rounded.CheckCircle)
                    } else if (a.enRouteAt == null) {
                        CcButton("I'm on my way", { act("route") { app.api.safety.enRoute(id) } }, Modifier.fillMaxWidth().height(56.dp), kind = ButtonKind.Brand, loading = busy == "route", leadingIcon = Icons.AutoMirrored.Rounded.DirectionsRun)
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        CcButton("Add note", { noteOpen = true }, Modifier.weight(1f), kind = ButtonKind.Soft, leadingIcon = Icons.AutoMirrored.Rounded.NoteAdd)
                        CcButton("Assign", { assignOpen = true }, Modifier.weight(1f), kind = ButtonKind.Soft, leadingIcon = Icons.Rounded.PersonAdd)
                    }
                    CcButton("Resolve", { resolveOpen = true }, Modifier.fillMaxWidth(), kind = ButtonKind.Outline, leadingIcon = Icons.Rounded.CheckCircle)
                }
                if (a.status == "cancelled" && a.resolvedAt == null) {
                    CcButton("Confirm student is safe & close", { resolveOpen = true }, Modifier.fillMaxWidth(), kind = ButtonKind.Outline)
                }

                // Safety card (consented, only during the SOS)
                a.safetyCard?.let { c ->
                    SectionHeader("Safety card (shared by the student)")
                    CcCard(color = CcColors.RoseSoft.copy(alpha = 0.4f)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            IconBadge(Icons.Rounded.HealthAndSafety, Tone.Rose, size = 36.dp, iconSize = 18.dp)
                            Spacer(Modifier.width(8.dp))
                            Text("Your access to this card is logged and visible to the student.", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft, modifier = Modifier.weight(1f))
                            androidx.compose.material3.Icon(Icons.Rounded.Visibility, contentDescription = null, tint = CcColors.InkFaint)
                        }
                        KeyValue("Blood group", c.bloodGroup.takeIf { it != "unknown" })
                        KeyValue("Allergies", c.allergies)
                        KeyValue("Medical conditions", c.medicalConditions)
                        KeyValue("Medications", c.medications)
                        KeyValue("Accessibility needs", c.accessibilityNeeds)
                        KeyValue("Note", c.emergencyNote)
                    }
                }

                if (a.escalationLevel > 0) InfoBanner("Escalated to level ${a.escalationLevel} because it wasn't acknowledged in time.", tone = Tone.Amber, icon = Icons.AutoMirrored.Rounded.TrendingUp)

                SectionHeader("Timeline")
                CcCard {
                    a.timeline.asReversed().forEachIndexed { i, t ->
                        if (i > 0) Divider()
                        Row(Modifier.padding(vertical = 6.dp)) {
                            Column(Modifier.weight(1f)) {
                                Text(Fmt.humanize(t.type), style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                                listOfNotNull(t.actorLabel, t.note).joinToString(" · ").takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft) }
                            }
                            Text(Fmt.time(t.at), style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint)
                        }
                    }
                }
                if (a.deliveries.isNotEmpty()) {
                    SectionHeader("Delivery")
                    CcCard {
                        a.deliveries.forEach { d ->
                            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 3.dp)) {
                                LegendDot(if (d.outcome == "delivered" || d.outcome == "sent") CcColors.Emerald else CcColors.Sos, "${Fmt.humanize(d.channel)} → ${d.recipient ?: "responders"}: ${Fmt.humanize(d.outcome)}")
                            }
                        }
                    }
                }
            }
            if (noteOpen) {
                InputDialog("Add note", null, label = "Note (visible to responders)", confirmLabel = "Add", onDismiss = { noteOpen = false },
                    onConfirm = { n -> noteOpen = false; act("note") { app.api.safety.addSosNote(id, n.trim()) } })
            }
            if (resolveOpen) ResolveDialog(onDismiss = { resolveOpen = false }) { outcome, note -> resolveOpen = false; act("resolve") { app.api.safety.resolveSos(id, outcome, note) } }
            if (assignOpen) AssignResponderDialog(onDismiss = { assignOpen = false }) { uid -> assignOpen = false; act("assign") { app.api.safety.assignSos(id, uid) } }
        }
    }
}

/** Scrollable body for screens that draw their own header. */
@Composable
private fun CcScreenBody(content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) =
    edu.srmap.campuscare.ui.components.ScrollPane(content = content)

@Composable
private fun ResolveDialog(onDismiss: () -> Unit, onResolve: (String, String?) -> Unit) {
    var outcome by remember { mutableStateOf<String?>("assisted") }
    var note by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Color.White,
        title = { Text("Resolve alert") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                CcSelect(
                    "Outcome",
                    listOf("assisted" to "Student assisted", "false_alarm" to "False alarm", "referred" to "Referred (medical / police)", "unable_to_locate" to "Unable to locate", "other" to "Other"),
                    outcome, { outcome = it },
                )
                CcTextField(note, { note = it }, label = "Resolution note", singleLine = false, minLines = 2, maxLength = 1000)
            }
        },
        confirmButton = { CcButton("Resolve", { onResolve(outcome ?: "other", note.trim().ifBlank { null }) }) },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun AssignResponderDialog(onDismiss: () -> Unit, onAssign: (String) -> Unit) {
    val app = LocalApp.current
    val team = rememberLoad { app.api.safety.responderTeam() }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Color.White,
        title = { Text("Assign responder") },
        text = {
            LoadContent(team, skeleton = { SkeletonList(2) }) { list ->
                Column {
                    if (list.isEmpty()) Text("No other responders available.")
                    list.forEach { m -> ListRow(m.name, subtitle = m.phone, icon = Icons.Rounded.PersonAdd, onClick = { onAssign(m.id) }) }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Close") } },
    )
}

/** Live map for responders: active SOS locations, consented live shares and overdue Safe Walks. */
@Composable
fun ResponderLocationsScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val context = LocalContext.current
    val config by app.config.config.collectAsState()
    val alerts = rememberLoad { app.api.safety.responderAlerts() }
    val shares = rememberLoad { app.api.safety.sharedLocations() }
    LaunchedEffect(Unit) {
        app.realtime.events.collect { e ->
            when (e.name) {
                "sos:new", "sos:updated", "sos:location" -> alerts.reload()
                "location:update" -> shares.reload()
            }
        }
    }
    LaunchedEffect(Unit) { while (true) { delay(20_000); shares.reload() } }
    val m = config.settings.map
    val activeSos = alerts.data.orEmpty().filter { it.status in OPEN_SOS && it.latitude != null && it.longitude != null }
    val live = shares.data.orEmpty().filter { it.latitude != null && it.longitude != null }
    val pins = activeSos.map { MapPin("s:${it.id}", it.latitude ?: 0.0, it.longitude ?: 0.0, it.student?.fullName ?: "SOS", it.alertNumber, CcColors.Sos, "SOS") } +
        live.map { MapPin("l:${it.id}", it.latitude ?: 0.0, it.longitude ?: 0.0, it.student ?: "Student", "Live · ${Fmt.ago(it.updatedAt)}", CcColors.Sky, "L") }

    Column(Modifier.fillMaxSize().background(CcColors.Cream)) {
        ScreenHeader("Live map", subtitle = "${activeSos.size} SOS · ${live.size} sharing location")
        Box(Modifier.weight(1f)) {
            OsmMap(
                m.centerLatitude, m.centerLongitude, m.zoom, pins, Modifier.fillMaxSize(), showMyLocation = true,
                circles = activeSos.mapNotNull { a -> a.accuracyMeters?.let { edu.srmap.campuscare.ui.components.AccuracyCircle(a.latitude ?: 0.0, a.longitude ?: 0.0, it, CcColors.Sos) } } +
                    live.mapNotNull { l -> l.accuracyMeters?.let { edu.srmap.campuscare.ui.components.AccuracyCircle(l.latitude ?: 0.0, l.longitude ?: 0.0, it, CcColors.Sky) } },
                onPinClick = { p -> if (p.id.startsWith("s:")) nav.navigate(Routes.responderAlert(p.id.removePrefix("s:"))) },
            )
            Column(
                Modifier.align(Alignment.TopEnd).padding(10.dp).clip(androidx.compose.foundation.shape.RoundedCornerShape(12.dp)).background(Color.White.copy(alpha = 0.92f)).padding(10.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                LegendDot(CcColors.Sos, "Active SOS")
                LegendDot(CcColors.Sky, "Live location (consented)")
            }
        }
        if (live.isNotEmpty()) {
            Column(Modifier.background(Color.White).padding(horizontal = 12.dp, vertical = 6.dp)) {
                live.take(3).forEach { s ->
                    ListRow(
                        s.student ?: "Student", subtitle = "Updated ${Fmt.ago(s.updatedAt)} · until ${Fmt.time(s.expiresAt)}",
                        icon = Icons.Rounded.MyLocation, tone = Tone.Sky,
                        trailing = { s.phone?.let { p -> TextButton(onClick = { context.dial(p) }) { Text("Call") } } },
                    )
                }
            }
        }
    }
}
