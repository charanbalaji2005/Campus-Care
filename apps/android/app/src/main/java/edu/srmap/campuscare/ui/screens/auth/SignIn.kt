package edu.srmap.campuscare.ui.screens.auth

import edu.srmap.campuscare.BuildConfig
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
import edu.srmap.campuscare.ui.components.rememberTurnstile
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.GoogleResult
import edu.srmap.campuscare.util.GoogleSignIn
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun LoginScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val context = LocalContext.current
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
    var busy by remember { mutableStateOf(false) }
    var googleBusy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var unverified by remember { mutableStateOf(false) }
    var emailError by remember { mutableStateOf<String?>(null) }

    fun submit() {
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
                    } else {
                        app.rememberedEmail = if (rememberMe) email.trim().lowercase() else null
                        completeSignIn(app, nav, resp)
                    }
                } catch (e: ApiException) {
                    unverified = e.code == "email_not_verified"
                    error = e.message
                } finally {
                    busy = false
                }
            }
        }
    }

    AuthLayout("Welcome Back", "Sign in to a safer campus") {
        CcTextField(email, { email = it; emailError = null }, label = "University email", placeholder = "you@$domain", leadingIcon = Icons.Rounded.Email, keyboardType = KeyboardType.Email, error = emailError)
        CcTextField(password, { password = it }, label = "Password", placeholder = "Enter your password", leadingIcon = Icons.Rounded.Lock, password = true, imeAction = if (needMfa) ImeAction.Next else ImeAction.Done, onImeAction = { if (!needMfa) submit() })
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
                TextButton(onClick = { nav.navigate(Routes.verify(email = email)) }) { Text("Resend verification email") }
            }) else null)
        }
        TurnstileNote(turnstile.enabled)
        CcButton("Sign In", { submit() }, modifier = Modifier.fillMaxWidth(), loading = busy, trailingIcon = Icons.AutoMirrored.Rounded.ArrowForward)
        if (GoogleSignIn.configured) {
            Text("or continue with", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
            OutlinedButton(
                onClick = {
                    scope.launch {
                        googleBusy = true
                        when (val r = GoogleSignIn.signIn(context)) {
                            is GoogleResult.Token -> try {
                                completeSignIn(app, nav, app.api.auth.google(r.idToken, r.nonce))
                            } catch (e: ApiException) {
                                error = e.message
                            }
                            is GoogleResult.Failed -> {
                                val authUrl = "${BuildConfig.API_BASE_URL}/api/v1/auth/google?client=android"
                                val opened = runCatching {
                                    val intent = android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(authUrl))
                                    context.startActivity(intent)
                                    true
                                }.getOrDefault(false)
                                if (!opened) {
                                    snack.show(r.message, long = true)
                                }
                            }
                            GoogleResult.Cancelled -> Unit
                        }
                        googleBusy = false
                    }
                },
                enabled = !googleBusy,
                modifier = Modifier.fillMaxWidth().height(52.dp),
                shape = RoundedCornerShape(16.dp),
                border = BorderStroke(1.dp, CcColors.Line),
            ) {
                GoogleG()
                Spacer(Modifier.width(10.dp))
                Text(if (googleBusy) "Connecting…" else "Continue with Google", color = CcColors.Ink, fontWeight = FontWeight.SemiBold)
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
            Text("Don't have an account?", style = MaterialTheme.typography.bodyMedium, color = CcColors.InkSoft)
            TextButton(onClick = { nav.navigate(Routes.Register) }, enabled = settings.registrationOpen) {
                Text(if (settings.registrationOpen) "Create Account" else "Registration closed", color = CcColors.Emerald, fontWeight = FontWeight.Bold)
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
                            "turnstileToken" to token,
                        ),
                    )
                    nav.navigate(Routes.verify(email = r.email.ifBlank { email })) { popUpTo(Routes.Login) }
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
        CcTextField(name, { name = it }, label = "Full name", placeholder = "Enter your full name", leadingIcon = Icons.Rounded.Person, error = errors["fullName"], capitalization = KeyboardCapitalization.Words)
        CcTextField(email, { email = it }, label = "University email", placeholder = "name@$domain", leadingIcon = Icons.Rounded.Email, keyboardType = KeyboardType.Email, error = errors["email"] ?: email.takeIf { it.contains('@') }?.let { universityEmailError(it, domain) })
        CcTextField(studentId, { studentId = it.uppercase() }, label = "Student ID / Roll number", placeholder = "e.g. AP21110010001", leadingIcon = Icons.Rounded.Badge, error = errors["studentId"], capitalization = KeyboardCapitalization.Characters)
        CcSelect("Department", Catalog.departments.map { it to it }, department, { department = it }, leadingIcon = Icons.Rounded.School, error = errors["department"], placeholder = "Select your department")
        CcSelect("Academic year", (1..6).map { "$it" to "Year $it" }, year, { year = it }, leadingIcon = Icons.Rounded.CalendarMonth, error = errors["academicYear"])
        CcTextField(phone, { phone = it }, label = "Phone (optional)", leadingIcon = Icons.Rounded.Phone, keyboardType = KeyboardType.Phone, error = errors["phone"], hint = "Only used if you choose phone contact on a report")
        CcTextField(password, { password = it }, label = "Password", placeholder = "Create a strong password", leadingIcon = Icons.Rounded.Lock, password = true, error = errors["password"])
        PasswordStrength(password, minLen)
        CcTextField(confirm, { confirm = it }, label = "Confirm password", leadingIcon = Icons.Rounded.Lock, password = true, error = errors["confirmPassword"], imeAction = ImeAction.Done)
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

@Composable
fun ForgotPasswordScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val scope = rememberCoroutineScope()
    val domain = app.config.config.value.settings.accountEmailDomain
    val turnstile = rememberTurnstile("forgotPassword")
    var email by rememberSaveable { mutableStateOf("") }
    var sent by remember { mutableStateOf<MessageResponse?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    val cooldown = rememberCooldown()

    fun submit() {
        if (busy || cooldown.intValue > 0) return // no duplicate taps
        error = universityEmailError(email, domain)
        if (error != null) return
        turnstile.run { token ->
            scope.launch {
                busy = true
                problem = null
                try {
                    val r = app.api.auth.forgotPassword(email.trim().lowercase(), token)
                    sent = r
                    cooldown.intValue = r.retryAfterSeconds.coerceAtLeast(30)
                } catch (e: ApiException) {
                    // e.g. email_unavailable: the email could not be sent. Never shown as "sent".
                    if (e.fields["email"] != null) error = e.fields["email"] else problem = e.message
                } finally {
                    busy = false
                }
            }
        }
    }

    AuthLayout("Forgot password?", "We'll email you a secure reset link.", onBack = { nav.popBackStack() }) {
        val result = sent
        if (result != null) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) { IconBadge(Icons.Rounded.MarkEmailRead, Tone.Brand, size = 72.dp, iconSize = 34.dp) }
            InfoBanner(result.message, tone = Tone.Brand, title = "Check your inbox", modifier = politeLiveRegion)
            Text(
                "The link works once and expires in ${result.expiresInMinutes ?: 30} minutes. Open it on this phone to continue in the app. Only the newest link works.",
                style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft,
            )
            problem?.let { InfoBanner(it, tone = Tone.Danger, icon = Icons.Rounded.Warning, modifier = politeLiveRegion) }
            CcButton(
                if (cooldown.intValue > 0) "Send again in ${cooldown.intValue}s" else "Send another link",
                { submit() }, modifier = Modifier.fillMaxWidth(), kind = ButtonKind.Outline, loading = busy, enabled = cooldown.intValue == 0,
            )
            CcButton("Back to sign in", { nav.popBackStack() }, modifier = Modifier.fillMaxWidth(), kind = ButtonKind.Ghost)
        } else {
            CcTextField(email, { email = it; error = null }, label = "University email", placeholder = "you@$domain", leadingIcon = Icons.Rounded.Email, keyboardType = KeyboardType.Email, error = error, imeAction = ImeAction.Done, onImeAction = { submit() })
            problem?.let { InfoBanner(it, tone = Tone.Danger, icon = Icons.Rounded.Warning, modifier = politeLiveRegion) }
            TurnstileNote(turnstile.enabled)
            CcButton("Send reset link", { submit() }, modifier = Modifier.fillMaxWidth(), loading = busy)

        }
    }
    TurnstileHost(turnstile)
}

