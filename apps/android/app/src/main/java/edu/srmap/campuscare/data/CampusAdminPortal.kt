package edu.srmap.campuscare.data

import kotlinx.serialization.Serializable
import java.net.URLEncoder

/**
 * CampusCare College — Campus Admin portal (/api/v1/admin/portal). The server scopes every answer to
 * the administrator's campuses and permissions; actions reuse the existing endpoints, which check again.
 */
class CampusAdminApi(private val c: ApiClient) {
    private fun q(vararg pairs: Pair<String, Any?>): String {
        val p = pairs.filter { (_, v) -> v != null && v.toString().isNotBlank() }
            .joinToString("&") { (k, v) -> "$k=${URLEncoder.encode(v.toString(), "UTF-8")}" }
        return if (p.isEmpty()) "" else "?$p"
    }

    suspend fun dashboard(): CaDashboard = c.get("/admin/portal/dashboard")
    suspend fun map(campus: String? = null): CaMap = c.get("/admin/portal/map" + q("campus" to campus))
    suspend fun sos(status: String, query: String?, severity: String?): CaSosList =
        c.get("/admin/portal/sos" + q("status" to status, "q" to query, "severity" to severity, "limit" to 50))
    suspend fun sosDetail(id: String): CaSosDetail = c.get("/admin/portal/sos/$id")
    suspend fun reports(tab: String, category: String?, query: String?, sort: String): CaReportList =
        c.get("/admin/portal/reports" + q("tab" to tab, "category" to category, "q" to query, "sort" to sort, "limit" to 50))
    suspend fun counselling(range: Int): CaCounselling = c.get("/admin/portal/counselling" + q("range" to range))
    suspend fun students(query: String?, department: String?, status: String?, verification: String?, page: Int): CaStudentList =
        c.get("/admin/portal/students" + q("q" to query, "department" to department, "status" to status, "verification" to verification, "page" to page, "limit" to 20))
    suspend fun student(id: String): CaStudentDetail = c.get("/admin/portal/students/$id")
    /** Existing, campus-scoped account action (suspend / reactivate) — audited by the server. */
    suspend fun setStudentStatus(id: String, action: String, reason: String?): Ignored =
        c.post("/admin/users/$id/status", mapOf("action" to action, "reason" to reason))
    /** Existing Campus Admin initial review of identity evidence (the Super Admin decides). */
    suspend fun initialReview(evidenceId: String, recommendation: String, notes: String): Ignored =
        c.post("/admin/verifications/evidence/$evidenceId/initial-review", mapOf("recommendation" to recommendation, "notes" to notes))
    suspend fun security(): CaSecurity = c.get("/admin/portal/security")
    /** Existing supervisor override; the server requires duty:manage and a reason. */
    suspend fun overrideDuty(responderId: String, status: String, reason: String): Ignored =
        c.post("/admin/responders/$responderId/duty-status", mapOf("status" to status, "reason" to reason))
    suspend fun committees(): CaCommittees = c.get("/admin/portal/committees")
    /** Existing case endpoints: who may own the case, and the (audited) assignment. */
    suspend fun assignableStaff(caseId: String): List<CaPerson> = c.get("/incidents/$caseId/assignable-staff")
    suspend fun assign(caseId: String, committeeId: String, assigneeId: String, reason: String?): Ignored =
        c.post("/incidents/$caseId/assign", mapOf("committeeId" to committeeId, "assigneeId" to assigneeId, "reason" to reason))
    suspend fun analytics(range: Int): CaAnalytics = c.get("/admin/portal/analytics" + q("range" to range))
    suspend fun announcements(audience: String, query: String?): CaAnnouncements =
        c.get("/admin/portal/announcements" + q("audience" to audience, "q" to query))
    suspend fun markAnnouncementRead(id: String): Ignored = c.post("/admin/portal/announcements/$id/read")
    /** Existing publishing endpoint; the server limits a Campus Admin to their own campuses. */
    suspend fun publishAnnouncement(body: Map<String, Any?>): Ignored = c.post("/chats/announcements", body)
    suspend fun messages(query: String?): CaMessages = c.get("/admin/portal/messages" + q("q" to query))
    suspend fun profile(): CaProfile = c.get("/admin/portal/profile")
}

@Serializable data class CaCampus(val id: String, val name: String)

@Serializable
data class CaAccess(
    val sosOversight: Boolean = false,
    val sosDispatch: Boolean = false,
    val liveLocations: Boolean = false,
    val reportsOversight: Boolean = false,
    val reportsSensitive: Boolean = false,
    val reportAssignment: Boolean = false,
    val counsellingAggregate: Boolean = false,
    val counsellingNotes: Boolean = false,
    val studentManagement: Boolean = false,
    val dutyView: Boolean = false,
    val dutyManage: Boolean = false,
    val committeeManagement: Boolean = false,
    val analytics: Boolean = false,
    val announcements: Boolean = false,
    val superAdmin: Boolean = false,
)

