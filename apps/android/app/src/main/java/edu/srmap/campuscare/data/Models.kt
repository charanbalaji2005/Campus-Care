package edu.srmap.campuscare.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

// All models mirror the CampusCare API responses. Unknown fields are ignored and missing ones fall back
// to defaults, so an older app keeps working when the server adds data.

// ------------------------------------------------------------------ auth & account
@Serializable
data class Membership(val committeeId: String = "", val position: String = "member")

@Serializable
data class Privacy(val showNameInCommunity: Boolean = true, val allowEmailNotifications: Boolean = true)

@Serializable
data class User(
    val id: String,
    val fullName: String,
    val email: String,
    val emailVerified: Boolean = false,
    val role: String = "student",
    val permissions: List<String> = emptyList(),
    val accountStatus: String = "active",
    val studentId: String? = null,
    val department: String? = null,
    val academicYear: Int? = null,
    val phone: String? = null,
    val hostel: String? = null,
    val mfaEnabled: Boolean = false,
    val committeeMemberships: List<Membership> = emptyList(),
    val privacy: Privacy? = null,
    /** Student course/programme and class section. */
    val program: String? = null,
    val section: String? = null,
    val preferredLanguage: String? = null,
    /** Staff job title; counsellor qualifications and years of experience. */
    val designation: String? = null,
    val qualifications: String? = null,
    val experienceYears: Int? = null,
    /** Set while a profile photo exists; changes whenever the photo is replaced. */
    val avatarUpdatedAt: String? = null,
    /** Verified identifiers and assignments, managed by administrators (read-only here). */
    val staffId: String? = null,
    val managedCampuses: List<String> = emptyList(),
    val campusZone: String? = null,
    val dutyZone: String? = null,
    val lastLoginAt: String? = null,
    val createdAt: String? = null,
) {
    val firstName: String get() = fullName.substringBefore(' ')
    val isStudent: Boolean get() = role == "student"
}

// ------------------------------------------------------------------ profile overview (GET /me/profile)
@Serializable
data class ProfileAccount(
    val emailVerified: Boolean = false,
    val mfaEnabled: Boolean = false,
    val mfaRequired: Boolean = false,
    val activeSessions: Int = 0,
    val googleLinked: Boolean = false,
    val lastLoginAt: String? = null,
    val passwordChangedAt: String? = null,
    val memberSince: String? = null,
)

@Serializable
data class ProfileNextAppointment(val startAt: String? = null, val mode: String? = null, val status: String? = null)

@Serializable
data class StudentProfileSummary(
    val upcomingAppointments: Int = 0,
    val nextAppointment: ProfileNextAppointment? = null,
    val trustedContacts: Int = 0,
    val safetyCardSet: Boolean = false,
    val safetyCardShared: Boolean = false,
)

@Serializable
data class CounsellorProfileSummary(
    val onDuty: Boolean = false,
    val title: String = "Counsellor",
    val bio: String = "",
    val campus: String = "main",
    val specializations: List<String> = emptyList(),
    val languages: List<String> = emptyList(),
    val supportedModes: List<String> = emptyList(),
    val slotMinutes: Int = 50,
    val maxDailySessions: Int = 10,
    val workingDays: List<Int> = emptyList(),
    val upcomingBlockedDates: List<String> = emptyList(),
    val upcomingAppointments: Int = 0,
    val pendingRequests: Int = 0,
    val sessionsNext24h: Int = 0,
    val medianResponseHours: Double? = null,
    val decidedLast30Days: Int = 0,
)

@Serializable
data class ProfileShift(val startAt: String? = null, val endAt: String? = null, val status: String? = null, val zone: String? = null, val campus: String? = null)

@Serializable
data class ProfileIncidentRef(val id: String, val alertNumber: String? = null, val status: String = "", val createdAt: String? = null)

@Serializable
data class OfficerProfileSummary(
    val dutyStatus: String = "off_duty",
    val statusChangedAt: String? = null,
    val campus: String = "main",
    val zone: String? = null,
    val responsibilities: List<String> = emptyList(),
    val skills: List<String> = emptyList(),
    val locationConsent: Boolean = false,
    val lastHeartbeatAt: String? = null,
    val shift: ProfileShift? = null,
    val activeIncidents: List<ProfileIncidentRef> = emptyList(),
)

@Serializable
data class ProfileActivity(val action: String, val at: String? = null, val targetType: String? = null, val outcome: String? = null)

@Serializable
data class AdminProfileSummary(
    /** campus | system */
    val scope: String = "campus",
    val managedCampuses: List<String> = emptyList(),
    val campusZone: String? = null,
    val permissions: List<String> = emptyList(),
    val extraPermissions: List<String> = emptyList(),
    val recentActivity: List<ProfileActivity> = emptyList(),
    val securityActivity: List<ProfileActivity> = emptyList(),
)

