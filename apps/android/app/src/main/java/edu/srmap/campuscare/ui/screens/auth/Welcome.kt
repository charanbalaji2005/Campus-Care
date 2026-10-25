package edu.srmap.campuscare.ui.screens.auth

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.automirrored.rounded.DirectionsWalk
import androidx.compose.material.icons.rounded.Forum
import androidx.compose.material.icons.rounded.NotificationsActive
import androidx.compose.material.icons.rounded.Psychology
import androidx.compose.material.icons.rounded.ReportProblem
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.BuildConfig
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.ui.components.CampusSkyline
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.IconBadge
import edu.srmap.campuscare.ui.components.LeafDecoration
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.ShieldMark
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.Wordmark
import edu.srmap.campuscare.ui.components.enterStagger
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.ui.theme.LocalReducedMotion
import edu.srmap.campuscare.util.openUrl
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.launch

/**
 * Animated splash: loads the remote configuration (minimum version, feature switches), restores the
 * session and routes by role. Works offline: a signed-in user still reaches the app and SOS.
 */
@Composable
fun SplashScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val reduced = LocalReducedMotion.current
    val logo = remember { Animatable(if (reduced) 1f else 0.6f) }
    val progress = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        launch { logo.animateTo(1f, tween(700, easing = FastOutSlowInEasing)) }
        launch { progress.animateTo(1f, tween(1600)) }
        val cfg = app.config.refresh()
        val destination: String = when {
            cfg?.update?.required == true -> Routes.UpdateRequired
            !app.onboardingSeen -> Routes.Onboarding
            !app.session.isSignedIn -> Routes.Login
            else -> try {
                val me = app.api.auth.me()
                app.session.updateUser(me.user)
                when {
                    me.user.role == "super_admin" -> {
                        app.session.clear()
                        Routes.Login
                    }
                    me.mfaRequired && !me.session.mfaVerified && me.user.mfaEnabled -> Routes.Mfa
                    me.user.role == "student" && me.user.studentId.isNullOrBlank() -> Routes.CompleteProfile
                    else -> Routes.homeFor(me.user.role)
                }
            } catch (e: ApiException) {
                // Offline: keep the cached session so SOS and emergency numbers stay reachable.
                val cached = app.session.user.value
                if (e.isNetwork && cached != null) Routes.homeFor(cached.role) else Routes.Login
            }
        }
        progress.animateTo(1f, tween(200))
        nav.navigate(destination) { popUpTo(Routes.Splash) { inclusive = true } }
    }
    Box(
        Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0xFFE6F4EC), CcColors.Cream))),
    ) {
        CampusSkyline(Modifier.fillMaxWidth().height(320.dp).align(Alignment.BottomCenter))
        Box(
            Modifier.fillMaxWidth().height(200.dp).align(Alignment.BottomCenter)
                .background(Brush.verticalGradient(listOf(Color.Transparent, CcColors.Forest.copy(alpha = 0.85f), CcColors.ForestDeep))),
        )
        Column(
            Modifier.fillMaxWidth().statusBarsPadding().padding(top = 110.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            ShieldMark(96.dp, modifier = Modifier.graphicsLayer { scaleX = logo.value; scaleY = logo.value; alpha = logo.value })
            Spacer(Modifier.height(14.dp))
            Wordmark(showMark = false)
            Spacer(Modifier.height(6.dp))
            Text("A Safer Campus", style = MaterialTheme.typography.titleMedium, color = CcColors.InkSoft)
            Text("A Brighter Tomorrow", style = MaterialTheme.typography.titleMedium, color = CcColors.InkSoft)
        }
        Column(
            Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 36.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("Students. Support. Safety.", style = MaterialTheme.typography.titleMedium, color = Color.White)
            Text("Together.", style = MaterialTheme.typography.headlineMedium, color = Color.White)
            Spacer(Modifier.height(14.dp))
            Box(Modifier.width(160.dp).height(5.dp).clip(RoundedCornerShape(3.dp)).background(Color.White.copy(alpha = 0.35f))) {
                Box(Modifier.fillMaxWidth(progress.value).height(5.dp).clip(RoundedCornerShape(3.dp)).background(Color.White))
            }
        }
    }
}

private data class Page(val title: String, val body: String, val features: List<Triple<ImageVector, String, String>>, val tone: Tone)

