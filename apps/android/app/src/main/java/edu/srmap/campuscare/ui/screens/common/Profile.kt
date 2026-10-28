package edu.srmap.campuscare.ui.screens.common

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.HelpOutline
import androidx.compose.material.icons.automirrored.rounded.Logout
import androidx.compose.material.icons.rounded.AdminPanelSettings
import androidx.compose.material.icons.rounded.Apartment
import androidx.compose.material.icons.rounded.Badge
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.CameraAlt
import androidx.compose.material.icons.rounded.Contacts
import androidx.compose.material.icons.rounded.EditCalendar
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material.icons.rounded.HealthAndSafety
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.Language
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Map
import androidx.compose.material.icons.rounded.MyLocation
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.Phone
import androidx.compose.material.icons.rounded.PrivacyTip
import androidx.compose.material.icons.rounded.School
import androidx.compose.material.icons.rounded.Security
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.TouchApp
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material.icons.rounded.Work
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import edu.srmap.campuscare.BuildConfig
import edu.srmap.campuscare.data.AdminProfileSummary
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.CounsellorProfileSummary
import edu.srmap.campuscare.data.OfficerProfileSummary
import edu.srmap.campuscare.data.ProfileAccount
import edu.srmap.campuscare.data.ProfileActivity
import edu.srmap.campuscare.data.ProfileOverview
import edu.srmap.campuscare.data.StudentProfileSummary
import edu.srmap.campuscare.data.User
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
import edu.srmap.campuscare.ui.components.ConfirmDialog
import edu.srmap.campuscare.ui.components.Divider
import edu.srmap.campuscare.ui.components.IconBadge
import edu.srmap.campuscare.ui.components.InfoBanner
import edu.srmap.campuscare.ui.components.KeyValue
import edu.srmap.campuscare.ui.components.ListRow
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.SectionHeader
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.SwitchRow
import edu.srmap.campuscare.ui.components.TagCloud
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.enterStagger
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.navigation.rememberSignOut
import edu.srmap.campuscare.ui.screens.staff.ResponderDutyCard
import edu.srmap.campuscare.ui.screens.staff.dispatchLabel
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.Fmt
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/*
 * One Profile design for every role: a header (photo, name, role · campus, verification), then
 * Personal information, the role's own section, Security & privacy, Notifications, Preferences
 * and Sign out. Verified identifiers are shown locked; role-wide permissions are read-only here and
 * managed by a Super Admin. The page never shows passwords, tokens, counselling content or SOS details.
 */

private val WEEKDAY_NAMES = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")

private fun campusLabel(campus: String?): String? = campus?.takeIf { it.isNotBlank() }?.let { if (it == "main") "Main campus" else Fmt.humanize(it) }

private fun activityLabel(a: ProfileActivity) = Fmt.humanize(a.action.replace('.', ' ').replace(':', ' '))

private fun permissionLabel(p: String): String {
    val area = p.substringBefore(':').replace('_', ' ').replaceFirstChar { it.uppercase() }
    val action = p.substringAfter(':', "").replace('_', ' ')
    return if (action.isBlank()) area else "$area · $action"
}

// ------------------------------------------------------------------ profile photo

/** Keeps the last downloaded photo so the header doesn't flash when moving between screens. */
private object PhotoCache {
    var key: String? = null
    var bitmap: ImageBitmap? = null
}

/** The user's photo when they have one, their initials otherwise. */
@Composable
fun UserPhoto(user: User, size: Dp, modifier: Modifier = Modifier) {
    val app = LocalApp.current
    val key = user.avatarUpdatedAt?.let { "${user.id}:$it" }
    var bitmap by remember(key) { mutableStateOf(if (key != null && PhotoCache.key == key) PhotoCache.bitmap else null) }
    LaunchedEffect(key) {
        if (key == null || bitmap != null) return@LaunchedEffect
        val bytes = runCatching { app.api.me.avatar() }.getOrNull() ?: return@LaunchedEffect
        val decoded = withContext(Dispatchers.Default) { BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap() }
        if (decoded != null) {
            PhotoCache.key = key
            PhotoCache.bitmap = decoded
            bitmap = decoded
        }
    }
    val b = bitmap
    if (b != null) Image(b, contentDescription = "Profile photo", contentScale = ContentScale.Crop, modifier = modifier.size(size).clip(CircleShape))
    else Avatar(user.fullName, modifier, size = size)
}

