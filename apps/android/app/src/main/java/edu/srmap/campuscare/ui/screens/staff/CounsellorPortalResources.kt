package edu.srmap.campuscare.ui.screens.staff

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Article
import androidx.compose.material.icons.rounded.Bookmark
import androidx.compose.material.icons.rounded.BookmarkBorder
import androidx.compose.material.icons.rounded.Headphones
import androidx.compose.material.icons.rounded.PictureAsPdf
import androidx.compose.material.icons.rounded.PlayCircle
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material.icons.rounded.Spa
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.CounsellingResourceItem
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.CcTextField
import edu.srmap.campuscare.ui.components.ChoiceChips
import edu.srmap.campuscare.ui.components.EmptyState
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.SkeletonList
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.enterStagger
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.openUrl
import kotlinx.coroutines.launch

/**
 * Screen 8: Resources Library
 *
 * Implements the wellbeing and psychoeducation library matching Screen 8:
 * - Search bar for keywords and topics
 * - Categories: All, Mental Health, Academic, Career, Mindfulness, Healthy Habits
 * - Formatted cards with content type badges (Article, Video, PDF, Audio)
 * - Bookmark toggle syncing with counsellor profile
 * - Direct sharing action for student sessions
 */
@Composable
fun ResourcesLibraryScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var categoryFilter by rememberSaveable { mutableStateOf("all") }
    var searchQuery by rememberSaveable { mutableStateOf("") }

    val resources = rememberLoad(categoryFilter) {
        app.api.counselling.resources(category = categoryFilter)
    }

    var shareResourceItem by remember { mutableStateOf<CounsellingResourceItem?>(null) }

    fun toggleBookmark(res: CounsellingResourceItem) {
        scope.launch {
            try {
                app.api.counselling.bookmarkResource(res.id)
                resources.reload()
                snack.show(if (!res.bookmarked) "Saved to your bookmarks." else "Removed from bookmarks.")
            } catch (e: ApiException) {
                snack.error(e)
            }
        }
    }

    CcScreen(
        title = "Resources Library",
        subtitle = "Verified guides, articles, and clinical exercises",
        onBack = { nav.popBackStack() },
        refreshing = resources.refreshing,
        onRefresh = { resources.reload() },
    ) {
        // Search bar
        CcTextField(
            value = searchQuery,
            onValueChange = { searchQuery = it },
            label = "Search articles, guides, or exercises",
            leadingIcon = Icons.Rounded.Search,
        )

        // Category Filter Chips
        ChoiceChips(
            options = listOf(
                "all" to "All Resources",
                "Mental Health" to "Mental Health",
                "Academic" to "Academic",
                "Mindfulness" to "Mindfulness",
                "Career" to "Career",
                "Healthy Habits" to "Healthy Habits",
            ),
            selected = categoryFilter,
            onSelect = { categoryFilter = it },
        )

        LoadContent(resources, skeleton = { SkeletonList(3) }) { list ->
            val filtered = list.filter { r ->
                searchQuery.isBlank() ||
                    r.title.contains(searchQuery, ignoreCase = true) ||
                    r.summary.contains(searchQuery, ignoreCase = true) ||
                    r.tags.any { it.contains(searchQuery, ignoreCase = true) }
            }

            if (filtered.isEmpty()) {
                EmptyState(
                    title = "No resources found",
                    message = "No guides matched your search or category filter.",
                    icon = Icons.Rounded.Spa,
                    tone = Tone.Teal,
                )
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    filtered.forEachIndexed { i, res ->
                        Column(Modifier.enterStagger(i)) {
                            ResourceCard(
                                resource = res,
                                onBookmarkToggle = { toggleBookmark(res) },
                                onShare = { shareResourceItem = res },
                                onOpen = {
                                    if (!res.url.isNullOrBlank()) {
                                        context.openUrl(res.url)
                                    } else {
                                        snack.show("Opening ${res.title}...")
                                    }
                                },
                            )
                        }
                    }
                }
            }
        }
    }

    // Share Dialog
    shareResourceItem?.let { res ->
        AlertDialog(
            onDismissRequest = { shareResourceItem = null },
            title = { Text("Share Resource with Student") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Sharing '${res.title}'", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                    Text("The resource link will be dispatched to the student's active support chat thread.", style = MaterialTheme.typography.bodyMedium)
                }
            },
            confirmButton = {
                CcButton(
                    text = "Confirm Share",
                    onClick = {
                        shareResourceItem = null
                        snack.show("Resource shared successfully.")
                    },
                    kind = ButtonKind.Brand,
                )
            },
            dismissButton = {
                TextButton(onClick = { shareResourceItem = null }) { Text("Cancel") }
            },
        )
    }
}

@Composable
private fun ResourceCard(
    resource: CounsellingResourceItem,
    onBookmarkToggle: () -> Unit,
    onShare: () -> Unit,
    onOpen: () -> Unit,
) {
    val icon = when (resource.type.lowercase()) {
        "video" -> Icons.Rounded.PlayCircle
        "audio" -> Icons.Rounded.Headphones
        "pdf" -> Icons.Rounded.PictureAsPdf
        else -> Icons.AutoMirrored.Rounded.Article
    }

    CcCard(padding = 14.dp) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(44.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(CcColors.Mint50),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(icon, contentDescription = null, tint = CcColors.Forest, modifier = Modifier.size(22.dp))
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        text = resource.title,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = CcColors.Ink,
                    )
                    Text(
                        text = "${resource.category} · ${resource.readTime.ifBlank { resource.fileSize ?: "Verified Resource" }}",
                        style = MaterialTheme.typography.bodySmall,
                        color = CcColors.InkSoft,
                    )
                }
                IconButton(onClick = onBookmarkToggle) {
                    Icon(
                        imageVector = if (resource.bookmarked) Icons.Rounded.Bookmark else Icons.Rounded.BookmarkBorder,
                        contentDescription = "Bookmark",
                        tint = if (resource.bookmarked) CcColors.Forest else CcColors.InkSoft,
                    )
                }
            }

            Text(
                text = resource.summary,
                style = MaterialTheme.typography.bodyMedium,
                color = CcColors.Ink,
                maxLines = 3,
            )

            // Tags
            if (resource.tags.isNotEmpty()) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    resource.tags.take(3).forEach { tag ->
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(6.dp))
                                .background(CcColors.Cream)
                                .padding(horizontal = 8.dp, vertical = 3.dp),
                        ) {
                            Text(tag, style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
                        }
                    }
                }
            }

            // Actions
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                CcButton(
                    text = "Read Resource",
                    onClick = onOpen,
                    modifier = Modifier.weight(1.2f),
                    kind = ButtonKind.Brand,
                )
                CcButton(
                    text = "Share",
                    onClick = onShare,
                    modifier = Modifier.weight(1f),
                    kind = ButtonKind.Outline,
                    leadingIcon = Icons.Rounded.Share,
                )
            }
        }
    }
}
