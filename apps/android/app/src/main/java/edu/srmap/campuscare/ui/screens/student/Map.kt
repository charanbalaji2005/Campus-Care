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
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.CampusBuildingItem
import edu.srmap.campuscare.data.CampusMapData
import edu.srmap.campuscare.data.RouteCalculationResponse
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.CcTextField
import edu.srmap.campuscare.ui.components.ChoiceChips
import edu.srmap.campuscare.ui.components.IconBadge
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.MapPin
import edu.srmap.campuscare.ui.components.OsmMap
import edu.srmap.campuscare.ui.components.SectionHeader
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.components.rememberLocationRequest
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.Fix
import edu.srmap.campuscare.util.LocationHelper
import edu.srmap.campuscare.util.dial
import kotlinx.coroutines.launch

private fun buildingColor(category: String): Color = when (category) {
    "security_office" -> CcColors.Forest
    "medical" -> CcColors.Rose
    "assembly_point" -> CcColors.Amber
    "library" -> CcColors.Emerald
    "hostel" -> CcColors.Violet
    "cafeteria" -> CcColors.Orange
    "gate" -> CcColors.InkSoft
    else -> CcColors.Sky
}

/**
 * Interactive Campus Map with Dijkstra pathway routing, wheelchair accessibility,
 * directory search, temporary closure avoidance, and emergency hub access.
 */
