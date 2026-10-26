package edu.srmap.campuscare.ui.screens.student

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.DirectionsWalk
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Email
import androidx.compose.material.icons.rounded.Flag
import androidx.compose.material.icons.rounded.HealthAndSafety
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Update
import androidx.compose.material.icons.rounded.MyLocation
import androidx.compose.material.icons.rounded.NotificationsActive
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.Phone
import androidx.compose.material.icons.rounded.Place
import androidx.compose.material.icons.rounded.Done
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.SafeWalk
import edu.srmap.campuscare.data.SafetyCard
import edu.srmap.campuscare.data.TrustedContact
import edu.srmap.campuscare.services.LocationShareService
import edu.srmap.campuscare.ui.components.BottomActionBar
import edu.srmap.campuscare.ui.components.ButtonKind
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
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.SectionHeader
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.SwitchRow
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.enterStagger
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.components.rememberLocationRequest
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.Fmt
import edu.srmap.campuscare.util.LocationHelper
import java.time.Duration
import java.time.Instant
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import edu.srmap.campuscare.data.liveLocation
import edu.srmap.campuscare.ui.components.AccuracyCircle
import edu.srmap.campuscare.ui.components.LocationQualityPanel
import edu.srmap.campuscare.ui.components.LocationRationaleDialog
import edu.srmap.campuscare.ui.components.MapPin
import edu.srmap.campuscare.ui.components.OsmMap
import edu.srmap.campuscare.util.LocationPermissions
import edu.srmap.campuscare.util.LocationQualityRules
import edu.srmap.campuscare.util.LocationTracking
import edu.srmap.campuscare.util.PermissionLevel
import edu.srmap.campuscare.util.RawFix
import edu.srmap.campuscare.util.ageLabel
import edu.srmap.campuscare.util.ageSeconds
import edu.srmap.campuscare.util.rememberLiveFix
import androidx.compose.material.icons.rounded.LocationOff

private val ACTIVE_WALK = setOf("active", "overdue", "escalated")

/**
 * Safe Walk (mockup): tell the app where you're going and when you expect to arrive. If you don't
 * check in or arrive, your verified trusted contacts and Campus Security are alerted.
 */
@Composable
fun SafeWalkScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val walks = rememberLoad { app.api.safety.safeWalks() }
    val active = walks.data?.firstOrNull { it.status in ACTIVE_WALK }
    CcScreen(
        title = "Safe Walk",
        subtitle = "We'll keep an eye on your journey",
        onBack = { nav.popBackStack() },
        refreshing = walks.refreshing, onRefresh = { walks.reload() },
    ) {
        LoadContent(walks) { _ ->
            if (active != null) ActiveWalk(active, onChanged = { walks.reload() }) else StartWalk(onStarted = { walks.reload() })
        }
    }
}

