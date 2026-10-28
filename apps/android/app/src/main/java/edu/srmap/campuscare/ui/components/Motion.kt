package edu.srmap.campuscare.ui.components

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.expandVertically
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.interaction.InteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.font.FontWeight
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

/** One-time gentle pop into place (empty-state illustrations, success marks). Skipped when reduced motion is on. */
fun Modifier.popIn(delayMs: Int = 0): Modifier = composed {
    val reduced = LocalReducedMotion.current
    val progress = remember { Animatable(if (reduced) 1f else 0f) }
    LaunchedEffect(Unit) {
        if (!reduced) {
            kotlinx.coroutines.delay(delayMs.toLong())
            progress.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessLow))
        }
    }
    graphicsLayer {
        val p = progress.value
        alpha = p.coerceIn(0f, 1f)
        val s = 0.7f + 0.3f * p
        scaleX = s
        scaleY = s
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

/**
 * Number that rolls from its old value to its new one when real data changes (dashboard counters,
 * countdowns). It never counts through invented intermediate values. Plain text with reduced motion.
 */
@Composable
fun AnimatedNumber(value: String, style: TextStyle, color: Color, modifier: Modifier = Modifier) {
    if (LocalReducedMotion.current) {
        Text(value, style = style, color = color, modifier = modifier)
        return
    }
    AnimatedContent(
        targetState = value,
        transitionSpec = { (slideInVertically { it / 2 } + fadeIn()) togetherWith (slideOutVertically { -it / 2 } + fadeOut()) },
        label = "number",
        modifier = modifier,
    ) { v -> Text(v, style = style, color = color) }
}

/**
 * Scale that briefly "bumps" when [key] changes after the first composition (e.g. an unread count
 * going up), then settles at 1. Nothing loops; 1f constantly with reduced motion.
 */
@Composable
fun rememberBump(key: Any?, peak: Float = 1.25f): Float {
    val reduced = LocalReducedMotion.current
    val scale = remember { Animatable(1f) }
    var first by remember { mutableStateOf(true) }
    LaunchedEffect(key) {
        if (first) { first = false; return@LaunchedEffect }
        if (reduced) return@LaunchedEffect
        scale.snapTo(peak)
        scale.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMedium))
    }
    return scale.value
}

/** Red unread-count badge that pops in, bumps when the count changes and shrinks away at zero. */
@Composable
fun CountBadge(count: Int, modifier: Modifier = Modifier, max: Int = 99, color: Color = CcColors.Sos) {
    val reduced = LocalReducedMotion.current
    val bump = rememberBump(count)
    AnimatedVisibility(
        visible = count > 0,
        modifier = modifier,
        enter = if (reduced) EnterTransition.None else scaleIn(spring(dampingRatio = Spring.DampingRatioMediumBouncy)) + fadeIn(),
        exit = if (reduced) ExitTransition.None else scaleOut(tween(150)) + fadeOut(tween(150)),
    ) {
        Box(
            Modifier
                .graphicsLayer { scaleX = bump; scaleY = bump }
                .defaultMinSize(minWidth = 18.dp, minHeight = 18.dp)
                .clip(RoundedCornerShape(50))
                .background(color)
                .padding(horizontal = 5.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(if (count > max) "$max+" else "$count", color = Color.White, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
        }
    }
}

/**
 * Restrained attention cue for an emergency button: a soft ring that expands and fades [times] times
 * whenever [key] changes (e.g. when the home screen opens), then stops. Returns the ring progress
 * (0 = hidden). Never loops forever, so it cannot become visual noise; 0 with reduced motion.
 */
@Composable
fun rememberAttentionRing(key: Any? = Unit, times: Int = 3, periodMs: Int = 1400): Float {
    val reduced = LocalReducedMotion.current
    val ring = remember { Animatable(0f) }
    LaunchedEffect(key, reduced) {
        if (reduced) { ring.snapTo(0f); return@LaunchedEffect }
        repeat(times) {
            ring.snapTo(0f)
            ring.animateTo(1f, tween(periodMs, easing = LinearOutSlowInEasing))
        }
        ring.snapTo(0f)
    }
    return ring.value
}

/** Detail panel that unfolds and folds smoothly (instantly with reduced motion). */
@Composable
fun Expandable(visible: Boolean, modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    val reduced = LocalReducedMotion.current
    AnimatedVisibility(
        visible = visible,
        modifier = modifier,
        enter = if (reduced) EnterTransition.None else expandVertically(tween(240, easing = FastOutSlowInEasing)) + fadeIn(tween(200, delayMillis = 40)),
        exit = if (reduced) ExitTransition.None else shrinkVertically(tween(200, easing = FastOutSlowInEasing)) + fadeOut(tween(120)),
    ) { Column(content = content) }
}

/** Press feedback for custom tappable surfaces: shrinks slightly while pressed. */
fun Modifier.pressScale(interaction: InteractionSource, pressed: Float = 0.94f): Modifier = composed {
    val reduced = LocalReducedMotion.current
    val isPressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if (isPressed && !reduced) pressed else 1f, spring(stiffness = Spring.StiffnessMediumLow), label = "press")
    graphicsLayer { scaleX = scale; scaleY = scale }
}

/**
 * Guards a critical action against repeated taps: [run] ignores calls while the previous one is still
 * inside [windowMs]. Used for SOS actions so a nervous double tap cannot send two requests.
 */
class TapGuard(private val windowMs: Long, private val clock: () -> Long = { android.os.SystemClock.elapsedRealtime() }) {
    private var last: Long? = null
    /** Runs [action] unless the previous accepted tap was less than the window ago. Returns whether it ran. */
    fun run(action: () -> Unit): Boolean {
        val now = clock()
        val previous = last
        if (previous != null && now - previous < windowMs) return false
        last = now
        action()
        return true
    }
}

@Composable
fun rememberTapGuard(windowMs: Long = 1500): TapGuard = remember { TapGuard(windowMs) }
