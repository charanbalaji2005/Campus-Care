package edu.srmap.campuscare.ui.screens.staff

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.LocationOn
import androidx.compose.material.icons.rounded.RadioButtonUnchecked
import androidx.compose.material.icons.rounded.Security
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.TabRowDefaults.SecondaryIndicator
import androidx.compose.material3.TabRowDefaults.tabIndicatorOffset
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import edu.srmap.campuscare.data.PatrolCheckpointItem
import edu.srmap.campuscare.data.PatrolRouteData
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.SectionHeader
import edu.srmap.campuscare.ui.components.SkeletonList
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.theme.CcColors
import kotlinx.coroutines.launch

/**
 * Screen 5: Patrol & Check-ins (Part A)
 *
 * Visual elements matching reference:
 * - Header: "Patrol & Check-ins", Route "Main Campus Patrol", Shift "09:00 AM - 05:00 PM"
 * - Segmented Tabs: "Current Route" / "History"
 * - Progress Card: "45% Complete" progress bar, "Next: Academic Block at 10:15 AM"
 * - Checkpoints list with completed green checks and pending circles
 * - [Check In at Current Location] bottom primary action button
 */
@Composable
fun SecurityPatrolScreen() {
    val app = LocalApp.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()

    var activeTab by remember { mutableStateOf("Current Route") }

    val patrolLoad = rememberLoad {
        app.api.securityPortal.patrolCurrent()
    }

    CcScreen(
        title = "Patrol & Check-ins",
        subtitle = "Main Campus Route",
        onRefresh = { patrolLoad.reload() },
    ) {
        LoadContent(
            patrolLoad,
            skeleton = { SkeletonList(4) },
        ) { data ->
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                // Segmented Tabs: Current Route / History
                TabRow(
                    selectedTabIndex = if (activeTab == "Current Route") 0 else 1,
                    containerColor = Color.Transparent,
                    contentColor = CcColors.Forest,
                    indicator = { tabPositions ->
                        val idx = if (activeTab == "Current Route") 0 else 1
                        SecondaryIndicator(
                            Modifier.tabIndicatorOffset(tabPositions[idx]),
                            color = CcColors.Forest,
                            height = 3.dp,
                        )
                    },
                    divider = {},
                ) {
                    Tab(
                        selected = activeTab == "Current Route",
                        onClick = { activeTab = "Current Route" },
                        text = {
                            Text(
                                text = "Current Route",
                                fontWeight = if (activeTab == "Current Route") FontWeight.Bold else FontWeight.Medium,
                                color = if (activeTab == "Current Route") CcColors.Forest else CcColors.InkSoft,
                            )
                        },
                    )
                    Tab(
                        selected = activeTab == "History",
                        onClick = { activeTab = "History" },
                        text = {
                            Text(
                                text = "History",
                                fontWeight = if (activeTab == "History") FontWeight.Bold else FontWeight.Medium,
                                color = if (activeTab == "History") CcColors.Forest else CcColors.InkSoft,
                            )
                        },
                    )
                }

                if (activeTab == "Current Route") {
                    // Route Overview & Progress Card
                    PatrolProgressCard(data = data)

                    // Checkpoints Timeline List
                    SectionHeader("Route Checkpoints")
                    data.checkpoints.forEachIndexed { idx, cp ->
                        CheckpointRowItem(idx = idx + 1, checkpoint = cp)
                    }

                    Spacer(Modifier.height(8.dp))

                    // Check In Button
                    CcButton(
                        text = "Check In at Current Location",
                        onClick = {
                            scope.launch {
                                try {
                                    val result = app.api.securityPortal.patrolCheckIn()
                                    snack.show(
                                        if (result.checkedInName != null) {
                                            "Checked in at ${result.checkedInName} (${result.progressPercent}% complete)"
                                        } else {
                                            "All patrol checkpoints completed!"
                                        },
                                    )
                                    patrolLoad.reload()
                                } catch (e: Exception) {
                                    snack.show(e.message ?: "Failed to record check-in")
                                }
                            }
                        },
                        leadingIcon = Icons.Rounded.LocationOn,
                        kind = ButtonKind.Primary,
                        modifier = Modifier.fillMaxWidth(),
                    )
                } else {
                    // History Tab
                    CcCard {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(
                                text = "Past Patrol Records",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold,
                                color = CcColors.Ink,
                            )
                            Text(
                                text = "Yesterday • Main Campus Patrol (100% Completed)",
                                style = MaterialTheme.typography.bodyMedium,
                                color = CcColors.InkSoft,
                            )
                            Text(
                                text = "Oct 26 • North Campus Patrol (100% Completed)",
                                style = MaterialTheme.typography.bodyMedium,
                                color = CcColors.InkSoft,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PatrolProgressCard(data: PatrolRouteData) {
    val nextPending = data.checkpoints.firstOrNull { it.status == "pending" }

    CcCard(modifier = Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column {
                    Text(
                        text = data.name,
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp,
                        color = CcColors.Ink,
                    )
                    Text(
                        text = "Shift: ${data.shiftTime}",
                        style = MaterialTheme.typography.bodySmall,
                        color = CcColors.InkSoft,
                    )
                }

                StatusChip(
                    text = "${data.progressPercent}% DONE",
                    tone = Tone.Brand,
                )
            }

            LinearProgressIndicator(
                progress = { data.progressPercent / 100f },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(8.dp)
                    .clip(RoundedCornerShape(4.dp)),
                color = CcColors.Forest,
                trackColor = CcColors.Forest.copy(alpha = 0.15f),
            )

            if (nextPending != null) {
                Text(
                    text = "Next: ${nextPending.name} at ${nextPending.timeLabel}",
                    style = MaterialTheme.typography.bodySmall,
                    color = CcColors.Ink,
                    fontWeight = FontWeight.SemiBold,
                )
            } else {
                Text(
                    text = "All checkpoints checked in successfully.",
                    style = MaterialTheme.typography.bodySmall,
                    color = CcColors.Emerald,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
    }
}

@Composable
private fun CheckpointRowItem(idx: Int, checkpoint: PatrolCheckpointItem) {
    val isCompleted = checkpoint.status == "completed"

    CcCard(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Box(
                    modifier = Modifier
                        .size(32.dp)
                        .clip(CircleShape)
                        .background(if (isCompleted) CcColors.Emerald.copy(alpha = 0.15f) else CcColors.InkSoft.copy(alpha = 0.1f)),
                    contentAlignment = Alignment.Center,
                ) {
                    if (isCompleted) {
                        Icon(
                            imageVector = Icons.Rounded.CheckCircle,
                            contentDescription = "Completed",
                            tint = CcColors.Emerald,
                            modifier = Modifier.size(20.dp),
                        )
                    } else {
                        Icon(
                            imageVector = Icons.Rounded.RadioButtonUnchecked,
                            contentDescription = "Pending",
                            tint = CcColors.InkSoft,
                            modifier = Modifier.size(18.dp),
                        )
                    }
                }

                Column {
                    Text(
                        text = "$idx. ${checkpoint.name}",
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp,
                        color = CcColors.Ink,
                    )
                    Text(
                        text = checkpoint.locationLabel,
                        style = MaterialTheme.typography.bodySmall,
                        color = CcColors.InkSoft,
                    )
                }
            }

            Column(horizontalAlignment = Alignment.End) {
                Text(
                    text = checkpoint.timeLabel,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 12.sp,
                    color = if (isCompleted) CcColors.Emerald else CcColors.InkSoft,
                )
                Text(
                    text = if (isCompleted) "Completed" else "Pending",
                    fontSize = 11.sp,
                    color = if (isCompleted) CcColors.Emerald else CcColors.InkFaint,
                )
            }
        }
    }
}
