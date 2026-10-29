package edu.srmap.campuscare.ui.screens.auth

import edu.srmap.campuscare.AppAudience
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.rounded.Badge
import androidx.compose.material.icons.rounded.Email
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Pin
import androidx.compose.material.icons.rounded.School
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.Phone
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.MarkEmailRead
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.MessageResponse
import edu.srmap.campuscare.data.VerificationStatus
import edu.srmap.campuscare.ui.components.popIn
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.runtime.mutableIntStateOf
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcSelect
import edu.srmap.campuscare.ui.components.CcTextField
import edu.srmap.campuscare.ui.components.Catalog
import edu.srmap.campuscare.ui.components.IconBadge
import edu.srmap.campuscare.ui.components.InfoBanner
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.PasswordStrength
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.TurnstileHost
import edu.srmap.campuscare.ui.components.TurnstileInline
import edu.srmap.campuscare.ui.components.TurnstilePhase
import edu.srmap.campuscare.ui.components.rememberTurnstile
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.GoogleFailure
import edu.srmap.campuscare.util.GoogleIntent
import edu.srmap.campuscare.util.GoogleRefusal
import edu.srmap.campuscare.util.GoogleRefusals
import edu.srmap.campuscare.util.GoogleResult
import edu.srmap.campuscare.util.GoogleSignIn
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun LoginScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val settings = app.config.config.value.settings
    val domain = settings.accountEmailDomain
    val turnstile = rememberTurnstile("login")
    val savedEmail = remember { app.rememberedEmail ?: "" }
    var email by rememberSaveable { mutableStateOf(savedEmail) }
    var rememberMe by rememberSaveable { mutableStateOf(savedEmail.isNotBlank()) }
    var password by remember { mutableStateOf("") }
    var mfaCode by remember { mutableStateOf("") }
    var needMfa by remember { mutableStateOf(false) }
    var challengeToken by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var unverified by remember { mutableStateOf(false) }
    var verificationTicket by remember { mutableStateOf<String?>(null) }
    var emailError by remember { mutableStateOf<String?>(null) }

    fun submit() {
        if (busy) return // no duplicate sign-in requests
        val challenge = challengeToken
        if (needMfa && challenge != null) {
            // Second step: the password and Turnstile were already verified; the server's single-use
            // challenge stands in for them, so there is no second security check to wait for.
            if (mfaCode.length != 6) return
            scope.launch {
                busy = true
                error = null
                try {
                    val resp = app.api.auth.mfaChallenge(challenge, mfaCode)
                    // After Google the email field may be empty: keep what was remembered before.
                    if (email.isNotBlank()) app.rememberedEmail = if (rememberMe) email.trim().lowercase() else null
                    completeSignIn(app, nav, resp, rememberMe)
                } catch (e: ApiException) {
                    if (e.code == "mfa_challenge_expired") {
                        needMfa = false
                        challengeToken = null
                        mfaCode = ""
                    }
                    error = e.message
                } finally {
                    busy = false
                }
            }
            return
        }
        emailError = universityEmailError(email, domain)
        if (emailError != null || password.isEmpty()) return
        turnstile.run { token ->
            scope.launch {
                busy = true
                error = null
                try {
                    val resp = app.api.auth.login(email.trim().lowercase(), password, mfaCode.takeIf { needMfa && it.length == 6 }, token)
                    if (resp.mfaRequired && resp.sessionToken == null) {
                        needMfa = true
                        challengeToken = resp.challengeToken
                    } else {
                        app.rememberedEmail = if (rememberMe) email.trim().lowercase() else null
                        completeSignIn(app, nav, resp)
                    }
                } catch (e: ApiException) {
                    unverified = e.code == "email_not_verified"
                    verificationTicket = e.details["verificationTicket"]?.takeIf { unverified && it.isNotBlank() }
                    error = e.message
                } finally {
                    busy = false
                }
            }
        }
    }

    val college = AppAudience.current == AppAudience.College
    AuthLayout("Welcome Back", if (college) "CampusCare College · sign in with your staff account" else "CampusCare Student · sign in to a safer campus") {
        CcTextField(email, { email = it; emailError = null }, label = "University email", placeholder = "you@$domain", leadingIcon = Icons.Rounded.Email, keyboardType = KeyboardType.Email, error = emailError)
        // Once the first factor passed (password or Google), only the code is asked for.
        if (challengeToken == null) {
            CcTextField(password, { password = it }, label = "Password", placeholder = "Enter your password", leadingIcon = Icons.Rounded.Lock, password = true, imeAction = if (needMfa) ImeAction.Next else ImeAction.Done, onImeAction = { if (!needMfa) submit() })
        }
        if (needMfa) {
            CcTextField(mfaCode, { if (it.length <= 6 && it.all(Char::isDigit)) mfaCode = it }, label = "6-digit code from your authenticator", leadingIcon = Icons.Rounded.Pin, keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Done, onImeAction = { submit() })
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .clickable { rememberMe = !rememberMe }
                    .padding(vertical = 4.dp, horizontal = 2.dp)
            ) {
                Checkbox(
                    checked = rememberMe,
                    onCheckedChange = { rememberMe = it },
                    colors = CheckboxDefaults.colors(
                        checkedColor = CcColors.Emerald,
                        checkmarkColor = Color.White,
                        uncheckedColor = CcColors.InkFaint
                    )
                )
                Spacer(Modifier.width(4.dp))
                Text(
                    text = "Remember me",
                    style = MaterialTheme.typography.bodyMedium,
                    color = CcColors.InkSoft,
                    fontWeight = FontWeight.Medium
                )
            }
            TextButton(onClick = { nav.navigate(Routes.Forgot) }) {
                Text("Forgot password?", color = CcColors.Emerald, fontWeight = FontWeight.SemiBold)
            }
        }
        error?.let {
            InfoBanner(it, tone = Tone.Danger, icon = Icons.Rounded.Warning, action = if (unverified) ({
                TextButton(onClick = { nav.navigate(Routes.verify(email = email.trim().lowercase(), ticket = verificationTicket)) }) { Text("Verify your email") }
            }) else null)
        }
        // Verifies in the background while the form is filled in; the code step does not need it.
        if (!needMfa || challengeToken == null) TurnstileInline(turnstile)
        val waitingForCheck = turnstile.pending != null && turnstile.phase != TurnstilePhase.Failed
        CcButton(if (waitingForCheck) "Verifying…" else "Sign In", { submit() }, modifier = Modifier.fillMaxWidth(), loading = busy || waitingForCheck, trailingIcon = Icons.AutoMirrored.Rounded.ArrowForward)
        if (GoogleSignIn.configured) {
            Text("or continue with", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
            // Google is the first factor only for accounts with two-step verification: the code step above takes over.
            GoogleAuthBlock(GoogleIntent.SignIn, rememberMe) { challenge ->
                error = null
                needMfa = true
                challengeToken = challenge
            }
        }
        if (college) {
            // Staff apply for a role here; nothing is granted until a Super Admin approves the request.
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                Text("New college staff?", style = MaterialTheme.typography.bodyMedium, color = CcColors.InkSoft)
                TextButton(onClick = { nav.navigate(Routes.staffRegister()) }) {
                    Text("Register as College Staff", color = CcColors.Emerald, fontWeight = FontWeight.Bold)
                }
            }
            Text(
                "Invited by your administrator? Open the invitation email on this phone to set your password. Students use the ${AppAudience.Student.appName} app.",
                style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
            )
        } else {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                Text("Don't have an account?", style = MaterialTheme.typography.bodyMedium, color = CcColors.InkSoft)
                TextButton(onClick = { nav.navigate(Routes.Register) }, enabled = settings.registrationOpen) {
                    Text(if (settings.registrationOpen) "Create Account" else "Registration closed", color = CcColors.Emerald, fontWeight = FontWeight.Bold)
                }
            }
        }
        TextButton(onClick = { nav.navigate(Routes.OfflineEmergency) }, modifier = Modifier.fillMaxWidth()) {
            Text("Emergency? Call for help without signing in", color = CcColors.Sos, fontWeight = FontWeight.SemiBold)
        }
    }
    TurnstileHost(turnstile)
}

