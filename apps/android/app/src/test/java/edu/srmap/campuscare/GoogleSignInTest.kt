package edu.srmap.campuscare

import edu.srmap.campuscare.util.GoogleFailure
import edu.srmap.campuscare.util.GoogleRefusal
import edu.srmap.campuscare.util.GoogleRefusals
import edu.srmap.campuscare.util.GoogleSignInMessages
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GoogleSignInTest {
    private val college = "in.edu.srmap.campuscare.college"

    @Test
    fun `College with no account offers a staff application, never in the Student app`() {
        val details = mapOf("staffRegistrationTicket" to "gr1.abc.def", "email" to "new@srmap.edu.in", "fullName" to "New Person")
        val apply = GoogleRefusals.from(AppAudience.College, 403, "no_staff_account", "No account", details)
        assertTrue(apply is GoogleRefusal.ApplyAsStaff)
        assertEquals("gr1.abc.def", (apply as GoogleRefusal.ApplyAsStaff).ticket)
        assertEquals("new@srmap.edu.in", apply.email)
        // No ticket, or the wrong app: just the message.
        assertTrue(GoogleRefusals.from(AppAudience.College, 403, "no_staff_account", "No account", emptyMap()) is GoogleRefusal.Show)
        assertTrue(GoogleRefusals.from(AppAudience.Student, 403, "no_staff_account", "No account", details) is GoogleRefusal.Show)
    }

    @Test
    fun `Student sign-in with no account offers Google sign-up only in the Student app`() {
        assertTrue(GoogleRefusals.from(AppAudience.Student, 404, "no_student_account", "No account yet", emptyMap()) is GoogleRefusal.OfferStudentSignUp)
        assertTrue(GoogleRefusals.from(AppAudience.College, 404, "no_student_account", "No account yet", emptyMap()) is GoogleRefusal.Show)
    }

    @Test
    fun `wrong app, pending and link-required refusals show the server's message`() {
        for (code in listOf("wrong_app", "approval_pending", "account_suspended", "google_link_required", "registration_closed")) {
            val r = GoogleRefusals.from(AppAudience.Student, 403, code, "Server says $code", emptyMap())
            assertTrue(code, r is GoogleRefusal.Show)
            assertEquals("Server says $code", r.message)
        }
    }

    @Test
    fun `unverified email keeps the verification ticket and network trouble is retryable`() {
        val v = GoogleRefusals.from(AppAudience.Student, 403, "email_not_verified", "Verify first", mapOf("verificationTicket" to "vt1"))
        assertEquals("vt1", (v as GoogleRefusal.VerifyEmail).ticket)
        assertTrue(GoogleRefusals.from(AppAudience.College, 0, "network", null, emptyMap()) is GoogleRefusal.Retry)
        assertTrue(GoogleRefusals.from(AppAudience.College, 503, "google_unavailable", "Down", emptyMap()) is GoogleRefusal.Retry)
    }

    @Test
    fun `a developer-console error is reported as an unregistered app with this app's own ID`() {
        val f = GoogleSignInMessages.failure(GoogleFailure.Other, "[28444] Developer console is not set up correctly.", college, "srmap.edu.in")
        assertEquals(GoogleFailure.AppNotRegistered, f.reason)
        assertTrue(f.message.contains(college))
        assertFalse(f.retryable) // retrying cannot fix a configuration problem
    }

    @Test
    fun `no account explains both causes, names the right package and allows a retry`() {
        val f = GoogleSignInMessages.failure(GoogleFailure.NoAccount, "No credentials available", college, "srmap.edu.in")
        assertEquals(GoogleFailure.NoAccount, f.reason)
        assertTrue(f.message.contains("@srmap.edu.in"))
        assertTrue(f.message.contains(college))
        assertFalse(f.message.contains("in.edu.srmap.campuscare'")) // no longer hard-codes the Student package
        assertTrue(f.retryable)
    }

    @Test
    fun `interruptions are retryable but missing Play services and missing configuration are not`() {
        assertTrue(GoogleSignInMessages.failure(GoogleFailure.Interrupted, null, college, "srmap.edu.in").retryable)
        assertFalse(GoogleSignInMessages.failure(GoogleFailure.Unavailable, null, college, "srmap.edu.in").retryable)
        val notConfigured = GoogleSignInMessages.failure(GoogleFailure.NotConfigured, null, college, "srmap.edu.in")
        assertFalse(notConfigured.retryable)
        assertTrue(notConfigured.message.contains("email and password"))
    }

    @Test
    fun `messages never echo raw system text`() {
        val f = GoogleSignInMessages.failure(GoogleFailure.Other, "internal: token=abc123", college, "srmap.edu.in")
        assertFalse(f.message.contains("abc123"))
    }
}