@Composable
fun ResetPasswordScreen(token: String) {
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
    AuthLayout("Set a new password", "Choose a strong password you don't use anywhere else.", onBack = { nav.navigate(Routes.Login) { popUpTo(0) } }) {
        when (linkState) {
            null -> Text("Checking your link...", color = CcColors.InkSoft, modifier = politeLiveRegion)
            "offline" -> {
                InfoBanner("We couldn't check this link. Check your connection and try again.", tone = Tone.Amber, icon = Icons.Rounded.Warning, modifier = politeLiveRegion)
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
                    "expired" -> "This reset link has expired. Reset links work for a short time only."
                    "used" -> "This reset link was already used or replaced by a newer one."
                    else -> "This reset link is invalid."
                }
                InfoBanner(msg, tone = Tone.Danger, icon = Icons.Rounded.Warning, modifier = politeLiveRegion)
                CcButton("Request a new link", { nav.navigate(Routes.Forgot) { popUpTo(Routes.Login) } }, modifier = Modifier.fillMaxWidth())
                CcButton("Back to sign in", { nav.navigate(Routes.Login) { popUpTo(0) { inclusive = true } } }, modifier = Modifier.fillMaxWidth(), kind = ButtonKind.Ghost)
            }
        }
    }
    TurnstileHost(turnstile)
}

