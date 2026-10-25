package edu.srmap.campuscare.ui.screens.student

import android.view.HapticFeedbackConstants
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Call
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.CloudOff
import androidx.compose.material.icons.automirrored.rounded.DirectionsRun
import androidx.compose.material.icons.rounded.LocationOff
import androidx.compose.material.icons.rounded.LocationOn
import androidx.compose.material.icons.rounded.MyLocation
import androidx.compose.material.icons.rounded.NotificationsActive
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.Sms
import androidx.compose.material.icons.automirrored.rounded.TrendingUp
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.SosAlert
import edu.srmap.campuscare.data.newIdempotencyKey
import edu.srmap.campuscare.services.LocationShareService
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.Catalog
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.Divider
import edu.srmap.campuscare.ui.components.EmergencyCallRow
import edu.srmap.campuscare.ui.components.IconBadge
import edu.srmap.campuscare.ui.components.InfoBanner
import edu.srmap.campuscare.ui.components.InputDialog
import edu.srmap.campuscare.ui.components.LiveDot
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.MapPin
import edu.srmap.campuscare.ui.components.OsmMap
import edu.srmap.campuscare.ui.components.SectionHeader
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.SwitchRow
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.components.rememberLocationRequest
import edu.srmap.campuscare.ui.components.rememberPulse
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.ui.theme.LocalReducedMotion
import edu.srmap.campuscare.util.Fix
import edu.srmap.campuscare.util.Fmt
import edu.srmap.campuscare.util.LocationHelper
import edu.srmap.campuscare.util.composeSms
import edu.srmap.campuscare.util.dial
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val ACTIVE_SOS = setOf("queued", "sending", "sent", "acknowledged", "en_route", "failed")

private enum class SosPhase { Idle, Countdown, Sending, Failed }

/**
 * Emergency SOS (mockup): press and hold the red button, a cancellable countdown runs, then the
 * alert is sent with location. Every step has a direct-call fallback that works without the server.
 */
