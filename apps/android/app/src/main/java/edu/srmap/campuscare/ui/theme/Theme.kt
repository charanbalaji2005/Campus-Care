package edu.srmap.campuscare.ui.theme

import android.provider.Settings
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp

private val CcColorScheme = lightColorScheme(
    primary = CcColors.Forest,
    onPrimary = CcColors.Surface,
    primaryContainer = CcColors.Mint,
    onPrimaryContainer = CcColors.Forest,
    secondary = CcColors.Emerald,
    onSecondary = CcColors.Surface,
    secondaryContainer = CcColors.Mint50,
    onSecondaryContainer = CcColors.Forest,
    tertiary = CcColors.Teal,
    onTertiary = CcColors.Surface,
    background = CcColors.Cream,
    onBackground = CcColors.Ink,
    surface = CcColors.Surface,
    onSurface = CcColors.Ink,
    surfaceVariant = CcColors.CreamDeep,
    onSurfaceVariant = CcColors.InkSoft,
    outline = CcColors.Line,
    outlineVariant = CcColors.Line,
    error = CcColors.Sos,
    onError = CcColors.Surface,
    errorContainer = CcColors.SosSoft,
    onErrorContainer = CcColors.SosDeep,
    surfaceContainerLowest = CcColors.Surface,
    surfaceContainerLow = CcColors.Surface,
    surfaceContainer = CcColors.Surface,
    surfaceContainerHigh = CcColors.Surface,
    surfaceContainerHighest = CcColors.CreamDeep,
)

val CcShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(18.dp),
    large = RoundedCornerShape(24.dp),
    extraLarge = RoundedCornerShape(32.dp),
)

/** True when the user turned off system animations: decorative/looping motion is skipped. */
val LocalReducedMotion = staticCompositionLocalOf { false }

/**
 * App theme. [reduceMotion] and [largeText] are the in-app accessibility switches (Profile →
 * Accessibility); the system "remove animations" setting is always honoured as well.
 */
@Composable
fun CampusCareTheme(reduceMotion: Boolean = false, largeText: Boolean = false, content: @Composable () -> Unit) {
    val context = LocalContext.current
    val systemReduced = remember {
        runCatching { Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }.getOrDefault(false)
    }
    val density = LocalDensity.current
    val scaled = if (largeText) Density(density.density, fontScale = density.fontScale * 1.18f) else density
    CompositionLocalProvider(LocalReducedMotion provides (systemReduced || reduceMotion), LocalDensity provides scaled) {
        MaterialTheme(colorScheme = CcColorScheme, typography = CcTypography, shapes = CcShapes, content = content)
    }
}
