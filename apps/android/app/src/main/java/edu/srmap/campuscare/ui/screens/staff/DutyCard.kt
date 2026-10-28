package edu.srmap.campuscare.ui.screens.staff

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import edu.srmap.campuscare.services.DutyProblem
import edu.srmap.campuscare.services.DutyProblemKind
import edu.srmap.campuscare.services.DutyResult
import edu.srmap.campuscare.services.DutyRules
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.InfoBanner
import edu.srmap.campuscare.ui.components.KeyValue
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.SwitchRow
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.Fmt
import kotlinx.coroutines.launch

val DUTY_LABELS = mapOf(
    "on_duty" to "On duty", "off_duty" to "Off duty", "on_break" to "On break", "busy" to "Busy",
    "responding" to "Responding", "unavailable" to "Unavailable", "stale" to "Unreachable",
)

fun dutyLabel(status: String) = DUTY_LABELS[status] ?: Fmt.humanize(status)

fun dutyTone(status: String) = when (status) {
    "on_duty" -> Tone.Brand
    "responding", "busy" -> Tone.Danger
    "on_break" -> Tone.Amber
    "stale" -> Tone.Rose
    else -> Tone.Neutral
}

/** What dispatch does with this status (server rules in dispatch.service: on duty, fresh heartbeat). */
fun dispatchLabel(status: String) = when (status) {
    "on_duty" -> "Available for dispatch"
    "busy" -> "Busy — dispatch prefers other responders"
    "responding" -> "Handling an emergency — no new alerts"
    "on_break" -> "On break — no new alerts"
    "stale" -> "Unreachable — dispatch can't reach this phone"
    else -> "Not receiving dispatches"
}

private val SHIFT_LABELS = mapOf("active" to "In progress", "accepted" to "Accepted", "offered" to "Offered to you")

/**
 * The officer's On duty / Off duty switch, shared by Profile and the SOS alerts screen. It shows only
 * what the server has confirmed: the switch moves after the server answers, a refusal is explained,
 * and the status is re-read whenever the screen comes back to the foreground.
 */
