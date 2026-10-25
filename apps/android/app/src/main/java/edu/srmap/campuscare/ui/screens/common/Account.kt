package edu.srmap.campuscare.ui.screens.common

import android.content.Intent
import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.HelpOutline
import androidx.compose.material.icons.automirrored.rounded.Logout
import androidx.compose.material.icons.rounded.AccessibilityNew
import androidx.compose.material.icons.rounded.Apartment
import androidx.compose.material.icons.rounded.Badge
import androidx.compose.material.icons.rounded.Campaign
import androidx.compose.material.icons.rounded.Contacts
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.DevicesOther
import androidx.compose.material.icons.rounded.DoneAll
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.HealthAndSafety
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.Key
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.MyLocation
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.NotificationsActive
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.Phone
import androidx.compose.material.icons.rounded.PhonelinkLock
import androidx.compose.material.icons.rounded.PrivacyTip
import androidx.compose.material.icons.rounded.School
import androidx.compose.material.icons.rounded.Security
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.Smartphone
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import edu.srmap.campuscare.BuildConfig
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.AppNotification
import edu.srmap.campuscare.data.ChannelPrefs
import edu.srmap.campuscare.data.MfaSetup
import edu.srmap.campuscare.services.LocationShareService
import edu.srmap.campuscare.services.ResponderDutyService
import edu.srmap.campuscare.ui.components.Avatar
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.Catalog
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.CcSelect
import edu.srmap.campuscare.ui.components.CcTextField
import edu.srmap.campuscare.ui.components.ChoiceChips
import edu.srmap.campuscare.ui.components.ConfirmDialog
import edu.srmap.campuscare.ui.components.Divider
import edu.srmap.campuscare.ui.components.EmptyState
import edu.srmap.campuscare.ui.components.IconBadge
import edu.srmap.campuscare.ui.components.InfoBanner
import edu.srmap.campuscare.ui.components.InputDialog
import edu.srmap.campuscare.ui.components.KeyValue
import edu.srmap.campuscare.ui.components.ListRow
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.PasswordStrength
import edu.srmap.campuscare.ui.components.SectionHeader
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.SwitchRow
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.enterStagger
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.navigation.rememberSignOut
import edu.srmap.campuscare.ui.screens.auth.passwordError
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.Fmt
import java.io.File
import kotlinx.coroutines.launch

// ------------------------------------------------------------------ notifications

