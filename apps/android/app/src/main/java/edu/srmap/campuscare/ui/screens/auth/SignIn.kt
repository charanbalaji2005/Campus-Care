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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.data.ApiException
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

@Composable
fun ForgotPasswordScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val scope = rememberCoroutineScope()
    val domain = app.config.config.value.settings.accountEmailDomain
    val turnstile = rememberTurnstile("forgotPassword")
    var email by rememberSaveable { mutableStateOf("") }
    var sent by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    AuthLayout("Forgot password?", "We'll email you a secure reset link.", onBack = { nav.popBackStack() }) {
        if (sent != null) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) { IconBadge(Icons.Rounded.MarkEmailRead, Tone.Brand, size = 72.dp, iconSize = 34.dp) }
            InfoBanner(sent ?: "", tone = Tone.Brand, title = "Check your inbox")
            Text("The link works once and expires in 30 minutes. Open it on this phone to continue in the app.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
            CcButton("Back to sign in", { nav.popBackStack() }, modifier = Modifier.fillMaxWidth(), kind = ButtonKind.Outline)
        } else {
            CcTextField(email, { email = it; error = null }, label = "University email", placeholder = "you@$domain", leadingIcon = Icons.Rounded.Email, keyboardType = KeyboardType.Email, error = error, imeAction = ImeAction.Done)
            TurnstileNote(turnstile.enabled)
            CcButton("Send reset link", {
                error = universityEmailError(email, domain)
                if (error == null) turnstile.run { token ->
                    scope.launch {
                        busy = true
                        try {
                            sent = app.api.auth.forgotPassword(email.trim().lowercase(), token).message
                        } catch (e: ApiException) {
                            error = e.message
                        } finally {
                            busy = false
                        }
                    }
                }
            }, modifier = Modifier.fillMaxWidth(), loading = busy)
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
    var valid by remember { mutableStateOf<Boolean?>(null) }
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(token) {
        valid = token.isNotBlank() && runCatching { app.api.auth.checkReset(token).valid }.getOrDefault(false)
    }
    AuthLayout("Set a new password", "Choose a strong password you don't use anywhere else.", onBack = { nav.navigate(Routes.Login) { popUpTo(0) } }) {
        when (valid) {
            null -> Text("Checking your link…", color = CcColors.InkSoft)
            false -> {
                InfoBanner("This reset link is invalid, expired or already used.", tone = Tone.Danger, icon = Icons.Rounded.Warning)
                CcButton("Request a new link", { nav.navigate(Routes.Forgot) }, modifier = Modifier.fillMaxWidth())
            }
            true -> {
                CcTextField(password, { password = it }, label = "New password", leadingIcon = Icons.Rounded.Lock, password = true, error = error)
                PasswordStrength(password, minLen)
                CcTextField(confirm, { confirm = it }, label = "Confirm new password", leadingIcon = Icons.Rounded.Lock, password = true, error = if (confirm.isNotEmpty() && confirm != password) "Passwords do not match" else null)
                TurnstileNote(turnstile.enabled)
                CcButton("Update password", {
                    error = passwordError(password, minLen)
                    if (error == null && confirm == password) turnstile.run { t ->
                        scope.launch {
                            busy = true
                            try {
                                app.api.auth.resetPassword(token, password, confirm, t)
                                snack.show("Password updated. Sign in with your new password.", long = true)
                                app.session.clear()
                                nav.navigate(Routes.Login) { popUpTo(0) { inclusive = true } }
                            } catch (e: ApiException) {
                                error = e.message
                            } finally {
                                busy = false
                            }
                        }
                    }
                }, modifier = Modifier.fillMaxWidth(), loading = busy)
                Text("For your security, you'll be signed out on all devices.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
            }
        }
    }
    TurnstileHost(turnstile)
}

/** Post-registration "check your inbox" screen, and the landing screen for verification links. */
@Composable
fun VerifyEmailScreen(token: String, email: String) {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val turnstile = rememberTurnstile("resendVerification")
    var state by remember { mutableStateOf(if (token.isBlank()) "sent" else "verifying") }
    var message by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(token) {
        if (token.isBlank()) return@LaunchedEffect
        state = try {
            val r = app.api.auth.verifyEmail(token)
            if (r.result == "already_verified") "already" else "verified"
        } catch (e: ApiException) {
            message = e.message
            if (e.code == "expired_token") "expired" else "invalid"
        }
    }
    AuthLayout(
        title = when (state) { "verified", "already" -> "Email verified"; "verifying" -> "Verifying…"; "sent" -> "Check your inbox"; else -> "Link problem" },
        subtitle = when (state) {
            "sent" -> "We sent a verification link to ${email.ifBlank { "your university email" }}."
            "verified" -> "Your account is active. You can sign in now."
            "already" -> "This email was already verified. You can sign in."
            "verifying" -> "One moment please."
            else -> message ?: "This verification link can't be used."
        },
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
            IconBadge(if (state == "invalid" || state == "expired") Icons.Rounded.Warning else Icons.Rounded.MarkEmailRead, if (state == "invalid" || state == "expired") Tone.Amber else Tone.Brand, size = 80.dp, iconSize = 38.dp)
        }
        if (state == "verified" || state == "already") {
            CcButton("Sign in", { nav.navigate(Routes.Login) { popUpTo(0) { inclusive = true } } }, modifier = Modifier.fillMaxWidth())
        } else if (state != "verifying") {
            Text("The link is valid for 24 hours and works once. Didn't get it? Check spam, or resend.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
            if (email.isNotBlank()) {
                CcButton("Resend verification email", {
                    turnstile.run { t ->
                        scope.launch {
                            busy = true
                            try { snack.show(app.api.auth.resendVerification(email, t).message, long = true) } catch (e: ApiException) { snack.error(e) } finally { busy = false }
                        }
                    }
                }, modifier = Modifier.fillMaxWidth(), kind = ButtonKind.Outline, loading = busy)
            }
            CcButton("Back to sign in", { nav.navigate(Routes.Login) { popUpTo(0) { inclusive = true } } }, modifier = Modifier.fillMaxWidth(), kind = ButtonKind.Ghost)
        }
    }
    TurnstileHost(turnstile)
}

/** Staff invitation: set the first password (link from the invitation email). */
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
    AuthLayout("Complete your profile", "Committees need your student ID to process reports. It can't be changed later.") {
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
    }
    Spacer(Modifier.padding(0.dp))
}
