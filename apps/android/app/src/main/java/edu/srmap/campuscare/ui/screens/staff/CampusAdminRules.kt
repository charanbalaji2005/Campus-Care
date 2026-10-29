package edu.srmap.campuscare.ui.screens.staff

/**
 * Display rules for the Campus Admin portal (pure Kotlin, unit-tested). The server decides what the
 * administrator may see; these only label and group what it returned.
 */
object CampusAdminRules {
    /** Formal-report filters, in the order shown. Keys match the API's `tab` values. */
    val REPORT_TABS = listOf(
        "open" to "Open", "new" to "New", "under_review" to "Under review", "in_progress" to "In progress",
        "awaiting_information" to "Awaiting info", "overdue" to "Overdue", "resolved" to "Resolved", "closed" to "Closed",
    )

    /** Announcement categories requested for the portal; keys match the API's `audience` values. */
    val ANNOUNCEMENT_AUDIENCES = listOf(
        "all" to "All", "admin" to "Admin", "committee" to "Committee", "campus" to "Campus", "security" to "Security", "counselling" to "Counselling",
    )

    val RANGES = listOf(7 to "7 days", 30 to "30 days", 90 to "90 days", 365 to "1 year")

    fun sosStatusLabel(status: String): String = when (status) {
        "queued", "sending" -> "Dispatching"
        "sent" -> "Awaiting acknowledgement"
        "failed" -> "Delivery problem"
        "acknowledged" -> "Acknowledged"
        "en_route" -> "Responder en route"
        "resolved" -> "Resolved"
        "cancelled" -> "Cancelled"
        else -> status.replace('_', ' ').replaceFirstChar { it.uppercase() }
    }

    /** "danger" while nobody has acknowledged, "amber" while a responder is on it, "ok" when closed. */
    fun sosSeverityBucket(status: String): String = when (status) {
        "queued", "sending", "sent", "failed" -> "danger"
        "acknowledged", "en_route" -> "amber"
        else -> "ok"
    }

    fun reportBucket(group: String, overdue: Boolean): String = when {
        overdue -> "danger"
        group == "new" -> "sky"
        group == "under_review" || group == "in_progress" -> "violet"
        group == "awaiting_information" -> "amber"
        else -> "ok"
    }

    fun dutyBucket(status: String): String = when (status) {
        "on_duty" -> "ok"
        "busy", "responding" -> "amber"
        "stale", "unavailable" -> "danger"
        else -> "neutral"
    }

    /** "45 s", "3 min", "1 h 5 min"; null when there is nothing to measure. */
    fun duration(seconds: Int?): String {
        if (seconds == null) return "—"
        if (seconds < 60) return "$seconds s"
        val m = seconds / 60
        if (m < 60) return "$m min"
        val h = m / 60
        return if (m % 60 == 0) "$h h" else "$h h ${m % 60} min"
    }

    /** Change against the previous period: "+25%", "−10%", "new" (nothing before) or "—" (nothing either time). */
    fun change(current: Int, previous: Int): String = when {
        previous == 0 && current == 0 -> "—"
        previous == 0 -> "new"
        else -> {
            val pct = Math.round((current - previous) * 100.0 / previous).toInt()
            if (pct > 0) "+$pct%" else if (pct < 0) "−${-pct}%" else "0%"
        }
    }

    /** Suppressed small aggregates come back as null and are shown as "fewer than N". */
    fun aggregate(count: Int?, threshold: Int): String = count?.toString() ?: "<$threshold"

    fun greeting(hour: Int): String = when (hour) {
        in 5..11 -> "Good morning"
        in 12..16 -> "Good afternoon"
        else -> "Good evening"
    }

    /** Body for POST /chats/announcements. A Campus Admin's campus is always one they manage (the server checks). */
    fun announcementBody(title: String, body: String, category: String, priority: String, campus: String, audience: List<String>): Map<String, Any?> = mapOf(
        "title" to title.trim(), "body" to body.trim(), "category" to category, "priority" to priority,
        "campus" to campus, "targetRoles" to audience.ifEmpty { listOf("all") }, "status" to "published",
    )
}