@Composable
fun NotificationsScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val user by app.session.user.collectAsState()
    val page = rememberLoad { app.api.content.notifications() }
    var filter by rememberSaveable { mutableStateOf("all") }
    LaunchedEffect(Unit) { app.realtime.events.collect { e -> if (e.name == "notification") page.reload() } }

    CcScreen(
        title = "Notifications",
        subtitle = page.data?.let { if (it.unread > 0) "${it.unread} unread" else "You're all caught up" },
        refreshing = page.refreshing, onRefresh = { page.reload() },
        actions = {
            TextButton(onClick = {
                scope.launch {
                    try {
                        app.api.content.markAllRead(); page.reload()
                    } catch (e: ApiException) {
                        snack.error(e)
                    }
                }
            }) { Text("Mark all read", color = CcColors.Emerald) }
        },
    ) {
        ChoiceChips(listOf("all" to "All", "unread" to "Unread", "critical" to "Urgent"), filter, { filter = it })
        LoadContent(page) { p ->
            val items = p.items.filter {
                when (filter) {
                    "unread" -> it.readAt == null
                    "critical" -> it.priority == "critical" || it.priority == "high"
                    else -> true
                }
            }
            if (items.isEmpty()) EmptyState("No notifications", message = "Updates about your reports, sessions and campus safety appear here.", icon = Icons.Rounded.Notifications)
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items.forEachIndexed { i, n ->
                    NotificationRow(n, Modifier.enterStagger(i)) {
                        scope.launch {
                            if (n.readAt == null) runCatching { app.api.content.markRead(n.id) }
                            val target = n.link?.let { Routes.fromLink(it, user?.role ?: "student") }
                            if (target != null && target != Routes.Notifications) nav.navigate(target) else page.reload()
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun NotificationRow(n: AppNotification, modifier: Modifier, onClick: () -> Unit) {
    val tone = when (n.priority) { "critical" -> Tone.Danger; "high" -> Tone.Amber; "low" -> Tone.Neutral; else -> Tone.Brand }
    CcCard(modifier, onClick = onClick, color = if (n.readAt == null) Color.White else CcColors.Cream, border = n.readAt == null) {
        Row(verticalAlignment = Alignment.Top) {
            IconBadge(
                when (n.kind) { "sos" -> Icons.Rounded.Warning; "campus_alert" -> Icons.Rounded.Campaign; "case" -> Icons.Rounded.Shield; else -> Icons.Rounded.NotificationsActive },
                tone, size = 40.dp, iconSize = 20.dp,
            )
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(n.title, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink, fontWeight = if (n.readAt == null) FontWeight.Bold else FontWeight.Normal, modifier = Modifier.weight(1f))
                    if (n.readAt == null) Box(Modifier.size(8.dp).clip(CircleShape).background(CcColors.Emerald))
                }
                Text(n.body, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft, maxLines = 3)
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
                    Text(Fmt.ago(n.createdAt), style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint)
                    if (n.priority == "critical") {
                        Spacer(Modifier.width(6.dp))
                        StatusChip("Urgent", Tone.Danger)
                    }
                }
            }
        }
    }
}

// ------------------------------------------------------------------ profile & settings

@Composable
fun ProfileScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val context = LocalContext.current
    val user by app.session.user.collectAsState()
    val a11y by app.a11y.collectAsState()
    val signOut = rememberSignOut()
    var confirmSignOut by remember { mutableStateOf(false) }
    var onDuty by remember { mutableStateOf(ResponderDutyService.isOnDuty(context)) }
    val u = user ?: return

    CcScreen(title = "Profile & Settings", subtitle = "Manage your account") {
        CcCard(Modifier.enterStagger(0)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Avatar(u.fullName, size = 64.dp)
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(u.fullName, style = MaterialTheme.typography.titleLarge, color = CcColors.Ink)
                    Text(u.email, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 6.dp)) {
                        StatusChip(Catalog.roleLabel(u.role), Tone.Brand)
                        if (u.mfaEnabled) StatusChip("2-step on", Tone.Teal, dot = true)
                    }
                }
            }
            if (u.isStudent) {
                Divider(Modifier.padding(vertical = 10.dp))
                Row {
                    KeyValue("Student ID", u.studentId ?: "—", Modifier.weight(1f))
                    KeyValue("Year", u.academicYear?.let { "Year $it" } ?: "—", Modifier.weight(1f))
                }
                KeyValue("Department", u.department)
            }
        }

        if (u.role == "security_officer") {
            CcCard(color = if (onDuty) CcColors.Mint50 else Color.White) {
                SwitchRow(
                    "On duty", onDuty,
                    { on ->
                        onDuty = on
                        if (on) ResponderDutyService.start(context) else ResponderDutyService.stop(context)
                    },
                    description = "Keeps SOS alerts arriving instantly with a persistent notification while you're on shift.",
                )
            }
        }

        SectionHeader("Account")
        CcCard(padding = 8.dp) {
            ListRow("Edit profile", icon = Icons.Rounded.Edit, onClick = { nav.navigate(Routes.EditProfile) })
            Divider()
            ListRow("Security", subtitle = "Password, 2-step verification, devices", icon = Icons.Rounded.Security, tone = Tone.Teal, onClick = { nav.navigate(Routes.Security) })
            Divider()
            ListRow("Notifications", subtitle = "Choose what reaches you and how", icon = Icons.Rounded.Notifications, tone = Tone.Amber, onClick = { nav.navigate(Routes.NotificationPrefs) })
            Divider()
            ListRow("Privacy & data", subtitle = "Who can see what, downloads, deletion", icon = Icons.Rounded.PrivacyTip, tone = Tone.Violet, onClick = { nav.navigate(Routes.Privacy) })
        }
        if (u.isStudent) {
            SectionHeader("Safety")
            CcCard(padding = 8.dp) {
                ListRow("Trusted contacts", icon = Icons.Rounded.Contacts, tone = Tone.Rose, onClick = { nav.navigate(Routes.Trusted) })
                Divider()
                ListRow("Digital safety card", subtitle = "Medical info shared only during your SOS", icon = Icons.Rounded.HealthAndSafety, tone = Tone.Danger, onClick = { nav.navigate(Routes.SafetyCard) })
                Divider()
                ListRow("Emergency contacts", icon = Icons.Rounded.Phone, tone = Tone.Sky, onClick = { nav.navigate(Routes.Contacts) })
            }
        }
        SectionHeader("Accessibility")
        CcCard {
            SwitchRow("Reduce motion", a11y.reduceMotion, { app.setA11y(a11y.copy(reduceMotion = it)) }, description = "Turns off decorative animations and pulsing.")
            Divider()
            SwitchRow("Larger text", a11y.largeText, { app.setA11y(a11y.copy(largeText = it)) }, description = "Increases text size across the app.")
            Divider()
            SwitchRow("Vibration feedback", a11y.haptics, { app.setA11y(a11y.copy(haptics = it)) }, description = "Vibrates during the SOS countdown.")
        }
        CcCard(padding = 8.dp) {
            ListRow("Help & FAQ", icon = Icons.AutoMirrored.Rounded.HelpOutline, tone = Tone.Sky, onClick = { nav.navigate(Routes.Help) })
            Divider()
            ListRow("Sign out", icon = Icons.AutoMirrored.Rounded.Logout, tone = Tone.Danger, chevron = false, onClick = { confirmSignOut = true })
        }
        Text(
            "CampusCare ${BuildConfig.VERSION_NAME} · ${app.config.settings.universityName}",
            style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint, modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
        )
    }
    if (confirmSignOut) {
        ConfirmDialog("Sign out?", "You'll need your university email and password to sign in again. Emergency calling works without signing in.", confirmLabel = "Sign out",
            onDismiss = { confirmSignOut = false },
            onConfirm = {
                confirmSignOut = false
                ResponderDutyService.stop(context)
                LocationShareService.stop(context)
                signOut()
            },
        )
    }
}

