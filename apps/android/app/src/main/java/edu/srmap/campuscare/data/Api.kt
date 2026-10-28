package edu.srmap.campuscare.data

import java.net.URLEncoder
import java.util.UUID

private fun enc(v: String) = URLEncoder.encode(v, "UTF-8")
fun newIdempotencyKey(): String = UUID.randomUUID().toString()

/** Typed access to every CampusCare endpoint the app uses, grouped by feature. */
class Api(val client: ApiClient) {
    val auth = AuthApi(client)
    val me = MeApi(client)
    val content = ContentApi(client)
    val incidents = IncidentApi(client)
    val chat = ChatApi(client)
    val counselling = CounsellingApi(client)
    val safety = SafetyApi(client)
    val community = CommunityApi(client)
    val campusMap = CampusMapApi(client)
    val admin = AdminApi(client)
    val mobile = MobileApi(client)
    val duty = DutyApi(client)
}

class MobileApi(private val c: ApiClient) {
    suspend fun config(): MobileConfig = c.get("/mobile/config")
    suspend fun registerDevice(pushToken: String?, appVersion: String, versionCode: Int, deviceName: String): Ignored =
        c.post("/mobile/devices", mapOf("platform" to "android", "pushToken" to pushToken, "appVersion" to appVersion, "appVersionCode" to versionCode, "deviceName" to deviceName))
    suspend fun unregisterDevice(): Ignored = c.delete("/mobile/devices/current")
}

class AuthApi(private val c: ApiClient) {
    suspend fun login(email: String, password: String, mfaCode: String?, turnstile: String?): LoginResponse =
        c.post("/auth/login", mapOf("email" to email, "password" to password, "rememberMe" to true, "mfaCode" to mfaCode, "turnstileToken" to turnstile))

    /** Second step: exchanges the challenge from [login] and a 6-digit code for a session (no password re-sent). */
    suspend fun mfaChallenge(challengeToken: String, code: String): LoginResponse =
        c.post("/auth/mfa/challenge", mapOf("challengeToken" to challengeToken, "code" to code))

    suspend fun google(idToken: String, nonce: String?, rememberMe: Boolean = true): LoginResponse = c.post("/auth/google/mobile", mapOf("idToken" to idToken, "nonce" to nonce, "rememberMe" to rememberMe))

    suspend fun register(body: Map<String, Any?>): RegisterResponse = c.post("/auth/register", body)
    suspend fun verifyEmail(token: String): VerifyResult = c.post("/auth/verify-email", mapOf("token" to token))
    /** Read-only: never consumes the token (only [verifyEmail] does, after the person taps Verify). */
    suspend fun checkVerifyEmail(token: String): VerifyCheck = c.post("/auth/verify-email/check", mapOf("token" to token))
    suspend fun resendVerification(email: String, turnstile: String?): MessageResponse = c.post("/auth/resend-verification", mapOf("email" to email, "turnstileToken" to turnstile))
    suspend fun forgotPassword(email: String, turnstile: String?): MessageResponse = c.post("/auth/forgot-password", mapOf("email" to email, "turnstileToken" to turnstile))
    suspend fun checkReset(token: String): ValidResponse = c.post("/auth/reset-password/check", mapOf("token" to token))
    suspend fun resetPassword(token: String, password: String, confirm: String, turnstile: String?): Ignored =
        c.post("/auth/reset-password", mapOf("token" to token, "password" to password, "confirmPassword" to confirm, "turnstileToken" to turnstile))
    suspend fun acceptInvite(token: String, password: String, confirm: String): Ignored =
        c.post("/auth/accept-invite", mapOf("token" to token, "password" to password, "confirmPassword" to confirm))

