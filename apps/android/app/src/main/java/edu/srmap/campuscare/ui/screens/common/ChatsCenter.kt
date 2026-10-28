package edu.srmap.campuscare.ui.screens.common

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Chat
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Campaign
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.FolderSpecial
import androidx.compose.material.icons.rounded.Forum
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Psychology
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.SupportAgent
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.Badge
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.data.AnnouncementItem
import edu.srmap.campuscare.data.ConversationItem
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.CcTextField
import edu.srmap.campuscare.ui.components.EmptyState
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.SkeletonList
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.theme.CcColors

private val CATEGORIES = listOf(
    "all" to "All",
    "reports" to "Reports",
    "announcements" to "Announcements",
    "support" to "Support",
    "counselling" to "Counselling",
    "community" to "Community",
    "security" to "Security",
)

@Composable
fun ChatsCenterScreen(initialCategory: String? = null) {
    val app = LocalApp.current
    val nav = LocalNav.current

    var selectedCategory by rememberSaveable { mutableStateOf(initialCategory ?: "all") }
    var searchQuery by rememberSaveable { mutableStateOf("") }
    var submittedQuery by rememberSaveable { mutableStateOf("") }

    val conversationsLoad = rememberLoad(key = "$selectedCategory:$submittedQuery") {
        app.api.chat.conversations(selectedCategory, submittedQuery.ifBlank { null })
    }

    val announcementsLoad = rememberLoad(key = submittedQuery) {
        app.api.chat.announcements(q = submittedQuery.ifBlank { null })
    }

    // Auto-reload on socket real-time events
    LaunchedEffect(Unit) {
        app.realtime.events.collect { e ->
            if (e.name in setOf("chat:message", "case:updated", "notification", "announcement:published")) {
                conversationsLoad.reload()
                announcementsLoad.reload()
            }
        }
    }

    CcScreen(
        title = "Chats Center",
        subtitle = "Conversations, official updates & reports",
        scroll = false,
        refreshing = conversationsLoad.refreshing || announcementsLoad.refreshing,
        onRefresh = {
            conversationsLoad.reload()
            announcementsLoad.reload()
        },
        floating = {
            if (selectedCategory == "reports" || selectedCategory == "all") {
                CcButton(
                    text = "New Report",
                    onClick = { nav.navigate(Routes.report()) },
                    kind = ButtonKind.Brand,
                    leadingIcon = Icons.Rounded.Description,
                )
            }
        },
    ) {
        // Search TextField
        CcTextField(
            value = searchQuery,
            onValueChange = {
                searchQuery = it
                submittedQuery = it.trim()
            },
            label = "Search chats, cases, updates",
            leadingIcon = Icons.Rounded.Search,
            onImeAction = { submittedQuery = searchQuery.trim() },
        )

        Spacer(Modifier.height(8.dp))

        // Horizontal Category Chips
        Row(
            Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            CATEGORIES.forEach { (catKey, catLabel) ->
                val isSelected = selectedCategory == catKey
                val bg = if (isSelected) CcColors.Forest else Color.White
                val fg = if (isSelected) Color.White else CcColors.Ink
                val borderCol = if (isSelected) CcColors.Forest else CcColors.Forest.copy(alpha = 0.15f)

                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(20.dp))
                        .background(bg)
                        .clickable { selectedCategory = catKey }
                        .padding(horizontal = 14.dp, vertical = 8.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = catLabel,
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                        color = fg,
                    )
                }
            }
        }

        Spacer(Modifier.height(8.dp))

        // Content Area
        if (selectedCategory == "announcements") {
            LoadContent(announcementsLoad, skeleton = { SkeletonList(4) }) { page ->
                val items = page.items
                if (items.isEmpty()) {
                    EmptyState(
                        title = "No announcements",
                        message = "Official university announcements and alerts will appear here.",
                        icon = Icons.Rounded.Campaign,
                    )
                } else {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                        contentPadding = PaddingValues(bottom = 80.dp),
                    ) {
                        items(items, key = { it.id }) { item ->
                            AnnouncementRow(item)
                        }
                    }
                }
            }
        } else {
            LoadContent(conversationsLoad, skeleton = { SkeletonList(6) }) { resp ->
                val items = resp.items
                if (items.isEmpty()) {
                    EmptyState(
                        title = if (selectedCategory == "reports") "No reports found" else "No conversations",
                        message = if (selectedCategory == "reports") "You haven't submitted any reports yet. Tap below to raise a case." else "Start a conversation or check other categories.",
                        icon = if (selectedCategory == "reports") Icons.Rounded.Description else Icons.Rounded.Forum,
                    )
                } else {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        contentPadding = PaddingValues(bottom = 80.dp),
                    ) {
                        items(items, key = { it.id }) { item ->
                            ConversationRow(item, onClick = {
                                when (item.type) {
                                    "report" -> nav.navigate(Routes.reportDetail(item.id))
                                    "sos" -> nav.navigate(Routes.sosStatus(item.id))
                                    else -> nav.navigate(Routes.chat(item.id))
                                }
                            })
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ConversationRow(item: ConversationItem, onClick: () -> Unit) {
    val icon = when (item.type) {
        "report" -> Icons.Rounded.Description
        "sos" -> Icons.Rounded.Warning
        "appointment" -> Icons.Rounded.Psychology
        "support" -> Icons.Rounded.SupportAgent
        "security" -> Icons.Rounded.Shield
        else -> Icons.AutoMirrored.Rounded.Chat
    }

    val iconBg = when (item.type) {
        "report" -> CcColors.Mint
        "sos" -> CcColors.Sos.copy(alpha = 0.15f)
        "security" -> CcColors.Mint
        "support" -> Color(0xFFE0F2FE)
        else -> CcColors.Mint
    }

    val iconTint = when (item.type) {
        "sos" -> CcColors.Sos
        else -> CcColors.Forest
    }

    CcCard(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Category Icon Badge
            Box(
                Modifier
                    .size(46.dp)
                    .clip(CircleShape)
                    .background(iconBg),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, contentDescription = null, tint = iconTint, modifier = Modifier.size(24.dp))
            }

            Spacer(Modifier.width(12.dp))

            // Text Info
            Column(Modifier.weight(1f)) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = item.title,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = if (item.unread > 0) FontWeight.Bold else FontWeight.SemiBold,
                        color = CcColors.Ink,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )

                    item.status?.let { status ->
                        StatusChip(status)
                    }
                }

                Spacer(Modifier.height(2.dp))

                item.preview?.let { previewText ->
                    Text(
                        text = previewText,
                        style = MaterialTheme.typography.bodySmall,
                        color = if (item.unread > 0) CcColors.Ink else CcColors.InkSoft,
                        fontWeight = if (item.unread > 0) FontWeight.Medium else FontWeight.Normal,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }

                item.subtitle?.let { sub ->
                    if (item.preview == null) {
                        Text(
                            text = sub,
                            style = MaterialTheme.typography.bodySmall,
                            color = CcColors.InkSoft,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }

            // Unread Badge & Lock Icon
            if (item.unread > 0 || item.locked) {
                Spacer(Modifier.width(8.dp))
                Column(horizontalAlignment = Alignment.End) {
                    if (item.unread > 0) {
                        Box(
                            Modifier
                                .clip(RoundedCornerShape(12.dp))
                                .background(CcColors.Forest)
                                .padding(horizontal = 7.dp, vertical = 2.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                text = "${item.unread}",
                                style = MaterialTheme.typography.labelSmall,
                                color = Color.White,
                                fontWeight = FontWeight.Bold,
                            )
                        }
                    }
                    if (item.locked) {
                        Icon(Icons.Rounded.Lock, contentDescription = "Locked", tint = CcColors.InkSoft, modifier = Modifier.size(16.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun AnnouncementRow(item: AnnouncementItem) {
    val isUrgent = item.priority.equals("urgent", ignoreCase = true) || item.priority.equals("emergency", ignoreCase = true)
    CcCard(
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(14.dp),
        ) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        Icons.Rounded.Campaign,
                        contentDescription = null,
                        tint = if (isUrgent) CcColors.Sos else CcColors.Forest,
                        modifier = Modifier.size(20.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(
                        text = item.title,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = CcColors.Ink,
                    )
                }

                if (isUrgent) {
                    Box(
                        Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(CcColors.Sos.copy(alpha = 0.12f))
                            .padding(horizontal = 8.dp, vertical = 2.dp),
                    ) {
                        Text("URGENT", style = MaterialTheme.typography.labelSmall, color = CcColors.Sos, fontWeight = FontWeight.Bold)
                    }
                }
            }

            Spacer(Modifier.height(6.dp))

            Text(
                text = item.body,
                style = MaterialTheme.typography.bodyMedium,
                color = CcColors.Ink,
            )

            Spacer(Modifier.height(8.dp))

            item.authorName?.let { author ->
                Text(
                    text = "Posted by $author",
                    style = MaterialTheme.typography.labelSmall,
                    color = CcColors.InkSoft,
                )
            }
        }
    }
}

@Composable
private fun StatusChip(status: String) {
    val clean = status.replace('_', ' ').replaceFirstChar { it.uppercase() }
    val (bg, fg) = when (status.lowercase()) {
        "resolved", "closed", "approved" -> CcColors.Mint to CcColors.Forest
        "urgent", "escalated", "emergency" -> CcColors.Sos.copy(alpha = 0.12f) to CcColors.Sos
        "in_progress", "under_review", "assigned" -> Color(0xFFFEF3C7) to Color(0xFF92400E)
        else -> CcColors.Cream to CcColors.InkSoft
    }
    Box(
        Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(bg)
            .padding(horizontal = 6.dp, vertical = 2.dp),
    ) {
        Text(clean, style = MaterialTheme.typography.labelSmall, color = fg, fontWeight = FontWeight.SemiBold)
    }
}
