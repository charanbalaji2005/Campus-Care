package edu.srmap.campuscare.ui.screens.staff

import android.content.Intent
import android.net.Uri
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Call
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.LocationOn
import androidx.compose.material.icons.rounded.Navigation
import androidx.compose.material.icons.rounded.NotificationsActive
import androidx.compose.material.icons.rounded.PersonPinCircle
import androidx.compose.material.icons.rounded.Videocam
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import edu.srmap.campuscare.data.SecurityMapData
import edu.srmap.campuscare.data.SecurityMapOfficerPin
import edu.srmap.campuscare.data.SecurityMapSosPin
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.SkeletonList
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.theme.CcColors

/**
 * Screen 3: Live Campus Map & Navigation (Part A)
 *
 * Visual elements matching reference:
 * - Campus dropdown selector ("Main Campus", "North Campus", "South Campus")
 * - Visual live campus map representation:
 *   - Pulsing red SOS pinpoint at Library Block
 *   - Green officer locations (Officer Kumar (You), Officer Ravi, Officer Sita)
 *   - Campus landmark buildings: Library, Sports Complex, Hostel, Cafeteria
 * - Bottom filter chips: All, SOS (1), Officers (3), CCTV (12), Checkpoints (6)
 * - Active Incident bottom banner: ETA 2 mins • 0.4 km, [Start Navigation], [Call Student]
 */
