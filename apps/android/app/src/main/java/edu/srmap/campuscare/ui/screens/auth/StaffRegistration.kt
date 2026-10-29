package edu.srmap.campuscare.ui.screens.auth

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.automirrored.rounded.Logout
import androidx.compose.material.icons.rounded.AdminPanelSettings
import androidx.compose.material.icons.rounded.Apartment
import androidx.compose.material.icons.rounded.Badge
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.Email
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material.icons.rounded.HourglassTop
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.LocalPolice
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.Phone
import androidx.compose.material.icons.rounded.Psychology
import androidx.compose.material.icons.rounded.Schedule
import androidx.compose.material.icons.rounded.School
import androidx.compose.material.icons.rounded.Translate
import androidx.compose.material.icons.rounded.VerifiedUser
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material.icons.rounded.Work
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.MyStaffApplication
import edu.srmap.campuscare.data.StaffApplicationView
import edu.srmap.campuscare.data.StaffRegistrationOptions
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.CcSelect
import edu.srmap.campuscare.ui.components.CcTextField
import edu.srmap.campuscare.ui.components.ConfirmDialog
import edu.srmap.campuscare.ui.components.ErrorState
import edu.srmap.campuscare.ui.components.IconBadge
import edu.srmap.campuscare.ui.components.InfoBanner
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.MultiChoiceChips
import edu.srmap.campuscare.ui.components.PasswordStrength
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.TurnstileHost
import edu.srmap.campuscare.ui.components.rememberTurnstile
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.navigation.rememberSignOut
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.GoogleResult
import edu.srmap.campuscare.util.GoogleSignIn
import kotlinx.coroutines.launch

private fun roleIcon(role: String) = when (role) {
    "counsellor" -> Icons.Rounded.Psychology
    "admin" -> Icons.Rounded.AdminPanelSettings
    "committee_member" -> Icons.Rounded.Groups
    else -> Icons.Rounded.LocalPolice
}

private fun roleTone(role: String) = when (role) {
    "counsellor" -> Tone.Teal
    "admin" -> Tone.Brand
    "committee_member" -> Tone.Violet
    else -> Tone.Amber
}

