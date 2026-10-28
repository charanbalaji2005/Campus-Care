package edu.srmap.campuscare.ui.screens.auth

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.ContentPaste
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.MarkEmailUnread
import androidx.compose.material.icons.rounded.Pin
import androidx.compose.material.icons.rounded.Schedule
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import edu.srmap.campuscare.data.DeliveryInfo
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.ui.theme.LocalReducedMotion

/** Length of the one-time email codes (matches the API's OTP_LENGTH). */
const val EMAIL_CODE_LENGTH = 6

/** Only digits, at most [EMAIL_CODE_LENGTH]: what typing, autofill or pasting a whole email line leaves. */
fun sanitizeCode(input: String): String = input.filter(Char::isDigit).take(EMAIL_CODE_LENGTH)

/** First run of exactly six digits in pasted text ("Your code is 482913."), or null. */
fun codeFromClipboard(text: String?): String? =
    text?.let { Regex("(?<!\\d)(\\d{$EMAIL_CODE_LENGTH})(?!\\d)").find(it)?.groupValues?.get(1) }

/** `n***@srmap.edu.in`: shows enough to recognise the address without displaying it in full. */
fun maskEmail(email: String): String {
    val e = email.trim()
    val at = e.lastIndexOf('@')
    if (at <= 0) return "your university email"
    return "${e.first()}***${e.substring(at)}"
}

/**
 * Six-box code entry backed by one real text field, so the keyboard, paste, autofill and screen readers
 * see an ordinary numeric input. Extra characters are dropped; [onComplete] runs when six digits are in.
 * A wrong code shakes the boxes once (not with reduced motion).
 */
@Composable
fun OtpCodeField(
    code: String,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    error: String? = null,
    errorKey: Int = 0,
    onComplete: (String) -> Unit = {},
) {
    val reduced = LocalReducedMotion.current
    val focus = remember { FocusRequester() }
    val shake = remember { Animatable(0f) }
    LaunchedEffect(errorKey) {
        if (errorKey == 0 || reduced) return@LaunchedEffect
        for (x in listOf(14f, -12f, 9f, -6f, 3f, 0f)) shake.animateTo(x, spring(stiffness = Spring.StiffnessHigh))
    }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    Column(modifier.fillMaxWidth()) {
        BasicTextField(
            value = TextFieldValue(code, selection = TextRange(code.length)),
            onValueChange = {
                val clean = sanitizeCode(it.text)
                if (clean != code) {
                    onChange(clean)
                    if (clean.length == EMAIL_CODE_LENGTH) onComplete(clean)
                }
            },
            enabled = enabled,
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { if (code.length == EMAIL_CODE_LENGTH) onComplete(code) }),
            modifier = Modifier
                .fillMaxWidth()
                .focusRequester(focus)
                .graphicsLayer { translationX = shake.value }
                .semantics {
                    contentDescription = "$EMAIL_CODE_LENGTH-digit code, ${code.length} entered"
                    if (error != null) error(error)
                },
            decorationBox = { _ ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    repeat(EMAIL_CODE_LENGTH) { i ->
                        val char = code.getOrNull(i)
                        val active = i == code.length && enabled
                        val border by animateColorAsState(
                            when {
                                error != null -> CcColors.Sos
                                active -> CcColors.Emerald
                                char != null -> CcColors.Forest.copy(alpha = 0.5f)
                                else -> CcColors.Line
                            },
                            label = "otpBox",
                        )
                        Box(
                            Modifier
                                .weight(1f)
                                .aspectRatio(0.82f)
                                .heightIn(min = 48.dp)
                                .clip(RoundedCornerShape(14.dp))
                                .background(if (char != null) CcColors.Mint.copy(alpha = 0.45f) else Color.White)
                                .border(if (active) 2.dp else 1.dp, border, RoundedCornerShape(14.dp)),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                char?.toString() ?: "",
                                fontSize = 24.sp,
                                fontWeight = FontWeight.Bold,
                                fontFamily = FontFamily.Monospace,
                                color = CcColors.Ink,
                            )
                        }
                    }
                }
            },
        )
        if (error != null) {
            Text(
                error,
                style = MaterialTheme.typography.bodySmall,
                color = CcColors.Sos,
                modifier = Modifier.padding(top = 6.dp).semantics { liveRegion = LiveRegionMode.Assertive },
            )
        }
    }
}

