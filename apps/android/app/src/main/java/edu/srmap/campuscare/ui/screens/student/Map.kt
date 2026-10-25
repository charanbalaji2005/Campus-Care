package edu.srmap.campuscare.ui.screens.student

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.DirectionsWalk
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Call
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.MyLocation
import androidx.compose.material.icons.rounded.Place
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.SafetyMap
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.Catalog
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.CcTextField
import edu.srmap.campuscare.ui.components.ChoiceChips
import edu.srmap.campuscare.ui.components.EmptyState
import edu.srmap.campuscare.ui.components.HeatSpot
import edu.srmap.campuscare.ui.components.IconBadge
import edu.srmap.campuscare.ui.components.InfoBanner
import edu.srmap.campuscare.ui.components.LegendDot
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.MapPin
import edu.srmap.campuscare.ui.components.OsmMap
import edu.srmap.campuscare.ui.components.ScreenHeader
import edu.srmap.campuscare.ui.components.SectionHeader
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.SwitchRow
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.components.rememberLocationRequest
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.Fix
import edu.srmap.campuscare.util.Fmt
import edu.srmap.campuscare.util.LocationHelper
import edu.srmap.campuscare.util.dial
import edu.srmap.campuscare.util.openUrl
import kotlinx.coroutines.launch

private fun placeColor(kind: String): Color = when (kind) {
    "security_post" -> CcColors.Forest
    "medical" -> CcColors.Rose
    "safe_zone", "help_point" -> CcColors.Emerald
    "restricted" -> CcColors.InkSoft
    "hostel" -> CcColors.Violet
    else -> CcColors.Sky
}

private sealed interface Selected {
    data class PlaceSel(val p: edu.srmap.campuscare.data.Place) : Selected
    data class HazardSel(val h: edu.srmap.campuscare.data.MapHazard) : Selected
}

/**
 * Safety Map (mockup): help points, security posts, medical, verified hazards and a privacy-preserving
 * heatmap. Heat cells only appear when at least k reports fall in the same ~150 m cell, so no single
 * report can be located.
 */
@Composable
fun SafetyMapScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val context = LocalContext.current
    val config by app.config.config.collectAsState()
    val data = rememberLoad { app.api.community.map() }
    var filter by rememberSaveable { mutableStateOf("all") }
    var showHeat by rememberSaveable { mutableStateOf(false) }
    var myLocation by rememberSaveable { mutableStateOf(LocationHelper.hasPermission(context)) }
    var selected by remember { mutableStateOf<Selected?>(null) }
    val requestLocation = rememberLocationRequest { granted -> myLocation = granted }

    Box(Modifier.fillMaxSize().background(CcColors.Cream)) {
        Column(Modifier.fillMaxSize()) {
            ScreenHeader(
                "Safety Map", subtitle = "Help points, security and reported hazards", onBack = { nav.popBackStack() },
                actions = {
                    IconButton(onClick = { if (LocationHelper.hasPermission(context)) myLocation = !myLocation else requestLocation() }) {
                        Icon(Icons.Rounded.MyLocation, contentDescription = "Show my location", tint = if (myLocation) CcColors.Emerald else CcColors.InkSoft)
                    }
                },
            )
            ChoiceChips(
                listOf("all" to "All", "help" to "Help points", "security_post" to "Security", "medical" to "Medical", "hazards" to "Hazards"),
                filter, { filter = it; selected = null }, Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
            )
            LoadContent(data, modifier = Modifier.weight(1f)) { m ->
                MapBody(m, filter, showHeat, myLocation, onSelect = { selected = it })
            }
        }
        // Floating controls
        Column(
            Modifier.align(Alignment.BottomStart).navigationBarsPadding().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            AnimatedVisibility(selected != null, enter = slideInVertically { it }, exit = slideOutVertically { it }) {
                selected?.let { SelectionCard(it, onClose = { selected = null }) }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Row(
                    Modifier.shadow(4.dp, RoundedCornerShape(50)).clip(RoundedCornerShape(50)).background(Color.White)
                        .clickable(role = Role.Switch) { showHeat = !showHeat }.padding(horizontal = 14.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Spacer(Modifier.width(2.dp))
                    LegendDot(if (showHeat) CcColors.Sos else CcColors.InkFaint, if (showHeat) "Heatmap on" else "Heatmap off")
                }
                Spacer(Modifier.weight(1f))
                if (config.settings.community.hazardReportsEnabled) {
                    CcButton("Report hazard", { nav.navigate(Routes.Hazard) }, kind = ButtonKind.Danger, leadingIcon = Icons.Rounded.Add)
                }
            }
        }
    }
}

