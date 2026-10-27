package edu.srmap.campuscare.ui.screens.student

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.rounded.Campaign
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.DirectionsWalk
import androidx.compose.material.icons.automirrored.rounded.HelpOutline
import androidx.compose.material.icons.rounded.Badge
import androidx.compose.material.icons.rounded.Call
import androidx.compose.material.icons.rounded.Email
import androidx.compose.material.icons.rounded.EmojiObjects
import androidx.compose.material.icons.rounded.Forum
import androidx.compose.material.icons.rounded.Gavel
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material.icons.rounded.Inventory2
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Place
import androidx.compose.material.icons.rounded.Psychology
import androidx.compose.material.icons.rounded.ReportProblem
import androidx.compose.material.icons.rounded.Schedule
import androidx.compose.material.icons.rounded.SupportAgent
import androidx.compose.material.icons.rounded.Verified
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.Contact
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.Catalog
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.CcTextField
import edu.srmap.campuscare.ui.components.ChoiceChips
import edu.srmap.campuscare.ui.components.Divider
import edu.srmap.campuscare.ui.components.EmergencyCallRow
import edu.srmap.campuscare.ui.components.EmptyState
import edu.srmap.campuscare.ui.components.IconBadge
import edu.srmap.campuscare.ui.components.InfoBanner
import edu.srmap.campuscare.ui.components.ListRow
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.SectionHeader
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.contactIcon
import edu.srmap.campuscare.ui.components.contactTone
import edu.srmap.campuscare.ui.components.enterStagger
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.Fmt
import edu.srmap.campuscare.util.dial
import edu.srmap.campuscare.util.openUrl
import kotlinx.coroutines.launch

/** Unified support inbox: start a private conversation with a support service, or continue one. */
@Composable
fun SupportScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val overview = rememberLoad { app.api.chat.overview() }
    var opening by remember { mutableStateOf<String?>(null) }
    androidx.compose.runtime.LaunchedEffect(Unit) {
        app.realtime.events.collect { e -> if (e.name == "chat:message" || e.name == "notification") overview.reload() }
    }

    CcScreen(title = "Support", subtitle = "Private conversations with campus support teams", refreshing = overview.refreshing, onRefresh = { overview.reload() }) {
        LoadContent(overview) { o ->
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                InfoBanner("Conversations here are private between you and the team you contact. For emergencies use SOS.", icon = Icons.Rounded.Lock)
                if (o.threads.isNotEmpty()) {
                    SectionHeader("Your conversations")
                    CcCard(padding = 8.dp) {
                        o.threads.forEachIndexed { i, t ->
                            if (i > 0) Divider()
                            ListRow(
                                t.name,
                                subtitle = (if (t.closed) "Closed · " else "") + (t.lastMessageAt?.let { "Last message ${Fmt.ago(it)}" } ?: "No messages yet"),
                                icon = if (t.kind == "counselling_thread") Icons.Rounded.Psychology else Icons.Rounded.SupportAgent,
                                tone = if (t.kind == "counselling_thread") Tone.Violet else Tone.Brand,
                                trailing = { if (t.unread > 0) StatusChip("${t.unread} new", Tone.Danger) },
                                onClick = { nav.navigate(Routes.chat(t.id)) },
                            )
                        }
                    }
                }
                SectionHeader("Start a conversation")
                if (o.services.isEmpty()) {
                    EmptyState("No support services yet", message = "The university hasn't published support services. Use the contacts list instead.", icon = Icons.Rounded.SupportAgent)
                }
                o.services.forEachIndexed { i, s ->
                    CcCard(Modifier.enterStagger(i), onClick = {
                        if (opening != null) return@CcCard
                        scope.launch {
                            opening = s.id
                            try {
                                val id = app.api.chat.openService(s.id).id
                                nav.navigate(Routes.chat(id))
                            } catch (e: ApiException) {
                                snack.error(e)
                            } finally {
                                opening = null
                            }
                        }
                    }) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            IconBadge(Icons.Rounded.Forum, Tone.Teal)
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(s.name, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                                if (s.description.isNotBlank()) Text(s.description, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft, maxLines = 3)
                            }
                            if (opening == s.id) Text("Opening…", style = MaterialTheme.typography.labelMedium, color = CcColors.Emerald)
                        }
                    }
                }
                SectionHeader("Other ways to get help")
                CcCard(padding = 8.dp) {
                    ListRow("Counselling", subtitle = "Book a confidential session", icon = Icons.Rounded.Psychology, tone = Tone.Violet, onClick = { nav.navigate(Routes.Counselling) })
                    Divider()
                    ListRow("Committees", subtitle = "Who handles what", icon = Icons.Rounded.Gavel, tone = Tone.Amber, onClick = { nav.navigate(Routes.Committees) })
                    Divider()
                    ListRow("Campus contacts", subtitle = "Verified phone numbers and emails", icon = Icons.Rounded.Call, tone = Tone.Sky, onClick = { nav.navigate(Routes.Contacts) })
                }
            }
        }
    }
}

