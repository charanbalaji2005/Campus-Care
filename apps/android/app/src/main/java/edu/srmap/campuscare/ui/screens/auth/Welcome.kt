package edu.srmap.campuscare.ui.screens.auth

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.PageSize
import androidx.compose.foundation.pager.PagerState
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Eco
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.Phone
import androidx.compose.material.icons.rounded.School
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
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
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import edu.srmap.campuscare.BuildConfig
import edu.srmap.campuscare.R
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.ui.components.CampusSkyline
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.Divider
import edu.srmap.campuscare.ui.components.LeafDecoration
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.ShieldMark
import edu.srmap.campuscare.ui.components.Wordmark
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.ui.theme.DisplayFamily
import edu.srmap.campuscare.ui.theme.LocalReducedMotion
import edu.srmap.campuscare.util.openUrl
import kotlinx.coroutines.launch

/** Exact brand tokens matching the reference mockup. */
object GetStartedTokens {
    val Cream = Color(0xFFF8F5EC)
    val DeepEmerald = Color(0xFF075743)
    val SecondaryGreen = Color(0xFF07966F)
    val MintAccent = Color(0xFFDDF4E4)
    val MintLight = Color(0xFFEBF7EE)
    val HeadingGreen = Color(0xFF153D34)
    val BodyText = Color(0xFF68756F)
    val CardBg = Color(0xFFFFFEFA)
    val Border = Color(0xFFE7E4D8)
    val EmergencyRed = Color(0xFFE63946)
    val SoftPeach = Color(0xFFFFF0EB)
    val SoftPeachBorder = Color(0xFFFCD5C8)
    val SoftAmber = Color(0xFFFFF2D9)
    val SoftAmberBorder = Color(0xFFFBE4B9)
    val SoftSky = Color(0xFFE8F4F8)
    val SoftSkyBorder = Color(0xFFD0E9F2)
    val SparkGold = Color(0xFFFDE68A)
}

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
                app.session.recordAppOpen()
                when {
                    me.user.role == "super_admin" -> Routes.CounsellorHome
                    me.mfaRequired && !me.session.mfaVerified && me.user.mfaEnabled -> Routes.Mfa
                    me.user.role == "student" && me.user.studentId.isNullOrBlank() -> Routes.CompleteProfile
                    else -> Routes.homeFor(me.user.role)
                }
            } catch (e: ApiException) {
                if (e.isNetwork || e.status >= 500) {
                    // Server offline: preserve remembered session & cached profile without claiming online validation
                    app.session.user.value?.role?.let { Routes.homeFor(it) } ?: Routes.Login
                } else {
                    // Explicit server rejection (401 session expired/revoked, 403 suspended/deactivated)
                    app.session.clear(edu.srmap.campuscare.data.SessionEvent.Expired)
                    Routes.Login
                }
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

/**
 * Top header with Shield mark, two-tone CampusCare wordmark, and translucent pill Sign In button.
 */
@Composable
fun CampusCareHeader(
    onSignInClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ShieldMark(size = 38.dp)
            Spacer(Modifier.width(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "Campus",
                    style = MaterialTheme.typography.headlineMedium,
                    fontFamily = DisplayFamily,
                    fontWeight = FontWeight.Bold,
                    color = GetStartedTokens.HeadingGreen,
                )
                Text(
                    "Care",
                    style = MaterialTheme.typography.headlineMedium,
                    fontFamily = DisplayFamily,
                    fontWeight = FontWeight.Bold,
                    color = GetStartedTokens.SecondaryGreen,
                )
            }
        }

        Surface(
            onClick = onSignInClick,
            shape = RoundedCornerShape(22.dp),
            color = Color.White.copy(alpha = 0.9f),
            border = BorderStroke(1.dp, GetStartedTokens.Border),
            shadowElevation = 0.dp,
        ) {
            Text(
                "Sign in",
                modifier = Modifier.padding(horizontal = 18.dp, vertical = 8.dp),
                style = MaterialTheme.typography.labelLarge,
                color = GetStartedTokens.HeadingGreen,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

/**
 * Trust badge with leaf icon: "A SAFER, KINDER CAMPUS".
 */
@Composable
fun TrustBadge(modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(16.dp),
        color = GetStartedTokens.MintLight,
        border = BorderStroke(1.dp, Color(0xFFD4EED8)),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.Rounded.Eco,
                contentDescription = null,
                tint = GetStartedTokens.SecondaryGreen,
                modifier = Modifier.size(14.dp),
            )
            Spacer(Modifier.width(5.dp))
            Text(
                "A SAFER, KINDER CAMPUS",
                style = MaterialTheme.typography.labelSmall,
                color = GetStartedTokens.HeadingGreen,
                fontWeight = FontWeight.Bold,
                letterSpacing = 0.5.sp,
            )
        }
    }
}

