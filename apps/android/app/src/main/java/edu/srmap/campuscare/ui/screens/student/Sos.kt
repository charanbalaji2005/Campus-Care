package edu.srmap.campuscare.ui.screens.student

import android.content.Context
import android.os.BatteryManager
import android.os.Build
import android.os.SystemClock
import android.view.HapticFeedbackConstants
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
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
import androidx.compose.material.icons.automirrored.rounded.DirectionsRun
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material.icons.automirrored.rounded.TrendingUp
import androidx.compose.material.icons.rounded.Call
import androidx.compose.material.icons.rounded.CameraAlt
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.CloudOff
import androidx.compose.material.icons.rounded.LocationOff
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.NotificationsActive
import androidx.compose.material.icons.rounded.RestartAlt
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.Sms
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import edu.srmap.campuscare.BuildConfig
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.SosAlert
import edu.srmap.campuscare.services.LocationShareService
import edu.srmap.campuscare.services.SosCountdownService
import edu.srmap.campuscare.services.SosCountdownStore
import edu.srmap.campuscare.services.SosTrigger
import edu.srmap.campuscare.ui.components.AccuracyCircle
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
import edu.srmap.campuscare.ui.components.LocationQualityPanel
import edu.srmap.campuscare.ui.components.LocationRationaleDialog
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
import edu.srmap.campuscare.util.Fix
import edu.srmap.campuscare.util.Fmt
import edu.srmap.campuscare.util.LocationHelper
import edu.srmap.campuscare.util.LocationPermissions
import edu.srmap.campuscare.util.LocationQuality
import edu.srmap.campuscare.util.LocationQualityRules
import edu.srmap.campuscare.util.LocationTracking
import edu.srmap.campuscare.util.PermissionLevel
import edu.srmap.campuscare.util.RawFix
import edu.srmap.campuscare.util.SosCountdownRules
import edu.srmap.campuscare.util.SosCountdownState
import edu.srmap.campuscare.util.ageLabel
import edu.srmap.campuscare.util.ageSeconds
import edu.srmap.campuscare.util.composeSms
import edu.srmap.campuscare.util.dial
import edu.srmap.campuscare.util.readPicked
import edu.srmap.campuscare.util.rememberLiveFix
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.max

private val ACTIVE_SOS = setOf("queued", "sending", "sent", "acknowledged", "en_route", "failed")

private enum class SosPhase { Idle, Countdown, Sending, Cancelled, Failed }