/** Decodes the picked image (respecting its orientation where the OS supports it), scales it to at most [max] px and re-encodes as JPEG. */
private fun preparePhoto(context: Context, uri: Uri, max: Int = 512): ByteArray {
    val source: Bitmap = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri)) { decoder, info, _ ->
            val scale = minOf(1f, max.toFloat() / maxOf(info.size.width, info.size.height))
            decoder.setTargetSize((info.size.width * scale).toInt().coerceAtLeast(1), (info.size.height * scale).toInt().coerceAtLeast(1))
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        }
    } else {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= max) sample *= 2
        val decoded = context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) }
            ?: throw IllegalArgumentException("Unreadable image")
        val scale = minOf(1f, max.toFloat() / maxOf(decoded.width, decoded.height))
        if (scale < 1f) Bitmap.createScaledBitmap(decoded, (decoded.width * scale).toInt(), (decoded.height * scale).toInt(), true) else decoded
    }
    return ByteArrayOutputStream().use { out ->
        source.compress(Bitmap.CompressFormat.JPEG, 85, out)
        out.toByteArray()
    }
}

// ------------------------------------------------------------------ profile

@Composable
fun ProfileScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val user by app.session.user.collectAsState()
    val overview = rememberLoad { app.api.me.profile() }
    val signOut = rememberSignOut()
    var confirmSignOut by remember { mutableStateOf(false) }
    var photoMenu by remember { mutableStateOf(false) }
    var uploading by remember { mutableStateOf(false) }
    val u = user ?: return
    val o = overview.data

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            uploading = true
            try {
                val jpeg = withContext(Dispatchers.IO) { preparePhoto(context, uri) }
                app.session.updateUser(app.api.me.uploadAvatar(jpeg).user)
                snack.show("Profile photo updated.")
            } catch (e: ApiException) {
                snack.error(e)
            } catch (e: Exception) {
                snack.show("That image couldn't be used. Try a JPG or PNG photo.")
            } finally {
                uploading = false
            }
        }
    }

    CcScreen(title = "Profile", refreshing = overview.refreshing, onRefresh = { overview.reload() }) {
        ProfileHeader(
            u, o?.account, roleContext(u, o, app.config.settings.universityName), uploading, Modifier.enterStagger(0),
            onPhoto = { photoMenu = true },
        )
        if (u.isStudent) {
            InfoBanner("SOS always works, even if parts of your profile are empty.", icon = Icons.Rounded.Warning, tone = Tone.Danger)
        }

        // Role-specific quick status (duty switches) sits right under the header.
        o?.officer?.let { ResponderDutyCard(onChanged = { overview.reload() }) }
        o?.counsellor?.let { c -> CounsellorDutyCard(c) { overview.reload() } }

        SectionHeader("Personal information", action = "Edit", onAction = { nav.navigate(Routes.EditProfile) })
        PersonalInfoCard(u, o, app.config.settings.universityName)

        when {
            o?.student != null -> StudentSection(o.student)
            o?.counsellor != null -> CounsellorSection(o.counsellor)
            o?.officer != null -> OfficerSection(o.officer)
            o?.admin != null -> AdminSection(u, o.admin)
        }

        SecuritySection(u, o?.account)

        SectionHeader("Notifications")
        val systemNotifications = NotificationManagerCompat.from(context).areNotificationsEnabled()
        CcCard(padding = 8.dp) {
            ListRow(
                "Notification preferences", subtitle = "Choose in-app, push and email for each kind of update",
                icon = Icons.Rounded.Notifications, tone = Tone.Amber, onClick = { nav.navigate(Routes.NotificationPrefs) },
            )
            Divider()
            ListRow(
                "Phone notifications", subtitle = if (systemNotifications) "Allowed for CampusCare" else "Blocked in Android settings — urgent alerts may not ring",
                icon = Icons.Rounded.Notifications, tone = if (systemNotifications) Tone.Brand else Tone.Danger,
                trailing = { StatusChip(if (systemNotifications) "On" else "Off", if (systemNotifications) Tone.Brand else Tone.Danger) },
                chevron = false, onClick = { openAppSettings(context) },
            )
        }

        PreferencesSection(u)

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

    if (photoMenu) {
        AlertDialog(
            onDismissRequest = { photoMenu = false },
            containerColor = Color.White,
            title = { Text("Profile photo", style = MaterialTheme.typography.headlineSmall) },
            text = { Text("Choose a clear photo of your face. JPG or PNG; it's resized on your phone before upload.", style = MaterialTheme.typography.bodyMedium, color = CcColors.InkSoft) },
            confirmButton = {
                CcButton("Choose photo", {
                    photoMenu = false
                    picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                })
            },
            dismissButton = {
                if (u.avatarUpdatedAt != null) {
                    TextButton(onClick = {
                        photoMenu = false
                        scope.launch {
                            try {
                                app.session.updateUser(app.api.me.removeAvatar().user); snack.show("Profile photo removed.")
                            } catch (e: ApiException) {
                                snack.error(e)
                            }
                        }
                    }) { Text("Remove photo", color = CcColors.Sos) }
                } else {
                    TextButton(onClick = { photoMenu = false }) { Text("Cancel", color = CcColors.InkSoft) }
                }
            },
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

private fun roleContext(u: User, o: ProfileOverview?, university: String): String {
    val campus = when {
        o?.officer != null -> campusLabel(o.officer.campus)
        o?.counsellor != null -> campusLabel(o.counsellor.campus)
        u.managedCampuses.isNotEmpty() -> u.managedCampuses.joinToString { campusLabel(it) ?: it }
        u.role == "super_admin" -> "All campuses"
        else -> university
    }
    val role = if (u.isStudent) "Student" else u.designation?.takeIf { it.isNotBlank() } ?: Catalog.roleLabel(u.role)
    return listOfNotNull(role, campus).joinToString(" · ")
}

private fun openAppSettings(context: Context) {
    context.startActivity(
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
}

@Composable
private fun ProfileHeader(u: User, account: ProfileAccount?, subtitle: String, uploading: Boolean, modifier: Modifier, onPhoto: () -> Unit) {
    CcCard(modifier) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(72.dp).clip(CircleShape).clickable(role = Role.Button, onClickLabel = "Change profile photo", onClick = onPhoto),
                contentAlignment = Alignment.Center,
            ) {
                UserPhoto(u, 72.dp)
                if (uploading) CircularProgressIndicator(Modifier.size(28.dp), color = Color.White, strokeWidth = 3.dp)
                Box(
                    Modifier.align(Alignment.BottomEnd).size(24.dp).clip(CircleShape).background(CcColors.Forest).border(2.dp, Color.White, CircleShape),
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Rounded.CameraAlt, contentDescription = null, tint = Color.White, modifier = Modifier.size(13.dp)) }
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(u.fullName, style = MaterialTheme.typography.titleLarge, color = CcColors.Ink)
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 6.dp)) {
                    val verified = account?.emailVerified ?: u.emailVerified
                    StatusChip(if (verified) "Email verified" else "Email not verified", if (verified) Tone.Brand else Tone.Amber, dot = true)
                    if (u.mfaEnabled) StatusChip("2-step on", Tone.Teal)
                    if (u.accountStatus != "active") StatusChip(Fmt.humanize(u.accountStatus), Tone.Amber)
                }
            }
        }
    }
}