@Composable
private fun StartWalk(onStarted: () -> Unit) {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val config by app.config.config.collectAsState()
    val contacts = rememberLoad { app.api.safety.trustedContacts() }
    var destination by rememberSaveable { mutableStateOf("") }
    var minutes by rememberSaveable { mutableStateOf("15") }
    val chosen = remember { mutableStateListOf<String>() }
    var share by rememberSaveable { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val requestLocation = rememberLocationRequest { granted -> if (!granted) share = false }
    var rationale by remember { mutableStateOf(false) }
    // While sharing is switched on, warm up a fresh high-accuracy fix so the share starts with a live position.
    val live by rememberLiveFix(enabled = share && LocationPermissions.level(context) != PermissionLevel.None)

    if (rationale) {
        LocationRationaleDialog(
            "During your walk, Campus Security can see your live location so they can find you if you don't arrive. Sharing ends when you arrive or cancel.",
            onContinue = { rationale = false; requestLocation() }, onDismiss = { rationale = false; share = false },
        )
    }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        CcCard(color = CcColors.TealSoft.copy(alpha = 0.5f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconBadge(Icons.AutoMirrored.Rounded.DirectionsWalk, Tone.Teal, size = 52.dp, iconSize = 28.dp)
                Spacer(Modifier.width(12.dp))
                Text("If you don't check in on time, your trusted contacts and Campus Security are alerted automatically.", style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink)
            }
        }
        CcTextField(destination, { destination = it; error = null }, label = "Where are you going?", placeholder = "e.g. Hostel Block B", leadingIcon = Icons.Rounded.Place, error = error, maxLength = 120)
        ChoiceChips(listOf("Hostel" to "Hostel", "Library" to "Library", "Main gate" to "Main gate", "Academic block" to "Academic block"), destination, { destination = it })
        Text("Expected walking time", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
        ChoiceChips(listOf("10" to "10 min", "15" to "15 min", "20" to "20 min", "30" to "30 min", "45" to "45 min", "60" to "1 hour"), minutes, { minutes = it })

        SectionHeader("Who should know?", action = "Manage", onAction = { nav.navigate(Routes.Trusted) })
        LoadContent(contacts) { list ->
            val verified = list.filter { it.status == "verified" }
            CcCard(padding = 8.dp) {
                if (verified.isEmpty()) {
                    Text(
                        if (list.isEmpty()) "Add a trusted contact so someone you trust is told if you don't arrive. Campus Security is always alerted."
                        else "Your trusted contacts haven't confirmed yet. They'll get an email to verify. Campus Security is always alerted.",
                        style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft, modifier = Modifier.padding(8.dp),
                    )
                }
                verified.forEach { c ->
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp))
                            .clickable(role = Role.Checkbox) { if (c.id in chosen) chosen.remove(c.id) else if (chosen.size < 5) chosen.add(c.id) }
                            .padding(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Checkbox(checked = c.id in chosen, onCheckedChange = null, colors = CheckboxDefaults.colors(checkedColor = CcColors.Emerald))
                        Spacer(Modifier.width(8.dp))
                        Column(Modifier.weight(1f)) {
                            Text(c.name, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                            Text(c.relationship ?: c.email, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                        }
                    }
                }
            }
        }
        if (config.settings.locationSharingEnabled) {
            SwitchRow(
                "Share my live location with Campus Security", share,
                { on -> share = on; if (on && !LocationHelper.hasPermission(context)) rationale = true },
                description = "Only during this walk. A notification shows while sharing, and you can stop any time.",
            )
        }
        CcButton(
            "Start Safe Walk",
            {
                if (destination.trim().length < 2) {
                    error = "Enter your destination"
                    return@CcButton
                }
                scope.launch {
                    busy = true
                    try {
                        val mins = minutes.toLongOrNull() ?: 15L
                        val eta = Instant.now().plus(Duration.ofMinutes(mins)).toString()
                        app.api.safety.startSafeWalk(destination.trim(), eta, chosen.toList())
                        if (share) {
                            val f = live?.raw?.takeIf { it.ageSeconds() <= LocationQualityRules.SHARE_STALE_SECONDS }
                                ?: LocationHelper.current(context)?.let { c -> RawFix(c.latitude, c.longitude, c.accuracy, c.elapsedRealtimeNanos?.div(1_000_000) ?: android.os.SystemClock.elapsedRealtime(), provider = "fused") }
                            if (f != null) {
                                runCatching { app.api.liveLocation.startShare((mins + 15).toInt().coerceAtMost(config.settings.maxLocationShareMinutes), "security", f) }
                                    .onSuccess { s -> LocationShareService.start(context, s.id, s.expiresAt, s.audience) }
                                    .onFailure { snack.show("Safe Walk started, but live location could not be shared.") }
                            } else {
                                snack.show("Safe Walk started. Location unavailable, so live sharing is off.")
                            }
                        }
                        onStarted()
                    } catch (e: ApiException) {
                        snack.error(e)
                    } finally {
                        busy = false
                    }
                }
            },
            Modifier.fillMaxWidth(), kind = ButtonKind.Brand, loading = busy, leadingIcon = Icons.AutoMirrored.Rounded.DirectionsWalk,
        )
    }
}

@Composable
private fun ActiveWalk(w: SafeWalk, onChanged: () -> Unit) {
    val app = LocalApp.current
    val snack = LocalSnack.current
    val context = LocalContext.current
    val nav = LocalNav.current
    val scope = rememberCoroutineScope()
    val eta = Fmt.parse(w.expectedArrivalAt)
    val started = Fmt.parse(w.createdAt) ?: Instant.now()
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var busy by remember { mutableStateOf<String?>(null) }
    var confirmCancel by remember { mutableStateOf(false) }
    LaunchedEffect(w.id) {
        while (true) {
            now = System.currentTimeMillis(); delay(1_000)
        }
    }
    val remainingMs = (eta?.toEpochMilli() ?: now) - now
    val total = ((eta?.toEpochMilli() ?: now) - started.toEpochMilli()).coerceAtLeast(1)
    val fraction by animateFloatAsState((remainingMs.toFloat() / total).coerceIn(0f, 1f), tween(900), label = "walk")
    val overdue = remainingMs < 0 || w.status != "active"

    fun act(action: String, minutes: Int? = null) {
        scope.launch {
            busy = action
            try {
                app.api.safety.safeWalkAction(w.id, action, minutes)
                if (action == "arrived" || action == "cancel") LocationShareService.stop(context)
                snack.show(
                    when (action) {
                        "check-in" -> "Checked in. Stay safe."
                        "extend" -> "Extended by $minutes minutes."
                        "arrived" -> "Glad you made it!"
                        else -> "Safe Walk cancelled."
                    },
                )
                onChanged()
            } catch (e: ApiException) {
                snack.error(e)
            } finally {
                busy = null
            }
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (overdue) {
            InfoBanner(
                if (w.status == "escalated") "Campus Security has been alerted. Tap \"I've arrived\" if you're safe, or open SOS if you need help."
                else "You're past your expected arrival. Check in or extend so we don't alert anyone unnecessarily.",
                tone = Tone.Danger, icon = Icons.Rounded.Warning,
            )
        }
        CcCard {
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("Walking to", style = MaterialTheme.typography.labelLarge, color = CcColors.InkSoft)
                Text(w.destination, style = MaterialTheme.typography.headlineSmall, color = CcColors.Ink)
                Spacer(Modifier.height(14.dp))
                val mins = kotlin.math.abs(remainingMs) / 60_000
                val secs = (kotlin.math.abs(remainingMs) / 1000) % 60
                Box(Modifier.size(190.dp).semantics { contentDescription = if (remainingMs >= 0) "$mins minutes $secs seconds remaining" else "Overdue by $mins minutes" }, contentAlignment = Alignment.Center) {
                    Canvas(Modifier.fillMaxSize()) {
                        val s = 12.dp.toPx()
                        val tl = Offset(s / 2, s / 2)
                        val sz = Size(size.width - s, size.height - s)
                        drawArc(CcColors.Mint, -90f, 360f, false, topLeft = tl, size = sz, style = Stroke(s))
                        drawArc(if (overdue) CcColors.Sos else CcColors.Teal, -90f, 360f * fraction, false, topLeft = tl, size = sz, style = Stroke(s, cap = StrokeCap.Round))
                    }
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(String.format(java.util.Locale.ENGLISH, "%s%d:%02d", if (remainingMs < 0) "+" else "", mins, secs), fontSize = 40.sp, fontWeight = FontWeight.Bold, color = if (overdue) CcColors.Sos else CcColors.Forest)
                        Text(if (remainingMs >= 0) "until ${Fmt.time(w.expectedArrivalAt)}" else "overdue", style = MaterialTheme.typography.labelMedium, color = CcColors.InkSoft)
                    }
                }
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    StatusChip(Fmt.humanize(w.status), if (overdue) Tone.Danger else Tone.Teal, dot = true)
                    StatusChip("${w.verifiedContacts} contact${if (w.verifiedContacts == 1) "" else "s"} watching", Tone.Neutral)
                    if (w.checkIns.isNotEmpty()) StatusChip("${w.checkIns.size} check-in${if (w.checkIns.size == 1) "" else "s"}", Tone.Sky)
                }
            }
        }
        WalkLiveLocation()
        CcButton("I've arrived safely", { act("arrived") }, Modifier.fillMaxWidth(), kind = ButtonKind.Brand, loading = busy == "arrived", leadingIcon = Icons.Rounded.Flag)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            CcButton("Check in", { act("check-in") }, Modifier.weight(1f), kind = ButtonKind.Soft, loading = busy == "check-in", leadingIcon = Icons.Rounded.Done)
            CcButton("+15 min", { act("extend", 15) }, Modifier.weight(1f), kind = ButtonKind.Soft, loading = busy == "extend", leadingIcon = Icons.Rounded.Update)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            CcButton("I need help", { nav.navigate(Routes.Sos) }, Modifier.weight(1f), kind = ButtonKind.Danger, leadingIcon = Icons.Rounded.NotificationsActive)
            CcButton("Cancel walk", { confirmCancel = true }, Modifier.weight(1f), kind = ButtonKind.Ghost, leadingIcon = Icons.Rounded.Close)
        }
    }
    if (confirmCancel) {
        ConfirmDialog(
            "Cancel Safe Walk?", "No one will be alerted for this walk. Live location sharing (if on) stops too.",
            confirmLabel = "Cancel walk", destructive = true, loading = busy == "cancel",
            onConfirm = { confirmCancel = false; act("cancel") }, onDismiss = { confirmCancel = false },
        )
    }
}

