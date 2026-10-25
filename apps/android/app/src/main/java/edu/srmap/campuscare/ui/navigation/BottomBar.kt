package edu.srmap.campuscare.ui.navigation

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
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
import androidx.compose.material.icons.rounded.Assignment
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Dashboard
import androidx.compose.material.icons.rounded.Forum
import androidx.compose.material.icons.rounded.Gavel
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.Map
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.SupportAgent
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.rememberPulse
import edu.srmap.campuscare.ui.theme.CcColors

private data class Tab(val route: String, val label: String, val icon: ImageVector)

private fun tabsFor(role: String): List<Tab> = when (role) {
    "student" -> listOf(Tab(Routes.Home, "Home", Icons.Rounded.Home), Tab(Routes.Support, "Support", Icons.Rounded.SupportAgent), Tab(Routes.Reports, "Reports", Icons.Rounded.Assignment), Tab(Routes.Profile, "Profile", Icons.Rounded.Person))
    "counsellor" -> listOf(Tab(Routes.CounsellorHome, "Today", Icons.Rounded.Home), Tab(Routes.CounsellorAppointments, "Sessions", Icons.Rounded.CalendarMonth), Tab(Routes.Inbox, "Messages", Icons.Rounded.Forum), Tab(Routes.Profile, "Profile", Icons.Rounded.Person))
    "committee_member" -> listOf(Tab(Routes.CommitteeCases, "Cases", Icons.Rounded.Gavel), Tab(Routes.Inbox, "Support", Icons.Rounded.Forum), Tab(Routes.Notifications, "Alerts", Icons.Rounded.Notifications), Tab(Routes.Profile, "Profile", Icons.Rounded.Person))
    "security_officer" -> listOf(Tab(Routes.ResponderAlerts, "SOS", Icons.Rounded.Warning), Tab(Routes.ResponderLocations, "Live map", Icons.Rounded.Map), Tab(Routes.ResponderCases, "Cases", Icons.Rounded.Gavel), Tab(Routes.Profile, "Profile", Icons.Rounded.Person))
    "admin" -> listOf(Tab(Routes.AdminHome, "Dashboard", Icons.Rounded.Dashboard), Tab(Routes.AdminTriage, "Triage", Icons.Rounded.Gavel), Tab(Routes.Moderation, "Moderate", Icons.Rounded.Shield), Tab(Routes.Profile, "Profile", Icons.Rounded.Person))
    "moderator" -> listOf(Tab(Routes.Moderation, "Moderate", Icons.Rounded.Shield), Tab(Routes.Notifications, "Alerts", Icons.Rounded.Notifications), Tab(Routes.Profile, "Profile", Icons.Rounded.Person))
    else -> emptyList()
}

/** Bottom navigation. Students get a raised red SOS button in the centre, always one tap away. */
@Composable
fun RoleBottomBar(role: String, current: String, onSelect: (String) -> Unit) {
    val tabs = tabsFor(role)
    val nav = LocalNav.current
    Box(Modifier.fillMaxWidth()) {
        Row(
            Modifier
                .fillMaxWidth()
                .shadow(16.dp, RoundedCornerShape(topStart = 26.dp, topEnd = 26.dp), ambientColor = CcColors.Forest.copy(alpha = 0.15f))
                .clip(RoundedCornerShape(topStart = 26.dp, topEnd = 26.dp))
                .background(Color.White)
                .navigationBarsPadding()
                .padding(horizontal = 8.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.SpaceAround,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val student = role == "student"
            tabs.forEachIndexed { i, tab ->
                if (student && i == 2) Spacer(Modifier.width(72.dp))
                TabItem(tab, selected = current == tab.route, onClick = { onSelect(tab.route) }, modifier = Modifier.weight(1f))
            }
        }
        if (role == "student") {
            val pulse = rememberPulse(0.96f, 1.06f, 1200)
            Box(
                Modifier
                    .align(Alignment.TopCenter)
                    .offset(y = (-22).dp)
                    .scale(pulse)
                    .size(68.dp)
                    .shadow(12.dp, CircleShape, spotColor = CcColors.Sos)
                    .clip(CircleShape)
                    .background(CcColors.Sos)
                    .border(4.dp, Color.White, CircleShape)
                    .clickable(role = Role.Button) { nav.navigate(Routes.Sos) { launchSingleTop = true } }
                    .semantics { contentDescription = "Emergency SOS" },
                contentAlignment = Alignment.Center,
            ) {
                Text("SOS", color = Color.White, fontWeight = FontWeight.ExtraBold, style = MaterialTheme.typography.titleMedium)
            }
        }
    }
}

@Composable
private fun TabItem(tab: Tab, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val color by animateColorAsState(if (selected) CcColors.Forest else CcColors.InkFaint, label = "tab")
    val pill by animateDpAsState(if (selected) 44.dp else 0.dp, label = "pill")
    Column(
        modifier
            .clip(RoundedCornerShape(16.dp))
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, role = Role.Tab, onClick = onClick)
            .padding(vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(contentAlignment = Alignment.Center) {
            Box(Modifier.size(width = pill, height = 30.dp).clip(RoundedCornerShape(15.dp)).background(CcColors.Mint))
            Icon(tab.icon, contentDescription = null, tint = color, modifier = Modifier.size(24.dp))
        }
        Spacer(Modifier.height(2.dp))
        Text(tab.label, style = MaterialTheme.typography.labelSmall, color = color, fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium)
    }
}
