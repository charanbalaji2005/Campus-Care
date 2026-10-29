package edu.srmap.campuscare.ui.screens.staff

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Forum
import androidx.compose.material.icons.rounded.Search
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.ui.components.Avatar
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.CcTextField
import edu.srmap.campuscare.ui.components.ChoiceChips
import edu.srmap.campuscare.ui.components.Divider
import edu.srmap.campuscare.ui.components.EmptyState
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

/**
 * Screen 10: Counsellor Messages
 *
 * Implements dedicated student conversation inbox matching Screen 10:
 * - Search bar to quickly locate students by name
 * - Tabs: All, Unread, Follow-ups
 * - Conversation rows with student avatars, last messages, unread badges
 * - Click directly navigates to the authenticated chat thread
 */
@Composable
fun CounsellorMessagesScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current

    var tabFilter by rememberSaveable { mutableStateOf("all") } // "all", "unread", "followups"
    var searchQuery by rememberSaveable { mutableStateOf("") }

    val chatOverview = rememberLoad { app.api.chat.overview() }

    LaunchedEffect(Unit) {
        app.realtime.events.collect { e ->
            if (e.name == "chat:message" || e.name == "notification") {
                chatOverview.reload()
            }
        }
    }

    CcScreen(
        title = "Messages",
        subtitle = "Confidential student communications",
        refreshing = chatOverview.refreshing,
        onRefresh = { chatOverview.reload() },
    ) {
        // Search bar
        CcTextField(
            value = searchQuery,
            onValueChange = { searchQuery = it },
            label = "Search conversations by student name",
            leadingIcon = Icons.Rounded.Search,
        )

        // Filter tabs
        ChoiceChips(
            options = listOf(
                "all" to "All Messages",
                "unread" to "Unread",
                "followups" to "Follow-ups",
            ),
            selected = tabFilter,
            onSelect = { tabFilter = it },
        )

        LoadContent(chatOverview, skeleton = { SkeletonList(4) }) { overview ->
            val filtered = overview.threads.filter { t ->
                val matchesSearch = searchQuery.isBlank() ||
                    (t.studentName ?: t.name).contains(searchQuery, ignoreCase = true)

                val matchesTab = when (tabFilter) {
                    "unread" -> t.unread > 0
                    "followups" -> t.assigned && !t.closed
                    else -> true
                }

                matchesSearch && matchesTab
            }

            if (filtered.isEmpty()) {
                EmptyState(
                    title = "No conversations found",
                    message = if (tabFilter == "unread") "No unread messages." else "No student conversations match your filter.",
                    icon = Icons.Rounded.Forum,
                    tone = Tone.Violet,
                )
            } else {
                CcCard(padding = 8.dp) {
                    filtered.forEachIndexed { i, thread ->
                        if (i > 0) Divider()
                        Column(Modifier.enterStagger(i)) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable { nav.navigate(Routes.chat(thread.id)) }
                                    .padding(horizontal = 8.dp, vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Avatar(thread.studentName ?: thread.name, tone = Tone.Violet, size = 46.dp)
                                Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f)) {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                    ) {
                                        Text(
                                            text = thread.studentName ?: thread.name,
                                            style = MaterialTheme.typography.titleSmall,
                                            fontWeight = if (thread.unread > 0) FontWeight.Bold else FontWeight.SemiBold,
                                            color = CcColors.Ink,
                                        )
                                        thread.lastMessageAt?.let { ts ->
                                            Text(
                                                text = Fmt.ago(ts),
                                                style = MaterialTheme.typography.labelSmall,
                                                color = CcColors.InkFaint,
                                            )
                                        }
                                    }
                                    Text(
                                        text = if (thread.studentName != null) thread.name else "Tap to open consultation chat",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = if (thread.unread > 0) CcColors.Ink else CcColors.InkSoft,
                                        maxLines = 1,
                                    )
                                }
                                if (thread.unread > 0) {
                                    Spacer(Modifier.width(8.dp))
                                    StatusChip(text = "${thread.unread}", tone = Tone.Danger)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
