package edu.srmap.campuscare.ui.screens.student

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.automirrored.rounded.DirectionsWalk
import androidx.compose.material.icons.automirrored.rounded.HelpOutline
import androidx.compose.material.icons.rounded.Campaign
import androidx.compose.material.icons.rounded.Contacts
import androidx.compose.material.icons.rounded.EmojiObjects
import androidx.compose.material.icons.rounded.Event
import androidx.compose.material.icons.rounded.Forum
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material.icons.rounded.Inventory2
import androidx.compose.material.icons.rounded.Map
import androidx.compose.material.icons.rounded.HealthAndSafety
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.NotificationsActive
import androidx.compose.material.icons.rounded.Psychology
import androidx.compose.material.icons.rounded.PushPin
import androidx.compose.material.icons.rounded.ReportProblem
import androidx.compose.material.icons.rounded.School
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.VerifiedUser
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.data.Announcement
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.CampusAlertSummary
import edu.srmap.campuscare.data.StudentDashboard
import edu.srmap.campuscare.ui.components.ActionTile
import edu.srmap.campuscare.ui.components.Avatar
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CampusSkyline
import edu.srmap.campuscare.ui.components.Catalog
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.Divider
import edu.srmap.campuscare.ui.components.EmergencyCallRow
import edu.srmap.campuscare.ui.components.IconBadge
import edu.srmap.campuscare.ui.components.ListRow
import edu.srmap.campuscare.ui.components.LiveDot
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.SectionHeader
import edu.srmap.campuscare.ui.components.SkeletonBlock
import edu.srmap.campuscare.ui.components.StatTile
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.enterStagger
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.components.rememberPulse
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.Fmt
import kotlinx.coroutines.launch

