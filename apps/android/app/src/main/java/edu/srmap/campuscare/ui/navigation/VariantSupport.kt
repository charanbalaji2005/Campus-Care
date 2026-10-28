package edu.srmap.campuscare.ui.navigation

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.navigation.NamedNavArgument
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import edu.srmap.campuscare.AppAudience
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.screens.auth.AuthLayout
import edu.srmap.campuscare.ui.theme.CcColors

// Helpers for the per-app navigation graphs in src/student and src/college.

internal fun NavBackStackEntry.argOf(name: String): String = arguments?.getString(name).orEmpty()
internal fun optArg(name: String): NamedNavArgument = navArgument(name) { type = NavType.StringType; nullable = true; defaultValue = null }
internal fun reqArg(name: String): NamedNavArgument = navArgument(name) { type = NavType.StringType }

private val ROUTE_ARG = Regex("\\{(\\w+)\\}")

/**
 * Registers the other app's screens as a page that points to that app. Shared screens (community,
 * profile, notification links) may still link to them, and this keeps such a tap from crashing
 * the app without shipping the other app's screens here.
 */
internal fun NavGraphBuilder.otherAppPlaceholders() {
    val owner = AppAudience.current.other
    for (route in Routes.otherAppRoutes()) {
        val args = ROUTE_ARG.findAll(route).map { optArg(it.groupValues[1]) }.toList()
        composable(route, arguments = args) { OtherAppScreen(owner) }
    }
}

@Composable
fun OtherAppScreen(owner: AppAudience) {
    val nav = LocalNav.current
    val user = LocalApp.current.session.user.value
    val back = { if (!nav.popBackStack()) nav.navigate(user?.role?.let(Routes::homeFor) ?: Routes.Login) }
    AuthLayout(
        "Part of ${owner.appName}",
        if (owner == AppAudience.College) "This is a tool for college staff." else "This is a feature of the student app.",
        onBack = back,
    ) {
        Text(
            "You are using ${AppAudience.current.appName}. Your account can only use the features meant for it here.",
            style = MaterialTheme.typography.bodyMedium, color = CcColors.InkSoft,
        )
        CcButton("Go back", back, modifier = Modifier.fillMaxWidth())
    }
}
