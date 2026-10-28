package edu.srmap.campuscare

/**
 * Which of the two CampusCare apps this build is. Both are built from this codebase (Gradle product
 * flavors `student` and `college`) and talk to the same API; the API binds every session to the app
 * that created it and refuses accounts whose role belongs to the other app (`wrong_app`). The checks
 * here only keep the UI honest; they are never what grants access.
 */
enum class AppAudience(val wire: String, val appName: String) {
    Student("student", "CampusCare Student"),
    College("college", "CampusCare College");

    /** Whether an account with this role may use this app. */
    fun allows(role: String?): Boolean = role != null && forRole(role) == this

    val other: AppAudience get() = if (this == Student) College else Student

    companion object {
        /** Every staff role, including a Super Admin acting as a counsellor in the app. */
        val STAFF_ROLES = setOf("counsellor", "committee_member", "security_officer", "moderator", "admin", "super_admin")

        /** This build's app. */
        val current: AppAudience = fromWire(BuildConfig.APP_AUDIENCE)

        fun fromWire(value: String?): AppAudience = entries.firstOrNull { it.wire == value } ?: Student

        /** Students use CampusCare Student; every other known role uses CampusCare College. */
        fun forRole(role: String): AppAudience? = when (role) {
            "student" -> Student
            in STAFF_ROLES -> College
            else -> null
        }

        /** Shown when an account signs in to the app that isn't meant for it. */
        fun wrongAppMessage(role: String?): String = when (role?.let(::forRole)) {
            College -> "This is a college staff account. Sign in with the ${College.appName} app."
            Student -> "This is a student account. Sign in with the ${Student.appName} app."
            null -> "This account can't use ${current.appName}."
        }
    }
}