/** Live location during a walk: who sees it, until when, how good it is, and an obvious Stop control. */
@Composable
private fun WalkLiveLocation() {
    val app = LocalApp.current
    val snack = LocalSnack.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val tracking by LocationTracking.state.collectAsState()
    var stopping by remember { mutableStateOf(false) }
    val id = tracking.shareId ?: return
    CcCard {
        LocationQualityPanel(
            fix = tracking.raw, staleSeconds = LocationQualityRules.SHARE_STALE_SECONDS, permission = tracking.permission, locationEnabled = tracking.locationEnabled,
            audienceNote = "Visible to ${if (tracking.shareAudience == "trusted_contacts") "your trusted contacts" else "Campus Security"} until ${Fmt.time(tracking.shareExpiresAt)} — or until you arrive, cancel or stop.",
            uploadNote = when {
                tracking.pendingUploads > 0 -> "${tracking.lastUploadError ?: "Sending"} · ${tracking.pendingUploads} waiting"
                tracking.lastUploadOkAtMs != null -> "Last update delivered ${ageLabel((android.os.SystemClock.elapsedRealtime() - tracking.lastUploadOkAtMs!!) / 1000.0)}"
                else -> null
            },
        )
        val est = tracking.estimate
        if (est != null) {
            Spacer(Modifier.height(10.dp))
            OsmMap(
                centerLat = est.latitude, centerLng = est.longitude, zoom = 17.0,
                pins = listOf(MapPin("me", est.latitude, est.longitude, "You (smoothed for display)", color = CcColors.Teal, label = "Y")),
                route = tracking.trail.map { it.latitude to it.longitude },
                circles = listOf(AccuracyCircle(est.latitude, est.longitude, est.accuracyMeters, CcColors.Teal)),
                modifier = Modifier.fillMaxWidth().height(180.dp).clip(RoundedCornerShape(16.dp)),
            )
            Text(
                "The marker is smoothed to reduce jitter; Security receives your measured positions with their accuracy.",
                style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint, modifier = Modifier.padding(top = 4.dp),
            )
        }
        CcButton(
            "Stop sharing location", {
                scope.launch {
                    stopping = true
                    runCatching { app.api.safety.stopShare(id) }.onFailure { snack.show("Stopped on this phone. The server will end the share at its expiry if it couldn't be reached.") }
                    LocationShareService.stop(context)
                    stopping = false
                    snack.show("Location sharing stopped.")
                }
            },
            Modifier.fillMaxWidth().padding(top = 10.dp), kind = ButtonKind.Danger, loading = stopping, leadingIcon = Icons.Rounded.LocationOff,
        )
    }
}

