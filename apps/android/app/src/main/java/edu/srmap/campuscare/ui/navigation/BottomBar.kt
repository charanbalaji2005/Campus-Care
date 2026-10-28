package edu.srmap.campuscare.ui.navigation

import android.view.HapticFeedbackConstants
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Chat
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.Forum
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.NotificationsActive
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import edu.srmap.campuscare.AppAudience
import edu.srmap.campuscare.ui.components.CountBadge
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.pressScale
import edu.srmap.campuscare.ui.components.rememberAttentionRing
import edu.srmap.campuscare.ui.components.rememberTapGuard
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.ui.theme.LocalReducedMotion

private data class Tab(val route: String, val label: String, val icon: ImageVector, val badgeCount: Int = 0)

private fun incidentRouteFor(role: String): String = when (role) {
    "committee_member" -> Routes.CommitteeCases
    "admin" -> Routes.AdminTriage
    else -> Routes.ResponderCases
}

private fun tabsFor(role: String): List<Tab> {
    val isCollege = AppAudience.current == AppAudience.College || role != "student"
    return if (!isCollege) {
        listOf(
            Tab(Routes.Home, "Home", Icons.Rounded.Home),
            Tab(Routes.Counselling, "Counsellors", Icons.Rounded.Groups),
            Tab(Routes.Chats, "Messages", Icons.Rounded.Forum),
            Tab(Routes.Profile, "Profile", Icons.Rounded.Person),
        )
    } else {
        listOf(
            Tab(Routes.Home, "Home", Icons.Rounded.Home),
            Tab(incidentRouteFor(role), "Incidents", Icons.Rounded.Description),
            Tab(Routes.Chats, "Messages", Icons.Rounded.Forum),
            Tab(Routes.Profile, "Profile", Icons.Rounded.Person),
        )
    }
}

private fun sosRouteFor(role: String): String = when (role) {
    "student" -> Routes.Sos
    "security_officer" -> Routes.ResponderAlerts
    "admin" -> Routes.AdminAlerts
    else -> Routes.ResponderAlerts
}

/**
 * Bottom navigation bar with 5 positions:
 * Position 1: Home
 * Position 2: Counsellors (Student) / Incidents (College)
 * Position 3: Raised circular red SOS button with glow halo
 * Position 4: Messages (with badge)
 * Position 5: Profile
 */