@Composable
fun EditProfileScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val u = app.session.user.value ?: return
    var name by rememberSaveable { mutableStateOf(u.fullName) }
    var phone by rememberSaveable { mutableStateOf(u.phone.orEmpty()) }
    var department by rememberSaveable { mutableStateOf(u.department) }
    var year by rememberSaveable { mutableStateOf(u.academicYear?.toString()) }
    var hostel by rememberSaveable { mutableStateOf(u.hostel.orEmpty()) }
    var errors by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var busy by remember { mutableStateOf(false) }
    CcScreen(title = "Edit profile", onBack = { nav.popBackStack() }) {
        InfoBanner("Your university email (${u.email}) can't be changed here.", icon = Icons.Rounded.Lock, tone = Tone.Neutral)
        CcTextField(name, { name = it }, label = "Full name", leadingIcon = Icons.Rounded.Person, error = errors["fullName"], maxLength = 120)
        CcTextField(phone, { phone = it }, label = "Phone", leadingIcon = Icons.Rounded.Phone, keyboardType = KeyboardType.Phone, error = errors["phone"], hint = "Shared with responders only during your SOS.")
        if (u.isStudent) {
            CcSelect("Department", Catalog.departments.map { it to it }, department, { department = it }, leadingIcon = Icons.Rounded.School)
            CcSelect("Academic year", (1..6).map { "$it" to "Year $it" }, year, { year = it }, leadingIcon = Icons.Rounded.Badge)
            CcTextField(hostel, { hostel = it }, label = "Hostel (optional)", leadingIcon = Icons.Rounded.Apartment, maxLength = 80, hint = "Used to send hostel-specific safety alerts.")
        }
        CcButton("Save changes", {
            errors = buildMap {
                if (name.trim().length < 2) put("fullName", "Enter your full name")
                if (phone.isNotBlank() && !Regex("^\\+?[0-9 ]{7,20}$").matches(phone.trim())) put("phone", "Enter a valid phone number")
            }
            if (errors.isNotEmpty()) return@CcButton
            scope.launch {
                busy = true
                try {
                    val body = buildMap<String, Any?> {
                        put("fullName", name.trim()); put("phone", phone.trim())
                        if (u.isStudent) {
                            department?.let { put("department", it) }
                            year?.toIntOrNull()?.let { put("academicYear", it) }
                            put("hostel", hostel.trim())
                        }
                    }
                    val updated = app.api.auth.updateProfile(body)
                    app.session.updateUser(updated.user)
                    snack.show("Profile updated.")
                    nav.popBackStack()
                } catch (e: ApiException) {
                    if (e.fields.isNotEmpty()) errors = e.fields
                    snack.error(e)
                } finally {
                    busy = false
                }
            }
        }, Modifier.fillMaxWidth(), loading = busy)
    }
}

