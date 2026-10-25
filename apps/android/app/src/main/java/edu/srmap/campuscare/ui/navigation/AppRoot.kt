package edu.srmap.campuscare.ui.navigation

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CloudOff
import androidx.compose.material.icons.rounded.Campaign
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import edu.srmap.campuscare.AppContainer
import edu.srmap.campuscare.data.SessionEvent
import edu.srmap.campuscare.services.Notifications
import edu.srmap.campuscare.services.PushRegistrar
import edu.srmap.campuscare.ui.components.InfoBanner
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.Snack
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.screens.auth.AcceptInviteScreen
import edu.srmap.campuscare.ui.screens.auth.CompleteProfileScreen
import edu.srmap.campuscare.ui.screens.auth.ForgotPasswordScreen
import edu.srmap.campuscare.ui.screens.auth.LoginScreen
import edu.srmap.campuscare.ui.screens.auth.MfaScreen
import edu.srmap.campuscare.ui.screens.auth.OfflineEmergencyScreen
import edu.srmap.campuscare.ui.screens.auth.OnboardingScreen
import edu.srmap.campuscare.ui.screens.auth.RegisterScreen
import edu.srmap.campuscare.ui.screens.auth.ResetPasswordScreen
import edu.srmap.campuscare.ui.screens.auth.SplashScreen
import edu.srmap.campuscare.ui.screens.auth.UpdateRequiredScreen
import edu.srmap.campuscare.ui.screens.auth.VerifyEmailScreen
import edu.srmap.campuscare.ui.screens.common.CaseScreen
import edu.srmap.campuscare.ui.screens.common.ChatScreen
import edu.srmap.campuscare.ui.screens.common.EditProfileScreen
import edu.srmap.campuscare.ui.screens.common.NotificationPrefsScreen
import edu.srmap.campuscare.ui.screens.common.NotificationsScreen
import edu.srmap.campuscare.ui.screens.common.PrivacyScreen
import edu.srmap.campuscare.ui.screens.common.ProfileScreen
import edu.srmap.campuscare.ui.screens.common.SecurityScreen
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
import edu.srmap.campuscare.ui.screens.staff.CounsellorStudentsScreen
import edu.srmap.campuscare.ui.screens.staff.InboxScreen
import edu.srmap.campuscare.ui.screens.staff.ModerationScreen
import edu.srmap.campuscare.ui.screens.staff.ResponderAlertScreen
import edu.srmap.campuscare.ui.screens.staff.ResponderAlertsScreen
import edu.srmap.campuscare.ui.screens.staff.ResponderCasesScreen
import edu.srmap.campuscare.ui.screens.staff.ResponderLocationsScreen
import edu.srmap.campuscare.ui.screens.student.AwarenessScreen
import edu.srmap.campuscare.ui.screens.student.BookSessionScreen
import edu.srmap.campuscare.ui.screens.student.CampusAlertsScreen
import edu.srmap.campuscare.ui.screens.student.CertificateScreen
import edu.srmap.campuscare.ui.screens.student.CommitteesScreen
import edu.srmap.campuscare.ui.screens.student.CommunityScreen
import edu.srmap.campuscare.ui.screens.student.ContactsScreen
import edu.srmap.campuscare.ui.screens.student.CounsellingScreen
import edu.srmap.campuscare.ui.screens.student.HazardScreen
import edu.srmap.campuscare.ui.screens.student.HelpScreen
import edu.srmap.campuscare.ui.screens.student.HomeScreen
import edu.srmap.campuscare.ui.screens.student.LostFoundItemScreen
import edu.srmap.campuscare.ui.screens.student.LostFoundNewScreen
import edu.srmap.campuscare.ui.screens.student.LostFoundScreen
import edu.srmap.campuscare.ui.screens.student.ModuleScreen
import edu.srmap.campuscare.ui.screens.student.MyReportsScreen
import edu.srmap.campuscare.ui.screens.student.ReportDetailScreen
import edu.srmap.campuscare.ui.screens.student.ReportIncidentScreen
import edu.srmap.campuscare.ui.screens.student.SafeWalkScreen
import edu.srmap.campuscare.ui.screens.student.SafetyCardScreen
import edu.srmap.campuscare.ui.screens.student.SafetyMapScreen
import edu.srmap.campuscare.ui.screens.student.SosScreen
import edu.srmap.campuscare.ui.screens.student.SosStatusScreen
import edu.srmap.campuscare.ui.screens.student.SuggestionsScreen
import edu.srmap.campuscare.ui.screens.student.SupportScreen
import edu.srmap.campuscare.ui.screens.student.TrustedContactsScreen
import edu.srmap.campuscare.ui.theme.CcColors
import kotlinx.coroutines.launch