    suspend fun me(): MeResponse = c.get("/auth/me")
    suspend fun logout(): Ignored = c.post("/auth/logout")
    suspend fun logoutAll(): Ignored = c.post("/auth/logout-all")
    suspend fun updateProfile(body: Map<String, Any?>): MeUser = c.patch("/auth/me", body)
    suspend fun updatePrivacy(showNameInCommunity: Boolean?, allowEmail: Boolean?): MeUser =
        c.patch("/auth/me/privacy", mapOf("showNameInCommunity" to showNameInCommunity, "allowEmailNotifications" to allowEmail).filterValues { it != null })
    suspend fun changePassword(current: String, password: String, confirm: String): Ignored =
        c.post("/auth/change-password", mapOf("currentPassword" to current, "password" to password, "confirmPassword" to confirm))
    suspend fun reauth(password: String?, mfaCode: String?): Ignored = c.post("/auth/reauth", mapOf("password" to password, "mfaCode" to mfaCode))
    suspend fun sessions(): List<DeviceSession> = c.get("/auth/sessions")
    suspend fun revokeSession(id: String): Ignored = c.delete("/auth/sessions/$id")
    suspend fun mfaSetup(): MfaSetup = c.post("/auth/mfa/setup")
    suspend fun mfaConfirm(code: String): Ignored = c.post("/auth/mfa/confirm", mapOf("code" to code))
    suspend fun mfaVerify(code: String): Ignored = c.post("/auth/mfa/verify", mapOf("code" to code))
    suspend fun mfaDisable(code: String): Ignored = c.post("/auth/mfa/disable", mapOf("code" to code))
    suspend fun googleStatus(): GoogleStatus = c.get("/auth/google/status")
    suspend fun realtimeTicket(): RealtimeTicket = c.post("/auth/realtime-ticket")
}

@kotlinx.serialization.Serializable
data class MeUser(val user: User)

@kotlinx.serialization.Serializable
data class RealtimeTicket(val ticket: String, val url: String = "", val path: String = "/realtime")

class MeApi(private val c: ApiClient) {
    suspend fun safetyCard(): SafetyCard = c.get("/me/safety-card")
    suspend fun saveSafetyCard(card: SafetyCard): SafetyCard = c.put(
        "/me/safety-card",
        mapOf(
            "bloodGroup" to card.bloodGroup, "allergies" to card.allergies, "medicalConditions" to card.medicalConditions, "medications" to card.medications,
            "accessibilityNeeds" to card.accessibilityNeeds, "emergencyNote" to card.emergencyNote, "shareWithResponders" to card.shareWithResponders,
        ),
    )
    suspend fun deleteSafetyCard(): Ignored = c.delete("/me/safety-card")
    suspend fun notificationPrefs(): Map<String, ChannelPrefs> = c.get("/me/notification-prefs")
    suspend fun saveNotificationPrefs(prefs: Map<String, ChannelPrefs>): Map<String, ChannelPrefs> =
        c.put("/me/notification-prefs", prefs.mapValues { mapOf("inApp" to it.value.inApp, "email" to it.value.email, "push" to it.value.push) })
    suspend fun privacy(): PrivacyDashboard = c.get("/me/privacy")
    suspend fun profile(): ProfileOverview = c.get("/me/profile")
    suspend fun avatar(): ByteArray = c.download("/me/avatar")
    suspend fun uploadAvatar(jpeg: ByteArray): MeUser = c.uploadPut("/me/avatar", jpeg, "avatar.jpg", "image/jpeg")
    suspend fun removeAvatar(): MeUser = c.delete("/me/avatar")
    suspend fun export(): ByteArray = c.download("/me/export")
    suspend fun requestData(type: String, reason: String?): IdResponse = c.post("/me/data-requests", mapOf("type" to type, "reason" to reason))
}

class ContentApi(private val c: ApiClient) {
    suspend fun dashboard(): StudentDashboard = c.get("/dashboard/student")
    suspend fun notifications(): NotificationPage = c.get("/notifications?limit=100")
    suspend fun markRead(id: String): Ignored = c.post("/notifications/$id/read")
    suspend fun markAllRead(): Ignored = c.post("/notifications/read-all")
    suspend fun announcements(): List<Announcement> = c.get("/announcements")
    suspend fun contacts(): List<Contact> = c.get("/contacts")
    suspend fun committees(): List<Committee> = c.get("/committees")
    suspend fun training(): List<TrainingModuleSummary> = c.get("/training")
    suspend fun module(id: String): TrainingModule = c.get("/training/$id")
    suspend fun attempt(id: String, answers: List<Int>): QuizResult = c.post("/training/$id/attempt", mapOf("answers" to answers))
    suspend fun certificate(id: String): Certificate = c.get("/training/certificates/${enc(id)}")
}