/** Student dashboard (home mockup): greeting, safety hero, quick actions and what needs attention. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val user by app.session.user.collectAsState()
    val config by app.config.config.collectAsState()
    val live by app.realtime.connected.collectAsState()
    val dash = rememberLoad { app.api.content.dashboard() }

    // Refresh when something relevant happens in realtime.
    LaunchedEffect(Unit) {
        app.realtime.events.collect { e ->
            if (e.name in setOf("campus_alert", "case:updated", "appointment:updated", "notification")) dash.reload()
        }
    }

    PullToRefreshBox(isRefreshing = dash.refreshing, onRefresh = { dash.reload() }, modifier = Modifier.fillMaxSize().background(CcColors.Cream)) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .statusBarsPadding()
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            // ---- greeting
            Row(Modifier.fillMaxWidth().padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Avatar(user?.fullName ?: "", size = 46.dp, modifier = Modifier.clickable(role = Role.Button) { nav.navigate(Routes.Profile) })
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(Fmt.greeting() + ",", style = MaterialTheme.typography.bodyMedium, color = CcColors.InkSoft)
                    Text(user?.firstName ?: "Student", style = MaterialTheme.typography.headlineSmall, color = CcColors.Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                val unread = dash.data?.unreadNotifications ?: 0
                IconButton(onClick = { nav.navigate(Routes.Notifications) }) {
                    BadgedBox(badge = { if (unread > 0) Badge(containerColor = CcColors.Sos) { Text(if (unread > 99) "99+" else "$unread") } }) {
                        Icon(Icons.Rounded.Notifications, contentDescription = "Notifications, $unread unread", tint = CcColors.Ink)
                    }
                }
            }

            SafetyHero(live = live, sosEnabled = config.settings.sos.enabled, onSos = { nav.navigate(Routes.Sos) }, modifier = Modifier.enterStagger(0))

            // ---- campus alerts needing a response (scheduled check-ins)
            dash.data?.campusAlerts?.forEach { a -> CampusAlertCard(a, onAnswered = { dash.reload() }) }

            // ---- quick actions
            Text("Quick actions", style = MaterialTheme.typography.titleLarge, color = CcColors.Ink)
            val tiles = buildList {
                add(Tile(Icons.Rounded.Warning, "Emergency SOS", Tone.Danger, Routes.Sos))
                add(Tile(Icons.Rounded.ReportProblem, "Report Incident", Tone.Amber, Routes.report()))
                add(Tile(Icons.Rounded.Psychology, "Counselling Support", Tone.Violet, Routes.Counselling))
                if (config.settings.safeWalkEnabled) add(Tile(Icons.AutoMirrored.Rounded.DirectionsWalk, "Safe Walk", Tone.Teal, Routes.SafeWalk))
                add(Tile(Icons.Rounded.Map, "Safety Map", Tone.Sky, Routes.SafetyMap))
                if (config.settings.communityEnabled) add(Tile(Icons.Rounded.Groups, "Community", Tone.Brand, Routes.Community))
            }
            tiles.chunked(3).forEachIndexed { r, row ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    row.forEachIndexed { i, t ->
                        ActionTile(t.icon, t.label, t.tone, { nav.navigate(t.route) }, Modifier.weight(1f).enterStagger(1 + r * 3 + i))
                    }
                    repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
                }
            }
            MoreTools(lostFound = config.settings.community.lostFoundEnabled, suggestions = config.settings.community.suggestionsEnabled)

            LoadContent(dash, skeleton = { Column(verticalArrangement = Arrangement.spacedBy(12.dp)) { SkeletonBlock(height = 90.dp); SkeletonBlock(height = 160.dp) } }) { d ->
                DashboardBody(d)
            }

            // ---- emergency numbers (cached; work offline)
            val contacts = config.emergencyContacts.filter { !it.phone.isNullOrBlank() }.take(3)
            if (contacts.isNotEmpty()) {
                SectionHeader("Emergency contacts", action = "All contacts", onAction = { nav.navigate(Routes.Contacts) })
                CcCard {
                    contacts.forEachIndexed { i, c ->
                        if (i > 0) Divider()
                        EmergencyCallRow(c)
                    }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

private data class Tile(val icon: ImageVector, val label: String, val tone: Tone, val route: String)

@Composable
private fun SafetyHero(live: Boolean, sosEnabled: Boolean, onSos: () -> Unit, modifier: Modifier = Modifier) {
    val pulse = rememberPulse(0.96f, 1.04f, 1400)
    Box(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(28.dp))
            .background(Brush.linearGradient(listOf(CcColors.ForestDeep, CcColors.Forest700, CcColors.Emerald))),
    ) {
        CampusSkyline(
            Modifier.fillMaxWidth().height(170.dp).align(Alignment.BottomCenter),
            tint = Color.White.copy(alpha = 0.10f),
            accent = Color.White.copy(alpha = 0.18f),
        )
        Column(Modifier.padding(20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.VerifiedUser, contentDescription = null, tint = CcColors.Emerald400, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("Your safety, our priority", style = MaterialTheme.typography.labelLarge, color = CcColors.Mint)
                Spacer(Modifier.weight(1f))
                Box(Modifier.clip(RoundedCornerShape(50)).background(Color.White.copy(alpha = 0.92f)).padding(horizontal = 10.dp, vertical = 4.dp)) { LiveDot(live) }
            }
            Spacer(Modifier.height(10.dp))
            Text("Help is one press away", style = MaterialTheme.typography.headlineMedium, color = Color.White)
            Text(
                "Campus Security receives your SOS with your location. You'll see when they acknowledge it.",
                style = MaterialTheme.typography.bodyMedium, color = Color.White.copy(alpha = 0.85f),
            )
            Spacer(Modifier.height(14.dp))
            if (sosEnabled) {
                Row(
                    Modifier
                        .scale(pulse)
                        .clip(RoundedCornerShape(50))
                        .background(CcColors.Sos)
                        .clickable(role = Role.Button, onClick = onSos)
                        .padding(horizontal = 18.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Rounded.Shield, contentDescription = null, tint = Color.White)
                    Spacer(Modifier.width(8.dp))
                    Text("Open Emergency SOS", color = Color.White, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.width(6.dp))
                    Icon(Icons.AutoMirrored.Rounded.ArrowForward, contentDescription = null, tint = Color.White, modifier = Modifier.size(18.dp))
                }
            } else {
                Text("In-app SOS is paused — use the emergency numbers below.", color = CcColors.AmberSoft, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

/** A campus alert; when it asks for a check-in the student answers "I'm safe" or "I need help". */
@Composable
fun CampusAlertCard(a: CampusAlertSummary, onAnswered: () -> Unit) {
    val app = LocalApp.current
    val snack = LocalSnack.current
    val nav = LocalNav.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var answered by remember(a.id) { mutableStateOf(a.myCheckIn) }
    val tone = when (a.severity) { "emergency" -> Tone.Danger; "warning" -> Tone.Amber; "advisory" -> Tone.Sky; else -> Tone.Brand }
    CcCard(color = tone.bg.copy(alpha = 0.45f)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconBadge(Icons.Rounded.NotificationsActive, tone, size = 40.dp, iconSize = 20.dp)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(a.title, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                Text(Fmt.ago(a.createdAt), style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
            }
            StatusChip(Fmt.humanize(a.severity), tone)
        }
        if (a.body.isNotBlank()) Text(a.body, style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink, modifier = Modifier.padding(top = 8.dp))
        if (a.requestCheckIn) {
            Spacer(Modifier.height(10.dp))
            AnimatedVisibility(answered == null) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    fun answer(status: String) {
                        scope.launch {
                            busy = true
                            try {
                                app.api.safety.checkIn(a.id, status, null)
                                answered = status
                                snack.show(if (status == "safe") "Thanks — marked as safe." else "Campus Security has been told you need help.")
                                if (status == "need_help") nav.navigate(Routes.Sos)
                                onAnswered()
                            } catch (e: ApiException) {
                                snack.error(e)
                            } finally {
                                busy = false
                            }
                        }
                    }
                    CcButton("I'm safe", { answer("safe") }, Modifier.weight(1f), kind = ButtonKind.Brand, enabled = !busy)
                    CcButton("I need help", { answer("need_help") }, Modifier.weight(1f), kind = ButtonKind.Danger, enabled = !busy)
                }
            }
            answered?.let { StatusChip(if (it == "safe") "You checked in as safe" else "Help requested", if (it == "safe") Tone.Brand else Tone.Danger, dot = true) }
        }
    }
}

