/** Timezone helpers without external libraries (uses the Intl database bundled with Node). */
export function tzOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return Math.round((asUtc - date.getTime()) / 60000);
}

/** Converts a wall-clock time in a timezone to a UTC Date. */
export function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, timeZone: string): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const offset = tzOffsetMinutes(guess, timeZone);
  const first = new Date(guess.getTime() - offset * 60000);
  const offset2 = tzOffsetMinutes(first, timeZone);
  return offset2 === offset ? first : new Date(guess.getTime() - offset2 * 60000);
}

export function zonedParts(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), weekday, ymd: `${p.year}-${p.month}-${p.day}` };
}

export interface WeeklyWindow { weekday: number; start: string; end: string }

/** Generates bookable slot start times for the next `days` days. */
export function generateSlots(opts: { weekly: WeeklyWindow[]; slotMinutes: number; timezone: string; blockedDates: string[]; days?: number; from?: Date; minLeadMinutes?: number }): Date[] {
  const out: Date[] = [];
  const from = opts.from ?? new Date();
  const earliest = from.getTime() + (opts.minLeadMinutes ?? 120) * 60000;
  for (let i = 0; i < (opts.days ?? 14); i++) {
    const day = new Date(from.getTime() + i * 86400000);
    const { y, m, d, weekday, ymd } = zonedParts(day, opts.timezone);
    if (opts.blockedDates.includes(ymd)) continue;
    for (const w of opts.weekly.filter((x) => x.weekday === weekday)) {
      const [sh, sm] = w.start.split(':').map(Number);
      const [eh, em] = w.end.split(':').map(Number);
      for (let t = sh * 60 + sm; t + opts.slotMinutes <= eh * 60 + em; t += opts.slotMinutes) {
        const slot = zonedToUtc(y, m, d, Math.floor(t / 60), t % 60, opts.timezone);
        if (slot.getTime() >= earliest) out.push(slot);
      }
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}
