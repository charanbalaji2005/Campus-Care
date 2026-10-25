package edu.srmap.campuscare.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.ui.theme.DisplayFamily
import edu.srmap.campuscare.ui.theme.LocalReducedMotion

/** The CampusCare shield-and-heart mark, drawn as vector so it stays crisp at any size. */
@Composable
fun ShieldMark(size: Dp = 48.dp, modifier: Modifier = Modifier, light: Boolean = false) {
    Canvas(modifier.size(size)) {
        val w = this.size.width
        val h = this.size.height
        val shield = Path().apply {
            moveTo(w * 0.5f, h * 0.04f)
            lineTo(w * 0.9f, h * 0.18f)
            lineTo(w * 0.9f, h * 0.48f)
            cubicTo(w * 0.9f, h * 0.74f, w * 0.72f, h * 0.9f, w * 0.5f, h * 0.98f)
            cubicTo(w * 0.28f, h * 0.9f, w * 0.1f, h * 0.74f, w * 0.1f, h * 0.48f)
            lineTo(w * 0.1f, h * 0.18f)
            close()
        }
        drawPath(shield, if (light) Color.White else CcColors.Forest)
        val inner = Path().apply {
            moveTo(w * 0.5f, h * 0.14f)
            lineTo(w * 0.8f, h * 0.25f)
            lineTo(w * 0.8f, h * 0.48f)
            cubicTo(w * 0.8f, h * 0.68f, w * 0.67f, h * 0.81f, w * 0.5f, h * 0.88f)
            cubicTo(w * 0.33f, h * 0.81f, w * 0.2f, h * 0.68f, w * 0.2f, h * 0.48f)
            lineTo(w * 0.2f, h * 0.25f)
            close()
        }
        drawPath(inner, if (light) CcColors.Mint else CcColors.Emerald)
        drawHeart(Offset(w * 0.5f, h * 0.52f), w * 0.34f, if (light) CcColors.Forest else Color.White)
    }
}

private fun DrawScope.drawHeart(center: Offset, width: Float, color: Color) {
    val x = center.x
    val y = center.y
    val s = width / 2f
    val p = Path().apply {
        moveTo(x, y + s * 0.9f)
        cubicTo(x - s * 1.4f, y - s * 0.1f, x - s * 0.7f, y - s * 1.1f, x, y - s * 0.35f)
        cubicTo(x + s * 0.7f, y - s * 1.1f, x + s * 1.4f, y - s * 0.1f, x, y + s * 0.9f)
        close()
    }
    drawPath(p, color)
}

/** Logo lock-up: mark + "CampusCare" wordmark (serif, two-tone as in the mockups). */
@Composable
fun Wordmark(modifier: Modifier = Modifier, light: Boolean = false, markSize: Dp = 34.dp, showMark: Boolean = true) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        if (showMark) {
            ShieldMark(markSize, light = light)
            Spacer(Modifier.width(8.dp))
        }
        Text("Campus", style = MaterialTheme.typography.headlineMedium, fontFamily = DisplayFamily, fontWeight = FontWeight.Bold, color = if (light) Color.White else CcColors.Forest)
        Text("Care", style = MaterialTheme.typography.headlineMedium, fontFamily = DisplayFamily, fontWeight = FontWeight.Bold, color = if (light) CcColors.Emerald400 else CcColors.Emerald)
    }
}

/**
 * Stylised university skyline (central clock tower, wings, trees) with drifting clouds.
 * Purely decorative — hidden from screen readers by having no content description.
 */