@Composable
fun SafetyMapScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    val mapLoad = rememberLoad { app.api.campusMap.data() }

    var myLocationEnabled by rememberSaveable { mutableStateOf(false) }
    var userFix by remember { mutableStateOf<Fix?>(null) }
    val requestLocation = rememberLocationRequest { granted ->
        myLocationEnabled = granted
        if (granted) {
            scope.launch {
                userFix = LocationHelper.quickFix(context)
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
                        label = b.code,
                        color = buildingColor(b.category),
                    )
                }
            }

            // Route coordinates for OsmMap polyline
            val routeCoords = remember(currentRoute) {
                currentRoute?.geometry?.map { it[0] to it[1] } ?: emptyList()
            }

            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                // Emergency Quick Access Bar
                EmergencyShortcutsRow(
                    onSelectEmergency = { category ->
                        val target = campusData.emergencyLocations.firstOrNull { it.category == category }
                            ?: allBuildings.firstOrNull { it.category == category || it.isEmergencyLocation }
                        if (target != null) {
                            selectedBuilding = target
                            // Trigger auto-route if user position is available
                            if (userFix != null) {
                                scope.launch {
                                    isCalculatingRoute = true
                                    try {
                                        currentRoute = app.api.campusMap.route(
                                            originLat = userFix!!.latitude,
                                            originLng = userFix!!.longitude,
                                            buildingId = target.id,
                                            mode = travelMode,
                                        )
                                    } catch (e: Exception) {
                                        snack.error("Failed to calculate route: ${e.message}")
                                    } finally {
                                        isCalculatingRoute = false
                                    }
                                }
                            }
                        } else {
                            snack.show("No ${category.replace('_', ' ')} facility currently mapped.")
                        }
                    },
                )

                // Search & Filter Box
                CcTextField(
                    value = query,
                    onValueChange = { query = it },
                    placeholder = "Search academic blocks, hostels, library...",
                    leadingIcon = Icons.Rounded.Search,
                    trailingIcon = if (query.isNotBlank()) Icons.Rounded.Close else null,
                    onTrailingIconClick = { query = "" },
                )

                ChoiceChips(
                    items = listOf(
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
                        .border(1.dp, CcColors.CreamDark, RoundedCornerShape(16.dp)),
                ) {
                    OsmMap(
                        centerLat = selectedBuilding?.latitude ?: campusData.center.latitude,
                        centerLng = selectedBuilding?.longitude ?: campusData.center.longitude,
                        zoom = if (selectedBuilding != null) 17.5 else campusData.center.zoom,
                        pins = pins,
                        showMyLocation = myLocationEnabled && userFix != null,
                        route = routeCoords,
                        onPinClick = { pin ->
                            selectedBuilding = allBuildings.firstOrNull { it.id == pin.id }
                        },
                        modifier = Modifier.fillMaxSize(),
                    )

                    // Top GPS status / permission toggle
                    Row(
                        modifier = Modifier
                            .align(Alignment.TopEnd)
                            .padding(8.dp),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        IconButton(
                            onClick = {
                                if (!myLocationEnabled) {
                                    requestLocation()
                                } else {
                                    scope.launch { userFix = LocationHelper.quickFix(context) }
                                }
                            },
                            modifier = Modifier
                                .size(38.dp)
                                .shadow(4.dp, CircleShape)
                                .background(Color.White, CircleShape),
                        ) {
                            Icon(
                                imageVector = Icons.Rounded.MyLocation,
                                contentDescription = "My Location",
                                tint = if (myLocationEnabled && userFix != null) CcColors.Emerald else CcColors.InkSoft,
                                modifier = Modifier.size(20.dp),
                            )
                        }

                        IconButton(
                            onClick = { showReportDialog = true },
                            modifier = Modifier
                                .size(38.dp)
                                .shadow(4.dp, CircleShape)
                                .background(Color.White, CircleShape),
                        ) {
                            Icon(
                                imageVector = Icons.Rounded.Report,
                                contentDescription = "Report Map Issue",
                                tint = CcColors.Rose,
                                modifier = Modifier.size(20.dp),
                            )
                        }
                    }

                    // Travel Mode Badge overlay
                    if (currentRoute != null) {
                        Box(
                            modifier = Modifier
                                .align(Alignment.BottomStart)
                                .padding(8.dp)
                                .shadow(2.dp, RoundedCornerShape(8.dp))
                                .background(Color.White.copy(alpha = 0.95f), RoundedCornerShape(8.dp))
                                .padding(horizontal = 8.dp, vertical = 4.dp),
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                Icon(
                                    imageVector = if (travelMode == "accessible") Icons.Rounded.Accessibility else Icons.AutoMirrored.Rounded.DirectionsWalk,
                                    contentDescription = null,
                                    tint = CcColors.Emerald,
                                    modifier = Modifier.size(14.dp),
                                )
                                Text(
                                    text = if (travelMode == "accessible") "Wheelchair / Ramp Route" else "Pedestrian Pathway",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = CcColors.Ink,
                                )
                            }
                        }
                    }
                }

                // Selected Building / Route Summary Card
                if (selectedBuilding != null) {
                    BuildingNavigationCard(
                        building = selectedBuilding!!,
                        userFix = userFix,
                        route = currentRoute,
                        travelMode = travelMode,
                        isCalculating = isCalculatingRoute,
                        showSteps = showSteps,
                        onModeChange = { newMode ->
                            travelMode = newMode
                            if (userFix != null) {
                                scope.launch {
                                    isCalculatingRoute = true
                                    try {
                                        currentRoute = app.api.campusMap.route(
                                            originLat = userFix!!.latitude,
                                            originLng = userFix!!.longitude,
                                            buildingId = selectedBuilding!!.id,
                                            mode = newMode,
                                        )
                                    } finally {
                                        isCalculatingRoute = false
                                    }
                                }
                            }
                        },
                        onCalculateRoute = {
                            if (userFix == null) {
                                snack.show("Turn on location to route from your current position")
                                requestLocation()
                            } else {
                                scope.launch {
                                    isCalculatingRoute = true
                                    try {
                                        currentRoute = app.api.campusMap.route(
                                            originLat = userFix!!.latitude,
                                            originLng = userFix!!.longitude,
                                            buildingId = selectedBuilding!!.id,
                                            mode = travelMode,
                                        )
                                    } catch (e: Exception) {
                                        snack.error("Routing error: ${e.message}")
                                    } finally {
                                        isCalculatingRoute = false
                                    }
                                }
                            }
                        },
                        onToggleSteps = { showSteps = !showSteps },
                        onStartSafeWalk = {
                            nav.navigate(Routes.SafeWalk)
                        },
                        onClose = {
                            selectedBuilding = null
                            currentRoute = null
                        },
                    )
                }

                // Building Directory Section
                SectionHeader("Campus Buildings (${filteredBuildings.size})")
                LazyColumn(
                    modifier = Modifier.height(280.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(filteredBuildings, key = { it.id }) { b ->
                        BuildingRowItem(
                            building = b,
                            isSelected = selectedBuilding?.id == b.id,
                            onClick = {
                                selectedBuilding = b
                                currentRoute = null
                            },
                        )
                    }
                }
            }
        }

        // Report Issue Dialog
        if (showReportDialog) {
            MapReportDialog(
                onDismiss = { showReportDialog = false },
                onSubmit = { type, label, desc ->
                    scope.launch {
                        try {
                            app.api.campusMap.reportIssue(
                                reportType = type,
                                locationLabel = label,
                                description = desc,
                                lat = userFix?.latitude,
                                lng = userFix?.longitude,
                            )
                            snack.show("Report submitted. Campus team will review it.")
                            showReportDialog = false
                        } catch (e: ApiException) {
                            snack.error(e)
                        }
                    }
                },
            )
        }
    }
}

