package edu.srmap.campuscare

import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.DutyAvailability
import edu.srmap.campuscare.data.DutyGateway
import edu.srmap.campuscare.data.DutyOverview
import edu.srmap.campuscare.data.DutyPolicy
import edu.srmap.campuscare.data.DutyShift
import edu.srmap.campuscare.data.StatusResponse
import edu.srmap.campuscare.services.DutyController
import edu.srmap.campuscare.services.DutyDevice
import edu.srmap.campuscare.services.DutyProblemKind
import edu.srmap.campuscare.services.DutyResult
import edu.srmap.campuscare.services.DutyRules
import edu.srmap.campuscare.services.OnDutyPlan
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class DutyControllerTest {
    private val now = Instant.parse("2026-10-28T10:00:00Z")
    private fun at(minutes: Long) = now.plusSeconds(minutes * 60).toString()

    private fun overview(status: String = "off_duty", shifts: List<DutyShift> = emptyList(), allowWithoutShift: Boolean = false) = DutyOverview(
        availability = DutyAvailability(userId = "u1", status = status),
        policy = DutyPolicy(allowDutyWithoutShift = allowWithoutShift, shiftStartGraceMinutes = 15),
        shifts = shifts,
        serverTime = now.toString(),
    )

    /** In-memory stand-in for the server's duty rules (duty.service) with a request log. */
    private class FakeServer(var current: DutyOverview) : DutyGateway {
        val calls = mutableListOf<String>()
        var failNext: ApiException? = null
        var failMine: ApiException? = null
        var gate: CompletableDeferred<Unit>? = null

        private fun maybeFail() = failNext?.let { failNext = null; throw it }

        override suspend fun mine(): DutyOverview {
            calls += "mine"
            failMine?.let { throw it }
            return current
        }

        override suspend fun setStatus(status: String, reason: String?, shiftId: String?): DutyAvailability {
            calls += "setStatus:$status"
            gate?.await()
            maybeFail()
            val from = current.availability.status
            if (status == "on_duty" && from == "off_duty" && !current.policy.allowDutyWithoutShift && current.shifts.none { it.status == "active" }) {
                throw ApiException(422, "shift_required", "Start an accepted shift to go on duty.")
            }
            current = current.copy(availability = current.availability.copy(status = status))
            return current.availability
        }

        override suspend fun decideShift(id: String, decision: String, reason: String?): StatusResponse {
            calls += "decide:$id:$decision"
            maybeFail()
            current = current.copy(shifts = current.shifts.map { if (it.id == id) it.copy(status = if (decision == "accept") "accepted" else "declined") else it })
            return StatusResponse(id, "ok")
        }

        override suspend fun startShift(id: String): StatusResponse {
            calls += "start:$id"
            maybeFail()
            current = current.copy(
                availability = current.availability.copy(status = "on_duty", currentShiftId = id),
                shifts = current.shifts.map { if (it.id == id) it.copy(status = "active") else it },
            )
            return StatusResponse(id, "active")
        }
    }

    /** Records what the phone was told to do with the duty service. */
    private class FakeDevice : DutyDevice {
        val applied = mutableListOf<String>()
        val running get() = applied.lastOrNull()?.let { DutyRules.isActive(it) } == true
        override fun apply(overview: DutyOverview) { applied += overview.availability.status }
        override fun applyStatus(status: String) { applied += status }
    }

    private fun setup(o: DutyOverview): Triple<FakeServer, FakeDevice, DutyController> {
        val server = FakeServer(o)
        val device = FakeDevice()
        return Triple(server, device, DutyController(server, device, clock = { 0L }))
    }

    // ---------------------------------------------------------------- off duty → on duty
    @Test
    fun `switching on starts the accepted shift in its window and only then starts the service`() = runBlocking {
        val (server, device, duty) = setup(overview(shifts = listOf(DutyShift("s1", at(-5), at(240), "accepted"))))
        val r = duty.setOnDuty(true)
        assertEquals(DutyResult.Confirmed("on_duty"), r)
        assertEquals(listOf("mine", "start:s1", "mine"), server.calls)
        assertEquals("on_duty", duty.state.value.status)
        assertTrue(device.running)
        assertFalse(duty.state.value.updating)
    }

    @Test
    fun `switching on inside a running shift asks the server for on_duty`() = runBlocking {
        val (server, device, duty) = setup(overview(shifts = listOf(DutyShift("s1", at(-60), at(60), "active"))))
        assertEquals(DutyResult.Confirmed("on_duty"), duty.setOnDuty(true))
        assertEquals(listOf("mine", "setStatus:on_duty"), server.calls)
        assertTrue(device.running)
    }

    @Test
    fun `switching on when policy allows duty without a shift asks the server for on_duty`() = runBlocking {
        val (server, device, duty) = setup(overview(allowWithoutShift = true))
        assertEquals(DutyResult.Confirmed("on_duty"), duty.setOnDuty(true))
        assertTrue("setStatus:on_duty" in server.calls)
        assertTrue(device.running)
    }

    @Test
    fun `switching on without a shift is explained and sends no request that would be refused`() = runBlocking {
        val (server, device, duty) = setup(overview())
        val r = duty.setOnDuty(true) as DutyResult.Failed
        assertEquals(DutyProblemKind.NeedsShift, r.problem.kind)
        assertEquals(listOf("mine"), server.calls)
        assertFalse(duty.state.value.onDuty)
        assertFalse(device.running)
        assertEquals(DutyProblemKind.NeedsShift, duty.state.value.problem?.kind)
    }

    @Test
    fun `an offered shift can be accepted from the duty card and then started by the switch`() = runBlocking {
        val (server, device, duty) = setup(overview(shifts = listOf(DutyShift("s1", at(-5), at(240), "offered"))))
        val blocked = duty.setOnDuty(true) as DutyResult.Failed
        assertEquals("s1", blocked.problem.offeredShiftId)
        assertNull(duty.decideShift("s1", accept = true))
        assertEquals(DutyResult.Confirmed("on_duty"), duty.setOnDuty(true))
        assertTrue("start:s1" in server.calls)
        assertTrue(device.running)
    }

    @Test
    fun `a server refusal for a missing shift keeps the officer off duty`() = runBlocking {
        // The phone's view says duty without a shift is allowed, but the server's policy changed meanwhile.
        val (server, device, duty) = setup(overview(allowWithoutShift = true))
        server.failNext = ApiException(422, "shift_required", "Start an accepted shift to go on duty.")
        val r = duty.setOnDuty(true) as DutyResult.Failed
        assertEquals(DutyProblemKind.NeedsShift, r.problem.kind)
        assertEquals("Start an accepted shift to go on duty.", r.problem.message)
        assertFalse(duty.state.value.onDuty)
        assertFalse(device.running)
    }

    // ---------------------------------------------------------------- on duty → off duty
    @Test
    fun `switching off asks the server first and then stops the service`() = runBlocking {
        val (server, device, duty) = setup(overview(status = "on_duty"))
        duty.refresh()
        assertTrue(device.running)
        assertEquals(DutyResult.Confirmed("off_duty"), duty.setOnDuty(false, reason = "End of patrol"))
        assertEquals(listOf("mine", "setStatus:off_duty"), server.calls)
        assertEquals("off_duty", duty.state.value.status)
        assertFalse(device.running)
    }

    @Test
    fun `an active emergency keeps the officer on duty and the service running`() = runBlocking {
        val (server, device, duty) = setup(overview(status = "responding"))
        duty.refresh()
        server.failNext = ApiException(409, "open_assignments", "Resolve or hand over your active emergency before going off duty.")
        val r = duty.setOnDuty(false) as DutyResult.Failed
        assertEquals(DutyProblemKind.OpenAssignments, r.problem.kind)
        assertEquals("responding", duty.state.value.status)
        assertTrue(device.running)
    }

    // ---------------------------------------------------------------- failures and rollback
    @Test
    fun `an unauthorised change is reported as not allowed and changes nothing`() = runBlocking {
        val (server, device, duty) = setup(overview(status = "on_duty"))
        duty.refresh()
        server.failNext = ApiException(403, "forbidden", "Forbidden")
        val r = duty.setOnDuty(false) as DutyResult.Failed
        assertEquals(DutyProblemKind.NotAllowed, r.problem.kind)
        assertEquals(403, r.problem.httpStatus)
        assertTrue(duty.state.value.onDuty)
        assertEquals(listOf("on_duty"), device.applied)
    }

    @Test
    fun `a network failure keeps the last confirmed state and a later attempt recovers`() = runBlocking {
        val (server, device, duty) = setup(overview(status = "on_duty"))
        duty.refresh()
        server.failNext = ApiException(0, "network", "offline")
        val r = duty.setOnDuty(false) as DutyResult.Failed
        assertEquals(DutyProblemKind.Offline, r.problem.kind)
        assertTrue(r.problem.retryable)
        assertTrue(duty.state.value.onDuty) // the switch rolls back to the confirmed state
        assertTrue(device.running)
        assertEquals(DutyResult.Confirmed("off_duty"), duty.setOnDuty(false))
        assertNull(duty.state.value.problem)
        assertFalse(device.running)
    }

    @Test
    fun `an expired session is reported separately`() {
        assertEquals(DutyProblemKind.SessionExpired, DutyRules.describe(ApiException(401, "session_expired", "x")).kind)
        assertEquals(DutyProblemKind.Server, DutyRules.describe(ApiException(503, "unavailable", "x")).kind)
        assertEquals(DutyProblemKind.NotAllowed, DutyRules.describe(ApiException(409, "invalid_transition", "Cannot change duty status from stale to off duty.")).kind)
    }

    @Test
    fun `a started shift counts as on duty even if re-reading the status fails`() = runBlocking {
        val (server, device, duty) = setup(overview(shifts = listOf(DutyShift("s1", at(-5), at(240), "accepted"))))
        val original = server.current
        // First mine() (planning) succeeds; the re-read after the start fails.
        val wrapped = object : DutyGateway by server {
            var reads = 0
            override suspend fun mine(): DutyOverview {
                reads++
                if (reads > 1) throw ApiException(0, "network", "offline")
                return original
            }
        }
        val c = DutyController(wrapped, device, clock = { 0L })
        assertEquals(DutyResult.Confirmed("on_duty"), c.setOnDuty(true))
        assertTrue(device.running)
    }

    // ---------------------------------------------------------------- duplicate taps
    @Test
    fun `a second tap while a change is in flight is ignored and sends nothing`() = runBlocking {
        val (server, _, duty) = setup(overview(status = "on_duty"))
        duty.refresh()
        server.gate = CompletableDeferred()
        val first = async(start = CoroutineStart.UNDISPATCHED) { duty.setOnDuty(false) }
        assertTrue(duty.state.value.updating)
        assertEquals(false, duty.state.value.pendingOn)
        assertEquals(DutyResult.Ignored, duty.setOnDuty(false))
        assertEquals(DutyResult.Ignored, duty.setOnDuty(true))
        server.gate!!.complete(Unit)
        assertEquals(DutyResult.Confirmed("off_duty"), first.await())
        assertEquals(1, server.calls.count { it.startsWith("setStatus") })
        assertFalse(duty.state.value.updating)
    }

    // ---------------------------------------------------------------- restart, resume and reconciliation
    @Test
    fun `refresh makes the phone match the server when they disagree`() = runBlocking {
        // Cached "on duty" from before a restart, but the server ended duty meanwhile.
        val (_, device, duty) = setup(overview(status = "off_duty"))
        duty.refresh()
        assertEquals(listOf("off_duty"), device.applied)
        assertFalse(duty.state.value.onDuty)
    }

    @Test
    fun `a failed refresh keeps the last confirmed status instead of guessing`() = runBlocking {
        val (server, device, duty) = setup(overview(status = "on_duty"))
        duty.refresh()
        server.failMine = ApiException(0, "network", "offline")
        assertNull(duty.refresh())
        assertEquals("on_duty", duty.state.value.status)
        assertEquals(DutyProblemKind.Offline, duty.state.value.problem?.kind)
        assertEquals(listOf("on_duty"), device.applied)
        server.failMine = null
        duty.refresh()
        assertNull(duty.state.value.problem) // a connection problem clears once the server answers
    }

    @Test
    fun `a status the server reports by itself updates every screen and only restarts the service when asked`() = runBlocking {
        val (_, device, duty) = setup(overview(status = "on_duty"))
        duty.refresh()
        duty.onServerStatus("stale", applyToDevice = false) // heartbeat loop inside the service
        assertEquals("stale", duty.state.value.status)
        assertTrue(duty.state.value.onDuty)
        assertEquals(listOf("on_duty"), device.applied)
        duty.onServerStatus("off_duty", applyToDevice = true) // supervisor override seen by a screen
        assertFalse(duty.state.value.onDuty)
        assertFalse(device.running)
        yield()
    }

    // ---------------------------------------------------------------- planning rules
    @Test
    fun `shift windows use server time and the start grace period`() {
        val early = overview(shifts = listOf(DutyShift("s1", at(30), at(240), "accepted")))
        assertTrue(DutyRules.planOnDuty(early, DutyRules.serverNow(early, 0L)) is OnDutyPlan.Blocked)
        val inGrace = overview(shifts = listOf(DutyShift("s1", at(10), at(240), "accepted")))
        assertEquals(OnDutyPlan.StartShift("s1"), DutyRules.planOnDuty(inGrace, DutyRules.serverNow(inGrace, 0L)))
        val ended = overview(shifts = listOf(DutyShift("s1", at(-240), at(-1), "accepted")))
        assertTrue(DutyRules.planOnDuty(ended, DutyRules.serverNow(ended, 0L)) is OnDutyPlan.Blocked)
        assertEquals(OnDutyPlan.AlreadyOn, DutyRules.planOnDuty(overview(status = "stale"), 0L))
        assertEquals(OnDutyPlan.SetStatus, DutyRules.planOnDuty(overview(status = "unavailable"), 0L))
    }
}