/**
 * Decorative curved underline beneath the hero keyword "listens".
 */
@Composable
fun CurvedUnderline(modifier: Modifier = Modifier, color: Color = GetStartedTokens.SecondaryGreen) {
    Canvas(modifier = modifier.height(8.dp)) {
        val w = size.width
        val h = size.height
        val path = Path().apply {
            moveTo(2f, h * 0.35f)
            quadraticTo(w * 0.5f, h * 0.95f, w - 2f, h * 0.45f)
        }
        drawPath(
            path = path,
            color = color,
            style = Stroke(width = 3.5.dp.toPx(), cap = StrokeCap.Round),
        )
    }
}

/**
 * Hero section: trust badge, expressive heading with decorative swoop,
 * description, overlapping student avatars, and 3D student illustration with floating elements.
 */
@Composable
fun HeroSection(modifier: Modifier = Modifier) {
    val reducedMotion = LocalReducedMotion.current
    val infiniteTransition = rememberInfiniteTransition(label = "heroFloat")
    val studentFloat by if (reducedMotion) {
        remember { Animatable(0f) }.asState()
    } else {
        infiniteTransition.animateFloat(
            initialValue = -3f,
            targetValue = 3f,
            animationSpec = infiniteRepeatable(tween(2800, easing = FastOutSlowInEasing), RepeatMode.Reverse),
            label = "studentFloat",
        )
    }
    val badgeFloat by if (reducedMotion) {
        remember { Animatable(0f) }.asState()
    } else {
        infiniteTransition.animateFloat(
            initialValue = -4f,
            targetValue = 4f,
            animationSpec = infiniteRepeatable(tween(2200, easing = FastOutSlowInEasing), RepeatMode.Reverse),
            label = "badgeFloat",
        )
    }

    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // Left Column (Text & Trust social proof)
        Column(
            modifier = Modifier.weight(1.15f),
        ) {
            TrustBadge()
            Spacer(Modifier.height(10.dp))
            Column {
                Text(
                    "Support",
                    style = MaterialTheme.typography.displayMedium,
                    fontFamily = DisplayFamily,
                    fontWeight = FontWeight.Bold,
                    color = GetStartedTokens.HeadingGreen,
                    lineHeight = 36.sp,
                )
                Row(verticalAlignment = Alignment.Bottom) {
                    Text(
                        "that ",
                        style = MaterialTheme.typography.displayMedium,
                        fontFamily = DisplayFamily,
                        fontWeight = FontWeight.Bold,
                        color = GetStartedTokens.HeadingGreen,
                        lineHeight = 36.sp,
                    )
                    Column {
                        Text(
                            "listens",
                            style = MaterialTheme.typography.displayMedium,
                            fontFamily = DisplayFamily,
                            fontWeight = FontWeight.Bold,
                            color = GetStartedTokens.SecondaryGreen,
                            lineHeight = 36.sp,
                        )
                        CurvedUnderline(Modifier.width(105.dp))
                    }
                }
            }
            Spacer(Modifier.height(10.dp))
            Text(
                "Report concerns privately, chat with the committee, or book a confidential counsellor.",
                style = MaterialTheme.typography.bodyMedium,
                color = GetStartedTokens.BodyText,
                lineHeight = 19.sp,
            )
            Spacer(Modifier.height(12.dp))
            // Overlapping Student Avatars
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(contentAlignment = Alignment.CenterStart) {
                    val avatarColors = listOf(
                        Color(0xFF0D9488) to "A",
                        Color(0xFF075743) to "K",
                        Color(0xFFD97706) to "S",
                    )
                    avatarColors.forEachIndexed { index, (color, initial) ->
                        Box(
                            modifier = Modifier
                                .padding(start = (index * 17).dp)
                                .size(24.dp)
                                .clip(CircleShape)
                                .background(color)
                                .border(1.5.dp, Color.White, CircleShape),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                initial,
                                color = Color.White,
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Bold,
                            )
                        }
                    }
                    Box(
                        modifier = Modifier
                            .padding(start = 51.dp)
                            .size(24.dp)
                            .clip(CircleShape)
                            .background(Color(0xFFE5E0D4))
                            .border(1.5.dp, Color.White, CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            "+",
                            color = GetStartedTokens.HeadingGreen,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
                Spacer(Modifier.width(10.dp))
                Text(
                    "Trusted by students\nacross SRM AP",
                    style = MaterialTheme.typography.labelSmall,
                    color = GetStartedTokens.BodyText,
                    lineHeight = 14.sp,
                )
            }
        }

        // Right Column: High Quality 3D Student Illustration with floating elements
        Box(
            modifier = Modifier
                .weight(0.95f)
                .height(230.dp),
            contentAlignment = Alignment.Center,
        ) {
            // Background soft circular glow
            Box(
                modifier = Modifier
                    .size(190.dp)
                    .clip(CircleShape)
                    .background(
                        Brush.radialGradient(
                            listOf(Color(0xFFDDF4E4).copy(alpha = 0.7f), Color.Transparent),
                        ),
                    ),
            )

            // Main student illustration
            Image(
                painter = painterResource(R.drawable.hero_student_3d),
                contentDescription = "Student safely using CampusCare support platform on laptop",
                modifier = Modifier
                    .size(200.dp)
                    .offset(y = studentFloat.dp)
                    .clip(RoundedCornerShape(28.dp)),
                contentScale = ContentScale.Crop,
            )

            // Floating 3D Heart badge
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .offset(x = (-4).dp, y = (12 + badgeFloat).dp)
                    .size(28.dp)
                    .shadow(4.dp, CircleShape)
                    .clip(CircleShape)
                    .background(Color.White),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Rounded.Favorite,
                    contentDescription = null,
                    tint = GetStartedTokens.EmergencyRed,
                    modifier = Modifier.size(16.dp),
                )
            }

            // Floating 3D Shield badge
            Box(
                modifier = Modifier
                    .align(Alignment.CenterStart)
                    .offset(x = 6.dp, y = (-20 - badgeFloat).dp)
                    .size(26.dp)
                    .shadow(4.dp, CircleShape)
                    .clip(CircleShape)
                    .background(Color.White),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Rounded.Shield,
                    contentDescription = null,
                    tint = GetStartedTokens.SecondaryGreen,
                    modifier = Modifier.size(15.dp),
                )
            }
        }
    }
}

