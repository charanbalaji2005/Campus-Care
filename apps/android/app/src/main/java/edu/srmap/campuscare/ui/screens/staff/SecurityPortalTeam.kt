package edu.srmap.campuscare.ui.screens.staff

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.rounded.Call
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.Icon
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import edu.srmap.campuscare.data.SecurityTeamMemberItem
import edu.srmap.campuscare.ui.components.Avatar
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.CcTextField
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.SkeletonList
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.enterStagger
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.theme.CcColors

/**
 * Screen 6: Security Team & Duty Status (Part A)
 *
 * Visual elements matching reference:
 * - Header: "Security Team"
 * - Search bar: "Search officers by name, location..."
 * - Tabs: "On Duty (4)" / "Off Duty (3)" / "All"
 * - Officer list cards with avatar, duty badges, campus, and direct phone call action
 */
@Composable
fun SecurityTeamScreen() {
    val app = LocalApp.current
    val snack = LocalSnack.current
    val context = LocalContext.current

    var selectedFilter by remember { mutableStateOf("on_duty") }
    var searchQuery by remember { mutableStateOf("") }

    val teamLoad = rememberLoad {
        app.api.securityPortal.team()
    }

    CcScreen(
        title = "Security Team",
        subtitle = "Active duty & personnel",
        onRefresh = { teamLoad.reload() },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            // Search Input
            CcTextField(
                value = searchQuery,
                onValueChange = { searchQuery = it },
                label = "Search",
                placeholder = "Search officers by name, campus...",
                leadingIcon = Icons.Rounded.Search,
                modifier = Modifier.fillMaxWidth(),
            )

            LoadContent(
                teamLoad,
                skeleton = { SkeletonList(4) },
            ) { data ->
                // Segmented Tabs
                val tabs = listOf(
                    Pair("on_duty", "On Duty (${data.onDutyCount})"),
                    Pair("off_duty", "Off Duty (${data.offDutyCount})"),
                    Pair("all", "All (${data.members.size})"),
                )

                TabRow(
                    selectedTabIndex = tabs.indexOfFirst { it.first == selectedFilter }.coerceAtLeast(0),
                    containerColor = Color.Transparent,
                    contentColor = CcColors.Forest,
                    indicator = { tabPositions ->
                        val idx = tabs.indexOfFirst { it.first == selectedFilter }.coerceAtLeast(0)
                        SecondaryIndicator(
                            Modifier.tabIndicatorOffset(tabPositions[idx]),
                            color = CcColors.Forest,
                            height = 3.dp,
                        )
                    },
                    divider = {},
                ) {
                    tabs.forEach { (key, label) ->
                        Tab(
                            selected = selectedFilter == key,
                            onClick = { selectedFilter = key },
                            text = {
                                Text(
                                    text = label,
                                    fontWeight = if (selectedFilter == key) FontWeight.Bold else FontWeight.Medium,
                                    color = if (selectedFilter == key) CcColors.Forest else CcColors.InkSoft,
                                    fontSize = 12.sp,
                                )
                            },
                        )
                    }
                }

                val filtered = data.members.filter { m ->
                    val matchesTab = when (selectedFilter) {
                        "on_duty" -> m.status == "on_duty"
                        "off_duty" -> m.status == "off_duty"
                        else -> true
                    }
                    val matchesQuery = searchQuery.isBlank() || m.name.contains(searchQuery, ignoreCase = true) || m.campus.contains(searchQuery, ignoreCase = true)
                    matchesTab && matchesQuery
                }

                if (filtered.isEmpty()) {
                    CcCard {
                        Text(
                            text = "No security officers found matching your filter.",
                            color = CcColors.InkSoft,
                            modifier = Modifier.padding(16.dp),
                        )
                    }
                } else {
                    filtered.forEachIndexed { idx, member ->
                        OfficerRosterCard(
                            member = member,
                            modifier = Modifier.enterStagger(idx),
                            onCall = {
                                if (member.phone.isNotBlank()) {
                                    val intent = Intent(Intent.ACTION_DIAL, Uri.parse("tel:${member.phone}"))
                                    context.startActivity(intent)
                                } else {
                                    snack.show("Phone number not available")
                                }
                            },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun OfficerRosterCard(
    member: SecurityTeamMemberItem,
    modifier: Modifier = Modifier,
    onCall: () -> Unit,
) {
    val isOnDuty = member.status == "on_duty"

    CcCard(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Avatar(name = member.name, size = 42.dp)
                Column {
                    Text(
                        text = member.name,
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp,
                        color = CcColors.Ink,
                    )
                    Text(
                        text = member.campus,
                        style = MaterialTheme.typography.bodySmall,
                        color = CcColors.InkSoft,
                    )
                }
            }

            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StatusChip(
                    text = member.statusLabel,
                    tone = if (isOnDuty) Tone.Brand else Tone.Neutral,
                )

                if (member.phone.isNotBlank()) {
                    Box(
                        modifier = Modifier
                            .size(34.dp)
                            .clip(CircleShape)
                            .background(CcColors.Forest.copy(alpha = 0.1f))
                            .clickable(onClick = onCall),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            imageVector = Icons.Rounded.Call,
                            contentDescription = "Call",
                            tint = CcColors.Forest,
                            modifier = Modifier.size(16.dp),
                        )
                    }
                }
            }
        }
    }
}