/** Simple four-colour "G" mark. */
@Composable
private fun GoogleG() {
    Box(Modifier.size(22.dp).clip(CircleShape).background(Color.White), contentAlignment = Alignment.Center) {
        Text("G", color = Color(0xFF4285F4), fontWeight = FontWeight.Black, style = MaterialTheme.typography.titleMedium)
    }
}

/**
 * "Continue with Google" for both apps: the native account picker (never a website), then
 * POST /auth/google/mobile with what the person chose. The server decides what this Google account
 * may do in this app; this only shows its answer. [onMfaChallenge] receives the second-step ticket for
 * accounts with two-step verification (no session exists until the code is entered).
 */
@Composable
private fun GoogleAuthBlock(intent: GoogleIntent, rememberMe: Boolean, onMfaChallenge: (String) -> Unit) {
    val app = LocalApp.current
    val nav = LocalNav.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    /** Last problem, shown in place with the one action that can help. */
    var failure by remember { mutableStateOf<GoogleResult.Failed?>(null) }
    var refusal by remember { mutableStateOf<GoogleRefusal?>(null) }

    fun run(chosen: GoogleIntent) {
        if (busy) return
        scope.launch {
            busy = true
            failure = null
            refusal = null
            try {
                when (val r = GoogleSignIn.signIn(context)) {
                    is GoogleResult.Token -> try {
                        val resp = app.api.auth.google(r.idToken, r.nonce, rememberMe, chosen.wire)
                        val challenge = resp.challengeToken
                        if (resp.mfaRequired && resp.sessionToken == null && challenge != null) onMfaChallenge(challenge)
                        else completeSignIn(app, nav, resp, rememberMe)
                    } catch (e: ApiException) {
                        when (val g = GoogleRefusals.from(AppAudience.current, e.status, e.code, e.message, e.details)) {
                            is GoogleRefusal.ApplyAsStaff -> nav.navigate(Routes.staffRegister(g.ticket, g.email, g.fullName))
                            is GoogleRefusal.Retry -> failure = GoogleResult.Failed(GoogleFailure.Other, g.message)
                            else -> refusal = g
                        }
                    }
                    is GoogleResult.Failed -> failure = r
                    GoogleResult.Cancelled -> Unit
                }
            } finally {
                busy = false
            }
        }
    }

    failure?.let { g ->
        InfoBanner(
            g.message, tone = Tone.Danger, icon = Icons.Rounded.Warning,
            action = if (g.retryable) ({ TextButton(onClick = { run(intent) }) { Text("Try again") } }) else null,
        )
    }
    refusal?.let { g ->
        InfoBanner(
            g.message, tone = Tone.Danger, icon = Icons.Rounded.Warning,
            action = when (g) {
                is GoogleRefusal.OfferStudentSignUp -> ({ TextButton(onClick = { run(GoogleIntent.SignUp) }) { Text("Sign up with Google") } })
                is GoogleRefusal.VerifyEmail -> ({ TextButton(onClick = { nav.navigate(Routes.verify(ticket = g.ticket)) }) { Text("Verify your email") } })
                else -> null
            },
        )
    }
    OutlinedButton(
        onClick = { run(intent) },
        enabled = !busy,
        modifier = Modifier.fillMaxWidth().height(52.dp),
        shape = RoundedCornerShape(16.dp),
        border = BorderStroke(1.dp, CcColors.Line),
    ) {
        GoogleG()
        Spacer(Modifier.width(10.dp))
        Text(
            when {
                busy -> "Connecting…"
                intent == GoogleIntent.SignUp -> "Sign up with Google"
                else -> "Continue with Google"
            },
            color = CcColors.Ink, fontWeight = FontWeight.SemiBold,
        )
    }
}

