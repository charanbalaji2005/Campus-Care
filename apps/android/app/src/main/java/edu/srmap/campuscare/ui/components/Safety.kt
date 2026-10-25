package edu.srmap.campuscare.ui.components

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Call
import androidx.compose.material.icons.rounded.HealthAndSafety
import androidx.compose.material.icons.rounded.LocalHospital
import androidx.compose.material.icons.rounded.LocalPolice
import androidx.compose.material.icons.rounded.Phone
import androidx.compose.material.icons.rounded.Psychology
import androidx.compose.material.icons.rounded.SupportAgent
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.data.EmergencyContact
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.dial

fun contactIcon(category: String): ImageVector = when (category) {
    "security", "emergency" -> Icons.Rounded.LocalPolice
    "medical" -> Icons.Rounded.LocalHospital
    "counselling", "mental_health" -> Icons.Rounded.Psychology
    "helpline" -> Icons.Rounded.SupportAgent
    "committee" -> Icons.Rounded.HealthAndSafety
    else -> Icons.Rounded.Phone
}

fun contactTone(category: String): Tone = when (category) {
    "security", "emergency" -> Tone.Danger
    "medical" -> Tone.Rose
    "counselling", "mental_health" -> Tone.Violet
    "helpline" -> Tone.Sky
    else -> Tone.Brand
}

/** One emergency number with a large call button (opens the dialer; the person confirms the call). */
@Composable
fun EmergencyCallRow(name: String, phone: String?, purpose: String, category: String, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    Row(
        modifier.fillMaxWidth().padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconBadge(contactIcon(category), contactTone(category), size = 44.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(name, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
            if (purpose.isNotBlank()) Text(purpose, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft, maxLines = 2)
            phone?.let { Text(it, style = MaterialTheme.typography.labelLarge, color = CcColors.Forest, fontWeight = FontWeight.Bold) }
        }
        if (!phone.isNullOrBlank()) {
            FilledIconButton(
                onClick = { context.dial(phone) },
                modifier = Modifier.size(48.dp).semantics { contentDescription = "Call $name" },
                colors = IconButtonDefaults.filledIconButtonColors(containerColor = if (category == "security" || category == "emergency") CcColors.Sos else CcColors.Forest),
                shape = CircleShape,
            ) { Icon(Icons.Rounded.Call, contentDescription = null) }
        }
    }
}

@Composable
fun EmergencyCallRow(contact: EmergencyContact, modifier: Modifier = Modifier) =
    EmergencyCallRow(contact.name, contact.phone, contact.purpose, contact.category, modifier)

/** Small coloured dot used in legends. */
@Composable
fun LegendDot(color: androidx.compose.ui.graphics.Color, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Spacer(Modifier.size(10.dp).background(color, CircleShape))
        Spacer(Modifier.width(6.dp))
        Text(label, style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
    }
}

/**
 * Asks for location permission when needed. Returns a function that runs [then] once the person
 * has answered (granted or not) — callers must handle "no location" gracefully.
 */
@Composable
fun rememberLocationRequest(then: (granted: Boolean) -> Unit): () -> Unit {
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        then(result.values.any { it })
    }
    return { launcher.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)) }
}