@Serializable
data class ProfileOverview(
    val account: ProfileAccount = ProfileAccount(),
    val student: StudentProfileSummary? = null,
    val counsellor: CounsellorProfileSummary? = null,
    val officer: OfficerProfileSummary? = null,
    val admin: AdminProfileSummary? = null,
)

@Serializable
data class LoginResponse(
    val user: User? = null,
    val sessionToken: String? = null,
    val mfaRequired: Boolean = false,
    /** Single-use second-step ticket issued after the password (and Turnstile) check passed. */
    val challengeToken: String? = null,
    val needsMfaSetup: Boolean = false,
    val needsStudentId: Boolean = false,
    val created: Boolean = false,
)

@Serializable
data class SessionInfo(val mfaVerified: Boolean = false, val method: String = "password", val expiresAt: String? = null)

@Serializable
data class MeResponse(val user: User, val session: SessionInfo = SessionInfo(), val mfaRequired: Boolean = false, val homePath: String = "/")

@Serializable
data class RegisterResponse(val requiresVerification: Boolean = true, val email: String = "")

@Serializable
data class MessageResponse(
    val message: String = "",
    val ok: Boolean = true,
    /** Account-email endpoints: seconds before the same address may ask again (drives the cooldown). */
    val retryAfterSeconds: Int = 0,
    val expiresInMinutes: Int? = null,
    val expiresInHours: Int? = null,
)

@Serializable
data class VerifyResult(val result: String = "")

@Serializable
data class ValidResponse(val valid: Boolean = false, /** valid | expired | used | invalid */ val state: String? = null)

/** Read-only state of a verification link: valid | expired | invalid | already_verified. */
@Serializable
data class VerifyCheck(val state: String = "")

@Serializable
data class MfaSetup(val qrDataUrl: String = "", val secret: String = "")

@Serializable
data class DeviceSession(val id: String, val current: Boolean = false, val createdAt: String? = null, val lastSeenAt: String? = null, val userAgent: String? = null, val method: String = "password", val client: String = "web", val deviceName: String? = null)

@Serializable
data class GoogleStatus(val linked: Boolean = false)

// ------------------------------------------------------------------ remote configuration (managed on the Super Admin website)
@Serializable
data class TurnstileForms(
    val register: Boolean = true,
    val login: Boolean = true,
    val forgotPassword: Boolean = true,
    val resetPassword: Boolean = true,
    val resendVerification: Boolean = true,
    val incidentSubmit: Boolean = true,
    val communityPost: Boolean = false,
)

@Serializable
data class TurnstileConfig(val enabled: Boolean = false, val siteKey: String? = null, val forms: TurnstileForms = TurnstileForms())

@Serializable
data class MediaPolicy(val images: Boolean = false, val videos: Boolean = false)

@Serializable
data class SosPublic(
    val enabled: Boolean = true,
    val countdownSeconds: Int = 10,
    val allowCancelAfterSend: Boolean = true,
    /** Quick Settings tile / home-screen shortcut start the countdown straight away (otherwise they only open SOS). */
    val quickTriggerEnabled: Boolean = true,
    val quickTriggerMessage: String = "An SOS will be sent to Campus Security when the countdown ends. Tap Cancel if this was a mistake.",
)

@Serializable
data class MapSettings(val centerLatitude: Double = 16.4636, val centerLongitude: Double = 80.5074, val zoom: Double = 16.0, val heatmapMinCount: Int = 5, val heatmapDays: Int = 90)

@Serializable
data class CommunitySettings(val lostFoundEnabled: Boolean = true, val suggestionsEnabled: Boolean = true, val hazardReportsEnabled: Boolean = true)

@Serializable
data class PublicSettings(
    val platformName: String = "CampusCare",
    val universityName: String = "SRM University-AP",
    val registrationOpen: Boolean = true,
    val turnstile: TurnstileConfig = TurnstileConfig(),
    val googleSignInEnabled: Boolean = false,
    val anonymousReportingEnabled: Boolean = true,
    val anonymousCategories: List<String> = emptyList(),
    val chatMedia: Map<String, MediaPolicy> = emptyMap(),
    val maxImageMb: Int = 10,
    val maxVideoMb: Int = 50,
    val communityEnabled: Boolean = true,
    val sos: SosPublic = SosPublic(),
    val safeWalkEnabled: Boolean = true,
    val locationSharingEnabled: Boolean = true,
    val maxLocationShareMinutes: Int = 120,
    val evidenceMaxMb: Int = 10,
    val evidenceMaxFiles: Int = 5,
    val passwordMinLength: Int = 10,
    val map: MapSettings = MapSettings(),
    val community: CommunitySettings = CommunitySettings(),
    val maintenanceMode: Boolean = false,
    val supportEmail: String = "",
    val accountEmailDomain: String = "srmap.edu.in",
)