/** "Paste code" for when the code was copied from the email app. */
@Composable
fun PasteCodeButton(onCode: (String) -> Unit, onNothing: () -> Unit, modifier: Modifier = Modifier) {
    val clipboard = LocalClipboardManager.current
    TextButton(
        onClick = {
            val found = codeFromClipboard(runCatching { clipboard.getText()?.text }.getOrNull())
            if (found != null) onCode(found) else onNothing()
        },
        modifier = modifier,
    ) {
        Icon(Icons.Rounded.ContentPaste, contentDescription = null, tint = CcColors.Emerald, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(6.dp))
        Text("Paste code", color = CcColors.Emerald, fontWeight = FontWeight.SemiBold)
    }
}

/** One choosable way of receiving an email (code or link), shown as an accessible radio card. */
data class EmailMethodOption(val method: String, val title: String, val description: String, val icon: ImageVector)

fun verificationOptions() = listOf(
    EmailMethodOption("otp", "Verify using OTP", "We email you a 6-digit code to type here. Handy if links open on another device.", Icons.Rounded.Pin),
    EmailMethodOption("link", "Verify using an email link", "We email you a link. Open it on this phone and tap Verify.", Icons.Rounded.Link),
)

fun resetOptions() = listOf(
    EmailMethodOption("otp", "Reset password with OTP", "We email you a 6-digit code. Enter it here, then choose a new password.", Icons.Rounded.Pin),
    EmailMethodOption("link", "Send a password-reset link", "We email you a link that opens CampusCare's reset screen.", Icons.Rounded.Link),
)

@Composable
fun EmailMethodChoice(options: List<EmailMethodOption>, selected: String, onSelect: (String) -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    Column(modifier.fillMaxWidth().selectableGroup(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        options.forEach { o ->
            val isSelected = o.method == selected
            val border by animateColorAsState(if (isSelected) CcColors.Emerald else CcColors.Line, label = "methodBorder")
            val bg by animateColorAsState(if (isSelected) CcColors.Mint.copy(alpha = 0.55f) else Color.White, label = "methodBg")
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(18.dp))
                    .background(bg)
                    .border(if (isSelected) 2.dp else 1.dp, border, RoundedCornerShape(18.dp))
                    .selectable(selected = isSelected, enabled = enabled, role = Role.RadioButton, onClick = { onSelect(o.method) })
                    .padding(horizontal = 12.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                RadioButton(selected = isSelected, onClick = null, enabled = enabled, colors = RadioButtonDefaults.colors(selectedColor = CcColors.Emerald))
                Spacer(Modifier.width(8.dp))
                Icon(o.icon, contentDescription = null, tint = if (isSelected) CcColors.Forest else CcColors.InkSoft, modifier = Modifier.size(22.dp))
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(o.title, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink, fontWeight = FontWeight.SemiBold)
                    Text(o.description, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                }
            }
        }
    }
}

/** What the person is told about the email. "Accepted" is not "delivered": that needs the provider to say so. */
fun deliveryText(d: DeliveryInfo?, what: String): Triple<String, Tone, ImageVector>? = when (d?.status) {
    null -> null
    "sending" -> Triple("Sending your $what…", Tone.Neutral, Icons.Rounded.Schedule)
    "accepted" -> Triple("Your $what was handed to our mail service. It can take a few minutes to arrive; check spam too.", Tone.Brand, Icons.Rounded.MarkEmailUnread)
    "delivered" -> Triple("Your $what was delivered.", Tone.Brand, Icons.Rounded.CheckCircle)
    "bounced", "rejected" -> Triple("Your university mail server refused the $what. Check the address with the support office, then try again.", Tone.Danger, Icons.Rounded.ErrorOutline)
    else -> Triple("We couldn't send the email. Please try again.", Tone.Danger, Icons.Rounded.ErrorOutline)
}

/** Animated swap between the steps of an auth flow (choose → enter code → done). A plain fade with reduced motion. */
@Composable
fun <T> AuthStep(target: T, content: @Composable ColumnScope.(T) -> Unit) {
    val reduced = LocalReducedMotion.current
    AnimatedContent(
        targetState = target,
        transitionSpec = {
            if (reduced) fadeIn(tween(90)) togetherWith fadeOut(tween(60))
            else (fadeIn(tween(220, delayMillis = 60)) + slideInVertically(tween(280)) { it / 12 }) togetherWith fadeOut(tween(140))
        },
        label = "authStep",
    ) { s ->
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) { content(s) }
    }
}

/** Small status line for the current email (announced politely when it changes). */
@Composable
fun DeliveryStatusLine(d: DeliveryInfo?, what: String, modifier: Modifier = Modifier) {
    val (text, tone, icon) = deliveryText(d, what) ?: return
    Row(
        modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(tone.bg.copy(alpha = 0.6f)).padding(12.dp)
            .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = tone.fg, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(10.dp))
        Text(text, style = MaterialTheme.typography.bodySmall, color = CcColors.Ink, textAlign = TextAlign.Start)
    }
}
