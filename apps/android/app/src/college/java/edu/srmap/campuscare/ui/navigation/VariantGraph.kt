package edu.srmap.campuscare.ui.navigation

import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
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
import edu.srmap.campuscare.ui.screens.staff.CommitteeCasesScreen
import edu.srmap.campuscare.ui.screens.staff.CounsellorAppointmentsScreen
import edu.srmap.campuscare.ui.screens.staff.CounsellorHomeScreen
import edu.srmap.campuscare.ui.screens.staff.CounsellorPublicProfileScreen
import edu.srmap.campuscare.ui.screens.staff.CounsellorStudentsScreen
import edu.srmap.campuscare.ui.screens.staff.InboxScreen
import edu.srmap.campuscare.ui.screens.staff.ModerationScreen
import edu.srmap.campuscare.ui.screens.staff.MyScheduleScreen
import edu.srmap.campuscare.ui.screens.staff.ResponderAlertScreen
import edu.srmap.campuscare.ui.screens.staff.ResponderAlertsScreen
import edu.srmap.campuscare.ui.screens.staff.ResponderCasesScreen
import edu.srmap.campuscare.ui.screens.staff.ResponderLocationsScreen

/**
 * CampusCare College: the staff screens. Which of them a person sees is decided by their role
 * (home destination and bottom bar per role), and every action is authorised again by the API.
 * Student-only screens (SOS raising, own reports, booking…) lead to a page pointing to CampusCare Student.
 */
internal fun NavGraphBuilder.variantGraph() {
    composable(Routes.CounsellorHome) { CounsellorHomeScreen() }
    composable(Routes.CounsellorAppointments) { CounsellorAppointmentsScreen() }
    composable(Routes.Appointment, arguments = listOf(reqArg("id"))) { AppointmentScreen(it.argOf("id")) }
    composable(Routes.Availability) { AvailabilityScreen() }
    composable(Routes.MySchedule) { MyScheduleScreen() }
    composable(Routes.CounsellorPublicProfile) { CounsellorPublicProfileScreen() }
    composable(Routes.CounsellorStudents) { CounsellorStudentsScreen() }
    composable(Routes.Inbox) { InboxScreen() }
    composable(Routes.ChannelDashboard) { ChannelDashboardScreen() }
    composable(Routes.ChannelCompose, arguments = listOf(optArg("edit"))) { ChannelComposeScreen(it.argOf("edit").ifBlank { null }) }
    composable(Routes.Case, arguments = listOf(reqArg("id"))) { CaseScreen(it.argOf("id")) }

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

    otherAppPlaceholders()
}