@Serializable
data class UpdateInfo(val required: Boolean = false, val available: Boolean = false, val latestVersionName: String = "", val downloadUrl: String? = null, val message: String = "")

@Serializable
data class Banner(val message: String, val severity: String = "info")

@Serializable
data class EmergencyContact(val id: String = "", val name: String, val phone: String? = null, val category: String = "emergency", val purpose: String = "")

@Serializable
data class MobileConfig(
    val serverTime: String? = null,
    val settings: PublicSettings = PublicSettings(),
    val update: UpdateInfo = UpdateInfo(),
    val banner: Banner? = null,
    val emergencyContacts: List<EmergencyContact> = emptyList(),
    val pushAvailable: Boolean = false,
    val realtimeUrl: String? = null,
    val realtimePath: String = "/realtime",
)

// ------------------------------------------------------------------ dashboard & content
@Serializable
data class DashboardStats(val total: Int = 0, val active: Int = 0, val resolved: Int = 0)

@Serializable
data class ReportSummary(val id: String, val caseNumber: String, val title: String, val status: String, val category: String, val updatedAt: String? = null)

@Serializable
data class NextAppointment(val id: String, val startAt: String, val status: String, val mode: String)

@Serializable
data class CampusAlertSummary(
    val id: String,
    val title: String,
    val body: String = "",
    val severity: String = "info",
    val createdAt: String? = null,
    val requestCheckIn: Boolean = false,
    val expiresAt: String? = null,
    val myCheckIn: String? = null,
)

@Serializable
data class Announcement(
    val id: String,
    val title: String,
    val body: String,
    val pinned: Boolean = false,
    val kind: String = "notice",
    val eventAt: String? = null,
    val venue: String? = null,
    val safetyContact: String? = null,
    val published: Boolean = true,
    val createdAt: String? = null,
)

@Serializable
data class TrainingSummary(val total: Int = 0, val completed: Int = 0)

@Serializable
data class StudentDashboard(
    val stats: DashboardStats = DashboardStats(),
    val recentReports: List<ReportSummary> = emptyList(),
    val nextAppointment: NextAppointment? = null,
    val campusAlerts: List<CampusAlertSummary> = emptyList(),
    val announcements: List<Announcement> = emptyList(),
    val unreadNotifications: Int = 0,
    val training: TrainingSummary = TrainingSummary(),
)

@Serializable
data class AppNotification(
    val id: String,
    val kind: String,
    val title: String,
    val body: String,
    val link: String? = null,
    val priority: String = "normal",
    val readAt: String? = null,
    val createdAt: String? = null,
)

@Serializable
data class NotificationPage(val items: List<AppNotification> = emptyList(), val unread: Int = 0)

@Serializable
data class Contact(
    val id: String,
    val name: String,
    val purpose: String = "",
    val category: String = "other",
    val verified: Boolean = false,
    val emergency: Boolean = false,
    val phone: String? = null,
    val email: String? = null,
    val location: String? = null,
    val hours: String? = null,
)

@Serializable
data class Committee(val id: String, val name: String, val type: String = "", val mandate: String = "", val contactEmail: String? = null, val contactPhone: String? = null, val categories: List<String> = emptyList())

@Serializable
data class TrainingModuleSummary(
    val id: String,
    val title: String,
    val category: String = "",
    val summary: String = "",
    val durationMinutes: Int = 10,
    val questionCount: Int = 0,
    val completed: Boolean = false,
    val bestScore: Int? = null,
    val certificateId: String? = null,
)

@Serializable
data class TrainingSection(val heading: String = "", val body: String = "")

@Serializable
data class QuizQuestion(val question: String, val options: List<String>)

@Serializable
data class TrainingModule(
    val id: String,
    val title: String,
    val category: String = "",
    val summary: String = "",
    val durationMinutes: Int = 10,
    val passPercent: Int = 70,
    val sections: List<TrainingSection> = emptyList(),
    val quiz: List<QuizQuestion> = emptyList(),
    val completed: Boolean = false,
    val bestScore: Int? = null,
)

@Serializable
data class QuizResultItem(val correct: Boolean)

@Serializable
data class QuizResult(val score: Int, val passed: Boolean, val correct: Int, val total: Int, val completed: Boolean = false, val certificateId: String? = null, val results: List<QuizResultItem> = emptyList())

@Serializable
data class Certificate(val certificateId: String, val holder: String, val module: String, val category: String? = null, val completedAt: String? = null, val score: Int = 0)

