package edu.srmap.campuscare.ui.navigation

import android.net.Uri

/** Every screen in the app. Arguments are path segments; optional values are query parameters. */
object Routes {
    // auth & system
    const val Splash = "splash"
    const val Onboarding = "onboarding"
    const val Login = "login"
    const val Register = "register"
    const val Forgot = "forgot"
    const val Reset = "reset?token={token}"
    const val Verify = "verify?token={token}&email={email}"
    const val AcceptInvite = "invite?token={token}"
    const val Mfa = "mfa"
    const val CompleteProfile = "complete-profile"
    const val UpdateRequired = "update-required"
    const val OfflineEmergency = "offline-emergency"

    // student
    const val Home = "s/home"
    const val Sos = "s/sos"
    const val SosStatus = "s/sos/{id}"
    const val Report = "s/report?category={category}"
    const val Reports = "s/reports"
    const val ReportDetail = "s/report/{id}?tab={tab}"
    const val Support = "s/support"
    const val Community = "s/community"
    const val Counselling = "s/counselling"
    const val BookSession = "s/counselling/book?counsellor={counsellor}"
    const val SafeWalk = "s/safewalk"
    const val SafetyMap = "s/map"
    const val Hazard = "s/hazard"
    const val Contacts = "s/contacts"
    const val Awareness = "s/awareness"
    const val Module = "s/module/{id}"
    const val Certificate = "s/certificate/{id}"
    const val CampusAlerts = "s/alerts"
    const val Trusted = "s/trusted"
    const val SafetyCard = "s/safety-card"
    const val LostFound = "s/lostfound"
    const val LostFoundNew = "s/lostfound/new"
    const val LostFoundItem = "s/lostfound/item/{id}"
    const val Suggestions = "s/suggestions"
    const val Committees = "s/committees"
    const val Help = "s/help"

    // shared
    const val Notifications = "notifications"
    const val Profile = "profile"
    const val EditProfile = "profile/edit"
    const val Privacy = "profile/privacy"
    const val NotificationPrefs = "profile/notifications"
    const val Security = "profile/security"
    const val Chat = "chat/{id}"
    const val Case = "case/{id}"

    // counsellor
    const val CounsellorHome = "c/home"
    const val CounsellorAppointments = "c/appointments"
    const val Appointment = "c/appointment/{id}"
    const val Availability = "c/availability"
    const val CounsellorStudents = "c/students"
    const val Inbox = "inbox"

    // committee
    const val CommitteeCases = "k/cases"

    // security responders
    const val ResponderAlerts = "r/alerts"
    const val ResponderAlert = "r/alert/{id}"
    const val ResponderLocations = "r/locations"
    const val ResponderCases = "r/cases"

    // admin & moderator
    const val AdminHome = "a/home"
    const val AdminTriage = "a/triage"
    const val AdminAlerts = "a/alerts"
    const val AdminAnnouncements = "a/announcements"
    const val AdminStaff = "a/staff"
    const val Moderation = "m/home"

    fun sosStatus(id: String) = "s/sos/$id"
    fun report(category: String? = null) = "s/report" + (category?.let { "?category=$it" } ?: "")
    fun reportDetail(id: String, tab: String? = null) = "s/report/$id" + (tab?.let { "?tab=$it" } ?: "")
    fun bookSession(counsellor: String? = null) = "s/counselling/book" + (counsellor?.let { "?counsellor=$it" } ?: "")
    fun module(id: String) = "s/module/$id"
    fun certificate(id: String) = "s/certificate/${Uri.encode(id)}"
    fun lostFoundItem(id: String) = "s/lostfound/item/$id"
    fun chat(id: String) = "chat/$id"
    fun case(id: String) = "case/$id"
    fun appointment(id: String) = "c/appointment/$id"
    fun responderAlert(id: String) = "r/alert/$id"
    fun reset(token: String) = "reset?token=${Uri.encode(token)}"
    fun verify(token: String? = null, email: String? = null) =
        "verify?token=${Uri.encode(token ?: "")}&email=${Uri.encode(email ?: "")}"
    fun invite(token: String) = "invite?token=${Uri.encode(token)}"

    /** Home destination for each role (Super Admins use the website). */
    fun homeFor(role: String): String = when (role) {
        "student" -> Home
        "counsellor" -> CounsellorHome
        "committee_member" -> CommitteeCases
        "security_officer" -> ResponderAlerts
        "admin" -> AdminHome
        "moderator" -> Moderation
        else -> Login
    }

    /**
     * Maps links used by the API (notifications, emails) to app routes. Unknown links fall back to
     * the notifications screen so nothing is silently lost.
     */
    fun fromLink(link: String, role: String): String? {
        val uri = Uri.parse(if (link.startsWith("http")) link else "https://app$link")
        val seg = uri.pathSegments
        val first = seg.getOrNull(0)
        val second = seg.getOrNull(1)
        val third = seg.getOrNull(2)
        return when {
            first == "verify-email" -> uri.getQueryParameter("token")?.let { verify(it) }
            first == "reset-password" -> uri.getQueryParameter("token")?.let { reset(it) }
            first == "accept-invite" -> uri.getQueryParameter("token")?.let { invite(it) }
            first == "student" && second == "my-reports" && third != null -> reportDetail(third, if (uri.fragment == "chat") "chat" else null)
            first == "student" && second == "my-reports" -> Reports
            first == "student" && second == "emergency" -> uri.getQueryParameter("alert")?.let { sosStatus(it) } ?: Sos
            first == "student" && second == "counselling" -> Counselling
            first == "student" && second == "safe-walk" -> SafeWalk
            first == "student" && second == "trusted-contacts" -> Trusted
            first == "student" && second == "lost-found" && third != null -> lostFoundItem(third)
            first == "student" && second == "lost-found" -> LostFound
            first == "student" && second == "suggestions" -> Suggestions
            first == "student" && second == "hazards" -> Hazard
            first == "student" && second == "support" && third != null -> chat(third)
            first == "student" && second == "dashboard" -> homeFor(role)
            first == "support" && second == "threads" && third != null -> chat(third)
            first == "committee" && second == "cases" && third != null -> case(third)
            first == "committee" -> if (role == "admin") AdminTriage else CommitteeCases
            first == "security" && second == "alerts" && third != null -> responderAlert(third)
            first == "security" -> ResponderAlerts
            first == "consultancy" && second == "appointments" -> uri.getQueryParameter("focus")?.let { appointment(it) } ?: CounsellorAppointments
            first == "consultancy" -> CounsellorHome
            first == "moderator" -> Moderation
            else -> Notifications
        }
    }
}