// ------------------------------------------------------------------ privacy dashboard

@Composable
fun PrivacyScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val dash = rememberLoad { app.api.me.privacy() }
    var exporting by remember { mutableStateOf(false) }
    var deleteOpen by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }

    CcScreen(title = "Privacy & data", subtitle = "See and control what CampusCare holds", onBack = { nav.popBackStack() }, refreshing = dash.refreshing, onRefresh = { dash.reload() }) {
        LoadContent(dash) { d ->
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                SectionHeader("Right now")
                CcCard {
                    if (d.locationSharing.isEmpty() && d.activeSafeWalk == null) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            IconBadge(Icons.Rounded.MyLocation, Tone.Brand, size = 36.dp, iconSize = 18.dp)
                            Spacer(Modifier.width(10.dp))
                            Text("You're not sharing your location with anyone.", style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink)
                        }
                    }
                    d.locationSharing.forEach { s ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text("Live location → ${if (s.audience == "security") "Campus Security" else "trusted contacts"}", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                                Text("Until ${Fmt.time(s.expiresAt)}", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                            }
                            CcButton("Stop", {
                                scope.launch {
                                    try {
                                        app.api.safety.stopShare(s.id); LocationShareService.stop(context); dash.reload()
                                    } catch (e: ApiException) {
                                        snack.error(e)
                                    }
                                }
                            }, kind = ButtonKind.Outline)
                        }
                    }
                    d.activeSafeWalk?.let { w ->
                        ListRow("Safe Walk to ${w.destination}", subtitle = "Expected ${Fmt.time(w.expectedArrivalAt)}", onClick = { nav.navigate(Routes.SafeWalk) })
                    }
                }

                SectionHeader("Visibility")
                CcCard {
                    var showName by remember(d) { mutableStateOf(d.communityNameVisible) }
                    var allowEmail by remember { mutableStateOf(app.session.user.value?.privacy?.allowEmailNotifications ?: true) }
                    SwitchRow("Show my name in community channels", showName, { on ->
                        showName = on
                        scope.launch {
                            runCatching { app.api.auth.updatePrivacy(on, null) }.onSuccess { app.session.updateUser(it.user) }.onFailure { showName = !on; snack.show("Couldn't update. Try again.") }
                        }
                    }, description = "When off, you appear as \"Student\".")
                    Divider()
                    SwitchRow("Email notifications", allowEmail, { on ->
                        allowEmail = on
                        scope.launch {
                            runCatching { app.api.auth.updatePrivacy(null, on) }.onSuccess { app.session.updateUser(it.user) }.onFailure { allowEmail = !on; snack.show("Couldn't update. Try again.") }
                        }
                    }, description = "Critical safety emails are always sent.")
                    Divider()
                    KeyValue("Safety card", if (d.safetyCard.sharedWithResponders) "Shared with responders during your SOS" else "Not shared")
                    KeyValue("Google account", if (d.linkedAccounts.google) "Linked" else "Not linked")
                    KeyValue("Trusted contacts", if (d.trustedContacts.isEmpty()) "None" else d.trustedContacts.joinToString { "${it.name} (${it.status}${if (it.canSeeLocation) ", sees location in alerts" else ""})" })
                }

                SectionHeader("Who accessed my information")
                CcCard {
                    if (d.accessHistory.isEmpty()) Text("No staff access recorded yet.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                    d.accessHistory.take(20).forEachIndexed { i, a ->
                        if (i > 0) Divider()
                        Row(Modifier.padding(vertical = 6.dp)) {
                            IconBadge(Icons.Rounded.History, Tone.Neutral, size = 32.dp, iconSize = 16.dp)
                            Spacer(Modifier.width(10.dp))
                            Column(Modifier.weight(1f)) {
                                Text(a.description, style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink)
                                Text("${Catalog.roleLabel(a.byRole)} · ${Fmt.dateTime(a.at)}${a.reference?.let { " · $it" } ?: ""}", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
                            }
                        }
                    }
                }

                SectionHeader("Your data")
                CcCard {
                    Text("Download a copy of your account data (profile, reports you filed, appointments, alerts) as a JSON file.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                    CcButton("Download my data", {
                        scope.launch {
                            exporting = true
                            try {
                                val bytes = app.api.me.export()
                                val dir = File(context.cacheDir, "exports").apply { mkdirs() }
                                val file = File(dir, "campuscare-data.json").apply { writeBytes(bytes) }
                                val uri = FileProvider.getUriForFile(context, context.packageName + ".files", file)
                                val send = Intent(Intent.ACTION_SEND).setType("application/json").putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                context.startActivity(Intent.createChooser(send, "Save your CampusCare data").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                            } catch (e: ApiException) {
                                snack.error(e)
                            } finally {
                                exporting = false
                            }
                        }
                    }, Modifier.fillMaxWidth().padding(top = 8.dp), kind = ButtonKind.Soft, loading = exporting, leadingIcon = Icons.Rounded.Download)
                    CcButton("Request account deletion", { deleteOpen = true }, Modifier.fillMaxWidth().padding(top = 8.dp), kind = ButtonKind.Ghost, leadingIcon = Icons.Rounded.Delete)
                    d.dataRequests.forEach { r ->
                        Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text("${Fmt.humanize(r.type)} request · ${Fmt.date(r.createdAt)}", style = MaterialTheme.typography.bodySmall, color = CcColors.Ink, modifier = Modifier.weight(1f))
                            StatusChip(Fmt.humanize(r.status), when (r.status) { "completed" -> Tone.Brand; "rejected" -> Tone.Neutral; else -> Tone.Amber })
                        }
                        r.note?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft) }
                    }
                }
                SectionHeader("Signed-in devices")
                CcCard {
                    d.sessions.forEachIndexed { i, s ->
                        if (i > 0) Divider()
                        ListRow(s.deviceName ?: if (s.client == "android") "Android phone" else "Web browser", subtitle = "Last active ${Fmt.ago(s.lastSeenAt)}", icon = if (s.client == "android") Icons.Rounded.Smartphone else Icons.Rounded.DevicesOther, tone = Tone.Neutral)
                    }
                    TextButton(onClick = { nav.navigate(Routes.Security) }) { Text("Manage devices") }
                }
            }
        }
    }
    if (deleteOpen) {
        InputDialog(
            "Request account deletion?",
            "An administrator reviews deletion requests. Records the university must keep (for example open cases or safety incidents) are retained as required by policy; everything else is removed.",
            label = "Reason (optional)", confirmLabel = "Send request", minLength = 0, destructive = true, loading = busy,
            onDismiss = { deleteOpen = false },
            onConfirm = { reason ->
                scope.launch {
                    busy = true
                    try {
                        app.api.me.requestData("deletion", reason.ifBlank { null }); deleteOpen = false; dash.reload(); snack.show("Deletion request sent.")
                    } catch (e: ApiException) {
                        snack.error(e)
                    } finally {
                        busy = false
                    }
                }
            },
        )
    }
}