// ------------------------------------------------------------------ incidents
@Serializable
data class Attachment(val id: String, val name: String, val mimeType: String, val sizeBytes: Long = 0, val kind: String? = null, val sha256: String? = null)

@Serializable
data class CommitteeRef(val id: String, val name: String, val type: String = "")

@Serializable
data class PersonRef(val id: String = "", val name: String = "")

@Serializable
data class ReporterInfo(val id: String = "", val name: String = "", val email: String? = null, val studentId: String? = null, val department: String? = null, val phone: String? = null)

@Serializable
data class Incident(
    val id: String,
    val caseNumber: String,
    val category: String,
    val status: String,
    val statusLabel: String = "",
    val severity: String = "medium",
    val priority: String = "normal",
    val urgent: Boolean = false,
    val anonymous: Boolean = false,
    val committee: CommitteeRef? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val incidentDate: String? = null,
    val dueAcknowledgeAt: String? = null,
    val dueResolveAt: String? = null,
    val acknowledgedAt: String? = null,
    val resolvedAt: String? = null,
    val closedAt: String? = null,
    val accessLevel: String = "reporter",
    val title: String = "",
    val description: String? = null,
    val location: String? = null,
    val involvedParties: String? = null,
    val preferredContact: String? = null,
    val evidence: List<Attachment> = emptyList(),
    val assignee: PersonRef? = null,
    val reporter: ReporterInfo? = null,
    val resolutionSummary: String? = null,
    val unreadMessages: Int = 0,
    val redacted: Boolean = false,
)

@Serializable
data class TimelineItem(
    val id: String,
    val type: String,
    val fromStatus: String? = null,
    val toStatus: String? = null,
    val body: String? = null,
    val actor: String = "",
    val createdAt: String? = null,
    val studentVisible: Boolean = true,
)

@Serializable
data class CasePermissions(val canChat: Boolean = false, val canUpdateStatus: Boolean = false, val canAssign: Boolean = false, val canAddNotes: Boolean = false)

@Serializable
data class IncidentDetail(val incident: Incident, val timeline: List<TimelineItem> = emptyList(), val permissions: CasePermissions = CasePermissions())

@Serializable
data class IncidentListItem(
    val id: String,
    val caseNumber: String,
    val title: String,
    val category: String,
    val status: String,
    val statusLabel: String = "",
    val severity: String = "medium",
    val priority: String = "normal",
    val urgent: Boolean = false,
    val anonymous: Boolean = false,
    val committeeId: String? = null,
    val assignedTo: String? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val dueResolveAt: String? = null,
    val lastMessageAt: String? = null,
    val overdue: Boolean = false,
)

@Serializable
data class Page<T>(val items: List<T> = emptyList(), val total: Int = 0, val page: Int = 1, val limit: Int = 20)

@Serializable
data class CreatedCase(val id: String, val caseNumber: String, val status: String)

@Serializable
data class CategorySuggestion(
    val category: String,
    val label: String,
    val confidence: Double = 0.0,
    val matched: List<String> = emptyList(),
    val looksUrgent: Boolean = false,
    val showCrisisSupport: Boolean = false,
    val disclaimer: String = "",
)

@Serializable
data class ChatMessage(
    val id: String,
    val senderLabel: String = "",
    val senderKind: String? = null,
    val senderId: String? = null,
    val mine: Boolean = false,
    val body: String = "",
    val hidden: Boolean = false,
    val deleted: Boolean = false,
    val attachments: List<Attachment> = emptyList(),
    val clientMessageId: String? = null,
    val createdAt: String? = null,
    val canReport: Boolean = false,
)

@Serializable
data class MessagePage(val items: List<ChatMessage> = emptyList(), val hasMore: Boolean = false, val nextCursor: String? = null, val lastReadAt: String? = null, val readOnly: Boolean = false)

@Serializable
data class PostedMessage(val message: ChatMessage, val duplicate: Boolean = false)

@Serializable
data class InternalNote(val id: String, val body: String, val author: String = "Staff", val createdAt: String? = null)

@Serializable
data class StaffMember(val id: String, val name: String, val role: String = "", val email: String? = null)

@Serializable
data class ReadState(val otherSideLastReadAt: String? = null)

// ------------------------------------------------------------------ chat
@Serializable
data class ChannelSummary(val id: String, val name: String, val slug: String? = null, val description: String = "", val readOnly: Boolean = false)

@Serializable
data class ServiceSummary(val id: String, val name: String, val description: String = "", val serviceRole: String? = null)

@Serializable
data class ThreadSummary(val id: String, val kind: String, val name: String, val closed: Boolean = false, val lastMessageAt: String? = null, val unread: Int = 0, val studentName: String? = null, val assigned: Boolean = false)