// ------------------------------------------------------------------ trusted contacts

@Composable
fun TrustedContactsScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val list = rememberLoad { app.api.safety.trustedContacts() }
    var adding by remember { mutableStateOf(false) }
    var removing by remember { mutableStateOf<TrustedContact?>(null) }

    CcScreen(
        title = "Trusted Contacts",
        subtitle = "People alerted in an emergency or missed Safe Walk",
        onBack = { nav.popBackStack() },
        refreshing = list.refreshing, onRefresh = { list.reload() },
        bottomBar = {
            BottomActionBar {
                CcButton("Add trusted contact", { adding = true }, Modifier.weight(1f), leadingIcon = Icons.Rounded.Add, enabled = (list.data?.size ?: 0) < 5)
            }
        },
    ) {
        InfoBanner("Each contact gets an email to confirm before they receive any alerts. You can add up to 5.", icon = Icons.Rounded.Lock)
        LoadContent(list) { items ->
            if (items.isEmpty()) {
                EmptyState("No trusted contacts yet", message = "Add a parent, friend or roommate who should know if you need help.", icon = Icons.Rounded.Person)
            }
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items.forEachIndexed { i, c ->
                    CcCard(Modifier.enterStagger(i)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            IconBadge(Icons.Rounded.Person, if (c.status == "verified") Tone.Brand else Tone.Amber)
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(c.name, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                                Text(listOfNotNull(c.relationship, c.email).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                                c.phone?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft) }
                            }
                            IconButton(onClick = { removing = c }) { Icon(Icons.Rounded.Delete, contentDescription = "Remove ${c.name}", tint = CcColors.InkSoft) }
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 8.dp)) {
                            StatusChip(if (c.status == "verified") "Confirmed" else "Waiting for confirmation", if (c.status == "verified") Tone.Brand else Tone.Amber, dot = true)
                            if (c.shareLocation) StatusChip("Can see location in alerts", Tone.Sky)
                        }
                    }
                }
            }
        }
    }
    if (adding) {
        AddContactDialog(onDismiss = { adding = false }, onAdded = { adding = false; list.reload() })
    }
    removing?.let { c ->
        ConfirmDialog(
            "Remove ${c.name}?", "They will no longer receive alerts from you.", confirmLabel = "Remove", destructive = true,
            onDismiss = { removing = null },
            onConfirm = {
                scope.launch {
                    try {
                        app.api.safety.removeTrustedContact(c.id); removing = null; list.reload()
                    } catch (e: ApiException) {
                        snack.error(e)
                    }
                }
            },
        )
    }
}