/** Locked value with a padlock: changed only through verification or an administrator. */
@Composable
private fun LockedValue(label: String, value: String?, modifier: Modifier = Modifier) {
    if (value.isNullOrBlank()) return
    Row(modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.labelMedium, color = CcColors.InkSoft)
            Text(value, style = MaterialTheme.typography.bodyLarge, color = CcColors.Ink)
        }
        Icon(Icons.Rounded.Lock, contentDescription = "Verified — can't be edited here", tint = CcColors.InkFaint, modifier = Modifier.size(16.dp))
    }
}

@Composable
private fun PersonalInfoCard(u: User, o: ProfileOverview?, university: String) {
    CcCard {
        when (u.role) {
            "student" -> {
                LockedValue("Student ID / registration number", u.studentId ?: "Not added yet")
                LockedValue("University email", u.email)
                KeyValue("Phone", u.phone ?: "Not added")
                KeyValue("Department", u.department)
                KeyValue("Course", u.program)
                KeyValue("Year & section", listOfNotNull(u.academicYear?.let { "Year $it" }, u.section?.let { "Section $it" }).joinToString(" · ").ifBlank { null })
                KeyValue("Campus", university)
                KeyValue("Hostel / residence", u.hostel ?: "Day scholar / not set")
            }
            "counsellor" -> {
                KeyValue("Designation", u.designation ?: o?.counsellor?.title)
                LockedValue("Official email", u.email)
                LockedValue("Staff ID", u.staffId)
                KeyValue("Phone", u.phone ?: "Not added")
                KeyValue("Qualifications", u.qualifications ?: "Not added")
                KeyValue("Experience", u.experienceYears?.let { if (it == 1) "1 year" else "$it years" })
            }
            "security_officer" -> {
                LockedValue("Employee / staff ID", u.staffId ?: "Not assigned")
                LockedValue("Official email", u.email)
                KeyValue("Phone", u.phone ?: "Not added")
                KeyValue("Designation", u.designation)
            }
            "super_admin" -> {
                LockedValue("Administrator ID", u.staffId ?: u.id.takeLast(8).uppercase())
                LockedValue("Official email", u.email)
                KeyValue("Phone", u.phone)
                LockedValue("Account status", Fmt.humanize(u.accountStatus))
            }
            else -> {
                LockedValue("Official email", u.email)
                LockedValue("Staff ID", u.staffId)
                KeyValue("Designation", u.designation)
                KeyValue("Department", u.department)
                KeyValue("Phone", u.phone ?: "Not added")
                LockedValue("Account status", Fmt.humanize(u.accountStatus))
            }
        }
        Text(
            "Items with a padlock are verified and change only through the university's verification process or an administrator.",
            style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint, modifier = Modifier.padding(top = 6.dp),
        )
    }
}