@Serializable
data class ChatOverview(
    val community: List<ChannelSummary> = emptyList(),
    val services: List<ServiceSummary> = emptyList(),
    val threads: List<ThreadSummary> = emptyList(),
    val media: Map<String, MediaPolicy> = emptyMap(),
)

@Serializable
data class MediaLimits(val maxImageMb: Int = 10, val maxVideoMb: Int = 50)

@Serializable
data class ChannelDetail(
    val id: String,
    val kind: String,
    val name: String,
    val description: String = "",
    val readOnly: Boolean = false,
    val closed: Boolean = false,
    val access: String = "member",
    val mediaScope: String = "support",
    val media: MediaPolicy = MediaPolicy(),
    val limits: MediaLimits = MediaLimits(),
    /** Counselling threads only: the counsellor and their working-hours indicator. */
    val counsellor: ThreadCounsellor? = null,
)

@Serializable
data class IdResponse(val id: String)

@Serializable
data class ModerationReport(val id: String, val reason: String, val status: String, val createdAt: String? = null, val channel: String? = null, val message: ModeratedMessage? = null)

@Serializable
data class ModeratedMessage(val id: String, val body: String, val senderLabel: String, val hidden: Boolean = false, val createdAt: String? = null)

// ------------------------------------------------------------------ counselling
@Serializable
data class Counsellor(val id: String, val name: String, val title: String = "Counsellor", val bio: String = "", val acceptingRequests: Boolean = false)

@Serializable
data class SlotList(val slots: List<String> = emptyList(), val slotMinutes: Int = 50, val timezone: String? = null)

@Serializable
data class AppointmentStudent(val id: String, val name: String, val studentId: String? = null, val department: String? = null)

@Serializable
data class Appointment(
    val id: String,
    val startAt: String,
    val endAt: String? = null,
    val mode: String = "in_person",
    val status: String,
    val statusReason: String? = null,
    val reason: String? = null,
    val meetingLink: String? = null,
    val threadId: String? = null,
    val counsellor: PersonRef? = null,
    val student: AppointmentStudent? = null,
    val followUpAt: String? = null,
    val createdAt: String? = null,
)

@Serializable
data class CounsellingNote(val id: String, val body: String, val supportPlan: String? = null, val followUpAt: String? = null, val createdAt: String? = null)

@Serializable
data class WeeklyWindow(val weekday: Int, val start: String, val end: String)

@Serializable
data class Availability(
    val weekly: List<WeeklyWindow> = emptyList(),
    val slotMinutes: Int = 50,
    val timezone: String = "Asia/Kolkata",
    val blockedDates: List<String> = emptyList(),
    val acceptingRequests: Boolean = false,
    val title: String? = "Counsellor",
    val bio: String? = "",
    /** Most sessions bookable per day (server default 10). */
    val maxDailySessions: Int = 10,
    val specializations: List<String> = emptyList(),
    val languages: List<String> = emptyList(),
)

@Serializable
data class CounsellorStudent(val id: String, val name: String, val studentId: String? = null, val department: String? = null, val lastSession: String? = null, val sessions: Int = 0, val followUpAt: String? = null)

@Serializable
data class MonthCount(val month: String, val count: Int)

@Serializable
data class CounsellingStats(val byStatus: Map<String, Int> = emptyMap(), val byMonth: List<MonthCount> = emptyList(), val today: Int = 0, val pending: Int = 0)

// ------------------------------------------------------------------ safety
@Serializable
data class SosTimelineEntry(val type: String, val at: String? = null, val actorLabel: String? = null, val note: String? = null)

@Serializable
data class StudentRef(val fullName: String = "", val phone: String? = null, val studentId: String? = null, val hostel: String? = null)

@Serializable
data class SafetyCard(
    val bloodGroup: String = "unknown",
    val allergies: String = "",
    val medicalConditions: String = "",
    val medications: String = "",
    val accessibilityNeeds: String = "",
    val emergencyNote: String = "",
    val shareWithResponders: Boolean = false,
    val updatedAt: String? = null,
)

@Serializable
data class DeliveryEvent(val channel: String, val outcome: String, val recipient: String? = null, val at: String? = null)