@Composable
fun ResponderDutyCard(modifier: Modifier = Modifier, onChanged: () -> Unit = {}) {
    val app = LocalApp.current
    val snack = LocalSnack.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val state by app.duty.state.collectAsState()
    val user by app.session.user.collectAsState()
    val lifecycle = LocalLifecycleOwner.current.lifecycle

    // Re-read authoritative duty state as soon as this card enters the composition
    LaunchedEffect(Unit) {
        app.duty.refresh()
    }

    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) scope.launch { app.duty.refresh() } }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    // A supervisor override or the stale sweep changes the status without this phone asking.
    LaunchedEffect(Unit) {
        app.realtime.events.collect { e ->
            if (e.name != "duty:updated") return@collect
            val who = e.payload.optString("userId")
            if (who.isNotBlank() && who != user?.id) return@collect
            val status = e.payload.optString("status")
            if (status.isNotBlank() && status != state.status) {
                app.duty.onServerStatus(status, applyToDevice = true)
                onChanged()
            }
        }
    }

    fun change(on: Boolean) = scope.launch {
        when (val r = app.duty.setOnDuty(on)) {
            is DutyResult.Confirmed -> {
                snack.show(if (DutyRules.isActive(r.status)) "You're on duty. SOS alerts assigned to you will ring on this phone." else "You're off duty. Dispatch won't assign you new alerts.")
                onChanged()
            }
            is DutyResult.Failed -> {
                snack.show(r.problem.message)
            }
            DutyResult.Ignored -> Unit
        }
    }

    val status = state.status
    val known = status != null
    val notificationsAllowed = NotificationManagerCompat.from(context).areNotificationsEnabled()
    val shift = state.overview?.let { DutyRules.relevantShift(it, DutyRules.serverNow(it, System.currentTimeMillis())) }

    CcCard(modifier, color = if (state.onDuty) CcColors.Mint50 else Color.White) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 4.dp)) {
            Text("Server status", style = MaterialTheme.typography.labelMedium, color = CcColors.InkSoft, modifier = Modifier.weight(1f))
            StatusChip(
                if (known) dutyLabel(status!!) else if (state.loading) "Checking…" else "Off duty",
                if (known) dutyTone(status!!) else Tone.Neutral,
                dot = true,
            )
        }
        SwitchRow(
            title = when (state.pendingOn) {
                true -> "Going on duty…"
                false -> "Going off duty…"
                null -> if (state.onDuty) "On duty — receiving SOS alerts" else "Off duty — tap to go on duty"
            },
            checked = state.onDuty,
            onCheckedChange = { on -> change(on) },
            description = when {
                state.loading && !known -> "Checking your duty status with CampusCare…"
                state.onDuty && notificationsAllowed -> "SOS alerts assigned to you ring on this phone, even when the app is closed."
                state.onDuty -> "You're on duty, but phone notifications are blocked, so alerts can't ring while the app is closed."
                else -> "Dispatch only offers SOS alerts to officers who are on duty."
            },
            enabled = !state.updating,
        )
        if (state.updating || state.loading) {
            LinearProgressIndicator(Modifier.fillMaxWidth().padding(top = 4.dp), color = CcColors.Emerald, trackColor = CcColors.Mint)
        }
        if (known) KeyValue("Dispatch", dispatchLabel(status!!), Modifier.padding(top = 6.dp))
        shift?.let { s ->
            KeyValue("Shift", "${Fmt.dayTime(s.startAt)} – ${Fmt.time(s.endAt)} · ${SHIFT_LABELS[s.status] ?: Fmt.humanize(s.status)}")
            if (s.status == "offered") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 4.dp)) {
                    CcButton("Accept shift", { scope.launch { app.duty.decideShift(s.id, accept = true)?.let { snack.show(it.message) } ?: snack.show("Shift accepted.") } }, Modifier.weight(1f), kind = ButtonKind.Soft, enabled = !state.updating)
                    CcButton("Decline", { scope.launch { app.duty.decideShift(s.id, accept = false)?.let { snack.show(it.message) } ?: snack.show("Shift declined. Your supervisor has been told.") } }, Modifier.weight(1f), kind = ButtonKind.Ghost, enabled = !state.updating)
                }
            }
        }
        state.problem?.let { p -> DutyProblemBanner(p, onRetry = { app.duty.dismissProblem(); scope.launch { app.duty.refresh() } }) }
        if (state.onDuty && !notificationsAllowed) {
            InfoBanner(
                "Allow CampusCare notifications so SOS alerts can ring while the app is closed.",
                icon = Icons.Rounded.Notifications, tone = Tone.Danger, modifier = Modifier.padding(top = 8.dp),
                action = {
                    CcButton("Open settings", {
                        context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    }, kind = ButtonKind.Ghost)
                },
            )
        }
    }
}

@Composable
private fun DutyProblemBanner(p: DutyProblem, onRetry: () -> Unit) {
    val title = when (p.kind) {
        DutyProblemKind.NeedsShift -> "A shift is needed"
        DutyProblemKind.OpenAssignments -> "You have an active emergency"
        DutyProblemKind.NotAllowed -> "Not allowed"
        DutyProblemKind.SessionExpired -> "Signed out"
        DutyProblemKind.Offline -> "No connection"
        DutyProblemKind.Conflict, DutyProblemKind.Server, DutyProblemKind.Rejected -> "Duty status not changed"
    }
    InfoBanner(
        p.message, title = title, icon = Icons.Rounded.Warning,
        tone = if (p.kind == DutyProblemKind.NeedsShift || p.kind == DutyProblemKind.Offline) Tone.Amber else Tone.Danger,
        modifier = Modifier.padding(top = 8.dp),
        action = if (p.retryable) ({ CcButton("Check again", onRetry, kind = ButtonKind.Ghost) }) else null,
    )
}