/**
 * Large glass-like university card. Clicking initiates registration.
 */
@Composable
fun UniversitySignupCard(
    domain: String = "srmap.edu.in",
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        onClick = onClick,
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 6.dp),
        shape = RoundedCornerShape(24.dp),
        color = GetStartedTokens.CardBg,
        border = BorderStroke(1.dp, GetStartedTokens.Border),
        shadowElevation = 2.dp,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Emerald graduation-cap tile
            Box(
                modifier = Modifier
                    .size(46.dp)
                    .clip(CircleShape)
                    .background(GetStartedTokens.DeepEmerald),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Rounded.School,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(24.dp),
                )
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    "SRM University-AP",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = GetStartedTokens.HeadingGreen,
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    "Sign up with your @$domain email",
                    style = MaterialTheme.typography.bodySmall,
                    color = GetStartedTokens.BodyText,
                )
            }
            // Verified badge
            Icon(
                Icons.Rounded.CheckCircle,
                contentDescription = "Verified domain",
                tint = GetStartedTokens.SecondaryGreen,
                modifier = Modifier.size(22.dp),
            )
            Spacer(Modifier.width(6.dp))
            Icon(
                Icons.AutoMirrored.Rounded.KeyboardArrowRight,
                contentDescription = null,
                tint = GetStartedTokens.BodyText.copy(alpha = 0.7f),
                modifier = Modifier.size(20.dp),
            )
        }
    }
}

