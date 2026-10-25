import { zonedParts, zonedToUtc, type WeeklyWindow } from '../lib/time';

export type CounsellorPresence = 'available' | 'outside_hours' | 'away';

interface AvailabilityLike {
  weekly?: WeeklyWindow[] | null;
  timezone?: string | null;
  blockedDates?: string[] | null;
  acceptingRequests?: boolean | null;
}

/**
 * Whether a counsellor is inside their published working hours right now. This is an indicator for
 * students, not a promise of an instant reply — the app always says so next to it.
 */
export function counsellorPresence(a: AvailabilityLike | null | undefined, now = new Date()): { status: CounsellorPresence; nextAvailableAt: Date | null; message: string } {
  if (!a || a.acceptingRequests === false || !(a.weekly ?? []).length) {
    return { status: 'away', nextAvailableAt: null, message: 'This counsellor is not taking new conversations right now. You can still leave a message or contact another counsellor.' };
  }
  const tz = a.timezone || 'Asia/Kolkata';
  const blocked = a.blockedDates ?? [];
  let next: Date | null = null;
  for (let i = 0; i < 8 && !next; i++) {
    const day = new Date(now.getTime() + i * 86400_000);
    const { y, m, d, weekday, ymd } = zonedParts(day, tz);
    if (blocked.includes(ymd)) continue;
    const windows = (a.weekly ?? []).filter((w) => w.weekday === weekday).sort((x, z) => x.start.localeCompare(z.start));
    for (const w of windows) {
      const [sh, sm] = w.start.split(':').map(Number);
      const [eh, em] = w.end.split(':').map(Number);
      const start = zonedToUtc(y, m, d, sh!, sm!, tz);
      const end = zonedToUtc(y, m, d, eh!, em!, tz);
      if (i === 0 && start <= now && now < end) {
        return { status: 'available', nextAvailableAt: null, message: 'Within working hours. Replies usually come during the working day — this is not an emergency service.' };
      }
      if (start > now) { next = start; break; }
    }
  }
  return {
    status: 'outside_hours',
    nextAvailableAt: next,
    message: 'Outside working hours. Your message will be seen when the counsellor is next available. If you are in danger now, call campus security or 112.',
  };
}
