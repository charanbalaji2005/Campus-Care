package edu.srmap.campuscare.ui.screens.staff

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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Security
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import edu.srmap.campuscare.data.SecurityMessageThread
import edu.srmap.campuscare.ui.components.Avatar
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.CcTextField
import edu.srmap.campuscare.ui.components.CountBadge
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.SkeletonList
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.theme.CcColors

/**
 * Screen 7: Security Messages (Part A)
 *
 * Visual elements matching reference:
 * - Header: "Messages"
 * - Search bar
 * - Segmented Tabs: "Control Room (2)" / "Team (3)"
 * - Real-time channel list with avatars, unread badges, timestamp labels
 */
@Composable
fun SecurityMessagesScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current

    var selectedTab by remember { mutableStateOf("control_room") }
    var searchQuery by remember { mutableStateOf("") }

    val messagesLoad = rememberLoad {
        app.api.securityPortal.messages()
    }

    CcScreen(
        title = "Messages",
        subtitle = "Control room & patrol channels",
        onRefresh = { messagesLoad.reload() },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            // Search Input
            CcTextField(
                value = searchQuery,
                onValueChange = { searchQuery = it },
                label = "Search",
                placeholder = "Search messages...",
                leadingIcon = Icons.Rounded.Search,
                modifier = Modifier.fillMaxWidth(),
            )

            LoadContent(
                messagesLoad,
                skeleton = { SkeletonList(4) },
            ) { data ->
                val tabs = listOf(
                    Pair("control_room", "Control Room (${data.controlRoom.size})"),
                    Pair("team", "Team (${data.team.size})"),
                )

                TabRow(
                    selectedTabIndex = if (selectedTab == "control_room") 0 else 1,
                    containerColor = Color.Transparent,
                    contentColor = CcColors.Forest,
                    indicator = { tabPositions ->
                        val idx = if (selectedTab == "control_room") 0 else 1
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
                            selected = selectedTab == key,
                            onClick = { selectedTab = key },
                            text = {
                                Text(
                                    text = label,
                                    fontWeight = if (selectedTab == key) FontWeight.Bold else FontWeight.Medium,
                                    color = if (selectedTab == key) CcColors.Forest else CcColors.InkSoft,
                                    fontSize = 13.sp,
                                )
                            },
                        )
                    }
                }

                val activeList = if (selectedTab == "control_room") data.controlRoom else data.team
                val filtered = activeList.filter {
                    searchQuery.isBlank() || it.title.contains(searchQuery, ignoreCase = true) || it.subtitle.contains(searchQuery, ignoreCase = true)
                }

                if (filtered.isEmpty()) {
                    CcCard {
                        Text(
                            text = "No message threads in this section.",
                            color = CcColors.InkSoft,
                            modifier = Modifier.padding(16.dp),
                        )
                    }
                } else {
                    filtered.forEach { thread ->
                        SecurityMessageThreadCard(
                            thread = thread,
                            onClick = {
                                nav.navigate(Routes.chat(thread.id))
                            },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun SecurityMessageThreadCard(
    thread: SecurityMessageThread,
    onClick: () -> Unit,
) {
    CcCard(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Avatar(name = thread.title, size = 44.dp)
                Column {
                    Text(
                        text = thread.title,
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp,
                        color = CcColors.Ink,
                    )
                    Text(
                        text = thread.subtitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = CcColors.InkSoft,
                    )
                }
            }

            Column(horizontalAlignment = Alignment.End) {
                Text(
                    text = thread.timeLabel,
                    fontSize = 11.sp,
                    color = CcColors.InkFaint,
                )
                if (thread.unreadCount > 0) {
                    Spacer(Modifier.height(4.dp))
                    CountBadge(count = thread.unreadCount)
                }
            }
        }
    }
}