/** Single feature card in the carousel with rich 3D illustration and interactive arrow action. */
@Composable
fun FeatureCard(
    title: String,
    description: String,
    illustrationRes: Int,
    accentColor: Color,
    gradientColors: List<Color>,
    borderColor: Color,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        onClick = onClick,
        modifier = modifier
            .width(185.dp)
            .height(210.dp),
        shape = RoundedCornerShape(22.dp),
        border = BorderStroke(1.dp, borderColor),
        color = Color.Transparent,
        shadowElevation = 1.dp,
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Brush.verticalGradient(gradientColors))
                .padding(14.dp),
        ) {
            // Top right mini shield tag
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .size(24.dp)
                    .clip(CircleShape)
                    .background(Color.White.copy(alpha = 0.9f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Rounded.Shield,
                    contentDescription = null,
                    tint = accentColor,
                    modifier = Modifier.size(13.dp),
                )
            }

            Column(
                modifier = Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.SpaceBetween,
            ) {
                // Centered 3D illustration
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(95.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Image(
                        painter = painterResource(illustrationRes),
                        contentDescription = title,
                        modifier = Modifier.size(85.dp),
                        contentScale = ContentScale.Fit,
                    )
                }

                // Title, description and bottom-right arrow button
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.Bottom,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            title,
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.Bold,
                            color = GetStartedTokens.HeadingGreen,
                            lineHeight = 17.sp,
                        )
                        Spacer(Modifier.height(3.dp))
                        Text(
                            description,
                            style = MaterialTheme.typography.bodySmall,
                            color = GetStartedTokens.BodyText,
                            fontSize = 11.sp,
                            lineHeight = 15.sp,
                            maxLines = 2,
                        )
                    }
                    Spacer(Modifier.width(6.dp))
                    Box(
                        modifier = Modifier
                            .size(28.dp)
                            .clip(CircleShape)
                            .background(Color.White)
                            .border(1.dp, borderColor, CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            Icons.AutoMirrored.Rounded.ArrowForward,
                            contentDescription = null,
                            tint = accentColor,
                            modifier = Modifier.size(14.dp),
                        )
                    }
                }
            }
        }
    }
}

private data class FeatureItem(
    val title: String,
    val description: String,
    val illustrationRes: Int,
    val accentColor: Color,
    val gradientColors: List<Color>,
    val borderColor: Color,
    val route: String,
)

/**
 * "What you can do" feature carousel with page counter, snapping pager, and navigation controls.
 */