class IncidentApi(private val c: ApiClient) {
    suspend fun suggest(text: String): CategorySuggestion = c.post("/incidents/suggest-category", mapOf("text" to text))
    suspend fun uploadEvidence(bytes: ByteArray, name: String, mime: String, anonymous: Boolean): Attachment =
        c.upload("/incidents/evidence", bytes, name, mime, mapOf("anonymous" to anonymous.toString()))
    suspend fun create(body: Map<String, Any?>): CreatedCase = c.post("/incidents", body)
    suspend fun list(
        scope: String, status: String? = null, category: String? = null, q: String? = null, mine: Boolean = false, page: Int = 1,
        unassigned: Boolean = false, overdue: Boolean = false,
    ): Page<IncidentListItem> {
        val params = buildList {
            add("scope=$scope"); add("page=$page"); add("limit=30")
            if (unassigned) add("unassigned=true")
            if (overdue) add("overdue=true")
            status?.let { add("status=${enc(it)}") }
            category?.let { add("category=${enc(it)}") }
            q?.takeIf { it.isNotBlank() }?.let { add("q=${enc(it)}") }
            if (mine) add("mine=true")
        }.joinToString("&")
        return c.get("/incidents?$params")
    }
    suspend fun detail(id: String): IncidentDetail = c.get("/incidents/$id")
    suspend fun changeStatus(id: String, status: String, note: String?, reason: String?): Ignored =
        c.patch("/incidents/$id/status", mapOf("status" to status, "studentVisibleNote" to note, "reason" to reason).filterValues { it != null })
    suspend fun assign(id: String, committeeId: String, assigneeId: String?, reason: String?): Ignored =
        c.post("/incidents/$id/assign", mapOf("committeeId" to committeeId, "assigneeId" to assigneeId, "reason" to reason))
    suspend fun assignableStaff(id: String, committeeId: String? = null): List<StaffMember> =
        c.get("/incidents/$id/assignable-staff" + (committeeId?.let { "?committeeId=$it" } ?: ""))
    suspend fun notes(id: String): List<InternalNote> = c.get("/incidents/$id/notes")
    suspend fun addNote(id: String, body: String): InternalNote = c.post("/incidents/$id/notes", mapOf("body" to body))
    suspend fun messages(id: String, before: String? = null): MessagePage = c.get("/incidents/$id/messages" + (before?.let { "?before=$it" } ?: ""))
    suspend fun send(id: String, body: String, attachmentIds: List<String>, clientId: String): PostedMessage =
        c.post("/incidents/$id/messages", mapOf("body" to body, "attachmentIds" to attachmentIds, "clientMessageId" to clientId))
    suspend fun uploadAttachment(id: String, bytes: ByteArray, name: String, mime: String): Attachment = c.upload("/incidents/$id/attachments", bytes, name, mime)
    suspend fun markRead(id: String, upTo: String): Ignored = c.post("/incidents/$id/read-receipts", mapOf("upToMessageId" to upTo))
    suspend fun readState(id: String): ReadState = c.get("/incidents/$id/read-state")
    suspend fun withdraw(id: String, reason: String): Incident = c.post("/incidents/$id/withdraw", mapOf("reason" to reason))
    suspend fun reopen(id: String, reason: String): Incident = c.post("/incidents/$id/reopen", mapOf("reason" to reason))
    fun fileUrl(fileId: String) = c.url("/incidents/files/$fileId")
}