/** Loads the options once per screen; the server decides which roles, campuses and committees are offered. */
@Composable
private fun rememberStaffOptions(): Triple<StaffRegistrationOptions?, String?, () -> Unit> {
    val app = LocalApp.current
    val scope = rememberCoroutineScope()
    var options by remember { mutableStateOf<StaffRegistrationOptions?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var attempt by remember { mutableIntStateOf(0) }
    LaunchedEffect(attempt) {
        error = null
        try {
            options = app.api.auth.staffRegistrationOptions()
        } catch (e: ApiException) {
            error = e.message ?: "Couldn't load the registration options."
        }
    }
    return Triple(options, error) { scope.launch { attempt++ } }
}

/**
 * "Register as College Staff": one card per role the server currently accepts applications for. Choosing a
 * role opens that role's own form. Nothing here (or in the form) grants a role: it creates a request.
 */
@Composable
fun StaffRoleChooserScreen(ticket: String, email: String, name: String) {
    val app = LocalApp.current
    val nav = LocalNav.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val (options, loadError, retry) = rememberStaffOptions()
    var googleBusy by remember { mutableStateOf(false) }
    var googleError by remember { mutableStateOf<String?>(null) }
    val toLogin = { if (!nav.popBackStack(Routes.Login, inclusive = false)) nav.navigate(Routes.Login) { popUpTo(0) { inclusive = true } } }

    fun continueWithGoogle() {
        if (googleBusy) return
        scope.launch {
            googleBusy = true
            googleError = null
            try {
                when (val r = GoogleSignIn.signIn(context)) {
                    is GoogleResult.Token -> try {
                        val t = app.api.auth.staffRegistrationGoogle(r.idToken, r.nonce)
                        nav.navigate(Routes.staffRegister(t.googleTicket, t.email, t.fullName)) { popUpTo(Routes.StaffRegister) { inclusive = true } }
                    } catch (e: ApiException) {
                        googleError = e.message
                    }
                    is GoogleResult.Failed -> googleError = r.message
                    GoogleResult.Cancelled -> Unit
                }
            } finally {
                googleBusy = false
            }
        }
    }

    AuthLayout("Register as College Staff", "Choose the role you are applying for. Every request is verified and approved before any access is given.", onBack = { toLogin() }) {
        if (ticket.isNotBlank()) {
            InfoBanner("Continuing with Google as $email. Google confirms your email address only; your role still needs approval.", tone = Tone.Brand, icon = Icons.Rounded.VerifiedUser)
        }
        when {
            loadError != null && options == null -> ErrorState(loadError, onRetry = retry)
            options == null -> Text("Loading roles…", style = MaterialTheme.typography.bodyMedium, color = CcColors.InkSoft)
            !options.open || options.roles.isEmpty() -> InfoBanner("Staff registration is closed right now. Contact your campus administrator.", tone = Tone.Amber, icon = Icons.Rounded.Info)
            else -> options.roles.forEach { role ->
                CcCard(
                    onClick = { nav.navigate(Routes.staffRegisterForm(role.id, ticket.ifBlank { null }, email, name)) },
                    modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = "${role.title}. ${role.description}" },
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        IconBadge(roleIcon(role.id), roleTone(role.id))
                        Spacer(Modifier.width(12.dp))
                        Text(role.title, style = MaterialTheme.typography.titleMedium, color = CcColors.Ink, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                    }
                    Text(role.description, style = MaterialTheme.typography.bodyMedium, color = CcColors.InkSoft, modifier = Modifier.padding(top = 8.dp, bottom = 12.dp))
                    CcButton("Continue", { nav.navigate(Routes.staffRegisterForm(role.id, ticket.ifBlank { null }, email, name)) }, modifier = Modifier.fillMaxWidth(), kind = ButtonKind.Outline, trailingIcon = Icons.AutoMirrored.Rounded.ArrowForward)
                }
            }
        }
        if (ticket.isBlank() && GoogleSignIn.configured && options?.open == true) {
            googleError?.let { InfoBanner(it, tone = Tone.Danger, icon = Icons.Rounded.Warning) }
            OutlinedButton(
                onClick = { continueWithGoogle() },
                enabled = !googleBusy,
                modifier = Modifier.fillMaxWidth().height(52.dp),
                shape = RoundedCornerShape(16.dp),
                border = BorderStroke(1.dp, CcColors.Line),
            ) {
                Text(if (googleBusy) "Connecting…" else "Apply with your university Google account", color = CcColors.Ink, fontWeight = FontWeight.SemiBold)
            }
        }
        Text("Students register in the CampusCare Student app.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
            Text("Already have an account?", style = MaterialTheme.typography.bodyMedium, color = CcColors.InkSoft)
            TextButton(onClick = { toLogin() }) { Text("Sign In", color = CcColors.Emerald, fontWeight = FontWeight.Bold) }
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleSmall, color = CcColors.Forest, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 6.dp).semantics { heading() })
}

@Composable
private fun FieldError(text: String?) {
    if (text != null) Text(text, style = MaterialTheme.typography.bodySmall, color = CcColors.Sos)
}

