package edu.srmap.campuscare.ui.components

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AccountBalance
import androidx.compose.material.icons.rounded.Apartment
import androidx.compose.material.icons.rounded.Bolt
import androidx.compose.material.icons.rounded.Construction
import androidx.compose.material.icons.rounded.DirectionsBus
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material.icons.rounded.HealthAndSafety
import androidx.compose.material.icons.rounded.Lightbulb
import androidx.compose.material.icons.rounded.LocalHospital
import androidx.compose.material.icons.rounded.LocalPolice
import androidx.compose.material.icons.rounded.MoreHoriz
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.PanTool
import androidx.compose.material.icons.rounded.Place
import androidx.compose.material.icons.rounded.Report
import androidx.compose.material.icons.rounded.School
import androidx.compose.material.icons.rounded.Security
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.Traffic
import androidx.compose.material.icons.rounded.Wifi
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.ui.graphics.vector.ImageVector

data class CategoryInfo(val key: String, val label: String, val description: String, val icon: ImageVector, val tone: Tone, val sensitive: Boolean)

/** Incident categories (same keys and wording as the server). */
object Catalog {
    val categories = listOf(
        CategoryInfo("ragging", "Ragging", "Teasing, intimidation or forced acts by other students", Icons.Rounded.Warning, Tone.Danger, true),
        CategoryInfo("harassment", "Harassment", "Sexual or gender-based harassment", Icons.Rounded.PanTool, Tone.Violet, true),
        CategoryInfo("discrimination", "Discrimination", "Unfair treatment based on identity", Icons.Rounded.Groups, Tone.Sky, true),
        CategoryInfo("academic", "Academic", "Teaching, evaluation or examination concerns", Icons.Rounded.School, Tone.Amber, false),
        CategoryInfo("hostel", "Hostel", "Hostel safety, facilities or conduct", Icons.Rounded.Apartment, Tone.Amber, false),
        CategoryInfo("transport", "Transport", "Campus transport safety or service", Icons.Rounded.DirectionsBus, Tone.Rose, false),
        CategoryInfo("cyber_abuse", "Cyber abuse", "Online harassment, impersonation or threats", Icons.Rounded.Wifi, Tone.Violet, true),
        CategoryInfo("security", "Security", "Theft, assault, trespass or threats on campus", Icons.Rounded.LocalPolice, Tone.Danger, true),
        CategoryInfo("infrastructure", "Infrastructure", "Unsafe buildings, lighting or facilities", Icons.Rounded.Construction, Tone.Brand, false),
        CategoryInfo("other", "Other", "Anything else affecting your safety or wellbeing", Icons.Rounded.MoreHoriz, Tone.Teal, false),
    )

    fun category(key: String): CategoryInfo = categories.firstOrNull { it.key == key } ?: categories.last()

    val departments = listOf(
        "Computer Science & Engineering", "Electronics & Communication Engineering", "Electrical & Electronics Engineering",
        "Mechanical Engineering", "Civil Engineering", "Biotechnology", "Physics", "Chemistry", "Mathematics",
        "Management", "Liberal Arts", "Commerce", "Law", "Other",
    )

    fun statusTone(status: String): Tone = when (status) {
        "submitted", "triage" -> Tone.Sky
        "assigned", "under_review" -> Tone.Violet
        "in_progress", "reopened" -> Tone.Amber
        "awaiting_information", "escalated" -> Tone.Rose
        "resolved", "closed" -> Tone.Brand
        else -> Tone.Neutral
    }

    val statusLabels = mapOf(
        "submitted" to "Submitted", "triage" to "Under triage", "assigned" to "Assigned", "under_review" to "Under review",
        "in_progress" to "Action in progress", "awaiting_information" to "Needs information", "escalated" to "Escalated",
        "resolved" to "Resolved", "reopened" to "Reopened", "closed" to "Closed", "rejected" to "Not eligible", "withdrawn" to "Withdrawn",
    )

    fun statusLabel(status: String) = statusLabels[status] ?: status.replace('_', ' ').replaceFirstChar { it.uppercase() }

    /** Handler workflow (mirrors the server's STATUS_TRANSITIONS). */
    val transitions = mapOf(
        "submitted" to listOf("triage", "assigned", "rejected"),
        "triage" to listOf("assigned", "rejected", "escalated"),
        "assigned" to listOf("under_review", "in_progress", "awaiting_information", "escalated"),
        "under_review" to listOf("in_progress", "awaiting_information", "escalated", "resolved"),
        "in_progress" to listOf("awaiting_information", "escalated", "resolved"),
        "awaiting_information" to listOf("under_review", "in_progress", "escalated", "resolved"),
        "escalated" to listOf("under_review", "in_progress", "resolved"),
        "resolved" to listOf("closed", "in_progress"),
        "reopened" to listOf("under_review", "in_progress", "escalated"),
    )