// ------------------------------------------------------------------ role sections

@Composable
private fun StudentSection(s: StudentProfileSummary) {
    val nav = LocalNav.current
    SectionHeader("CampusCare")
    CcCard(padding = 8.dp) {
        ListRow(
            "Counselling appointments",
            subtitle = s.nextAppointment?.startAt?.let { "Next: ${Fmt.dayTime(it)}" } ?: if (s.upcomingAppointments > 0) "${s.upcomingAppointments} pending request(s)" else "No upcoming sessions",
            icon = Icons.Rounded.CalendarMonth, tone = Tone.Violet, onClick = { nav.navigate(Routes.Counselling) },
        )
        Divider()
        ListRow("Campus map & places", subtitle = "Safe routes, help points and buildings", icon = Icons.Rounded.Map, tone = Tone.Sky, onClick = { nav.navigate(Routes.SafetyMap) })
    }
    SectionHeader("Safety")
    CcCard(padding = 8.dp) {
        ListRow(
            "Emergency & trusted contacts",
            subtitle = if (s.trustedContacts == 0) "Optional — add someone to alert during an SOS" else "${s.trustedContacts} contact(s)",
            icon = Icons.Rounded.Contacts, tone = Tone.Rose, onClick = { nav.navigate(Routes.Trusted) },
        )
        Divider()
        ListRow(
            "Digital safety card",
            subtitle = when {
                !s.safetyCardSet -> "Optional medical info for responders"
                s.safetyCardShared -> "Shared with responders only during your SOS"
                else -> "Saved, not shared"
            },
            icon = Icons.Rounded.HealthAndSafety, tone = Tone.Danger, onClick = { nav.navigate(Routes.SafetyCard) },
        )
        Divider()
        ListRow("SOS quick trigger", subtitle = "Quick Settings tile, home-screen shortcut and how they work", icon = Icons.Rounded.TouchApp, tone = Tone.Amber, onClick = { nav.navigate(Routes.QuickSos) })
        Divider()
        ListRow("Campus emergency numbers", icon = Icons.Rounded.Phone, tone = Tone.Sky, onClick = { nav.navigate(Routes.Contacts) })
    }
}

@Composable
private fun CounsellorDutyCard(c: CounsellorProfileSummary, onChanged: () -> Unit) {
    val app = LocalApp.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    var onDuty by remember(c.onDuty) { mutableStateOf(c.onDuty) }
    var busy by remember { mutableStateOf(false) }
    CcCard(color = if (onDuty) CcColors.Mint50 else Color.White) {
        SwitchRow(
            if (onDuty) "On duty — accepting requests" else "Off duty", onDuty,
            { on ->
                if (busy) return@SwitchRow
                onDuty = on
                scope.launch {
                    busy = true
                    try {
                        val current = app.api.counselling.availability()
                        app.api.counselling.saveAvailability(current.copy(acceptingRequests = on))
                        snack.show(if (on) "You're on duty. Students can book you." else "You're off duty. New bookings are paused.")
                        onChanged()
                    } catch (e: ApiException) {
                        onDuty = !on
                        snack.error(e)
                    } finally {
                        busy = false
                    }
                }
            },
            description = "Off duty pauses new bookings; confirmed sessions stay as they are.",
            enabled = !busy,
        )
    }
}

