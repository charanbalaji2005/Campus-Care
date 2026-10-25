package edu.srmap.campuscare.ui.components

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.ui.theme.CcColors

enum class ButtonKind { Primary, Brand, Outline, Soft, Danger, Ghost }

/** Primary call-to-action with press feedback, loading state and an optional icon. Min 52dp tall (accessible target). */
@Composable
fun CcButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    kind: ButtonKind = ButtonKind.Primary,
    enabled: Boolean = true,
    loading: Boolean = false,
    leadingIcon: ImageVector? = null,
    trailingIcon: ImageVector? = null,
) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.97f else 1f, animationSpec = spring(stiffness = 600f), label = "press")
    val shape = RoundedCornerShape(16.dp)
    val content: @Composable () -> Unit = {
        AnimatedContent(targetState = loading, transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "btn") { isLoading ->
            if (isLoading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(22.dp),
                    strokeWidth = 2.5.dp,
                    color = if (kind == ButtonKind.Outline || kind == ButtonKind.Ghost || kind == ButtonKind.Soft) CcColors.Forest else Color.White,
                )
            } else {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
                    leadingIcon?.let {
                        Icon(it, contentDescription = null, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(8.dp))
                    }
                    Text(text, fontWeight = FontWeight.SemiBold)
                    trailingIcon?.let {
                        Spacer(Modifier.width(8.dp))
                        Icon(it, contentDescription = null, modifier = Modifier.size(20.dp))
                    }
                }
            }
        }
    }
    val m = modifier.defaultMinSize(minHeight = 52.dp).scale(scale)
    val padding = PaddingValues(horizontal = 20.dp, vertical = 14.dp)
    when (kind) {
        ButtonKind.Outline -> OutlinedButton(
            onClick = onClick, modifier = m, enabled = enabled && !loading, shape = shape, interactionSource = interaction,
            border = BorderStroke(1.dp, CcColors.Line), contentPadding = padding,
            colors = ButtonDefaults.outlinedButtonColors(containerColor = Color.White, contentColor = CcColors.Ink),
        ) { content() }
        ButtonKind.Ghost -> TextButton(
            onClick = onClick, modifier = m, enabled = enabled && !loading, shape = shape, interactionSource = interaction, contentPadding = padding,
            colors = ButtonDefaults.textButtonColors(contentColor = CcColors.Forest),
        ) { content() }
        else -> {
            val (bg, fg) = when (kind) {
                ButtonKind.Brand -> CcColors.Emerald to Color.White
                ButtonKind.Soft -> CcColors.Mint to CcColors.Forest
                ButtonKind.Danger -> CcColors.Sos to Color.White
                else -> CcColors.Forest to Color.White
            }
            Button(
                onClick = onClick, modifier = m, enabled = enabled && !loading, shape = shape, interactionSource = interaction, contentPadding = padding,
                colors = ButtonDefaults.buttonColors(containerColor = bg, contentColor = fg, disabledContainerColor = bg.copy(alpha = 0.45f), disabledContentColor = fg.copy(alpha = 0.8f)),
                elevation = ButtonDefaults.buttonElevation(defaultElevation = 0.dp, pressedElevation = 0.dp),
            ) { content() }
        }
    }
}