@Composable
fun FeatureCarousel(
    onFeatureClick: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val scope = rememberCoroutineScope()
    val features = remember {
        listOf(
            FeatureItem(
                title = "Emergency SOS",
                description = "Get immediate help in critical situations",
                illustrationRes = R.drawable.feature_sos_3d,
                accentColor = GetStartedTokens.EmergencyRed,
                gradientColors = listOf(Color(0xFFFFF0EB), Color(0xFFFFF8F5)),
                borderColor = GetStartedTokens.SoftPeachBorder,
                route = Routes.OfflineEmergency,
            ),
            FeatureItem(
                title = "Report a Concern",
                description = "Share issues with your committee",
                illustrationRes = R.drawable.feature_report_3d,
                accentColor = GetStartedTokens.SecondaryGreen,
                gradientColors = listOf(Color(0xFFEBF7EE), Color(0xFFF5FAF6)),
                borderColor = Color(0xFFD4EED8),
                route = Routes.Report,
            ),
            FeatureItem(
                title = "Confidential Counselling",
                description = "Book a session and talk privately",
                illustrationRes = R.drawable.feature_counsel_3d,
                accentColor = Color(0xFFD97706),
                gradientColors = listOf(Color(0xFFFFF2D9), Color(0xFFFFF9EE)),
                borderColor = GetStartedTokens.SoftAmberBorder,
                route = Routes.Counselling,
            ),
            FeatureItem(
                title = "Campus Community",
                description = "Stay connected and informed",
                illustrationRes = R.drawable.feature_community_3d,
                accentColor = Color(0xFF0D9488),
                gradientColors = listOf(Color(0xFFE8F4F8), Color(0xFFF3F9FB)),
                borderColor = GetStartedTokens.SoftSkyBorder,
                route = Routes.Community,
            ),
        )
    }

    val pagerState = rememberPagerState(pageCount = { features.size })

    Column(modifier = modifier.fillMaxWidth()) {
        // Section Header Row
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                "What you can do",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                color = GetStartedTokens.HeadingGreen,
            )

            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "${features.size} tools",
                    style = MaterialTheme.typography.bodySmall,
                    color = GetStartedTokens.BodyText,
                    fontWeight = FontWeight.Medium,
                )
                Spacer(Modifier.width(8.dp))
                // Left arrow
                Surface(
                    onClick = {
                        if (pagerState.currentPage > 0) {
                            scope.launch { pagerState.animateScrollToPage(pagerState.currentPage - 1) }
                        }
                    },
                    shape = CircleShape,
                    color = Color.White.copy(alpha = 0.85f),
                    border = BorderStroke(1.dp, GetStartedTokens.Border),
                    modifier = Modifier.size(26.dp),
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            Icons.AutoMirrored.Rounded.KeyboardArrowLeft,
                            contentDescription = "Previous feature",
                            tint = GetStartedTokens.HeadingGreen,
                            modifier = Modifier.size(16.dp),
                        )
                    }
                }
                Spacer(Modifier.width(4.dp))
                // Right arrow
                Surface(
                    onClick = {
                        if (pagerState.currentPage < features.lastIndex) {
                            scope.launch { pagerState.animateScrollToPage(pagerState.currentPage + 1) }
                        }
                    },
                    shape = CircleShape,
                    color = Color.White.copy(alpha = 0.85f),
                    border = BorderStroke(1.dp, GetStartedTokens.Border),
                    modifier = Modifier.size(26.dp),
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            Icons.AutoMirrored.Rounded.KeyboardArrowRight,
                            contentDescription = "Next feature",
                            tint = GetStartedTokens.HeadingGreen,
                            modifier = Modifier.size(16.dp),
                        )
                    }
                }
            }
        }

        // Horizontal Carousel
        HorizontalPager(
            state = pagerState,
            pageSize = PageSize.Fixed(185.dp),
            contentPadding = PaddingValues(horizontal = 20.dp),
            pageSpacing = 12.dp,
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 4.dp),
        ) { page ->
            val item = features[page]
            FeatureCard(
                title = item.title,
                description = item.description,
                illustrationRes = item.illustrationRes,
                accentColor = item.accentColor,
                gradientColors = item.gradientColors,
                borderColor = item.borderColor,
                onClick = { onFeatureClick(item.route) },
            )
        }

        // Indicator Dots
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 8.dp, bottom = 4.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            repeat(features.size) { i ->
                val active = pagerState.currentPage == i
                val dotWidth by animateDpAsState(if (active) 22.dp else 7.dp, label = "dotW")
                val dotColor by animateColorAsState(
                    if (active) GetStartedTokens.DeepEmerald else Color(0xFFD5DDD8),
                    label = "dotC",
                )
                Box(
                    modifier = Modifier
                        .padding(horizontal = 3.dp)
                        .width(dotWidth)
                        .height(7.dp)
                        .clip(CircleShape)
                        .background(dotColor),
                )
            }
        }
    }
}

/**
 * Prominent full-width emerald gradient "Get started" button with gold sparkle and circular arrow.
 */
@Composable
fun PrimaryGetStartedButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        onClick = onClick,
        modifier = modifier
            .fillMaxWidth()
            .height(58.dp)
            .padding(horizontal = 20.dp),
        shape = RoundedCornerShape(29.dp),
        color = Color.Transparent,
        shadowElevation = 3.dp,
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.horizontalGradient(
                        listOf(
                            GetStartedTokens.DeepEmerald,
                            Color(0xFF064736),
                            Color(0xFF043427),
                        ),
                    ),
                )
                .padding(horizontal = 20.dp),
            contentAlignment = Alignment.Center,
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Icon(
                    Icons.Rounded.AutoAwesome,
                    contentDescription = null,
                    tint = GetStartedTokens.SparkGold,
                    modifier = Modifier.size(24.dp),
                )

                Text(
                    "Get started",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                    fontSize = 17.sp,
                )

                Box(
                    modifier = Modifier
                        .size(38.dp)
                        .clip(CircleShape)
                        .background(Color.White.copy(alpha = 0.22f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.AutoMirrored.Rounded.ArrowForward,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(20.dp),
                    )
                }
            }
        }
    }
}

/**
 * Secondary action: "I already have an account" flanked by subtle divider lines.
 */
