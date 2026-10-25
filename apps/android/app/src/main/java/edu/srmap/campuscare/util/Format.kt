package edu.srmap.campuscare.util

import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Date helpers for the ISO-8601 timestamps returned by the API. Shown in the device time zone. */
object Fmt {
    private val zone: ZoneId get() = ZoneId.systemDefault()
    private val date = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH)
    private val dateTime = DateTimeFormatter.ofPattern("d MMM yyyy, h:mm a", Locale.ENGLISH)
    private val time = DateTimeFormatter.ofPattern("h:mm a", Locale.ENGLISH)
    private val dayTime = DateTimeFormatter.ofPattern("EEE d MMM · h:mm a", Locale.ENGLISH)

    fun parse(iso: String?): Instant? = iso?.let { runCatching { Instant.parse(it) }.getOrNull() }
    fun date(iso: String?): String = parse(iso)?.atZone(zone)?.format(date) ?: "—"
    fun dateTime(iso: String?): String = parse(iso)?.atZone(zone)?.format(dateTime) ?: "—"
    fun time(iso: String?): String = parse(iso)?.atZone(zone)?.format(time) ?: "—"
    fun dayTime(iso: String?): String = parse(iso)?.atZone(zone)?.format(dayTime) ?: "—"

    fun ago(iso: String?): String {
        val t = parse(iso) ?: return ""
        val d = Duration.between(t, Instant.now())
        return when {
            d.isNegative -> "in ${humanDuration(d.negated())}"
            d.seconds < 45 -> "just now"
            d.toMinutes() < 60 -> "${d.toMinutes()} min ago"
            d.toHours() < 24 -> "${d.toHours()} h ago"
            d.toDays() < 7 -> "${d.toDays()} d ago"
            else -> date(iso)
        }
    }

    fun humanDuration(d: Duration): String = when {
        d.toMinutes() < 1 -> "${d.seconds}s"
        d.toHours() < 1 -> "${d.toMinutes()} min"
        d.toDays() < 1 -> "${d.toHours()} h ${d.toMinutes() % 60} min"
        else -> "${d.toDays()} d"
    }

    fun toIso(z: ZonedDateTime): String = z.toInstant().toString()

    fun greeting(): String = when (ZonedDateTime.now().hour) {
        in 5..11 -> "Good morning"
        in 12..16 -> "Good afternoon"
        else -> "Good evening"
    }

    fun humanize(s: String): String = s.replace('_', ' ').replaceFirstChar { it.uppercase() }

    fun bytes(n: Long): String = when {
        n < 1024 -> "$n B"
        n < 1024 * 1024 -> "${n / 1024} KB"
        else -> String.format(Locale.ENGLISH, "%.1f MB", n / 1024.0 / 1024.0)
    }
}