@Composable
private fun MapBody(m: SafetyMap, filter: String, showHeat: Boolean, myLocation: Boolean, onSelect: (Selected) -> Unit) {
    val places = m.places.filter {
        when (filter) {
            "all" -> true
            "help" -> it.kind == "help_point" || it.kind == "safe_zone"
            "hazards" -> false
            else -> it.kind == filter
        }
    }
    val hazards = if (filter == "all" || filter == "hazards") m.hazards.filter { it.latitude != null && it.longitude != null } else emptyList()
    val pins = places.map { p -> MapPin("p:${p.id}", p.latitude, p.longitude, p.name, p.description.ifBlank { null }, placeColor(p.kind), p.kind.take(1).uppercase()) } +
        hazards.map { h -> MapPin("h:${h.id}", h.latitude ?: 0.0, h.longitude ?: 0.0, Catalog.hazardCategories.firstOrNull { it.first == h.category }?.second ?: "Hazard", h.locationLabel, CcColors.Amber, "!") }
    val maxCount = (m.heatmap.cells.maxOfOrNull { it.count } ?: 1).coerceAtLeast(1)
    val heat = if (showHeat) m.heatmap.cells.map { HeatSpot(it.latitude, it.longitude, radiusMeters = 90.0, intensity = it.count.toFloat() / maxCount) } else emptyList()
    Box(Modifier.fillMaxSize()) {
        OsmMap(
            centerLat = m.center.latitude, centerLng = m.center.longitude, zoom = m.center.zoom,
            pins = pins, heat = heat, showMyLocation = myLocation, modifier = Modifier.fillMaxSize(),
            onPinClick = { pin ->
                val id = pin.id.substringAfter(':')
                if (pin.id.startsWith("p:")) m.places.firstOrNull { it.id == id }?.let { onSelect(Selected.PlaceSel(it)) }
                else m.hazards.firstOrNull { it.id == id }?.let { onSelect(Selected.HazardSel(it)) }
            },
        )
        Column(
            Modifier.align(Alignment.TopEnd).padding(10.dp).clip(RoundedCornerShape(14.dp)).background(Color.White.copy(alpha = 0.92f)).padding(10.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            LegendDot(CcColors.Forest, "Security")
            LegendDot(CcColors.Emerald, "Help point")
            LegendDot(CcColors.Rose, "Medical")
            LegendDot(CcColors.Amber, "Hazard")
            if (showHeat) LegendDot(CcColors.Sos, "Reports (≥${m.heatmap.minCount}, ${m.heatmap.days}d)")
        }
        if (m.alerts.isNotEmpty()) {
            InfoBanner(m.alerts.first().title, tone = Tone.Danger, icon = Icons.Rounded.Warning, modifier = Modifier.align(Alignment.TopStart).padding(10.dp).width(220.dp))
        }
    }
}

@Composable
private fun SelectionCard(sel: Selected, onClose: () -> Unit) {
    val context = LocalContext.current
    CcCard(Modifier.fillMaxWidth()) {
        when (sel) {
            is Selected.PlaceSel -> {
                val p = sel.p
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconBadge(Catalog.placeIcon(p.kind), Tone.Brand)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(p.name, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                        Text(listOfNotNull(Fmt.humanize(p.kind), p.hours).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                    }
                    IconButton(onClick = onClose) { Icon(Icons.Rounded.Close, contentDescription = "Close") }
                }
                if (p.description.isNotBlank()) Text(p.description, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft, modifier = Modifier.padding(top = 4.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 10.dp)) {
                    p.phone?.takeIf { it.isNotBlank() }?.let { ph -> CcButton("Call", { context.dial(ph) }, kind = ButtonKind.Primary, leadingIcon = Icons.Rounded.Call) }
                    CcButton(
                        "Walk here",
                        { context.openUrl("https://www.google.com/maps/dir/?api=1&destination=${p.latitude},${p.longitude}&travelmode=walking") },
                        kind = ButtonKind.Soft, leadingIcon = Icons.AutoMirrored.Rounded.DirectionsWalk,
                    )
                }
            }
            is Selected.HazardSel -> {
                val h = sel.h
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconBadge(Catalog.hazardCategories.firstOrNull { it.first == h.category }?.third ?: Icons.Rounded.Warning, Tone.Amber)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(Catalog.hazardCategories.firstOrNull { it.first == h.category }?.second ?: "Hazard", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                        Text(h.locationLabel, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                    }
                    IconButton(onClick = onClose) { Icon(Icons.Rounded.Close, contentDescription = "Close") }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 6.dp)) {
                    StatusChip(Fmt.humanize(h.status), if (h.status == "resolved") Tone.Brand else Tone.Amber)
                    h.reportedAt?.let { StatusChip("Reported ${Fmt.ago(it)}", Tone.Neutral) }
                }
                h.note?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = CcColors.Ink, modifier = Modifier.padding(top = 6.dp)) }
            }
        }
    }
}

// ------------------------------------------------------------------ hazard reports