class ChatApi(private val c: ApiClient) {
    suspend fun overview(): ChatOverview = c.get("/chat/channels")
    suspend fun openService(serviceId: String): IdResponse = c.post("/chat/services/$serviceId/open")
    suspend fun channel(id: String): ChannelDetail = c.get("/chat/channels/$id")
    suspend fun messages(id: String, before: String? = null, q: String? = null): MessagePage {
        val params = listOfNotNull(before?.let { "before=$it" }, q?.takeIf { it.isNotBlank() }?.let { "q=${enc(it)}" }).joinToString("&")
        return c.get("/chat/channels/$id/messages" + if (params.isEmpty()) "" else "?$params")
    }
    suspend fun send(id: String, body: String, attachmentIds: List<String>, clientId: String, turnstile: String? = null): PostedMessage =
        c.post("/chat/channels/$id/messages", mapOf("body" to body, "attachmentIds" to attachmentIds, "clientMessageId" to clientId, "turnstileToken" to turnstile))
    suspend fun upload(id: String, bytes: ByteArray, name: String, mime: String): Attachment = c.upload("/chat/channels/$id/attachments", bytes, name, mime)
    suspend fun close(id: String): Ignored = c.post("/chat/channels/$id/close")
    suspend fun report(messageId: String, reason: String): Ignored = c.post("/chat/messages/$messageId/report", mapOf("reason" to reason))
    suspend fun blockSender(messageId: String): Ignored = c.post("/chat/messages/$messageId/block-sender")
    suspend fun hide(messageId: String): Ignored = c.post("/chat/messages/$messageId/hide")
    suspend fun moderationReports(status: String): List<ModerationReport> = c.get("/chat/moderation/reports?status=$status")
    suspend fun moderate(reportId: String, action: String): Ignored = c.post("/chat/moderation/reports/$reportId", mapOf("action" to action))
    fun fileUrl(fileId: String) = c.url("/chat/files/$fileId")
}

class CounsellingApi(private val c: ApiClient) {
    suspend fun counsellors(): List<Counsellor> = c.get("/counselling/counsellors")
    suspend fun slots(counsellorId: String): SlotList = c.get("/counselling/counsellors/$counsellorId/slots")
    suspend fun appointments(upcoming: Boolean = false): List<Appointment> = c.get("/counselling/appointments" + if (upcoming) "?upcoming=true" else "")
    suspend fun request(counsellorId: String, startAt: String, mode: String, reason: String?): IdResponse =
        c.post("/counselling/appointments", mapOf("counsellorId" to counsellorId, "startAt" to startAt, "mode" to mode, "reason" to reason, "idempotencyKey" to newIdempotencyKey()))
    suspend fun update(id: String, status: String? = null, reason: String? = null, startAt: String? = null, meetingLink: String? = null): Appointment =
        c.patch("/counselling/appointments/$id", mapOf("status" to status, "reason" to reason, "startAt" to startAt, "meetingLink" to meetingLink).filterValues { it != null })
    suspend fun notes(id: String): List<CounsellingNote> = c.get("/counselling/appointments/$id/notes")
    suspend fun addNote(id: String, body: String, supportPlan: String?, followUpAt: String?): CounsellingNote =
        c.post("/counselling/appointments/$id/notes", mapOf("body" to body, "supportPlan" to supportPlan, "followUpAt" to followUpAt).filterValues { it != null })
    suspend fun availability(): Availability = c.get("/counselling/availability")
    suspend fun saveAvailability(a: Availability): Ignored = c.put(
        "/counselling/availability",
        mapOf(
            "weekly" to a.weekly.map { mapOf("weekday" to it.weekday, "start" to it.start, "end" to it.end) },
            "slotMinutes" to a.slotMinutes, "timezone" to a.timezone, "blockedDates" to a.blockedDates,
            "acceptingRequests" to a.acceptingRequests, "title" to a.title, "bio" to a.bio,
            "maxDailySessions" to a.maxDailySessions, "specializations" to a.specializations, "languages" to a.languages,
        ),
    )
    suspend fun myStudents(): List<CounsellorStudent> = c.get("/counselling/my-students")
    suspend fun stats(): CounsellingStats = c.get("/counselling/stats")
}

