package edu.srmap.campuscare.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.ui.theme.CcColors

@Composable
fun ConfirmDialog(
    title: String,
    message: String,
    confirmLabel: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    destructive: Boolean = false,
    loading: Boolean = false,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Color.White,
        title = { Text(title, style = MaterialTheme.typography.headlineSmall) },
        text = { Text(message, style = MaterialTheme.typography.bodyMedium, color = CcColors.InkSoft) },
        confirmButton = {
            CcButton(confirmLabel, onConfirm, kind = if (destructive) ButtonKind.Danger else ButtonKind.Primary, loading = loading)
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel", color = CcColors.InkSoft) } },
    )
}

/** Dialog that collects a short text (reason, note, confirmation phrase). */
@Composable
fun InputDialog(
    title: String,
    message: String?,
    label: String,
    confirmLabel: String,
    onConfirm: (String) -> Unit,
    onDismiss: () -> Unit,
    minLength: Int = 3,
    multiline: Boolean = true,
    destructive: Boolean = false,
    loading: Boolean = false,
    initial: String = "",
) {
    var text by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Color.White,
        title = { Text(title, style = MaterialTheme.typography.headlineSmall) },
        text = {
            Column {
                message?.let {
                    Text(it, style = MaterialTheme.typography.bodyMedium, color = CcColors.InkSoft)
                    Spacer(Modifier.height(12.dp))
                }
                CcTextField(text, { text = it }, label = label, singleLine = !multiline, minLines = if (multiline) 3 else 1, maxLength = 1000)
            }
        },
        confirmButton = {
            CcButton(
                confirmLabel, { onConfirm(text.trim()) },
                kind = if (destructive) ButtonKind.Danger else ButtonKind.Primary,
                enabled = text.trim().length >= minLength, loading = loading,
            )
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel", color = CcColors.InkSoft, fontWeight = FontWeight.SemiBold) } },
    )
}
