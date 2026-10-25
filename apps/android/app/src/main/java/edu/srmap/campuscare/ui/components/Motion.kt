package edu.srmap.campuscare.ui.components

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.ui.theme.LocalReducedMotion

/** Fades and lifts an item into place, staggered by [index]. Skipped when reduced motion is on. */
fun Modifier.enterStagger(index: Int): Modifier = composed {
    val reduced = LocalReducedMotion.current
    val progress = remember { Animatable(if (reduced) 1f else 0f) }
    LaunchedEffect(Unit) {
        if (!reduced) progress.animateTo(1f, tween(durationMillis = 420, delayMillis = (index.coerceAtMost(10)) * 55, easing = FastOutSlowInEasing))
    }
    graphicsLayer {
        alpha = progress.value
        translationY = (1f - progress.value) * 28f
    }
}

/** Continuous pulse (for SOS and live indicators). Returns 1f constantly when reduced motion is on. */
@Composable
fun rememberPulse(min: Float = 0.92f, max: Float = 1.06f, periodMs: Int = 1100): Float {
    if (LocalReducedMotion.current) return 1f
    val t = rememberInfiniteTransition(label = "pulse")
    val v by t.animateFloat(min, max, infiniteRepeatable(tween(periodMs, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "pulseValue")
    return v
}

/** Shimmer placeholder brush for skeleton loading. */
fun Modifier.shimmer(): Modifier = composed {
    val reduced = LocalReducedMotion.current
    val t = rememberInfiniteTransition(label = "shimmer")
    val x by t.animateFloat(-400f, 1200f, infiniteRepeatable(tween(1300, easing = LinearEasing)), label = "shimmerX")
    val brush = if (reduced) {
        Brush.linearGradient(listOf(CcColors.CreamDeep, CcColors.CreamDeep))
    } else {
        Brush.linearGradient(
            colors = listOf(CcColors.CreamDeep, Color(0xFFF8F5EE), CcColors.CreamDeep),
            start = Offset(x, 0f),
            end = Offset(x + 400f, 200f),
        )
    }
    background(brush)
}

@Composable
fun SkeletonBlock(modifier: Modifier = Modifier, height: Dp = 72.dp) {
    Box(modifier.fillMaxWidth().height(height).clip(RoundedCornerShape(18.dp)).shimmer())
}

/** List-shaped loading placeholder. */
@Composable
fun SkeletonList(count: Int = 4, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        repeat(count) { i ->
            Row(Modifier.enterStagger(i)) {
                Box(Modifier.size(44.dp).clip(CircleShape).shimmer())
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Box(Modifier.fillMaxWidth(0.6f).height(14.dp).clip(RoundedCornerShape(6.dp)).shimmer())
                    Spacer(Modifier.height(8.dp))
                    Box(Modifier.fillMaxWidth(0.9f).height(12.dp).clip(RoundedCornerShape(6.dp)).shimmer())
                }
            }
        }
    }
}

/** Number that rolls when it changes (dashboard counters, countdowns). */
@Composable
fun AnimatedNumber(value: String, style: TextStyle, color: Color, modifier: Modifier = Modifier) {
    AnimatedContent(
        targetState = value,
        transitionSpec = { (slideInVertically { it / 2 } + fadeIn()) togetherWith (slideOutVertically { -it / 2 } + fadeOut()) },
        label = "number",
        modifier = modifier,
    ) { v -> Text(v, style = style, color = color) }
}
