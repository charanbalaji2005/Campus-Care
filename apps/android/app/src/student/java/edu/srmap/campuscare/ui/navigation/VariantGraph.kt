package edu.srmap.campuscare.ui.navigation

import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import edu.srmap.campuscare.ui.screens.student.AwarenessScreen
import edu.srmap.campuscare.ui.screens.student.BookSessionScreen
import edu.srmap.campuscare.ui.screens.student.CertificateScreen
import edu.srmap.campuscare.ui.screens.student.CommitteesScreen
import edu.srmap.campuscare.ui.screens.student.CounsellingFeedbackScreen
import edu.srmap.campuscare.ui.screens.student.CounsellingScreen
import edu.srmap.campuscare.ui.screens.student.CounsellorProfileScreen
import edu.srmap.campuscare.ui.screens.student.FindCounsellorScreen
import edu.srmap.campuscare.ui.screens.student.HomeScreen
import edu.srmap.campuscare.ui.screens.student.ModuleScreen
import edu.srmap.campuscare.ui.screens.common.ChatsCenterScreen
import edu.srmap.campuscare.ui.screens.student.MyReportsScreen
import edu.srmap.campuscare.ui.screens.student.QuickSosSetupScreen
import edu.srmap.campuscare.ui.screens.student.ReportDetailScreen
import edu.srmap.campuscare.ui.screens.student.ReportIncidentScreen
import edu.srmap.campuscare.ui.screens.student.SafeWalkScreen
import edu.srmap.campuscare.ui.screens.student.SafetyCardScreen
import edu.srmap.campuscare.ui.screens.student.SosScreen
import edu.srmap.campuscare.ui.screens.student.SosStatusScreen
import edu.srmap.campuscare.ui.screens.student.SuggestionsScreen
import edu.srmap.campuscare.ui.screens.student.SupportScreen
import edu.srmap.campuscare.ui.screens.student.TrustedContactsScreen

/**
 * CampusCare Student: the student screens. Staff tools are not registered here at all; their routes
 * lead to a page pointing to CampusCare College (see [otherAppPlaceholders]).
 */
internal fun NavGraphBuilder.variantGraph() {
    composable(Routes.Home) { HomeScreen() }
    composable(Routes.Sos) { SosScreen() }
    composable(Routes.QuickSos) { QuickSosSetupScreen() }
    composable(Routes.SosStatus, arguments = listOf(reqArg("id"))) { SosStatusScreen(it.argOf("id")) }
    composable(Routes.Report, arguments = listOf(optArg("category"))) { ReportIncidentScreen(it.argOf("category").ifBlank { null }) }
    composable(Routes.Reports) { ChatsCenterScreen("reports") }
    composable(Routes.ReportDetail, arguments = listOf(reqArg("id"), optArg("tab"))) { ReportDetailScreen(it.argOf("id"), it.argOf("tab").ifBlank { null }) }
    composable(Routes.Support) { SupportScreen() }
    composable(Routes.Counselling) { CounsellingScreen() }
    composable(Routes.BookSession, arguments = listOf(optArg("counsellor"))) { BookSessionScreen(it.argOf("counsellor").ifBlank { null }) }
    composable(Routes.FindCounsellor) { FindCounsellorScreen() }
    composable(Routes.CounsellorProfile) { CounsellorProfileScreen(it.argOf("id")) }
    composable(Routes.CounsellingFeedback) { CounsellingFeedbackScreen(it.argOf("id")) }
    composable(Routes.SafeWalk) { SafeWalkScreen() }
    composable(Routes.Trusted) { TrustedContactsScreen() }
    composable(Routes.SafetyCard) { SafetyCardScreen() }
    composable(Routes.Suggestions) { SuggestionsScreen() }
    composable(Routes.Committees) { CommitteesScreen() }
    composable(Routes.Awareness) { AwarenessScreen() }
    composable(Routes.Module, arguments = listOf(reqArg("id"))) { ModuleScreen(it.argOf("id")) }
    composable(Routes.Certificate, arguments = listOf(reqArg("id"))) { CertificateScreen(it.argOf("id")) }

    otherAppPlaceholders()
}