@Serializable data class CaAdmin(val name: String = "", val designation: String? = null, val roleLabel: String = "Campus Admin", val verified: Boolean = false, val emailVerified: Boolean = false)
@Serializable data class CaSosSummary(val active: Int = 0, val unacknowledged: Int = 0, val resolvedToday: Int = 0)
@Serializable
data class CaReportSummary(
    val new: Int = 0, val underReview: Int = 0, val inProgress: Int = 0, val awaitingInformation: Int = 0,
    val overdue: Int = 0, val resolved: Int = 0, val open: Int = 0, val unassigned: Int = 0,
)
@Serializable
data class CaCounsellingSummary(
    val counsellors: Int = 0, val todaySessions: Int = 0, val pendingRequests: Int = 0, val upcoming: Int = 0,
    val requested: Int = 0, val completed: Int = 0, val cancelled: Int = 0, val missed: Int = 0, val completionRate: Int? = null,
)
@Serializable
data class CaStudentSummary(
    val total: Int = 0, val active: Int = 0, val pendingVerification: Int = 0, val suspended: Int = 0, val verified: Int = 0, val awaitingVerification: Int = 0,
)
@Serializable data class CaSecuritySummary(val officers: Int = 0, val onDuty: Int = 0, val offDuty: Int = 0, val responding: Int = 0)
@Serializable data class CaActivity(val kind: String, val reference: String, val status: String, val label: String, val at: String? = null)
@Serializable data class CaHealth(val database: String = "unknown", val serverTime: String? = null)
@Serializable
data class CaAnnouncement(
    val id: String, val title: String, val body: String = "", val category: String = "general", val priority: String = "standard",
    val campus: String = "all", val targetRoles: List<String> = emptyList(), val pinned: Boolean = false, val read: Boolean = false,
    val authorName: String? = null, val authorRole: String? = null, val createdAt: String? = null, val expiresAt: String? = null,
    val attachments: List<CaAttachment> = emptyList(),
)
@Serializable data class CaAttachment(val url: String, val name: String, val sizeBytes: Long = 0, val mimeType: String = "")

@Serializable
data class CaDashboard(
    val admin: CaAdmin = CaAdmin(),
    val campuses: List<CaCampus> = emptyList(),
    val unreadNotifications: Int = 0,
    val sos: CaSosSummary = CaSosSummary(),
    val reports: CaReportSummary = CaReportSummary(),
    val counselling: CaCounsellingSummary = CaCounsellingSummary(),
    val students: CaStudentSummary? = null,
    val security: CaSecuritySummary = CaSecuritySummary(),
    val announcements: List<CaAnnouncement> = emptyList(),
    val activity: List<CaActivity> = emptyList(),
    val health: CaHealth = CaHealth(),
    val access: CaAccess = CaAccess(),
)

@Serializable data class CaSosMarker(val id: String, val reference: String, val status: String, val severity: String = "high", val latitude: Double, val longitude: Double, val at: String? = null)
@Serializable data class CaResponderMarker(val id: String, val name: String, val status: String, val latitude: Double, val longitude: Double, val at: String? = null)
@Serializable data class CaAreaCount(val area: String, val count: Int)
@Serializable
data class CaMap(
    val campus: String = "main",
    val campuses: List<CaCampus> = emptyList(),
    val activeSos: Int = 0,
    val sosMarkers: List<CaSosMarker>? = null,
    val sosMarkersReason: String? = null,
    val responders: List<CaResponderMarker>? = null,
    val respondersReason: String? = null,
    val activeByArea: List<CaAreaCount> = emptyList(),
)

@Serializable
data class CaSosRow(
    val id: String, val reference: String, val createdAt: String? = null, val dispatchedAt: String? = null,
    val severity: String = "high", val status: String, val campus: String = "main", val area: String? = null,
    val acknowledged: Boolean = false, val acknowledgedAt: String? = null, val assignmentState: String = "none",
    val responder: String? = null, val escalationLevel: Int = 0, val resolvedAt: String? = null, val outcome: String? = null,
    val latitude: Double? = null, val longitude: Double? = null,
)
@Serializable
data class CaSosMetrics(
    val active: Int = 0, val unacknowledged: Int = 0, val resolvedToday: Int = 0, val raised: Int = 0, val resolved: Int = 0,
    val avgAcknowledgeSeconds: Int? = null, val acknowledgedCount: Int = 0,
)
@Serializable data class CaSosList(val items: List<CaSosRow> = emptyList(), val total: Int = 0, val metrics: CaSosMetrics = CaSosMetrics(), val canDispatch: Boolean = false)
@Serializable data class CaTimelineEvent(val type: String, val at: String? = null, val actor: String? = null, val note: String? = null)
@Serializable
data class CaSosDetail(
    val id: String, val reference: String, val createdAt: String? = null, val severity: String = "high", val status: String,
    val campus: String = "main", val area: String? = null, val acknowledged: Boolean = false, val acknowledgedAt: String? = null,
    val assignmentState: String = "none", val responder: String? = null, val escalationLevel: Int = 0, val resolvedAt: String? = null,
    val outcome: String? = null, val latitude: Double? = null, val longitude: Double? = null,
    val timeline: List<CaTimelineEvent> = emptyList(), val canDispatch: Boolean = false, val restricted: String? = null,
)