@Composable
private fun AddContactDialog(onDismiss: () -> Unit, onAdded: () -> Unit) {
    val app = LocalApp.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var relationship by remember { mutableStateOf("") }
    var share by remember { mutableStateOf(false) }
    var errors by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var busy by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Color.White,
        title = { Text("Add trusted contact", style = MaterialTheme.typography.headlineSmall) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                CcTextField(name, { name = it }, label = "Name", leadingIcon = Icons.Rounded.Person, error = errors["name"], maxLength = 80)
                CcTextField(email, { email = it }, label = "Email", leadingIcon = Icons.Rounded.Email, keyboardType = KeyboardType.Email, error = errors["email"])
                CcTextField(phone, { phone = it }, label = "Phone (optional)", leadingIcon = Icons.Rounded.Phone, keyboardType = KeyboardType.Phone, error = errors["phone"])
                CcTextField(relationship, { relationship = it }, label = "Relationship (optional)", placeholder = "Parent, friend, roommate…", maxLength = 40)
                SwitchRow("Include my location in alerts to them", share, { share = it })
            }
        },
        confirmButton = {
            CcButton("Send invite", {
                errors = buildMap {
                    if (name.trim().length < 2) put("name", "Enter a name")
                    if (!Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$").matches(email.trim())) put("email", "Enter a valid email")
                    if (phone.isNotBlank() && !Regex("^\\+?[0-9 ]{7,20}$").matches(phone.trim())) put("phone", "Enter a valid phone number")
                }
                if (errors.isNotEmpty()) return@CcButton
                scope.launch {
                    busy = true
                    try {
                        app.api.safety.addTrustedContact(name.trim(), email.trim().lowercase(), phone.trim().ifBlank { null }, relationship.trim().ifBlank { null }, share)
                        snack.show("Invitation sent to ${email.trim()}.")
                        onAdded()
                    } catch (e: ApiException) {
                        if (e.fields.isNotEmpty()) errors = e.fields else snack.error(e)
                    } finally {
                        busy = false
                    }
                }
            }, loading = busy)
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel", color = CcColors.InkSoft) } },
    )
}

// ------------------------------------------------------------------ digital safety card

