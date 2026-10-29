package edu.srmap.campuscare.ui.navigation

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import edu.srmap.campuscare.ui.theme.LocalReducedMotion
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
import edu.srmap.campuscare.AppAudience
import edu.srmap.campuscare.AppContainer
import edu.srmap.campuscare.BuildConfig
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
import edu.srmap.campuscare.ui.screens.auth.GetStartedScreen
import edu.srmap.campuscare.ui.screens.auth.RegisterScreen
import edu.srmap.campuscare.ui.screens.auth.ResetPasswordScreen
import edu.srmap.campuscare.ui.screens.auth.SplashScreen
import edu.srmap.campuscare.ui.screens.auth.UpdateRequiredScreen
import edu.srmap.campuscare.ui.screens.auth.VerifyEmailScreen
import edu.srmap.campuscare.ui.screens.common.ChatScreen
import edu.srmap.campuscare.ui.screens.common.ChatsCenterScreen
import edu.srmap.campuscare.ui.screens.auth.IdentityVerificationScreen
import edu.srmap.campuscare.ui.screens.common.EditProfileScreen
import edu.srmap.campuscare.ui.screens.common.NotificationPrefsScreen
import edu.srmap.campuscare.ui.screens.common.NotificationsScreen
import edu.srmap.campuscare.ui.screens.common.PrivacyScreen
import edu.srmap.campuscare.ui.screens.common.ProfileScreen
import edu.srmap.campuscare.ui.screens.common.SecurityScreen
import edu.srmap.campuscare.ui.screens.student.AppointmentRemindersScreen
import edu.srmap.campuscare.ui.screens.student.CampusAlertsScreen
import edu.srmap.campuscare.ui.screens.student.CommunitySpacesScreen
import edu.srmap.campuscare.ui.screens.community.BlockedAccountsScreen
import edu.srmap.campuscare.ui.screens.community.CommunityComposeScreen
import edu.srmap.campuscare.ui.screens.community.CommunityEventNewScreen
import edu.srmap.campuscare.ui.screens.community.CommunityEventScreen
import edu.srmap.campuscare.ui.screens.community.CommunityEventsScreen
import edu.srmap.campuscare.ui.screens.community.CommunityPostScreen
import edu.srmap.campuscare.ui.screens.community.CommunityScreen
import edu.srmap.campuscare.ui.screens.community.CounsellingChannelScreen
import edu.srmap.campuscare.ui.screens.community.CounsellorChatsScreen
import edu.srmap.campuscare.ui.screens.student.ContactsScreen
import edu.srmap.campuscare.ui.screens.student.HazardScreen
import edu.srmap.campuscare.ui.screens.student.HelpScreen
import edu.srmap.campuscare.ui.screens.student.LostFoundItemScreen
import edu.srmap.campuscare.ui.screens.student.LostFoundNewScreen
import edu.srmap.campuscare.ui.screens.student.LostFoundScreen
import edu.srmap.campuscare.ui.screens.student.SafetyMapScreen
import edu.srmap.campuscare.ui.theme.CcColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/** Destinations that show the role's bottom navigation bar. */
private val TOP_LEVEL = setOf(
    Routes.Home, Routes.Counselling, Routes.Support, Routes.Chats, Routes.Reports, Routes.Profile, Routes.Notifications,
    Routes.CounsellorHome, Routes.CounsellorAppointments, Routes.CounsellorStudents, Routes.CounsellorMessages, Routes.CounsellorProfileSettings, Routes.Inbox,
    Routes.SecurityHome, Routes.SecurityAlerts, Routes.SecurityMap, Routes.SecurityMessages, Routes.SecurityProfile,
    Routes.CommitteeHome, Routes.CommitteeReports, Routes.CommitteeStudents, Routes.CommitteeMessages, Routes.CommitteeProfile,
    Routes.CommitteeCases, Routes.ResponderAlerts, Routes.ResponderLocations, Routes.ResponderCases,
    Routes.AdminHome, Routes.AdminTriage, Routes.Moderation,
    Routes.CampusAdminHome, Routes.CampusAdminSecurity, Routes.CampusAdminCounselling, Routes.CampusAdminReports, Routes.CampusAdminMore,
    Routes.CampusAdminStudents, Routes.CampusAdminMessages, Routes.CampusAdminProfile,
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
    // foreground, while visible, or when the server broadcasts a config:updated realtime event.
    val lifecycleOwner = LocalLifecycleOwner.current
    LaunchedEffect(lifecycleOwner) {
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (isActive) {
                val cfg = container.config.refresh()
                val here = nav.currentDestination?.route
                if (cfg?.update?.required == true && here != Routes.UpdateRequired && here != Routes.Splash) {
                    nav.navigate(Routes.UpdateRequired) { popUpTo(0) { inclusive = true } }
                }
                delay(10_000)
            }
        }
    }
    // Server-side session end (expired, revoked from another device, password changed).
    LaunchedEffect(Unit) {
        container.session.events.collect { e ->
            if (e == SessionEvent.Expired || e == SessionEvent.WrongApp) {
                snack.show(if (e == SessionEvent.WrongApp) "Your account belongs to ${AppAudience.current.other.appName}. Sign in there instead." else "Your session ended. Please sign in again.", long = true)
                nav.navigate(Routes.Login) { popUpTo(0) { inclusive = true } }
            }
        }
    }
    // In-app notifications and instant remote config updates over the realtime channel.
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
            } else if (e.name == "config:updated" || e.name == "settings:updated") {
                val cfg = container.config.refresh()
                val here = nav.currentDestination?.route
                if (cfg?.update?.required == true && here != Routes.UpdateRequired && here != Routes.Splash) {
                    nav.navigate(Routes.UpdateRequired) { popUpTo(0) { inclusive = true } }
                }
            }
        }
    }
    // Deep links (notification taps, verification / reset links, OAuth callback).
    LaunchedEffect(pendingLink, user?.id, route) {
        val link = pendingLink ?: return@LaunchedEffect
        // Browser Google sign-in returns here on this app's own scheme (campuscare / campuscare-college).
        if (link.startsWith("${BuildConfig.APP_SCHEME}://auth") && (link.contains("token=") || link.contains("error="))) {
            val uri = android.net.Uri.parse(link)
            val token = uri.getQueryParameter("token")
            when (uri.getQueryParameter("error")) {
                null -> Unit
                "no_staff_account" -> snack.show("No college staff account uses this Google address. Tap Register as College Staff to apply.", long = true)
                "wrong_app" -> snack.show("This account belongs to ${AppAudience.current.other.appName}. Sign in there instead.", long = true)
                else -> snack.show("Sign-in failed. Please try again.")
            }
            if (!token.isNullOrBlank()) {
                scope.launch {
                    val dummy = edu.srmap.campuscare.data.User(id = "", fullName = "User", email = "")
                    container.session.signIn(token, dummy)
                    val me = runCatching { container.api.auth.me() }.getOrNull()
                    if (me != null && !AppAudience.current.allows(me.user.role)) {
                        container.session.clear()
                        snack.show(AppAudience.wrongAppMessage(me.user.role), long = true)
                    } else if (me != null) {
                        container.session.updateUser(me.user)
                        snack.show("Signed in as ${me.user.fullName}")
                        nav.navigate(Routes.homeFor(me.user.role)) { popUpTo(0) { inclusive = true } }
                    } else {
                        snack.show("Sign-in failed. Please try again.")
                    }
                }
            }
            onLinkHandled()
            return@LaunchedEffect
        }
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
                        "Offline — reconnecting. Emergency calling still works — open SOS to call directly.",
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
                    val reducedMotion = LocalReducedMotion.current
                    NavHost(
                        navController = nav,
                        startDestination = Routes.Splash,
                        // Tabs cross-fade (they are siblings); detail screens slide in from the side and back out.
                        // With reduced motion every change is a short fade.
                        enterTransition = {
                            when {
                                reducedMotion -> fadeIn(tween(120))
                                initialState.destination.route in TOP_LEVEL && targetState.destination.route in TOP_LEVEL -> fadeIn(tween(220, delayMillis = 60))
                                else -> slideInHorizontally(tween(280, easing = FastOutSlowInEasing)) { it / 6 } + fadeIn(tween(240))
                            }
                        },
                        exitTransition = {
                            when {
                                reducedMotion -> fadeOut(tween(90))
                                initialState.destination.route in TOP_LEVEL && targetState.destination.route in TOP_LEVEL -> fadeOut(tween(120))
                                else -> slideOutHorizontally(tween(280, easing = FastOutSlowInEasing)) { -it / 12 } + fadeOut(tween(200))
                            }
                        },
                        popEnterTransition = {
                            if (reducedMotion) fadeIn(tween(120))
                            else slideInHorizontally(tween(280, easing = FastOutSlowInEasing)) { -it / 12 } + fadeIn(tween(240))
                        },
                        popExitTransition = {
                            if (reducedMotion) fadeOut(tween(90))
                            else slideOutHorizontally(tween(260, easing = FastOutSlowInEasing)) { it / 6 } + fadeOut(tween(200))
                        },
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
    composable(Routes.GetStarted) { GetStartedScreen() }
    composable(Routes.Login) { LoginScreen() }
    composable(Routes.Register) { RegisterScreen() }
    composable(Routes.Forgot) { ForgotPasswordScreen() }
    composable(Routes.Reset, arguments = listOf(opt("token"), opt("via"))) { ResetPasswordScreen(it.arg("token"), viaCode = it.arg("via") == "code") }
    composable(Routes.Verify, arguments = listOf(opt("token"), opt("email"), opt("ticket"), opt("method"))) {
        VerifyEmailScreen(it.arg("token"), it.arg("email"), ticket = it.arg("ticket"), method = it.arg("method"))
    }
    composable(Routes.AcceptInvite, arguments = listOf(opt("token"))) { AcceptInviteScreen(it.arg("token")) }
    composable(Routes.Mfa) { MfaScreen() }
    composable(Routes.CompleteProfile) { CompleteProfileScreen() }
    composable(Routes.UpdateRequired) { UpdateRequiredScreen() }
    composable(Routes.OfflineEmergency) { OfflineEmergencyScreen() }

    composable(Routes.Community) { CommunityScreen() }
    composable(Routes.CommunitySpaces) { CommunitySpacesScreen() }
    composable(Routes.CommunityPost, arguments = listOf(req("id"))) { CommunityPostScreen(it.arg("id")) }
    composable(Routes.CommunityCompose, arguments = listOf(opt("edit"), opt("category"))) { CommunityComposeScreen(it.arg("edit").ifBlank { null }, it.arg("category").ifBlank { null }) }
    composable(Routes.CommunityEvents, arguments = listOf(opt("channel"))) { CommunityEventsScreen(it.arg("channel").ifBlank { null }) }
    composable(Routes.CommunityEvent, arguments = listOf(req("id"))) { CommunityEventScreen(it.arg("id")) }
    composable(Routes.CommunityEventNew, arguments = listOf(opt("channel"))) { CommunityEventNewScreen(it.arg("channel").ifBlank { null }) }
    composable(Routes.BlockedAccounts) { BlockedAccountsScreen() }
    composable(Routes.CounsellingChannel) { CounsellingChannelScreen() }
    composable(Routes.CounsellorChats) { CounsellorChatsScreen() }
    composable(Routes.AppointmentReminders, arguments = listOf(opt("counsellor"))) { AppointmentRemindersScreen(it.arg("id"), it.arg("counsellor") == "true") }
    composable(Routes.SafetyMap) { SafetyMapScreen() }
    composable(Routes.Hazard) { HazardScreen() }
    composable(Routes.Contacts) { ContactsScreen() }
    composable(Routes.CampusAlerts) { CampusAlertsScreen() }
    composable(Routes.LostFound) { LostFoundScreen() }
    composable(Routes.LostFoundNew) { LostFoundNewScreen() }
    composable(Routes.LostFoundItem, arguments = listOf(req("id"))) { LostFoundItemScreen(it.arg("id")) }
    composable(Routes.Help) { HelpScreen() }

    composable(Routes.Notifications) { NotificationsScreen() }
    composable(Routes.Profile) { ProfileScreen() }
    composable(Routes.EditProfile) { EditProfileScreen() }
    composable(Routes.Privacy) { PrivacyScreen() }
    composable(Routes.NotificationPrefs) { NotificationPrefsScreen() }
    composable(Routes.Security) { SecurityScreen() }
    composable(Routes.Chat, arguments = listOf(req("id"))) { ChatScreen(it.arg("id")) }
    composable(Routes.Chats) { ChatsCenterScreen() }
    composable(Routes.ChatsCategory, arguments = listOf(opt("category"))) { ChatsCenterScreen(it.arg("category").ifBlank { null }) }
    composable(Routes.IdentityVerification) { IdentityVerificationScreen() }

    // CampusCare Student / CampusCare College: each app's own screens (src/student, src/college).
    variantGraph()
}

/** Helpers shared by screens. */
@Composable
fun rememberSignOut(): () -> Unit {
    val app = LocalApp.current
    val nav = LocalNav.current
    val scope = rememberCoroutineScope()
    return {
        scope.launch {
            // A signed-out phone can't ring, so tell dispatch first (best effort: an active emergency keeps
            // the officer on duty, and the server then marks this phone stale instead).
            if (app.duty.state.value.onDuty) withTimeoutOrNull(5_000) { app.duty.setOnDuty(false, reason = "Signed out of the app") }
            app.duty.reset()
            PushRegistrar.unregister(app.api)
            runCatching { app.api.auth.logout() }
            app.realtime.disconnect()
            app.session.clear(SessionEvent.SignedOut)
            nav.navigate(Routes.Login) { popUpTo(0) { inclusive = true } }
        }
    }
}
