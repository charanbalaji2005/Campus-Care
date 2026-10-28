package edu.srmap.campuscare.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.ui.theme.CcColors

/** Header used on inner screens: back button, serif title and a short subtitle (as in the mockups). */
@Composable
fun ScreenHeader(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    onBack: (() -> Unit)? = null,
    actions: @Composable RowScope.() -> Unit = {},
) {
    Row(
        modifier.fillMaxWidth().statusBarsPadding().padding(start = 8.dp, end = 8.dp, top = 8.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (onBack != null) {
            IconButton(onClick = onBack, modifier = Modifier.clip(CircleShape)) {
                Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Back", tint = CcColors.Ink)
            }
        } else {
            Spacer(Modifier.width(12.dp))
        }
        // The title (e.g. a staff home's greeting) fades and rises in once when the screen opens.
        Column(Modifier.weight(1f).padding(start = 4.dp).enterStagger(0)) {
            Text(title, style = MaterialTheme.typography.headlineMedium, color = CcColors.Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            subtitle?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft, maxLines = 2) }
        }
        Row(verticalAlignment = Alignment.CenterVertically, content = actions)
    }
}

/**
 * Standard screen: header + scrollable column body on the cream background. Pass [onRefresh]
 * for pull-to-refresh. [bottomBar] is drawn above the system navigation bar.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CcScreen(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    onBack: (() -> Unit)? = null,
    actions: @Composable RowScope.() -> Unit = {},
    refreshing: Boolean = false,
    onRefresh: (() -> Unit)? = null,
    scroll: Boolean = true,
    contentPadding: PaddingValues = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
    bottomBar: @Composable () -> Unit = {},
    floating: @Composable () -> Unit = {},
    content: @Composable ColumnScope.() -> Unit,
) {
    Scaffold(
        modifier = modifier,
        containerColor = CcColors.Cream,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = { ScreenHeader(title, subtitle = subtitle, onBack = onBack, actions = actions) },
        bottomBar = bottomBar,
        floatingActionButton = floating,
    ) { inner ->
        val body: @Composable () -> Unit = {
            Column(
                Modifier
                    .fillMaxSize()
                    .enterStagger(1) // dashboard content follows the header in, once (data refreshes do not replay it)
                    .then(if (scroll) Modifier.verticalScroll(rememberScrollState()) else Modifier)
                    .imePadding()
                    .padding(contentPadding),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                content = {
                    content()
                    Spacer(Modifier.height(24.dp))
                },
            )
        }
        Box(Modifier.padding(inner).fillMaxSize()) {
            if (onRefresh != null) {
                PullToRefreshBox(isRefreshing = refreshing, onRefresh = onRefresh, modifier = Modifier.fillMaxSize()) { body() }
            } else {
                body()
            }
        }
    }
}

/** Sticky bottom action area (e.g. "Next", "Start Safe Walk"). */
@Composable
fun BottomActionBar(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    Row(
        modifier
            .fillMaxWidth()
            .background(Color.White)
            .padding(horizontal = 16.dp, vertical = 12.dp)
            .navigationBarsPadding(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

/** Small pill indicating connection state of the realtime channel. */
@Composable
fun LiveDot(live: Boolean, modifier: Modifier = Modifier) {
    val pulse = rememberPulse(0.6f, 1f, 900)
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(if (live) CcColors.Emerald.copy(alpha = pulse) else CcColors.InkFaint))
        Spacer(Modifier.width(6.dp))
        Text(if (live) "Live" else "Reconnecting…", style = MaterialTheme.typography.labelSmall, color = if (live) CcColors.Emerald else CcColors.InkSoft)
    }
}

/**
 * Scrollable body without a header — for content under tabs or inside screens that draw their own
 * header. Supports pull-to-refresh when [onRefresh] is given.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScrollPane(
    modifier: Modifier = Modifier,
    refreshing: Boolean = false,
    onRefresh: (() -> Unit)? = null,
    contentPadding: PaddingValues = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
    content: @Composable ColumnScope.() -> Unit,
) {
    val body: @Composable () -> Unit = {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(contentPadding),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            content = {
                content()
                Spacer(Modifier.height(24.dp))
            },
        )
    }
    Box(modifier.fillMaxSize()) {
        if (onRefresh != null) PullToRefreshBox(isRefreshing = refreshing, onRefresh = onRefresh, modifier = Modifier.fillMaxSize()) { body() } else body()
    }
}
