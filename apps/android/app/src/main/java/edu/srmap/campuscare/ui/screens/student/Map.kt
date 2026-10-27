package edu.srmap.campuscare.ui.screens.student

import android.content.Context
import androidx.compose.animation.AnimatedVisibility
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.DirectionsWalk
import androidx.compose.material.icons.rounded.Accessibility
import androidx.compose.material.icons.rounded.Call
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.Explore
import androidx.compose.material.icons.rounded.LocalHospital
import androidx.compose.material.icons.rounded.MeetingRoom
import androidx.compose.material.icons.rounded.MyLocation
import androidx.compose.material.icons.rounded.Navigation
import androidx.compose.material.icons.rounded.Place
import androidx.compose.material.icons.rounded.Report
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Security
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.CampusBuildingItem
import edu.srmap.campuscare.data.CampusMapData
import edu.srmap.campuscare.data.Hazard
import edu.srmap.campuscare.data.RouteCalculationResponse
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.Catalog
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.CcTextField
import edu.srmap.campuscare.ui.components.ChoiceChips
import edu.srmap.campuscare.ui.components.EmptyState
import edu.srmap.campuscare.ui.components.InfoBanner
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.MapPin
import edu.srmap.campuscare.ui.components.OsmMap
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
import kotlinx.coroutines.launch

private fun buildingColor(category: String): Color = when (category) {
    "security", "security_office" -> CcColors.Amber
    "emergency", "assembly_point" -> CcColors.Sos
    "medical" -> CcColors.Rose
    "hostel" -> CcColors.Violet
    "cafeteria", "dining" -> Color(0xFFEA580C)
    "academic" -> CcColors.Forest
    "library" -> CcColors.Teal
    "gate" -> CcColors.Sky
    else -> CcColors.Teal
}