@Composable
fun ExistingAccountAction(
    onSignInClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 24.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Divider(modifier = Modifier.weight(1f))
        TextButton(
            onClick = onSignInClick,
            modifier = Modifier.padding(horizontal = 6.dp),
        ) {
            Text(
                "I already have an account",
                style = MaterialTheme.typography.labelLarge,
                color = GetStartedTokens.DeepEmerald,
                fontWeight = FontWeight.SemiBold,
            )
        }
        Divider(modifier = Modifier.weight(1f))
    }
}

/**
 * Emergency access button: "Emergency? Call without signing in".
 */
@Composable
fun EmergencyAccessButton(
    onEmergencyClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        onClick = onEmergencyClick,
        modifier = modifier
            .fillMaxWidth()
            .height(46.dp)
            .padding(horizontal = 28.dp),
        shape = RoundedCornerShape(23.dp),
        color = GetStartedTokens.SoftPeach,
        border = BorderStroke(1.dp, Color(0xFFFECACA)),
        shadowElevation = 0.dp,
    ) {
        Row(
            modifier = Modifier.fillMaxSize(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            Icon(
                Icons.Rounded.Phone,
                contentDescription = null,
                tint = GetStartedTokens.EmergencyRed,
                modifier = Modifier.size(17.dp),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                "Emergency? Call without signing in",
                style = MaterialTheme.typography.bodyMedium,
                color = GetStartedTokens.EmergencyRed,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

/**
 * Main Get Started / Onboarding screen. Fully production-ready, supporting all device sizes,
 * system bars, accessibility, animations, and deep navigation into app flows.
 */
@Composable
fun GetStartedScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val settings = app.config.config.value.settings
    val domain = settings.accountEmailDomain.ifBlank { "srmap.edu.in" }

    fun navigateToRegister() {
        app.onboardingSeen = true
        nav.navigate(Routes.Register)
    }

    fun navigateToSignIn() {
        app.onboardingSeen = true
        nav.navigate(Routes.Login)
    }

    fun navigateToEmergency() {
        nav.navigate(Routes.OfflineEmergency)
    }

    fun handleFeatureRoute(targetRoute: String) {
        if (targetRoute == Routes.OfflineEmergency) {
            navigateToEmergency()
        } else if (app.session.isSignedIn) {
            nav.navigate(targetRoute)
        } else {
            navigateToRegister()
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(GetStartedTokens.Cream),
    ) {
        // Decorative background leaves in corners
        LeafDecoration(Modifier.fillMaxSize())

        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // A. Top Header
            CampusCareHeader(onSignInClick = { navigateToSignIn() })

            // B. Hero Section
            HeroSection()

            // C. University Verification Card
            UniversitySignupCard(
                domain = domain,
                onClick = { navigateToRegister() },
            )

            Spacer(Modifier.height(8.dp))

            // D. "What You Can Do" Feature Carousel
            FeatureCarousel(
                onFeatureClick = { route -> handleFeatureRoute(route) },
            )

            Spacer(Modifier.height(10.dp))

            // E. Primary "Get started" Button
            PrimaryGetStartedButton(onClick = { navigateToRegister() })

            // F. Existing Account Action
            ExistingAccountAction(onSignInClick = { navigateToSignIn() })

            // G. Emergency Access Action
            EmergencyAccessButton(onEmergencyClick = { navigateToEmergency() })

            Spacer(Modifier.height(20.dp))
        }
    }
}

/**
 * OnboardingScreen is an alias / wrapper for GetStartedScreen to maintain full compatibility
 * with existing splash routing and deep links.
 */
@Composable
fun OnboardingScreen() {
    GetStartedScreen()
}

/** Shown when the Super Admin raised the minimum supported app version. */
@Composable
fun UpdateRequiredScreen() {
    val app = LocalApp.current
    val context = LocalContext.current
    val update = app.config.config.value.update
    edu.srmap.campuscare.ui.screens.auth.AuthLayout("Update required", update.message.ifBlank { "This version of CampusCare is no longer supported." }) {
        Text("You have version ${BuildConfig.VERSION_NAME}. The latest is ${update.latestVersionName}.", style = MaterialTheme.typography.bodyMedium, color = CcColors.InkSoft)
        update.downloadUrl?.let { url -> CcButton("Download the update", { context.openUrl(url) }) }
        Text(
            "In an emergency you can still call 112 or Campus Security directly.",
            style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft, fontWeight = FontWeight.Medium,
        )
        Spacer(Modifier.size(4.dp))
    }
}
