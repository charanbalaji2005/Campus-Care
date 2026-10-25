package edu.srmap.campuscare.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.Visibility
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.ui.theme.CcColors

/** Labelled text field matching the mockups (soft border, icon, inline error). */
@Composable
fun CcTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    leadingIcon: ImageVector? = null,
    error: String? = null,
    hint: String? = null,
    keyboardType: KeyboardType = KeyboardType.Text,
    imeAction: ImeAction = ImeAction.Next,
    onImeAction: (() -> Unit)? = null,
    password: Boolean = false,
    singleLine: Boolean = true,
    minLines: Int = 1,
    maxLength: Int? = null,
    enabled: Boolean = true,
    capitalization: KeyboardCapitalization = KeyboardCapitalization.None,
    trailing: (@Composable () -> Unit)? = null,
) {
    var visible by remember { mutableStateOf(false) }
    Column(modifier.fillMaxWidth()) {
        OutlinedTextField(
            value = value,
            onValueChange = { if (maxLength == null || it.length <= maxLength) onValueChange(it) },
            modifier = Modifier.fillMaxWidth(),
            label = { Text(label) },
            placeholder = placeholder?.let { { Text(it, color = CcColors.InkFaint) } },
            leadingIcon = leadingIcon?.let { { Icon(it, contentDescription = null, tint = if (error != null) CcColors.Sos else CcColors.InkSoft) } },
            trailingIcon = when {
                password -> {
                    {
                        IconButton(onClick = { visible = !visible }) {
                            Icon(
                                if (visible) Icons.Rounded.VisibilityOff else Icons.Rounded.Visibility,
                                contentDescription = if (visible) "Hide password" else "Show password",
                                tint = CcColors.InkSoft,
                            )
                        }
                    }
                }
                trailing != null -> trailing
                else -> null
            },
            isError = error != null,
            singleLine = singleLine,
            minLines = minLines,
            enabled = enabled,
            visualTransformation = if (password && !visible) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(keyboardType = if (password) KeyboardType.Password else keyboardType, imeAction = imeAction, capitalization = capitalization),
            keyboardActions = KeyboardActions(onAny = { onImeAction?.invoke() }),
            shape = RoundedCornerShape(16.dp),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = CcColors.Emerald,
                unfocusedBorderColor = CcColors.Line,
                focusedContainerColor = Color.White,
                unfocusedContainerColor = Color.White,
                disabledContainerColor = CcColors.CreamDeep,
                focusedLabelColor = CcColors.Forest,
                cursorColor = CcColors.Emerald,
                errorBorderColor = CcColors.Sos,
            ),
        )
        AnimatedVisibility(visible = error != null || hint != null, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
            Row(Modifier.padding(start = 6.dp, top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                if (error != null) {
                    Icon(Icons.Rounded.ErrorOutline, contentDescription = null, tint = CcColors.Sos, modifier = Modifier.size(14.dp))
                    Spacer(Modifier.width(4.dp))
                }
                Text(
                    error ?: hint.orEmpty(),
                    style = MaterialTheme.typography.bodySmall,
                    color = if (error != null) CcColors.Sos else CcColors.InkSoft,
                )
            }
        }
        if (maxLength != null && !singleLine) {
            Text("${value.length}/$maxLength", style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint, modifier = Modifier.align(Alignment.End).padding(top = 2.dp, end = 4.dp))
        }
    }
}

/** Simple select field backed by a dropdown menu. Options are (value, label) pairs. */
@Composable
fun CcSelect(
    label: String,
    options: List<Pair<String, String>>,
    selected: String?,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
    leadingIcon: ImageVector? = null,
    error: String? = null,
    placeholder: String = "Select",
) {
    var expanded by remember { mutableStateOf(false) }
    val current = options.firstOrNull { it.first == selected }?.second
    Box(modifier.fillMaxWidth()) {
        CcTextField(
            value = current ?: "",
            onValueChange = {},
            label = label,
            placeholder = placeholder,
            leadingIcon = leadingIcon,
            error = error,
            enabled = true,
            trailing = { Icon(Icons.Rounded.ExpandMore, contentDescription = null, tint = CcColors.InkSoft) },
        )
        // Transparent overlay so the whole field opens the menu (the text field itself is read-only).
        Box(
            Modifier
                .matchParentSize()
                .clip(RoundedCornerShape(16.dp))
                .clickable(role = Role.Button) { expanded = true }
                .semantics { contentDescription = "$label: ${current ?: placeholder}" },
        )
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { (value, text) ->
                DropdownMenuItem(
                    text = { Text(text, fontWeight = if (value == selected) FontWeight.SemiBold else FontWeight.Normal) },
                    onClick = { onSelect(value); expanded = false },
                    leadingIcon = if (value == selected) ({ Icon(Icons.Rounded.CheckCircle, contentDescription = null, tint = CcColors.Emerald) }) else null,
                )
            }
        }
    }
}

/** Title + description + switch row with a large touch target. */
@Composable
fun SwitchRow(title: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit, modifier: Modifier = Modifier, description: String? = null, enabled: Boolean = true) {
    Row(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .clickable(enabled = enabled, role = Role.Switch) { onCheckedChange(!checked) }
            .padding(vertical = 10.dp, horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
            description?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft) }
        }
        Spacer(Modifier.width(12.dp))
        Switch(
            checked = checked,
            onCheckedChange = null,
            enabled = enabled,
            colors = SwitchDefaults.colors(checkedTrackColor = CcColors.Emerald, checkedThumbColor = Color.White, uncheckedTrackColor = CcColors.CreamDeep, uncheckedBorderColor = CcColors.Line),
        )
    }
}

/** Live password strength meter (length, mixed case, digit, symbol). */
@Composable
fun PasswordStrength(password: String, minLength: Int) {
    if (password.isEmpty()) return
    val checks = listOf(
        password.length >= minLength,
        password.any { it.isLowerCase() } && password.any { it.isUpperCase() },
        password.any { it.isDigit() },
        password.any { !it.isLetterOrDigit() } || password.length >= minLength + 4,
    )
    val score = checks.count { it }
    val (label, color) = when (score) {
        0, 1 -> "Weak" to CcColors.Sos
        2 -> "Fair" to CcColors.Amber
        3 -> "Good" to CcColors.Emerald
        else -> "Strong" to CcColors.Forest
    }
    Column(Modifier.fillMaxWidth().padding(top = 6.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
            repeat(4) { i ->
                val c by animateColorAsState(if (i < score) color else CcColors.CreamDeep, label = "seg$i")
                Box(Modifier.weight(1f).height(5.dp).clip(RoundedCornerShape(3.dp)).background(c))
            }
        }
        Text(
            "$label · use $minLength+ characters with upper and lower case letters and a number",
            style = MaterialTheme.typography.labelSmall,
            color = CcColors.InkSoft,
            modifier = Modifier.padding(top = 4.dp),
        )
    }
}
