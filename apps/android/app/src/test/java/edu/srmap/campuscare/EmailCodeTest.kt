package edu.srmap.campuscare

import edu.srmap.campuscare.data.DeliveryInfo
import edu.srmap.campuscare.ui.components.TapGuard
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.screens.auth.EMAIL_CODE_LENGTH
import edu.srmap.campuscare.ui.screens.auth.codeFromClipboard
import edu.srmap.campuscare.ui.screens.auth.deliveryText
import edu.srmap.campuscare.ui.screens.auth.maskEmail
import edu.srmap.campuscare.ui.screens.auth.resetOptions
import edu.srmap.campuscare.ui.screens.auth.sanitizeCode
import edu.srmap.campuscare.ui.screens.auth.verificationOptions
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Code entry, method choice wording, delivery messages and the SOS double-tap guard. */
class EmailCodeTest {
    @Test
    fun `code input keeps only six digits, whatever is typed or pasted`() {
        assertEquals(6, EMAIL_CODE_LENGTH)
        assertEquals("123456", sanitizeCode("12 34-56"))
        assertEquals("123456", sanitizeCode("1234567890"))
        assertEquals("", sanitizeCode("abc"))
        assertEquals("042", sanitizeCode("0a4b2"))
    }

    @Test
    fun `paste finds a standalone six-digit code in the email text`() {
        assertEquals("482913", codeFromClipboard("Your CampusCare verification code is 482913. It expires in 10 minutes."))
        assertEquals("007700", codeFromClipboard("007700"))
        assertNull(codeFromClipboard("Call 1234567 now")) // seven digits is not a code
        assertNull(codeFromClipboard("12345"))
        assertNull(codeFromClipboard(null))
    }

    @Test
    fun `addresses are masked, never shown in full`() {
        assertEquals("s***@srmap.edu.in", maskEmail("student.name@srmap.edu.in"))
        assertEquals("a***@srmap.edu.in", maskEmail("  a@srmap.edu.in "))
        assertEquals("your university email", maskEmail("not-an-address"))
    }

    @Test
    fun `both flows offer a code and a link, code first`() {
        assertEquals(listOf("otp", "link"), verificationOptions().map { it.method })
        assertEquals(listOf("otp", "link"), resetOptions().map { it.method })
        assertEquals("Verify using OTP", verificationOptions()[0].title)
        assertEquals("Verify using an email link", verificationOptions()[1].title)
        assertEquals("Reset password with OTP", resetOptions()[0].title)
        assertEquals("Send a password-reset link", resetOptions()[1].title)
    }

    @Test
    fun `delivery status never claims delivery the provider did not report`() {
        assertNull(deliveryText(null, "code"))
        val accepted = deliveryText(DeliveryInfo("accepted"), "code")!!
        assertFalse(accepted.first.contains("delivered"))
        assertEquals(Tone.Brand, accepted.second)
        assertTrue(deliveryText(DeliveryInfo("delivered"), "code")!!.first.contains("delivered"))
        assertEquals("We couldn't send the email. Please try again.", deliveryText(DeliveryInfo("failed"), "link")!!.first)
        assertEquals(Tone.Danger, deliveryText(DeliveryInfo("rejected"), "link")!!.second)
        assertEquals(Tone.Danger, deliveryText(DeliveryInfo("bounced"), "link")!!.second)
        assertTrue(deliveryText(DeliveryInfo("sending"), "code")!!.first.startsWith("Sending"))
    }

    @Test
    fun `tap guard lets one SOS action through per window`() {
        var now = 10_000L
        val guard = TapGuard(1500) { now }
        var runs = 0
        assertTrue(guard.run { runs++ })
        now += 200
        assertFalse(guard.run { runs++ })
        now += 1299
        assertFalse(guard.run { runs++ })
        now += 1
        assertTrue(guard.run { runs++ })
        assertEquals(2, runs)
    }

    @Test
    fun `tap guard accepts the very first tap even right after boot`() {
        val guard = TapGuard(1500) { 5L }
        assertTrue(guard.run { })
    }
}