// ------------------------------------------------------------------ notification preferences

private val PREF_CATEGORIES = listOf(
    "case_updates" to "Report updates", "chat_messages" to "Messages", "appointments" to "Counselling sessions",
    "announcements" to "Announcements", "training" to "Awareness training", "community" to "Community",
)

@Composable
fun NotificationPrefsScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val prefs = rememberLoad { app.api.me.notificationPrefs() }
    val config by app.config.config.collectAsState()
    CcScreen(title = "Notifications", subtitle = "Choose what reaches you", onBack = { nav.popBackStack() }) {
        InfoBanner("SOS updates, campus emergencies and safety check-ins are always delivered — they can't be turned off.", icon = Icons.Rounded.NotificationsActive, tone = Tone.Danger)
        if (!config.pushAvailable) InfoBanner("Push notifications aren't set up on this server yet. You'll still get in-app and email notifications.", tone = Tone.Neutral)
        LoadContent(prefs) { current ->
            val state = remember(current) { mutableStateMapOf<String, ChannelPrefs>().apply { PREF_CATEGORIES.forEach { (k, _) -> put(k, current[k] ?: ChannelPrefs()) } } }
            var busy by remember { mutableStateOf(false) }
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                PREF_CATEGORIES.forEach { (key, label) ->
                    val p = state[key] ?: ChannelPrefs()
                    CcCard {
                        Text(label, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                        SwitchRow("In the app", p.inApp, { state[key] = p.copy(inApp = it) })
                        SwitchRow("Push to this phone", p.push, { state[key] = p.copy(push = it) }, enabled = config.pushAvailable)
                        SwitchRow("Email", p.email, { state[key] = p.copy(email = it) })
                    }
                }
                CcButton("Save preferences", {
                    scope.launch {
                        busy = true
                        try {
                            prefs.set(app.api.me.saveNotificationPrefs(state.toMap())); snack.show("Preferences saved.")
                        } catch (e: ApiException) {
                            snack.error(e)
                        } finally {
                            busy = false
                        }
                    }
                }, Modifier.fillMaxWidth(), loading = busy)
            }
        }
    }
}

