package edu.srmap.campuscare.ui.screens.staff

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.data.CaTimelineEvent
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcTextField
import edu.srmap.campuscare.ui.components.CountBadge
import edu.srmap.campuscare.ui.components.IconBadge
import edu.srmap.campuscare.ui.components.InfoBanner
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.data.CampusAdminApi
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.Fmt

/** Campus Admin portal API, built on the app's shared client (same session, headers and errors). */
@Composable
internal fun rememberCampusAdminApi(): CampusAdminApi {
    val app = LocalApp.current
    return androidx.compose.runtime.remember(app) { CampusAdminApi(app.api.client) }
}

internal fun bucketTone(bucket: String): Tone = when (bucket) {
    "danger" -> Tone.Danger
    "amber" -> Tone.Amber
    "violet" -> Tone.Violet
    "sky" -> Tone.Sky
    "ok" -> Tone.Brand
    else -> Tone.Neutral
}

/** Large number with a label and icon; tappable when [onClick] is set. */
@Composable
internal fun CaMetricCard(label: String, value: String, modifier: Modifier = Modifier, tone: Tone = Tone.Brand, icon: ImageVector? = null, caption: String? = null, onClick: (() -> Unit)? = null) {
    // Icon above the number so two or three cards fit side by side on a phone without wrapping the value.
    CcCard(modifier.fillMaxHeight().semantics(mergeDescendants = true) { contentDescription = "$label: $value" }, onClick = onClick, padding = 12.dp) {
        if (icon != null) {
            IconBadge(icon, tone, size = 32.dp, iconSize = 17.dp)
            Spacer(Modifier.height(8.dp))
        }
        Text(
            value, style = if (value.length > 6) MaterialTheme.typography.titleMedium else MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold, color = tone.fg, maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
        Text(label, style = MaterialTheme.typography.labelMedium, color = CcColors.InkSoft, maxLines = 2, overflow = TextOverflow.Ellipsis)
        if (caption != null) {
            Spacer(Modifier.height(4.dp))
            Text(caption, style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** Cards side by side, all as tall as the tallest one. */
@Composable
internal fun CaMetricRow(content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit) {
    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(10.dp), content = content)
}

/** Status chips that wrap onto a new line instead of running off the card. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun CaChipRow(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    FlowRow(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { content() }
}

/** Entry to one workflow module, with a coloured icon and an optional count. */
@Composable
internal fun CaModuleCard(title: String, subtitle: String, icon: ImageVector, tone: Tone, modifier: Modifier = Modifier, badge: Int = 0, onClick: () -> Unit) {
    CcCard(modifier.fillMaxHeight(), onClick = onClick, padding = 12.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box {
                IconBadge(icon, tone, size = 40.dp, iconSize = 20.dp)
                if (badge > 0) CountBadge(badge, Modifier.align(Alignment.TopEnd))
            }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = CcColors.Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(subtitle, style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable
internal fun CaSearchBar(value: String, onChange: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier) {
    CcTextField(value, onChange, label = "Search", placeholder = placeholder, leadingIcon = Icons.Rounded.Search, imeAction = ImeAction.Search, modifier = modifier.fillMaxWidth(), maxLength = 60)
}

/** Explains what the server withheld and why (never a silent gap). */
@Composable
internal fun CaRestricted(text: String, modifier: Modifier = Modifier) {
    InfoBanner(text, modifier = modifier, tone = Tone.Neutral, icon = Icons.Rounded.Lock)
}

@Composable
internal fun CaChip(text: String, bucket: String, modifier: Modifier = Modifier) = StatusChip(text, bucketTone(bucket), modifier, dot = true)

/** Vertical timeline of workflow events (type, actor label, time). */
@Composable
internal fun CaTimeline(events: List<CaTimelineEvent>) {
    Column {
        events.forEachIndexed { i, e ->
            Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.width(18.dp).fillMaxHeight()) {
                    Box(Modifier.padding(top = 5.dp).size(10.dp).clip(CircleShape).background(if (i == events.lastIndex) CcColors.Emerald else CcColors.Forest))
                    if (i < events.lastIndex) Box(Modifier.width(2.dp).weight(1f).background(CcColors.Line))
                }
                Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f).padding(bottom = 8.dp)) {
                    Text(Fmt.humanize(e.type), style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink, fontWeight = FontWeight.Medium)
                    Text(listOfNotNull(e.actor, Fmt.dateTime(e.at)).joinToString(" · "), style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint)
                    e.note?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft) }
                }
            }
        }
    }
}

/** Horizontal bars, one per row; a null value is a suppressed small aggregate. */
@Composable
internal fun CaBarList(rows: List<Pair<String, Int?>>, color: Color, threshold: Int = 5) {
    val max = (rows.mapNotNull { it.second }.maxOrNull() ?: 0).coerceAtLeast(1)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        rows.forEach { (label, value) ->
            Column(Modifier.semantics(mergeDescendants = true) { contentDescription = "$label: ${CampusAdminRules.aggregate(value, threshold)}" }) {
                Row {
                    Text(label, style = MaterialTheme.typography.labelMedium, color = CcColors.Ink, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(CampusAdminRules.aggregate(value, threshold), style = MaterialTheme.typography.labelMedium, color = CcColors.InkSoft)
                }
                Spacer(Modifier.height(4.dp))
                Canvas(Modifier.fillMaxWidth().height(8.dp)) {
                    drawRoundRect(CcColors.CreamDeep, size = size, cornerRadius = CornerRadius(8f, 8f))
                    val v = value ?: 0
                    if (v > 0) drawRoundRect(color, size = Size(size.width * v / max, size.height), cornerRadius = CornerRadius(8f, 8f))
                }
            }
        }
    }
}

/** Column chart for a time series (reports or SOS per day / month). */
@Composable
internal fun CaColumnChart(points: List<Pair<String, Int>>, color: Color, modifier: Modifier = Modifier) {
    val max = (points.maxOfOrNull { it.second } ?: 0).coerceAtLeast(1)
    Column(modifier) {
        Canvas(Modifier.fillMaxWidth().height(120.dp).semantics { contentDescription = points.joinToString { "${it.first}: ${it.second}" } }) {
            val n = points.size.coerceAtLeast(1)
            val slot = size.width / n
            val bar = (slot * 0.6f).coerceAtLeast(2f)
            drawLine(CcColors.Line, Offset(0f, size.height), Offset(size.width, size.height), strokeWidth = 2f)
            points.forEachIndexed { i, (_, v) ->
                val h = size.height * v / max
                drawRoundRect(color, topLeft = Offset(i * slot + (slot - bar) / 2, size.height - h), size = Size(bar, h), cornerRadius = CornerRadius(6f, 6f))
            }
        }
        if (points.isNotEmpty()) {
            Row(Modifier.fillMaxWidth().padding(top = 4.dp)) {
                Text(points.first().first, style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint, modifier = Modifier.weight(1f))
                if (points.size > 1) Text(points.last().first, style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint)
            }
        }
    }
}

/** Progress bar with a caption ("6 of 8 checkpoints"). */
@Composable
internal fun CaProgress(done: Int, total: Int, color: Color = CcColors.Emerald) {
    val f = if (total > 0) (done.toFloat() / total).coerceIn(0f, 1f) else 0f
    Box(Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(8.dp)).background(CcColors.CreamDeep)) {
        Box(Modifier.fillMaxWidth(f).height(8.dp).clip(RoundedCornerShape(8.dp)).background(color))
    }
}
