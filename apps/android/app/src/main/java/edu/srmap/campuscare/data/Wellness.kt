package edu.srmap.campuscare.data

import kotlinx.serialization.Serializable
import java.net.URLEncoder

/**
 * Counselling wellness: Find a Counsellor directory, booking with a one-hour response window,
 * counsellor schedule and duty, anonymous feedback and reminders.
 * The server enforces every rule (capacity, duty, privacy); the app only presents them.
 */
@Serializable
data class DirectoryCounsellor(
    val id: String,
    val name: String,
    val title: String = "Counsellor",
    val bio: String = "",
    val avatarUrl: String? = null,
    val specializations: List<String> = emptyList(),
    val languages: List<String> = emptyList(),
    val supportedModes: List<String> = listOf("in_person"),
    val campus: String = "main",
    val acceptingRequests: Boolean = false,
    /** available_now · by_appointment · unavailable */
    val availability: String = "by_appointment",
    val nextAvailableAt: String? = null,
    val slotsToday: Int = 0,
    val slotMinutes: Int = 50,
    val timezone: String = "Asia/Kolkata",
    val days: List<SlotDay> = emptyList(),
    val department: String? = null,
    /** API path of the approved profile photo (needs the session), or null. */
    val photoUrl: String? = null,
    /** Approved credentials only; empty until a Super Admin approves them. */
    val qualifications: List<String> = emptyList(),
    val yearsExperience: Int? = null,
    /** Server-computed and privacy-thresholded; null from older servers. */
    val rating: PublicRating? = null,
    /** Moderator-approved anonymised comments (profile only). */
    val comments: List<PublicComment> = emptyList(),
    val feedbackMinimum: Int = 3,
)

/**
 * Public feedback for a counsellor. `insufficient` means fewer than [minimum] different students have
 * given feedback, so nothing else is sent. When available, [average] is still null unless enough
 * different students left a star rating.
 */
@Serializable
data class PublicRating(
    /** insufficient · available */
    val status: String = "insufficient",
    val minimum: Int = 3,
    val average: Double? = null,
    val ratingCount: Int = 0,
    val distribution: Map<String, Int>? = null,
    val themes: List<FeedbackTheme> = emptyList(),
) {
    val isAvailable: Boolean get() = status == "available"
}

@Serializable
data class FeedbackTheme(val category: String, val count: Int)

/** [ref] is an opaque handle used only to report the comment. */
@Serializable
data class PublicComment(val ref: String, val text: String)

@Serializable
data class PendingCredentials(val qualifications: List<String> = emptyList(), val yearsExperience: Int? = null, val submittedAt: String? = null)

/** What the counsellor can edit; listing and photo visibility are read-only (set by a Super Admin). */
@Serializable
data class CounsellorPublicProfile(
    val title: String = "Counsellor",
    val bio: String = "",
    val specializations: List<String> = emptyList(),
    val languages: List<String> = emptyList(),
    val supportedModes: List<String> = listOf("in_person"),
    val qualifications: List<String> = emptyList(),
    val yearsExperience: Int? = null,
    val credentialsApprovedAt: String? = null,
    val pendingCredentials: PendingCredentials? = null,
    val listed: Boolean = true,
    val listingReason: String? = null,
    val photoVisible: Boolean = true,
)

@Serializable
data class CounsellorPublicProfileView(val profile: CounsellorPublicProfile = CounsellorPublicProfile(), val preview: DirectoryCounsellor? = null, val feedbackMinimum: Int = 3)

@Serializable
data class CounsellorPublicProfileSaved(val profile: CounsellorPublicProfile = CounsellorPublicProfile(), val credentialsPending: Boolean = false)

@Serializable
data class SlotDay(val date: String, val slots: List<String> = emptyList(), val full: Boolean = false)

@Serializable
data class BookingResult(val id: String, val status: String, val responseDueAt: String? = null)

@Serializable
data class TimeWindowDto(val start: String, val end: String)

@Serializable
data class WeeklyWindowDto(val weekday: Int, val start: String, val end: String)

@Serializable
data class BreakWindowDto(val weekday: Int? = null, val start: String, val end: String)

@Serializable
data class DateOverrideDto(val date: String, val closed: Boolean = false, val windows: List<TimeWindowDto> = emptyList())

