package edu.srmap.campuscare

import edu.srmap.campuscare.ui.navigation.Routes
import org.junit.Assert.assertEquals
import org.junit.Test

/** CampusCare College build only (testCollege*UnitTest). */
class CollegeAppTest {
    @Test
    fun identity() {
        assertEquals(AppAudience.College, AppAudience.current)
        assertEquals("in.edu.srmap.campuscare.college", BuildConfig.APPLICATION_ID)
        assertEquals("campuscare-college", BuildConfig.APP_SCHEME)
    }

    @Test
    fun eachStaffRoleGetsItsOwnHomeAndStudentsAreSentToSignIn() {
        assertEquals(Routes.Login, Routes.homeFor("student"))
        assertEquals(Routes.CounsellorHome, Routes.homeFor("counsellor"))
        assertEquals(Routes.CommitteeCases, Routes.homeFor("committee_member"))
        assertEquals(Routes.ResponderAlerts, Routes.homeFor("security_officer"))
        assertEquals(Routes.AdminHome, Routes.homeFor("admin"))
        assertEquals(Routes.Moderation, Routes.homeFor("moderator"))
    }

    @Test
    fun studentScreensAreOnlyPlaceholdersHere() {
        assertEquals(Routes.StudentOnly, Routes.otherAppRoutes())
    }
}
