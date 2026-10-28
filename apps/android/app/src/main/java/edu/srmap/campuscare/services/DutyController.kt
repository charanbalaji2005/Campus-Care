package edu.srmap.campuscare.services

import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.DutyGateway
import edu.srmap.campuscare.data.DutyOverview
import edu.srmap.campuscare.data.DutyShift
import java.time.Instant
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/*
 * The one place the app changes a responder's duty status. The server decides; this class asks it,
 * keeps its last confirmed answer for every screen (Profile, SOS alerts, the duty notification) and
 * only then starts or stops ResponderDutyService. The local "on duty" preference is a cache for the
 * service's own restarts, never proof of duty.
 */

enum class DutyProblemKind { NeedsShift, OpenAssignments, NotAllowed, SessionExpired, Offline, Conflict, Server, Rejected }

data class DutyProblem(val kind: DutyProblemKind, val message: String, val offeredShiftId: String? = null, val httpStatus: Int = 0) {
    /** Worth trying the same change again later (connection or server trouble), unlike a policy refusal. */
    val retryable: Boolean get() = kind == DutyProblemKind.Offline || kind == DutyProblemKind.Server || kind == DutyProblemKind.Conflict
}

/** What switching duty on should do, decided from the server's latest duty overview. */
sealed interface OnDutyPlan {
    data object AlreadyOn : OnDutyPlan
    /** PATCH on_duty: the server reattaches a running shift itself, or policy allows duty without one. */
    data object SetStatus : OnDutyPlan
    /** Start an accepted shift whose start window is open; the server puts the responder on duty with it. */
    data class StartShift(val shiftId: String) : OnDutyPlan
    /** The server would refuse; explain instead of sending a request that cannot succeed. */
    data class Blocked(val problem: DutyProblem) : OnDutyPlan
}

object DutyRules {
    /** Statuses in which the server expects heartbeats (stale = heartbeats lost; sending one restores the status). */
    val ACTIVE_STATUSES = setOf("on_duty", "on_break", "busy", "responding", "stale")

    fun isActive(status: String?) = status in ACTIVE_STATUSES