@Serializable
data class CaReportRow(
    val id: String, val reference: String, val category: String, val status: String, val group: String = "new", val statusLabel: String = "",
    val severity: String = "medium", val priority: String = "normal", val urgent: Boolean = false, val committee: String? = null,
    val committeeId: String? = null, val confidential: Boolean = false, val assigned: Boolean = false, val handler: String? = null,
    val createdAt: String? = null, val dueResolveAt: String? = null, val overdue: Boolean = false,
)
@Serializable
data class CaReportMetrics(
    val total: Int = 0, val open: Int = 0, val overdue: Int = 0, val new: Int = 0, val under_review: Int = 0, val in_progress: Int = 0,
    val awaiting_information: Int = 0, val resolved: Int = 0, val closed: Int = 0, val created: Int = 0, val resolvedInRange: Int = 0,
    val resolutionRate: Int? = null, val avgResolutionDays: Double? = null,
)
@Serializable data class CaCategoryCount(val category: String, val count: Int? = null)
@Serializable
data class CaReportList(
    val items: List<CaReportRow> = emptyList(), val total: Int = 0, val metrics: CaReportMetrics = CaReportMetrics(),
    val categories: List<CaCategoryCount> = emptyList(), val canAssign: Boolean = false, val canReadSensitive: Boolean = false,
)

@Serializable
data class CaCounsellor(
    val id: String, val name: String, val designation: String = "Counsellor", val accepting: Boolean = false, val worksToday: Boolean = false,
    val dailyCapacity: Int = 0, val today: Int = 0, val week: Int = 0, val pendingRequests: Int = 0, val utilisation: Int? = null,
)
@Serializable data class CaCapacity(val today: Int = 0, val bookedToday: Int = 0, val available: Int = 0)
@Serializable data class CaFollowUps(val active: Int = 0, val openCases: Int = 0, val closed: Int = 0)
@Serializable data class CaSession(val id: String, val counsellor: String, val startAt: String? = null, val endAt: String? = null, val mode: String = "in_person", val status: String = "confirmed")
@Serializable
data class CaCounselling(
    val range: Int = 30, val metrics: CaCounsellingSummary = CaCounsellingSummary(), val capacity: CaCapacity = CaCapacity(),
    val followUps: CaFollowUps = CaFollowUps(), val counsellors: List<CaCounsellor> = emptyList(), val upcoming: List<CaSession> = emptyList(),
    val canManageSchedules: Boolean = false, val privacy: String = "",
)

@Serializable
data class CaStudent(
    val id: String, val name: String, val email: String = "", val studentId: String? = null, val department: String? = null,
    val academicYear: Int? = null, val accountStatus: String = "active", val verificationStatus: String = "pending",
    val emailVerified: Boolean = false, val campus: String = "main", val createdAt: String? = null,
)
@Serializable data class CaStudentList(val items: List<CaStudent> = emptyList(), val total: Int = 0, val page: Int = 1, val limit: Int = 20, val departments: List<String> = emptyList())
@Serializable data class CaEvidence(val id: String, val type: String = "", val status: String = "", val submittedAt: String? = null, val initialRecommendation: String? = null)
@Serializable
data class CaStudentDetail(
    val id: String, val name: String, val email: String = "", val studentId: String? = null, val department: String? = null,
    val academicYear: Int? = null, val accountStatus: String = "active", val verificationStatus: String = "pending",
    val emailVerified: Boolean = false, val campus: String = "main", val createdAt: String? = null, val phone: String? = null,
    val lastLoginAt: String? = null, val suspendedReason: String? = null, val evidence: List<CaEvidence> = emptyList(),
    val restricted: String? = null, val canChangeStatus: Boolean = false,
)

