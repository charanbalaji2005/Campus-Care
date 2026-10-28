package edu.srmap.campuscare.ui.navigation

import android.net.Uri
import edu.srmap.campuscare.AppAudience
import edu.srmap.campuscare.services.SosTrigger

/** Every screen in the app. Arguments are path segments; optional values are query parameters. */
object Routes {
    // auth & system
    const val Splash = "splash"
    const val Onboarding = "onboarding"
    const val GetStarted = "get-started"
    const val Login = "login"
    const val Register = "register"
    const val IdentityVerification = "auth/identity-verification"
    const val Forgot = "forgot"
    const val Reset = "reset?token={token}&via={via}"
    const val Verify = "verify?token={token}&email={email}&ticket={ticket}&method={method}"
    const val AcceptInvite = "invite?token={token}"
    const val Mfa = "mfa"
    const val CompleteProfile = "complete-profile"
    const val UpdateRequired = "update-required"
    const val OfflineEmergency = "offline-emergency"

    // student
    const val Home = "s/home"
    const val Sos = "s/sos"
    const val SosStatus = "s/sos/{id}"
    const val QuickSos = "s/quick-sos"
    const val Report = "s/report?category={category}"
    const val Reports = "s/reports"
    const val ReportDetail = "s/report/{id}?tab={tab}"
    const val Support = "s/support"
    const val Community = "s/community"
    const val CommunitySpaces = "s/community/spaces"
    const val CommunityPost = "community/post/{id}"
    const val CommunityCompose = "community/compose?edit={edit}&category={category}"
    const val CommunityEvents = "community/events?channel={channel}"
    const val CommunityEvent = "community/event/{id}"
    const val CommunityEventNew = "community/events/new?channel={channel}"
    const val BlockedAccounts = "community/blocked"
    const val CounsellingChannel = "community/channel/counselling"
    const val CounsellorChats = "counselling/chats"
    const val Counselling = "s/counselling"
    const val BookSession = "s/counselling/book?counsellor={counsellor}"
    const val FindCounsellor = "s/counsellors"
    const val CounsellorProfile = "s/counsellors/{id}"
    const val CounsellingFeedback = "s/counselling/feedback/{id}"
    const val AppointmentReminders = "appointment/{id}/reminders?counsellor={counsellor}"
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
    const val Chats = "chats"
    const val ChatsCategory = "chats?category={category}"
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
    const val MySchedule = "c/schedule"
    const val CounsellorPublicProfile = "c/public-profile"
    const val CounsellorStudents = "c/students"
    const val Inbox = "inbox"
    const val ChannelDashboard = "c/channel"
    const val ChannelCompose = "c/channel/compose?edit={edit}"

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
    const val CommunityModeration = "m/community"

    fun sosStatus(id: String) = "s/sos/$id"
    fun report(category: String? = null) = "s/report" + (category?.let { "?category=$it" } ?: "")
    fun reportDetail(id: String, tab: String? = null) = "s/report/$id" + (tab?.let { "?tab=$it" } ?: "")
    fun bookSession(counsellor: String? = null) = "s/counselling/book" + (counsellor?.let { "?counsellor=$it" } ?: "")
    fun counsellorProfile(id: String) = "s/counsellors/$id"
    fun feedback(appointmentId: String) = "s/counselling/feedback/$appointmentId"
    fun appointmentReminders(id: String, counsellor: Boolean = false) = "appointment/$id/reminders?counsellor=$counsellor"
    fun module(id: String) = "s/module/$id"
    fun certificate(id: String) = "s/certificate/${Uri.encode(id)}"
    fun lostFoundItem(id: String) = "s/lostfound/item/$id"
    fun chats(category: String? = null) = "chats" + (category?.let { "?category=$it" } ?: "")
    fun chat(id: String) = "chat/$id"
    fun communityPost(id: String) = "community/post/$id"
    fun communityCompose(edit: String? = null, category: String? = null) =
        "community/compose?edit=${Uri.encode(edit ?: "")}&category=${Uri.encode(category ?: "")}"
    fun communityEvents(channel: String? = null) = "community/events?channel=${Uri.encode(channel ?: "")}"
    fun communityEvent(id: String) = "community/event/$id"
    fun communityEventNew(channel: String? = null) = "community/events/new?channel=${Uri.encode(channel ?: "")}"
    fun channelCompose(edit: String? = null) = "c/channel/compose?edit=${Uri.encode(edit ?: "")}"
    fun case(id: String) = "case/$id"
    fun appointment(id: String) = "c/appointment/$id"
    fun responderAlert(id: String) = "r/alert/$id"
    /** [via] = "code" when the token came from a correct reset code rather than an emailed link. */
    fun reset(token: String, via: String = "link") = "reset?token=${Uri.encode(token)}&via=$via"
    /**
     * Verification screen: a link token (landing), or the "check your email" step with the person's
     * [email], an optional server [ticket] (code/link choice and delivery status) and the [method] in use.
     */
    fun verify(token: String? = null, email: String? = null, ticket: String? = null, method: String? = null) =
        "verify?token=${Uri.encode(token ?: "")}&email=${Uri.encode(email ?: "")}&ticket=${Uri.encode(ticket ?: "")}&method=${Uri.encode(method ?: "")}"
    fun invite(token: String) = "invite?token=${Uri.encode(token)}"