@Composable
private fun EmergencyShortcutsRow(onSelectEmergency: (String) -> Unit) {
    LazyRow(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        item {
            EmergencyShortcutChip("Security Office", Icons.Rounded.Security, CcColors.Forest) {
                onSelectEmergency("security_office")
            }
        }
        item {
            EmergencyShortcutChip("Medical Center", Icons.Rounded.LocalHospital, CcColors.Rose) {
                onSelectEmergency("medical")
            }
        }
        item {
            EmergencyShortcutChip("Assembly Points", Icons.Rounded.Warning, CcColors.Amber) {
                onSelectEmergency("assembly_point")
            }
        }
        item {
            EmergencyShortcutChip("Main Gates", Icons.Rounded.Explore, CcColors.InkSoft) {
                onSelectEmergency("gate")
            }
        }
    }
}

@Composable
private fun EmergencyShortcutChip(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, color: Color, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        modifier = Modifier
            .clip(RoundedCornerShape(20.dp))
            .background(color.copy(alpha = 0.12f))
            .border(1.dp, color.copy(alpha = 0.3f), RoundedCornerShape(20.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 6.dp),
    ) {
        Icon(imageVector = icon, contentDescription = null, tint = color, modifier = Modifier.size(16.dp))
        Text(text = label, style = MaterialTheme.typography.labelSmall, color = CcColors.Ink)
    }
}