@Serializable
data class SosAlert(
    val id: String,
    val alertNumber: String,
    val status: String,
    val createdAt: String? = null,
    val sentAt: String? = null,
    val acknowledgedAt: String? = null,
    val resolvedAt: String? = null,
    val cancelledAt: String? = null,
    val enRouteAt: String? = null,
    val locationAvailable: Boolean = false,
    val locationUnavailableReason: String? = null,
    val latitude: Double? = null,
    val longitude: Double? = null,
    val accuracyMeters: Double? = null,
    /** When the current coordinates were captured (server clock) and the server's quality label for them. */
    val locationAt: String? = null,
    val locationQuality: String? = null,
    val locationUpdateCount: Int = 0,
    val mapLink: String? = null,
    val note: String? = null,
    val lastDeliveryError: String? = null,
    val escalationLevel: Int = 0,
    val resolutionOutcome: String? = null,
    val timeline: List<SosTimelineEntry> = emptyList(),
    val student: StudentRef? = null,
    val acknowledgedByName: String? = null,
    val respondersReached: Int = 0,
    val assignedToMe: Boolean = false,
    val safetyCard: SafetyCard? = null,
    val deliveries: List<DeliveryEvent> = emptyList(),
    /** "server": the countdown runs on the server and nobody is notified until [dispatchAt]. */
    val countdownMode: String = "client",
    val dispatchAt: String? = null,
    val dispatchedAt: String? = null,
    /** Age of the student's fix when the alert was raised (device monotonic clock). */
    val locationAgeSeconds: Double? = null,
    /** none | offered | acknowledged | unassigned | closed */
    val assignmentState: String = "none",
    val unassignedSince: String? = null,
    /** This responder's own dispatch offer for the alert (responder view only). */
    val myAssignment: MyAssignment? = null,
    val batteryLevel: Int? = null,
    val isCachedFix: Boolean = false,
    val evidenceCount: Int = 0,
)

@Serializable
data class MyAssignment(val id: String, val status: String = "", val ackDeadlineAt: String? = null, val offeredAt: String? = null)

@Serializable
data class TrustedContact(val id: String, val name: String, val email: String, val phone: String? = null, val relationship: String? = null, val shareLocation: Boolean = false, val status: String = "pending")

@Serializable
data class SafeWalkCheckIn(val at: String? = null, val note: String? = null)

@Serializable
data class SafeWalk(
    val id: String,
    val destination: String = "",
    val expectedArrivalAt: String = "",
    val status: String,
    val arrivedAt: String? = null,
    val checkIns: List<SafeWalkCheckIn> = emptyList(),
    val trustedContactIds: List<String> = emptyList(),
    val createdAt: String? = null,
    val verifiedContacts: Int = 0,
)

@Serializable
data class LocationShareInfo(val id: String, val audience: String = "security", val startedAt: String? = null, val expiresAt: String = "", val updatedAt: String? = null)

@Serializable
data class SharedLocation(val id: String, val student: String? = null, val phone: String? = null, val latitude: Double? = null, val longitude: Double? = null, val accuracyMeters: Double? = null, val updatedAt: String? = null, val expiresAt: String? = null)

@Serializable
data class OverdueWalk(val id: String, val student: String? = null, val phone: String? = null, val destination: String = "", val expectedArrivalAt: String? = null, val status: String = "")

@Serializable
data class ResponderTeamMember(val id: String, val name: String, val phone: String? = null)

// ------------------------------------------------------------------ responder duty (server is the source of truth)
@Serializable
data class DutyAvailability(
    val userId: String = "",
    /** on_duty | off_duty | on_break | busy | responding | unavailable | stale */
    val status: String = "off_duty",
    val statusBeforeStale: String? = null,
    val staleSince: String? = null,
    val campus: String? = null,
    val zoneId: String? = null,
    val skills: List<String> = emptyList(),
    val responsibilities: List<String> = emptyList(),
    val currentShiftId: String? = null,
    val lastHeartbeatAt: String? = null,
    val heartbeatAgeSeconds: Long? = null,
    val heartbeatFresh: Boolean = false,
    val activeAssignmentCount: Int = 0,
    val lastAssignedAt: String? = null,
    val locationConsent: Boolean = false,
    val statusChangedAt: String? = null,
)

@Serializable
data class DutyPolicy(
    val heartbeatIntervalSeconds: Int = 45,
    val staleThresholdSeconds: Int = 120,
    val allowDutyWithoutShift: Boolean = false,
    val shiftStartGraceMinutes: Int = 15,
    val responderLocationSharing: Boolean = false,
    val ackDeadlineSeconds: Int = 60,
)

@Serializable
data class DutyShift(
    val id: String,
    val startAt: String? = null,
    val endAt: String? = null,
    /** offered | accepted | active | completed */
    val status: String = "offered",
    val campus: String? = null,
    val zoneId: String? = null,
    val notes: String? = null,
)

@Serializable
data class DutyAssignment(
    val id: String,
    val alertId: String,
    val alertNumber: String? = null,
    val alertStatus: String? = null,
    /** offered | acknowledged */
    val status: String = "offered",
    val ackDeadlineAt: String? = null,
)

@Serializable
data class DutyOverview(
    val availability: DutyAvailability = DutyAvailability(),
    val policy: DutyPolicy = DutyPolicy(),
    val shifts: List<DutyShift> = emptyList(),
    val assignments: List<DutyAssignment> = emptyList(),
    val serverTime: String? = null,
)