/** The application form for one role: shared identity fields, then the role's own fields. */
@Composable
fun StaffRegistrationFormScreen(role: String, ticket: String, ticketEmail: String, ticketName: String) {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val settings = app.config.config.value.settings
    val domain = settings.accountEmailDomain
    val turnstile = rememberTurnstile("register")
    val (options, loadError, retry) = rememberStaffOptions()
    val google = ticket.isNotBlank()

    var fullName by rememberSaveable { mutableStateOf(ticketName) }
    var email by rememberSaveable { mutableStateOf(ticketEmail) }
    var staffId by rememberSaveable { mutableStateOf("") }
    var department by rememberSaveable { mutableStateOf("") }
    var campus by rememberSaveable { mutableStateOf<String?>(null) }
    var designation by rememberSaveable { mutableStateOf("") }
    var phone by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var accept by rememberSaveable { mutableStateOf(false) }
    var verifyMethod by rememberSaveable { mutableStateOf("otp") }
    // Multi-choices are kept as "|"-joined strings so they survive rotation.
    var specializations by rememberSaveable { mutableStateOf("") }
    var languages by rememberSaveable { mutableStateOf("") }
    var qualifications by rememberSaveable { mutableStateOf("") }
    var bio by rememberSaveable { mutableStateOf("") }
    var experienceYears by rememberSaveable { mutableStateOf("") }
    var sessionModes by rememberSaveable { mutableStateOf("") }
    var authorizationReference by rememberSaveable { mutableStateOf("") }
    var committeeId by rememberSaveable { mutableStateOf<String?>(null) }
    var position by rememberSaveable { mutableStateOf("member") }
    var identifierType by rememberSaveable { mutableStateOf("staff") }
    var reason by rememberSaveable { mutableStateOf("") }
    var experience by rememberSaveable { mutableStateOf("") }
    var serviceProvider by rememberSaveable { mutableStateOf("") }
    var shiftPreference by rememberSaveable { mutableStateOf<String?>(null) }
    var securityQualifications by rememberSaveable { mutableStateOf("") }

    var errors by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var general by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var submitted by rememberSaveable { mutableStateOf(false) }
    var confirmLeave by remember { mutableStateOf(false) }

    fun set(raw: String) = raw.split('|').filter { it.isNotBlank() }.toSet()
    fun toggle(raw: String, v: String) = (set(raw).let { if (v in it) it - v else it + v }).joinToString("|")

    val form = StaffRegistrationRules.Form(
        role = role, fullName = fullName, email = email, staffId = staffId, department = department, campus = campus,
        designation = designation, phone = phone, password = password, confirmPassword = confirm, google = google, acceptPolicy = accept,
        specializations = set(specializations), languages = languages, qualifications = qualifications, bio = bio, experienceYears = experienceYears,
        sessionModes = set(sessionModes), authorizationReference = authorizationReference, committeeId = committeeId, position = position,
        identifierType = identifierType, reason = reason, experience = experience, serviceProvider = serviceProvider,
        shiftPreference = shiftPreference, securityQualifications = securityQualifications,
    )
    val dirty = !submitted && StaffRegistrationRules.isDirty(form, ticketName, ticketEmail)
    val leave = { if (dirty) confirmLeave = true else nav.popBackStack() }
    BackHandler(enabled = dirty) { confirmLeave = true }

    // A single campus needs no choice.
    LaunchedEffect(options) { if (campus == null) options?.campuses?.singleOrNull()?.let { campus = it.id } }

    fun submit() {
        if (busy) return // no duplicate submissions
        val o = options ?: return
        errors = StaffRegistrationRules.validate(form, domain, o.passwordMinLength, o.requireAdminAuthorizationReference)
        general = if (errors.isNotEmpty()) "Check the highlighted fields." else null
        if (errors.isNotEmpty()) return
        turnstile.run { token ->
            scope.launch {
                busy = true
                general = null
                try {
                    val r = app.api.auth.registerStaff(StaffRegistrationRules.body(form, verifyMethod, ticket.ifBlank { null }, token))
                    submitted = true
                    val session = r.sessionToken
                    val user = r.user
                    if (session != null && user != null) {
                        // Google: the email is already proven; the restricted session only shows the application.
                        app.session.signIn(session, user, true)
                        nav.navigate(Routes.StaffApplication) { popUpTo(0) { inclusive = true } }
                    } else {
                        if (r.emailDelivery?.status == "failed") snack.show(r.emailDelivery.message ?: "Your application is saved, but the verification email could not be sent. Send it again from the next screen.", long = true)
                        nav.navigate(Routes.verify(email = r.email.ifBlank { email.trim().lowercase() }, ticket = r.verificationTicket, method = r.verificationMethod ?: verifyMethod)) { popUpTo(Routes.Login) }
                    }
                } catch (e: ApiException) {
                    errors = e.fields
                    general = when {
                        e.isNetwork -> "You appear to be offline. Your answers are kept: try again when you're connected."
                        e.code == "google_ticket_expired" -> "Your Google sign-in expired. Go back and continue with Google again."
                        else -> e.message
                    }
                } finally {
                    busy = false
                }
            }
        }
    }

    val title = StaffRegistrationRules.roleTitle(role)
    AuthLayout("$title Registration", "Your request is reviewed by the university before you get access.", onBack = { leave() }) {
        if (loadError != null && options == null) {
            ErrorState(loadError, onRetry = retry)
            return@AuthLayout
        }
        val o = options ?: run {
            Text("Loading…", style = MaterialTheme.typography.bodyMedium, color = CcColors.InkSoft)
            return@AuthLayout
        }
        if (o.roles.none { it.id == role }) {
            InfoBanner("Applications for this role are not open. Choose another role or contact your campus administrator.", tone = Tone.Amber, icon = Icons.Rounded.Info)
            CcButton("Back to roles", { nav.popBackStack() }, modifier = Modifier.fillMaxWidth())
            return@AuthLayout
        }
        InfoBanner(
            when (role) {
                "counsellor" -> "Your counsellor profile stays hidden from students until your identity and application are approved."
                "admin" -> "Campus Admin access is granted only after explicit institutional approval by a Super Admin, and only for the approved campus."
                "committee_member" -> "You join only the committee approved for you, with the permissions that committee allows."
                else -> "You will not be added to SOS dispatch or go on duty until your identity and application are approved."
            },
            tone = Tone.Brand, icon = roleIcon(role),
        )

        SectionTitle("Your details")
        CcTextField(fullName, { fullName = it }, label = "Full name", leadingIcon = Icons.Rounded.Person, error = errors["fullName"], capitalization = KeyboardCapitalization.Words, maxLength = 120)
        CcTextField(
            email, { if (!google) email = it }, label = "Official institutional email", placeholder = "name@$domain", leadingIcon = Icons.Rounded.Email,
            keyboardType = KeyboardType.Email, enabled = !google, error = errors["email"] ?: email.takeIf { !google && it.contains('@') }?.let { universityEmailError(it, domain) },
            hint = if (google) "Confirmed by Google" else null,
        )
        val studentId = role == "committee_member" && identifierType == "student"
        CcTextField(staffId, { staffId = it.uppercase() }, label = if (studentId) "Student ID" else "Employee / staff ID", leadingIcon = Icons.Rounded.Badge, error = errors["staffId"], capitalization = KeyboardCapitalization.Characters, maxLength = 40)
        CcTextField(
            department, { department = it },
            label = if (role == "security_officer") "Security department" else "Department", leadingIcon = Icons.Rounded.Apartment,
            error = errors["department"], capitalization = KeyboardCapitalization.Words, maxLength = 100,
        )
        CcSelect(if (role == "admin") "Requested campus" else if (role == "security_officer") "Assigned campus requested" else "Campus", o.campuses.map { it.id to it.name }, campus, { campus = it }, leadingIcon = Icons.Rounded.School, error = errors["campus"], placeholder = "Choose your campus")
        CcTextField(
            designation, { designation = it },
            label = when (role) { "counsellor" -> "Professional designation"; "admin" -> "Administrative designation"; "committee_member" -> "Designation or role at the university"; else -> "Designation" },
            leadingIcon = Icons.Rounded.Work, error = errors["designation"], capitalization = KeyboardCapitalization.Words, maxLength = 100,
        )
        CcTextField(phone, { phone = it }, label = "Phone (optional)", leadingIcon = Icons.Rounded.Phone, keyboardType = KeyboardType.Phone, error = errors["phone"])

        when (role) {
            "counsellor" -> {
                SectionTitle("Counselling")
                Text("Specializations", style = MaterialTheme.typography.labelLarge, color = CcColors.Ink)
                MultiChoiceChips(o.specializations.map { it.id to it.label }, set(specializations), { specializations = toggle(specializations, it) })
                FieldError(errors["counsellor.specializations"])
                CcTextField(languages, { languages = it }, label = "Languages spoken", placeholder = "English, Telugu, Hindi", leadingIcon = Icons.Rounded.Translate, error = errors["counsellor.languages"], hint = "Separate languages with commas")
                CcTextField(qualifications, { qualifications = it }, label = "Qualifications or credentials", leadingIcon = Icons.Rounded.School, error = errors["counsellor.qualifications"], singleLine = false, minLines = 2, maxLength = 500, hint = "Reviewed before students can see them")
                CcTextField(experienceYears, { if (it.length <= 2 && it.all(Char::isDigit)) experienceYears = it }, label = "Years of experience (optional)", keyboardType = KeyboardType.Number, error = errors["counsellor.experienceYears"])
                CcTextField(bio, { bio = it }, label = "Professional biography (optional)", singleLine = false, minLines = 3, maxLength = 1000, error = errors["counsellor.bio"])
                if (o.sessionModes.isNotEmpty()) {
                    Text("Preferred session modes (optional)", style = MaterialTheme.typography.labelLarge, color = CcColors.Ink)
                    MultiChoiceChips(o.sessionModes.map { it.id to it.label }, set(sessionModes), { sessionModes = toggle(sessionModes, it) })
                }
            }
            "admin" -> {
                SectionTitle("Institutional authorization")
                CcTextField(
                    authorizationReference, { authorizationReference = it },
                    label = if (o.requireAdminAuthorizationReference) "Authorization or approval reference" else "Authorization reference (optional)",
                    placeholder = "e.g. office order number", leadingIcon = Icons.Rounded.Description, error = errors["admin.authorizationReference"], maxLength = 80,
                )
            }
            "committee_member" -> {
                SectionTitle("Committee")
                if (o.committees.isEmpty()) InfoBanner("No committee is accepting applications right now. Committees that take members by nomination add them directly.", tone = Tone.Amber, icon = Icons.Rounded.Info)
                CcSelect("Requested committee", o.committees.map { it.id to it.name }, committeeId, {
                    committeeId = it
                    if (o.committees.firstOrNull { c -> c.id == it }?.eligibility != "staff_and_students") identifierType = "staff"
                }, leadingIcon = Icons.Rounded.Groups, error = errors["committee.committeeId"], placeholder = "Choose a committee")
                if (o.committees.firstOrNull { it.id == committeeId }?.eligibility == "staff_and_students") {
                    Text("I am applying with my", style = MaterialTheme.typography.labelLarge, color = CcColors.Ink)
                    MultiChoiceChips(listOf("staff" to "Employee ID", "student" to "Student ID"), setOf(identifierType), { identifierType = it })
                    FieldError(errors["committee.identifierType"])
                }
                CcSelect("Requested position", listOf("member" to "Member", "chair" to "Chair (the reviewer decides)"), position, { position = it }, leadingIcon = Icons.Rounded.Badge)
                CcTextField(reason, { reason = it }, label = "Reason for joining (optional)", singleLine = false, minLines = 2, maxLength = 1000, error = errors["committee.reason"])
                CcTextField(experience, { experience = it }, label = "Relevant experience (optional)", singleLine = false, minLines = 2, maxLength = 1000, error = errors["committee.experience"])
            }
            else -> {
                SectionTitle("Security service")
                CcTextField(serviceProvider, { serviceProvider = it }, label = "Security department or service provider", leadingIcon = Icons.Rounded.LocalPolice, error = errors["security.serviceProvider"], capitalization = KeyboardCapitalization.Words, maxLength = 100)
                CcSelect("Shift or duty preference", o.shiftPreferences.map { it.id to it.label }, shiftPreference, { shiftPreference = it }, leadingIcon = Icons.Rounded.Schedule, error = errors["security.shiftPreference"], placeholder = "Choose a preference")
                CcTextField(securityQualifications, { securityQualifications = it }, label = "Security qualifications (optional)", singleLine = false, minLines = 2, maxLength = 500)
                CcTextField(authorizationReference, { authorizationReference = it }, label = "Authorization reference (optional)", leadingIcon = Icons.Rounded.Description, maxLength = 80)
            }
        }
        InfoBanner("After you verify your email you can upload your ID card, staff photograph and any supporting documents from your application screen.", tone = Tone.Neutral, icon = Icons.Rounded.Description)

        if (!google) {
            SectionTitle("Sign-in")
            CcTextField(password, { password = it }, label = "Password", leadingIcon = Icons.Rounded.Lock, password = true, error = errors["password"])
            PasswordStrength(password, o.passwordMinLength)
            CcTextField(confirm, { confirm = it }, label = "Confirm password", leadingIcon = Icons.Rounded.Lock, password = true, error = errors["confirmPassword"], imeAction = ImeAction.Done)
            Text("How should we verify your email?", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink, fontWeight = FontWeight.SemiBold)
            EmailMethodChoice(verificationOptions(), verifyMethod, { verifyMethod = it }, enabled = !busy)
        }
        TurnstileNote(turnstile.enabled)
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable(role = Role.Checkbox) { accept = !accept }.padding(vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Checkbox(accept, onCheckedChange = { accept = it }, colors = CheckboxDefaults.colors(checkedColor = CcColors.Emerald))
            Text("I agree to the Terms of Service and Privacy Policy, and to institutional verification of these details", style = MaterialTheme.typography.bodySmall, color = if (errors["acceptPolicy"] != null) CcColors.Sos else CcColors.Ink)
        }
        general?.let { InfoBanner(it, tone = Tone.Danger, icon = Icons.Rounded.Warning) }
        CcButton(if (busy) "Submitting…" else "Submit application", { submit() }, modifier = Modifier.fillMaxWidth(), loading = busy, enabled = !busy, trailingIcon = Icons.AutoMirrored.Rounded.ArrowForward)
    }
    TurnstileHost(turnstile)
    if (confirmLeave) {
        ConfirmDialog(
            title = "Leave this application?",
            message = "What you have entered will be lost.",
            confirmLabel = "Leave",
            onConfirm = { confirmLeave = false; submitted = true; nav.popBackStack() },
            onDismiss = { confirmLeave = false },
            destructive = true,
        )
    }
}