@Composable
fun SosScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val context = LocalContext.current
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    val config by app.config.config.collectAsState()
    val a11y by app.a11y.collectAsState()
    val settings = config.settings
    val security = config.emergencyContacts.firstOrNull { (it.category == "security" || it.category == "emergency") && !it.phone.isNullOrBlank() }

    var phase by remember { mutableStateOf(SosPhase.Idle) }
    var secondsLeft by remember { mutableIntStateOf(settings.sos.countdownSeconds) }
    var notifyTrusted by remember { mutableStateOf(true) }
    var fix by remember { mutableStateOf<Fix?>(null) }
    var locationAllowed by remember { mutableStateOf(LocationHelper.hasPermission(context)) }
    var failure by remember { mutableStateOf<String?>(null) }
    // One idempotency key per SOS attempt, so retries after a network blip never create duplicates.
    var attemptKey by remember { mutableStateOf(newIdempotencyKey()) }

    val requestLocation = rememberLocationRequest { granted ->
        locationAllowed = granted
        if (granted) scope.launch { fix = LocationHelper.current(context) }
    }
    LaunchedEffect(Unit) {
        if (!locationAllowed) requestLocation() else fix = LocationHelper.current(context)
    }

    // An SOS that is already active is shown instead of starting a new one.
    val mine = rememberLoad { runCatching { app.api.safety.mySos() }.getOrDefault(emptyList()) }
    val active = mine.data?.firstOrNull { it.status in ACTIVE_SOS && it.status != "failed" }

    fun send() {
        phase = SosPhase.Sending
        scope.launch {
            val f = fix ?: LocationHelper.current(context, timeoutMs = 4_000)
            try {
                val alert = app.api.safety.raiseSos(
                    attemptKey, f?.latitude, f?.longitude, f?.accuracy,
                    if (f == null) (if (locationAllowed) "no_fix" else "permission_denied") else null,
                    notifyTrusted,
                )
                if (a11y.haptics) view.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
                nav.navigate(Routes.sosStatus(alert.id)) { popUpTo(Routes.Sos) { inclusive = true } }
            } catch (e: ApiException) {
                failure = if (e.isNetwork) "You're offline or CampusCare can't be reached." else (e.message ?: "The alert could not be sent.")
                phase = SosPhase.Failed
            }
        }
    }

    // Countdown — cancellable at every second.
    LaunchedEffect(phase) {
        if (phase == SosPhase.Countdown) {
            secondsLeft = settings.sos.countdownSeconds.coerceIn(3, 30)
            while (secondsLeft > 0) {
                delay(1_000)
                if (phase != SosPhase.Countdown) return@LaunchedEffect
                secondsLeft--
                if (a11y.haptics) view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
            }
            send()
        }
    }

    CcScreen(title = "Emergency SOS", subtitle = "Help is on the way", onBack = { nav.popBackStack() }) {
        if (!settings.sos.enabled) {
            InfoBanner("In-app SOS is paused by the university. Call the numbers below for immediate help.", tone = Tone.Amber, icon = Icons.Rounded.Warning)
        }
        active?.let { a ->
            CcCard(onClick = { nav.navigate(Routes.sosStatus(a.id)) }, color = CcColors.SosSoft) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconBadge(Icons.Rounded.NotificationsActive, Tone.Danger)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text("You have an active alert", style = MaterialTheme.typography.titleSmall, color = CcColors.SosDeep)
                        Text("${a.alertNumber} · ${Catalog.sosLabels[a.status] ?: a.status}", style = MaterialTheme.typography.bodySmall, color = CcColors.Ink)
                    }
                    Text("View", color = CcColors.Sos, fontWeight = FontWeight.Bold)
                }
            }
        }

        AnimatedContent(targetState = phase, transitionSpec = { fadeIn(tween(220)) togetherWith fadeOut(tween(180)) }, label = "sos") { p ->
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                when (p) {
                    SosPhase.Idle -> {
                        Text(
                            "Press and hold the button for 2 seconds",
                            style = MaterialTheme.typography.titleMedium, color = CcColors.Ink, textAlign = TextAlign.Center,
                            modifier = Modifier.padding(top = 8.dp),
                        )
                        Text("A ${settings.sos.countdownSeconds}-second countdown lets you cancel if pressed by mistake.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft, textAlign = TextAlign.Center)
                        Spacer(Modifier.height(20.dp))
                        HoldToTrigger(enabled = settings.sos.enabled) {
                            attemptKey = newIdempotencyKey()
                            phase = SosPhase.Countdown
                        }
                    }
                    SosPhase.Countdown -> {
                        Text("Sending SOS in", style = MaterialTheme.typography.titleMedium, color = CcColors.SosDeep)
                        Spacer(Modifier.height(12.dp))
                        CountdownRing(secondsLeft, settings.sos.countdownSeconds.coerceIn(3, 30))
                        Spacer(Modifier.height(18.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                            CcButton("Cancel SOS", { phase = SosPhase.Idle }, Modifier.weight(1f), kind = ButtonKind.Outline, leadingIcon = Icons.Rounded.Close)
                            CcButton("Send now", { send() }, Modifier.weight(1f), kind = ButtonKind.Danger, leadingIcon = Icons.AutoMirrored.Rounded.Send)
                        }
                    }
                    SosPhase.Sending -> {
                        Spacer(Modifier.height(30.dp))
                        val pulse = rememberPulse(0.9f, 1.1f, 700)
                        Box(Modifier.size(150.dp).scale(pulse).clip(CircleShape).background(CcColors.Sos), contentAlignment = Alignment.Center) {
                            Icon(Icons.AutoMirrored.Rounded.Send, contentDescription = null, tint = Color.White, modifier = Modifier.size(54.dp))
                        }
                        Spacer(Modifier.height(16.dp))
                        Text("Sending your alert…", style = MaterialTheme.typography.titleMedium, color = CcColors.SosDeep)
                    }
                    SosPhase.Failed -> {
                        InfoBanner(
                            (failure ?: "The alert could not be sent.") + " Call Campus Security directly — this always works.",
                            tone = Tone.Danger, icon = Icons.Rounded.CloudOff, title = "SOS not delivered",
                        )
                        Spacer(Modifier.height(12.dp))
                        security?.phone?.let { phone ->
                            CcButton("Call ${security.name}", { context.dial(phone) }, Modifier.fillMaxWidth(), kind = ButtonKind.Danger, leadingIcon = Icons.Rounded.Call)
                            Spacer(Modifier.height(8.dp))
                        }
                        CcButton("Call 112", { context.dial("112") }, Modifier.fillMaxWidth(), kind = ButtonKind.Danger, leadingIcon = Icons.Rounded.Call)
                        Spacer(Modifier.height(8.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                            CcButton("Try again", { send() }, Modifier.weight(1f), kind = ButtonKind.Outline)
                            CcButton(
                                "Text for help",
                                {
                                    val loc = fix?.let { " My location: https://maps.google.com/?q=${it.latitude},${it.longitude}" } ?: ""
                                    context.composeSms(listOfNotNull(security?.phone), "SOS — I need help urgently.$loc")
                                },
                                Modifier.weight(1f), kind = ButtonKind.Outline, leadingIcon = Icons.Rounded.Sms,
                            )
                        }
                    }
                }
            }
        }

        // Location status
        CcCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconBadge(if (fix != null) Icons.Rounded.LocationOn else Icons.Rounded.LocationOff, if (fix != null) Tone.Brand else Tone.Amber, size = 40.dp, iconSize = 20.dp)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(if (fix != null) "Location ready" else "Location not available", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                    Text(
                        when {
                            fix != null -> "Accurate to about ${fix?.accuracy?.toInt() ?: "?"} m. Shared only with responders for this alert."
                            !locationAllowed -> "Allow location so responders can find you. You can still send an SOS without it."
                            else -> "Trying to get a fix… your SOS will still be sent."
                        },
                        style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft,
                    )
                }
                if (!locationAllowed) CcButton("Allow", { requestLocation() }, kind = ButtonKind.Soft)
                else if (fix == null) CcButton("Retry", { scope.launch { fix = LocationHelper.current(context) } }, kind = ButtonKind.Soft, leadingIcon = Icons.Rounded.MyLocation)
            }
            Divider(Modifier.padding(vertical = 8.dp))
            SwitchRow("Also alert my trusted contacts", notifyTrusted, { notifyTrusted = it }, description = "Verified trusted contacts get an email with your alert and location link.")
        }

        SectionHeader("Call directly")
        CcCard {
            security?.let { EmergencyCallRow(it); Divider() }
            app.config.nationalEmergencyNumbers.take(2).forEachIndexed { i, c ->
                if (i > 0) Divider()
                EmergencyCallRow(c)
            }
        }
    }
}