@Serializable
data class HeartbeatResult(
    val status: String = "",
    val serverTime: String? = null,
    val heartbeatIntervalSeconds: Int = 45,
    val staleThresholdSeconds: Int = 120,
    val locationAccepted: Boolean = false,
)

// ------------------------------------------------------------------ map & community
@Serializable
data class MapCenter(val latitude: Double, val longitude: Double, val zoom: Double = 16.0)

@Serializable
data class Place(val id: String, val name: String, val kind: String, val latitude: Double, val longitude: Double, val description: String = "", val phone: String? = null, val hours: String? = null)

@Serializable
data class MapHazard(val id: String, val category: String, val locationLabel: String, val latitude: Double? = null, val longitude: Double? = null, val status: String, val note: String? = null, val reportedAt: String? = null)

@Serializable
data class HeatCell(val latitude: Double, val longitude: Double, val count: Int)

@Serializable
data class Heatmap(val cellDegrees: Double = 0.0015, val minCount: Int = 5, val days: Int = 90, val cells: List<HeatCell> = emptyList())

@Serializable
data class SafetyMap(
    val center: MapCenter,
    val places: List<Place> = emptyList(),
    val hazards: List<MapHazard> = emptyList(),
    val alerts: List<CampusAlertSummary> = emptyList(),
    val heatmap: Heatmap = Heatmap(),
)

@Serializable
data class Hazard(
    val id: String,
    val category: String,
    val description: String = "",
    val locationLabel: String = "",
    val latitude: Double? = null,
    val longitude: Double? = null,
    val status: String,
    val publicNote: String? = null,
    val anonymous: Boolean = false,
    val createdAt: String? = null,
)

@Serializable
data class LostFoundItem(
    val id: String,
    val type: String,
    val title: String,
    val description: String = "",
    val category: String = "other",
    val location: String = "",
    val occurredAt: String? = null,
    val status: String = "open",
    val createdAt: String? = null,
    val mine: Boolean = false,
    val photoIds: List<String> = emptyList(),
    val claims: List<LostFoundClaim> = emptyList(),
)

@Serializable
data class ContactCard(val name: String = "", val email: String? = null, val phone: String? = null)

@Serializable
data class LostFoundClaim(val id: String, val status: String, val message: String? = null, val createdAt: String? = null, val claimant: ContactCard? = null, val poster: ContactCard? = null)

@Serializable
data class LostFoundPage(val items: List<LostFoundItem> = emptyList(), val total: Int = 0, val disabled: Boolean = false)

@Serializable
data class Suggestion(val id: String, val category: String, val text: String, val status: String, val response: String? = null, val anonymous: Boolean = false, val createdAt: String? = null)

@Serializable
data class SuggestionsResponse(val mine: List<Suggestion> = emptyList(), val youSaidWeDid: List<Suggestion> = emptyList())

@Serializable
data class StatusResponse(val id: String? = null, val status: String = "", val ok: Boolean = true)

// ------------------------------------------------------------------ privacy & preferences
@Serializable
data class ChannelPrefs(val inApp: Boolean = true, val email: Boolean = true, val push: Boolean = true)

@Serializable
data class AccessEntry(val at: String? = null, val description: String, val reference: String? = null, val byRole: String = "staff")

@Serializable
data class PrivacyShare(val id: String, val audience: String, val startedAt: String? = null, val expiresAt: String? = null)

@Serializable
data class PrivacyWalk(val id: String, val destination: String, val expectedArrivalAt: String? = null, val status: String)

@Serializable
data class PrivacyContact(val name: String, val status: String, val canSeeLocation: Boolean = false)

@Serializable
data class PrivacySession(val id: String, val client: String = "web", val deviceName: String? = null, val lastSeenAt: String? = null)

@Serializable
data class PrivacyCard(val sharedWithResponders: Boolean = false, val updatedAt: String? = null)

@Serializable
data class LinkedAccounts(val google: Boolean = false)

@Serializable
data class DataRequestInfo(val id: String, val type: String, val status: String, val createdAt: String? = null, val note: String? = null)

@Serializable
data class PrivacyDashboard(
    val locationSharing: List<PrivacyShare> = emptyList(),
    val activeSafeWalk: PrivacyWalk? = null,
    val linkedAccounts: LinkedAccounts = LinkedAccounts(),
    val sessions: List<PrivacySession> = emptyList(),
    val trustedContacts: List<PrivacyContact> = emptyList(),
    val safetyCard: PrivacyCard = PrivacyCard(),
    val communityNameVisible: Boolean = true,
    val accessHistory: List<AccessEntry> = emptyList(),
    val dataRequests: List<DataRequestInfo> = emptyList(),
)