private fun statusTone(value: String) = when (value) {
    "approved", "verified", "active" -> Tone.Brand
    "rejected", "revoked", "suspended", "deactivated", "archived" -> Tone.Danger
    "needs_info", "expired" -> Tone.Amber
    else -> Tone.Sky
}

/**
 * The applicant's own view: each state shown separately (registration, email, identity, role approval,
 * activation), what a reviewer asked for, and the actions that are open now. Nothing else works until approval.
 */
@Composable
fun StaffApplicationScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val signOut = rememberSignOut()
    var data by remember { mutableStateOf<MyStaffApplication?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }

    fun load() {
        scope.launch {
            refreshing = true
            error = null
            try {
                val r = app.api.auth.myStaffApplication()
                data = r
                r.user?.let { app.session.updateUser(it) }
            } catch (e: ApiException) {
                error = e.message
            } finally {
                refreshing = false
            }
        }
    }
    LaunchedEffect(Unit) { load() }

    CcScreen(title = "Your Staff Application", subtitle = "CampusCare College", refreshing = refreshing, onRefresh = { load() }) {
        val d = data
        if (d == null) {
            if (error != null) ErrorState(error!!, onRetry = { load() }) else Text("Loading…", color = CcColors.InkSoft)
            return@CcScreen
        }
        val a = d.application
        val s = a.statuses
        CcCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconBadge(roleIcon(a.requestedRole), roleTone(a.requestedRole))
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(StaffRegistrationRules.roleTitle(a.requestedRole), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = CcColors.Ink)
                    Text("${a.department} · ${a.campus}", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                }
                StatusChip(StaffRegistrationRules.statusLabel(s.registration), statusTone(s.registration))
            }
        }
        when (s.registration) {
            "approved" -> InfoBanner("Your application has been approved.", tone = Tone.Brand, icon = Icons.Rounded.VerifiedUser, action = {
                TextButton(onClick = {
                    scope.launch {
                        val me = runCatching { app.api.auth.me() }.getOrNull()
                        if (me != null && !me.user.approvalRequired && me.user.accountStatus == "active") {
                            app.session.updateUser(me.user)
                            nav.navigate(Routes.homeFor(me.user.role)) { popUpTo(0) { inclusive = true } }
                        } else snack.show("Sign out and sign in again to start using CampusCare College.", long = true)
                    }
                }) { Text("Open CampusCare College") }
            })
            "rejected" -> InfoBanner("Your application was not approved.${a.decisionReason?.let { " Reason: $it" } ?: ""}", tone = Tone.Danger, icon = Icons.Rounded.Warning)
            "needs_info" -> InfoBanner(a.infoRequest ?: "A reviewer needs more information.", title = "More information needed", tone = Tone.Amber, icon = Icons.Rounded.Info)
            "pending_email_verification" -> InfoBanner("Verify your email address to send your application for review.", tone = Tone.Amber, icon = Icons.Rounded.Email)
            else -> InfoBanner("A Super Admin will review your application. You'll get an email and a notification when it is decided.", tone = Tone.Sky, icon = Icons.Rounded.HourglassTop)
        }
        CcCard(padding = 12.dp) {
            listOf(
                "Registration" to s.registration,
                "Email verification" to s.emailVerification,
                "Identity verification" to s.identityVerification,
                "Role approval" to s.roleApproval,
                "Account activation" to s.accountActivation,
            ).forEach { (label, value) ->
                Row(Modifier.fillMaxWidth().padding(vertical = 8.dp).semantics(mergeDescendants = true) {}, verticalAlignment = Alignment.CenterVertically) {
                    Text(label, style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink, modifier = Modifier.weight(1f))
                    StatusChip(StaffRegistrationRules.statusLabel(value), statusTone(value), dot = true)
                }
            }
        }
        if (s.registration != "approved" && s.registration != "rejected") {
            CcCard {
                Text("Identity documents", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = CcColors.Ink)
                Text(
                    if (a.evidence.count == 0) "Upload your staff ID card (and any document your institution requires). They are stored privately and seen only by reviewers."
                    else "${a.evidence.count} document(s) uploaded${a.evidence.latestStatus?.let { " · latest: ${StaffRegistrationRules.statusLabel(it)}" } ?: ""}.",
                    style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft, modifier = Modifier.padding(vertical = 8.dp),
                )
                CcButton(if (a.evidence.count == 0) "Upload identity document" else "Upload another document", { nav.navigate(Routes.IdentityVerification) }, modifier = Modifier.fillMaxWidth(), kind = ButtonKind.Outline, leadingIcon = Icons.Rounded.Badge)
            }
        }
        if (s.registration == "needs_info") ProvideInformation(a) { updated -> data = updated; snack.show("Sent back for review.") }
        Spacer(Modifier.height(8.dp))
        CcButton("Sign out", { signOut() }, modifier = Modifier.fillMaxWidth(), kind = ButtonKind.Outline, leadingIcon = Icons.AutoMirrored.Rounded.Logout)
    }
}

