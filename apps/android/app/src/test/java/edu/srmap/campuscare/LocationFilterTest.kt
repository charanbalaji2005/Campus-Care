package edu.srmap.campuscare

import edu.srmap.campuscare.util.FilterDecision
import edu.srmap.campuscare.util.LocationFilter
import edu.srmap.campuscare.util.LocationQuality
import edu.srmap.campuscare.util.LocationQualityRules
import edu.srmap.campuscare.util.RawFix
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.cos
import kotlin.random.Random

/** Synthetic fixes (not real-device GPS). Real-world accuracy must still be checked on physical phones. */
class LocationFilterTest {
    private val baseLat = 16.4636
    private val baseLon = 80.5074
    private val mPerDegLat = 111_320.0
    private val mPerDegLon = 111_320.0 * cos(Math.toRadians(baseLat))

    private fun fix(northM: Double, eastM: Double, acc: Double?, tSec: Double, speed: Double? = null) =
        RawFix(baseLat + northM / mPerDegLat, baseLon + eastM / mPerDegLon, acc, (tSec * 1000).toLong(), speedMps = speed)

    private fun LocationFilter.est() = (offerLast as FilterDecision.Accepted).estimate
    private var offerLast: FilterDecision? = null
    private fun LocationFilter.feed(f: RawFix): FilterDecision = offer(f).also { offerLast = it }

    private fun errorMeters(lat: Double, lon: Double, northM: Double, eastM: Double) =
        LocationFilter.distanceMeters(lat, lon, baseLat + northM / mPerDegLat, baseLon + eastM / mPerDegLon)

    @Test
    fun rejectsInvalidCoordinates() {
        val f = LocationFilter()
        assertTrue(f.offer(RawFix(Double.NaN, 80.0, 5.0, 1000)) is FilterDecision.Rejected)
        assertTrue(f.offer(RawFix(91.0, 80.0, 5.0, 1000)) is FilterDecision.Rejected)
        assertTrue(f.offer(RawFix(16.0, 181.0, 5.0, 1000)) is FilterDecision.Rejected)
        assertTrue(f.offer(RawFix(0.0, 0.0, 5.0, 1000)) is FilterDecision.Rejected) // "null island" is never a real campus fix
        assertTrue(f.offer(RawFix(16.0, 80.0, -3.0, 1000)) is FilterDecision.Rejected)
    }

    @Test
    fun rejectsOutOfOrderFixes() {
        val f = LocationFilter()
        assertTrue(f.offer(fix(0.0, 0.0, 10.0, 10.0)) is FilterDecision.Accepted)
        assertEquals(FilterDecision.Rejected("out_of_order"), f.offer(fix(1.0, 1.0, 10.0, 9.0)))
    }

    @Test
    fun reducesJitterWhenStationary() {
        val rnd = Random(42)
        val f = LocationFilter()
        var rawErr = 0.0
        var estErr = 0.0
        for (i in 0 until 60) {
            val n = rnd.nextDouble(-8.0, 8.0)
            val e = rnd.nextDouble(-8.0, 8.0)
            f.feed(fix(n, e, 10.0, i.toDouble()))
            if (i >= 20) {
                rawErr += errorMeters(baseLat + n / mPerDegLat, baseLon + e / mPerDegLon, 0.0, 0.0)
                estErr += f.est().let { errorMeters(it.latitude, it.longitude, 0.0, 0.0) }
            }
        }
        assertTrue("filtered error $estErr should be well below raw $rawErr", estErr < rawErr * 0.6)
    }

    @Test
    fun followsGenuineWalkingMovement() {
        val f = LocationFilter()
        // Walking north at 1.4 m/s for 2 minutes with ±6 m fixes every 2 s.
        for (i in 0..60) {
            val t = i * 2.0
            f.feed(fix(1.4 * t, 0.0, 6.0, t, speed = 1.4))
        }
        val e = f.est()
        val lag = errorMeters(e.latitude, e.longitude, 1.4 * 120, 0.0)
        assertTrue("estimate should stay close to the walker (lag $lag m)", lag < 12.0)
    }

    @Test
    fun followsALongGapWithoutRejectingTheNewPosition() {
        val f = LocationFilter()
        f.feed(fix(0.0, 0.0, 8.0, 0.0))
        // Signal lost for 5 minutes (e.g. indoors); 300 m away is plausible walking.
        assertTrue(f.feed(fix(300.0, 0.0, 8.0, 300.0)) is FilterDecision.Accepted)
    }

    @Test
    fun rejectsASingleImplausibleJumpButAcceptsAConsistentRelocation() {
        val f = LocationFilter()
        for (i in 0..10) f.feed(fix(0.0, 0.0, 5.0, i.toDouble()))
        // One multipath spike 600 m away one second later: inconsistent and implausible.
        assertEquals(FilterDecision.Rejected("outlier"), f.feed(fix(600.0, 0.0, 10.0, 11.0)))
        val stillHere = f.feed(fix(0.5, 0.0, 5.0, 12.0))
        assertTrue(stillHere is FilterDecision.Accepted)
        assertTrue(errorMeters((stillHere as FilterDecision.Accepted).estimate.latitude, stillHere.estimate.longitude, 0.0, 0.0) < 5)
        // But three disagreeing fixes in a row mean the estimate was wrong: reset to the measurements.
        f.feed(fix(800.0, 0.0, 5.0, 13.0))
        f.feed(fix(800.5, 0.0, 5.0, 14.0))
        val third = f.feed(fix(801.0, 0.0, 5.0, 15.0))
        assertTrue(third is FilterDecision.Accepted && third.reset)
        assertTrue(errorMeters(f.est().latitude, f.est().longitude, 801.0, 0.0) < 2)
    }

    @Test
    fun weighsMeasurementsByTheirUncertainty() {
        val f = LocationFilter()
        f.feed(fix(0.0, 0.0, 5.0, 0.0))
        f.feed(fix(0.0, 0.0, 5.0, 1.0))
        // A vague ±90 m fix 60 m away barely moves the estimate.
        f.feed(fix(60.0, 0.0, 90.0, 2.0))
        assertTrue(errorMeters(f.est().latitude, f.est().longitude, 0.0, 0.0) < 5)
    }

    @Test
    fun neverClaimsBetterAccuracyThanTheBestMeasurement() {
        val f = LocationFilter()
        for (i in 0..30) f.feed(fix(0.0, 0.0, 12.0, i.toDouble()))
        assertTrue(f.est().accuracyMeters >= 12.0)
        assertEquals(12.0, f.lastRaw!!.accuracyMeters!!, 0.0)
    }

    @Test
    fun classifiesQualityAndStaleness() {
        val s = LocationQualityRules.SOS_STALE_SECONDS
        assertEquals(LocationQuality.High, LocationQualityRules.classify(12.0, 2.0, s))
        assertEquals(LocationQuality.Usable, LocationQualityRules.classify(30.0, 2.0, s))
        assertEquals(LocationQuality.Low, LocationQualityRules.classify(70.0, 2.0, s))
        assertEquals(LocationQuality.Poor, LocationQualityRules.classify(300.0, 2.0, s))
        assertEquals(LocationQuality.Unknown, LocationQualityRules.classify(null, 2.0, s))
        // A cached fix is never treated as live, however accurate.
        assertEquals(LocationQuality.Stale, LocationQualityRules.classify(5.0, 600.0, s))
        assertEquals("16.464, 80.507", LocationQualityRules.formatCoordinates(16.46361, 80.50741, 250.0))
        assertEquals("16.46361, 80.50741", LocationQualityRules.formatCoordinates(16.46361, 80.50741, 8.0))
    }
}