@Composable
fun RegisterScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val scope = rememberCoroutineScope()
    val settings = app.config.config.value.settings
    val domain = settings.accountEmailDomain
    val minLen = settings.passwordMinLength
    val turnstile = rememberTurnstile("register")
    var name by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var studentId by rememberSaveable { mutableStateOf("") }
    var department by rememberSaveable { mutableStateOf<String?>(null) }
    var year by rememberSaveable { mutableStateOf<String?>(null) }
    var phone by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var accept by rememberSaveable { mutableStateOf(false) }
    var verifyMethod by rememberSaveable { mutableStateOf("otp") }
    var errors by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var busy by remember { mutableStateOf(false) }
    var general by remember { mutableStateOf<String?>(null) }

    fun validate(): Map<String, String> = buildMap {
        if (name.trim().length < 2) put("fullName", "Enter your full name")
        universityEmailError(email, domain)?.let { put("email", it) }
        if (!Regex("^[A-Za-z0-9\\-/]{2,40}$").matches(studentId.trim())) put("studentId", "Letters, numbers, - and / only")
        if (department == null) put("department", "Select your department")
        if (year == null) put("academicYear", "Select your year")
        if (phone.isNotBlank() && !Regex("^\\+?[0-9 ]{7,20}$").matches(phone.trim())) put("phone", "Enter a valid phone number")
        passwordError(password, minLen)?.let { put("password", it) }
        if (confirm != password) put("confirmPassword", "Passwords do not match")
        if (!accept) put("acceptPolicy", "You must accept the privacy policy")
    }

    fun submit() {
        errors = validate()
        if (errors.isNotEmpty()) return
        turnstile.run { token ->
            scope.launch {
                busy = true
                general = null
                try {
                    val r = app.api.auth.register(
                        mapOf(
                            "fullName" to name.trim(), "email" to email.trim().lowercase(), "studentId" to studentId.trim(), "department" to department,
                            "academicYear" to year?.toInt(), "phone" to phone.trim(), "password" to password, "confirmPassword" to confirm, "acceptPolicy" to true,
                            "turnstileToken" to token, "verificationMethod" to verifyMethod,
                        ),
                    )
                    nav.navigate(
                        Routes.verify(email = r.email.ifBlank { email.trim().lowercase() }, ticket = r.verificationTicket, method = r.verificationMethod ?: "link"),
                    ) { popUpTo(Routes.Login) }
                } catch (e: ApiException) {
                    errors = e.fields
                    general = e.message
                } finally {
                    busy = false
                }
            }
        }
    }

    AuthLayout("Create Your Account", "Join a safer, more inclusive campus.", onBack = { nav.popBackStack() }, hero = true) {
        InfoBanner("Only official @$domain email addresses can create an account.", tone = Tone.Brand, icon = Icons.Rounded.School)
        if (GoogleSignIn.configured) {
            // Student sign-up with the university Google account; the server creates only a student account.
            GoogleAuthBlock(GoogleIntent.SignUp, rememberMe = true) {
                general = "This account uses two-step verification. Sign in from the sign-in screen."
            }
            Text("or create an account with your email", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        }
        CcTextField(name, { name = it }, label = "Full name", placeholder = "Enter your full name", leadingIcon = Icons.Rounded.Person, error = errors["fullName"], capitalization = KeyboardCapitalization.Words)
        CcTextField(email, { email = it }, label = "University email", placeholder = "name@$domain", leadingIcon = Icons.Rounded.Email, keyboardType = KeyboardType.Email, error = errors["email"] ?: email.takeIf { it.contains('@') }?.let { universityEmailError(it, domain) })
        CcTextField(studentId, { studentId = it.uppercase() }, label = "Student ID / Roll number", placeholder = "e.g. AP21110010001", leadingIcon = Icons.Rounded.Badge, error = errors["studentId"], capitalization = KeyboardCapitalization.Characters)
        CcSelect("Department", Catalog.departments.map { it to it }, department, { department = it }, leadingIcon = Icons.Rounded.School, error = errors["department"], placeholder = "Select your department")
        CcSelect("Academic year", (1..6).map { "$it" to "Year $it" }, year, { year = it }, leadingIcon = Icons.Rounded.CalendarMonth, error = errors["academicYear"])
        CcTextField(phone, { phone = it }, label = "Phone (optional)", leadingIcon = Icons.Rounded.Phone, keyboardType = KeyboardType.Phone, error = errors["phone"], hint = "Only used if you choose phone contact on a report")
        CcTextField(password, { password = it }, label = "Password", placeholder = "Create a strong password", leadingIcon = Icons.Rounded.Lock, password = true, error = errors["password"])
        PasswordStrength(password, minLen)
        CcTextField(confirm, { confirm = it }, label = "Confirm password", leadingIcon = Icons.Rounded.Lock, password = true, error = errors["confirmPassword"], imeAction = ImeAction.Done)
        Text("How should we verify your email?", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink, fontWeight = FontWeight.SemiBold)
        EmailMethodChoice(verificationOptions(), verifyMethod, { verifyMethod = it }, enabled = !busy)
        TurnstileNote(turnstile.enabled)
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable { accept = !accept }.padding(vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Checkbox(accept, onCheckedChange = { accept = it }, colors = CheckboxDefaults.colors(checkedColor = CcColors.Emerald))
            Text("I agree to the Terms of Service and Privacy Policy", style = MaterialTheme.typography.bodySmall, color = if (errors["acceptPolicy"] != null) CcColors.Sos else CcColors.Ink)
        }
        general?.let { InfoBanner(it, tone = Tone.Danger, icon = Icons.Rounded.Warning) }
        CcButton("Create Account", { submit() }, modifier = Modifier.fillMaxWidth(), loading = busy, trailingIcon = Icons.AutoMirrored.Rounded.ArrowForward)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
            Text("Already have an account?", style = MaterialTheme.typography.bodyMedium, color = CcColors.InkSoft)
            TextButton(onClick = { nav.popBackStack() }) { Text("Sign In", color = CcColors.Emerald, fontWeight = FontWeight.Bold) }
        }
    }
    TurnstileHost(turnstile)
}