@Composable
fun SafetyMapScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    // Load full campus map data (buildings, emergency spots, pathways)
    val mapLoad = rememberLoad { app.api.campusMap.data() }

    // User location state
    var myLocationEnabled by rememberSaveable { mutableStateOf(false) }
    var userFix by remember { mutableStateOf<Fix?>(null) }
    val requestLocation = rememberLocationRequest { granted ->
        myLocationEnabled = granted
        if (granted) {
            scope.launch {
                userFix = LocationHelper.current(context)
            }
        }
    }

    // Search and filter
    var query by rememberSaveable { mutableStateOf("") }
    var selectedCategory by rememberSaveable { mutableStateOf("all") }

    // Selected building and route
    var selectedBuilding by remember { mutableStateOf<CampusBuildingItem?>(null) }
    var currentRoute by remember { mutableStateOf<RouteCalculationResponse?>(null) }
    var travelMode by rememberSaveable { mutableStateOf("walking") }
    var isCalculatingRoute by remember { mutableStateOf(false) }
    var showSteps by rememberSaveable { mutableStateOf(false) }

    // Issue report dialog
    var showReportDialog by rememberSaveable { mutableStateOf(false) }

    CcScreen(
        title = "Campus Map & Navigation",
        subtitle = "Verified walkways, accessible routes, and facility directory",
        onBack = { nav.popBackStack() },
        refreshing = mapLoad.refreshing,
        onRefresh = { mapLoad.reload() },
    ) {
        LoadContent(mapLoad) { campusData ->
            val allBuildings = campusData.buildings
            val filteredBuildings = remember(allBuildings, query, selectedCategory) {
                allBuildings.filter { b ->
                    val matchQ = query.isBlank() || b.name.contains(query, ignoreCase = true) || b.code.contains(query, ignoreCase = true)
                    val matchCat = selectedCategory == "all" || b.category == selectedCategory
                    matchQ && matchCat
                }
            }

            // Map Pins
            val pins = remember(filteredBuildings, selectedBuilding) {
                filteredBuildings.map { b ->
                    MapPin(
                        id = b.id,
                        latitude = b.latitude,
                        longitude = b.longitude,
                        title = b.name,
                        label = b.code,
                        color = buildingColor(b.category),
                    )
                }
            }

            // Route coordinates for OsmMap polyline
            val routeCoords = remember(currentRoute) {
                currentRoute?.geometry?.filter { it.size >= 2 }?.map { it[0] to it[1] } ?: emptyList()
            }

            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                // Emergency Quick Access Bar
                EmergencyShortcutsRow(
                    onSelectEmergency = { category ->
                        val target = campusData.emergencyLocations.firstOrNull { it.category == category }
                            ?: campusData.buildings.firstOrNull { it.category == category }
                        if (target != null) {
                            selectedBuilding = target
                            currentRoute = null
                            showSteps = false
                            scope.launch {
                                isCalculatingRoute = true
                                try {
                                    val originLat = userFix?.latitude ?: campusData.center.latitude
                                    val originLng = userFix?.longitude ?: campusData.center.longitude
                                    currentRoute = app.api.campusMap.route(
                                        originLat = originLat,
                                        originLng = originLng,
                                        buildingId = target.id,
                                        mode = travelMode,
                                    )
                                } catch (e: Exception) {
                                    snack.show(e.message ?: "Failed to calculate emergency route")
                                } finally {
                                    isCalculatingRoute = false
                                }
                            }
                        } else {
                            snack.show("No ${category.replace('_', ' ')} facility currently mapped.")
                        }
                    },
                )

                // Search Bar
                CcTextField(
                    value = query,
                    onValueChange = { query = it },
                    label = "Search buildings",
                    placeholder = "Search by name or code (e.g. Science, AUD)...",
                    leadingIcon = Icons.Rounded.Search,
                    trailing = if (query.isNotBlank()) {
                        {
                            IconButton(onClick = { query = "" }) {
                                Icon(Icons.Rounded.Close, contentDescription = "Clear", tint = CcColors.InkSoft)
                            }
                        }
                    } else null,
                )

                ChoiceChips(
                    options = listOf(
                        "all" to "All",
                        "academic" to "Academic",
                        "library" to "Library",
                        "hostel" to "Hostels",
                        "medical" to "Medical",
                        "security_office" to "Security",
                        "assembly_point" to "Assembly",
                        "cafeteria" to "Dining",
                        "gate" to "Gates",
                    ),
                    selected = selectedCategory,
                    onSelect = { selectedCategory = it },
                )

                // Interactive Map View
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(300.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .border(1.dp, CcColors.CreamDeep, RoundedCornerShape(16.dp)),
                ) {
                    OsmMap(
                        centerLat = selectedBuilding?.latitude ?: campusData.center.latitude,
                        centerLng = selectedBuilding?.longitude ?: campusData.center.longitude,
                        zoom = if (selectedBuilding != null) 17.5 else campusData.center.zoom,
                        pins = pins,
                        route = routeCoords,
                        showMyLocation = myLocationEnabled,
                        onPinClick = { pin ->
                            val b = allBuildings.firstOrNull { it.id == pin.id }
                            if (b != null) {
                                selectedBuilding = b
                                currentRoute = null
                                showSteps = false
                            }
                        },
                        modifier = Modifier.fillMaxSize(),
                    )

                    // Floating GPS re-center button
                    IconButton(
                        onClick = {
                            if (LocationHelper.hasPermission(context)) {
                                scope.launch {
                                    userFix = LocationHelper.current(context)
                                    snack.show("GPS Location refreshed")
                                }
                            } else {
                                requestLocation()
                            }
                        },
                        modifier = Modifier
                            .align(Alignment.TopEnd)
                            .padding(12.dp)
                            .size(40.dp)
                            .clip(CircleShape)
                            .background(Color.White.copy(alpha = 0.92f))
                            .border(1.dp, CcColors.Line, CircleShape),
                    ) {
                        Icon(
                            imageVector = Icons.Rounded.MyLocation,
                            contentDescription = "My location",
                            tint = if (userFix != null) CcColors.Emerald else CcColors.InkSoft,
                            modifier = Modifier.size(20.dp),
                        )
                    }
                }

                // Selected Building Navigation & Routing Panel
                selectedBuilding?.let { building ->
                    BuildingNavigationCard(
                        building = building,
                        travelMode = travelMode,
                        route = currentRoute,
                        isCalculating = isCalculatingRoute,
                        showSteps = showSteps,
                        onModeChange = { newMode ->
                            travelMode = newMode
                            if (currentRoute != null) {
                                scope.launch {
                                    isCalculatingRoute = true
                                    try {
                                        val originLat = userFix?.latitude ?: campusData.center.latitude
                                        val originLng = userFix?.longitude ?: campusData.center.longitude
                                        currentRoute = app.api.campusMap.route(
                                            originLat = originLat,
                                            originLng = originLng,
                                            buildingId = building.id,
                                            mode = newMode,
                                        )
                                    } catch (e: Exception) {
                                        snack.show(e.message ?: "Failed to recalculate route")
                                    } finally {
                                        isCalculatingRoute = false
                                    }
                                }
                            }
                        },
                        onCalculateRoute = {
                            scope.launch {
                                isCalculatingRoute = true
                                try {
                                    val originLat = userFix?.latitude ?: campusData.center.latitude
                                    val originLng = userFix?.longitude ?: campusData.center.longitude
                                    currentRoute = app.api.campusMap.route(
                                        originLat = originLat,
                                        originLng = originLng,
                                        buildingId = building.id,
                                        mode = travelMode,
                                    )
                                } catch (e: Exception) {
                                    snack.show(e.message ?: "Routing error")
                                } finally {
                                    isCalculatingRoute = false
                                }
                            }
                        },
                        onToggleSteps = { showSteps = !showSteps },
                        onClose = {
                            selectedBuilding = null
                            currentRoute = null
                            showSteps = false
                        },
                        onStartSafeWalk = {
                            nav.navigate(Routes.SafeWalk)
                        },
                    )
                }

                // Buildings Directory list
                SectionHeader(
                    title = "Campus Buildings (${filteredBuildings.size})",
                    action = if (selectedBuilding != null) "Clear selection" else null,
                    onAction = {
                        selectedBuilding = null
                        currentRoute = null
                        showSteps = false
                    },
                )

                if (filteredBuildings.isEmpty()) {
                    EmptyState(
                        title = "No buildings found",
                        message = "Try searching with a different name, block code, or category.",
                        icon = Icons.Rounded.Search,
                    )
                } else {
                    LazyColumn(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(380.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        items(filteredBuildings, key = { it.id }) { b ->
                            BuildingRowItem(
                                building = b,
                                isSelected = selectedBuilding?.id == b.id,
                                onClick = {
                                    selectedBuilding = b
                                    currentRoute = null
                                    showSteps = false
                                },
                            )
                        }
                    }
                }
            }
        }
    }

    // Map Issue Dialog
    if (showReportDialog) {
        MapReportDialog(
            onDismiss = { showReportDialog = false },
            onSubmit = { reportType, locationLabel, description ->
                scope.launch {
                    try {
                        app.api.campusMap.reportIssue(
                            reportType = reportType,
                            locationLabel = locationLabel,
                            description = description,
                            lat = userFix?.latitude,
                            lng = userFix?.longitude,
                        )
                        snack.show("Thank you! Map report submitted for safety review.")
                        showReportDialog = false
                    } catch (e: Exception) {
                        snack.show(e.message ?: "Failed to submit report")
                    }
                }
            },
        )
    }
}