/** Community chat channels and community safety tools (the feed itself is the Campus Community screen). */
@Composable
fun CommunitySpacesScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val config by app.config.config.collectAsState()
    val overview = rememberLoad { app.api.chat.overview() }
    CcScreen(title = "Channels & tools", subtitle = "Moderated chat channels and community safety tools", onBack = { nav.popBackStack() }, refreshing = overview.refreshing, onRefresh = { overview.reload() }) {
        val c = config.settings.community
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (c.lostFoundEnabled) CcButton("Lost & found", { nav.navigate(Routes.LostFound) }, Modifier.weight(1f), kind = ButtonKind.Soft, leadingIcon = Icons.Rounded.Inventory2)
            if (c.suggestionsEnabled) CcButton("Suggestions", { nav.navigate(Routes.Suggestions) }, Modifier.weight(1f), kind = ButtonKind.Soft, leadingIcon = Icons.Rounded.EmojiObjects)
        }
        if (c.hazardReportsEnabled) CcButton("Report a hazard on campus", { nav.navigate(Routes.Hazard) }, Modifier.fillMaxWidth(), kind = ButtonKind.Outline, leadingIcon = Icons.Rounded.Warning)
        SectionHeader("Official Announcements & Notices")
        LoadContent(overview) { o ->
            val official = o.community.filter { it.readOnly || it.slug == "official" }
            val other = o.community.filterNot { it.readOnly || it.slug == "official" }

            if (official.isNotEmpty()) {
                CcCard(padding = 8.dp, color = CcColors.Mint50) {
                    official.forEachIndexed { i, ch ->
                        if (i > 0) Divider()
                        ListRow(
                            ch.name,
                            subtitle = ch.description.ifBlank { "Important university updates and official safety broadcasts." },
                            icon = Icons.Rounded.Campaign,
                            tone = Tone.Brand,
                            trailing = { StatusChip("Official", Tone.Brand, dot = true) },
                            onClick = { nav.navigate(Routes.chat(ch.id)) },
                        )
                    }
                }
                Spacer(Modifier.height(14.dp))
            }

            SectionHeader("Community Discussions")
            if (other.isEmpty()) {
                EmptyState("No open discussion channels", message = if (!config.settings.communityEnabled) "Community chat is currently off." else "Channels will appear here when published.", icon = Icons.Rounded.Groups)
            } else {
                CcCard(padding = 8.dp) {
                    other.forEachIndexed { i, ch ->
                        if (i > 0) Divider()
                        ListRow(
                            "# ${ch.name}", subtitle = ch.description.ifBlank { null }, icon = Icons.Rounded.Groups, tone = Tone.Sky,
                            onClick = { nav.navigate(Routes.chat(ch.id)) },
                        )
                    }
                }
            }
        }
        InfoBanner("Your name is shown in community channels unless you turn it off in Privacy settings. Report anything harmful — moderators review every report.", tone = Tone.Neutral)
    }
}