/** Seconds left on a "send again" cooldown; ticks down once a second while above zero. */
@Composable
private fun rememberCooldown(): androidx.compose.runtime.MutableIntState {
    val left = rememberSaveable { androidx.compose.runtime.mutableIntStateOf(0) }
    LaunchedEffect(left.intValue > 0) {
        while (left.intValue > 0) {
            delay(1000)
            left.intValue = (left.intValue - 1).coerceAtLeast(0)
        }
    }
    return left
}

private val politeLiveRegion = Modifier.semantics { liveRegion = LiveRegionMode.Polite }

/**
 * Forgot password: the person chooses a 6-digit code (entered here, then a new password) or a reset link.
 * Every answer about the address is generic, the code only proves control of the inbox (it never signs
 * anyone in), and success is shown only after the server has changed the password.
 */
@Composable
fun ForgotPasswordScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val scope = rememberCoroutineScope()
    val domain = app.config.config.value.settings.accountEmailDomain
    val turnstile = rememberTurnstile("forgotPassword")
    var email by rememberSaveable { mutableStateOf("") }
    var method by rememberSaveable { mutableStateOf("otp") }
    /** request | code | link */
    var stage by rememberSaveable { mutableStateOf("request") }
    var sent by remember { mutableStateOf<MessageResponse?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var code by rememberSaveable { mutableStateOf("") }
    var codeError by remember { mutableStateOf<String?>(null) }
    var shakeKey by remember { mutableIntStateOf(0) }
    var checking by remember { mutableStateOf(false) }
    val cooldown = rememberCooldown()

    fun request(m: String = method) {
        if (busy || cooldown.intValue > 0) return // no duplicate taps
        error = universityEmailError(email, domain)
        if (error != null) { stage = "request"; return }
        turnstile.run { token ->
            scope.launch {
                busy = true
                problem = null
                try {
                    val r = app.api.auth.forgotPassword(email.trim().lowercase(), token, m)
                    sent = r
                    method = m
                    code = ""
                    codeError = null
                    stage = if (m == "otp") "code" else "link"
                    cooldown.intValue = r.retryAfterSeconds.coerceAtLeast(30)
                } catch (e: ApiException) {
                    // e.g. email_unavailable: the email could not be sent. Never shown as "sent".
                    if (e.fields["email"] != null) error = e.fields["email"] else problem = e.message ?: "We couldn't send the email. Please try again."
                    if (e.code == "rate_limited") cooldown.intValue = 60
                } finally {
                    busy = false
                }
            }
        }
    }

    fun checkCode(c: String = code) {
        if (checking || c.length != EMAIL_CODE_LENGTH) return // one check at a time
        scope.launch {
            checking = true
            codeError = null
            try {
                val r = app.api.auth.resetOtp(email.trim().lowercase(), c)
                nav.navigate(Routes.reset(r.resetToken, via = "code")) { popUpTo(Routes.Forgot) { inclusive = true } }
            } catch (e: ApiException) {
                codeError = e.message ?: "That code is incorrect or has expired. Request a new one."
                code = ""
                shakeKey++
            } finally {
                checking = false
            }
        }
    }

    val masked = maskEmail(email)
    AuthLayout(
        title = when (stage) { "code" -> "Enter your reset code"; "link" -> "Check your inbox"; else -> "Forgot password?" },
        subtitle = when (stage) {
            "code" -> "Enter the code sent to your registered email ($masked)."
            "link" -> "We've emailed a reset link if an account exists for $masked."
            else -> "Choose how you'd like to reset your password."
        },
        onBack = { if (stage == "request") nav.popBackStack() else stage = "request" },
    ) {
        AuthStep(stage) { s ->
            when (s) {
                "code" -> {
                    sent?.let { InfoBanner(it.message, tone = Tone.Brand, title = "Check your inbox", modifier = politeLiveRegion) }
                    OtpCodeField(code, { code = it; codeError = null }, enabled = !checking, error = codeError, errorKey = shakeKey, onComplete = { checkCode(it) })
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        PasteCodeButton(onCode = { code = it; checkCode(it) }, onNothing = { codeError = "No 6-digit code found on the clipboard." })
                    }
                    CcButton("Continue", { checkCode() }, modifier = Modifier.fillMaxWidth(), loading = checking, enabled = code.length == EMAIL_CODE_LENGTH)
                    Text(
                        "The code works once and expires in ${sent?.expiresInMinutes ?: 10} minutes. Only the newest code works. Code expired? Request a new one.",
                        style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft,
                    )
                    problem?.let { InfoBanner(it, tone = Tone.Danger, icon = Icons.Rounded.Warning, modifier = politeLiveRegion) }
                    CcButton(
                        if (cooldown.intValue > 0) "Resend code in ${cooldown.intValue}s" else "Resend code",
                        { request("otp") }, modifier = Modifier.fillMaxWidth(), kind = ButtonKind.Outline, loading = busy, enabled = cooldown.intValue == 0,
                    )
                    TextButton(onClick = { request("link") }, enabled = cooldown.intValue == 0 && !busy, modifier = Modifier.fillMaxWidth()) {
                        Text("Send a password-reset link instead", color = CcColors.Emerald, fontWeight = FontWeight.SemiBold)
                    }
                }
                "link" -> {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                        IconBadge(Icons.Rounded.MarkEmailRead, Tone.Brand, size = 72.dp, iconSize = 34.dp, modifier = Modifier.popIn())
                    }
                    sent?.let { InfoBanner(it.message, tone = Tone.Brand, title = "Check your inbox", modifier = politeLiveRegion) }
                    Text(
                        "The link works once and expires in ${sent?.expiresInMinutes ?: 30} minutes. Open it on this phone to continue in the app. Only the newest link works.",
                        style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft,
                    )
                    problem?.let { InfoBanner(it, tone = Tone.Danger, icon = Icons.Rounded.Warning, modifier = politeLiveRegion) }
                    CcButton(
                        if (cooldown.intValue > 0) "Send again in ${cooldown.intValue}s" else "Send another link",
                        { request("link") }, modifier = Modifier.fillMaxWidth(), kind = ButtonKind.Outline, loading = busy, enabled = cooldown.intValue == 0,
                    )
                    TextButton(onClick = { request("otp") }, enabled = cooldown.intValue == 0 && !busy, modifier = Modifier.fillMaxWidth()) {
                        Text("Reset password with OTP instead", color = CcColors.Emerald, fontWeight = FontWeight.SemiBold)
                    }
                }
                else -> {
                    EmailMethodChoice(resetOptions(), method, { method = it }, enabled = !busy)
                    CcTextField(email, { email = it; error = null }, label = "University email", placeholder = "you@$domain", leadingIcon = Icons.Rounded.Email, keyboardType = KeyboardType.Email, error = error, imeAction = ImeAction.Done, onImeAction = { request() })
                    problem?.let { InfoBanner(it, tone = Tone.Danger, icon = Icons.Rounded.Warning, modifier = politeLiveRegion) }
                    TurnstileNote(turnstile.enabled)
                    CcButton(
                        when {
                            cooldown.intValue > 0 -> "Try again in ${cooldown.intValue}s"
                            method == "otp" -> "Email me a code"
                            else -> "Send reset link"
                        },
                        { request() }, modifier = Modifier.fillMaxWidth(), loading = busy, enabled = cooldown.intValue == 0,
                    )
                }
            }
            if (s != "request") CcButton("Back to sign in", { nav.popBackStack() }, modifier = Modifier.fillMaxWidth(), kind = ButtonKind.Ghost)
        }
    }
    TurnstileHost(turnstile)
}