@Composable
fun SafetyCardScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val card = rememberLoad { runCatching { app.api.me.safetyCard() }.getOrDefault(SafetyCard()) }
    CcScreen(title = "Digital Safety Card", subtitle = "Medical and accessibility info for responders", onBack = { nav.popBackStack() }) {
        LoadContent(card) { c ->
            var blood by remember(c) { mutableStateOf(c.bloodGroup) }
            var allergies by remember(c) { mutableStateOf(c.allergies) }
            var conditions by remember(c) { mutableStateOf(c.medicalConditions) }
            var meds by remember(c) { mutableStateOf(c.medications) }
            var access by remember(c) { mutableStateOf(c.accessibilityNeeds) }
            var note by remember(c) { mutableStateOf(c.emergencyNote) }
            var consent by remember(c) { mutableStateOf(c.shareWithResponders) }
            var busy by remember { mutableStateOf(false) }
            var confirmDelete by remember { mutableStateOf(false) }
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                InfoBanner(
                    "Encrypted at rest. Responders see it only while they are handling an SOS you raised — and only if you allow it below. Every view is logged in your privacy dashboard.",
                    icon = Icons.Rounded.Lock, tone = Tone.Brand,
                )
                CcSelect("Blood group", listOf("unknown" to "Don't know / prefer not to say") + listOf("A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-").map { it to it }, blood, { blood = it }, leadingIcon = Icons.Rounded.HealthAndSafety)
                CcTextField(allergies, { allergies = it }, label = "Allergies", singleLine = false, maxLength = 300)
                CcTextField(conditions, { conditions = it }, label = "Medical conditions", placeholder = "e.g. asthma, epilepsy, diabetes", singleLine = false, maxLength = 500)
                CcTextField(meds, { meds = it }, label = "Medications", singleLine = false, maxLength = 300)
                CcTextField(access, { access = it }, label = "Accessibility needs", placeholder = "e.g. hearing impaired — please text", singleLine = false, maxLength = 300)
                CcTextField(note, { note = it }, label = "Note for responders", singleLine = false, maxLength = 300)
                SwitchRow("Share with responders during my SOS", consent, { consent = it }, description = "You can turn this off at any time.")
                CcButton("Save safety card", {
                    scope.launch {
                        busy = true
                        try {
                            card.set(app.api.me.saveSafetyCard(SafetyCard(blood, allergies.trim(), conditions.trim(), meds.trim(), access.trim(), note.trim(), consent)))
                            snack.show("Safety card saved.")
                        } catch (e: ApiException) {
                            snack.error(e)
                        } finally {
                            busy = false
                        }
                    }
                }, Modifier.fillMaxWidth(), loading = busy, leadingIcon = Icons.Rounded.CheckCircle)
                if (c.updatedAt != null) {
                    CcButton("Delete safety card", { confirmDelete = true }, Modifier.fillMaxWidth(), kind = ButtonKind.Ghost, leadingIcon = Icons.Rounded.Delete)
                    Text("Last updated ${Fmt.dateTime(c.updatedAt)}", style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint)
                }
            }
            if (confirmDelete) {
                ConfirmDialog("Delete safety card?", "Responders will no longer see any medical information.", confirmLabel = "Delete", destructive = true,
                    onDismiss = { confirmDelete = false },
                    onConfirm = {
                        scope.launch {
                            try {
                                app.api.me.deleteSafetyCard(); confirmDelete = false; card.set(SafetyCard()); snack.show("Safety card deleted.")
                            } catch (e: ApiException) {
                                snack.error(e)
                            }
                        }
                    },
                )
            }
        }
    }
}

// ------------------------------------------------------------------ campus alerts & check-ins

@Composable
fun CampusAlertsScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val alerts = rememberLoad { app.api.safety.campusAlerts() }
    val share = rememberLoad { runCatching { app.api.safety.currentShare() }.getOrNull() }
    LaunchedEffect(Unit) { app.realtime.events.collect { e -> if (e.name == "campus_alert") alerts.reload() } }
    CcScreen(title = "Campus Alerts", subtitle = "Safety notices and check-ins", onBack = { nav.popBackStack() }, refreshing = alerts.refreshing, onRefresh = { alerts.reload(); share.reload() }) {
        share.data?.let { s ->
            CcCard(color = CcColors.SkySoft) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconBadge(Icons.Rounded.MyLocation, Tone.Sky)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text("You're sharing your live location", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                        Text("With ${if (s.audience == "security") "Campus Security" else "trusted contacts"} until ${Fmt.time(s.expiresAt)}", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                    }
                    CcButton("Stop", {
                        scope.launch {
                            try {
                                app.api.safety.stopShare(s.id); LocationShareService.stop(context); share.set(null); snack.show("Location sharing stopped.")
                            } catch (e: ApiException) {
                                snack.error(e)
                            }
                        }
                    }, kind = ButtonKind.Outline)
                }
            }
        }
        LoadContent(alerts) { list ->
            if (list.isEmpty()) EmptyState("No active alerts", message = "You'll be notified here if something affects campus safety.", icon = Icons.Rounded.CheckCircle)
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) { list.forEach { a -> CampusAlertCard(a, onAnswered = { alerts.reload() }) } }
        }
        Divider()
        Text("Alerts that ask for a check-in want to know whether you're safe. Your answer goes to Campus Security only.", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
    }
}