/** Answers a reviewer's request: the role's own details only (never role, name, email or staff ID). */
@Composable
private fun ProvideInformation(a: StaffApplicationView, onDone: (MyStaffApplication) -> Unit) {
    val app = LocalApp.current
    val scope = rememberCoroutineScope()
    var department by rememberSaveable { mutableStateOf(a.department) }
    var designation by rememberSaveable { mutableStateOf(a.designation) }
    var qualifications by rememberSaveable { mutableStateOf(a.counsellor?.qualifications ?: a.security?.qualifications ?: "") }
    var languages by rememberSaveable { mutableStateOf(a.counsellor?.languages?.joinToString(", ") ?: "") }
    var reference by rememberSaveable { mutableStateOf(a.admin?.authorizationReference ?: a.security?.authorizationReference ?: "") }
    var provider by rememberSaveable { mutableStateOf(a.security?.serviceProvider ?: "") }
    var reason by rememberSaveable { mutableStateOf(a.committee?.reason ?: "") }
    var experience by rememberSaveable { mutableStateOf(a.committee?.experience ?: "") }
    var note by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var errors by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var general by remember { mutableStateOf<String?>(null) }

    CcCard {
        Text("Update your application", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, color = CcColors.Ink)
        Spacer(Modifier.height(8.dp))
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            CcTextField(department, { department = it }, label = "Department", error = errors["department"])
            CcTextField(designation, { designation = it }, label = "Designation", error = errors["designation"])
            when (a.requestedRole) {
                "counsellor" -> {
                    CcTextField(qualifications, { qualifications = it }, label = "Qualifications or credentials", singleLine = false, minLines = 2, error = errors["counsellor.qualifications"])
                    CcTextField(languages, { languages = it }, label = "Languages spoken", error = errors["counsellor.languages"])
                }
                "admin" -> CcTextField(reference, { reference = it }, label = "Authorization reference", error = errors["admin.authorizationReference"])
                "committee_member" -> {
                    CcTextField(reason, { reason = it }, label = "Reason for joining", singleLine = false, minLines = 2)
                    CcTextField(experience, { experience = it }, label = "Relevant experience", singleLine = false, minLines = 2)
                }
                else -> {
                    CcTextField(provider, { provider = it }, label = "Security department or service provider", error = errors["security.serviceProvider"])
                    CcTextField(qualifications, { qualifications = it }, label = "Security qualifications", singleLine = false, minLines = 2)
                    CcTextField(reference, { reference = it }, label = "Authorization reference")
                }
            }
            CcTextField(note, { note = it }, label = "Note to the reviewer", singleLine = false, minLines = 2, maxLength = 1000)
            general?.let { InfoBanner(it, tone = Tone.Danger, icon = Icons.Rounded.Warning) }
            CcButton("Send for review", {
                if (busy) return@CcButton
                scope.launch {
                    busy = true
                    general = null
                    try {
                        val section: Pair<String, Map<String, Any?>> = when (a.requestedRole) {
                            "counsellor" -> "counsellor" to mapOf("qualifications" to qualifications.trim(), "languages" to StaffRegistrationRules.languages(languages))
                            "admin" -> "admin" to mapOf("authorizationReference" to reference.trim().ifBlank { null })
                            "committee_member" -> "committee" to mapOf("reason" to reason.trim().ifBlank { null }, "experience" to experience.trim().ifBlank { null })
                            else -> "security" to mapOf("serviceProvider" to provider.trim(), "qualifications" to qualifications.trim().ifBlank { null }, "authorizationReference" to reference.trim().ifBlank { null })
                        }
                        onDone(app.api.auth.updateMyStaffApplication(mapOf("department" to department.trim(), "designation" to designation.trim(), "note" to note.trim().ifBlank { null }, section)))
                    } catch (e: ApiException) {
                        errors = e.fields
                        general = e.message
                    } finally {
                        busy = false
                    }
                }
            }, modifier = Modifier.fillMaxWidth(), loading = busy)
        }
    }
}