class SafetyApi(private val c: ApiClient) {
    /**
     * Raises an SOS. With [countdownMode] "server" the alert is stored as "pending" and nobody is
     * notified until its dispatchAt (cancel/dispatch-now act on it); without it the alert is dispatched at once.
     * The same [key] must be reused for retries so a dropped connection never creates a second alert.
     */
    suspend fun raiseSos(
        key: String,
        lat: Double?,
        lng: Double?,
        accuracy: Double?,
        unavailableReason: String?,
        notifyTrusted: Boolean,
        countdownMode: String? = null,
        locationAgeSeconds: Double? = null,
        batteryLevel: Int? = null,
        deviceInfo: Map<String, String>? = null,
        isCachedFix: Boolean? = null,
        note: String? = null,
        triggerSource: String? = null,
    ): SosAlert = c.post(
        "/safety/sos",
        mapOf(
            "idempotencyKey" to key,
            "latitude" to lat,
            "longitude" to lng,
            "accuracyMeters" to accuracy,
            "locationAgeSeconds" to locationAgeSeconds?.takeIf { lat != null && lng != null },
            "locationUnavailableReason" to unavailableReason,
            "notifyTrustedContacts" to notifyTrusted,
            "countdownMode" to countdownMode,
            "batteryLevel" to batteryLevel,
            "deviceInfo" to deviceInfo,
            "isCachedFix" to isCachedFix,
            "note" to note,
            "triggerSource" to triggerSource,
        ).filterValues { it != null },
    )

    suspend fun uploadSosEvidence(id: String, bytes: ByteArray, name: String, mime: String): Attachment =
        c.upload("/safety/sos/$id/evidence", bytes, name, mime)
    suspend fun mySos(): List<SosAlert> = c.get("/safety/sos/mine")
    suspend fun sos(id: String): SosAlert = c.get("/safety/sos/$id")
    suspend fun cancelSos(id: String, reason: String?): SosAlert = c.post("/safety/sos/$id/cancel", mapOf("reason" to reason).filterValues { it != null })
    /** The countdown's Cancel: 409 already_dispatched instead of turning into a false-alarm report. */
    suspend fun cancelCountdown(id: String): SosAlert = c.post("/safety/sos/$id/cancel", mapOf("onlyIfPending" to true))
    /** Records a countdown cancelled on the phone (and cancels its alert if that request did reach the server). */
    suspend fun countdownCancelled(eventId: String, source: String, triggeredAt: String, cancelledAt: String): Ignored =
        c.post("/safety/sos/countdown-cancelled", mapOf("eventId" to eventId, "triggerSource" to source, "triggeredAt" to triggeredAt, "cancelledAt" to cancelledAt))
    /** Skips the rest of a server-side countdown ("Send now"). */
    suspend fun dispatchNow(id: String): SosAlert = c.post("/safety/sos/$id/dispatch-now")

    suspend fun responderAlerts(all: Boolean = false): List<SosAlert> = c.get("/safety/responder/alerts" + if (all) "?all=true" else "")
    suspend fun responderAlert(id: String): SosAlert = c.get("/safety/responder/alerts/$id")
    /** Acknowledges an alert (own offer or an open alert). 409 already_handled when someone else got there first. */
    suspend fun acknowledge(id: String): SosAlert = c.post("/emergency-alerts/$id/acknowledge")
    /** Declines this responder's dispatch offer so it moves on at once. 409 no_offer when there is nothing to decline. */
    suspend fun declineAssignment(id: String, reason: String): Ignored = c.post("/emergency-alerts/$id/decline", mapOf("reason" to reason))
    suspend fun enRoute(id: String): SosAlert = c.post("/safety/responder/alerts/$id/en-route")
    suspend fun addSosNote(id: String, note: String): SosAlert = c.post("/safety/responder/alerts/$id/notes", mapOf("note" to note))
    suspend fun assignSos(id: String, userId: String): SosAlert = c.post("/safety/responder/alerts/$id/assign", mapOf("userId" to userId))
    suspend fun resolveSos(id: String, outcome: String, note: String?): SosAlert = c.post("/safety/responder/alerts/$id/resolve", mapOf("outcome" to outcome, "note" to note))
    suspend fun responderTeam(): List<ResponderTeamMember> = c.get("/safety/responder/team")
    suspend fun sharedLocations(): List<SharedLocation> = c.get("/safety/responder/locations")
    suspend fun overdueWalks(): List<OverdueWalk> = c.get("/safety/responder/safe-walks")