// ------------------------------------------------------------------ Components

@Composable
private fun EmergencyShortcutsRow(onSelectEmergency: (String) -> Unit) {
    LazyRow(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        item {
            EmergencyShortcutChip(
                label = "Security Post",
                icon = Icons.Rounded.Security,
                color = CcColors.Amber,
                onClick = { onSelectEmergency("security_office") },
            )
        }
        item {
            EmergencyShortcutChip(
                label = "Medical Room",
                icon = Icons.Rounded.LocalHospital,
                color = CcColors.Rose,
                onClick = { onSelectEmergency("medical") },
            )
        }
        item {
            EmergencyShortcutChip(
                label = "Assembly Point",
                icon = Icons.Rounded.Shield,
                color = CcColors.Sos,
                onClick = { onSelectEmergency("assembly_point") },
            )
        }
        item {
            EmergencyShortcutChip(
                label = "Main Gate",
                icon = Icons.Rounded.MeetingRoom,
                color = CcColors.Sky,
                onClick = { onSelectEmergency("gate") },
            )
        }
    }
}

@Composable
private fun EmergencyShortcutChip(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, color: Color, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(12.dp))
            .background(color.copy(alpha = 0.12f))
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(imageVector = icon, contentDescription = null, tint = color, modifier = Modifier.size(14.dp))
        Text(text = label, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, color = color)
    }
}

