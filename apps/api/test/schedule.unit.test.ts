import { describe, expect, it } from 'vitest';
import { capacityOf, computeSlots, dayBounds, validateSchedule, type CounsellorSchedule } from '../src/lib/schedule';
import { zonedToUtc } from '../src/lib/time';

const TZ = 'Asia/Kolkata';
// Monday 2026-11-02 00:00 IST, so day 0 is a Monday (weekday 1).
const MONDAY = zonedToUtc(2026, 11, 2, 0, 0, TZ);
const base: CounsellorSchedule = {
  weekly: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '09:00', end: '17:00' })),
  slotMinutes: 60, timezone: TZ, blockedDates: [], acceptingRequests: true,
};
const at = (d: number, h: number, m = 0) => zonedToUtc(2026, 11, d, h, m, TZ);
const ist = (x: Date) => x.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

describe('counsellor schedule engine', () => {
  it('defaults to 10 appointments a day and honours a custom permitted capacity', () => {
    expect(capacityOf({})).toBe(10);
    expect(capacityOf({ maxDailySessions: 0 })).toBe(10); // older clients' "not set"
    expect(capacityOf({ maxDailySessions: 4 })).toBe(4);
    expect(capacityOf({ maxDailySessions: 99 })).toBe(24);
    const day = computeSlots(base, { booked: [], from: MONDAY, days: 1, minLeadMinutes: 0 })[0]!;
    expect(day.capacity).toBe(10);
    expect(day.slots).toHaveLength(8); // 09:00–17:00 in 60-minute slots
  });

  it('stops offering a day once its capacity is booked', () => {
    const s = { ...base, maxDailySessions: 2 };
    const booked = [{ startAt: at(2, 9), endAt: at(2, 10) }];
    let day = computeSlots(s, { booked, from: MONDAY, days: 1, minLeadMinutes: 0 })[0]!;
    expect(day.remaining).toBe(1);
    expect(day.slots.map(ist)).not.toContain('09:00');
    day = computeSlots(s, { booked: [...booked, { startAt: at(2, 11), endAt: at(2, 12) }], from: MONDAY, days: 1, minLeadMinutes: 0 })[0]!;
    expect(day.remaining).toBe(0);
    expect(day.slots).toHaveLength(0);
  });

  it('skips breaks, overlapping bookings, blocked dates and closed overrides; applies custom hours', () => {
    const s: CounsellorSchedule = {
      ...base,
      breaks: [{ weekday: null, start: '13:00', end: '14:00' }],
      blockedDates: ['2026-11-03'],
      dateOverrides: [{ date: '2026-11-04', closed: false, windows: [{ start: '10:00', end: '12:00' }] }, { date: '2026-11-05', closed: true, windows: [] }],
    };
    // A 90-minute booking from 10:30 blocks the 10:00 and 11:00 slots.
    const days = computeSlots(s, { booked: [{ startAt: at(2, 10, 30), endAt: at(2, 12) }], from: MONDAY, days: 4, minLeadMinutes: 0 });
    expect(days[0]!.slots.map(ist)).toEqual(['09:00', '12:00', '14:00', '15:00', '16:00']);
    expect(days[1]!.slots).toHaveLength(0); // blocked
    expect(days[2]!.slots.map(ist)).toEqual(['10:00', '11:00']); // custom hours
    expect(days[3]!.slots).toHaveLength(0); // closed override
  });

  it('offers nothing while off duty', () => {
    expect(computeSlots({ ...base, acceptingRequests: false }, { booked: [], from: MONDAY, days: 7, minLeadMinutes: 0 })).toEqual([]);
  });

  it('respects the lead time and counts capacity by local day', () => {
    const day = computeSlots(base, { booked: [], from: at(2, 12), days: 1, minLeadMinutes: 120 })[0]!;
    expect(day.slots.map(ist)[0]).toBe('14:00');
    const { start, end } = dayBounds('2026-11-02', TZ);
    expect(end.getTime() - start.getTime()).toBe(86400_000);
    expect(ist(start)).toBe('00:00');
  });

  it('rejects impossible or overlapping schedules', () => {
    expect(validateSchedule({ ...base, weekly: [{ weekday: 1, start: '10:00', end: '09:00' }] })).toHaveLength(1);
    expect(validateSchedule({ ...base, weekly: [{ weekday: 1, start: '09:00', end: '12:00' }, { weekday: 1, start: '11:00', end: '13:00' }] })[0]).toContain('overlaps');
    expect(validateSchedule({ ...base, dateOverrides: [{ date: '2026-11-04', closed: true, windows: [] }, { date: '2026-11-04', closed: true, windows: [] }] })).toHaveLength(1);
    expect(validateSchedule(base)).toEqual([]);
  });
});