@Composable
private fun MoreTools(lostFound: Boolean, suggestions: Boolean) {
    val nav = LocalNav.current
    val items = buildList {
        add(Triple(Icons.Rounded.Contacts, "Trusted contacts", Routes.Trusted))
        add(Triple(Icons.Rounded.HealthAndSafety, "Safety card", Routes.SafetyCard))
        add(Triple(Icons.Rounded.School, "Awareness", Routes.Awareness))
        if (lostFound) add(Triple(Icons.Rounded.Inventory2, "Lost & found", Routes.LostFound))
        if (suggestions) add(Triple(Icons.Rounded.EmojiObjects, "Suggestions", Routes.Suggestions))
        add(Triple(Icons.Rounded.Campaign, "Campus alerts", Routes.CampusAlerts))
        add(Triple(Icons.Rounded.Forum, "Support chat", Routes.Support))
        add(Triple(Icons.AutoMirrored.Rounded.HelpOutline, "Help", Routes.Help))
    }
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items.forEach { (icon, label, route) ->
            Row(
                Modifier
                    .clip(RoundedCornerShape(50))
                    .background(Color.White)
                    .clickable(role = Role.Button) { nav.navigate(route) }
                    .padding(horizontal = 14.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(icon, contentDescription = null, tint = CcColors.Forest, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text(label, style = MaterialTheme.typography.labelLarge, color = CcColors.Ink)
            }
        }
    }
}

@Composable
private fun DashboardBody(d: StudentDashboard) {
    val nav = LocalNav.current
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            StatTile("Reports", "${d.stats.total}", Modifier.weight(1f))
            StatTile("Active", "${d.stats.active}", Modifier.weight(1f), tone = Tone.Amber)
            StatTile("Resolved", "${d.stats.resolved}", Modifier.weight(1f), tone = Tone.Teal)
        }

        d.nextAppointment?.let { a ->
            CcCard(onClick = { nav.navigate(Routes.Counselling) }) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconBadge(Icons.Rounded.Event, Tone.Violet)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text("Next counselling session", style = MaterialTheme.typography.labelMedium, color = CcColors.InkSoft)
                        Text(Fmt.dayTime(a.startAt), style = MaterialTheme.typography.titleMedium, color = CcColors.Ink)
                        Text(if (a.mode == "online") "Online" else "In person", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                    }
                    StatusChip(Fmt.humanize(a.status), if (a.status == "confirmed") Tone.Brand else Tone.Amber)
                }
            }
        }

        if (d.recentReports.isNotEmpty()) {
            SectionHeader("My recent reports", action = "View all", onAction = { nav.navigate(Routes.Reports) })
            CcCard(padding = 8.dp) {
                d.recentReports.take(3).forEachIndexed { i, r ->
                    if (i > 0) Divider()
                    val cat = Catalog.category(r.category)
                    ListRow(
                        title = r.title.ifBlank { cat.label },
                        subtitle = "${r.caseNumber} · ${Fmt.ago(r.updatedAt)}",
                        icon = cat.icon, tone = cat.tone,
                        trailing = { StatusChip(Catalog.statusLabel(r.status), Catalog.statusTone(r.status)) },
                        onClick = { nav.navigate(Routes.reportDetail(r.id)) },
                    )
                }
            }
        }

        if (d.training.total > 0) {
            CcCard(onClick = { nav.navigate(Routes.Awareness) }) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconBadge(Icons.Rounded.School, Tone.Sky)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text("Safety awareness", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                        Text("${d.training.completed} of ${d.training.total} modules completed", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                    }
                }
                Spacer(Modifier.height(10.dp))
                LinearProgressIndicator(
                    progress = { if (d.training.total == 0) 0f else d.training.completed.toFloat() / d.training.total },
                    modifier = Modifier.fillMaxWidth().height(8.dp).clip(CircleShape),
                    color = CcColors.Emerald, trackColor = CcColors.Mint,
                )
            }
        }

        if (d.announcements.isNotEmpty()) {
            SectionHeader("Announcements")
            d.announcements.take(4).forEach { AnnouncementCard(it) }
        }
    }
}

@Composable
fun AnnouncementCard(a: Announcement) {
    CcCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (a.pinned) {
                Icon(Icons.Rounded.PushPin, contentDescription = "Pinned", tint = CcColors.Amber, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
            }
            Text(a.title, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink, modifier = Modifier.weight(1f))
            if (a.kind == "event") StatusChip("Event", Tone.Violet)
        }
        if (a.kind == "event") {
            Text(
                listOfNotNull(a.eventAt?.let { Fmt.dayTime(it) }, a.venue?.takeIf { it.isNotBlank() }).joinToString(" · "),
                style = MaterialTheme.typography.labelMedium, color = CcColors.Violet, modifier = Modifier.padding(top = 4.dp),
            )
        }
        Text(a.body, style = MaterialTheme.typography.bodyMedium, color = CcColors.InkSoft, maxLines = 5, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
        a.safetyContact?.takeIf { it.isNotBlank() }?.let {
            Text("Event safety contact: $it", style = MaterialTheme.typography.labelMedium, color = CcColors.Forest, modifier = Modifier.padding(top = 6.dp))
        }
        Text(Fmt.date(a.createdAt), style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint, modifier = Modifier.padding(top = 6.dp))
    }
}