@Composable
private fun BuildingNavigationCard(
    building: CampusBuildingItem,
    travelMode: String,
    route: RouteCalculationResponse?,
    isCalculating: Boolean,
    showSteps: Boolean,
    onModeChange: (String) -> Unit,
    onCalculateRoute: () -> Unit,
    onToggleSteps: () -> Unit,
    onClose: () -> Unit,
    onStartSafeWalk: () -> Unit,
) {
    val context = LocalContext.current
    CcCard(
        modifier = Modifier.fillMaxWidth(),
        color = Color.White,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            // Header
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(text = building.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = CcColors.Ink)
                        StatusChip(text = building.code, tone = Tone.Brand)
                    }
                    if (building.description.isNotBlank()) {
                        Text(text = building.description, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                    }
                }
                IconButton(onClick = onClose, modifier = Modifier.size(24.dp)) {
                    Icon(imageVector = Icons.Rounded.Close, contentDescription = "Close", tint = CcColors.InkSoft)
                }
            }

            // Facility meta info
            if (!building.operatingHours.isNullOrBlank() || !building.contactPhone.isNullOrBlank()) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (!building.operatingHours.isNullOrBlank()) {
                        Text(text = "Hours: ${building.operatingHours}", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
                    }
                    if (!building.contactPhone.isNullOrBlank()) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.clickable { context.dial(building.contactPhone) },
                        ) {
                            Icon(imageVector = Icons.Rounded.Call, contentDescription = null, tint = CcColors.Emerald, modifier = Modifier.size(12.dp))
                            Spacer(Modifier.width(4.dp))
                            Text(text = building.contactPhone, style = MaterialTheme.typography.labelSmall, color = CcColors.Emerald)
                        }
                    }
                }
            }

            // Entrances Info
            if (building.entrances.isNotEmpty()) {
                Text(text = "Entrances:", style = MaterialTheme.typography.labelSmall, color = CcColors.Ink)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    building.entrances.forEach { ent ->
                        val chipColor = if (ent.isAccessible) CcColors.Emerald else CcColors.Sky
                        Row(
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .background(chipColor.copy(alpha = 0.1f))
                                .padding(horizontal = 6.dp, vertical = 3.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            if (ent.isAccessible) {
                                Icon(imageVector = Icons.Rounded.Accessibility, contentDescription = "Wheelchair ramp", tint = CcColors.Emerald, modifier = Modifier.size(12.dp))
                            }
                            Text(text = ent.name, style = MaterialTheme.typography.labelSmall, color = chipColor)
                        }
                    }
                }
            }

            // Calculated Route Summary
            if (route != null) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(CcColors.Mint.copy(alpha = 0.25f))
                        .padding(10.dp),
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Icon(imageVector = Icons.Rounded.Navigation, contentDescription = null, tint = CcColors.Forest, modifier = Modifier.size(16.dp))
                                val estMinutes = kotlin.math.round(route.durationSeconds / 60.0).toInt().coerceAtLeast(1)
                                Text(
                                    text = "$estMinutes min walk • ${route.distanceMeters.toInt()} m",
                                    style = MaterialTheme.typography.labelLarge,
                                    fontWeight = FontWeight.Bold,
                                    color = CcColors.Forest,
                                )
                            }
                            if (route.mode == "wheelchair" || route.destinationEntrance?.isAccessible == true) {
                                StatusChip(text = "Accessible Ramp Route", tone = Tone.Brand)
                            }
                        }

                        if (route.steps.isNotEmpty()) {
                            CcButton(
                                text = if (showSteps) "Hide Navigation Steps" else "View Turn-by-Turn (${route.steps.size} steps)",
                                onClick = onToggleSteps,
                                kind = ButtonKind.Outline,
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                    }
                }

                // Turn-by-turn guidance list
                if (showSteps && route.steps.isNotEmpty()) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(CcColors.Cream)
                            .padding(8.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        route.steps.forEachIndexed { idx, step ->
                            Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(text = "${idx + 1}.", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, color = CcColors.Forest)
                                Column {
                                    Text(text = step.instruction, style = MaterialTheme.typography.bodySmall, color = CcColors.Ink)
                                    Text(text = "${step.distanceMeters.toInt()} m", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
                                }
                            }
                        }
                    }
                }
            }

            // Mode Selector & Route Action Row
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // Mode switcher
                ChoiceChips(
                    options = listOf("walking" to "Walking", "wheelchair" to "Wheelchair"),
                    selected = travelMode,
                    onSelect = onModeChange,
                    modifier = Modifier.weight(1f),
                )

                CcButton(
                    text = if (isCalculating) "Routing..." else if (route == null) "Get Route" else "Recalculate",
                    onClick = onCalculateRoute,
                    kind = ButtonKind.Primary,
                )
            }

            // Safe Walk Action Link
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(onClick = onStartSafeWalk)
                    .padding(vertical = 4.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(imageVector = Icons.AutoMirrored.Rounded.DirectionsWalk, contentDescription = null, tint = CcColors.Emerald, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Text(text = "Request Safe Walk along this route", style = MaterialTheme.typography.labelMedium, color = CcColors.Emerald)
            }
        }
    }
}

