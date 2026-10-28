package edu.srmap.campuscare.ui.components

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.ui.theme.CcColors

/** Colour pairs (foreground, background) for chips, tiles and banners. */
enum class Tone(val fg: Color, val bg: Color) {
    Brand(CcColors.Forest, CcColors.Mint),
    Teal(CcColors.Teal, CcColors.TealSoft),
    Amber(CcColors.Amber, CcColors.AmberSoft),
    Danger(CcColors.Sos, CcColors.SosSoft),
    Violet(CcColors.Violet, CcColors.VioletSoft),
    Sky(CcColors.Sky, CcColors.SkySoft),
    Rose(CcColors.Rose, CcColors.RoseSoft),
    Neutral(CcColors.InkSoft, CcColors.CreamDeep),
}

/** White elevated card with a gentle press animation when clickable. */
@Composable
fun CcCard(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    padding: Dp = 16.dp,
    color: Color = Color.White,
    border: Boolean = true,
    content: @Composable ColumnScope.() -> Unit,
) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed && onClick != null) 0.98f else 1f, spring(stiffness = 700f), label = "card")
    val shape = RoundedCornerShape(22.dp)
    Surface(
        modifier = modifier
            .scale(scale)
            .shadow(elevation = 2.dp, shape = shape, ambientColor = CcColors.Forest.copy(alpha = 0.08f), spotColor = CcColors.Forest.copy(alpha = 0.10f)),
        shape = shape,
        color = color,
        border = if (border) BorderStroke(1.dp, CcColors.Line.copy(alpha = 0.7f)) else null,
    ) {
        Column(
            Modifier
                .then(if (onClick != null) Modifier.clickable(interactionSource = interaction, indication = ripple(), role = Role.Button, onClick = onClick) else Modifier)
                .padding(padding)
                .animateContentSize(),
            content = content,
        )
    }
}

@Composable
fun SectionHeader(title: String, modifier: Modifier = Modifier, action: String? = null, onAction: (() -> Unit)? = null) {
    Row(modifier.fillMaxWidth().padding(top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.titleLarge, color = CcColors.Ink, modifier = Modifier.weight(1f))
        if (action != null && onAction != null) {
            Row(
                Modifier.clip(RoundedCornerShape(10.dp)).clickable(onClick = onAction).padding(horizontal = 8.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(action, style = MaterialTheme.typography.labelLarge, color = CcColors.Emerald)
                Icon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, contentDescription = null, tint = CcColors.Emerald, modifier = Modifier.size(18.dp))
            }
        }
    }
}