/** Three-page onboarding with animated indicators (as in the mockups). */
@Composable
fun OnboardingScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val scope = rememberCoroutineScope()
    val pages = remember {
        listOf(
            Page(
                "Your Safety\nOur Priority", "Report, get support, and build a more inclusive campus together.",
                listOf(Triple(Icons.Rounded.VisibilityOff, "Report anonymously", "Raise concerns safely and confidentially."), Triple(Icons.Rounded.ReportProblem, "Track every case", "See status updates and talk to the committee privately.")),
                Tone.Danger,
            ),
            Page(
                "Support That\nUnderstands", "Access counselling, guidance and committee assistance.",
                listOf(Triple(Icons.Rounded.Psychology, "Counselling support", "Talk to professionals in confidence."), Triple(Icons.AutoMirrored.Rounded.DirectionsWalk, "Safe Walk", "Share your journey in real time."), Triple(Icons.Rounded.Forum, "Campus community", "Connect, learn and stay informed.")),
                Tone.Violet,
            ),
            Page(
                "Help Is One\nTap Away", "A 10-second SOS alerts Campus Security and your trusted contacts — with your location if you allow it.",
                listOf(Triple(Icons.Rounded.NotificationsActive, "Live response tracking", "See when a responder acknowledges and is on the way.")),
                Tone.Brand,
            ),
        )
    }
    val pager = rememberPagerState(pageCount = { pages.size })
    fun finish() {
        app.onboardingSeen = true
        nav.navigate(Routes.Login) { popUpTo(Routes.Onboarding) { inclusive = true } }
    }
    Box(Modifier.fillMaxSize().background(CcColors.Cream)) {
        LeafDecoration(Modifier.fillMaxSize())
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            Row(Modifier.fillMaxWidth().padding(8.dp), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = { finish() }) { Text("Skip", color = CcColors.InkSoft) }
            }
            HorizontalPager(state = pager, modifier = Modifier.weight(1f)) { index ->
                val p = pages[index]
                Column(Modifier.fillMaxSize().padding(horizontal = 24.dp)) {
                    Text(p.title, style = MaterialTheme.typography.displayMedium, color = CcColors.Ink)
                    Spacer(Modifier.height(10.dp))
                    Text(p.body, style = MaterialTheme.typography.bodyLarge, color = CcColors.InkSoft)
                    Spacer(Modifier.height(18.dp))
                    Box(Modifier.fillMaxWidth().height(170.dp).clip(RoundedCornerShape(28.dp)).background(Brush.verticalGradient(listOf(Color(0xFFDDF3E8), Color(0xFFF1EBDC))))) {
                        CampusSkyline(Modifier.fillMaxSize())
                    }
                    Spacer(Modifier.height(16.dp))
                    p.features.forEachIndexed { i, (icon, title, body) ->
                        Row(
                            Modifier
                                .enterStagger(i)
                                .fillMaxWidth()
                                .padding(vertical = 5.dp)
                                .clip(RoundedCornerShape(20.dp))
                                .background(Color.White)
                                .padding(14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            IconBadge(icon, p.tone)
                            Spacer(Modifier.width(12.dp))
                            Column {
                                Text(title, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                                Text(body, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                            }
                        }
                    }
                }
            }
            Row(Modifier.fillMaxWidth().padding(24.dp), verticalAlignment = Alignment.CenterVertically) {
                Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    repeat(pages.size) { i ->
                        val active = pager.currentPage == i
                        val w by animateDpAsState(if (active) 26.dp else 8.dp, label = "dot")
                        val c by animateColorAsState(if (active) CcColors.Forest else CcColors.Line, label = "dotColor")
                        Box(Modifier.width(w).height(8.dp).clip(CircleShape).background(c))
                    }
                }
                FloatingActionButton(
                    onClick = { if (pager.currentPage == pages.lastIndex) finish() else scope.launch { pager.animateScrollToPage(pager.currentPage + 1) } },
                    containerColor = CcColors.Forest, contentColor = Color.White, shape = CircleShape,
                ) { Icon(Icons.AutoMirrored.Rounded.ArrowForward, contentDescription = if (pager.currentPage == pages.lastIndex) "Get started" else "Next") }
            }
        }
    }
}

/** Shown when the Super Admin raised the minimum supported app version. */
@Composable
fun UpdateRequiredScreen() {
    val app = LocalApp.current
    val context = LocalContext.current
    val update = app.config.config.value.update
    AuthLayout("Update required", update.message.ifBlank { "This version of CampusCare is no longer supported." }) {
        Text("You have version ${BuildConfig.VERSION_NAME}. The latest is ${update.latestVersionName}.", style = MaterialTheme.typography.bodyMedium, color = CcColors.InkSoft)
        update.downloadUrl?.let { url -> CcButton("Download the update", { context.openUrl(url) }) }
        Text(
            "In an emergency you can still call 112 or Campus Security directly.",
            style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft, fontWeight = FontWeight.Medium,
        )
        Spacer(Modifier.size(4.dp))
    }
}