/** Destinations that show the role's bottom navigation bar. */
private val TOP_LEVEL = setOf(
    Routes.Home, Routes.Support, Routes.Reports, Routes.Profile, Routes.Notifications,
    Routes.CounsellorHome, Routes.CounsellorAppointments, Routes.Inbox,
    Routes.CommitteeCases, Routes.ResponderAlerts, Routes.ResponderLocations, Routes.ResponderCases,
    Routes.AdminHome, Routes.AdminTriage, Routes.Moderation,
)

@Composable
fun AppRoot(container: AppContainer, pendingLink: String?, onLinkHandled: () -> Unit) {
    val nav = rememberNavController()
    val snackHost = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val snack = remember { Snack(scope, snackHost) }
    val context = LocalContext.current
    val user by container.session.user.collectAsState()
    val reachable by container.config.reachable.collectAsState()
    val config by container.config.config.collectAsState()
    val backStack by nav.currentBackStackEntryAsState()
    val route = backStack?.destination?.route

    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }

    // Signed-in plumbing: realtime, device registration, notification permission.
    LaunchedEffect(user?.id) {
        if (user != null) {
            container.realtime.connect()
            PushRegistrar.register(context, container.api)
            if (Build.VERSION.SDK_INT >= 33 && !Notifications.canPost(context)) notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            container.realtime.disconnect()
        }
    }
    // Remote configuration from the Super Admin website: refreshed whenever the app comes to the
    // foreground, so switches, banners and forced updates reach already-installed APKs.
    val lifecycleOwner = LocalLifecycleOwner.current
    LaunchedEffect(lifecycleOwner) {
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            val cfg = container.config.refresh()
            val here = nav.currentDestination?.route
            if (cfg?.update?.required == true && here != Routes.UpdateRequired && here != Routes.Splash) {
                nav.navigate(Routes.UpdateRequired) { popUpTo(0) { inclusive = true } }
            }
        }
    }
    // Server-side session end (expired, revoked from another device, password changed).
    LaunchedEffect(Unit) {
        container.session.events.collect { e ->
            if (e == SessionEvent.Expired) {
                snack.show("Your session ended. Please sign in again.", long = true)
                nav.navigate(Routes.Login) { popUpTo(0) { inclusive = true } }
            }
        }
    }
    // In-app notifications over the realtime channel.
    LaunchedEffect(Unit) {
        container.realtime.events.collect { e ->
            if (e.name == "notification") {
                val priority = e.payload.optString("priority", "normal")
                val title = e.payload.optString("title")
                if (priority == "critical" || priority == "high") {
                    Notifications.show(context, e.payload.optString("id").hashCode(), e.payload.optString("kind"), priority, title, e.payload.optString("body"), e.payload.optString("link"))
                } else {
                    snack.show(title)
                }
            }
        }
    }
    // Deep links (notification taps, verification / reset links).
    LaunchedEffect(pendingLink, user?.id, route) {
        val link = pendingLink ?: return@LaunchedEffect
        if (route == null || route == Routes.Splash) return@LaunchedEffect
        val isAuthLink = link.contains("verify-email") || link.contains("reset-password") || link.contains("accept-invite")
        val target = Routes.fromLink(link, user?.role ?: "student")
        if (target != null && (user != null || isAuthLink)) {
            nav.navigate(target) { launchSingleTop = true }
            onLinkHandled()
        }
    }

    CompositionLocalProvider(LocalApp provides container, LocalNav provides nav, LocalSnack provides snack) {
        Box(Modifier.fillMaxSize().background(CcColors.Cream)) {
            Column(Modifier.fillMaxSize()) {
                AnimatedVisibility(visible = !reachable && user != null, enter = slideInVertically() + fadeIn(), exit = slideOutVertically() + fadeOut()) {
                    InfoBanner(
                        "CampusCare can't reach the server. Emergency calling still works — open SOS to call directly.",
                        tone = Tone.Amber, icon = Icons.Rounded.CloudOff,
                        modifier = Modifier.statusBarsPadding().padding(horizontal = 12.dp, vertical = 4.dp),
                    )
                }
                config.banner?.let { b ->
                    if (user != null) {
                        InfoBanner(
                            b.message, icon = Icons.Rounded.Campaign,
                            tone = when (b.severity) { "critical" -> Tone.Danger; "warning" -> Tone.Amber; else -> Tone.Brand },
                            modifier = Modifier.statusBarsPadding().padding(horizontal = 12.dp, vertical = 4.dp),
                        )
                    }
                }
                Box(Modifier.weight(1f)) {
                    NavHost(
                        navController = nav,
                        startDestination = Routes.Splash,
                        enterTransition = { slideInHorizontally(tween(260)) { it / 8 } + fadeIn(tween(260)) },
                        exitTransition = { fadeOut(tween(180)) },
                        popEnterTransition = { fadeIn(tween(220)) },
                        popExitTransition = { slideOutHorizontally(tween(240)) { it / 8 } + fadeOut(tween(200)) },
                    ) { graph() }
                }
                val role = user?.role
                if (role != null && route in TOP_LEVEL) {
                    RoleBottomBar(role = role, current = route ?: "", onSelect = { target -> navigateTop(nav, target, role) })
                }
            }
            SnackbarHost(snackHost, Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 80.dp).fillMaxWidth())
        }
    }
}

