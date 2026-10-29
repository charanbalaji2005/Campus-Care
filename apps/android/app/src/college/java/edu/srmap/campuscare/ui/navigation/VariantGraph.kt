package edu.srmap.campuscare.ui.navigation

import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import edu.srmap.campuscare.ui.screens.auth.StaffApplicationScreen
import edu.srmap.campuscare.ui.screens.auth.StaffRegistrationFormScreen
import edu.srmap.campuscare.ui.screens.auth.StaffRoleChooserScreen
import edu.srmap.campuscare.ui.screens.college.CollegeHomeScreen
import edu.srmap.campuscare.ui.screens.common.CaseScreen
import edu.srmap.campuscare.ui.screens.community.ChannelComposeScreen
import edu.srmap.campuscare.ui.screens.community.ChannelDashboardScreen
import edu.srmap.campuscare.ui.screens.community.CommunityModerationScreen
import edu.srmap.campuscare.ui.screens.staff.AdminAlertsScreen
import edu.srmap.campuscare.ui.screens.staff.AdminAnnouncementsScreen
import edu.srmap.campuscare.ui.screens.staff.AdminHomeScreen
import edu.srmap.campuscare.ui.screens.staff.AdminStaffScreen
import edu.srmap.campuscare.ui.screens.staff.AdminTriageScreen
import edu.srmap.campuscare.ui.screens.staff.AppointmentScreen
import edu.srmap.campuscare.ui.screens.staff.AvailabilityScreen
import edu.srmap.campuscare.ui.screens.staff.CaseManagementScreen
import edu.srmap.campuscare.ui.screens.staff.CampusAdminAnalyticsScreen
import edu.srmap.campuscare.ui.screens.staff.CampusAdminAnnouncementsScreen
import edu.srmap.campuscare.ui.screens.staff.CampusAdminCommitteesScreen
import edu.srmap.campuscare.ui.screens.staff.CampusAdminCounsellingScreen
import edu.srmap.campuscare.ui.screens.staff.CampusAdminDashboardScreen
import edu.srmap.campuscare.ui.screens.staff.CampusAdminMapScreen
import edu.srmap.campuscare.ui.screens.staff.CampusAdminMessagesScreen
import edu.srmap.campuscare.ui.screens.staff.CampusAdminMoreScreen
import edu.srmap.campuscare.ui.screens.staff.CampusAdminProfileScreen
import edu.srmap.campuscare.ui.screens.staff.CampusAdminReportsScreen
import edu.srmap.campuscare.ui.screens.staff.CampusAdminSecurityScreen
import edu.srmap.campuscare.ui.screens.staff.CampusAdminSosDetailScreen
import edu.srmap.campuscare.ui.screens.staff.CampusAdminSosScreen
import edu.srmap.campuscare.ui.screens.staff.CampusAdminStudentScreen
import edu.srmap.campuscare.ui.screens.staff.CampusAdminStudentsScreen
import edu.srmap.campuscare.ui.screens.staff.CommitteeCasesScreen
import edu.srmap.campuscare.ui.screens.staff.CounsellorAppointmentsScreen
import edu.srmap.campuscare.ui.screens.staff.CounsellorHomeScreen
import edu.srmap.campuscare.ui.screens.staff.CounsellorMessagesScreen
import edu.srmap.campuscare.ui.screens.staff.CounsellorProfileSettingsScreen
import edu.srmap.campuscare.ui.screens.staff.CounsellorPublicProfileScreen
import edu.srmap.campuscare.ui.screens.staff.CounsellorStudentsScreen
import edu.srmap.campuscare.ui.screens.staff.InboxScreen
import edu.srmap.campuscare.ui.screens.staff.ModerationScreen
import edu.srmap.campuscare.ui.screens.staff.MyScheduleScreen
import edu.srmap.campuscare.ui.screens.staff.OnlineSessionScreen
import edu.srmap.campuscare.ui.screens.staff.ReportsAnalyticsScreen
import edu.srmap.campuscare.ui.screens.staff.ResponderAlertScreen
import edu.srmap.campuscare.ui.screens.staff.ResponderAlertsScreen
import edu.srmap.campuscare.ui.screens.staff.ResponderCasesScreen
import edu.srmap.campuscare.ui.screens.staff.ResponderLocationsScreen
import edu.srmap.campuscare.ui.screens.staff.ResourcesLibraryScreen
import edu.srmap.campuscare.ui.screens.staff.SessionNotesEditorScreen
import edu.srmap.campuscare.ui.screens.staff.StudentRequestsScreen
import edu.srmap.campuscare.ui.screens.staff.StudentWellbeingProfileScreen