    private fun ms(iso: String?): Long? = iso?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }

    /** Server time of the overview when known, so shift windows never depend on the phone's clock. */
    fun serverNow(o: DutyOverview, deviceNowMs: Long): Long = ms(o.serverTime) ?: deviceNowMs

    /** The shift worth showing: the running one, else the next accepted, else the next offered. */
    fun relevantShift(o: DutyOverview, nowMs: Long): DutyShift? {
        val live = o.shifts.filter { (ms(it.endAt) ?: Long.MAX_VALUE) > nowMs }.sortedBy { ms(it.startAt) ?: 0L }
        return live.firstOrNull { it.status == "active" } ?: live.firstOrNull { it.status == "accepted" } ?: live.firstOrNull { it.status == "offered" }
    }

    /** Mirrors the server's rules in duty.service (changeDutyStatus, startShift); the server still has the last word. */
    fun planOnDuty(o: DutyOverview, nowMs: Long): OnDutyPlan {
        val status = o.availability.status
        if (isActive(status)) return OnDutyPlan.AlreadyOn
        val live = o.shifts.filter { (ms(it.endAt) ?: Long.MAX_VALUE) > nowMs }.sortedBy { ms(it.startAt) ?: 0L }
        if (live.any { it.status == "active" }) return OnDutyPlan.SetStatus
        val graceMs = o.policy.shiftStartGraceMinutes * 60_000L
        val accepted = live.filter { it.status == "accepted" }
        accepted.firstOrNull { (ms(it.startAt) ?: 0L) - graceMs <= nowMs }?.let { return OnDutyPlan.StartShift(it.id) }
        // The shift rule applies only when coming from off duty (unavailable → on duty is always allowed).
        if (o.policy.allowDutyWithoutShift || status != "off_duty") return OnDutyPlan.SetStatus
        if (accepted.isNotEmpty()) {
            return OnDutyPlan.Blocked(
                DutyProblem(DutyProblemKind.NeedsShift, "Your next shift hasn't started yet. You can go on duty from ${o.policy.shiftStartGraceMinutes} minutes before it begins."),
            )
        }
        live.firstOrNull { it.status == "offered" }?.let {
            return OnDutyPlan.Blocked(DutyProblem(DutyProblemKind.NeedsShift, "Accept your offered shift first, then go on duty.", offeredShiftId = it.id))
        }
        return OnDutyPlan.Blocked(DutyProblem(DutyProblemKind.NeedsShift, "Going on duty needs a shift. Ask your duty supervisor to assign you one."))
    }

    /** Turns an API failure into an explanation the officer can act on. The confirmed status has not changed. */
    fun describe(e: ApiException): DutyProblem = classify(e).copy(httpStatus = e.status)

    private fun classify(e: ApiException): DutyProblem = when {
        e.isNetwork -> DutyProblem(DutyProblemKind.Offline, "You're offline, so your duty status hasn't changed. Try again when you're connected.")
        e.status == 401 -> DutyProblem(DutyProblemKind.SessionExpired, "Your session has expired. Sign in again to change your duty status.")
        e.status == 403 -> DutyProblem(DutyProblemKind.NotAllowed, "Your account isn't permitted to change duty status. Contact your duty supervisor.")
        e.code in setOf("shift_required", "too_early", "shift_ended") -> DutyProblem(DutyProblemKind.NeedsShift, e.message ?: "Going on duty needs a shift.")
        e.code == "open_assignments" -> DutyProblem(DutyProblemKind.OpenAssignments, e.message ?: "Resolve or hand over your active emergency before going off duty.")
        e.code == "invalid_transition" -> DutyProblem(DutyProblemKind.NotAllowed, "${e.message ?: "That duty change isn't allowed right now."} Ask your duty supervisor if this is wrong.")
        e.code == "conflict" || e.code == "invalid_state" -> DutyProblem(DutyProblemKind.Conflict, e.message ?: "Your duty status changed at the same time. Try again.")
        e.status >= 500 -> DutyProblem(DutyProblemKind.Server, "CampusCare couldn't update your duty status just now. Try again in a moment.")
        else -> DutyProblem(DutyProblemKind.Rejected, e.message ?: "Your duty status couldn't be changed.")
    }
}

data class DutyState(
    /** The server's last confirmed duty overview; null until it has been read once. */
    val overview: DutyOverview? = null,
    val loading: Boolean = false,
    /** A change is in flight; null otherwise. True = going on duty. */
    val pendingOn: Boolean? = null,
    val problem: DutyProblem? = null,
) {
    val status: String? get() = overview?.availability?.status
    val onDuty: Boolean get() = DutyRules.isActive(status)
    val updating: Boolean get() = pendingOn != null
}

sealed interface DutyResult {
    data class Confirmed(val status: String) : DutyResult
    data class Failed(val problem: DutyProblem) : DutyResult
    /** Another change was already in flight (e.g. a second tap); nothing was sent. */
    data object Ignored : DutyResult
}

/** Makes the phone match the server: starts or stops the foreground duty service. */
interface DutyDevice {
    fun apply(overview: DutyOverview)
    fun applyStatus(status: String)
}

