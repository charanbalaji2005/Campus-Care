package edu.srmap.campuscare.ui.components

import androidx.compose.animation.Crossfade
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CloudOff
import androidx.compose.material.icons.rounded.Inbox
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.ui.theme.CcColors

@Composable
fun EmptyState(
    title: String,
    modifier: Modifier = Modifier,
    message: String? = null,
    icon: ImageVector = Icons.Rounded.Inbox,
    tone: Tone = Tone.Brand,
    action: (@Composable () -> Unit)? = null,
) {
    Column(
        modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 36.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        IconBadge(icon, tone, size = 64.dp, iconSize = 30.dp, modifier = Modifier.enterStagger(0))
        Spacer(Modifier.height(14.dp))
        Text(title, style = MaterialTheme.typography.titleMedium, color = CcColors.Ink, textAlign = TextAlign.Center)
        message?.let {
            Spacer(Modifier.height(4.dp))
            Text(it, style = MaterialTheme.typography.bodyMedium, color = CcColors.InkSoft, textAlign = TextAlign.Center)
        }
        action?.let {
            Spacer(Modifier.height(16.dp))
            it()
        }
    }
}

@Composable
fun ErrorState(message: String, onRetry: () -> Unit, modifier: Modifier = Modifier, offline: Boolean = false) {
    EmptyState(
        title = if (offline) "You're offline" else "Couldn't load this",
        message = message,
        icon = Icons.Rounded.CloudOff,
        tone = Tone.Amber,
        modifier = modifier,
        action = { CcButton("Try again", onRetry, kind = ButtonKind.Outline, leadingIcon = Icons.Rounded.Refresh) },
    )
}

/**
 * Renders a [LoadHandle]: skeleton while loading, error with retry, then content.
 * Content stays visible during pull-to-refresh reloads.
 */
@Composable
fun <T> LoadContent(
    handle: LoadHandle<T>,
    modifier: Modifier = Modifier,
    skeleton: @Composable () -> Unit = { SkeletonList() },
    content: @Composable (T) -> Unit,
) {
    Crossfade(targetState = handle.value, label = "load", modifier = modifier) { state ->
        when (state) {
            is Load.Loading -> skeleton()
            is Load.Err -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                ErrorState(state.error.message ?: "Please try again.", onRetry = { handle.reload() }, offline = state.error.isNetwork)
            }
            is Load.Ok -> content(state.data)
        }
    }
}

@Composable
fun CenteredNote(text: String, modifier: Modifier = Modifier) {
    Text(text, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft, textAlign = TextAlign.Center, modifier = modifier.fillMaxWidth().padding(16.dp))
}