@Composable
private fun BuildingRowItem(building: CampusBuildingItem, isSelected: Boolean, onClick: () -> Unit) {
    val chipColor = buildingColor(building.category)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(if (isSelected) chipColor.copy(alpha = 0.12f) else Color.White)
            .border(1.dp, if (isSelected) chipColor else CcColors.Line, RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            modifier = Modifier
                .size(36.dp)
                .clip(CircleShape)
                .background(chipColor.copy(alpha = 0.2f)),
            contentAlignment = Alignment.Center,
        ) {
            Text(text = building.code.take(3), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, color = chipColor)
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(text = building.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = CcColors.Ink)
            if (building.description.isNotBlank()) {
                Text(text = building.description, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft, maxLines = 1)
            }
        }
        Icon(imageVector = Icons.Rounded.Explore, contentDescription = "Select", tint = if (isSelected) chipColor else CcColors.InkFaint, modifier = Modifier.size(18.dp))
    }
}

@Composable
private fun MapReportDialog(onDismiss: () -> Unit, onSubmit: (reportType: String, locationLabel: String, description: String) -> Unit) {
    var type by remember { mutableStateOf("closed_pathway") }
    var label by remember { mutableStateOf("") }
    var desc by remember { mutableStateOf("") }

    androidx.compose.ui.window.Dialog(onDismissRequest = onDismiss) {
        CcCard(modifier = Modifier.fillMaxWidth(), color = Color.White) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(text = "Report Campus Map Issue", style = MaterialTheme.typography.titleMedium, color = CcColors.Ink)
                Text(text = "Help keep campus pathways accurate and safe for all students.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)

                ChoiceChips(
                    options = listOf(
                        "closed_pathway" to "Closed Path",
                        "blocked_entrance" to "Blocked Door",
                        "accessibility_barrier" to "Accessibility Barrier",
                        "incorrect_location" to "Incorrect Pin",
                    ),
                    selected = type,
                    onSelect = { type = it },
                )

                CcTextField(
                    value = label,
                    onValueChange = { label = it },
                    label = "Location Description",
                    placeholder = "e.g. Science Block B walkway",
                )

                CcTextField(
                    value = desc,
                    onValueChange = { desc = it },
                    label = "Details",
                    placeholder = "Explain what is blocked, closed, or inaccurate...",
                    singleLine = false,
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                ) {
                    CcButton(text = "Cancel", onClick = onDismiss, kind = ButtonKind.Outline)
                    Spacer(Modifier.width(8.dp))
                    CcButton(
                        text = "Submit Report",
                        onClick = {
                            if (label.isNotBlank() && desc.isNotBlank()) {
                                onSubmit(type, label.trim(), desc.trim())
                            }
                        },
                        kind = ButtonKind.Primary,
                    )
                }
            }
        }
    }
}

