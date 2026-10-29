package edu.srmap.campuscare

import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.screens.auth.StaffRegistrationRules
import edu.srmap.campuscare.ui.screens.auth.StaffRegistrationRules.Form
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StaffRegistrationRulesTest {
    private val domain = "srmap.edu.in"
    private fun base(role: String) = Form(
        role = role, fullName = "Dr Asha Rao", email = "asha.rao@srmap.edu.in", staffId = "emp-1024", department = "Student Welfare",
        campus = "main", designation = "Senior Counsellor", password = "GoodPassword123", confirmPassword = "GoodPassword123", acceptPolicy = true,
    )
    private fun errors(f: Form, requireRef: Boolean = true) = StaffRegistrationRules.validate(f, domain, 10, requireRef)

    @Test
    fun eachRoleNeedsItsOwnFields() {
        assertEquals(setOf("counsellor.specializations", "counsellor.languages", "counsellor.qualifications"), errors(base("counsellor")).keys)
        assertEquals(setOf("admin.authorizationReference"), errors(base("admin")).keys)
        assertTrue(errors(base("admin"), requireRef = false).isEmpty())
        assertEquals(setOf("committee.committeeId"), errors(base("committee_member")).keys)
        assertEquals(setOf("security.serviceProvider", "security.shiftPreference"), errors(base("security_officer")).keys)

        assertTrue(errors(base("counsellor").copy(specializations = setOf("general"), languages = "English, Telugu", qualifications = "M.Phil Psychology")).isEmpty())
        assertTrue(errors(base("security_officer").copy(serviceProvider = "Campus Security", shiftPreference = "night")).isEmpty())
        assertTrue(errors(base("committee_member").copy(committeeId = "a".repeat(24))).isEmpty())
    }

    @Test
    fun sharedFieldsAreChecked() {
        val f = base("admin").copy(authorizationReference = "OO/17", email = "a@gmail.com", staffId = "bad id!", campus = null, confirmPassword = "Other123456", acceptPolicy = false, phone = "12")
        assertEquals(setOf("email", "staffId", "campus", "confirmPassword", "acceptPolicy", "phone"), errors(f).keys)
        assertTrue("requestedRole" in errors(base("super_admin")))
        assertTrue("counsellor.experienceYears" in errors(base("counsellor").copy(specializations = setOf("general"), languages = "English", qualifications = "MA Psych", experienceYears = "99")))
    }

    @Test
    fun googleApplicantsNeedNoPassword() {
        val f = base("admin").copy(authorizationReference = "OO/17", google = true, password = "", confirmPassword = "", email = "")
        assertTrue(errors(f).isEmpty())
        val body = StaffRegistrationRules.body(f, "otp", "gr1.ticket", null)
        assertNull(body["password"])
        assertEquals("gr1.ticket", body["googleTicket"])
    }

    @Test
    fun bodyCarriesOnlyTheChosenRoleAndNoPrivilegeFields() {
        val f = base("counsellor").copy(specializations = setOf("general"), languages = "English; Telugu, English", qualifications = "MA", experienceYears = "6", authorizationReference = "ignored")
        val body = StaffRegistrationRules.body(f, "link", null, "tt")
        assertEquals("counsellor", body["requestedRole"])
        assertEquals("EMP-1024", body["staffId"])
        @Suppress("UNCHECKED_CAST")
        val section = body["counsellor"] as Map<String, Any?>
        assertEquals(listOf("English", "Telugu"), section["languages"])
        assertEquals(6, section["experienceYears"])
        for (key in listOf("admin", "committee", "security", "role", "permissions", "accountStatus", "approvalRequired", "managedCampuses")) {
            assertFalse(key, key in body)
        }
    }

    @Test
    fun dirtyTracksTypedInputOnly() {
        assertFalse(StaffRegistrationRules.isDirty(Form(role = "admin", fullName = "From Google", email = "g@srmap.edu.in", google = true), "From Google", "g@srmap.edu.in"))
        assertTrue(StaffRegistrationRules.isDirty(Form(role = "admin", staffId = "E1"), "", ""))
    }

    @Test
    fun registrationScreensBelongToTheCollegeApp() {
        for (r in listOf(Routes.StaffRegister, Routes.StaffRegisterForm, Routes.StaffApplication)) assertTrue(r, r in Routes.StaffOnly)
        // Without a Google ticket the routes carry no query (android.net.Uri is not available in JVM tests).
        assertEquals("staff/register", Routes.staffRegister())
        assertEquals("staff/register/security_officer", Routes.staffRegisterForm("security_officer"))
    }
}