    suspend fun trustedContacts(): List<TrustedContact> = c.get("/safety/trusted-contacts")
    suspend fun addTrustedContact(name: String, email: String, phone: String?, relationship: String?, shareLocation: Boolean): StatusResponse =
        c.post("/safety/trusted-contacts", mapOf("name" to name, "email" to email, "phone" to phone, "relationship" to relationship, "shareLocation" to shareLocation).filterValues { it != null })
    suspend fun removeTrustedContact(id: String): Ignored = c.delete("/safety/trusted-contacts/$id")

    suspend fun safeWalks(): List<SafeWalk> = c.get("/safety/safe-walk")
    suspend fun startSafeWalk(destination: String, expectedArrivalAt: String, contactIds: List<String>): SafeWalk =
        c.post("/safety/safe-walk", mapOf("destination" to destination, "expectedArrivalAt" to expectedArrivalAt, "trustedContactIds" to contactIds))
    suspend fun safeWalkAction(id: String, action: String, minutes: Int? = null): SafeWalk =
        c.post("/safety/safe-walk/$id/$action", mapOf("minutes" to minutes).filterValues { it != null })

    suspend fun currentShare(): LocationShareInfo? = c.get("/safety/location-share")
    suspend fun startShare(minutes: Int, audience: String, lat: Double, lng: Double, accuracy: Double?, locationAgeSeconds: Double? = null): LocationShareInfo = c.post(
        "/safety/location-share",
        mapOf("durationMinutes" to minutes, "audience" to audience, "latitude" to lat, "longitude" to lng, "accuracyMeters" to accuracy, "locationAgeSeconds" to locationAgeSeconds).filterValues { it != null },
    )
    /** [locationAgeSeconds] is the age of the fix on the device; the server derives the fix time from its own clock. */
    suspend fun updateShare(id: String, lat: Double, lng: Double, accuracy: Double?, locationAgeSeconds: Double? = null): Ignored = c.patch(
        "/safety/location-share/$id",
        mapOf("latitude" to lat, "longitude" to lng, "accuracyMeters" to accuracy, "locationAgeSeconds" to locationAgeSeconds).filterValues { it != null },
    )
    suspend fun stopShare(id: String): Ignored = c.post("/safety/location-share/$id/stop")

    suspend fun campusAlerts(): List<CampusAlertSummary> = c.get("/safety/campus-alerts")
    suspend fun checkIn(alertId: String, status: String, note: String?): Ignored = c.post("/safety/campus-alerts/$alertId/check-in", mapOf("status" to status, "note" to note))
}

/** Responder self-service: server-driven duty status, heartbeats, shifts and location consent. */
class DutyApi(private val c: ApiClient) {
    suspend fun mine(): DutyOverview = c.get("/responders/me/duty")

    /** on_duty | on_break | busy | unavailable | off_duty. Errors: 409 invalid_transition / open_assignments, 422 shift_required. */
    suspend fun setStatus(status: String, reason: String? = null, shiftId: String? = null): DutyAvailability =
        c.patch("/responders/me/duty-status", mapOf("status" to status, "reason" to reason, "shiftId" to shiftId).filterValues { it != null })