    /**
     * Screens only CampusCare Student registers. Everything not listed here or in [StaffOnly]
     * (sign-in, profile, notifications, chats, community, campus map, contacts…) is in both apps.
     */
    val StudentOnly: List<String> = listOf(
        Home, Sos, SosStatus, QuickSos, Report, Reports, ReportDetail, Support,
        Counselling, BookSession, FindCounsellor, CounsellorProfile, CounsellingFeedback,
        SafeWalk, Trusted, SafetyCard, Suggestions, Committees, Awareness, Module, Certificate,
    )

    /** Screens only CampusCare College registers (each still checks the role, and the API checks permissions). */
    val StaffOnly: List<String> = listOf(
        CounsellorHome, CounsellorAppointments, Appointment, Availability, MySchedule, CounsellorPublicProfile, CounsellorStudents,
        Inbox, ChannelDashboard, ChannelCompose, Case,
        CommitteeCases,
        ResponderAlerts, ResponderAlert, ResponderLocations, ResponderCases,
        AdminHome, AdminTriage, AdminAlerts, AdminAnnouncements, AdminStaff, Moderation, CommunityModeration,
    )

    /** Screens that belong to the other app; this one registers them as an "open the other app" page. */
    fun otherAppRoutes(audience: AppAudience = AppAudience.current): List<String> =
        if (audience == AppAudience.Student) StaffOnly else StudentOnly

    /** Home destination for each role (Super Admins use the website), or sign-in if this app isn't for that role. */
    fun homeFor(role: String): String = if (!AppAudience.current.allows(role)) Login else when (role) {
        "student" -> Home
        "counsellor" -> CounsellorHome
        "committee_member" -> CommitteeCases
        "security_officer" -> ResponderAlerts
        "admin" -> AdminHome
        "moderator" -> Moderation
        "super_admin" -> CounsellorHome
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
        val fourth = seg.getOrNull(3)
        return when {
            first == "verify-email" -> uri.getQueryParameter("token")?.let { verify(it) }
            first == "reset-password" -> uri.getQueryParameter("token")?.let { reset(it) }
            first == "accept-invite" -> uri.getQueryParameter("token")?.let { invite(it) }
            first == "student" && second == "my-reports" && third != null -> reportDetail(third, if (uri.fragment == "chat") "chat" else null)
            first == "student" && second == "my-reports" -> chats("reports")
            first == "chats" -> chats(uri.getQueryParameter("category") ?: uri.getQueryParameter("cat"))
            first == "student" && second == "emergency" -> uri.getQueryParameter("alert")?.let { sosStatus(it) }
                ?: Sos.also { SosTrigger.pendingSource = uri.getQueryParameter("source") }
            first == "student" && second == "counselling" -> Counselling
            first == "student" && second == "safe-walk" -> SafeWalk
            first == "student" && second == "trusted-contacts" -> Trusted
            first == "student" && second == "lost-found" && third != null -> lostFoundItem(third)
            first == "student" && second == "lost-found" -> LostFound
            first == "student" && second == "suggestions" -> Suggestions
            first == "student" && second == "hazards" -> Hazard
            first == "student" && second == "support" && third != null -> chat(third)
            first == "student" && second == "dashboard" -> homeFor(role)
            first == "student" && second == "community" && third == "posts" && fourth != null -> communityPost(fourth)
            first == "student" && second == "community" && third == "events" && fourth != null -> communityEvent(fourth)
            first == "student" && second == "community" -> Community
            first == "support" && second == "threads" && third != null -> chat(third)
            first == "committee" && second == "cases" && third != null -> case(third)
            first == "committee" -> if (role == "admin") AdminTriage else CommitteeCases
            first == "security" && second == "alerts" && third != null -> responderAlert(third)
            first == "security" -> ResponderAlerts
            first == "consultancy" && second == "appointments" -> uri.getQueryParameter("focus")?.let { appointment(it) } ?: CounsellorAppointments
            first == "consultancy" && second == "channel" -> ChannelDashboard
            first == "consultancy" -> CounsellorHome
            first == "moderator" && second == "community" -> CommunityModeration
            first == "moderator" -> Moderation
            else -> Notifications
        }
    }
}