@Composable
private fun CounsellorSection(c: CounsellorProfileSummary) {
    val nav = LocalNav.current
    SectionHeader("Professional profile")
    CcCard {
        KeyValue("Title shown to students", c.title)
        KeyValue("Service location", campusLabel(c.campus))
        if (c.specializations.isNotEmpty()) {
            Text("Specialisations", style = MaterialTheme.typography.labelMedium, color = CcColors.InkSoft, modifier = Modifier.padding(top = 6.dp, bottom = 6.dp))
            TagCloud(c.specializations.map { Catalog.counsellingType(it) }, tone = Tone.Violet)
        }
        if (c.languages.isNotEmpty()) {
            Text("Languages", style = MaterialTheme.typography.labelMedium, color = CcColors.InkSoft, modifier = Modifier.padding(top = 10.dp, bottom = 6.dp))
            TagCloud(c.languages, tone = Tone.Sky)
        }
        if (c.supportedModes.isNotEmpty()) KeyValue("Session modes", c.supportedModes.joinToString { Fmt.humanize(it) }, Modifier.padding(top = 4.dp))
    }

    CcCard(padding = 8.dp) {
        ListRow(
            "Public profile", subtitle = "Bio, focus areas, languages and qualifications students see",
            icon = Icons.Rounded.Groups, tone = Tone.Violet, onClick = { nav.navigate(Routes.CounsellorPublicProfile) },
        )
    }

    SectionHeader("Availability", action = "Manage", onAction = { nav.navigate(Routes.Availability) })
    CcCard {
        Row {
            KeyValue("Session length", "${c.slotMinutes} min", Modifier.weight(1f))
            KeyValue("Daily limit", "${c.maxDailySessions} sessions", Modifier.weight(1f))
        }
        KeyValue("Working days", if (c.workingDays.isEmpty()) "No weekly hours set — students can't book you" else c.workingDays.joinToString { WEEKDAY_NAMES.getOrElse(it) { "?" } })
        if (c.upcomingBlockedDates.isNotEmpty()) KeyValue("Upcoming time off", c.upcomingBlockedDates.joinToString { Fmt.date(it + "T00:00:00Z") })
        CcButton("Edit schedule, breaks & time off", { nav.navigate(Routes.Availability) }, Modifier.fillMaxWidth().padding(top = 6.dp), kind = ButtonKind.Soft, leadingIcon = Icons.Rounded.EditCalendar)
    }

    SectionHeader("Sessions")
    CcCard(padding = 8.dp) {
        ListRow(
            "Pending counselling requests", subtitle = if (c.pendingRequests == 0) "Nothing waiting for you" else "${c.pendingRequests} waiting for your response",
            icon = Icons.Rounded.Groups, tone = if (c.pendingRequests > 0) Tone.Amber else Tone.Neutral,
            trailing = if (c.pendingRequests > 0) ({ StatusChip("${c.pendingRequests}", Tone.Amber) }) else null,
            onClick = { nav.navigate(Routes.CounsellorAppointments) },
        )
        Divider()
        ListRow(
            "Upcoming appointments", subtitle = "${c.upcomingAppointments} confirmed · ${c.sessionsNext24h} in the next 24 hours",
            icon = Icons.Rounded.CalendarMonth, tone = Tone.Violet, onClick = { nav.navigate(Routes.CounsellorAppointments) },
        )
        Divider()
        ListRow(
            "Request response time",
            subtitle = c.medianResponseHours?.let { "Typically ${if (it < 1) "under an hour" else "${it.toInt()} h"} · ${c.decidedLast30Days} requests in 30 days" } ?: "No requests answered in the last 30 days",
            icon = Icons.Rounded.History, tone = Tone.Teal, chevron = false,
        )
    }
    Text(
        "Student records and conversations are never shown on your profile.",
        style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint,
    )
}

@Composable
private fun OfficerSection(o: OfficerProfileSummary) {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var consent by remember(o.locationConsent) { mutableStateOf(o.locationConsent) }
    // Same source as the duty switch, so the two never disagree.
    val duty by app.duty.state.collectAsState()
    val dutyStatus = duty.status ?: o.dutyStatus
    val locationPermission = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    SectionHeader("Duty & coverage")
    CcCard {
        Row {
            KeyValue("Assigned campus", campusLabel(o.campus), Modifier.weight(1f))
            KeyValue("Coverage zone", o.zone ?: "Whole campus", Modifier.weight(1f))
        }
        KeyValue(
            "Shift",
            o.shift?.let { "${Fmt.dayTime(it.startAt)} – ${Fmt.time(it.endAt)}${if (it.status == "active") " · in progress" else ""}" } ?: "No shift scheduled",
        )
        if (o.responsibilities.isNotEmpty()) KeyValue("Responsibilities", o.responsibilities.joinToString { Fmt.humanize(it) })
        if (o.skills.isNotEmpty()) KeyValue("Skills", o.skills.joinToString { Fmt.humanize(it) })
        KeyValue("Emergency response", dispatchLabel(dutyStatus))
        KeyValue("Last check-in from this phone", o.lastHeartbeatAt?.let { Fmt.ago(it) })
    }

    SectionHeader("Active assigned SOS")
    CcCard(padding = 8.dp) {
        if (o.activeIncidents.isEmpty()) {
            ListRow("No active SOS assigned to you", icon = Icons.Rounded.Shield, tone = Tone.Brand, chevron = false)
        }
        o.activeIncidents.forEachIndexed { i, a ->
            if (i > 0) Divider()
            // Reference number and status only; the response screen shows the details.
            ListRow(
                a.alertNumber ?: "SOS alert", subtitle = "${Fmt.humanize(a.status)} · ${Fmt.ago(a.createdAt)}",
                icon = Icons.Rounded.Warning, tone = Tone.Danger, onClick = { nav.navigate(Routes.responderAlert(a.id)) },
            )
        }
        Divider()
        ListRow("Open response screen", icon = Icons.Rounded.Security, tone = Tone.Danger, onClick = { nav.navigate(Routes.ResponderAlerts) })
    }

    SectionHeader("Location sharing")
    CcCard {
        SwitchRow(
            "Share my location while on duty", consent,
            { on ->
                consent = on
                scope.launch {
                    try {
                        app.api.duty.setLocationConsent(on)
                        snack.show(if (on) "Your position is shared with the control room while you're on duty." else "Location sharing stopped. Your stored position was removed.")
                    } catch (e: ApiException) {
                        consent = !on
                        snack.error(e)
                    }
                }
            },
            description = "Helps dispatch the nearest responder. Only used while you're on duty.",
        )
        Divider()
        ListRow(
            "Location permission", subtitle = if (locationPermission) "Precise location allowed" else "Not allowed — tap to open settings",
            icon = Icons.Rounded.MyLocation, tone = if (locationPermission) Tone.Brand else Tone.Amber, chevron = false,
            trailing = { StatusChip(if (locationPermission) "Allowed" else "Off", if (locationPermission) Tone.Brand else Tone.Amber) },
            onClick = { openAppSettings(context) },
        )
    }
}