@Composable
fun ResetPasswordScreen(token: String, viaCode: Boolean = false) {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val minLen = app.config.config.value.settings.passwordMinLength
    val turnstile = rememberTurnstile("resetPassword")
    /** null while checking; otherwise valid | expired | used | invalid | offline. */
    var linkState by remember { mutableStateOf<String?>(null) }
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmError by remember { mutableStateOf<String?>(null) }
    var general by remember { mutableStateOf<String?>(null) }
    var attempt by remember { mutableStateOf(0) }
    // Read-only check: opening the screen never uses up the link. Only "Update password" does.
    LaunchedEffect(token, attempt) {
        linkState = null
        linkState = if (token.isBlank()) "invalid" else try {
            val r = app.api.auth.checkReset(token)
            r.state ?: if (r.valid) "valid" else "invalid"
        } catch (e: ApiException) {
            if (e.status == 0 || e.status >= 500) "offline" else "invalid"
        } catch (e: Exception) {
            "offline"
        }
    }
    fun submit() {
        if (busy) return // no duplicate taps
        error = passwordError(password, minLen)
        confirmError = if (confirm != password) "Passwords do not match" else null
        if (error != null || confirmError != null) return
        turnstile.run { t ->
            scope.launch {
                busy = true
                general = null
                try {
                    app.api.auth.resetPassword(token, password, confirm, t)
                    // No session is created: sign in again (two-step verification still applies).
                    snack.show("Password updated and all devices signed out. Sign in with your new password.", long = true)
                    app.session.clear()
                    nav.navigate(Routes.Login) { popUpTo(0) { inclusive = true } }
                } catch (e: ApiException) {
                    when (e.code) {
                        "expired_token" -> linkState = "expired"
                        "invalid_token" -> linkState = "used"
                        else -> {
                            error = e.fields["password"]
                            confirmError = e.fields["confirmPassword"]
                            if (error == null && confirmError == null) general = e.message
                        }
                    }
                } finally {
                    busy = false
                }
            }
        }
    }
    val what = if (viaCode) "reset session" else "reset link"
    AuthLayout(
        "Set a new password",
        if (viaCode) "Code verified. Choose a strong password you don't use anywhere else." else "Choose a strong password you don't use anywhere else.",
        onBack = { nav.navigate(Routes.Login) { popUpTo(0) } },
    ) {
        when (linkState) {
            null -> Text(if (viaCode) "One moment..." else "Checking your link...", color = CcColors.InkSoft, modifier = politeLiveRegion)
            "offline" -> {
                InfoBanner("We couldn't check this $what. Check your connection and try again.", tone = Tone.Amber, icon = Icons.Rounded.Warning, modifier = politeLiveRegion)
                CcButton("Try again", { attempt++ }, modifier = Modifier.fillMaxWidth())
            }
            "valid" -> {
                CcTextField(password, { password = it; error = null }, label = "New password", leadingIcon = Icons.Rounded.Lock, password = true, error = error, hint = "At least $minLen characters, with upper and lower case letters and a number")
                PasswordStrength(password, minLen)
                CcTextField(
                    confirm, { confirm = it; confirmError = null }, label = "Confirm new password", leadingIcon = Icons.Rounded.Lock, password = true,
                    error = confirmError ?: if (confirm.isNotEmpty() && confirm != password) "Passwords do not match" else null,
                    imeAction = ImeAction.Done, onImeAction = { submit() },
                )
                general?.let { InfoBanner(it, tone = Tone.Danger, icon = Icons.Rounded.Warning, modifier = politeLiveRegion) }
                TurnstileNote(turnstile.enabled)
                CcButton("Update password", { submit() }, modifier = Modifier.fillMaxWidth(), loading = busy)
                Text("For your security, you'll be signed out on all devices.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
            }
            else -> {
                val msg = when (linkState) {
                    "expired" -> if (viaCode) "This reset session has expired. Request a new code." else "This reset link has expired. Reset links work for a short time only."
                    "used" -> "This $what was already used or replaced by a newer one."
                    else -> "This $what is invalid."
                }
                InfoBanner(msg, tone = Tone.Danger, icon = Icons.Rounded.Warning, modifier = politeLiveRegion)
                CcButton(if (viaCode) "Request a new code" else "Request a new link", { nav.navigate(Routes.Forgot) { popUpTo(Routes.Login) } }, modifier = Modifier.fillMaxWidth())
                CcButton("Back to sign in", { nav.navigate(Routes.Login) { popUpTo(0) { inclusive = true } } }, modifier = Modifier.fillMaxWidth(), kind = ButtonKind.Ghost)
            }
        }
    }
    TurnstileHost(turnstile)
}

/**
 * Email verification, three ways in:
 * - a verification link opened on this phone ([token]): checked read-only; only "Verify my email" uses it;
 * - right after registering, or after signing in to an unverified account ([ticket]): the person sees the
 *   masked address, whether the email went out, and can enter the code or switch between code and link;
 * - without either: they enter their address and ask for a code or link (generic answers).
 * Only the server's answer marks the account verified; sending an email never does, and nobody is signed in.
 */
@Composable
fun VerifyEmailScreen(token: String, email: String, ticket: String = "", method: String = "") {
    val app = LocalApp.current
    val nav = LocalNav.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    fun openEmailApp() {
        val intent = android.content.Intent(android.content.Intent.ACTION_MAIN).apply {
            addCategory(android.content.Intent.CATEGORY_APP_EMAIL)
            addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            context.startActivity(android.content.Intent.createChooser(intent, "Open email app"))
        } catch (_: Exception) {
            try {
                context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse("mailto:")))
            } catch (_: Exception) {}
        }
    }
    val domain = app.config.config.value.settings.accountEmailDomain
    val turnstile = rememberTurnstile("resendVerification")
    // await | checking | ready | verifying | verified | already | expired | invalid
    var state by remember { mutableStateOf(if (token.isBlank()) "await" else "checking") }
    var message by remember { mutableStateOf<String?>(null) }
    var activeTicket by rememberSaveable { mutableStateOf(ticket.ifBlank { null }) }
    var status by remember { mutableStateOf<VerificationStatus?>(null) }
    /** What was last sent (otp | link), or null before the person has chosen. */
    var current by rememberSaveable { mutableStateOf(method.ifBlank { null }) }
    var choice by rememberSaveable { mutableStateOf(method.ifBlank { "otp" }) }
    var address by rememberSaveable { mutableStateOf(email) }
    var addressError by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<Pair<Boolean, String>?>(null) } // ok? to text
    var sending by remember { mutableStateOf(false) }
    var code by rememberSaveable { mutableStateOf("") }
    var codeError by remember { mutableStateOf<String?>(null) }
    var shakeKey by remember { mutableIntStateOf(0) }
    var checkingCode by remember { mutableStateOf(false) }
    var poll by remember { mutableIntStateOf(0) }
    val cooldown = rememberCooldown()

    LaunchedEffect(token) {
        if (token.isBlank()) return@LaunchedEffect
        state = try {
            when (app.api.auth.checkVerifyEmail(token).state) {
                "already_verified" -> "already"
                "expired" -> "expired"
                "invalid" -> "invalid"
                else -> "ready"
            }
        } catch (e: Exception) {
            "ready" // the explicit verify call gives the authoritative answer
        }
    }

    // Ticket holders see which method is in use and whether the email went out (polled briefly while sending).
    LaunchedEffect(activeTicket, poll) {
        val t = activeTicket ?: return@LaunchedEffect
        repeat(15) { attempt ->
            val s = try {
                app.api.auth.verificationStatus(t)
            } catch (e: ApiException) {
                if (e.code == "invalid_ticket") activeTicket = null
                return@LaunchedEffect
            } catch (e: Exception) {
                return@LaunchedEffect
            }
            status = s
            if (s.emailVerified) { state = "already"; return@LaunchedEffect }
            if (s.method != null) current = s.method
            if (attempt == 0 && s.retryAfterSeconds > cooldown.intValue) cooldown.intValue = s.retryAfterSeconds
            if (s.delivery?.status != "sending") return@LaunchedEffect
            delay(4000)
        }
    }

    fun verify() {
        if (state == "verifying") return
        scope.launch {
            state = "verifying"
            message = null
            state = try {
                val r = app.api.auth.verifyEmail(token)
                if (r.result == "already_verified") "already" else "verified"
            } catch (e: ApiException) {
                when (e.code) {
                    "expired_token" -> "expired"
                    "invalid_token" -> "invalid"
                    else -> { message = e.message; "ready" }
                }
            }
        }
    }

    fun send(m: String) {
        if (sending || cooldown.intValue > 0) return // no duplicate taps
        val t = activeTicket
        if (t != null) {
            scope.launch {
                sending = true
                notice = null
                try {
                    val s = app.api.auth.sendVerification(t, m)
                    status = s
                    if (s.emailVerified) state = "already"
                    current = s.method ?: m
                    choice = current ?: m
                    code = ""
                    codeError = null
                    cooldown.intValue = s.retryAfterSeconds.coerceAtLeast(30)
                    poll++
                } catch (e: ApiException) {
                    when (e.code) {
                        "resend_cooldown" -> cooldown.intValue = e.details["retryAfterSeconds"]?.toIntOrNull() ?: 60
                        "invalid_ticket" -> activeTicket = null
                    }
                    notice = false to (e.message ?: "We couldn't send the email. Please try again.")
                } finally {
                    sending = false
                }
            }
            return
        }
        addressError = universityEmailError(address, domain)
        if (addressError != null) return
        turnstile.run { tk ->
            scope.launch {
                sending = true
                notice = null
                try {
                    val r = app.api.auth.resendVerification(address.trim().lowercase(), tk, m)
                    notice = true to r.message
                    current = m
                    choice = m
                    code = ""
                    codeError = null
                    cooldown.intValue = r.retryAfterSeconds.coerceAtLeast(30)
                } catch (e: ApiException) {
                    // e.g. email_unavailable or rate_limited: say so honestly, never "sent".
                    notice = false to (e.message ?: "We couldn't send the email. Please try again.")
                    if (e.code == "rate_limited") cooldown.intValue = 60
                } finally {
                    sending = false
                }
            }
        }
    }

    fun verifyCode(c: String = code) {
        if (checkingCode || c.length != EMAIL_CODE_LENGTH) return
        addressError = universityEmailError(address, domain)
        if (addressError != null) return
        scope.launch {
            checkingCode = true
            codeError = null
            try {
                val r = app.api.auth.verifyEmailOtp(address.trim().lowercase(), c, activeTicket)
                // Success only now, after the server confirmed it.
                state = if (r.result == "already_verified") "already" else "verified"
            } catch (e: ApiException) {
                codeError = when (e.code) {
                    "expired_code" -> "Code expired. Request a new one."
                    "too_many_attempts" -> "Too many incorrect codes. Request a new code."
                    else -> e.message ?: "That code is incorrect."
                }
                code = ""
                shakeKey++
            } finally {
                checkingCode = false
            }
        }
    }

    val masked = status?.maskedEmail?.takeIf { it.isNotBlank() } ?: if (address.isNotBlank()) maskEmail(address) else "your university email"
    val otpAvailable = status?.otpAvailable ?: true
    val problem = state == "invalid" || state == "expired"
    AuthLayout(
        title = when (state) {
            "verified", "already" -> "Email verified"
            "checking", "verifying" -> "One moment..."
            "ready" -> "Verify your email"
            "await" -> "Verify your email"
            "expired" -> "Link expired"
            else -> "Link problem"
        },
        subtitle = when (state) {
            "await" -> when (current) {
                "otp" -> "Enter the code sent to your registered email ($masked)."
                "link" -> "Open the verification link we emailed to $masked on this phone."
                else -> "Choose how you'd like to verify $masked."
            }
            "ready" -> "Tap the button to confirm this is your email address."
            // Email proof alone never activates a staff application, so the College app does not say "active".
            "verified" -> if (AppAudience.current == AppAudience.College) "Email verified. Sign in to continue; a staff application still needs approval before you get access." else "Your account is active. You can sign in now."
            "already" -> "This email was already verified. You can sign in."
            "checking" -> "Checking your link."
            "verifying" -> "Verifying your email."
            "expired" -> "This verification link has expired. Request a new code or link below."
            else -> "This link is invalid or was replaced by a newer one. Request a new code or link below."
        },
    ) {
        val step = when (state) {
            "await", "expired", "invalid" -> "await:${current ?: "choose"}"
            else -> state
        }
        AuthStep(step) { s ->
            when {
                s == "verified" || s == "already" -> {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                        IconBadge(Icons.Rounded.CheckCircle, Tone.Brand, size = 80.dp, iconSize = 40.dp, modifier = Modifier.popIn())
                    }
                    CcButton("Sign in", { nav.navigate(Routes.Login) { popUpTo(0) { inclusive = true } } }, modifier = Modifier.fillMaxWidth())
                }
                s == "checking" -> Unit
                s == "ready" || s == "verifying" -> {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                        IconBadge(Icons.Rounded.MarkEmailRead, Tone.Brand, size = 80.dp, iconSize = 38.dp)
                    }
                    message?.let { InfoBanner(it, tone = Tone.Danger, icon = Icons.Rounded.Warning, modifier = politeLiveRegion) }
                    CcButton("Verify my email", { verify() }, modifier = Modifier.fillMaxWidth(), loading = state == "verifying")
                }
                else -> {
                    DeliveryStatusLine(status?.delivery, if (current == "otp") "code" else "link")
                    // Without a ticket the address is needed (to send, and to check a code).
                    if (activeTicket == null && (email.isBlank() || problem)) {
                        CcTextField(address, { address = it; addressError = null }, label = "University email", placeholder = "you@$domain", leadingIcon = Icons.Rounded.Email, keyboardType = KeyboardType.Email, error = addressError, imeAction = ImeAction.Next)
                    }
                    when (current) {
                        "otp" -> {
                            OtpCodeField(code, { code = it; codeError = null }, enabled = !checkingCode, error = codeError, errorKey = shakeKey, onComplete = { verifyCode(it) })
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                                PasteCodeButton(onCode = { code = it; verifyCode(it) }, onNothing = { codeError = "No 6-digit code found on the clipboard." })
                            }
                            CcButton("Verify email", { verifyCode() }, modifier = Modifier.fillMaxWidth(), loading = checkingCode, enabled = code.length == EMAIL_CODE_LENGTH)
                            Text("Codes work once and expire after a few minutes. Only the newest code works. Didn't get it? Check spam, or send a new one.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                        }
                        "link" -> {
                            CcButton("Open email app", { openEmailApp() }, modifier = Modifier.fillMaxWidth(), leadingIcon = Icons.Rounded.Email)
                            Text("Verification links work once and expire after a limited time. Only the newest link works. Didn't get it? Check spam, or send a new one.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                        }
                        else -> EmailMethodChoice(verificationOptions().filter { otpAvailable || it.method == "link" }, choice, { choice = it }, enabled = !sending)
                    }
                    notice?.let { (good, text) ->
                        InfoBanner(text, tone = if (good) Tone.Brand else Tone.Danger, icon = if (good) Icons.Rounded.MarkEmailRead else Icons.Rounded.Warning, modifier = politeLiveRegion)
                    }
                    TurnstileNote(turnstile.enabled && activeTicket == null)
                    val waiting = cooldown.intValue > 0
                    when (current) {
                        null -> CcButton(
                            if (waiting) "Send available in ${cooldown.intValue}s" else if (choice == "otp") "Email me a code" else "Email me a link",
                            { send(choice) }, modifier = Modifier.fillMaxWidth(), loading = sending, enabled = !waiting,
                        )
                        else -> {
                            val what = if (current == "otp") "code" else "link"
                            CcButton(
                                if (waiting) "Resend available in ${cooldown.intValue}s" else "Resend $what",
                                { send(current ?: "link") }, modifier = Modifier.fillMaxWidth(), kind = ButtonKind.Outline, loading = sending, enabled = !waiting,
                            )
                            if (current == "otp") {
                                TextButton(onClick = { send("link") }, enabled = !waiting && !sending, modifier = Modifier.fillMaxWidth()) {
                                    Text("Verify using an email link instead", color = CcColors.Emerald, fontWeight = FontWeight.SemiBold)
                                }
                            } else if (otpAvailable) {
                                TextButton(onClick = { send("otp") }, enabled = !waiting && !sending, modifier = Modifier.fillMaxWidth()) {
                                    Text("Verify using OTP instead", color = CcColors.Emerald, fontWeight = FontWeight.SemiBold)
                                }
                            }
                        }
                    }
                    CcButton("Back to sign in", { nav.navigate(Routes.Login) { popUpTo(0) { inclusive = true } } }, modifier = Modifier.fillMaxWidth(), kind = ButtonKind.Ghost)
                }
            }
        }
    }
    TurnstileHost(turnstile)
}

