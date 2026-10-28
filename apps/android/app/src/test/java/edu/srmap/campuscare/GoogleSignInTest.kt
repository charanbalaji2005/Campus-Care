package edu.srmap.campuscare

import edu.srmap.campuscare.util.GoogleFailure
import edu.srmap.campuscare.util.GoogleSignIn
import edu.srmap.campuscare.util.GoogleSignInMessages
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GoogleSignInTest {
    private val college = "in.edu.srmap.campuscare.college"

    @Test
    fun `the College app never falls back to a website but Student keeps its fallback`() {
        assertFalse(GoogleSignIn.browserFallbackAllowed(AppAudience.College))
        assertTrue(GoogleSignIn.browserFallbackAllowed(AppAudience.Student))
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