/**
 * Full-screen Emergency SOS Interface:
 * 1. Starts the countdown configured by the Super Admin. It runs in [SosCountdownService] (with a
 *    Cancel / Send SOS notification), so leaving this screen or locking the phone does not stop it.
 * 2. Parallel location acquisition starts immediately with the countdown.
 * 3. Shows "Emergency alert will be sent automatically unless you cancel."
 * 4. Large, easy-to-tap Cancel Alert button and Send Now button.
 * 5. Handles screen rotation, backgrounding, and recreation without silently resetting duration.
 * 6. Prevents duplicate submissions with an atomic submission guard.
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
    val security = config.emergencyContacts.firstOrNull {
        (it.category == "security" || it.category == "emergency") && !it.phone.isNullOrBlank()
    }

    var notifyTrusted by rememberSaveable { mutableStateOf(true) }
    var permission by remember { mutableStateOf(LocationPermissions.level(context)) }
    val locationAllowed = permission != PermissionLevel.None
    var locationOn by remember { mutableStateOf(LocationPermissions.locationEnabled(context)) }
    var rationale by remember { mutableStateOf(false) }

    // Start location acquisition immediately in parallel with countdown
    val live by rememberLiveFix(enabled = locationAllowed)
    var oneShot by remember { mutableStateOf<RawFix?>(null) }
    val fix: RawFix? = live?.raw ?: oneShot

    val requestLocation = rememberLocationRequest { _ ->
        permission = LocationPermissions.level(context)
    }

    // Launch parallel fresh fix request immediately
    LaunchedEffect(locationAllowed, locationOn) {
        if (locationAllowed && locationOn && fix == null) {
            scope.launch {
                LocationHelper.current(context, timeoutMs = 4_000)?.let { c ->
                    oneShot = RawFix(
                        c.latitude,
                        c.longitude,
                        c.accuracy,
                        c.elapsedRealtimeNanos?.div(1_000_000) ?: SystemClock.elapsedRealtime(),
                        provider = "fused",
                    )
                }
            }
        }
    }

    // Keep permission and location switch fresh
    LaunchedEffect(Unit) {
        while (true) {
            permission = LocationPermissions.level(context)
            locationOn = LocationPermissions.locationEnabled(context)
            delay(3_000)
        }
    }

    // Check if an SOS is already active
    val mine = rememberLoad { runCatching { app.api.safety.mySos() }.getOrDefault(emptyList()) }
    val active = mine.data?.firstOrNull { it.status in ACTIVE_SOS && it.status != "failed" && it.status != "pending" }

    // The countdown lives in SosCountdownService; this screen only shows it and passes on the person's choices.
    val saved by SosCountdownStore.event.collectAsState()
    LaunchedEffect(Unit) { SosCountdownStore.load(context) }
    val source = rememberSaveable { SosTrigger.consume() ?: "in_app" }
    var trackedId by rememberSaveable { mutableStateOf<String?>(null) }
    var startError by remember { mutableStateOf<String?>(null) }
    if (saved?.active == true && trackedId != saved?.eventId) trackedId = saved?.eventId
    val countdown = saved?.takeIf { it.eventId == trackedId }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }

    fun startCountdown() {
        startError = null
        if (!SosCountdownService.start(context, source, notifyTrusted)) startError = "The SOS countdown could not start."
    }

    // The SOS button always starts the countdown; the tile and shortcut only when the Super Admin allows quick triggers.
    var autoStarted by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        if (!autoStarted && settings.sos.enabled && (source == "in_app" || settings.sos.quickTriggerEnabled)) {
            autoStarted = true
            startCountdown()
        }
    }

    val phase = when {
        startError != null -> SosPhase.Failed
        countdown == null -> SosPhase.Idle
        countdown.state == SosCountdownState.Counting -> if (countdown.due(now)) SosPhase.Sending else SosPhase.Countdown
        countdown.state == SosCountdownState.Cancelled -> SosPhase.Cancelled
        countdown.state == SosCountdownState.Undelivered -> SosPhase.Failed
        else -> SosPhase.Sending // Sent: moving on to the status screen
    }
    val failure = startError ?: countdown?.lastError
    val secondsLeft = countdown?.secondsLeft(now) ?: 0

    // Display ticker on the wall clock, matching the server-held deadline and the notification.
    LaunchedEffect(countdown?.eventId, countdown?.state) {
        while (countdown?.state == SosCountdownState.Counting) {
            now = System.currentTimeMillis()
            if (countdown.secondsLeft(now) > 0 && a11y.haptics) view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
            delay(250)
        }
        now = System.currentTimeMillis()
    }
    LaunchedEffect(countdown?.state, countdown?.alertId) {
        val id = countdown?.alertId
        if (countdown?.state == SosCountdownState.Sent && id != null) {
            if (a11y.haptics) view.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
            nav.navigate(Routes.sosStatus(id)) { popUpTo(Routes.Sos) { inclusive = true } }
        }
    }

    CcScreen(
        title = "Emergency SOS",
        subtitle = "Automatic emergency dispatch",
        // Leaving does not cancel: the countdown carries on in its notification until Cancel is tapped.
        onBack = { nav.popBackStack() },
    ) {
        if (!settings.sos.enabled) {
            InfoBanner(
                "In-app SOS is paused by university administration. Call the emergency contacts below for immediate help.",
                tone = Tone.Amber,
                icon = Icons.Rounded.Warning,
            )
        }

        active?.let { a ->
            CcCard(onClick = { nav.navigate(Routes.sosStatus(a.id)) }, color = CcColors.SosSoft) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconBadge(Icons.Rounded.NotificationsActive, Tone.Danger)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text("You have an active emergency alert", style = MaterialTheme.typography.titleSmall, color = CcColors.SosDeep)
                        Text("${a.alertNumber} · ${Catalog.sosLabels[a.status] ?: a.status}", style = MaterialTheme.typography.bodySmall, color = CcColors.Ink)
                    }
                    Text("View status", color = CcColors.Sos, fontWeight = FontWeight.Bold)
                }
            }
        }

        AnimatedContent(
            targetState = phase,
            transitionSpec = { fadeIn(tween(220)) togetherWith fadeOut(tween(180)) },
            label = "sos_phase",
        ) { p ->
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                when (p) {
                    SosPhase.Countdown -> {
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "Emergency alert will be sent automatically unless you cancel.",
                            style = MaterialTheme.typography.titleMedium,
                            color = CcColors.SosDeep,
                            fontWeight = FontWeight.Bold,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(horizontal = 16.dp),
                        )
                        Spacer(Modifier.height(18.dp))
                        CountdownRing(secondsLeft = secondsLeft, total = countdown?.countdownSeconds ?: SosCountdownRules.DEFAULT_SECONDS)
                        Spacer(Modifier.height(24.dp))

                        // Large accessible touch targets
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp),
                        ) {
                            CcButton(
                                text = "Cancel Alert",
                                onClick = {
                                    SosCountdownService.cancel(context)
                                    if (a11y.haptics) view.performHapticFeedback(HapticFeedbackConstants.REJECT)
                                },
                                modifier = Modifier.weight(1.1f).height(52.dp),
                                kind = ButtonKind.Outline,
                                leadingIcon = Icons.Rounded.Close,
                            )
                            CcButton(
                                text = "Send Now",
                                onClick = { SosCountdownService.sendNow(context) },
                                modifier = Modifier.weight(0.9f).height(52.dp),
                                kind = ButtonKind.Danger,
                                leadingIcon = Icons.AutoMirrored.Rounded.Send,
                            )
                        }
                    }

                    SosPhase.Idle, SosPhase.Cancelled -> {
                        Spacer(Modifier.height(16.dp))
                        if (p == SosPhase.Cancelled) {
                            InfoBanner(
                                "Emergency alert was cancelled. No responders were notified and no incident was dispatched.",
                                tone = Tone.Neutral,
                                icon = Icons.Rounded.CheckCircle,
                                title = "Alert Cancelled",
                            )
                            Spacer(Modifier.height(16.dp))
                        }
                        CcButton(
                            text = "Start SOS Countdown",
                            onClick = { startCountdown() },
                            modifier = Modifier.fillMaxWidth(),
                            kind = ButtonKind.Danger,
                            leadingIcon = Icons.Rounded.RestartAlt,
                        )
                        Spacer(Modifier.height(8.dp))
                        CcButton(
                            text = "Return to Safety Screen",
                            onClick = { nav.popBackStack() },
                            modifier = Modifier.fillMaxWidth(),
                            kind = ButtonKind.Outline,
                        )
                    }

                    SosPhase.Sending -> {
                        Spacer(Modifier.height(30.dp))
                        val pulse = rememberPulse(0.9f, 1.1f, 700)
                        Box(
                            Modifier.size(150.dp).scale(pulse).clip(CircleShape).background(CcColors.Sos),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                Icons.AutoMirrored.Rounded.Send,
                                contentDescription = null,
                                tint = Color.White,
                                modifier = Modifier.size(54.dp),
                            )
                        }
                        Spacer(Modifier.height(16.dp))
                        Text(
                            "Submitting emergency alert...",
                            style = MaterialTheme.typography.titleMedium,
                            color = CcColors.SosDeep,
                            fontWeight = FontWeight.Bold,
                        )
                        Text(
                            "Contacting Campus Security and notifying duty officers...",
                            style = MaterialTheme.typography.bodySmall,
                            color = CcColors.InkSoft,
                        )
                    }

                    SosPhase.Failed -> {
                        InfoBanner(
                            (failure ?: "The emergency alert could not be sent.") +
                                " Please call Campus Security or 112 directly — direct phone calls work even without mobile data.",
                            tone = Tone.Danger,
                            icon = Icons.Rounded.CloudOff,
                            title = "SOS Not Delivered",
                        )
                        Spacer(Modifier.height(12.dp))
                        security?.phone?.let { phone ->
                            CcButton(
                                text = "Call ${security.name}",
                                onClick = { context.dial(phone) },
                                modifier = Modifier.fillMaxWidth(),
                                kind = ButtonKind.Danger,
                                leadingIcon = Icons.Rounded.Call,
                            )
                            Spacer(Modifier.height(8.dp))
                        }
                        CcButton(
                            text = "Call 112 (National Emergency)",
                            onClick = { context.dial("112") },
                            modifier = Modifier.fillMaxWidth(),
                            kind = ButtonKind.Danger,
                            leadingIcon = Icons.Rounded.Call,
                        )
                        Spacer(Modifier.height(8.dp))
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            CcButton(
                                text = "Retry sending",
                                onClick = { if (startError != null) startCountdown() else SosCountdownService.sendNow(context) },
                                modifier = Modifier.weight(1f),
                                kind = ButtonKind.Outline,
                            )
                            CcButton(
                                text = "Text SMS with location",
                                onClick = {
                                    val loc = fix?.let { " My location: https://www.openstreetmap.org/?mlat=${it.latitude}&mlon=${it.longitude} (±${it.accuracyMeters?.toInt() ?: "?"}m)" } ?: ""
                                    context.composeSms(listOfNotNull(security?.phone), "EMERGENCY SOS: I need urgent help.$loc")
                                },
                                modifier = Modifier.weight(1f),
                                kind = ButtonKind.Outline,
                                leadingIcon = Icons.Rounded.Sms,
                            )
                        }
                    }
                }
            }
        }

        // Live location acquisition diagnostics during SOS
        CcCard {
            LocationQualityPanel(
                fix = fix,
                staleSeconds = LocationQualityRules.SOS_STALE_SECONDS,
                permission = permission,
                locationEnabled = locationOn,
                audienceNote = "Shared strictly with on-duty Campus Security responders for this incident. Alert is dispatched regardless of GPS accuracy.",
                onRequestPermission = { rationale = true },
            )
            if (locationAllowed && fix == null && locationOn) {
                TextButton(onClick = {
                    scope.launch {
                        oneShot = LocationHelper.current(context)?.let { c ->
                            RawFix(
                                c.latitude,
                                c.longitude,
                                c.accuracy,
                                c.elapsedRealtimeNanos?.div(1_000_000) ?: SystemClock.elapsedRealtime(),
                                provider = "fused",
                            )
                        }
                    }
                }) {
                    Text("Refresh location fix")
                }
            }
            Divider(Modifier.padding(vertical = 8.dp))
            SwitchRow(
                "Notify verified trusted contacts",
                notifyTrusted,
                { notifyTrusted = it },
                description = "Sends emergency alert and live location link to your verified emergency contacts. Applies to the next SOS you start.",
            )
        }

        if (rationale) {
            LocationRationaleDialog(
                "In an emergency, safety responders use your device location to locate you quickly. Coordinates are only transmitted while your SOS is active.",
                onContinue = { rationale = false; requestLocation() },
                onDismiss = { rationale = false },
            )
        }

        TextButton(onClick = { nav.navigate(Routes.QuickSos) }, modifier = Modifier.fillMaxWidth()) {
            Text("Set up Quick SOS (tile and shortcut)", color = CcColors.Sos, fontWeight = FontWeight.SemiBold)
        }

        SectionHeader("Direct emergency contacts")
        CcCard {
            security?.let {
                EmergencyCallRow(it)
                Divider()
            }
            app.config.nationalEmergencyNumbers.take(2).forEachIndexed { i, c ->
                if (i > 0) Divider()
                EmergencyCallRow(c)
            }
        }
    }
}

@Composable
private fun CountdownRing(secondsLeft: Int, total: Int) {
    val sweep = remember { Animatable(1f) }
    LaunchedEffect(secondsLeft) {
        sweep.animateTo(secondsLeft / total.toFloat(), tween(180, easing = LinearEasing))
    }
    Box(
        Modifier.size(200.dp).semantics { contentDescription = "Emergency countdown: $secondsLeft seconds remaining" },
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.fillMaxSize()) {
            val stroke = 14.dp.toPx()
            val tl = Offset(stroke / 2, stroke / 2)
            val sz = Size(size.width - stroke, size.height - stroke)
            drawArc(CcColors.SosSoft, -90f, 360f, false, topLeft = tl, size = sz, style = Stroke(stroke))
            drawArc(
                CcColors.Sos,
                -90f,
                360f * sweep.value,
                false,
                topLeft = tl,
                size = sz,
                style = Stroke(stroke, cap = StrokeCap.Round),
            )
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("$secondsLeft", fontSize = 68.sp, fontWeight = FontWeight.Black, color = CcColors.Sos)
            Text("SECONDS", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = CcColors.InkSoft)
        }
    }
}

/** Live status of a dispatched SOS incident */
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
    var evidenceUploading by remember { mutableStateOf(false) }
    val tracking by LocationTracking.state.collectAsState()
    var permission by remember { mutableStateOf(LocationPermissions.level(context)) }
    var rationale by remember { mutableStateOf(false) }
    val requestLocation = rememberLocationRequest { _ -> permission = LocationPermissions.level(context) }

    // Media evidence pickers
    val pickPhoto = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) {
            scope.launch {
                evidenceUploading = true
                try {
                    val f = readPicked(context, uri, 25 * 1024 * 1024)
                    app.api.safety.uploadSosEvidence(id, f.bytes, f.name, f.mime)
                    snack.show("Photo evidence securely attached to emergency incident.")
                    alert.reload()
                } catch (e: Exception) {
                    snack.show(e.message ?: "Failed to upload photo evidence.")
                } finally {
                    evidenceUploading = false
                }
            }
        }
    }

    val pickAudio = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) {
            scope.launch {
                evidenceUploading = true
                try {
                    val f = readPicked(context, uri, 25 * 1024 * 1024)
                    app.api.safety.uploadSosEvidence(id, f.bytes, f.name, f.mime)
                    snack.show("Audio evidence securely attached to emergency incident.")
                    alert.reload()
                } catch (e: Exception) {
                    snack.show(e.message ?: "Failed to upload audio evidence.")
                } finally {
                    evidenceUploading = false
                }
            }
        }
    }

    DisposableEffect(id) {
        app.realtime.subscribe("sos:$id")
        onDispose { app.realtime.unsubscribe("sos:$id") }
    }
    LaunchedEffect(id) {
        app.realtime.events.collect { e ->
            if ((e.name == "sos:updated" || e.name == "sos:location") && e.payload.optString("id") == id) {
                alert.reload()
            }
        }
    }
    // Polling fallback while the alert is active
    LaunchedEffect(id) {
        while (true) {
            delay(if (live) 25_000 else 6_000)
            if (alert.data?.status in ACTIVE_SOS) alert.reload()
        }
    }
    val security = config.emergencyContacts.firstOrNull {
        (it.category == "security" || it.category == "emergency") && !it.phone.isNullOrBlank()
    }
    val activeAlert = alert.data?.status?.let { it in ACTIVE_SOS && it != "failed" }
    LaunchedEffect(activeAlert, permission) {
        when (activeAlert) {
            true -> if (permission != PermissionLevel.None) LocationShareService.startSos(context, id)
            false -> if (tracking.sosId == id) LocationShareService.stopSos(context)
            null -> Unit
        }
    }

    CcScreen(
        title = "SOS status",
        subtitle = alert.data?.alertNumber,
        onBack = { nav.popBackStack() },
        refreshing = alert.refreshing,
        onRefresh = { alert.reload() },
        actions = { LiveDot(live, Modifier.padding(end = 12.dp)) },
    ) {
        LoadContent(alert) { a ->
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                StatusHero(a)

                // Battery & device telemetry chips
                if (a.batteryLevel != null || a.isCachedFix) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        a.batteryLevel?.let { bat ->
                            StatusChip(
                                text = "Battery: $bat%",
                                tone = if (bat < 20) Tone.Danger else Tone.Neutral,
                            )
                        }
                        if (a.isCachedFix) {
                            StatusChip(
                                text = "Cached location fix",
                                tone = Tone.Amber,
                            )
                        }
                    }
                }

                if (a.escalationLevel > 0 && a.status in setOf("sent", "queued", "sending")) {
                    InfoBanner(
                        if (a.escalationLevel >= 2) {
                            "No responder acknowledged in time. Alert escalated to senior campus operations."
                        } else {
                            "Alert escalated to backup emergency responders."
                        },
                        tone = Tone.Amber,
                        icon = Icons.AutoMirrored.Rounded.TrendingUp,
                    )
                }
                if (a.status == "failed") {
                    InfoBanner(
                        a.lastDeliveryError ?: "Delivery to responders failed.",
                        tone = Tone.Danger,
                        icon = Icons.Rounded.Warning,
                        title = "Call for help now",
                    )
                }

                SosSteps(a)

                // Live location panel
                if (a.status in ACTIVE_SOS) {
                    CcCard {
                        LocationQualityPanel(
                            fix = tracking.raw.takeIf { tracking.sosId == id },
                            staleSeconds = LocationQualityRules.SOS_STALE_SECONDS,
                            permission = permission,
                            locationEnabled = tracking.locationEnabled,
                            acquiring = tracking.sosId == id,
                            audienceNote = "Transmitted live to Campus Security until this emergency alert is resolved.",
                            uploadNote = when {
                                tracking.sosId != id -> null
                                tracking.pendingUploads > 0 -> "${tracking.lastUploadError ?: "Sending"} · ${tracking.pendingUploads} update(s) waiting"
                                tracking.lastUploadOkAtMs != null -> "Last fix reached responders ${ageLabel((SystemClock.elapsedRealtime() - tracking.lastUploadOkAtMs!!) / 1000.0)}"
                                else -> null
                            },
                            onRequestPermission = { rationale = true },
                        )
                    }
                }

                if (a.locationAvailable && a.latitude != null && a.longitude != null) {
                    val q = a.locationQuality?.let {
                        runCatching { LocationQuality.valueOf(it.replaceFirstChar { c -> c.uppercase() }) }.getOrNull()
                    }
                    CcCard(padding = 0.dp) {
                        OsmMap(
                            centerLat = a.latitude,
                            centerLng = a.longitude,
                            zoom = 17.0,
                            pins = listOf(
                                MapPin("me", a.latitude, a.longitude, "Student location", color = CcColors.Sos, label = "SOS"),
                            ),
                            circles = a.accuracyMeters?.let {
                                listOf(AccuracyCircle(a.latitude, a.longitude, it, CcColors.Sos))
                            } ?: emptyList(),
                            modifier = Modifier.fillMaxWidth().height(200.dp),
                        )
                        Text(
                            "Coordinates: ${LocationQualityRules.formatCoordinates(a.latitude, a.longitude, a.accuracyMeters)} · ±${a.accuracyMeters?.toInt() ?: "?"} m" +
                                (q?.let { " · ${it.label}" } ?: "") +
                                (a.locationAt?.let { " · captured ${Fmt.ago(it)}" } ?: ""),
                            style = MaterialTheme.typography.labelSmall,
                            color = CcColors.InkSoft,
                            modifier = Modifier.padding(12.dp),
                        )
                    }
                } else {
                    InfoBanner(
                        "Responders don't have your GPS coordinates yet. Mention your location when Campus Security calls.",
                        tone = Tone.Amber,
                        icon = Icons.Rounded.LocationOff,
                    )
                }

                // Optional Emergency Evidence Feature (Requirement 5)
                if (a.status in ACTIVE_SOS) {
                    CcCard {
                        Text(
                            "Emergency Evidence (Optional)",
                            style = MaterialTheme.typography.titleMedium,
                            color = CcColors.Ink,
                        )
                        Spacer(Modifier.height(4.dp))
                        Text(
                            "Securely attach photos or audio clips to this incident. Only authorized safety responders and dispatchers can access this media. It will never be posted to public feeds.",
                            style = MaterialTheme.typography.bodySmall,
                            color = CcColors.InkSoft,
                        )
                        if (a.evidenceCount > 0) {
                            Spacer(Modifier.height(8.dp))
                            StatusChip("${a.evidenceCount} evidence file(s) attached", Tone.Brand, dot = true)
                        }
                        if (evidenceUploading) {
                            Spacer(Modifier.height(10.dp))
                            LinearProgressIndicator(Modifier.fillMaxWidth(), color = CcColors.Sos, trackColor = CcColors.SosSoft)
                            Spacer(Modifier.height(4.dp))
                            Text("Uploading encrypted evidence to responders...", style = MaterialTheme.typography.labelSmall, color = CcColors.SosDeep)
                        }
                        Spacer(Modifier.height(12.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                            CcButton(
                                text = "Attach Photo",
                                onClick = { pickPhoto.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                                modifier = Modifier.weight(1f),
                                kind = ButtonKind.Soft,
                                leadingIcon = Icons.Rounded.CameraAlt,
                                enabled = !evidenceUploading,
                            )
                            CcButton(
                                text = "Attach Audio",
                                onClick = { pickAudio.launch("audio/*") },
                                modifier = Modifier.weight(1f),
                                kind = ButtonKind.Soft,
                                leadingIcon = Icons.Rounded.Mic,
                                enabled = !evidenceUploading,
                            )
                        }
                    }
                }

                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    CcButton(
                        text = "Call Security",
                        onClick = { context.dial(security?.phone ?: "112") },
                        modifier = Modifier.weight(1f),
                        kind = ButtonKind.Danger,
                        leadingIcon = Icons.Rounded.Call,
                    )
                    if (a.status in ACTIVE_SOS && (config.settings.sos.allowCancelAfterSend || a.status == "queued")) {
                        CcButton(
                            text = "I'm safe now",
                            onClick = { cancelOpen = true },
                            modifier = Modifier.weight(1f),
                            kind = ButtonKind.Outline,
                            leadingIcon = Icons.Rounded.CheckCircle,
                        )
                    }
                }

                if (a.timeline.isNotEmpty()) {
                    SectionHeader("Timeline")
                    CcCard {
                        a.timeline.asReversed().forEachIndexed { i, t ->
                            if (i > 0) Divider()
                            Row(Modifier.padding(vertical = 8.dp)) {
                                Box(
                                    Modifier.padding(top = 5.dp).size(10.dp).clip(CircleShape)
                                        .background(if (i == 0) CcColors.Emerald else CcColors.Line),
                                )
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

            if (rationale) {
                LocationRationaleDialog(
                    "Responders use your precise location to reach you. It is sent only while this alert is active.",
                    onContinue = { rationale = false; requestLocation() },
                    onDismiss = { rationale = false },
                )
            }

            if (cancelOpen) {
                InputDialog(
                    title = "Mark yourself safe?",
                    message = "Responders will be notified that you cancelled. The alert stays in the official audit record for campus safety.",
                    label = "Reason (optional)",
                    confirmLabel = "I'm safe",
                    minLength = 0,
                    loading = busy,
                    onDismiss = { cancelOpen = false },
                    onConfirm = { reason ->
                        scope.launch {
                            busy = true
                            try {
                                alert.set(app.api.safety.cancelSos(id, reason.ifBlank { null }))
                                LocationShareService.stopAll(context)
                                cancelOpen = false
                                snack.show("Emergency alert cancelled. Glad you are safe.")
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
                    when (a.status) {
                        "en_route" -> Icons.AutoMirrored.Rounded.DirectionsRun
                        "resolved", "cancelled" -> Icons.Rounded.CheckCircle
                        "failed" -> Icons.Rounded.Warning
                        else -> Icons.Rounded.Shield
                    },
                    contentDescription = null,
                    tint = tone.fg,
                    modifier = Modifier.size(30.dp),
                )
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    Catalog.sosLabels[a.status] ?: Fmt.humanize(a.status),
                    style = MaterialTheme.typography.titleLarge,
                    color = CcColors.Ink,
                )
                Text(
                    when (a.status) {
                        "acknowledged" -> "${a.acknowledgedByName ?: "Campus Security"} has acknowledged your alert."
                        "en_route" -> "${a.acknowledgedByName ?: "A responder"} is en route to your location."
                        "sent" -> "Dispatched to ${a.respondersReached} responder${if (a.respondersReached == 1) "" else "s"}. Remain in a safe place."
                        "resolved" -> "Resolved ${Fmt.ago(a.resolvedAt)}."
                        "cancelled" -> "You marked yourself safe."
                        "failed" -> "Delivery failed. Call emergency numbers directly."
                        else -> "Raised ${Fmt.ago(a.createdAt)}"
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = CcColors.InkSoft,
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
        Triple(
            if (a.status == "cancelled") "Cancelled" else "Resolved",
            a.resolvedAt ?: a.cancelledAt,
            a.status in setOf("resolved", "cancelled"),
        ),
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
                    Text(
                        label,
                        style = MaterialTheme.typography.labelMedium,
                        color = if (done) CcColors.Ink else CcColors.InkSoft,
                        textAlign = TextAlign.Center,
                    )
                    Text(if (done) Fmt.time(at) else "—", style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint)
                }
            }
        }
        StatusChip(
            if (a.status in ACTIVE_SOS) "Stay on this screen — status updates automatically" else "This alert is closed",
            if (a.status in ACTIVE_SOS) Tone.Sky else Tone.Neutral,
            dot = true,
            modifier = Modifier.padding(top = 12.dp),
        )
    }
}