    /** Coordinates are sent only as a pair. [locationAgeSeconds] is the fix's age, never a device timestamp. 409 not_on_duty when duty has ended. */
    suspend fun heartbeat(lat: Double?, lng: Double?, accuracy: Double?, locationAgeSeconds: Double?, batteryPercent: Int?, appVersion: String?): HeartbeatResult {
        val withLocation = lat != null && lng != null
        return c.post(
            "/responders/me/heartbeat",
            mapOf(
                "latitude" to lat.takeIf { withLocation }, "longitude" to lng.takeIf { withLocation },
                "accuracyMeters" to accuracy.takeIf { withLocation }, "locationAgeSeconds" to locationAgeSeconds.takeIf { withLocation },
                "batteryPercent" to batteryPercent, "appVersion" to appVersion,
            ).filterValues { it != null },
        )
    }

    /** Explicit opt-in; withdrawing deletes the stored position on the server. */
    suspend fun setLocationConsent(share: Boolean): Ignored = c.patch("/responders/me/location-consent", mapOf("shareLocation" to share))
    suspend fun decideShift(id: String, decision: String, reason: String? = null): StatusResponse =
        c.post("/responders/me/shifts/$id/decision", mapOf("decision" to decision, "reason" to reason).filterValues { it != null })
    /** Puts the responder on duty. Errors: 422 too_early / shift_ended, 409 invalid_state. */
    suspend fun startShift(id: String): StatusResponse = c.post("/responders/me/shifts/$id/start")
    suspend fun endShift(id: String, reason: String? = null): StatusResponse =
        c.post("/responders/me/shifts/$id/end", mapOf("reason" to reason).filterValues { it != null })
}

class CommunityApi(private val c: ApiClient) {
    suspend fun map(): SafetyMap = c.get("/community/map")
    suspend fun reportHazard(category: String, description: String, locationLabel: String, lat: Double?, lng: Double?, anonymous: Boolean): StatusResponse = c.post(
        "/community/hazards",
        mapOf("category" to category, "description" to description, "locationLabel" to locationLabel, "latitude" to lat, "longitude" to lng, "anonymous" to anonymous).filterValues { it != null },
    )
    suspend fun myHazards(): List<Hazard> = c.get("/community/hazards/mine")
    suspend fun manageHazards(status: String?): List<Hazard> = c.get("/community/manage/hazards" + (status?.let { "?status=$it" } ?: ""))
    suspend fun reviewHazard(id: String, status: String, note: String?): Ignored = c.patch("/community/manage/hazards/$id", mapOf("status" to status, "publicNote" to note))

    suspend fun lostFound(type: String?, q: String?, mine: Boolean = false): LostFoundPage {
        val params = listOfNotNull(type?.let { "type=$it" }, q?.takeIf { it.isNotBlank() }?.let { "q=${enc(it)}" }, if (mine) "mine=true" else null).joinToString("&")
        return c.get("/community/lost-found" + if (params.isEmpty()) "" else "?$params")
    }
    suspend fun lostFoundItem(id: String): LostFoundItem = c.get("/community/lost-found/$id")
    suspend fun uploadLostFoundPhoto(bytes: ByteArray, name: String, mime: String): Attachment = c.upload("/community/lost-found/photos", bytes, name, mime)
    suspend fun createLostFound(body: Map<String, Any?>): LostFoundItem = c.post("/community/lost-found", body)
    suspend fun claim(id: String, message: String): StatusResponse = c.post("/community/lost-found/$id/claims", mapOf("message" to message))
    suspend fun decideClaim(claimId: String, decision: String): StatusResponse = c.post("/community/lost-found/claims/$claimId/decision", mapOf("decision" to decision))
    suspend fun setLostFoundStatus(id: String, status: String, reason: String? = null): Ignored = c.post("/community/lost-found/$id/status", mapOf("status" to status, "reason" to reason))
    fun lostFoundPhotoUrl(id: String) = c.url("/community/lost-found/photos/$id")
    suspend fun manageLostFound(): List<LostFoundItem> = c.get("/community/manage/lost-found")