/** Big red button: hold for 2 s (progress ring fills). Accessibility services get a plain click action. */
@Composable
private fun HoldToTrigger(enabled: Boolean, onTriggered: () -> Unit) {
    val scope = rememberCoroutineScope()
    val progress = remember { Animatable(0f) }
    val reduced = LocalReducedMotion.current
    val pulse = if (reduced) 1f else rememberPulse(0.97f, 1.03f, 1200)
    val view = LocalView.current
    Box(
        Modifier
            .size(240.dp)
            .semantics {
                role = Role.Button
                contentDescription = "Emergency SOS. Double tap to start the countdown."
                onClick(label = "Start SOS countdown") { if (enabled) onTriggered(); enabled }
            }
            .pointerInput(enabled) {
                if (!enabled) return@pointerInput
                detectTapGestures(onPress = {
                    view.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                    val job = scope.launch {
                        progress.animateTo(1f, tween(2_000, easing = LinearEasing))
                        onTriggered()
                        progress.snapTo(0f)
                    }
                    tryAwaitRelease()
                    if (progress.value < 1f) {
                        job.cancel()
                        scope.launch { progress.animateTo(0f, tween(250)) }
                    }
                })
            },
        contentAlignment = Alignment.Center,
    ) {
        // Soft halo rings
        Canvas(Modifier.fillMaxSize().scale(pulse)) {
            drawCircle(CcColors.Sos.copy(alpha = 0.08f), radius = size.minDimension / 2f)
            drawCircle(CcColors.Sos.copy(alpha = 0.14f), radius = size.minDimension / 2.4f)
        }
        Canvas(Modifier.size(206.dp)) {
            val stroke = 10.dp.toPx()
            drawArc(
                color = CcColors.SosDeep, startAngle = -90f, sweepAngle = 360f * progress.value, useCenter = false,
                topLeft = Offset(stroke / 2, stroke / 2), size = Size(size.width - stroke, size.height - stroke),
                style = Stroke(stroke, cap = StrokeCap.Round),
            )
        }
        Box(
            Modifier
                .size(176.dp)
                .clip(CircleShape)
                .background(Brush.radialGradient(if (enabled) listOf(Color(0xFFEF4444), CcColors.Sos, CcColors.SosDeep) else listOf(CcColors.InkFaint, CcColors.InkSoft))),
            contentAlignment = Alignment.Center,
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("SOS", color = Color.White, fontSize = 46.sp, fontWeight = FontWeight.Black)
                Text(if (progress.value > 0f) "Keep holding…" else "Hold to send", color = Color.White.copy(alpha = 0.9f), style = MaterialTheme.typography.labelLarge)
            }
        }
    }
}