@Composable
fun RoleBottomBar(role: String, current: String, onSelect: (String) -> Unit) {
    val tabs = tabsFor(role)
    val nav = LocalNav.current

    Box(
        Modifier
            .fillMaxWidth()
            .navigationBarsPadding(),
        contentAlignment = Alignment.BottomCenter,
    ) {
        // Navigation bar container
        Row(
            Modifier
                .fillMaxWidth()
                .shadow(
                    elevation = 16.dp,
                    shape = RoundedCornerShape(topStart = 26.dp, topEnd = 26.dp),
                    ambientColor = CcColors.Forest.copy(alpha = 0.12f),
                    spotColor = CcColors.Forest.copy(alpha = 0.18f),
                )
                .clip(RoundedCornerShape(topStart = 26.dp, topEnd = 26.dp))
                .background(Color.White)
                .padding(horizontal = 6.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.SpaceAround,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Tab 1 (Home)
            if (tabs.isNotEmpty()) {
                TabItem(
                    tab = tabs[0],
                    selected = current == tabs[0].route || (tabs[0].route == Routes.Home && current in setOf(Routes.CounsellorHome, Routes.AdminHome)),
                    onClick = { onSelect(tabs[0].route) },
                    modifier = Modifier.weight(1f),
                )
            }

            // Tab 2 (Counsellors / Incidents)
            if (tabs.size > 1) {
                TabItem(
                    tab = tabs[1],
                    selected = current == tabs[1].route || current in setOf(Routes.FindCounsellor, Routes.BookSession, Routes.ResponderCases, Routes.CommitteeCases, Routes.AdminTriage),
                    onClick = { onSelect(tabs[1].route) },
                    modifier = Modifier.weight(1f),
                )
            }

            // Center slot reserved for the raised SOS button (width: 76.dp)
            Spacer(Modifier.width(76.dp))

            // Tab 4 (Messages)
            if (tabs.size > 2) {
                TabItem(
                    tab = tabs[2],
                    selected = current == tabs[2].route || current.startsWith("chat"),
                    onClick = { onSelect(tabs[2].route) },
                    modifier = Modifier.weight(1f),
                )
            }

            // Tab 5 (Profile)
            if (tabs.size > 3) {
                TabItem(
                    tab = tabs[3],
                    selected = current == tabs[3].route,
                    onClick = { onSelect(tabs[3].route) },
                    modifier = Modifier.weight(1f),
                )
            }
        }

        // Center raised SOS button (prominent circular red button elevated with halo)
        SosCenterButton(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .offset(y = (-20).dp),
        ) {
            val target = sosRouteFor(role)
            nav.navigate(target) { launchSingleTop = true }
        }
    }
}

/**
 * Prominent circular red SOS button in the exact center position.
 * Features:
 * - Elevated above the navigation bar
 * - Soft pulsing / glowing red halo ring
 * - White emergency alarm/siren icon + "SOS" bold text
 * - Crisp white border and deep shadow
 * - Haptic feedback and tap guard
 */
@Composable
private fun SosCenterButton(modifier: Modifier = Modifier, onClick: () -> Unit) {
    val view = LocalView.current
    val guard = rememberTapGuard()
    val interaction = remember { MutableInteractionSource() }
    val ring = rememberAttentionRing()

    Box(modifier.size(76.dp), contentAlignment = Alignment.Center) {
        // Soft ambient glowing red halo ring
        Box(
            Modifier
                .size(76.dp)
                .graphicsLayer {
                    val s = 1f + ring * 0.25f
                    scaleX = s
                    scaleY = s
                    alpha = 0.25f + (1f - ring) * 0.25f
                }
                .clip(CircleShape)
                .background(Color(0x44EF4444)),
        )

        // Main raised red SOS button
        Box(
            Modifier
                .size(62.dp)
                .pressScale(interaction, pressed = 0.90f)
                .shadow(elevation = 12.dp, shape = CircleShape, spotColor = Color(0xFFDC2626), ambientColor = Color(0x66DC2626))
                .clip(CircleShape)
                .background(Color(0xFFE53935))
                .border(3.5.dp, Color.White, CircleShape)
                .clickable(
                    interactionSource = interaction,
                    indication = ripple(color = Color.White),
                    role = Role.Button,
                ) {
                    guard.run {
                        view.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                        onClick()
                    }
                }
                .semantics { contentDescription = "Emergency SOS Button" },
            contentAlignment = Alignment.Center,
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Icon(
                    imageVector = Icons.Rounded.NotificationsActive,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(22.dp),
                )
                Spacer(Modifier.height(1.dp))
                Text(
                    text = "SOS",
                    color = Color.White,
                    fontWeight = FontWeight.Black,
                    fontSize = 11.sp,
                    lineHeight = 12.sp,
                )
            }
        }
    }
}

@Composable
private fun TabItem(tab: Tab, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val reduced = LocalReducedMotion.current
    val color by animateColorAsState(if (selected) CcColors.Forest else CcColors.InkFaint, label = "tab")
    val pill by animateDpAsState(
        if (selected) 44.dp else 0.dp,
        if (reduced) snap() else spring(dampingRatio = Spring.DampingRatioLowBouncy, stiffness = Spring.StiffnessMediumLow),
        label = "pill",
    )
    val iconScale by animateFloatAsState(
        if (selected && !reduced) 1.12f else 1f,
        spring(dampingRatio = Spring.DampingRatioMediumBouncy),
        label = "tabIcon",
    )
    val interaction = remember { MutableInteractionSource() }

    Column(
        modifier
            .clip(RoundedCornerShape(16.dp))
            .pressScale(interaction, pressed = 0.92f)
            .clickable(interactionSource = interaction, indication = null, role = Role.Tab, onClick = onClick)
            .semantics { this.selected = selected }
            .padding(vertical = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(contentAlignment = Alignment.Center) {
            Box(
                Modifier
                    .size(width = pill, height = 28.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(CcColors.Mint),
            )
            Icon(
                tab.icon,
                contentDescription = null,
                tint = color,
                modifier = Modifier
                    .size(22.dp)
                    .scale(iconScale),
            )
            if (tab.badgeCount > 0) {
                CountBadge(
                    tab.badgeCount,
                    Modifier
                        .align(Alignment.TopEnd)
                        .offset(x = 10.dp, y = (-4).dp),
                )
            }
        }
        Spacer(Modifier.height(2.dp))
        Text(
            tab.label,
            style = MaterialTheme.typography.labelSmall,
            color = color,
            fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
            fontSize = 11.sp,
            maxLines = 1,
        )
    }
}