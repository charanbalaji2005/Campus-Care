import { zonedParts, zonedToUtc, type WeeklyWindow } from './time';

/** Default number of appointments a counsellor takes per day unless they set another permitted value. */
export const DEFAULT_DAILY_CAPACITY = 10;
export const MAX_DAILY_CAPACITY = 24;

export interface TimeWindow { start: string; end: string }
/** weekday null = every working day. */
export interface BreakWindow extends TimeWindow { weekday: number | null }
/** A specific date: closed, or custom windows that replace the weekly pattern for that day. */
export interface DateOverride { date: string; closed: boolean; windows: TimeWindow[] }

export interface CounsellorSchedule {
  weekly: WeeklyWindow[];
  slotMinutes: number;
  timezone: string;
  blockedDates: string[];
  breaks?: BreakWindow[] | null;
  dateOverrides?: DateOverride[] | null;
  /** Appointments per local day; 0 or unset means the default (10). */
  maxDailySessions?: number | null;
  /** On Duty. Off duty offers no slots and receives no new requests. */
  acceptingRequests?: boolean | null;
}

export interface BookedInterval { startAt: Date; endAt: Date }

export interface DaySlots {
  date: string; // YYYY-MM-DD in the counsellor's timezone
  capacity: number;
  booked: number;
  remaining: number;
  slots: Date[];
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};

export function capacityOf(s: Pick<CounsellorSchedule, 'maxDailySessions'>) {
  const c = s.maxDailySessions || DEFAULT_DAILY_CAPACITY;
  return Math.max(0, Math.min(MAX_DAILY_CAPACITY, Math.floor(c)));
}

/** Bookable only while on duty (accepting requests). Off duty never offers new slots. */
export function isBookable(s: Pick<CounsellorSchedule, 'acceptingRequests'>) {
  return s.acceptingRequests !== false;
}

/** UTC bounds of a local calendar day, for capacity counting. */
export function dayBounds(ymd: string, timezone: string) {
  const [y, m, d] = ymd.split('-').map(Number);
  const start = zonedToUtc(y!, m!, d!, 0, 0, timezone);
  const next = new Date(Date.UTC(y!, m! - 1, d! + 1));
  const end = zonedToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, timezone);
  return { start, end };
}

/** Problems that would make the schedule produce impossible or overlapping slots. */
export function validateSchedule(s: CounsellorSchedule): string[] {
  const errors: string[] = [];
  const checkWindows = (list: TimeWindow[], label: string) => {
    const sorted = [...list].sort((a, b) => a.start.localeCompare(b.start));
    sorted.forEach((w, i) => {
      if (minutes(w.end) <= minutes(w.start)) errors.push(`${label}: ${w.start}–${w.end} must end after it starts.`);
      const prev = sorted[i - 1];
      if (prev && minutes(w.start) < minutes(prev.end)) errors.push(`${label}: ${prev.start}–${prev.end} overlaps ${w.start}–${w.end}.`);
    });
  };
  for (let wd = 0; wd < 7; wd++) checkWindows(s.weekly.filter((w) => w.weekday === wd), `Weekday ${wd}`);
  for (const b of s.breaks ?? []) if (minutes(b.end) <= minutes(b.start)) errors.push(`Break ${b.start}–${b.end} must end after it starts.`);
  const seen = new Set<string>();
  for (const o of s.dateOverrides ?? []) {
    if (seen.has(o.date)) errors.push(`${o.date} has more than one custom schedule.`);
    seen.add(o.date);
    if (!o.closed) checkWindows(o.windows, o.date);
  }
  if ((s.maxDailySessions ?? DEFAULT_DAILY_CAPACITY) > MAX_DAILY_CAPACITY) errors.push(`Daily capacity can be at most ${MAX_DAILY_CAPACITY}.`);
  return errors;
}

/**
 * Bookable slot starts per day. A slot is offered only when it fits inside a working window, does not
 * touch a break, does not overlap an existing booking, starts after the lead time, and the day still
 * has capacity left. Off duty (or not accepting) offers nothing. Booked intervals must be the
 * counsellor's active appointments.
 */
export function computeSlots(
  s: CounsellorSchedule,
  opts: { booked: BookedInterval[]; from?: Date; days?: number; minLeadMinutes?: number; onlyDate?: string },
): DaySlots[] {
  const out: DaySlots[] = [];
  if (!isBookable(s)) return out;
  const from = opts.from ?? new Date();
  const earliest = from.getTime() + (opts.minLeadMinutes ?? 120) * 60000;
  const capacity = capacityOf(s);
  const overrides = new Map((s.dateOverrides ?? []).map((o) => [o.date, o]));
  const seen = new Set<string>();
  for (let i = 0; i < (opts.days ?? 14); i++) {
    const { y, m, d, weekday, ymd } = zonedParts(new Date(from.getTime() + i * 86400000), s.timezone);
    if (seen.has(ymd)) continue; // DST-safe: never emit a day twice
    seen.add(ymd);
    if (opts.onlyDate && ymd !== opts.onlyDate) continue;
    const { start: dayStart, end: dayEnd } = dayBounds(ymd, s.timezone);
    const bookedToday = opts.booked.filter((b) => b.startAt >= dayStart && b.startAt < dayEnd).length;
    const day: DaySlots = { date: ymd, capacity, booked: bookedToday, remaining: Math.max(0, capacity - bookedToday), slots: [] };
    const override = overrides.get(ymd);
    if (s.blockedDates.includes(ymd) || override?.closed) { day.remaining = 0; out.push(day); continue; }
    const windows = override ? override.windows : s.weekly.filter((w) => w.weekday === weekday);
    const breaks = (s.breaks ?? []).filter((b) => b.weekday === null || b.weekday === undefined || b.weekday === weekday);
    if (day.remaining > 0) {
      for (const w of windows) {
        for (let t = minutes(w.start); t + s.slotMinutes <= minutes(w.end); t += s.slotMinutes) {
          if (breaks.some((b) => t < minutes(b.end) && t + s.slotMinutes > minutes(b.start))) continue;
          const slot = zonedToUtc(y, m, d, Math.floor(t / 60), t % 60, s.timezone);
          const end = new Date(slot.getTime() + s.slotMinutes * 60000);
          if (slot.getTime() < earliest) continue;
          if (opts.booked.some((b) => slot < b.endAt && end > b.startAt)) continue;
          day.slots.push(slot);
        }
      }
      day.slots.sort((a, b) => a.getTime() - b.getTime());
    }
    out.push(day);
  }
  return out;
}

export function nextAvailable(days: DaySlots[]): Date | null {
  for (const d of days) if (d.slots.length) return d.slots[0]!;
  return null;
}
