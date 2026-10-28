package edu.srmap.campuscare

import edu.srmap.campuscare.ui.navigation.Routes
import org.junit.Assert.assertEquals
import org.junit.Test

/** CampusCare Student build only (testStudent*UnitTest). */
class StudentAppTest {
    @Test
    fun identity() {
        assertEquals(AppAudience.Student, AppAudience.current)
        assertEquals("in.edu.srmap.campuscare", BuildConfig.APPLICATION_ID)
        assertEquals("campuscare", BuildConfig.APP_SCHEME)
    }

    @Test
    fun studentsGoHomeAndStaffAreSentToSignIn() {
        assertEquals(Routes.Home, Routes.homeFor("student"))
        for (role in AppAudience.STAFF_ROLES) assertEquals(role, Routes.Login, Routes.homeFor(role))
    }

    @Test
    fun staffScreensAreOnlyPlaceholdersHere() {
        assertEquals(Routes.StaffOnly, Routes.otherAppRoutes())
    }
}