@Composable
private fun CountdownRing(secondsLeft: Int, total: Int) {
    val sweep = remember { Animatable(1f) }
    LaunchedEffect(secondsLeft) { sweep.animateTo(secondsLeft / total.toFloat(), tween(900, easing = LinearEasing)) }
    Box(Modifier.size(210.dp).semantics { contentDescription = "SOS will be sent in $secondsLeft seconds" }, contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val stroke = 14.dp.toPx()
            val tl = Offset(stroke / 2, stroke / 2)
            val sz = Size(size.width - stroke, size.height - stroke)
            drawArc(CcColors.SosSoft, -90f, 360f, false, topLeft = tl, size = sz, style = Stroke(stroke))
            drawArc(CcColors.Sos, -90f, 360f * sweep.value, false, topLeft = tl, size = sz, style = Stroke(stroke, cap = StrokeCap.Round))
        }
        Text("$secondsLeft", fontSize = 72.sp, fontWeight = FontWeight.Black, color = CcColors.Sos)
    }
}

/** Live status of a raised SOS: delivery → acknowledged → responder en route → resolved. */
@Composable
fun SosStatusScreen(id: String) {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val live by app.realtime.connected.collectAsState()
    val config by app.config.config.collectAsState()
    val alert = rememberLoad(id) { app.api.safety.sos(id) }
    var cancelOpen by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var sharing by remember { mutableStateOf(false) }

    DisposableEffect(id) {
        app.realtime.subscribe("sos:$id")
        onDispose { app.realtime.unsubscribe("sos:$id") }
    }
    LaunchedEffect(id) {
        app.realtime.events.collect { e -> if (e.name == "sos:updated" && e.payload.optString("id") == id) alert.reload() }
    }
    // Polling fallback while the alert is active (realtime can drop on poor networks).
    LaunchedEffect(id) {
        while (true) {
            delay(if (live) 30_000 else 8_000)
            if (alert.data?.status in ACTIVE_SOS) alert.reload()
        }
    }
    val security = config.emergencyContacts.firstOrNull { (it.category == "security" || it.category == "emergency") && !it.phone.isNullOrBlank() }

    CcScreen(
        title = "SOS status",
        subtitle = alert.data?.alertNumber,
        onBack = { nav.popBackStack() },
        refreshing = alert.refreshing, onRefresh = { alert.reload() },
        actions = { LiveDot(live, Modifier.padding(end = 12.dp)) },
    ) {
        LoadContent(alert) { a ->
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                StatusHero(a)
                if (a.escalationLevel > 0 && a.status in setOf("sent", "queued", "sending")) {
                    InfoBanner(
                        if (a.escalationLevel >= 2) "No one had acknowledged yet, so the alert was escalated to senior staff." else "Your alert was escalated to backup responders.",
                        tone = Tone.Amber, icon = Icons.AutoMirrored.Rounded.TrendingUp,
                    )
                }
                if (a.status == "failed") {
                    InfoBanner(a.lastDeliveryError ?: "Delivery to responders failed.", tone = Tone.Danger, icon = Icons.Rounded.Warning, title = "Call for help now")
                }
                SosSteps(a)

                if (a.locationAvailable && a.latitude != null && a.longitude != null) {
                    CcCard(padding = 0.dp) {
                        OsmMap(
                            centerLat = a.latitude, centerLng = a.longitude, zoom = 17.0,
                            pins = listOf(MapPin("me", a.latitude, a.longitude, "Your SOS location", color = CcColors.Sos, label = "SOS")),
                            modifier = Modifier.fillMaxWidth().height(180.dp),
                        )
                        Text(
                            "Shared with responders for this alert only · ±${a.accuracyMeters?.toInt() ?: "?"} m",
                            style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft, modifier = Modifier.padding(12.dp),
                        )
                    }
                } else {
                    InfoBanner("Your location wasn't available. Tell Campus Security where you are when they call.", tone = Tone.Amber, icon = Icons.Rounded.LocationOff)
                }

                if (a.status in ACTIVE_SOS && config.settings.locationSharingEnabled) {
                    CcButton(
                        if (sharing) "Sharing live location with Security" else "Share my live location (60 min)",
                        {
                            scope.launch {
                                val f = LocationHelper.current(context) ?: run { snack.show("Location is unavailable. Turn on location and try again."); return@launch }
                                try {
                                    val share = app.api.safety.startShare(60, "security", f.latitude, f.longitude, f.accuracy)
                                    LocationShareService.start(context, share.id, share.expiresAt, share.audience)
                                    sharing = true
                                    snack.show("Live location shared with Campus Security for 60 minutes.")
                                } catch (e: ApiException) {
                                    snack.error(e)
                                }
                            }
                        },
                        Modifier.fillMaxWidth(), kind = ButtonKind.Soft, enabled = !sharing, leadingIcon = Icons.Rounded.MyLocation,
                    )
                }

                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    CcButton("Call Security", { context.dial(security?.phone ?: "112") }, Modifier.weight(1f), kind = ButtonKind.Danger, leadingIcon = Icons.Rounded.Call)
                    if (a.status in ACTIVE_SOS && (config.settings.sos.allowCancelAfterSend || a.status == "queued")) {
                        CcButton("I'm safe now", { cancelOpen = true }, Modifier.weight(1f), kind = ButtonKind.Outline, leadingIcon = Icons.Rounded.CheckCircle)
                    }
                }

                if (a.timeline.isNotEmpty()) {
                    SectionHeader("Timeline")
                    CcCard {
                        a.timeline.asReversed().forEachIndexed { i, t ->
                            if (i > 0) Divider()
                            Row(Modifier.padding(vertical = 8.dp)) {
                                Box(Modifier.padding(top = 5.dp).size(10.dp).clip(CircleShape).background(if (i == 0) CcColors.Emerald else CcColors.Line))
                                Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(Fmt.humanize(t.type), style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                                    listOfNotNull(t.actorLabel, t.note).joinToString(" · ").takeIf { it.isNotBlank() }?.let {
                                        Text(it, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                                    }
                                }
                                Text(Fmt.time(t.at), style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint)
                            }
                        }
                    }
                }
            }
            if (cancelOpen) {
                InputDialog(
                    title = "Mark yourself safe?",
                    message = "Responders are told you cancelled. The alert stays in the record. If someone is already on the way, they may still check on you.",
                    label = "Reason (optional)", confirmLabel = "I'm safe", minLength = 0, loading = busy,
                    onDismiss = { cancelOpen = false },
                    onConfirm = { reason ->
                        scope.launch {
                            busy = true
                            try {
                                alert.set(app.api.safety.cancelSos(id, reason.ifBlank { null }))
                                LocationShareService.stop(context)
                                cancelOpen = false
                                snack.show("Alert cancelled. Stay safe.")
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
    }
}

@Composable
private fun StatusHero(a: SosAlert) {
    val tone = Catalog.sosTone(a.status)
    val activeNow = a.status in ACTIVE_SOS && a.status != "failed"
    val pulse = if (activeNow) rememberPulse(0.85f, 1.15f, 900) else 1f
    CcCard(color = tone.bg.copy(alpha = 0.6f)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(58.dp), contentAlignment = Alignment.Center) {
                Box(Modifier.size(58.dp).scale(pulse).clip(CircleShape).background(tone.fg.copy(alpha = 0.18f)))
                Icon(
                    when (a.status) { "en_route" -> Icons.AutoMirrored.Rounded.DirectionsRun; "resolved", "cancelled" -> Icons.Rounded.CheckCircle; "failed" -> Icons.Rounded.Warning; else -> Icons.Rounded.Shield },
                    contentDescription = null, tint = tone.fg, modifier = Modifier.size(30.dp),
                )
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(Catalog.sosLabels[a.status] ?: Fmt.humanize(a.status), style = MaterialTheme.typography.titleLarge, color = CcColors.Ink)
                Text(
                    when (a.status) {
                        "acknowledged" -> "${a.acknowledgedByName ?: "Campus Security"} has seen your alert."
                        "en_route" -> "${a.acknowledgedByName ?: "A responder"} is on the way to you."
                        "sent" -> "Delivered to ${a.respondersReached} responder${if (a.respondersReached == 1) "" else "s"}. Stay where it is safe."
                        "resolved" -> "Resolved ${Fmt.ago(a.resolvedAt)}."
                        "cancelled" -> "You marked yourself safe."
                        "failed" -> "Use the call button below."
                        else -> "Raised ${Fmt.ago(a.createdAt)}"
                    },
                    style = MaterialTheme.typography.bodyMedium, color = CcColors.InkSoft,
                )
            }
        }
    }
}

@Composable
private fun SosSteps(a: SosAlert) {
    val steps = listOf(
        Triple("Sent", a.sentAt, a.status !in setOf("queued", "sending", "failed")),
        Triple("Acknowledged", a.acknowledgedAt, a.acknowledgedAt != null),
        Triple("On the way", a.enRouteAt, a.enRouteAt != null),
        Triple(if (a.status == "cancelled") "Cancelled" else "Resolved", a.resolvedAt ?: a.cancelledAt, a.status in setOf("resolved", "cancelled")),
    )
    CcCard {
        Row(Modifier.fillMaxWidth()) {
            steps.forEachIndexed { i, (label, at, done) ->
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.weight(1f).height(3.dp).background(if (i == 0) Color.Transparent else if (done) CcColors.Emerald else CcColors.Line))
                        Box(
                            Modifier.size(26.dp).clip(CircleShape).background(if (done) CcColors.Emerald else CcColors.CreamDeep),
                            contentAlignment = Alignment.Center,
                        ) {
                            if (done) Icon(Icons.Rounded.CheckCircle, contentDescription = null, tint = Color.White, modifier = Modifier.size(18.dp))
                            else Text("${i + 1}", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
                        }
                        Box(Modifier.weight(1f).height(3.dp).background(if (i == steps.lastIndex) Color.Transparent else if (steps[i + 1].third) CcColors.Emerald else CcColors.Line))
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(label, style = MaterialTheme.typography.labelMedium, color = if (done) CcColors.Ink else CcColors.InkSoft, textAlign = TextAlign.Center)
                    Text(if (done) Fmt.time(at) else "—", style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint)
                }
            }
        }
        StatusChip(
            if (a.status in ACTIVE_SOS) "Stay on this screen — it updates automatically" else "This alert is closed",
            if (a.status in ACTIVE_SOS) Tone.Sky else Tone.Neutral, dot = true, modifier = Modifier.padding(top = 12.dp),
        )
    }
}