@Composable
private fun BuildingNavigationCard(
    building: CampusBuildingItem,
    userFix: Fix?,
    route: RouteCalculationResponse?,
    travelMode: String,
    isCalculating: Boolean,
    showSteps: Boolean,
    onModeChange: (String) -> Unit,
    onCalculateRoute: () -> Unit,
    onToggleSteps: () -> Unit,
    onStartSafeWalk: () -> Unit,
    onClose: () -> Unit,
) {
    val context = LocalContext.current

    CcCard(
        border = true,
        color = Color.White,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            // Header
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(text = building.code, style = MaterialTheme.typography.labelSmall, color = CcColors.Emerald)
                    Text(text = building.name, style = MaterialTheme.typography.titleMedium, color = CcColors.Ink)
                    if (building.description.isNotBlank()) {
                        Text(text = building.description, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                    }
                }
                IconButton(onClick = onClose, modifier = Modifier.size(24.dp)) {
                    Icon(imageVector = Icons.Rounded.Close, contentDescription = "Close", tint = CcColors.InkSoft)
                }
            }

            // Contact / Hours row
            if (!building.contactPhone.isNullOrBlank() || !building.operatingHours.isNullOrBlank()) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (!building.operatingHours.isNullOrBlank()) {
                        Text(text = "Hours: ${building.operatingHours}", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
                    }
                    if (!building.contactPhone.isNullOrBlank()) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.clickable { dial(context, building.contactPhone) },
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
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier
                                .clip(RoundedCornerShape(6.dp))
                                .background(chipColor.copy(alpha = 0.1f))
                                .padding(horizontal = 6.dp, vertical = 2.dp),
                        ) {
                            if (ent.isAccessible) {
                                Icon(imageVector = Icons.Rounded.Accessibility, contentDescription = null, tint = CcColors.Emerald, modifier = Modifier.size(10.dp))
                                Spacer(Modifier.width(2.dp))
                            }
                            Text(text = ent.name, style = MaterialTheme.typography.labelSmall, color = chipColor)
                        }
                    }
                }
            }

            // Route metrics if calculated
            if (route != null) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(CcColors.Emerald.copy(alpha = 0.08f))
                        .padding(8.dp),
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column {
                            Text(text = "${route.distanceMeters.toInt()} meters", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                            Text(text = "Walking time: ~${(route.durationSeconds / 60).toInt()} min", style = MaterialTheme.typography.labelSmall, color = CcColors.Emerald)
                        }
                        CcButton(
                            text = if (showSteps) "Hide Steps" else "Directions",
                            kind = ButtonKind.Secondary,
                            onClick = onToggleSteps,
                        )
                    }
                }

                // Turn by turn steps
                if (showSteps && route.steps.isNotEmpty()) {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                        modifier = Modifier.padding(top = 4.dp),
                    ) {
                        route.steps.forEachIndexed { i, s ->
                            Row(
                                verticalAlignment = Alignment.Top,
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                Text(text = "${i + 1}.", style = MaterialTheme.typography.labelSmall, color = CcColors.Emerald)
                                Text(text = s.instruction, style = MaterialTheme.typography.bodySmall, color = CcColors.Ink)
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
                    items = listOf("walking" to "Walking", "accessible" to "Wheelchair"),
                    selected = travelMode,
                    onSelect = onModeChange,
                    modifier = Modifier.weight(1f),
                )

                CcButton(
                    text = if (isCalculating) "Routing..." else if (route == null) "Get Route" else "Recalculate",
                    kind = ButtonKind.Primary,
                    onClick = onCalculateRoute,
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
private fun BuildingRowItem(
    building: CampusBuildingItem,
    isSelected: Boolean,
    onClick: () -> Unit,
) {
    val color = buildingColor(building.category)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(if (isSelected) color.copy(alpha = 0.1f) else Color.White)
            .border(
                1.dp,
                if (isSelected) color else CcColors.CreamDark,
                RoundedCornerShape(12.dp),
            )
            .clickable(onClick = onClick)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .clip(CircleShape)
                    .background(color.copy(alpha = 0.15f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(imageVector = Icons.Rounded.Place, contentDescription = null, tint = color, modifier = Modifier.size(18.dp))
            }
            Column {
                Text(text = building.name, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                Text(text = "${building.code} • ${building.category.replace('_', ' ')}", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
            }
        }

        if (building.entrances.any { it.isAccessible }) {
            Icon(imageVector = Icons.Rounded.Accessibility, contentDescription = "Accessible", tint = CcColors.Emerald, modifier = Modifier.size(16.dp))
        }
    }
}

@Composable
private fun MapReportDialog(
    onDismiss: () -> Unit,
    onSubmit: (type: String, label: String, desc: String) -> Unit,
) {
    var type by remember { mutableStateOf("closed_pathway") }
    var label by remember { mutableStateOf("") }
    var desc by remember { mutableStateOf("") }

    androidx.compose.ui.window.Dialog(onDismissRequest = onDismiss) {
        CcCard(modifier = Modifier.fillMaxWidth(), color = Color.White) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(text = "Report Campus Map Issue", style = MaterialTheme.typography.titleMedium, color = CcColors.Ink)
                Text(text = "Help keep campus pathways accurate and safe for all students.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)

                ChoiceChips(
                    items = listOf(
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
                    CcButton(text = "Cancel", kind = ButtonKind.Secondary, onClick = onDismiss)
                    Spacer(Modifier.width(8.dp))
                    CcButton(
                        text = "Submit Report",
                        kind = ButtonKind.Primary,
                        onClick = {
                            if (label.isNotBlank() && desc.isNotBlank()) {
                                onSubmit(type, label.trim(), desc.trim())
                            }
                        },
                    )
                }
            }
        }
    }
}