@Serializable
data class ScheduleDay(val date: String, val capacity: Int = 10, val booked: Int = 0, val remaining: Int = 10, val openSlots: Int = 0)

@Serializable
data class ScheduleAppointment(val id: String, val startAt: String? = null, val endAt: String? = null, val status: String = "", val mode: String = "")

@Serializable
data class CounsellorScheduleDto(
    val weekly: List<WeeklyWindowDto> = emptyList(),
    val slotMinutes: Int = 50,
    val timezone: String = "Asia/Kolkata",
    val blockedDates: List<String> = emptyList(),
    val breaks: List<BreakWindowDto> = emptyList(),
    val dateOverrides: List<DateOverrideDto> = emptyList(),
    val maxDailySessions: Int = 10,
    val onDuty: Boolean = false,
    val days: List<ScheduleDay> = emptyList(),
    val upcoming: List<ScheduleAppointment> = emptyList(),
)

@Serializable
data class DutyResult(val onDuty: Boolean, val upcoming: List<ScheduleAppointment> = emptyList(), val warning: String? = null)

@Serializable
data class FeedbackPending(val appointmentId: String, val startAt: String? = null, val counsellor: String = "Counsellor")

@Serializable
data class FeedbackSubmitted(val ok: Boolean = true, val anonymous: Boolean = true, val notice: String = "")

@Serializable
data class FeedbackNotice(val notice: String = "")

@Serializable
data class FeedbackSummary(
    val count: Int = 0,
    val averageRating: Double? = null,
    val categories: Map<String, Int> = emptyMap(),
    val comments: List<String> = emptyList(),
    val minimumForDetails: Int = 3,
)

@Serializable
data class ReminderDto(val id: String, val kind: String, val dueAt: String, val status: String = "pending", val note: String? = null, val mine: Boolean = false)

class WellnessApi(private val c: ApiClient) {
    private fun q(v: String) = URLEncoder.encode(v, "UTF-8")

    /** [sort]: name · availability · rating. [query] matches name, title, department, specialisation and language. */
    suspend fun directory(
        specialization: String? = null, language: String? = null, mode: String? = null, date: String? = null,
        query: String? = null, sort: String? = null,
    ): List<DirectoryCounsellor> {
        val params = listOfNotNull(
            specialization?.let { "specialization=${q(it)}" }, language?.let { "language=${q(it)}" },
            mode?.let { "mode=${q(it)}" }, date?.let { "date=${q(it)}" },
            query?.takeIf { it.isNotBlank() }?.let { "q=${q(it.trim())}" }, sort?.let { "sort=${q(it)}" },
        )
        return c.get("/counselling/counsellors" + if (params.isEmpty()) "" else "?" + params.joinToString("&"))
    }
    suspend fun profile(id: String): DirectoryCounsellor = c.get("/counselling/counsellors/$id")
    /** Withdraws the comment from the profile until a moderator reviews it. */
    suspend fun reportComment(counsellorId: String, ref: String, reason: String): Ignored =
        c.post("/counselling/counsellors/$counsellorId/comments/$ref/report", mapOf("reason" to reason))

    suspend fun myPublicProfile(): CounsellorPublicProfileView = c.get("/counselling/profile/public")
    suspend fun saveMyPublicProfile(p: CounsellorPublicProfile, credentialsChanged: Boolean): CounsellorPublicProfileSaved = c.put(
        "/counselling/profile/public",
        mapOf(
            "title" to p.title, "bio" to p.bio, "specializations" to p.specializations, "languages" to p.languages, "supportedModes" to p.supportedModes,
        ) + if (credentialsChanged) mapOf("qualifications" to p.qualifications, "yearsExperience" to p.yearsExperience) else emptyMap(),
    )

    /** [allowReassignment]: the student agrees that another counsellor may take the request if this one declines or does not reply within an hour. */
    suspend fun book(counsellorId: String, startAt: String, mode: String, reason: String?, allowReassignment: Boolean, idempotencyKey: String): BookingResult =
        c.post("/counselling/appointments", mapOf(
            "counsellorId" to counsellorId, "startAt" to startAt, "mode" to mode, "reason" to reason,
            "allowReassignment" to allowReassignment, "idempotencyKey" to idempotencyKey,
        ))

