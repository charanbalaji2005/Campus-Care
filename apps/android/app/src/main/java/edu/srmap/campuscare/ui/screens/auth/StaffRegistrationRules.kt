package edu.srmap.campuscare.ui.screens.auth

/**
 * Client-side checks for the CampusCare College staff application form. They mirror the server's rules
 * (packages/shared/src/staff-registration.ts) so mistakes show inline at once; the server checks everything
 * again and decides what, if anything, is granted. Error keys match the server's field paths.
 */
object StaffRegistrationRules {
    val ROLES = listOf("counsellor", "admin", "committee_member", "security_officer")
    private val IDENTIFIER = Regex("^[A-Za-z0-9\\-/]{2,40}$")
    private val PHONE = Regex("^\\+?[0-9 ]{7,20}$")

    /** Everything the form holds; role sections other than [role] are ignored. */
    data class Form(
        val role: String,
        val fullName: String = "",
        val email: String = "",
        val staffId: String = "",
        val department: String = "",
        val campus: String? = null,
        val designation: String = "",
        val phone: String = "",
        val password: String = "",
        val confirmPassword: String = "",
        val google: Boolean = false,
        val acceptPolicy: Boolean = false,
        // counsellor
        val specializations: Set<String> = emptySet(),
        val languages: String = "",
        val qualifications: String = "",
        val bio: String = "",
        val experienceYears: String = "",
        val sessionModes: Set<String> = emptySet(),
        // campus admin / security
        val authorizationReference: String = "",
        // committee
        val committeeId: String? = null,
        val position: String = "member",
        val identifierType: String = "staff",
        val reason: String = "",
        val experience: String = "",
        // security
        val serviceProvider: String = "",
        val shiftPreference: String? = null,
        val securityQualifications: String = "",
    )

    fun languages(raw: String): List<String> = raw.split(',', ';', '\n').map { it.trim() }.filter { it.isNotEmpty() }.distinct()

    fun validate(f: Form, emailDomain: String, passwordMin: Int, requireAdminReference: Boolean): Map<String, String> = buildMap {
        if (f.role !in ROLES) put("requestedRole", "Choose a role")
        if (f.fullName.trim().length < 2) put("fullName", "Enter your full name")
        if (!f.google) universityEmailError(f.email, emailDomain)?.let { put("email", it) }
        if (!IDENTIFIER.matches(f.staffId.trim())) put("staffId", "Letters, numbers, - and / only")
        if (f.department.trim().length < 2) put("department", "Enter your department")
        if (f.campus.isNullOrBlank()) put("campus", "Choose your campus")
        if (f.designation.trim().length < 2) put("designation", "Enter your designation")
        if (f.phone.isNotBlank() && !PHONE.matches(f.phone.trim())) put("phone", "Enter a valid phone number")
        if (!f.google) {
            passwordError(f.password, passwordMin)?.let { put("password", it) }
            if (f.confirmPassword != f.password) put("confirmPassword", "Passwords do not match")
        }
        if (!f.acceptPolicy) put("acceptPolicy", "Accept the Terms of Service and Privacy Policy")
        when (f.role) {
            "counsellor" -> {
                if (f.specializations.isEmpty()) put("counsellor.specializations", "Choose at least one specialization")
                val langs = languages(f.languages)
                if (langs.isEmpty()) put("counsellor.languages", "Add at least one language")
                else if (langs.size > 8 || langs.any { it.length !in 2..30 }) put("counsellor.languages", "Up to 8 languages, 2–30 characters each")
                if (f.qualifications.trim().length < 3) put("counsellor.qualifications", "Enter your qualifications or credentials")
                if (f.experienceYears.isNotBlank() && (f.experienceYears.trim().toIntOrNull() ?: -1) !in 0..60) put("counsellor.experienceYears", "Enter a number from 0 to 60")
                if (f.bio.length > 1000) put("counsellor.bio", "Use at most 1000 characters")
            }
            "admin" -> if (requireAdminReference && f.authorizationReference.isBlank()) put("admin.authorizationReference", "Required for Campus Admin requests")
            "committee_member" -> {
                if (f.committeeId.isNullOrBlank()) put("committee.committeeId", "Choose a committee")
                if (f.reason.length > 1000) put("committee.reason", "Use at most 1000 characters")
                if (f.experience.length > 1000) put("committee.experience", "Use at most 1000 characters")
            }
            "security_officer" -> {
                if (f.serviceProvider.trim().length < 2) put("security.serviceProvider", "Enter your security department or service provider")
                if (f.shiftPreference.isNullOrBlank()) put("security.shiftPreference", "Choose a shift preference")
            }
        }
    }