// ------------------------------------------------------------------ admin
@Serializable
data class AdminUsersCount(val students: Int = 0, val staff: Int = 0, val pendingStaff: Int = 0)

@Serializable
data class AdminIncidentCounts(
    val today: Int = 0,
    val thisWeek: Int = 0,
    val thisMonth: Int = 0,
    val pending: Int = 0,
    val assigned: Int = 0,
    val inProgress: Int = 0,
    val resolved: Int = 0,
    val total: Int = 0,
    val overdue: Int = 0,
    val unacknowledged: Int = 0,
)

@Serializable
data class AdminAlertsCount(val activeSos: Int = 0)

@Serializable
data class AdminActivity(val id: String, val action: String, val at: String? = null, val targetType: String? = null)

@Serializable
data class AdminOverview(
    val users: AdminUsersCount = AdminUsersCount(),
    val incidents: AdminIncidentCounts = AdminIncidentCounts(),
    val alerts: AdminAlertsCount = AdminAlertsCount(),
    val recentActivity: List<AdminActivity> = emptyList(),
)

@Serializable
data class CheckInCounts(val safe: Int = 0, val need_help: Int = 0)

@Serializable
data class AdminCampusAlert(
    val id: String,
    val title: String,
    val body: String,
    val severity: String,
    val requestCheckIn: Boolean = false,
    val createdAt: String? = null,
    val expiresAt: String? = null,
    val checkIns: CheckInCounts = CheckInCounts(),
    val recipients: Int? = null,
)

@Serializable
data class AdminUser(
    val id: String,
    val fullName: String,
    val email: String,
    val role: String,
    val accountStatus: String,
    val department: String? = null,
    val studentId: String? = null,
    val mfaEnabled: Boolean = false,
    val lastLoginAt: String? = null,
    val createdAt: String? = null,
)

/** Raw JSON for endpoints whose result the app does not need to inspect. */
typealias Ignored = JsonElement


// ------------------------------------------------------------------ campus map & routing models
@Serializable
data class CampusEntranceItem(
    val id: String,
    val name: String,
    val latitude: Double,
    val longitude: Double,
    val isAccessible: Boolean = false,
    val isMain: Boolean = false,
    val status: String = "open",
)

@Serializable
data class CampusBuildingItem(
    val id: String,
    val name: String,
    val code: String,
    val category: String,
    val latitude: Double,
    val longitude: Double,
    val entrances: List<CampusEntranceItem> = emptyList(),
    val operatingHours: String? = null,
    val contactPhone: String? = null,
    val description: String = "",
    val status: String = "active",
    val isEmergencyLocation: Boolean = false,
    val accessibilityNotes: String? = null,
)

@Serializable
data class PathwaySegmentItem(
    val id: String,
    val name: String,
    val pathType: String = "pedestrian",
    val isOneWay: Boolean = false,
    val distanceMeters: Double = 0.0,
    val surfaceType: String = "paved",
    val hasLighting: Boolean = true,
    val status: String = "open",
)

@Serializable
data class CampusMapStats(
    val totalBuildings: Int = 0,
    val totalPathways: Int = 0,
    val activeReportsCount: Int = 0,
)

@Serializable
data class CampusMapData(
    val center: MapCenter,
    val campus: String = "main",
    val buildings: List<CampusBuildingItem> = emptyList(),
    val emergencyLocations: List<CampusBuildingItem> = emptyList(),
    val pathways: List<PathwaySegmentItem> = emptyList(),
    val stats: CampusMapStats = CampusMapStats(),
)

@Serializable
data class RouteStepItem(
    val instruction: String,
    val distanceMeters: Double,
    val durationSeconds: Double,
    val pathwayName: String,
)

@Serializable
data class RouteCalculationResponse(
    val found: Boolean,
    val isApproximate: Boolean = false,
    val distanceMeters: Double = 0.0,
    val durationSeconds: Double = 0.0,
    val mode: String = "walking",
    val geometry: List<List<Double>> = emptyList(),
    val steps: List<RouteStepItem> = emptyList(),
    val destinationEntrance: CampusEntranceItem? = null,
    val warnings: List<String> = emptyList(),
)

@Serializable
data class BuildingsResponse(
    val items: List<CampusBuildingItem> = emptyList(),
    val count: Int = 0,
)

@Serializable
data class EmergencyLocationsResponse(
    val items: List<CampusBuildingItem> = emptyList(),
)

@Serializable
data class MapReportItem(
    val id: String,
    val reportType: String,
    val locationLabel: String,
    val description: String,
    val status: String,
    val resolutionNote: String? = null,
    val createdAt: String? = null,
)
