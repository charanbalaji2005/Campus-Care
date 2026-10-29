package edu.srmap.campuscare.ui.screens.auth

import edu.srmap.campuscare.AppAudience
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.VerifiedUser
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import edu.srmap.campuscare.AppContainer
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.LoginResponse
import edu.srmap.campuscare.ui.components.CampusSkyline
import edu.srmap.campuscare.ui.components.LeafDecoration
import edu.srmap.campuscare.ui.components.ShieldMark
import edu.srmap.campuscare.ui.components.Wordmark
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.theme.CcColors

/** Layout for sign-in style screens: optional skyline hero, logo, serif title, then the form. */
@Composable
fun AuthLayout(
    title: String,
    subtitle: String,
    onBack: (() -> Unit)? = null,
    hero: Boolean = false,
    content: @Composable ColumnScope.() -> Unit,
) {
    Box(Modifier.fillMaxSize().background(CcColors.Cream)) {
        LeafDecoration(Modifier.fillMaxSize())
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .navigationBarsPadding(),
        ) {
            if (hero) {
                Box(Modifier.fillMaxWidth().height(190.dp)) {
                    CampusSkyline(
                        Modifier.fillMaxSize(),
                        sky = Brush.verticalGradient(listOf(Color(0xFFDDF3E8), CcColors.Cream)),
                    )
                    if (onBack != null) BackChip(onBack, Modifier.statusBarsPadding().padding(8.dp))
                }
            } else {
                Row(Modifier.statusBarsPadding().padding(8.dp).height(48.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (onBack != null) BackChip(onBack)
                }
                Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                    ShieldMark(58.dp)
                    Spacer(Modifier.height(6.dp))
                    Wordmark(showMark = false)
                }
            }
            Column(Modifier.padding(horizontal = 24.dp)) {
                Spacer(Modifier.height(12.dp))
                Text(title, style = MaterialTheme.typography.displaySmall, color = CcColors.Ink, textAlign = if (hero) TextAlign.Start else TextAlign.Center, modifier = Modifier.fillMaxWidth())
                Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = CcColors.InkSoft, textAlign = if (hero) TextAlign.Start else TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 4.dp))
                Spacer(Modifier.height(20.dp))
                Column(verticalArrangement = Arrangement.spacedBy(14.dp), content = content)
                Spacer(Modifier.height(32.dp))
            }
        }
    }
}

@Composable
private fun BackChip(onBack: () -> Unit, modifier: Modifier = Modifier) {
    IconButton(onClick = onBack, modifier = modifier.clip(RoundedCornerShape(14.dp)).background(Color.White.copy(alpha = 0.85f))) {
        Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Back", tint = CcColors.Ink)
    }
}

/** "Protected by Cloudflare Turnstile" note shown on protected forms (the check itself runs on submit). */
@Composable
fun TurnstileNote(enabled: Boolean) {
    if (!enabled) return
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Color.White).padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Rounded.VerifiedUser, contentDescription = null, tint = CcColors.Emerald, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text("Human verification", style = MaterialTheme.typography.labelLarge, color = CcColors.Ink)
            Text("Cloudflare Turnstile runs a quick check when you continue.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
        }
        Text("CLOUDFLARE", style = MaterialTheme.typography.labelSmall, color = Color(0xFFF38020))
    }
}

/** Validation the server also applies: every account must be an official @srmap.edu.in address. */
fun universityEmailError(email: String, domain: String): String? {
    val e = email.trim().lowercase()
    if (e.isEmpty()) return "Enter your university email"
    if (!Regex("^[^@\\s]+@[^@\\s]+$").matches(e)) return "Enter a valid email address"
    if (e.substringAfterLast('@') != domain) return "Use your @$domain email address"
    return null
}

fun passwordError(p: String, min: Int): String? = when {
    p.length < min -> "Use at least $min characters"
    !(p.any { it.isLowerCase() } && p.any { it.isUpperCase() } && p.any { it.isDigit() }) -> "Include upper and lower case letters and a number"
    else -> null
}

/**
 * Finishes a sign-in: stores the session (Keystore-encrypted), refreshes the profile and routes
 * to the right place (MFA, profile completion or the role's home).
 */
suspend fun completeSignIn(app: AppContainer, nav: NavHostController, resp: LoginResponse, rememberMe: Boolean = true) {
    val token = resp.sessionToken ?: throw ApiException(500, "no_token", "Sign-in did not return a session. Please update the app.")
    val user = resp.user ?: throw ApiException(500, "no_user", "Sign-in failed. Please try again.")
    app.session.signIn(token, user, rememberMe)
    val me = runCatching { app.api.auth.me() }.getOrNull()
    me?.let { app.session.updateUser(it.user) }
    val role = (me?.user ?: user).role
    // The API refuses this already (wrong_app); kept so an older API can't put a staff account in the
    // Student app or a student in the College app.
    if (!AppAudience.current.allows(role)) {
        app.session.clear()
        throw ApiException(403, "wrong_app", AppAudience.wrongAppMessage(role))
    }
    val target = when {
        // A staff applicant's restricted session only reaches the application screen.
        resp.applicationPending || (me?.user ?: user).approvalRequired -> Routes.StaffApplication
        resp.mfaRequired -> Routes.Mfa
        resp.needsMfaSetup -> Routes.Security
        resp.needsStudentId || (role == "student" && (me?.user ?: user).studentId.isNullOrBlank()) -> Routes.CompleteProfile
        else -> Routes.homeFor(role)
    }
    nav.navigate(target) { popUpTo(0) { inclusive = true } }
}
