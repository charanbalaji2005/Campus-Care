package edu.srmap.campuscare

import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.screens.staff.CampusAdminRules
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CampusAdminRulesTest {
    @Test
    fun portalScreensBelongToTheCollegeApp() {
        val screens = listOf(
            Routes.CampusAdminHome, Routes.CampusAdminMap, Routes.CampusAdminSos, Routes.CampusAdminSosDetail, Routes.CampusAdminReports,
            Routes.CampusAdminCounselling, Routes.CampusAdminStudents, Routes.CampusAdminStudent, Routes.CampusAdminSecurity,
            Routes.CampusAdminCommittees, Routes.CampusAdminAnalytics, Routes.CampusAdminAnnouncements, Routes.CampusAdminMessages, Routes.CampusAdminProfile,
            Routes.CampusAdminMore,
        )
        for (r in screens) {
            assertTrue(r, r in Routes.StaffOnly)
            assertFalse(r, r in Routes.StudentOnly)
        }
        assertEquals("ca/sos/abc", Routes.campusAdminSos("abc"))
        assertEquals("ca/students/s1", Routes.campusAdminStudent("s1"))
    }

    @Test
    fun sosAndReportStatesStaySeparate() {
        assertEquals("danger", CampusAdminRules.sosSeverityBucket("sent"))
        assertEquals("amber", CampusAdminRules.sosSeverityBucket("en_route"))
        assertEquals("ok", CampusAdminRules.sosSeverityBucket("resolved"))
        assertEquals("Awaiting acknowledgement", CampusAdminRules.sosStatusLabel("sent"))
        assertEquals("danger", CampusAdminRules.reportBucket("in_progress", overdue = true))
        assertEquals("violet", CampusAdminRules.reportBucket("under_review", overdue = false))
        assertEquals(listOf("open", "new", "under_review", "in_progress", "awaiting_information", "overdue", "resolved", "closed"), CampusAdminRules.REPORT_TABS.map { it.first })
        assertEquals(listOf("all", "admin", "committee", "campus", "security", "counselling"), CampusAdminRules.ANNOUNCEMENT_AUDIENCES.map { it.first })
    }

    @Test
    fun metricFormatting() {
        assertEquals("—", CampusAdminRules.duration(null))
        assertEquals("45 s", CampusAdminRules.duration(45))
        assertEquals("3 min", CampusAdminRules.duration(200))
        assertEquals("1 h 5 min", CampusAdminRules.duration(3900))
        assertEquals("+50%", CampusAdminRules.change(15, 10))
        assertEquals("−20%", CampusAdminRules.change(8, 10))
        assertEquals("new", CampusAdminRules.change(3, 0))
        assertEquals("—", CampusAdminRules.change(0, 0))
        assertEquals("<5", CampusAdminRules.aggregate(null, 5))
        assertEquals("12", CampusAdminRules.aggregate(12, 5))
        assertEquals("Good morning", CampusAdminRules.greeting(8))
        assertEquals("Good evening", CampusAdminRules.greeting(21))
    }

    @Test
    fun announcementBodyCarriesNoPrivilegeFields() {
        val b = CampusAdminRules.announcementBody("  Title  ", " Body text ", "campus_updates", "standard", "main", emptyList())
        assertEquals("Title", b["title"])
        assertEquals(listOf("all"), b["targetRoles"])
        assertEquals("main", b["campus"])
        for (k in listOf("authorId", "authorRole", "role", "permissions")) assertFalse(k, k in b)
    }
}