    val studentTimeline = listOf("submitted", "assigned", "under_review", "in_progress", "resolved", "closed")

    val sosLabels = mapOf(
        "pending" to "Countdown — not sent yet",
        "queued" to "Alert queued", "sending" to "Sending to responders", "sent" to "Delivered — waiting for a responder",
        "acknowledged" to "Acknowledged by Campus Security", "en_route" to "Responder on the way", "resolved" to "Resolved",
        "failed" to "Delivery failed — call for help", "cancelled" to "Cancelled",
    )

    fun sosTone(status: String): Tone = when (status) {
        "acknowledged", "en_route" -> Tone.Brand
        "resolved" -> Tone.Teal
        "failed" -> Tone.Danger
        "cancelled" -> Tone.Neutral
        else -> Tone.Amber
    }

    /** SOS statuses that are still open for the student (includes the cancellable "pending" countdown). */
    val studentActiveSos = setOf("pending", "queued", "sending", "sent", "acknowledged", "en_route", "failed")

    /** Responder duty statuses (same keys as the server). "responding" and "stale" are set only by the server. */
    val dutyLabels = mapOf(
        "on_duty" to "On duty", "off_duty" to "Off duty", "on_break" to "On break", "busy" to "Busy",
        "responding" to "Responding", "unavailable" to "Unavailable", "stale" to "Unreachable — heartbeat lost",
    )

    fun dutyLabel(status: String) = dutyLabels[status] ?: status.replace('_', ' ').replaceFirstChar { it.uppercase() }

    fun dutyTone(status: String): Tone = when (status) {
        "on_duty" -> Tone.Brand
        "responding" -> Tone.Danger
        "on_break", "busy" -> Tone.Amber
        "stale" -> Tone.Rose
        else -> Tone.Neutral
    }

    val hazardCategories = listOf(
        Triple("poor_lighting", "Poor lighting", Icons.Rounded.Lightbulb),
        Triple("unsafe_area", "Unsafe area", Icons.Rounded.Warning),
        Triple("infrastructure", "Broken infrastructure", Icons.Rounded.Construction),
        Triple("harassment_hotspot", "Harassment hotspot", Icons.Rounded.Report),
        Triple("traffic", "Traffic danger", Icons.Rounded.Traffic),
        Triple("fire_electrical", "Fire / electrical", Icons.Rounded.Bolt),
        Triple("other", "Other", Icons.Rounded.MoreHoriz),
    )

    fun placeIcon(kind: String): ImageVector = when (kind) {
        "security_post" -> Icons.Rounded.LocalPolice
        "medical" -> Icons.Rounded.LocalHospital
        "safe_zone" -> Icons.Rounded.HealthAndSafety
        "help_point" -> Icons.Rounded.Shield
        "gate" -> Icons.Rounded.Security
        "hostel" -> Icons.Rounded.Apartment
        "academic" -> Icons.Rounded.AccountBalance
        "restricted" -> Icons.Rounded.Warning
        else -> Icons.Rounded.Place
    }

    val roleLabels = mapOf(
        "student" to "Student", "counsellor" to "Counsellor", "committee_member" to "Committee member",
        "security_officer" to "Campus Security", "moderator" to "Community moderator", "admin" to "Administrator", "super_admin" to "Super Admin",
    )

    fun roleLabel(role: String) = roleLabels[role] ?: role

    /** Counselling specialisations (matches COUNSELLING_TYPES on the server). */
    val counsellingTypes = listOf(
        "general" to "General support", "academic_stress" to "Academic stress", "anxiety_mental_health" to "Anxiety & mental health",
        "career" to "Career", "relationships" to "Relationships", "grief_loss" to "Grief & loss",
    )

    fun counsellingType(key: String) = counsellingTypes.firstOrNull { it.first == key }?.second ?: key.replace('_', ' ').replaceFirstChar { it.uppercase() }

    /** Languages offered for CampusCare messages (matches PROFILE_LANGUAGES on the server). */
    val languages = listOf("English", "Telugu", "Hindi", "Tamil", "Kannada", "Malayalam", "Bengali", "Odia", "Marathi")
    val personIcon = Icons.Rounded.Person
}
