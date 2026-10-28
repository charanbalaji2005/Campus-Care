package edu.srmap.campuscare

import edu.srmap.campuscare.ui.navigation.Routes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Rules shared by CampusCare Student and CampusCare College (runs for both flavors). */
class AppAudienceTest {
    @Test
    fun studentAppAcceptsOnlyStudents() {
        assertTrue(AppAudience.Student.allows("student"))
        for (role in AppAudience.STAFF_ROLES) assertFalse(role, AppAudience.Student.allows(role))
        assertFalse(AppAudience.Student.allows(null))
        assertFalse(AppAudience.Student.allows("unknown"))
    }

    @Test
    fun collegeAppAcceptsEveryStaffRoleButNoStudents() {
        assertFalse(AppAudience.College.allows("student"))
        for (role in listOf("counsellor", "committee_member", "security_officer", "moderator", "admin", "super_admin")) {
            assertTrue(role, AppAudience.College.allows(role))
        }
        assertFalse(AppAudience.College.allows(null))
        assertFalse(AppAudience.College.allows(""))
    }

    @Test
    fun wireValuesMatchTheApiHeader() {
        assertEquals("student", AppAudience.Student.wire)
        assertEquals("college", AppAudience.College.wire)
        assertEquals(AppAudience.College, AppAudience.fromWire("college"))
        assertEquals(AppAudience.Student, AppAudience.fromWire("nonsense"))
        assertNull(AppAudience.forRole("visitor"))
        assertEquals(AppAudience.College, AppAudience.Student.other)
    }

    @Test
    fun wrongAppMessageNamesTheRightApp() {
        assertTrue(AppAudience.wrongAppMessage("security_officer").contains("CampusCare College"))
        assertTrue(AppAudience.wrongAppMessage("student").contains("CampusCare Student"))
    }

    @Test
    fun studentAndStaffScreenGroupsDoNotOverlap() {
        assertTrue(Routes.StudentOnly.intersect(Routes.StaffOnly.toSet()).isEmpty())
        assertEquals(Routes.StudentOnly.size, Routes.StudentOnly.toSet().size)
        assertEquals(Routes.StaffOnly.size, Routes.StaffOnly.toSet().size)
    }

    @Test
    fun sharedScreensStayInBothApps() {
        val appSpecific = (Routes.StudentOnly + Routes.StaffOnly).toSet()
        for (route in listOf(
            Routes.Splash, Routes.Login, Routes.Reset, Routes.AcceptInvite, Routes.Mfa, Routes.OfflineEmergency,
            Routes.Profile, Routes.Notifications, Routes.Chat, Routes.Community, Routes.CounsellingChannel,
            Routes.CounsellorChats, Routes.SafetyMap, Routes.Contacts, Routes.CampusAlerts, Routes.LostFoundItem, Routes.Help,
        )) assertFalse(route, route in appSpecific)
    }

    @Test
    fun eachRolesHomeBelongsToItsOwnApp() {
        assertTrue(Routes.Home in Routes.StudentOnly)
        for (home in listOf(Routes.CounsellorHome, Routes.CommitteeCases, Routes.ResponderAlerts, Routes.AdminHome, Routes.Moderation)) {
            assertTrue(home, home in Routes.StaffOnly)
        }
        // Raising an SOS and filing reports stay in the student app; responding stays in the staff app.
        assertTrue(Routes.Sos in Routes.StudentOnly && Routes.Report in Routes.StudentOnly)
        assertTrue(Routes.ResponderAlert in Routes.StaffOnly && Routes.Case in Routes.StaffOnly)
    }
}