@Composable
fun SecurityMapScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val context = LocalContext.current

    var selectedCampus by remember { mutableStateOf("main") }
    var selectedCampusLabel by remember { mutableStateOf("Main Campus") }
    var campusMenuExpanded by remember { mutableStateOf(false) }
    var selectedFilter by remember { mutableStateOf("All") }

    val mapLoad = rememberLoad(selectedCampus) {
        app.api.securityPortal.map(campus = selectedCampus)
    }

    CcScreen(
        title = "Live Campus Map",
        subtitle = "Emergency tracking & officers",
        actions = {
            // Campus Dropdown
            Box {
                Row(
                    modifier = Modifier
                        .clip(RoundedCornerShape(20.dp))
                        .background(CcColors.Forest.copy(alpha = 0.1f))
                        .clickable { campusMenuExpanded = true }
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text(
                        text = selectedCampusLabel,
                        fontWeight = FontWeight.Bold,
                        fontSize = 12.sp,
                        color = CcColors.Forest,
                    )
                    Icon(
                        imageVector = Icons.Rounded.ExpandMore,
                        contentDescription = "Select Campus",
                        tint = CcColors.Forest,
                        modifier = Modifier.size(16.dp),
                    )
                }

                DropdownMenu(
                    expanded = campusMenuExpanded,
                    onDismissRequest = { campusMenuExpanded = false },
                ) {
                    DropdownMenuItem(
                        text = { Text("Main Campus") },
                        onClick = {
                            selectedCampus = "main"
                            selectedCampusLabel = "Main Campus"
                            campusMenuExpanded = false
                        },
                    )
                    DropdownMenuItem(
                        text = { Text("North Campus") },
                        onClick = {
                            selectedCampus = "north"
                            selectedCampusLabel = "North Campus"
                            campusMenuExpanded = false
                        },
                    )
                    DropdownMenuItem(
                        text = { Text("South Campus") },
                        onClick = {
                            selectedCampus = "south"
                            selectedCampusLabel = "South Campus"
                            campusMenuExpanded = false
                        },
                    )
                }
            }
        },
        onRefresh = { mapLoad.reload() },
    ) {
        LoadContent(
            mapLoad,
            skeleton = { SkeletonList(3) },
        ) { data ->
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                // Filter chips row
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    listOf(
                        "All",
                        "SOS (${data.sosPins.size})",
                        "Officers (${data.officerPins.size})",
                        "Checkpoints (6)",
                    ).forEach { chip ->
                        val isSelected = selectedFilter == chip
                        FilterChip(
                            selected = isSelected,
                            onClick = { selectedFilter = chip },
                            label = { Text(chip, fontSize = 12.sp) },
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = CcColors.Forest,
                                selectedLabelColor = Color.White,
                            ),
                        )
                    }
                }

                // Interactive Campus Map Canvas representation
                LiveCampusMapCanvas(
                    data = data,
                    filter = selectedFilter,
                    onSosPinClick = { sosPin ->
                        nav.navigate(Routes.securityResponse(sosPin.id))
                    },
                )

                // Active Incident Bottom Action Card
                val activeSos = data.sosPins.firstOrNull()
                if (activeSos != null) {
                    ActiveIncidentMapBanner(
                        sosPin = activeSos,
                        onStartNavigation = {
                            snack.show("Turn-by-turn navigation started to ${activeSos.locationLabel}")
                        },
                        onCallStudent = {
                            val intent = Intent(Intent.ACTION_DIAL, Uri.parse("tel:+919876543210"))
                            context.startActivity(intent)
                        },
                        onViewDetails = {
                            nav.navigate(Routes.securityResponse(activeSos.id))
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun LiveCampusMapCanvas(
    data: SecurityMapData,
    filter: String,
    onSosPinClick: (SecurityMapSosPin) -> Unit,
) {
    val infiniteTransition = rememberInfiniteTransition(label = "pulse")
    val pulseScale by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = 1.35f,
        animationSpec = infiniteRepeatable(
            animation = tween(1000),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "pulseScale",
    )

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(340.dp)
            .clip(RoundedCornerShape(20.dp))
            .background(Color(0xFFE5EDE6))
            .border(1.dp, CcColors.Forest.copy(alpha = 0.15f), RoundedCornerShape(20.dp)),
    ) {
        // Campus Map Graphical Ground
        // Landmark Buildings
        data.landmarks.forEachIndexed { idx, lm ->
            val (xOffset, yOffset) = when (idx) {
                0 -> Pair(40.dp, 60.dp) // Library
                1 -> Pair(200.dp, 80.dp) // Sports
                2 -> Pair(60.dp, 200.dp) // Hostel
                else -> Pair(220.dp, 210.dp) // Cafeteria
            }

            Box(
                modifier = Modifier
                    .padding(start = xOffset, top = yOffset)
                    .clip(RoundedCornerShape(8.dp))
                    .background(Color.White.copy(alpha = 0.85f))
                    .border(1.dp, CcColors.InkSoft.copy(alpha = 0.2f), RoundedCornerShape(8.dp))
                    .padding(horizontal = 8.dp, vertical = 4.dp),
            ) {
                Text(
                    text = lm.label,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = CcColors.Ink,
                )
            }
        }

        // Officer Markers (Green Pins)
        if (filter == "All" || filter.startsWith("Officers")) {
            data.officerPins.forEachIndexed { idx, officer ->
                val (xOffset, yOffset) = when (idx) {
                    0 -> Pair(90.dp, 130.dp) // You
                    1 -> Pair(160.dp, 110.dp) // Ravi
                    else -> Pair(50.dp, 100.dp) // Sita
                }

                Row(
                    modifier = Modifier
                        .padding(start = xOffset, top = yOffset)
                        .clip(RoundedCornerShape(12.dp))
                        .background(CcColors.Forest)
                        .padding(horizontal = 6.dp, vertical = 3.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Box(
                        modifier = Modifier
                            .size(8.dp)
                            .clip(CircleShape)
                            .background(Color(0xFF4ADE80)),
                    )
                    Text(
                        text = officer.name,
                        color = Color.White,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
        }

        // Active Pulsing SOS Pin
        if (filter == "All" || filter.startsWith("SOS")) {
            data.sosPins.forEach { pin ->
                Column(
                    modifier = Modifier
                        .padding(start = 30.dp, top = 20.dp)
                        .clickable { onSosPinClick(pin) },
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        // Pulsing halo
                        Box(
                            modifier = Modifier
                                .size(46.dp)
                                .scale(pulseScale)
                                .clip(CircleShape)
                                .background(Color(0x55EF4444)),
                        )
                        // Inner Red SOS badge
                        Box(
                            modifier = Modifier
                                .size(34.dp)
                                .clip(CircleShape)
                                .background(Color(0xFFDC2626))
                                .border(2.dp, Color.White, CircleShape),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                imageVector = Icons.Rounded.NotificationsActive,
                                contentDescription = null,
                                tint = Color.White,
                                modifier = Modifier.size(18.dp),
                            )
                        }
                    }

                    // Label Box
                    Box(
                        modifier = Modifier
                            .padding(top = 4.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(Color(0xFFDC2626))
                            .padding(horizontal = 6.dp, vertical = 2.dp),
                    ) {
                        Text(
                            text = "${pin.studentName} • SOS",
                            color = Color.White,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Black,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ActiveIncidentMapBanner(
    sosPin: SecurityMapSosPin,
    onStartNavigation: () -> Unit,
    onCallStudent: () -> Unit,
    onViewDetails: () -> Unit,
) {
    CcCard(
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(
                        modifier = Modifier
                            .size(10.dp)
                            .clip(CircleShape)
                            .background(CcColors.Sos),
                    )
                    Text(
                        text = "ACTIVE: ${sosPin.locationLabel}",
                        fontWeight = FontWeight.Bold,
                        fontSize = 13.sp,
                        color = CcColors.Sos,
                    )
                }

                Text(
                    text = "ETA: 2 mins • 0.4 km",
                    fontWeight = FontWeight.Medium,
                    fontSize = 12.sp,
                    color = CcColors.InkSoft,
                )
            }

            Text(
                text = "${sosPin.studentName} reported emergency nearby. Responders currently en route.",
                style = MaterialTheme.typography.bodySmall,
                color = CcColors.Ink,
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                CcButton(
                    text = "Start Navigation",
                    onClick = onStartNavigation,
                    leadingIcon = Icons.Rounded.Navigation,
                    kind = ButtonKind.Primary,
                    modifier = Modifier.weight(1f),
                )
                CcButton(
                    text = "Call",
                    onClick = onCallStudent,
                    leadingIcon = Icons.Rounded.Call,
                    kind = ButtonKind.Outline,
                    modifier = Modifier.weight(0.6f),
                )
            }
        }
    }
}