// ------------------------------------------------------------------ security

@Composable
fun SecurityScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val user by app.session.user.collectAsState()
    val sessions = rememberLoad { app.api.auth.sessions() }
    val minLen = app.config.settings.passwordMinLength
    var current by remember { mutableStateOf("") }
    var next by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var pwBusy by remember { mutableStateOf(false) }
    var pwError by remember { mutableStateOf<String?>(null) }
    var setup by remember { mutableStateOf<MfaSetup?>(null) }
    var code by remember { mutableStateOf("") }
    var mfaBusy by remember { mutableStateOf(false) }
    var disableOpen by remember { mutableStateOf(false) }
    var logoutAllOpen by remember { mutableStateOf(false) }
    val signOut = rememberSignOut()
    // The server decides whether this role must use 2-step verification (Super Admin setting).
    val me = rememberLoad { app.api.auth.me() }
    val mfaRequired = me.data?.mfaRequired == true

    CcScreen(title = "Security", subtitle = "Keep your account safe", onBack = { nav.popBackStack() }) {
        if (mfaRequired && user?.mfaEnabled != true) {
            InfoBanner("Your university requires 2-step verification for your role. Set it up below to continue.", tone = Tone.Amber, icon = Icons.Rounded.Warning)
        }
        SectionHeader("2-step verification")
        CcCard {
            if (user?.mfaEnabled == true) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconBadge(Icons.Rounded.PhonelinkLock, Tone.Teal)
                    Spacer(Modifier.width(12.dp))
                    Text("On — you'll enter a code from your authenticator app when you sign in.", style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink, modifier = Modifier.weight(1f))
                }
                if (!mfaRequired) CcButton("Turn off", { disableOpen = true }, Modifier.padding(top = 8.dp), kind = ButtonKind.Ghost)
            } else if (setup == null) {
                Text("Add a second step using an authenticator app (Google Authenticator, Microsoft Authenticator, etc.).", style = MaterialTheme.typography.bodyMedium, color = CcColors.InkSoft)
                CcButton("Set up", {
                    scope.launch {
                        mfaBusy = true
                        try {
                            setup = app.api.auth.mfaSetup()
                        } catch (e: ApiException) {
                            snack.error(e)
                        } finally {
                            mfaBusy = false
                        }
                    }
                }, Modifier.padding(top = 8.dp), loading = mfaBusy, leadingIcon = Icons.Rounded.PhonelinkLock)
            } else {
                val s = setup!!
                Text("1. Scan this code in your authenticator app, or enter the key manually.", style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink)
                val bitmap = remember(s.qrDataUrl) {
                    runCatching {
                        val b = Base64.decode(s.qrDataUrl.substringAfter("base64,"), Base64.DEFAULT)
                        BitmapFactory.decodeByteArray(b, 0, b.size)?.asImageBitmap()
                    }.getOrNull()
                }
                bitmap?.let { Image(it, contentDescription = "2-step verification QR code", modifier = Modifier.padding(vertical = 10.dp).size(190.dp).clip(RoundedCornerShape(12.dp)).background(Color.White)) }
                SelectionContainer { Text(s.secret, fontFamily = FontFamily.Monospace, color = CcColors.Forest, style = MaterialTheme.typography.titleSmall) }
                Text("2. Enter the 6-digit code it shows.", style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink, modifier = Modifier.padding(top = 10.dp))
                CcTextField(code, { if (it.length <= 6 && it.all(Char::isDigit)) code = it }, label = "6-digit code", leadingIcon = Icons.Rounded.Key, keyboardType = KeyboardType.NumberPassword)
                CcButton("Turn on", {
                    scope.launch {
                        mfaBusy = true
                        try {
                            app.api.auth.mfaConfirm(code)
                            app.api.auth.me().let { app.session.updateUser(it.user) }
                            setup = null; code = ""
                            snack.show("2-step verification is on.")
                        } catch (e: ApiException) {
                            snack.error(e)
                        } finally {
                            mfaBusy = false
                        }
                    }
                }, Modifier.fillMaxWidth().padding(top = 8.dp), enabled = code.length == 6, loading = mfaBusy)
            }
        }

        SectionHeader("Change password")
        CcCard {
            CcTextField(current, { current = it }, label = "Current password", leadingIcon = Icons.Rounded.Lock, password = true)
            Spacer(Modifier.width(1.dp))
            CcTextField(next, { next = it; pwError = null }, label = "New password", leadingIcon = Icons.Rounded.Lock, password = true, error = pwError)
            PasswordStrength(next, minLen)
            CcTextField(confirm, { confirm = it }, label = "Confirm new password", leadingIcon = Icons.Rounded.Lock, password = true, error = if (confirm.isNotEmpty() && confirm != next) "Passwords do not match" else null)
            CcButton("Update password", {
                pwError = passwordError(next, minLen)
                if (pwError != null || confirm != next || current.isEmpty()) return@CcButton
                scope.launch {
                    pwBusy = true
                    try {
                        app.api.auth.changePassword(current, next, confirm)
                        current = ""; next = ""; confirm = ""
                        snack.show("Password changed. Other devices were signed out.")
                        sessions.reload()
                    } catch (e: ApiException) {
                        snack.error(e)
                    } finally {
                        pwBusy = false
                    }
                }
            }, Modifier.fillMaxWidth().padding(top = 8.dp), loading = pwBusy)
        }

        SectionHeader("Devices")
        LoadContent(sessions) { list ->
            CcCard(padding = 8.dp) {
                list.forEachIndexed { i, s ->
                    if (i > 0) Divider()
                    ListRow(
                        s.deviceName ?: s.userAgent?.take(40) ?: if (s.client == "android") "Android phone" else "Web browser",
                        subtitle = (if (s.current) "This device · " else "") + "Last active ${Fmt.ago(s.lastSeenAt)} · ${Fmt.humanize(s.method)}",
                        icon = if (s.client == "android") Icons.Rounded.Smartphone else Icons.Rounded.DevicesOther,
                        tone = if (s.current) Tone.Brand else Tone.Neutral,
                        trailing = if (!s.current) ({
                            TextButton(onClick = {
                                scope.launch {
                                    try {
                                        app.api.auth.revokeSession(s.id); sessions.reload()
                                    } catch (e: ApiException) {
                                        snack.error(e)
                                    }
                                }
                            }) { Text("Sign out", color = CcColors.Sos) }
                        }) else null,
                    )
                }
            }
        }
        CcButton("Sign out of all devices", { logoutAllOpen = true }, Modifier.fillMaxWidth(), kind = ButtonKind.Outline, leadingIcon = Icons.Rounded.DoneAll)
    }
    if (disableOpen) {
        InputDialog("Turn off 2-step verification?", "Enter a current code from your authenticator app.", label = "6-digit code", confirmLabel = "Turn off", minLength = 6, multiline = false, destructive = true,
            onDismiss = { disableOpen = false },
            onConfirm = { c ->
                scope.launch {
                    try {
                        app.api.auth.mfaDisable(c.trim()); app.api.auth.me().let { app.session.updateUser(it.user) }; disableOpen = false; snack.show("2-step verification turned off.")
                    } catch (e: ApiException) {
                        snack.error(e)
                    }
                }
            },
        )
    }
    if (logoutAllOpen) {
        ConfirmDialog("Sign out everywhere?", "Every device, including this one, will be signed out.", confirmLabel = "Sign out all", destructive = true,
            onDismiss = { logoutAllOpen = false },
            onConfirm = {
                scope.launch {
                    runCatching { app.api.auth.logoutAll() }
                    logoutAllOpen = false
                    signOut()
                }
            },
        )
    }
}