@Composable
fun HazardScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val mine = rememberLoad { app.api.community.myHazards() }
    var category by rememberSaveable { mutableStateOf("poor_lighting") }
    var description by rememberSaveable { mutableStateOf("") }
    var place by rememberSaveable { mutableStateOf("") }
    var anonymous by rememberSaveable { mutableStateOf(false) }
    var fix by remember { mutableStateOf<Fix?>(null) }
    var errors by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var busy by remember { mutableStateOf(false) }
    val requestLocation = rememberLocationRequest { granted -> if (granted) scope.launch { fix = LocationHelper.current(context) } }

    CcScreen(title = "Report a Hazard", subtitle = "Poor lighting, broken infrastructure, unsafe spots", onBack = { nav.popBackStack() }, refreshing = mine.refreshing, onRefresh = { mine.reload() }) {
        InfoBanner("Hazards are reviewed before they appear on the map. Your name is never shown publicly.", icon = Icons.Rounded.Shield)
        Text("What kind of hazard?", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
        Catalog.hazardCategories.chunked(2).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { (key, label, icon) ->
                    val on = key == category
                    Row(
                        Modifier.weight(1f).clip(RoundedCornerShape(14.dp)).background(if (on) CcColors.AmberSoft else Color.White)
                            .border(if (on) 2.dp else 1.dp, if (on) CcColors.Amber else CcColors.Line, RoundedCornerShape(14.dp))
                            .clickable(role = Role.RadioButton) { category = key }.padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(icon, contentDescription = null, tint = if (on) CcColors.Amber else CcColors.InkSoft)
                        Spacer(Modifier.width(8.dp))
                        Text(label, style = MaterialTheme.typography.labelLarge, color = CcColors.Ink)
                    }
                }
                if (row.size == 1) Spacer(Modifier.weight(1f))
            }
        }
        CcTextField(place, { place = it; errors = errors - "locationLabel" }, label = "Where is it?", placeholder = "e.g. Path between Block A and the library", leadingIcon = Icons.Rounded.Place, error = errors["locationLabel"], maxLength = 200)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(if (fix != null) "Map location added" else "Add your current location to place it on the map", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft, modifier = Modifier.weight(1f))
            if (fix == null) CcButton("Use my location", { if (LocationHelper.hasPermission(context)) scope.launch { fix = LocationHelper.current(context) } else requestLocation() }, kind = ButtonKind.Soft, leadingIcon = Icons.Rounded.MyLocation)
            else IconButton(onClick = { fix = null }) { Icon(Icons.Rounded.Close, contentDescription = "Remove location") }
        }
        CcTextField(description, { description = it; errors = errors - "description" }, label = "Describe the hazard", leadingIcon = Icons.Rounded.Description, error = errors["description"], singleLine = false, minLines = 3, maxLength = 1000)
        SwitchRow("Submit anonymously", anonymous, { anonymous = it }, description = "Moderators won't see who reported it.")
        CcButton("Submit hazard report", {
            errors = buildMap {
                if (place.trim().length < 2) put("locationLabel", "Where is it?")
                if (description.trim().length < 10) put("description", "Describe the hazard (at least 10 characters)")
            }
            if (errors.isNotEmpty()) return@CcButton
            scope.launch {
                busy = true
                try {
                    app.api.community.reportHazard(category, description.trim(), place.trim(), fix?.latitude, fix?.longitude, anonymous)
                    snack.show("Thanks — your report was sent for review.")
                    description = ""; place = ""; fix = null
                    mine.reload()
                } catch (e: ApiException) {
                    if (e.fields.isNotEmpty()) errors = e.fields
                    snack.error(e)
                } finally {
                    busy = false
                }
            }
        }, Modifier.fillMaxWidth(), loading = busy, kind = ButtonKind.Danger, leadingIcon = Icons.Rounded.Warning)

        SectionHeader("My hazard reports")
        LoadContent(mine) { list ->
            if (list.isEmpty()) EmptyState("No reports yet", icon = Icons.Rounded.CheckCircle)
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                list.forEach { h ->
                    CcCard {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(Catalog.hazardCategories.firstOrNull { it.first == h.category }?.second ?: h.category, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                                Text(h.locationLabel, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                            }
                            if (h.anonymous) Icon(Icons.Rounded.VisibilityOff, contentDescription = "Anonymous", tint = CcColors.InkFaint)
                            Spacer(Modifier.width(6.dp))
                            StatusChip(Fmt.humanize(h.status), when (h.status) { "resolved" -> Tone.Brand; "rejected" -> Tone.Neutral; "verified", "in_progress" -> Tone.Sky; else -> Tone.Amber })
                        }
                        h.publicNote?.takeIf { it.isNotBlank() }?.let { Text("Update: $it", style = MaterialTheme.typography.bodySmall, color = CcColors.Forest, modifier = Modifier.padding(top = 6.dp)) }
                        Text(Fmt.date(h.createdAt), style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint, modifier = Modifier.padding(top = 4.dp))
                    }
                }
            }
        }
        Spacer(Modifier.height(4.dp))
    }
}