    /** The request body. Only the chosen role's section is sent; there is no way to send a permission or status. */
    fun body(f: Form, verificationMethod: String, googleTicket: String?, turnstileToken: String?): Map<String, Any?> {
        val details: Pair<String, Map<String, Any?>> = when (f.role) {
            "counsellor" -> "counsellor" to mapOf(
                "specializations" to f.specializations.toList(),
                "languages" to languages(f.languages),
                "qualifications" to f.qualifications.trim(),
                "bio" to f.bio.trim().ifBlank { null },
                "experienceYears" to f.experienceYears.trim().toIntOrNull(),
                "sessionModes" to f.sessionModes.toList(),
            )
            "admin" -> "admin" to mapOf("authorizationReference" to f.authorizationReference.trim().ifBlank { null })
            "committee_member" -> "committee" to mapOf(
                "committeeId" to f.committeeId,
                "position" to f.position,
                "identifierType" to f.identifierType,
                "reason" to f.reason.trim().ifBlank { null },
                "experience" to f.experience.trim().ifBlank { null },
            )
            else -> "security" to mapOf(
                "serviceProvider" to f.serviceProvider.trim(),
                "shiftPreference" to f.shiftPreference,
                "qualifications" to f.securityQualifications.trim().ifBlank { null },
                "authorizationReference" to f.authorizationReference.trim().ifBlank { null },
            )
        }
        return mapOf(
            "requestedRole" to f.role,
            "fullName" to f.fullName.trim(),
            "email" to f.email.trim().lowercase(),
            "staffId" to f.staffId.trim().uppercase(),
            "department" to f.department.trim(),
            "campus" to f.campus,
            "designation" to f.designation.trim(),
            "phone" to f.phone.trim().ifBlank { null },
            "password" to f.password.takeIf { !f.google },
            "confirmPassword" to f.confirmPassword.takeIf { !f.google },
            "googleTicket" to googleTicket,
            "verificationMethod" to verificationMethod,
            "acceptPolicy" to f.acceptPolicy,
            "turnstileToken" to turnstileToken,
            details,
        )
    }

    /** Whether anything was typed, so leaving the form asks first. */
    fun isDirty(f: Form, prefilledName: String, prefilledEmail: String): Boolean =
        f.fullName.trim() != prefilledName.trim() || (!f.google && f.email.trim() != prefilledEmail.trim()) || f.staffId.isNotBlank() ||
            f.department.isNotBlank() || f.designation.isNotBlank() || f.phone.isNotBlank() || f.password.isNotEmpty() ||
            f.specializations.isNotEmpty() || f.languages.isNotBlank() || f.qualifications.isNotBlank() || f.bio.isNotBlank() ||
            f.authorizationReference.isNotBlank() || f.committeeId != null || f.reason.isNotBlank() || f.experience.isNotBlank() ||
            f.serviceProvider.isNotBlank() || f.shiftPreference != null || f.securityQualifications.isNotBlank()

    fun roleTitle(role: String): String = when (role) {
        "counsellor" -> "Counsellor"
        "admin" -> "Campus Admin"
        "committee_member" -> "Committee Member"
        "security_officer" -> "Security Officer"
        else -> role.replace('_', ' ').replaceFirstChar { it.uppercase() }
    }

    /** Human wording for each separate status value shown on the application screen. */
    fun statusLabel(value: String): String = when (value) {
        "pending_email_verification" -> "Pending email verification"
        "pending_review" -> "Pending institutional review"
        "needs_info" -> "Requires additional information"
        "approved" -> "Approved"
        "rejected" -> "Rejected"
        "verified" -> "Verified"
        "pending" -> "Pending"
        "submitted" -> "Documents submitted"
        "under_review" -> "Under review"
        "expired" -> "Expired"
        "revoked" -> "Revoked"
        "active" -> "Active"
        "pending_verification" -> "Not active yet"
        "suspended" -> "Suspended"
        "deactivated" -> "Deactivated"
        "archived" -> "Archived"
        else -> value.replace('_', ' ').replaceFirstChar { it.uppercase() }
    }
}