@Composable
private fun AdminSection(u: User, a: AdminProfileSummary) {
    SectionHeader("Administrative scope")
    CcCard {
        KeyValue("Role", Catalog.roleLabel(u.role))
        KeyValue(
            "Authorised scope",
            if (a.scope == "system") "Whole system — every campus" else a.managedCampuses.takeIf { it.isNotEmpty() }?.joinToString { campusLabel(it) ?: it } ?: "Main campus",
        )
        KeyValue("Zone", a.campusZone)
        Text("Permissions (${a.permissions.size})", style = MaterialTheme.typography.labelMedium, color = CcColors.InkSoft, modifier = Modifier.padding(top = 8.dp, bottom = 6.dp))
        TagCloud(a.permissions.map { permissionLabel(it) })
        InfoBanner(
            "Permissions are read-only here. A Super Admin changes them in Roles & Permissions on the CampusCare website.",
            icon = Icons.Rounded.AdminPanelSettings, tone = Tone.Neutral, modifier = Modifier.padding(top = 10.dp),
        )
    }
    if (a.recentActivity.isNotEmpty()) {
        SectionHeader("Recent administrative activity")
        ActivityList(a.recentActivity)
    }
    if (u.role == "super_admin" && a.securityActivity.isNotEmpty()) {
        SectionHeader("Sign-in & security activity")
        ActivityList(a.securityActivity)
    }
}

@Composable
private fun ActivityList(items: List<ProfileActivity>) {
    CcCard {
        items.forEachIndexed { i, e ->
            if (i > 0) Divider()
            Row(Modifier.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                IconBadge(Icons.Rounded.History, if (e.outcome == "success" || e.outcome == null) Tone.Neutral else Tone.Danger, size = 32.dp, iconSize = 16.dp)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(activityLabel(e), style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink)
                    Text(Fmt.dateTime(e.at) + (e.outcome?.takeIf { it != "success" }?.let { " · ${Fmt.humanize(it)}" } ?: ""), style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
                }
            }
        }
    }
}

// ------------------------------------------------------------------ common sections

@Composable
private fun SecuritySection(u: User, account: ProfileAccount?) {
    val nav = LocalNav.current
    SectionHeader("Security & privacy")
    CcCard(padding = 8.dp) {
        ListRow(
            "Password", subtitle = account?.passwordChangedAt?.let { "Last changed ${Fmt.ago(it)}" } ?: "Change your password",
            icon = Icons.Rounded.Lock, tone = Tone.Teal, onClick = { nav.navigate(Routes.Security) },
        )
        Divider()
        ListRow(
            "2-step verification",
            subtitle = when {
                u.mfaEnabled -> "On"
                account?.mfaRequired == true -> "Required for your role — set it up now"
                else -> "Off — recommended"
            },
            icon = Icons.Rounded.Security, tone = if (u.mfaEnabled) Tone.Brand else Tone.Amber,
            trailing = { StatusChip(if (u.mfaEnabled) "On" else "Off", if (u.mfaEnabled) Tone.Brand else Tone.Amber) },
            onClick = { nav.navigate(Routes.Security) },
        )
        Divider()
        ListRow(
            "Active sessions", subtitle = account?.let { "${it.activeSessions} signed-in device(s) · sign out of others" } ?: "Devices signed in to your account",
            icon = Icons.Rounded.Badge, tone = Tone.Sky, onClick = { nav.navigate(Routes.Security) },
        )
        Divider()
        ListRow(
            "Privacy & data", subtitle = "Who can see what, location sharing, downloads, deletion",
            icon = Icons.Rounded.PrivacyTip, tone = Tone.Violet, onClick = { nav.navigate(Routes.Privacy) },
        )
        account?.lastLoginAt?.let {
            Text("Last sign-in ${Fmt.dateTime(it)}", style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint, modifier = Modifier.padding(start = 12.dp, top = 4.dp, bottom = 4.dp))
        }
    }
}

