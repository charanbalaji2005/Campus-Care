package edu.srmap.campuscare.ui.components

import android.os.SystemClock
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.GpsFixed
import androidx.compose.material.icons.rounded.GpsNotFixed
import androidx.compose.material.icons.rounded.GpsOff
import androidx.compose.material.icons.rounded.LocationOff
import androidx.compose.material.icons.rounded.MyLocation
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.LocationPermissions
import edu.srmap.campuscare.util.LocationQuality
import edu.srmap.campuscare.util.LocationQualityRules
import edu.srmap.campuscare.util.PermissionLevel
import edu.srmap.campuscare.util.RawFix
import edu.srmap.campuscare.util.accuracyLabel
import edu.srmap.campuscare.util.ageLabel
import edu.srmap.campuscare.util.ageSeconds
import kotlinx.coroutines.delay

fun LocationQuality.tone(): Tone = when (this) {
    LocationQuality.High -> Tone.Brand
    LocationQuality.Usable -> Tone.Teal
    LocationQuality.Low -> Tone.Amber
    LocationQuality.Poor, LocationQuality.Stale -> Tone.Danger
    LocationQuality.Unknown -> Tone.Neutral
}

/** Re-composes every second so ages ("12 s old") stay honest. */
@Composable
fun rememberNowMs(): Long {
    var now by remember { mutableLongStateOf(SystemClock.elapsedRealtime()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(1_000)
            now = SystemClock.elapsedRealtime()
        }
    }
    return now
}

/**
 * Location quality as words + colour (never colour alone): accuracy radius, age, and what that
 * means for the person relying on it. A fix without fresh updates is labelled stale, never "current".
 */
@Composable
fun LocationQualityPanel(
    fix: RawFix?,
    staleSeconds: Double,
    permission: PermissionLevel,
    locationEnabled: Boolean,
    modifier: Modifier = Modifier,
    acquiring: Boolean = true,
    audienceNote: String? = null,
    uploadNote: String? = null,
    onRequestPermission: (() -> Unit)? = null,
) {
    val context = LocalContext.current
    val now = rememberNowMs()
    val age = fix?.ageSeconds(now)
    val quality = fix?.let { LocationQualityRules.classify(it.accuracyMeters, age, staleSeconds) }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            val icon = when {
                permission == PermissionLevel.None || !locationEnabled -> Icons.Rounded.LocationOff
                quality == null -> Icons.Rounded.GpsNotFixed
                quality == LocationQuality.Stale -> Icons.Rounded.GpsOff
                else -> Icons.Rounded.GpsFixed
            }
            IconBadge(icon, quality?.tone() ?: Tone.Amber, size = 40.dp, iconSize = 20.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    when {
                        permission == PermissionLevel.None -> "Location not allowed"
                        !locationEnabled -> "Location is turned off"
                        fix == null && acquiring -> "Finding your location…"
                        fix == null -> "No location fix"
                        quality == LocationQuality.Stale -> "Last known location (${ageLabel(age)})"
                        else -> "Location ${quality?.label?.lowercase()}"
                    },
                    style = MaterialTheme.typography.titleSmall, color = CcColors.Ink,
                )
                if (fix != null) {
                    Text(
                        "Accurate to ${accuracyLabel(fix.accuracyMeters)} · ${ageLabel(age)}",
                        style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft,
                    )
                }
            }
            quality?.let { StatusChip(it.label, it.tone(), dot = true) }
        }
        when {
            permission == PermissionLevel.None -> {
                Text("Responders can still be alerted without it, but they won't know where you are.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    onRequestPermission?.let { CcButton("Allow location", it, kind = ButtonKind.Soft, leadingIcon = Icons.Rounded.MyLocation) }
                    CcButton("Open settings", { LocationPermissions.openAppSettings(context) }, kind = ButtonKind.Ghost, leadingIcon = Icons.Rounded.Settings)
                }
            }
            !locationEnabled -> CcButton("Turn on location", { LocationPermissions.openLocationSettings(context) }, kind = ButtonKind.Soft, leadingIcon = Icons.Rounded.Settings)
            permission == PermissionLevel.Approximate -> {
                Text("Only approximate location is allowed, which can be off by a kilometre or more. Allow precise location so responders can find you.", style = MaterialTheme.typography.bodySmall, color = CcColors.Amber)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    onRequestPermission?.let { CcButton("Allow precise", it, kind = ButtonKind.Soft) }
                    CcButton("Open settings", { LocationPermissions.openAppSettings(context) }, kind = ButtonKind.Ghost, leadingIcon = Icons.Rounded.Settings)
                }
            }
            quality == LocationQuality.Poor || quality == LocationQuality.Low ->
                Text("Weak signal (indoors or near tall buildings?). Responders may receive an approximate location; still trying for a better fix.", style = MaterialTheme.typography.bodySmall, color = CcColors.Amber)
            quality == LocationQuality.Stale ->
                Text("No fresh location is arriving. This is where you were ${ageLabel(age)}, not necessarily where you are now.", style = MaterialTheme.typography.bodySmall, color = CcColors.Sos)
        }
        audienceNote?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = CcColors.InkSoft) }
        uploadNote?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = CcColors.InkSoft) }
    }
}

/** Shown before the operating-system prompt: why location is needed and who will see it. */
@Composable
fun LocationRationaleDialog(purpose: String, onContinue: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Color.White,
        icon = { Icon(Icons.Rounded.MyLocation, contentDescription = null, tint = CcColors.Forest) },
        title = { Text("Allow precise location?") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(purpose, style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink)
                Text(
                    "CampusCare uses your location only while this feature is on, shows a notification while it is shared, and stops when you end it. It is never posted to the community.",
                    style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft,
                )
                Text("Choose \"Precise\" in the next prompt — approximate location can be off by a kilometre or more.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
            }
        },
        confirmButton = { TextButton(onClick = onContinue) { Text("Continue") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Not now") } },
        modifier = Modifier.padding(0.dp),
    )
}