    suspend fun suggestions(): SuggestionsResponse = c.get("/community/suggestions")
    suspend fun suggest(category: String, text: String, anonymous: Boolean): StatusResponse = c.post("/community/suggestions", mapOf("category" to category, "text" to text, "anonymous" to anonymous))
    suspend fun manageSuggestions(status: String?): List<Suggestion> = c.get("/community/manage/suggestions" + (status?.let { "?status=$it" } ?: ""))
    suspend fun reviewSuggestion(id: String, status: String, response: String?): Ignored = c.patch("/community/manage/suggestions/$id", mapOf("status" to status, "response" to response))
}

class AdminApi(private val c: ApiClient) {
    suspend fun overview(): AdminOverview = c.get("/admin/overview")
    suspend fun campusAlerts(): List<AdminCampusAlert> = c.get("/admin/campus-alerts")
    suspend fun publishAlert(title: String, body: String, severity: String, requestCheckIn: Boolean): AdminCampusAlert =
        c.post("/admin/campus-alerts", mapOf("title" to title, "body" to body, "severity" to severity, "requestCheckIn" to requestCheckIn, "audience" to mapOf("all" to true, "hostels" to emptyList<String>(), "departments" to emptyList<String>())))
    suspend fun endAlert(id: String): Ignored = c.delete("/admin/campus-alerts/$id")
    suspend fun announcements(): List<Announcement> = c.get("/admin/announcements")
    suspend fun createAnnouncement(body: Map<String, Any?>): Ignored = c.post("/admin/announcements", body)
    suspend fun deleteAnnouncement(id: String): Ignored = c.delete("/admin/announcements/$id")
    suspend fun users(q: String?, role: String?): Page<AdminUser> {
        val params = listOfNotNull(q?.takeIf { it.isNotBlank() }?.let { "q=${enc(it)}" }, role?.let { "role=$it" }, "limit=50").joinToString("&")
        return c.get("/admin/users?$params")
    }
    suspend fun invite(fullName: String, email: String, role: String, department: String?): Ignored =
        c.post("/admin/users/invite", mapOf("fullName" to fullName, "email" to email, "role" to role, "department" to department, "committeeIds" to emptyList<String>()).filterValues { it != null })
    suspend fun committees(): List<Committee> = c.get("/admin/committees")
}


class CampusMapApi(private val c: ApiClient) {
    suspend fun data(campus: String? = null): CampusMapData =
        c.get("/campus-map/data" + (campus?.let { "?campus=$it" } ?: ""))

    suspend fun buildings(q: String? = null, category: String? = null): BuildingsResponse {
        val params = listOfNotNull(
            q?.takeIf { it.isNotBlank() }?.let { "q=${enc(it)}" },
            category?.takeIf { it != "all" }?.let { "category=$it" },
        ).joinToString("&")
        return c.get("/campus-map/buildings" + if (params.isEmpty()) "" else "?$params")
    }

    suspend fun building(id: String): CampusBuildingItem =
        c.get("/campus-map/buildings/$id")

    suspend fun route(
        originLat: Double,
        originLng: Double,
        destLat: Double? = null,
        destLng: Double? = null,
        buildingId: String? = null,
        mode: String = "walking",
    ): RouteCalculationResponse = c.post(
        "/campus-map/route",
        mapOf(
            "origin" to mapOf("latitude" to originLat, "longitude" to originLng),
            "destination" to mapOf("latitude" to destLat, "longitude" to destLng, "buildingId" to buildingId).filterValues { it != null },
            "mode" to mode,
        ),
    )

    suspend fun emergencyLocations(): EmergencyLocationsResponse =
        c.get("/campus-map/emergency-locations")

    suspend fun reportIssue(
        reportType: String,
        locationLabel: String,
        description: String,
        lat: Double? = null,
        lng: Double? = null,
    ): StatusResponse = c.post(
        "/campus-map/reports",
        mapOf(
            "reportType" to reportType,
            "locationLabel" to locationLabel,
            "description" to description,
            "latitude" to lat,
            "longitude" to lng,
        ).filterValues { it != null },
    )

    suspend fun myReports(): List<MapReportItem> =
        c.get("/campus-map/reports/mine")
}