class DutyController(
    private val api: DutyGateway,
    private val device: DutyDevice,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val _state = MutableStateFlow(DutyState())
    val state: StateFlow<DutyState> = _state.asStateFlow()
    /** Serialises server round trips so a refresh never overwrites a newer confirmed change. */
    private val mutex = Mutex()

    /** Reads the authoritative status (screen opened or app resumed) and brings the service in line. */
    suspend fun refresh(): DutyOverview? = mutex.withLock {
        _state.update { it.copy(loading = true) }
        try {
            val o = api.mine()
            confirm(o)
            _state.update { s -> s.copy(problem = s.problem?.takeUnless { it.retryable || it.kind == DutyProblemKind.SessionExpired }) }
            o
        } catch (e: ApiException) {
            // Keep the last confirmed state; a failed read never turns the local cache into the truth.
            _state.update { it.copy(problem = DutyRules.describe(e)) }
            null
        } finally {
            _state.update { it.copy(loading = false) }
        }
    }

    /** The duty switch. Returns once the server has confirmed or refused; the UI shows [state] meanwhile. */
    suspend fun setOnDuty(on: Boolean, reason: String? = null): DutyResult {
        var claimed = false
        _state.update { s ->
            claimed = s.pendingOn == null
            if (claimed) s.copy(pendingOn = on, problem = null) else s
        }
        if (!claimed) return DutyResult.Ignored
        return try {
            mutex.withLock { if (on) goOn() else goOff(reason) }
        } catch (e: ApiException) {
            val p = DutyRules.describe(e)
            _state.update { it.copy(problem = p) }
            DutyResult.Failed(p)
        } finally {
            _state.update { it.copy(pendingOn = null) }
        }
    }

    private suspend fun goOn(): DutyResult {
        // Plan from fresh server data, not from what this screen happened to load earlier.
        val current = api.mine()
        val confirmed = when (val plan = DutyRules.planOnDuty(current, DutyRules.serverNow(current, clock()))) {
            OnDutyPlan.AlreadyOn -> current
            OnDutyPlan.SetStatus -> current.copy(availability = api.setStatus("on_duty"))
            is OnDutyPlan.StartShift -> {
                api.startShift(plan.shiftId)
                try {
                    api.mine()
                } catch (e: ApiException) {
                    // The start succeeded, which the server only allows by putting the responder on duty.
                    current.copy(availability = current.availability.copy(status = "on_duty", currentShiftId = plan.shiftId))
                }
            }
            is OnDutyPlan.Blocked -> {
                confirm(current)
                _state.update { it.copy(problem = plan.problem) }
                return DutyResult.Failed(plan.problem)
            }
        }
        confirm(confirmed)
        return DutyResult.Confirmed(confirmed.availability.status)
    }

    private suspend fun goOff(reason: String?): DutyResult {
        val base = _state.value.overview ?: api.mine()
        val a = api.setStatus("off_duty", reason = reason)
        val confirmed = base.copy(availability = a)
        confirm(confirmed)
        return DutyResult.Confirmed(a.status)
    }

    /** Accepts or declines an offered shift, then re-reads the server so the switch can use it. */
    suspend fun decideShift(id: String, accept: Boolean): DutyProblem? {
        return try {
            mutex.withLock { api.decideShift(id, if (accept) "accept" else "decline") }
            refresh()
            null
        } catch (e: ApiException) {
            DutyRules.describe(e).also { p -> _state.update { it.copy(problem = p) } }
        }
    }

    fun dismissProblem() = _state.update { it.copy(problem = null) }

    /**
     * A status the server reported by itself (heartbeat reply, realtime duty:updated, 409 not_on_duty).
     * [applyToDevice] is false when the caller is the duty service, which manages itself.
     */
    fun onServerStatus(status: String, applyToDevice: Boolean) {
        if (status.isBlank()) return
        _state.update { s -> s.overview?.let { o -> s.copy(overview = o.copy(availability = o.availability.copy(status = status))) } ?: s }
        if (applyToDevice) device.applyStatus(status)
    }

    /** A full overview the duty service read itself; recorded without restarting the service. */
    fun onServerOverview(o: DutyOverview) = _state.update { it.copy(overview = o) }

    /** Signed out: forget the previous account's duty state. */
    fun reset() {
        _state.value = DutyState()
    }

    private fun confirm(o: DutyOverview) {
        _state.update { it.copy(overview = o) }
        device.apply(o)
    }
}
