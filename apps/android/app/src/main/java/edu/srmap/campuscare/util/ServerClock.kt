package edu.srmap.campuscare.util

/**
 * Offset between the server clock and this phone's clock, learned from responses that carry
 * `serverTime`. Deadlines set by the server (acknowledgement windows, countdowns) are measured
 * against the server's "now", so a phone with a wrong clock still shows the right time left.
 */
object ServerClock {
    @Volatile private var offsetMs: Long = 0L

    fun update(serverTimeIso: String?) {
        val server = Fmt.parse(serverTimeIso) ?: return
        offsetMs = server.toEpochMilli() - System.currentTimeMillis()
    }

    /** The server's current time in epoch milliseconds (best estimate). */
    fun nowMs(): Long = System.currentTimeMillis() + offsetMs

    /** Whole seconds left until [iso] on the server clock (negative once passed), or null if unparseable. */
    fun secondsUntil(iso: String?): Long? = Fmt.parse(iso)?.let { Math.floorDiv(it.toEpochMilli() - nowMs() + 999, 1000L) }
}