@Composable
fun AcceptInviteScreen(token: String) {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val minLen = app.config.config.value.settings.passwordMinLength
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    AuthLayout("Activate your staff account", "Set a password to finish setting up CampusCare.") {
        CcTextField(password, { password = it }, label = "Password", leadingIcon = Icons.Rounded.Lock, password = true, error = error)
        PasswordStrength(password, minLen)
        CcTextField(confirm, { confirm = it }, label = "Confirm password", leadingIcon = Icons.Rounded.Lock, password = true)
        CcButton("Activate account", {
            error = passwordError(password, minLen) ?: if (confirm != password) "Passwords do not match" else null
            if (error == null) scope.launch {
                busy = true
                try {
                    app.api.auth.acceptInvite(token, password, confirm)
                    snack.show("Account activated. Sign in to continue.", long = true)
                    nav.navigate(Routes.Login) { popUpTo(0) { inclusive = true } }
                } catch (e: ApiException) {
                    error = e.message
                } finally {
                    busy = false
                }
            }
        }, modifier = Modifier.fillMaxWidth(), loading = busy)
    }
}

/** Second factor after Google sign-in for privileged accounts, or when a session needs re-verification. */
@Composable
fun MfaScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val scope = rememberCoroutineScope()
    var code by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    AuthLayout("Two-step verification", "Enter the 6-digit code from your authenticator app.") {
        CcTextField(code, { if (it.length <= 6 && it.all(Char::isDigit)) code = it }, label = "Verification code", leadingIcon = Icons.Rounded.Pin, keyboardType = KeyboardType.NumberPassword, error = error)
        CcButton("Verify", {
            scope.launch {
                busy = true
                try {
                    app.api.auth.mfaVerify(code)
                    val me = app.api.auth.me()
                    app.session.updateUser(me.user)
                    nav.navigate(Routes.homeFor(me.user.role)) { popUpTo(0) { inclusive = true } }
                } catch (e: ApiException) {
                    error = e.message
                } finally {
                    busy = false
                }
            }
        }, modifier = Modifier.fillMaxWidth(), enabled = code.length == 6, loading = busy)
        CcButton("Use a different account", {
            app.session.clear()
            nav.navigate(Routes.Login) { popUpTo(0) { inclusive = true } }
        }, modifier = Modifier.fillMaxWidth(), kind = ButtonKind.Ghost)
    }
}