/**
 * Post-registration "check your inbox" screen, and the landing screen for verification links.
 * Opening a link never verifies the account: the screen checks it (read-only) and the person taps
 * "Verify my email", which sends the token to the server. Only the server's answer changes the state.
 */
@Composable
fun VerifyEmailScreen(token: String, email: String) {
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
    // sent | checking | ready | verifying | verified | already | expired | invalid
    var state by remember { mutableStateOf(if (token.isBlank()) "sent" else "checking") }
    var message by remember { mutableStateOf<String?>(null) }
    var resendEmail by rememberSaveable { mutableStateOf(email) }
    var resendEmailError by remember { mutableStateOf<String?>(null) }
    var resendNotice by remember { mutableStateOf<Pair<Boolean, String>?>(null) } // ok? to text
    var resending by remember { mutableStateOf(false) }
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

    fun resend() {
        if (resending || cooldown.intValue > 0) return // no duplicate taps
        resendEmailError = universityEmailError(resendEmail, domain)
        if (resendEmailError != null) return
        turnstile.run { t ->
            scope.launch {
                resending = true
                resendNotice = null
                try {
                    val r = app.api.auth.resendVerification(resendEmail.trim().lowercase(), t)
                    resendNotice = true to r.message
                    cooldown.intValue = r.retryAfterSeconds.coerceAtLeast(30)
                } catch (e: ApiException) {
                    // e.g. email_unavailable or rate_limited: say so honestly, never "sent".
                    resendNotice = false to (e.message ?: "We couldn't request a new link. Try again.")
                    if (e.code == "rate_limited") cooldown.intValue = 60
                } finally {
                    resending = false
                }
            }
        }
    }

    val problem = state == "invalid" || state == "expired"
    AuthLayout(
        title = when (state) {
            "verified", "already" -> "Email verified"
            "checking", "verifying" -> "One moment..."
            "ready" -> "Verify your email"
            "sent" -> "Check your inbox"
            "expired" -> "Link expired"
            else -> "Link problem"
        },
        subtitle = when (state) {
            "sent" -> "Open the verification link we email to ${email.ifBlank { "your university email" }}. Need a new one? Request it below."
            "ready" -> "Tap the button to confirm this is your email address."
            "verified" -> "Your account is active. You can sign in now."
            "already" -> "This email was already verified. You can sign in."
            "checking" -> "Checking your link."
            "verifying" -> "Verifying your email."
            "expired" -> "This verification link has expired. Request a new one below."
            else -> "This link is invalid or was replaced by a newer one. Request a new one below."
        },
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
            IconBadge(if (problem) Icons.Rounded.Warning else Icons.Rounded.MarkEmailRead, if (problem) Tone.Amber else Tone.Brand, size = 80.dp, iconSize = 38.dp)
        }
        when (state) {
            "verified", "already" -> CcButton("Sign in", { nav.navigate(Routes.Login) { popUpTo(0) { inclusive = true } } }, modifier = Modifier.fillMaxWidth())
            "checking" -> Unit
            "ready", "verifying" -> {
                message?.let { InfoBanner(it, tone = Tone.Danger, icon = Icons.Rounded.Warning, modifier = politeLiveRegion) }
                CcButton("Verify my email", { verify() }, modifier = Modifier.fillMaxWidth(), loading = state == "verifying")
            }
            else -> {
                if (state == "sent") {
                    CcButton("Open email app", { openEmailApp() }, modifier = Modifier.fillMaxWidth(), kind = ButtonKind.Primary, leadingIcon = Icons.Rounded.Email)
                }
                Text(
                    "Verification links work once and expire after a limited time. Only the newest link works. Didn't get it? Check spam, or send a new one.",
                    style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft,
                )
                if (email.isBlank() || problem) {
                    CcTextField(resendEmail, { resendEmail = it; resendEmailError = null }, label = "University email", placeholder = "you@$domain", leadingIcon = Icons.Rounded.Email, keyboardType = KeyboardType.Email, error = resendEmailError, imeAction = ImeAction.Done, onImeAction = { resend() })
                }
                resendNotice?.let { (good, text) ->
                    InfoBanner(text, tone = if (good) Tone.Brand else Tone.Danger, icon = if (good) Icons.Rounded.MarkEmailRead else Icons.Rounded.Warning, modifier = politeLiveRegion)
                }
                TurnstileNote(turnstile.enabled)
                CcButton(
                    if (cooldown.intValue > 0) "Resend available in ${cooldown.intValue}s" else "Resend verification email",
                    { resend() }, modifier = Modifier.fillMaxWidth(), kind = if (problem) ButtonKind.Primary else ButtonKind.Outline,
                    loading = resending, enabled = cooldown.intValue == 0,
                )
                CcButton("Back to sign in", { nav.navigate(Routes.Login) { popUpTo(0) { inclusive = true } } }, modifier = Modifier.fillMaxWidth(), kind = ButtonKind.Ghost)
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
