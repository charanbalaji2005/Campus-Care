package edu.srmap.campuscare

import edu.srmap.campuscare.data.DirectoryCounsellor
import edu.srmap.campuscare.data.PublicRating
import edu.srmap.campuscare.data.RatingText
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RatingTextTest {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; coerceInputValues = true }

    @Test
    fun `below the threshold nothing but a neutral note is shown`() {
        val r = PublicRating(status = "insufficient", minimum = 3)
        assertFalse(r.isAvailable)
        assertEquals("Not enough feedback yet", RatingText.summary(r))
        assertNull(RatingText.short(r))
        assertEquals("Not enough feedback yet", RatingText.summary(null))
        assertTrue(RatingText.threshold(5).contains("at least 5"))
    }

    @Test
    fun `themes without enough star ratings never show an average`() {
        val r = PublicRating(status = "available", average = null)
        assertEquals("Feedback shared, not enough star ratings yet", RatingText.summary(r))
        assertNull(RatingText.short(r))
    }

    @Test
    fun `available ratings read naturally for screen readers`() {
        val r = PublicRating(status = "available", average = 4.5, ratingCount = 6)
        assertEquals("4.5 out of 5 from 6 ratings", RatingText.summary(r))
        assertEquals("4.5 (6)", RatingText.short(r))
        assertEquals("4.0 out of 5 from 1 rating", RatingText.summary(r.copy(average = 4.0, ratingCount = 1)))
    }

    @Test
    fun `stars fill to the nearest half, then down`() {
        assertEquals(4, RatingText.filledStars(4.3))
        assertEquals(5, RatingText.filledStars(4.8))
        assertEquals(5, RatingText.filledStars(4.75))
        assertEquals(1, RatingText.filledStars(1.0))
        assertEquals(5, RatingText.filledStars(9.0))
    }

    @Test
    fun `parses the server's public profile, including an insufficient rating with no other fields`() {
        val body = """
            {"id":"c1","name":"Maya","department":"Student Wellness","photoUrl":"/counselling/counsellors/c1/photo?v=1",
             "qualifications":["M.A. Psychology"],"yearsExperience":7,
             "rating":{"status":"insufficient","minimum":3},"comments":[],"feedbackMinimum":3}
        """.trimIndent()
        val c = json.decodeFromString(DirectoryCounsellor.serializer(), body)
        assertEquals("Student Wellness", c.department)
        assertEquals(listOf("M.A. Psychology"), c.qualifications)
        assertFalse(c.rating!!.isAvailable)
        val full = json.decodeFromString(
            DirectoryCounsellor.serializer(),
            """{"id":"c1","name":"Maya","rating":{"status":"available","minimum":3,"average":4.5,"ratingCount":6,"distribution":{"1":0,"2":0,"3":1,"4":1,"5":4},"themes":[{"category":"listened","count":4}]},"comments":[{"ref":"abc","text":"Kind"}]}""",
        )
        assertEquals(4, full.rating!!.distribution!!["5"])
        assertEquals("listened", full.rating!!.themes.first().category)
        assertEquals("Kind", full.comments.single().text)
    }
}