@Composable
fun StatusChip(text: String, tone: Tone, modifier: Modifier = Modifier, dot: Boolean = false) {
    Row(
        modifier.clip(RoundedCornerShape(50)).background(tone.bg).padding(horizontal = 10.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (dot) {
            Box(Modifier.size(6.dp).clip(CircleShape).background(tone.fg))
            Spacer(Modifier.width(6.dp))
        }
        Text(text, style = MaterialTheme.typography.labelMedium, color = tone.fg, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}

/** Rounded icon badge used in tiles and rows. */
@Composable
fun IconBadge(icon: ImageVector, tone: Tone, size: Dp = 44.dp, iconSize: Dp = 22.dp, modifier: Modifier = Modifier) {
    Box(modifier.size(size).clip(RoundedCornerShape(size / 3)).background(tone.bg), contentAlignment = Alignment.Center) {
        Icon(icon, contentDescription = null, tint = tone.fg, modifier = Modifier.size(iconSize))
    }
}

/** Dashboard tile (icon + label) as in the home-screen mockup. */
@Composable
fun ActionTile(icon: ImageVector, label: String, tone: Tone, onClick: () -> Unit, modifier: Modifier = Modifier, badge: Int = 0) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.94f else 1f, spring(stiffness = 600f), label = "tile")
    Column(
        modifier
            .scale(scale)
            .clip(RoundedCornerShape(20.dp))
            .background(tone.bg.copy(alpha = 0.55f))
            .border(1.dp, tone.bg, RoundedCornerShape(20.dp))
            .clickable(interactionSource = interaction, indication = ripple(), role = Role.Button, onClick = onClick)
            .padding(vertical = 14.dp, horizontal = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box {
            IconBadge(icon, tone, size = 46.dp, iconSize = 24.dp, modifier = Modifier)
            if (badge > 0) {
                Box(
                    Modifier.align(Alignment.TopEnd).size(18.dp).clip(CircleShape).background(CcColors.Sos),
                    contentAlignment = Alignment.Center,
                ) { Text(if (badge > 9) "9+" else "$badge", color = Color.White, style = MaterialTheme.typography.labelSmall) }
            }
        }
        Spacer(Modifier.height(8.dp))
        Text(label, style = MaterialTheme.typography.labelMedium, color = CcColors.Ink, textAlign = TextAlign.Center, maxLines = 2, fontWeight = FontWeight.SemiBold)
    }
}

/** Row with leading icon badge, title/subtitle and chevron — used for menus and lists. */
@Composable
fun ListRow(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    icon: ImageVector? = null,
    tone: Tone = Tone.Brand,
    trailing: (@Composable () -> Unit)? = null,
    chevron: Boolean = true,
    onClick: (() -> Unit)? = null,
) {
    Row(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
            .padding(horizontal = 4.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            IconBadge(icon, tone, size = 40.dp, iconSize = 20.dp)
            Spacer(Modifier.width(12.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
            subtitle?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft, maxLines = 3, overflow = TextOverflow.Ellipsis) }
        }
        trailing?.let {
            Spacer(Modifier.width(8.dp))
            it()
        }
        if (chevron && onClick != null) Icon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, contentDescription = null, tint = CcColors.InkFaint)
    }
}

/** Informational banner (privacy notes, warnings, outage notices). */
@Composable
fun InfoBanner(message: String, modifier: Modifier = Modifier, tone: Tone = Tone.Brand, title: String? = null, icon: ImageVector = Icons.Rounded.Info, action: (@Composable () -> Unit)? = null) {
    Row(
        modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(tone.bg.copy(alpha = 0.7f)).border(1.dp, tone.bg, RoundedCornerShape(18.dp)).padding(14.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(icon, contentDescription = null, tint = tone.fg, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            title?.let { Text(it, style = MaterialTheme.typography.titleSmall, color = tone.fg) }
            Text(message, style = MaterialTheme.typography.bodySmall, color = CcColors.Ink)
            action?.let {
                Spacer(Modifier.height(6.dp))
                it()
            }
        }
    }
}

@Composable
fun Avatar(name: String, modifier: Modifier = Modifier, size: Dp = 44.dp, tone: Tone = Tone.Brand) {
    val initials = name.split(' ').filter { it.isNotBlank() }.take(2).joinToString("") { it.first().uppercase() }.ifBlank { "?" }
    Box(modifier.size(size).clip(CircleShape).background(tone.bg), contentAlignment = Alignment.Center) {
        Text(initials, color = tone.fg, fontWeight = FontWeight.Bold, style = if (size >= 56.dp) MaterialTheme.typography.titleLarge else MaterialTheme.typography.titleSmall)
    }
}

/** Big number + label tile for dashboards. */
@Composable
fun StatTile(label: String, value: String, modifier: Modifier = Modifier, tone: Tone = Tone.Brand, icon: ImageVector? = null) {
    CcCard(modifier) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (icon != null) {
                IconBadge(icon, tone, size = 36.dp, iconSize = 18.dp)
                Spacer(Modifier.width(10.dp))
            }
            Column {
                AnimatedNumber(value, style = MaterialTheme.typography.headlineMedium, color = tone.fg)
                Text(label, style = MaterialTheme.typography.labelMedium, color = CcColors.InkSoft, maxLines = 2)
            }
        }
    }
}

/** Wrapping multi-select chips (e.g. specialisations). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MultiChoiceChips(options: List<Pair<String, String>>, selected: Set<String>, onToggle: (String) -> Unit, modifier: Modifier = Modifier) {
    FlowRow(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { (value, label) ->
            val active = value in selected
            Box(
                Modifier
                    .clip(RoundedCornerShape(50))
                    .background(if (active) CcColors.Forest else Color.White)
                    .border(1.dp, if (active) CcColors.Forest else CcColors.Line, RoundedCornerShape(50))
                    .clickable(role = Role.Checkbox) { onToggle(value) }
                    .padding(horizontal = 14.dp, vertical = 8.dp),
            ) {
                Text(label, color = if (active) Color.White else CcColors.Ink, style = MaterialTheme.typography.labelLarge)
            }
        }
    }
}

/** Read-only wrapping tags (languages, permissions, zones). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TagCloud(tags: List<String>, modifier: Modifier = Modifier, tone: Tone = Tone.Neutral) {
    FlowRow(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        tags.forEach { StatusChip(it, tone) }
    }
}

/** Horizontal choice chips (filters, tabs). */
@Composable
fun ChoiceChips(options: List<Pair<String, String>>, selected: String, onSelect: (String) -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        options.forEach { (value, label) ->
            val active = value == selected
            Box(
                Modifier
                    .clip(RoundedCornerShape(50))
                    .background(if (active) CcColors.Forest else Color.White)
                    .border(1.dp, if (active) CcColors.Forest else CcColors.Line, RoundedCornerShape(50))
                    .clickable(role = Role.Tab) { onSelect(value) }
                    .padding(horizontal = 16.dp, vertical = 9.dp)
                    .widthIn(min = 40.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(label, color = if (active) Color.White else CcColors.Ink, style = MaterialTheme.typography.labelLarge, maxLines = 1)
            }
        }
    }
}

@Composable
fun KeyValue(label: String, value: String?, modifier: Modifier = Modifier) {
    if (value.isNullOrBlank()) return
    Column(modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = CcColors.InkSoft)
        Text(value, style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink)
    }
}

@Composable
fun Divider(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(1.dp).background(CcColors.Line))
}

@Composable
fun VerticalGap(height: Dp = 12.dp) = Spacer(Modifier.height(height))
