package edu.srmap.campuscare

import edu.srmap.campuscare.ui.components.Catalog
import edu.srmap.campuscare.ui.screens.auth.passwordError
import edu.srmap.campuscare.ui.screens.auth.universityEmailError
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ValidationTest {
    private val domain = "srmap.edu.in"

    @Test
    fun acceptsOnlyUniversityEmails() {
        assertNull(universityEmailError("student@srmap.edu.in", domain))
        assertNull(universityEmailError("  Student@SRMAP.edu.in ", domain))
        assertNull(universityEmailError("student@gmail.com", domain))
        assertNotNull(universityEmailError("student@srmap.edu.in.evil.com", domain))
        assertNotNull(universityEmailError("student@sub.srmap.edu.in", domain))
        assertNotNull(universityEmailError("", domain))
        assertNotNull(universityEmailError("not-an-email", domain))
    }

    @Test
    fun passwordRules() {
        assertNotNull(passwordError("Short1", 10))
        assertNotNull(passwordError("alllowercase123", 10))
        assertNull(passwordError("GoodPassword123", 10))
    }

    @Test
    fun handlerTransitionsNeverReopenClosedCases() {
        assertTrue(Catalog.transitions["closed"].isNullOrEmpty())
        assertTrue(Catalog.transitions["withdrawn"].isNullOrEmpty())
        assertTrue("resolved" in Catalog.transitions.getValue("in_progress"))
    }

    @Test
    fun unknownCategoryFallsBackToOther() {
        assertEquals("other", Catalog.category("does-not-exist").key)
        assertEquals("Under triage", Catalog.statusLabel("triage"))
    }
}