@Composable
fun CampusSkyline(modifier: Modifier = Modifier, tint: Color = CcColors.Forest, accent: Color = CcColors.Emerald, sky: Brush? = null) {
    val reduced = LocalReducedMotion.current
    val drift = if (reduced) 0f else {
        val t = rememberInfiniteTransition(label = "clouds")
        val v by t.animateFloat(0f, 1f, infiniteRepeatable(tween(24_000, easing = LinearEasing), RepeatMode.Restart), label = "drift")
        v
    }
    Canvas(modifier) {
        val w = size.width
        val h = size.height
        sky?.let { drawRect(it) }
        // clouds
        val cloud = Color.White.copy(alpha = 0.55f)
        listOf(0.15f to 0.18f, 0.6f to 0.1f, 0.85f to 0.24f).forEachIndexed { i, (cx, cy) ->
            val x = ((cx + drift * (0.3f + i * 0.1f)) % 1.2f - 0.1f) * w
            drawCircle(cloud, radius = h * 0.06f, center = Offset(x, h * cy))
            drawCircle(cloud, radius = h * 0.08f, center = Offset(x + h * 0.08f, h * cy - h * 0.02f))
            drawCircle(cloud, radius = h * 0.055f, center = Offset(x + h * 0.17f, h * cy))
        }
        val base = h * 0.86f
        // wings
        drawRoundRect(tint.copy(alpha = 0.92f), topLeft = Offset(w * 0.12f, h * 0.52f), size = Size(w * 0.76f, base - h * 0.52f), cornerRadius = CornerRadius(6f, 6f))
        // roofs
        val roofL = Path().apply { moveTo(w * 0.1f, h * 0.53f); lineTo(w * 0.27f, h * 0.43f); lineTo(w * 0.42f, h * 0.53f); close() }
        val roofR = Path().apply { moveTo(w * 0.58f, h * 0.53f); lineTo(w * 0.73f, h * 0.43f); lineTo(w * 0.9f, h * 0.53f); close() }
        drawPath(roofL, tint)
        drawPath(roofR, tint)
        // central tower + spire
        drawRect(tint, topLeft = Offset(w * 0.43f, h * 0.28f), size = Size(w * 0.14f, base - h * 0.28f))
        val spire = Path().apply { moveTo(w * 0.42f, h * 0.29f); lineTo(w * 0.5f, h * 0.1f); lineTo(w * 0.58f, h * 0.29f); close() }
        drawPath(spire, tint)
        // clock
        drawCircle(Color.White.copy(alpha = 0.9f), radius = w * 0.028f, center = Offset(w * 0.5f, h * 0.36f))
        drawCircle(accent, radius = w * 0.008f, center = Offset(w * 0.5f, h * 0.36f))
        // windows
        val win = Color(0xFFFDE68A).copy(alpha = 0.85f)
        for (row in 0..2) for (col in 0..4) {
            val y = h * (0.58f + row * 0.085f)
            drawRoundRect(win, topLeft = Offset(w * (0.16f + col * 0.05f), y), size = Size(w * 0.025f, h * 0.045f), cornerRadius = CornerRadius(3f, 3f))
            drawRoundRect(win, topLeft = Offset(w * (0.61f + col * 0.05f), y), size = Size(w * 0.025f, h * 0.045f), cornerRadius = CornerRadius(3f, 3f))
        }
        drawRoundRect(win, topLeft = Offset(w * 0.475f, h * 0.7f), size = Size(w * 0.05f, base - h * 0.7f), cornerRadius = CornerRadius(10f, 10f))
        // trees
        listOf(0.05f, 0.95f, 0.2f, 0.8f).forEachIndexed { i, tx ->
            val r = h * (if (i < 2) 0.11f else 0.08f)
            drawRect(tint.copy(alpha = 0.8f), topLeft = Offset(w * tx - 3f, base - r * 0.6f), size = Size(6f, r * 0.6f))
            drawCircle(accent.copy(alpha = 0.9f), radius = r, center = Offset(w * tx, base - r * 1.2f))
        }
        // lawn
        drawRect(accent.copy(alpha = 0.35f), topLeft = Offset(0f, base), size = Size(w, h - base))
    }
}

/** Soft organic leaf shapes for onboarding backgrounds. */
@Composable
fun LeafDecoration(modifier: Modifier = Modifier, color: Color = CcColors.Mint) {
    Canvas(modifier) {
        val w = size.width
        val h = size.height
        fun leaf(cx: Float, cy: Float, r: Float, alpha: Float) {
            val p = Path().apply {
                moveTo(cx, cy - r)
                quadraticBezierTo(cx + r, cy - r * 0.2f, cx, cy + r)
                quadraticBezierTo(cx - r, cy - r * 0.2f, cx, cy - r)
                close()
            }
            drawPath(p, color.copy(alpha = alpha))
        }
        leaf(w * 0.1f, h * 0.15f, w * 0.12f, 0.7f)
        leaf(w * 0.92f, h * 0.08f, w * 0.1f, 0.5f)
        leaf(w * 0.86f, h * 0.55f, w * 0.14f, 0.35f)
        leaf(w * 0.05f, h * 0.7f, w * 0.09f, 0.4f)
    }
}