@Serializable
data class CaOfficer(
    val id: String, val name: String, val designation: String = "Security Officer", val campus: String = "main", val dutyStatus: String = "off_duty",
    val dutyLabel: String = "Off duty", val lastHeartbeatAt: String? = null, val statusChangedAt: String? = null, val activeAssignments: Int = 0, val sosHandled30d: Int = 0,
)
@Serializable data class CaPatrol(val id: String, val name: String, val status: String, val officer: String? = null, val shift: String? = null, val checkpointsDone: Int = 0, val checkpointsTotal: Int = 0, val startedAt: String? = null)
@Serializable data class CaSecuritySos(val active: Int = 0, val unacknowledged: Int = 0, val raised30d: Int = 0, val resolved30d: Int = 0, val avgAcknowledgeSeconds: Int? = null)
@Serializable
data class CaSecurity(
    val summary: CaSecuritySummary = CaSecuritySummary(), val sos: CaSecuritySos = CaSecuritySos(), val patrols: List<CaPatrol> = emptyList(),
    val checkpointCompletion: Int? = null, val team: List<CaOfficer> = emptyList(), val canManageDuty: Boolean = false,
)

@Serializable
data class CaCommittee(
    val id: String, val name: String, val type: String = "", val confidential: Boolean = false, val new: Int = 0, val investigating: Int = 0,
    val awaitingInformation: Int = 0, val resolved: Int = 0, val overdue: Int = 0, val unassigned: Int = 0, val nextDue: String? = null,
)
@Serializable data class CaWorkload(val id: String, val name: String, val committees: List<String> = emptyList(), val open: Int = 0, val overdue: Int = 0, val nextDue: String? = null)
@Serializable data class CaUnrouted(val new: Int = 0, val unassigned: Int = 0)
@Serializable
data class CaCommittees(
    val committees: List<CaCommittee> = emptyList(), val unrouted: CaUnrouted? = null, val workload: List<CaWorkload> = emptyList(),
    val awaitingAssignment: List<CaReportRow> = emptyList(), val canAssign: Boolean = false,
)
@Serializable data class CaPerson(val id: String, val name: String, val role: String = "")

@Serializable data class CaPeriodCount(val period: String, val count: Int)
@Serializable data class CaAnalyticsReports(val total: Int = 0, val previous: Int = 0, val resolved: Int = 0, val open: Int = 0, val overdue: Int = 0, val resolutionRate: Int? = null, val avgResolutionDays: Double? = null)
@Serializable data class CaAnalyticsSos(val raised: Int = 0, val previous: Int = 0, val resolved: Int = 0, val avgAcknowledgeSeconds: Int? = null, val active: Int = 0)
@Serializable data class CaAnalyticsSecurity(val officers: Int = 0, val onDuty: Int = 0, val patrolsCompleted: Int = 0)
@Serializable data class CaCommitteeLoad(val committee: String, val open: Int)
@Serializable
data class CaAnalytics(
    val range: Int = 30, val reports: CaAnalyticsReports = CaAnalyticsReports(), val byCategory: List<CaCategoryCount> = emptyList(),
    val reportTrend: List<CaPeriodCount> = emptyList(), val sos: CaAnalyticsSos = CaAnalyticsSos(), val sosTrend: List<CaPeriodCount> = emptyList(),
    val counselling: CaCounsellingSummary = CaCounsellingSummary(), val security: CaAnalyticsSecurity = CaAnalyticsSecurity(),
    val students: CaStudentSummary? = null, val committeeWorkload: List<CaCommitteeLoad> = emptyList(), val smallAggregateThreshold: Int = 5,
)

@Serializable
data class CaAnnouncements(
    val items: List<CaAnnouncement> = emptyList(), val total: Int = 0, val canPublish: Boolean = false,
    val publishCampuses: List<CaCampus> = emptyList(), val categories: List<String> = emptyList(),
)

@Serializable data class CaConversation(val id: String, val type: String, val title: String, val preview: String? = null, val lastActivityAt: String? = null, val unread: Int = 0, val locked: Boolean = false)
@Serializable data class CaMessageGroup(val key: String, val category: String, val label: String, val description: String = "", val unread: Int = 0, val count: Int = 0, val recent: List<CaConversation> = emptyList())
@Serializable data class CaMessages(val groups: List<CaMessageGroup> = emptyList())

@Serializable data class CaCampusSettings(val delegated: Boolean = false, val note: String = "")
@Serializable data class CaSupport(val email: String? = null)
@Serializable
data class CaProfile(
    val id: String, val name: String, val email: String = "", val phone: String? = null, val designation: String? = null, val department: String? = null,
    val roleLabel: String = "Campus Admin", val verificationStatus: String = "pending", val emailVerified: Boolean = false, val mfaEnabled: Boolean = false,
    val campuses: List<CaCampus> = emptyList(), val access: CaAccess = CaAccess(), val permissions: List<String> = emptyList(),
    val campusSettings: CaCampusSettings = CaCampusSettings(), val support: CaSupport = CaSupport(),
)