/**
 * CampusCare College: the staff screens. Which of them a person sees is decided by their role
 * (home destination and bottom bar per role), and every action is authorised again by the API.
 * Student-only screens (SOS raising, own reports, booking) lead to a page pointing to CampusCare Student.
 */
internal fun NavGraphBuilder.variantGraph() {
    composable(Routes.Home) { CollegeHomeScreen() }
    // Staff registration: role choice, the role's form, and the applicant's status (no access until approved).
    composable(Routes.StaffRegister, arguments = listOf(optArg("ticket"), optArg("email"), optArg("name"))) {
        StaffRoleChooserScreen(it.argOf("ticket"), it.argOf("email"), it.argOf("name"))
    }
    composable(Routes.StaffRegisterForm, arguments = listOf(reqArg("role"), optArg("ticket"), optArg("email"), optArg("name"))) {
        StaffRegistrationFormScreen(it.argOf("role"), it.argOf("ticket"), it.argOf("email"), it.argOf("name"))
    }
    composable(Routes.StaffApplication) { StaffApplicationScreen() }

    // 11 Counsellor Portal Destinations
    composable(Routes.CounsellorHome) { CounsellorHomeScreen() }
    composable(Routes.CounsellorAppointments) { CounsellorAppointmentsScreen() }
    composable(Routes.CounsellorRequests) { StudentRequestsScreen() }
    composable(Routes.CounsellorStudentProfile, arguments = listOf(reqArg("id"))) { StudentWellbeingProfileScreen(it.argOf("id")) }
    composable(Routes.OnlineSession, arguments = listOf(reqArg("id"))) { OnlineSessionScreen(it.argOf("id")) }
    composable(Routes.SessionNotesEditor, arguments = listOf(reqArg("id"))) { SessionNotesEditorScreen(it.argOf("id")) }
    composable(Routes.CounsellorCases) { CaseManagementScreen() }
    composable(Routes.ResourcesLibrary) { ResourcesLibraryScreen() }
    composable(Routes.ReportsAnalytics) { ReportsAnalyticsScreen() }
    composable(Routes.CounsellorMessages) { CounsellorMessagesScreen() }
    composable(Routes.CounsellorProfileSettings) { CounsellorProfileSettingsScreen() }

    composable(Routes.Appointment, arguments = listOf(reqArg("id"))) { AppointmentScreen(it.argOf("id")) }
    composable(Routes.Availability) { AvailabilityScreen() }
    composable(Routes.MySchedule) { MyScheduleScreen() }
    composable(Routes.CounsellorPublicProfile) { CounsellorPublicProfileScreen() }
    composable(Routes.CounsellorStudents) { CounsellorStudentsScreen() }
    composable(Routes.Inbox) { InboxScreen() }
    composable(Routes.ChannelDashboard) { ChannelDashboardScreen() }
    composable(Routes.ChannelCompose, arguments = listOf(optArg("edit"))) { ChannelComposeScreen(it.argOf("edit").ifBlank { null }) }
    composable(Routes.Case, arguments = listOf(reqArg("id"))) { CaseScreen(it.argOf("id")) }

    // Security Officer Portal Screens
    composable(Routes.SecurityHome) { edu.srmap.campuscare.ui.screens.staff.SecurityDashboardScreen() }
    composable(Routes.SecurityAlerts) { edu.srmap.campuscare.ui.screens.staff.SecurityAlertsScreen() }
    composable(Routes.SecurityMap) { edu.srmap.campuscare.ui.screens.staff.SecurityMapScreen() }
    composable(Routes.SecurityResponse, arguments = listOf(reqArg("id"))) { edu.srmap.campuscare.ui.screens.staff.SecurityResponseDetailScreen(it.argOf("id")) }
    composable(Routes.SecurityPatrol) { edu.srmap.campuscare.ui.screens.staff.SecurityPatrolScreen() }
    composable(Routes.SecurityTeam) { edu.srmap.campuscare.ui.screens.staff.SecurityTeamScreen() }
    composable(Routes.SecurityMessages) { edu.srmap.campuscare.ui.screens.staff.SecurityMessagesScreen() }
    composable(Routes.SecurityProfile) { edu.srmap.campuscare.ui.screens.staff.SecurityProfileScreen() }

    // Committee Member Portal Screens
    composable(Routes.CommitteeHome) { edu.srmap.campuscare.ui.screens.staff.CommitteeDashboardScreen() }
    composable(Routes.CommitteeReports) { edu.srmap.campuscare.ui.screens.staff.CommitteeReportsScreen() }
    composable(Routes.CommitteeReportDetail, arguments = listOf(reqArg("id"))) { edu.srmap.campuscare.ui.screens.staff.CommitteeReportDetailScreen(it.argOf("id")) }
    composable(Routes.CommitteeInvestigation, arguments = listOf(reqArg("id"))) { edu.srmap.campuscare.ui.screens.staff.CommitteeInvestigationScreen(it.argOf("id")) }
    composable(Routes.CommitteeStudents) { edu.srmap.campuscare.ui.screens.staff.CommitteeStudentsInvolvedScreen() }
    composable(Routes.CommitteeStudentsInvolved, arguments = listOf(reqArg("id"))) { edu.srmap.campuscare.ui.screens.staff.CommitteeStudentsInvolvedScreen(it.argOf("id")) }
    composable(Routes.CommitteeAnalytics) { edu.srmap.campuscare.ui.screens.staff.CommitteeAnalyticsScreen() }
    composable(Routes.CommitteeMessages) { edu.srmap.campuscare.ui.screens.staff.CommitteeMessagesScreen() }
    composable(Routes.CommitteeProfile) { edu.srmap.campuscare.ui.screens.staff.CommitteeProfileScreen() }

    composable(Routes.CommitteeCases) { CommitteeCasesScreen() }

    composable(Routes.ResponderAlerts) { ResponderAlertsScreen() }
    composable(Routes.ResponderAlert, arguments = listOf(reqArg("id"))) { ResponderAlertScreen(it.argOf("id")) }
    composable(Routes.ResponderLocations) { ResponderLocationsScreen() }
    composable(Routes.ResponderCases) { ResponderCasesScreen() }

    composable(Routes.AdminHome) { AdminHomeScreen() }
    composable(Routes.AdminTriage) { AdminTriageScreen() }
    composable(Routes.AdminAlerts) { AdminAlertsScreen() }
    composable(Routes.AdminAnnouncements) { AdminAnnouncementsScreen() }
    composable(Routes.AdminStaff) { AdminStaffScreen() }
    composable(Routes.Moderation) { ModerationScreen() }
    composable(Routes.CommunityModeration) { CommunityModerationScreen() }

    // Campus Admin portal: 12 screens over the four staff workflows (the API scopes and authorises each one).
    composable(Routes.CampusAdminHome) { CampusAdminDashboardScreen() }
    composable(Routes.CampusAdminMap) { CampusAdminMapScreen() }
    composable(Routes.CampusAdminSos) { CampusAdminSosScreen() }
    composable(Routes.CampusAdminSosDetail, arguments = listOf(reqArg("id"))) { CampusAdminSosDetailScreen(it.argOf("id")) }
    composable(Routes.CampusAdminReports) { CampusAdminReportsScreen() }
    composable(Routes.CampusAdminCounselling) { CampusAdminCounsellingScreen() }
    composable(Routes.CampusAdminStudents) { CampusAdminStudentsScreen() }
    composable(Routes.CampusAdminStudent, arguments = listOf(reqArg("id"))) { CampusAdminStudentScreen(it.argOf("id")) }
    composable(Routes.CampusAdminSecurity) { CampusAdminSecurityScreen() }
    composable(Routes.CampusAdminCommittees) { CampusAdminCommitteesScreen() }
    composable(Routes.CampusAdminAnalytics) { CampusAdminAnalyticsScreen() }
    composable(Routes.CampusAdminAnnouncements) { CampusAdminAnnouncementsScreen() }
    composable(Routes.CampusAdminMessages) { CampusAdminMessagesScreen() }
    composable(Routes.CampusAdminProfile) { CampusAdminProfileScreen() }
    composable(Routes.CampusAdminMore) { CampusAdminMoreScreen() }

    otherAppPlaceholders()
}