@Composable
private fun PreferencesSection(u: User) {
    val app = LocalApp.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val a11y by app.a11y.collectAsState()
    SectionHeader("Preferences")
    CcCard {
        CcSelect(
            "Preferred language", Catalog.languages.map { it to it }, u.preferredLanguage ?: "English",
            { lang ->
                scope.launch {
                    try {
                        app.session.updateUser(app.api.auth.updateProfile(mapOf("preferredLanguage" to lang)).user)
                        snack.show("Language preference saved.")
                    } catch (e: ApiException) {
                        snack.error(e)
                    }
                }
            },
            leadingIcon = Icons.Rounded.Language,
        )
        Text(
            "Used for CampusCare messages where a translation is available. The app itself is in English.",
            style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint, modifier = Modifier.padding(top = 4.dp, bottom = 6.dp),
        )
        Divider()
        SwitchRow("Reduce motion", a11y.reduceMotion, { app.setA11y(a11y.copy(reduceMotion = it)) }, description = "Turns off decorative animations and pulsing.")
        Divider()
        SwitchRow("Larger text", a11y.largeText, { app.setA11y(a11y.copy(largeText = it)) }, description = "Increases text size across the app.")
        Divider()
        SwitchRow("Vibration feedback", a11y.haptics, { app.setA11y(a11y.copy(haptics = it)) }, description = "Vibrates during the SOS countdown.")
    }
}

// ------------------------------------------------------------------ edit profile