fun navigateTop(nav: NavHostController, target: String, role: String) {
    nav.navigate(target) {
        popUpTo(Routes.homeFor(role)) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}

private fun NavBackStackEntry.arg(name: String): String = arguments?.getString(name).orEmpty()

private fun NavGraphBuilder.graph() {
    val opt = { name: String -> navArgument(name) { type = NavType.StringType; nullable = true; defaultValue = null } }
    val req = { name: String -> navArgument(name) { type = NavType.StringType } }

    composable(Routes.Splash) { SplashScreen() }
    composable(Routes.Onboarding) { OnboardingScreen() }
    composable(Routes.Login) { LoginScreen() }
    composable(Routes.Register) { RegisterScreen() }
    composable(Routes.Forgot) { ForgotPasswordScreen() }
    composable(Routes.Reset, arguments = listOf(opt("token"))) { ResetPasswordScreen(it.arg("token")) }
    composable(Routes.Verify, arguments = listOf(opt("token"), opt("email"))) { VerifyEmailScreen(it.arg("token"), it.arg("email")) }
    composable(Routes.AcceptInvite, arguments = listOf(opt("token"))) { AcceptInviteScreen(it.arg("token")) }
    composable(Routes.Mfa) { MfaScreen() }
    composable(Routes.CompleteProfile) { CompleteProfileScreen() }
    composable(Routes.UpdateRequired) { UpdateRequiredScreen() }
    composable(Routes.OfflineEmergency) { OfflineEmergencyScreen() }

    composable(Routes.Home) { HomeScreen() }
    composable(Routes.Sos) { SosScreen() }
    composable(Routes.SosStatus, arguments = listOf(req("id"))) { SosStatusScreen(it.arg("id")) }
    composable(Routes.Report, arguments = listOf(opt("category"))) { ReportIncidentScreen(it.arg("category").ifBlank { null }) }
    composable(Routes.Reports) { MyReportsScreen() }
    composable(Routes.ReportDetail, arguments = listOf(req("id"), opt("tab"))) { ReportDetailScreen(it.arg("id"), it.arg("tab").ifBlank { null }) }
    composable(Routes.Support) { SupportScreen() }
    composable(Routes.Community) { CommunityScreen() }
    composable(Routes.Counselling) { CounsellingScreen() }
    composable(Routes.BookSession, arguments = listOf(opt("counsellor"))) { BookSessionScreen(it.arg("counsellor").ifBlank { null }) }
    composable(Routes.SafeWalk) { SafeWalkScreen() }
    composable(Routes.SafetyMap) { SafetyMapScreen() }
    composable(Routes.Hazard) { HazardScreen() }
    composable(Routes.Contacts) { ContactsScreen() }
    composable(Routes.Awareness) { AwarenessScreen() }
    composable(Routes.Module, arguments = listOf(req("id"))) { ModuleScreen(it.arg("id")) }
    composable(Routes.Certificate, arguments = listOf(req("id"))) { CertificateScreen(it.arg("id")) }
    composable(Routes.CampusAlerts) { CampusAlertsScreen() }
    composable(Routes.Trusted) { TrustedContactsScreen() }
    composable(Routes.SafetyCard) { SafetyCardScreen() }
    composable(Routes.LostFound) { LostFoundScreen() }
    composable(Routes.LostFoundNew) { LostFoundNewScreen() }
    composable(Routes.LostFoundItem, arguments = listOf(req("id"))) { LostFoundItemScreen(it.arg("id")) }
    composable(Routes.Suggestions) { SuggestionsScreen() }
    composable(Routes.Committees) { CommitteesScreen() }
    composable(Routes.Help) { HelpScreen() }

    composable(Routes.Notifications) { NotificationsScreen() }
    composable(Routes.Profile) { ProfileScreen() }
    composable(Routes.EditProfile) { EditProfileScreen() }
    composable(Routes.Privacy) { PrivacyScreen() }
    composable(Routes.NotificationPrefs) { NotificationPrefsScreen() }
    composable(Routes.Security) { SecurityScreen() }
    composable(Routes.Chat, arguments = listOf(req("id"))) { ChatScreen(it.arg("id")) }
    composable(Routes.Case, arguments = listOf(req("id"))) { CaseScreen(it.arg("id")) }

    composable(Routes.CounsellorHome) { CounsellorHomeScreen() }
    composable(Routes.CounsellorAppointments) { CounsellorAppointmentsScreen() }
    composable(Routes.Appointment, arguments = listOf(req("id"))) { AppointmentScreen(it.arg("id")) }
    composable(Routes.Availability) { AvailabilityScreen() }
    composable(Routes.CounsellorStudents) { CounsellorStudentsScreen() }
    composable(Routes.Inbox) { InboxScreen() }

    composable(Routes.CommitteeCases) { CommitteeCasesScreen() }

    composable(Routes.ResponderAlerts) { ResponderAlertsScreen() }
    composable(Routes.ResponderAlert, arguments = listOf(req("id"))) { ResponderAlertScreen(it.arg("id")) }
    composable(Routes.ResponderLocations) { ResponderLocationsScreen() }
    composable(Routes.ResponderCases) { ResponderCasesScreen() }

    composable(Routes.AdminHome) { AdminHomeScreen() }
    composable(Routes.AdminTriage) { AdminTriageScreen() }
    composable(Routes.AdminAlerts) { AdminAlertsScreen() }
    composable(Routes.AdminAnnouncements) { AdminAnnouncementsScreen() }
    composable(Routes.AdminStaff) { AdminStaffScreen() }
    composable(Routes.Moderation) { ModerationScreen() }
}

/** Helpers shared by screens. */
@Composable
fun rememberSignOut(): () -> Unit {
    val app = LocalApp.current
    val nav = LocalNav.current
    val scope = rememberCoroutineScope()
    return {
        scope.launch {
            PushRegistrar.unregister(app.api)
            runCatching { app.api.auth.logout() }
            app.realtime.disconnect()
            app.session.clear()
            nav.navigate(Routes.Login) { popUpTo(0) { inclusive = true } }
        }
    }
}