/** Students who signed up with Google add their student ID once (it cannot be changed later). */
@Composable
fun CompleteProfileScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val scope = rememberCoroutineScope()
    val user = app.session.user.value
    var studentId by rememberSaveable { mutableStateOf("") }
    var department by rememberSaveable { mutableStateOf(user?.department) }
    var year by rememberSaveable { mutableStateOf(user?.academicYear?.toString()) }
    var busy by remember { mutableStateOf(false) }
    var errors by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    AuthLayout(
        title = "Complete your profile",
        subtitle = "Committees need your student ID to process reports. It can't be changed later.",
        onBack = {
            if (!nav.popBackStack()) {
                app.session.clear()
            }
        },
    ) {
        CcTextField(studentId, { studentId = it.uppercase() }, label = "Student ID / Roll number", leadingIcon = Icons.Rounded.Badge, error = errors["studentId"], capitalization = KeyboardCapitalization.Characters)
        CcSelect("Department", Catalog.departments.map { it to it }, department, { department = it }, leadingIcon = Icons.Rounded.School, error = errors["department"])
        CcSelect("Academic year", (1..6).map { "$it" to "Year $it" }, year, { year = it }, leadingIcon = Icons.Rounded.CalendarMonth, error = errors["academicYear"])
        CcButton("Continue", {
            errors = buildMap {
                if (!Regex("^[A-Za-z0-9\\-/]{2,40}$").matches(studentId.trim())) put("studentId", "Letters, numbers, - and / only")
                if (department == null) put("department", "Select your department")
                if (year == null) put("academicYear", "Select your year")
            }
            if (errors.isEmpty()) scope.launch {
                busy = true
                try {
                    val r = app.api.auth.updateProfile(mapOf("studentId" to studentId.trim(), "department" to department, "academicYear" to year?.toInt()))
                    app.session.updateUser(r.user)
                    nav.navigate(Routes.Home) { popUpTo(0) { inclusive = true } }
                } catch (e: ApiException) {
                    errors = e.fields.ifEmpty { mapOf("studentId" to (e.message ?: "Could not save")) }
                } finally {
                    busy = false
                }
            }
        }, modifier = Modifier.fillMaxWidth(), loading = busy)
        TextButton(
            onClick = { app.session.clear() },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Back to sign in / Switch account", color = CcColors.Forest700)
        }
    }
    Spacer(Modifier.padding(0.dp))
}