@Composable
fun CommitteesScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val context = LocalContext.current
    val list = rememberLoad { app.api.content.committees() }
    CcScreen(title = "Committees", subtitle = "Who reviews each kind of report", onBack = { nav.popBackStack() }, refreshing = list.refreshing, onRefresh = { list.reload() }) {
        LoadContent(list) { items ->
            if (items.isEmpty()) EmptyState("No committees listed", icon = Icons.Rounded.Gavel)
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items.forEachIndexed { i, c ->
                    CcCard(Modifier.enterStagger(i)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            IconBadge(Icons.Rounded.Gavel, Tone.Amber)
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(c.name, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                                if (c.type.isNotBlank()) Text(Fmt.humanize(c.type), style = MaterialTheme.typography.labelMedium, color = CcColors.InkSoft)
                            }
                        }
                        if (c.mandate.isNotBlank()) Text(c.mandate, style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink, modifier = Modifier.padding(top = 8.dp))
                        if (c.categories.isNotEmpty()) {
                            Text("Handles: " + c.categories.joinToString { Catalog.category(it).label }, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft, modifier = Modifier.padding(top = 6.dp))
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                            c.contactPhone?.takeIf { it.isNotBlank() }?.let { p -> CcButton("Call", { context.dial(p) }, kind = ButtonKind.Soft, leadingIcon = Icons.Rounded.Call) }
                            c.contactEmail?.takeIf { it.isNotBlank() }?.let { m -> CcButton("Email", { context.openUrl("mailto:$m") }, kind = ButtonKind.Soft, leadingIcon = Icons.Rounded.Email) }
                        }
                    }
                }
                CcButton("Report an incident", { nav.navigate(Routes.report()) }, Modifier.fillMaxWidth(), leadingIcon = Icons.Rounded.ReportProblem)
            }
        }
    }
}

/** Verified campus contacts (searchable) plus the national helplines. */
@Composable
fun ContactsScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val list = rememberLoad { app.api.content.contacts() }
    var query by rememberSaveable { mutableStateOf("") }
    var cat by rememberSaveable { mutableStateOf("all") }
    CcScreen(title = "Emergency Contacts", subtitle = "Verified numbers — calling never needs the internet", onBack = { nav.popBackStack() }, refreshing = list.refreshing, onRefresh = { list.reload() }) {
        CcTextField(query, { query = it }, label = "Search contacts", leadingIcon = Icons.Rounded.Badge)
        ChoiceChips(
            listOf("all" to "All", "emergency" to "Emergency", "security" to "Security", "medical" to "Medical", "counselling" to "Counselling", "hostel" to "Hostel", "helpline" to "Helplines"),
            cat, { cat = it },
        )
        LoadContent(list) { items ->
            val q = query.trim().lowercase()
            val shown = items.filter { (cat == "all" || it.category == cat) && (q.isEmpty() || it.name.lowercase().contains(q) || it.purpose.lowercase().contains(q)) }
                .sortedWith(compareByDescending<Contact> { it.emergency }.thenBy { it.name })
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (shown.isEmpty()) EmptyState("No contacts match", icon = Icons.Rounded.Badge)
                shown.forEach { c -> ContactCard(c) }
            }
        }
        SectionHeader("National helplines")
        CcCard {
            app.config.nationalEmergencyNumbers.forEachIndexed { i, c ->
                if (i > 0) Divider()
                EmergencyCallRow(c)
            }
        }
    }
}

@Composable
private fun ContactCard(c: Contact) {
    val context = LocalContext.current
    CcCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconBadge(contactIcon(c.category), contactTone(c.category))
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(c.name, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink, modifier = Modifier.weight(1f, fill = false))
                    if (c.verified) {
                        Spacer(Modifier.width(4.dp))
                        androidx.compose.material3.Icon(Icons.Rounded.Verified, contentDescription = "Verified", tint = CcColors.Emerald, modifier = Modifier.padding(start = 2.dp))
                    }
                }
                if (c.purpose.isNotBlank()) Text(c.purpose, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
            }
        }
        c.location?.takeIf { it.isNotBlank() }?.let { Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) { SmallIcon(Icons.Rounded.Place); Text(it, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft) } }
        c.hours?.takeIf { it.isNotBlank() }?.let { Row(Modifier.padding(top = 2.dp), verticalAlignment = Alignment.CenterVertically) { SmallIcon(Icons.Rounded.Schedule); Text(it, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft) } }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 10.dp)) {
            c.phone?.takeIf { it.isNotBlank() }?.let { p -> CcButton("Call $p", { context.dial(p) }, kind = if (c.emergency) ButtonKind.Danger else ButtonKind.Primary, leadingIcon = Icons.Rounded.Call) }
            c.email?.takeIf { it.isNotBlank() }?.let { m -> CcButton("Email", { context.openUrl("mailto:$m") }, kind = ButtonKind.Outline, leadingIcon = Icons.Rounded.Email) }
        }
    }
}

@Composable
private fun SmallIcon(icon: androidx.compose.ui.graphics.vector.ImageVector) {
    androidx.compose.material3.Icon(icon, contentDescription = null, tint = CcColors.InkFaint, modifier = Modifier.padding(end = 6.dp).width(16.dp))
}