// ------------------------------------------------------------------ Hazard reports

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
    val requestLocation = rememberLocationRequest { granted ->
        if (granted) scope.launch { fix = LocationHelper.current(context) }
    }

    CcScreen(
        title = "Report a Hazard",
        subtitle = "Poor lighting, broken infrastructure, unsafe spots",
        onBack = { nav.popBackStack() },
        refreshing = mine.refreshing,
        onRefresh = { mine.reload() },
    ) {
        InfoBanner("Hazards are reviewed before they appear on the map. Your name is never shown publicly.", icon = Icons.Rounded.Shield)
        Text("What kind of hazard?", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
        Catalog.hazardCategories.chunked(2).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { (key, label, icon) ->
                    val on = key == category
                    Row(
                        Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(14.dp))
                            .background(if (on) CcColors.AmberSoft else Color.White)
                            .border(if (on) 2.dp else 1.dp, if (on) CcColors.Amber else CcColors.Line, RoundedCornerShape(14.dp))
                            .clickable(role = Role.RadioButton) { category = key }
                            .padding(12.dp),
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
        CcTextField(
            place,
            { place = it; errors = errors - "locationLabel" },
            label = "Where is it?",
            placeholder = "e.g. Path between Block A and the library",
            leadingIcon = Icons.Rounded.Place,
            error = errors["locationLabel"],
            maxLength = 200,
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(if (fix != null) "Map location added" else "Add your current location to place it on the map", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft, modifier = Modifier.weight(1f))
            if (fix == null) {
                CcButton(
                    "Use my location",
                    {
                        if (LocationHelper.hasPermission(context)) {
                            scope.launch { fix = LocationHelper.current(context) }
                        } else {
                            requestLocation()
                        }
                    },
                    kind = ButtonKind.Soft,
                    leadingIcon = Icons.Rounded.MyLocation,
                )
            } else {
                IconButton(onClick = { fix = null }) {
                    Icon(Icons.Rounded.Close, contentDescription = "Remove location")
                }
            }
        }
        CcTextField(
            description,
            { description = it; errors = errors - "description" },
            label = "Describe the hazard",
            leadingIcon = Icons.Rounded.Description,
            error = errors["description"],
            singleLine = false,
            minLines = 3,
            maxLength = 1000,
        )
        SwitchRow("Submit anonymously", anonymous, { anonymous = it }, description = "Moderators won't see who reported it.")
        CcButton(
            "Submit hazard report",
            {
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
                        description = ""
                        place = ""
                        fix = null
                        mine.reload()
                    } catch (e: ApiException) {
                        if (e.fields.isNotEmpty()) errors = e.fields
                        snack.error(e)
                    } finally {
                        busy = false
                    }
                }
            },
            Modifier.fillMaxWidth(),
            loading = busy,
            kind = ButtonKind.Danger,
            leadingIcon = Icons.Rounded.Warning,
        )

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
