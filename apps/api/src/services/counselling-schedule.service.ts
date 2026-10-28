import { Types } from 'mongoose';
import { ACTIVE_APPOINTMENT_STATUSES } from '@campuscare/shared';
import { AppError } from '../lib/http';
import { zonedParts } from '../lib/time';
import { capacityOf, computeSlots, dayBounds, type BookedInterval, type CounsellorSchedule, type DaySlots } from '../lib/schedule';
import { Appointment, Availability, type AppointmentDoc } from '../models/counselling';
import { enqueueJob } from './jobs.service';

/** How long an assigned counsellor has to accept or decline a request. */
export const RESPONSE_WINDOW_MS = 60 * 60_000;
/** Nudge before the deadline. */
export const RESPONSE_REMINDER_MS = 45 * 60_000;

type AvailabilityLike = Partial<CounsellorSchedule> & { weekly?: unknown; breaks?: unknown; dateOverrides?: unknown };

export function scheduleOf(a: AvailabilityLike | null | undefined): CounsellorSchedule {
  return {
    weekly: ((a?.weekly as CounsellorSchedule['weekly']) ?? []).map((w) => ({ weekday: w.weekday, start: w.start, end: w.end })),
    slotMinutes: a?.slotMinutes ?? 50,
    timezone: a?.timezone ?? 'Asia/Kolkata',
    blockedDates: a?.blockedDates ?? [],
    breaks: ((a?.breaks as CounsellorSchedule['breaks']) ?? []).map((b) => ({ weekday: b.weekday ?? null, start: b.start, end: b.end })),
    dateOverrides: ((a?.dateOverrides as CounsellorSchedule['dateOverrides']) ?? []).map((o) => ({ date: o.date, closed: Boolean(o.closed), windows: (o.windows ?? []).map((w) => ({ start: w.start, end: w.end })) })),
    maxDailySessions: a?.maxDailySessions ?? undefined,
    acceptingRequests: a?.acceptingRequests ?? false,
  };
}

/** The counsellor's active bookings from the start of today onwards (they count towards today's capacity). */
export async function bookedIntervals(counsellorId: unknown, excludeAppointmentId?: unknown): Promise<BookedInterval[]> {
  const rows = await Appointment.find(
    { counsellorId, status: { $in: ACTIVE_APPOINTMENT_STATUSES }, startAt: { $gte: new Date(Date.now() - 86400_000) }, ...(excludeAppointmentId ? { _id: { $ne: excludeAppointmentId } } : {}) },
    { startAt: 1, endAt: 1 },
  ).lean();
  return rows.filter((r) => r.startAt).map((r) => ({ startAt: r.startAt!, endAt: r.endAt ?? new Date(r.startAt!.getTime() + 50 * 60_000) }));
}

export async function slotsFor(counsellorId: unknown, opts: { days?: number; onlyDate?: string; excludeAppointmentId?: unknown } = {}): Promise<{ schedule: CounsellorSchedule; days: DaySlots[] }> {
  const a = await Availability.findOne({ counsellorId }).lean();
  const schedule = scheduleOf(a as never);
  const days = computeSlots(schedule, { booked: await bookedIntervals(counsellorId, opts.excludeAppointmentId), days: opts.days, onlyDate: opts.onlyDate });
  return { schedule, days };
}

/** Keeps `preferred` when it is still bookable for this counsellor, otherwise the earliest open slot. */
export async function pickSlot(counsellorId: unknown, preferred: Date | null | undefined, excludeAppointmentId?: unknown) {
  const { schedule, days } = await slotsFor(counsellorId, { excludeAppointmentId });
  const all = days.flatMap((d) => d.slots);
  const chosen = (preferred && all.find((s) => s.getTime() === preferred.getTime())) || all[0] || null;
  return chosen ? { startAt: chosen, endAt: new Date(chosen.getTime() + schedule.slotMinutes * 60_000) } : null;
}

/**
 * Concurrency guard, run right after an appointment row is written. Among active appointments of the
 * same counsellor, the earliest-created one (lowest _id) wins an overlap, and only the first
 * `dailyCapacity` of a day survive. Every racing request computes the same order, so the slot or day
 * can never be over-booked; the losers are told to pick another time.
 */
export async function slotConflict(appt: Pick<AppointmentDoc, '_id' | 'counsellorId' | 'startAt' | 'endAt'>): Promise<null | 'slot_taken' | 'day_full'> {
  if (!appt.counsellorId || !appt.startAt || !appt.endAt) return null;
  const a = await Availability.findOne({ counsellorId: appt.counsellorId }, { timezone: 1, maxDailySessions: 1 }).lean();
  const tz = a?.timezone ?? 'Asia/Kolkata';
  const earlierOverlap = await Appointment.exists({
    _id: { $lt: appt._id }, counsellorId: appt.counsellorId, status: { $in: ACTIVE_APPOINTMENT_STATUSES },
    startAt: { $lt: appt.endAt }, endAt: { $gt: appt.startAt },
  });
  if (earlierOverlap) return 'slot_taken';
  const cap = capacityOf(a ?? {});
  const { start, end } = dayBounds(zonedParts(appt.startAt, tz).ymd, tz);
  const sameDay = await Appointment.find({ counsellorId: appt.counsellorId, status: { $in: ACTIVE_APPOINTMENT_STATUSES }, startAt: { $gte: start, $lt: end } }, { _id: 1 }).sort({ _id: 1 }).limit(cap + 1).lean();
  const rank = sameDay.findIndex((x) => String(x._id) === String(appt._id));
  return rank === -1 || rank >= cap ? 'day_full' : null;
}

export function conflictError(kind: 'slot_taken' | 'day_full') {
  return kind === 'slot_taken'
    ? new AppError(409, 'slot_taken', 'That time was just taken. Please pick another slot.')
    : new AppError(409, 'day_full', 'This counsellor is fully booked that day. Please pick another day.');
}

/**
 * Starts the one-hour response clock for the currently assigned counsellor. The jobs carry the
 * assignment identity; when they run they do nothing unless that exact assignment is still waiting,
 * so accepting, declining or reassigning cancels them without touching the queue. Jobs are stored
 * in MongoDB and survive restarts.
 */
export async function startResponseClock(appt: AppointmentDoc) {
  if (appt.status !== 'requested' || !appt.counsellorId) return;
  const now = new Date();
  appt.assignedAt = now;
  appt.responseDueAt = new Date(now.getTime() + RESPONSE_WINDOW_MS);
  appt.responseOverdueAt = null;
  await appt.save();
  const payload = { appointmentId: String(appt._id), counsellorId: String(appt.counsellorId), assignedAt: now.getTime() };
  const key = `${appt._id}:${now.getTime()}`;
  await enqueueJob('counselling.response_reminder', payload, { runAt: new Date(now.getTime() + RESPONSE_REMINDER_MS), dedupeKey: `cc-remind:${key}`, maxAttempts: 3 });
  await enqueueJob('counselling.response_deadline', payload, { runAt: appt.responseDueAt, dedupeKey: `cc-deadline:${key}`, maxAttempts: 5 });
}

/** True while the given assignment is still the one waiting for a response. */
export function isCurrentAssignment(appt: { status?: string | null; counsellorId?: unknown; assignedAt?: Date | null } | null, payload: Record<string, unknown>) {
  return Boolean(appt && appt.status === 'requested' && String(appt.counsellorId) === String(payload.counsellorId) && appt.assignedAt && appt.assignedAt.getTime() === Number(payload.assignedAt));
}

export const objectIds = (list: unknown[] | null | undefined) => (list ?? []).map((x) => new Types.ObjectId(String(x)));