/** How CampusCare works, privacy in plain words, and where to get help. */
@Composable
fun HelpScreen() {
    val nav = LocalNav.current
    val app = LocalApp.current
    val context = LocalContext.current
    val settings = app.config.config.value.settings
    val faqs = listOf(
        "How do I use the SOS feature?" to "Open the SOS section, grant the necessary location permissions, and follow the emergency instructions displayed in the app. Use SOS only for genuine emergencies. If you are in immediate danger, contact local emergency services as well.",
        "Does CampusCare track my location in the background?" to "No. CampusCare never tracks your location when the app is idle. Location is only sent when you raise an emergency SOS, start a Safe Walk escort session, or manually share your live coordinates with trusted contacts.",
        "Who can see my incident report?" to "Only the committee assigned to your case and authorised administrators. Anonymous reports hide your identity from handlers. Super Admins do not read case contents by default.",
        "What happens during student verification?" to "Manual student verification confirms your university enrollment, department, and academic year. Verification requests are typically processed within 24 hours by campus administration.",
        "How does Safe Walk work?" to "Safe Walk sets an estimated arrival time when walking across campus late at night and shares your progress with chosen friends. If you do not check in safely within 5 minutes after ETA, it prompts you and alerts security if needed.",
        "Can administrators read my counselling notes?" to "No. Psychological counselling records are strictly confidential and protected by clinical privacy. Neither Super Admins, Campus Admins, nor Security Officers can read private counselling session notes.",
        "What if I forget my password or get locked out?" to "Tap 'Forgot Password' on the login screen, enter your @srmap.edu.in email address, complete the security check, and follow the single-use reset link sent to your university inbox.",
        "What are the campus community guidelines?" to "Treat all university peers with respect. Harassment, ragging, hate speech, and spam are prohibited. Official channels are reserved for verified announcements from campus authorities.",
        "Why am I not receiving campus notifications?" to "Ensure notification permissions are set to 'Allowed' and battery optimization is set to 'Unrestricted' for CampusCare in Android Settings so you never miss critical safety broadcasts.",
        "How do I export or delete my account data?" to "Go to Profile > Privacy & Data to request a full archive of your data or request account deletion in accordance with university data governance policies.",
    )
    CcScreen(title = "Support Center & FAQs", subtitle = "Help, FAQs and answers from your campus team", onBack = { nav.popBackStack() }) {
        CcButton("Ask a Question to Campus Admins", { nav.navigate(Routes.Support) }, Modifier.fillMaxWidth(), kind = ButtonKind.Primary, leadingIcon = Icons.Rounded.SupportAgent)

        SectionHeader("Frequently Asked Questions")
        faqs.forEachIndexed { i, (q, a) ->
            var expanded by rememberSaveable { mutableStateOf(i == 0) }
            CcCard(Modifier.enterStagger(i), onClick = { expanded = !expanded }) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconBadge(Icons.AutoMirrored.Rounded.HelpOutline, Tone.Sky, size = 34.dp, iconSize = 18.dp)
                    Spacer(Modifier.width(10.dp))
                    Text(q, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink, modifier = Modifier.weight(1f))
                }
                if (expanded) Text(a, style = MaterialTheme.typography.bodyMedium, color = CcColors.InkSoft, modifier = Modifier.padding(top = 8.dp))
            }
        }
        SectionHeader("Safety tools & Support")
        CcCard(padding = 8.dp) {
            ListRow("Safe Walk", subtitle = "Let trusted contacts know you got home", icon = Icons.AutoMirrored.Rounded.DirectionsWalk, tone = Tone.Teal, onClick = { nav.navigate(Routes.SafeWalk) })
            Divider()
            ListRow("Emergency Contacts", subtitle = "Direct phone numbers for campus security and health", icon = Icons.Rounded.Call, tone = Tone.Brand, onClick = { nav.navigate(Routes.Contacts) })
            Divider()
            ListRow("Safety Map", subtitle = "Help points, security posts and reported hazards", icon = Icons.Rounded.Place, tone = Tone.Sky, onClick = { nav.navigate(Routes.SafetyMap) })
        }
        if (settings.supportEmail.isNotBlank()) {
            CcButton("Email Campus Support (${settings.supportEmail})", { context.openUrl("mailto:${settings.supportEmail}") }, Modifier.fillMaxWidth(), kind = ButtonKind.Outline, leadingIcon = Icons.Rounded.Email)
        }
    }
}