    suspend fun schedule(): CounsellorScheduleDto = c.get("/counselling/schedule")
    suspend fun saveSchedule(s: CounsellorScheduleDto): Ignored = c.put("/counselling/schedule", mapOf(
        "weekly" to s.weekly.map { mapOf("weekday" to it.weekday, "start" to it.start, "end" to it.end) },
        "slotMinutes" to s.slotMinutes, "timezone" to s.timezone, "blockedDates" to s.blockedDates,
        "breaks" to s.breaks.map { mapOf("weekday" to it.weekday, "start" to it.start, "end" to it.end) },
        "dateOverrides" to s.dateOverrides.map { o -> mapOf("date" to o.date, "closed" to o.closed, "windows" to o.windows.map { mapOf("start" to it.start, "end" to it.end) }) },
        "maxDailySessions" to s.maxDailySessions,
    ))
    suspend fun setDuty(onDuty: Boolean, reason: String? = null): DutyResult = c.put("/counselling/duty", mapOf("onDuty" to onDuty, "reason" to reason))

    suspend fun pendingFeedback(): List<FeedbackPending> = c.get("/counselling/feedback/pending")
    suspend fun feedbackNotice(): FeedbackNotice = c.get("/counselling/feedback/notice")
    suspend fun submitFeedback(appointmentId: String, anonymous: Boolean, rating: Int?, categories: List<String>, comment: String?, concern: Boolean, sharePublicly: Boolean = false): FeedbackSubmitted =
        c.post("/counselling/appointments/$appointmentId/feedback", mapOf(
            "anonymous" to anonymous, "rating" to rating, "categories" to categories, "comment" to comment, "concern" to concern,
            "sharePublicly" to sharePublicly,
        ))
    suspend fun feedbackSummary(): FeedbackSummary = c.get("/counselling/feedback/summary")

    suspend fun reminders(appointmentId: String): List<ReminderDto> = c.get("/counselling/appointments/$appointmentId/reminders")
    suspend fun addReminder(appointmentId: String, dueAt: String, audience: String, note: String?): ReminderDto =
        c.post("/counselling/appointments/$appointmentId/reminders", mapOf("dueAt" to dueAt, "audience" to audience, "note" to note))
    suspend fun cancelReminder(id: String): Ignored = c.delete("/counselling/reminders/$id")
}

val Api.wellness: WellnessApi get() = WellnessApi(client)

/** Display names for the server's specialization keys. */
val SPECIALIZATION_LABELS = linkedMapOf(
    "general" to "General wellbeing",
    "academic_stress" to "Academic stress",
    "anxiety_mental_health" to "Anxiety & mental health",
    "career" to "Career",
    "relationships" to "Relationships",
    "grief_loss" to "Grief & loss",
)

val FEEDBACK_REPORT_REASONS = linkedMapOf(
    "identifying" to "It could identify someone",
    "inappropriate" to "It's inappropriate",
    "offensive" to "It's offensive",
    "not_about_counselling" to "It isn't about counselling",
    "other" to "Something else",
)

/** Accessible, honest wording for a public rating. Pure, so it is unit-tested. */
object RatingText {
    fun summary(r: PublicRating?): String = when {
        r == null || !r.isAvailable -> "Not enough feedback yet"
        r.average == null -> "Feedback shared, not enough star ratings yet"
        else -> "${"%.1f".format(java.util.Locale.ENGLISH, r.average)} out of 5 from ${r.ratingCount} rating${if (r.ratingCount == 1) "" else "s"}"
    }

    fun short(r: PublicRating?): String? = r?.takeIf { it.isAvailable }?.average?.let { "%.1f".format(java.util.Locale.ENGLISH, it) + " (${r.ratingCount})" }

    /** Whole stars to fill, rounding to the nearest half and then down, so 4.3 shows 4 and 4.8 shows 5. */
    fun filledStars(average: Double): Int = kotlin.math.floor(average + 0.25).toInt().coerceIn(0, 5)

    fun threshold(minimum: Int) = "Feedback will appear after more students have shared their experience (at least $minimum)."
}

val FEEDBACK_CATEGORY_LABELS = linkedMapOf(
    "helpful" to "Helpful",
    "listened" to "Felt listened to",
    "clear_next_steps" to "Clear next steps",
    "felt_safe" to "Felt safe",
    "timing" to "Timing",
    "communication" to "Communication",
    "environment" to "Setting",
    "other" to "Other",
)
