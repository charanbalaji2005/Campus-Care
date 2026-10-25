package edu.srmap.campuscare.ui.screens.staff

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Gavel
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Timer
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.data.IncidentListItem
import edu.srmap.campuscare.ui.components.Catalog
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.CcTextField
import edu.srmap.campuscare.ui.components.ChoiceChips
import edu.srmap.campuscare.ui.components.EmptyState
import edu.srmap.campuscare.ui.components.IconBadge
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.SkeletonList
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.enterStagger
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.Fmt

/** Shared case queue used by committee members, responders and admins (triage). */
@Composable
private fun CaseQueue(title: String, subtitle: String, scope: String, triage: Boolean = false, onBack: (() -> Unit)? = null) {
    val app = LocalApp.current
    val nav = LocalNav.current
    var filter by rememberSaveable { mutableStateOf(if (triage) "unassigned" else "open") }
    var query by rememberSaveable { mutableStateOf("") }
    var applied by rememberSaveable { mutableStateOf("") }
    val list = rememberLoad(filter to applied) {
        app.api.incidents.list(
            scope,
            status = filter.takeIf { it in setOf("submitted", "escalated", "awaiting_information", "resolved") },
            q = applied,
            mine = filter == "mine",
            unassigned = filter == "unassigned",
            overdue = filter == "overdue",
        )
    }
    LaunchedEffect(Unit) { app.realtime.events.collect { e -> if (e.name == "case:updated" || e.name == "notification") list.reload() } }
    val chips = buildList {
        if (triage) add("unassigned" to "Unassigned")
        add("open" to "Open")
        if (!triage) add("mine" to "Assigned to me")
        add("overdue" to "Overdue")
        add("escalated" to "Escalated")
        add("awaiting_information" to "Waiting on student")
        add("resolved" to "Resolved")
    }
    CcScreen(title = title, subtitle = subtitle, onBack = onBack, refreshing = list.refreshing, onRefresh = { list.reload() }) {
        CcTextField(query, { query = it; if (it.isBlank()) applied = "" }, label = if (triage) "Search by case number" else "Search case number or title", leadingIcon = Icons.Rounded.Search, onImeAction = { applied = query.trim() })
        ChoiceChips(chips, filter, { filter = it })
        LoadContent(list, skeleton = { SkeletonList(6) }) { page ->
            val items = if (filter == "open") page.items.filter { it.status !in setOf("resolved", "closed", "withdrawn", "rejected") } else page.items
            if (items.isEmpty()) EmptyState("No cases here", message = "Cases that match this filter will appear here.", icon = Icons.Rounded.Gavel, tone = Tone.Amber)
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items.forEachIndexed { i, c -> CaseRow(c, Modifier.enterStagger(i)) { nav.navigate(Routes.case(c.id)) } }
                if (page.total > page.items.size) Text("Showing ${page.items.size} of ${page.total}. Refine the search to narrow down.", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
            }
        }
    }
}

@Composable
private fun CaseRow(c: IncidentListItem, modifier: Modifier, onClick: () -> Unit) {
    val cat = Catalog.category(c.category)
    CcCard(modifier, onClick = onClick) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconBadge(cat.icon, cat.tone)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(c.title.ifBlank { cat.label }, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink, maxLines = 2)
                Text("${c.caseNumber} · ${cat.label} · ${Fmt.ago(c.createdAt)}", style = MaterialTheme.typography.labelMedium, color = CcColors.InkSoft)
            }
            if (c.anonymous) Icon(Icons.Rounded.VisibilityOff, contentDescription = "Anonymous", tint = CcColors.InkFaint)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 10.dp)) {
            StatusChip(c.statusLabel.ifBlank { Catalog.statusLabel(c.status) }, Catalog.statusTone(c.status), dot = true)
            if (c.urgent || c.priority == "urgent") StatusChip("Urgent", Tone.Danger)
            else if (c.priority == "high") StatusChip("High", Tone.Amber)
            if (c.overdue) StatusChip("Overdue", Tone.Rose)
        }
        c.dueResolveAt?.let {
            if (c.status !in setOf("resolved", "closed", "withdrawn", "rejected")) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 6.dp)) {
                    Icon(Icons.Rounded.Timer, contentDescription = null, tint = if (c.overdue) CcColors.Rose else CcColors.InkFaint, modifier = Modifier.padding(end = 4.dp))
                    Text("Resolve by ${Fmt.date(it)}", style = MaterialTheme.typography.labelSmall, color = if (c.overdue) CcColors.Rose else CcColors.InkSoft)
                }
            }
        }
    }
}

@Composable
fun CommitteeCasesScreen() = CaseQueue("Cases", "Reports assigned to your committees", "assigned")

@Composable
fun ResponderCasesScreen() = CaseQueue("Security cases", "Reports routed to Campus Security", "assigned")

@Composable
fun AdminTriageScreen() = CaseQueue("Triage", "Route new reports to the right committee", "triage", triage = true)