@Composable
fun EditProfileScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val u = app.session.user.value ?: return
    val isCounsellor = u.role == "counsellor"
    var name by rememberSaveable { mutableStateOf(u.fullName) }
    var phone by rememberSaveable { mutableStateOf(u.phone.orEmpty()) }
    var department by rememberSaveable { mutableStateOf(u.department) }
    var program by rememberSaveable { mutableStateOf(u.program.orEmpty()) }
    var year by rememberSaveable { mutableStateOf(u.academicYear?.toString()) }
    var section by rememberSaveable { mutableStateOf(u.section.orEmpty()) }
    var hostel by rememberSaveable { mutableStateOf(u.hostel.orEmpty()) }
    var designation by rememberSaveable { mutableStateOf(u.designation.orEmpty()) }
    var qualifications by rememberSaveable { mutableStateOf(u.qualifications.orEmpty()) }
    var experience by rememberSaveable { mutableStateOf(u.experienceYears?.toString().orEmpty()) }
    var errors by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var busy by remember { mutableStateOf(false) }
    var confirmDiscard by remember { mutableStateOf(false) }

    val dirty = name != u.fullName || phone != u.phone.orEmpty() || department != u.department || program != u.program.orEmpty() ||
        year != u.academicYear?.toString() || section != u.section.orEmpty() || hostel != u.hostel.orEmpty() ||
        designation != u.designation.orEmpty() || qualifications != u.qualifications.orEmpty() || experience != u.experienceYears?.toString().orEmpty()
    val leave: () -> Unit = { if (dirty) confirmDiscard = true else nav.popBackStack() }
    BackHandler(enabled = dirty) { confirmDiscard = true }

    fun save() {
        errors = buildMap {
            if (name.trim().length < 2) put("fullName", "Enter your full name")
            if (phone.isNotBlank() && !Regex("^\\+?[0-9 ]{7,20}$").matches(phone.trim())) put("phone", "Enter a valid phone number, e.g. +91 98765 43210")
            if (section.isNotBlank() && !Regex("^[A-Za-z0-9 -]{1,20}$").matches(section.trim())) put("section", "Use letters and numbers only")
            if (experience.isNotBlank() && experience.toIntOrNull()?.let { it in 0..60 } != true) put("experienceYears", "Enter a number from 0 to 60")
        }
        if (errors.isNotEmpty()) {
            snack.show("Check the highlighted fields.")
            return
        }
        scope.launch {
            busy = true
            try {
                val body = buildMap<String, Any?> {
                    put("fullName", name.trim()); put("phone", phone.trim())
                    if (u.isStudent) {
                        department?.let { put("department", it) }
                        put("program", program.trim())
                        year?.toIntOrNull()?.let { put("academicYear", it) }
                        put("section", section.trim())
                        put("hostel", hostel.trim())
                    } else {
                        put("designation", designation.trim())
                    }
                    if (isCounsellor) {
                        put("qualifications", qualifications.trim())
                        experience.toIntOrNull()?.let { put("experienceYears", it) }
                    }
                }
                app.session.updateUser(app.api.auth.updateProfile(body).user)
                snack.show("Profile updated.")
                nav.popBackStack()
            } catch (e: ApiException) {
                if (e.fields.isNotEmpty()) errors = e.fields
                snack.error(e)
            } finally {
                busy = false
            }
        }
    }

    CcScreen(title = "Edit profile", onBack = leave) {
        SectionHeader("Verified details")
        CcCard {
            LockedValue(if (u.isStudent) "University email" else "Official email", u.email)
            LockedValue("Role", Catalog.roleLabel(u.role))
            LockedValue(if (u.isStudent) "Student ID" else "Staff ID", if (u.isStudent) u.studentId else u.staffId)
            if (u.managedCampuses.isNotEmpty()) LockedValue("Assigned campuses", u.managedCampuses.joinToString { campusLabel(it) ?: it })
            Text(
                "To correct these, contact your campus administrator — they're changed only after verification.",
                style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint, modifier = Modifier.padding(top = 6.dp),
            )
        }

        SectionHeader("Personal information")
        CcTextField(name, { name = it }, label = "Full name", leadingIcon = Icons.Rounded.Person, error = errors["fullName"], maxLength = 120)
        CcTextField(
            phone, { phone = it }, label = "Phone", leadingIcon = Icons.Rounded.Phone, keyboardType = KeyboardType.Phone, error = errors["phone"],
            hint = if (u.isStudent) "Shared with responders only during your SOS." else "Used by the control room to reach you.",
        )
        if (u.isStudent) {
            SectionHeader("Academic details")
            CcSelect("Department", Catalog.departments.map { it to it }, department, { department = it }, leadingIcon = Icons.Rounded.School)
            CcTextField(program, { program = it }, label = "Course (optional)", placeholder = "e.g. B.Tech CSE", leadingIcon = Icons.Rounded.School, maxLength = 120, error = errors["program"])
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                CcSelect("Year of study", (1..6).map { "$it" to "Year $it" }, year, { year = it }, Modifier.weight(1f), leadingIcon = Icons.Rounded.Badge)
                CcTextField(section, { section = it.uppercase() }, label = "Section", modifier = Modifier.weight(1f), maxLength = 20, error = errors["section"])
            }
            CcTextField(hostel, { hostel = it }, label = "Hostel / residence (optional)", leadingIcon = Icons.Rounded.Apartment, maxLength = 80, hint = "Used to send hostel-specific safety alerts.")
        } else {
            SectionHeader("Work details")
            CcTextField(designation, { designation = it }, label = "Designation", placeholder = "e.g. Senior Counsellor", leadingIcon = Icons.Rounded.Work, maxLength = 80, error = errors["designation"])
        }
        if (isCounsellor) {
            CcTextField(qualifications, { qualifications = it }, label = "Qualifications", placeholder = "e.g. M.Phil Clinical Psychology, RCI licensed", singleLine = false, minLines = 2, maxLength = 300, error = errors["qualifications"])
            CcTextField(experience, { if (it.length <= 2 && it.all(Char::isDigit)) experience = it }, label = "Years of experience", keyboardType = KeyboardType.Number, error = errors["experienceYears"])
            InfoBanner("Specialisations, languages, session length and your weekly schedule are set in Availability.", icon = Icons.Rounded.EditCalendar, tone = Tone.Neutral,
                action = { TextButton(onClick = { nav.navigate(Routes.Availability) }) { Text("Open") } })
        }

        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(top = 8.dp)) {
            CcButton("Cancel", { leave() }, Modifier.weight(1f), kind = ButtonKind.Outline, enabled = !busy)
            CcButton("Save changes", { save() }, Modifier.weight(1f), loading = busy, enabled = dirty)
        }
    }
    if (confirmDiscard) {
        ConfirmDialog("Discard changes?", "Your edits haven't been saved.", confirmLabel = "Discard", destructive = true,
            onDismiss = { confirmDiscard = false },
            onConfirm = { confirmDiscard = false; nav.popBackStack() },
        )
    }
}
