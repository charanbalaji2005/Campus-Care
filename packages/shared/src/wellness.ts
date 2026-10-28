import { z } from 'zod';

/** Counselling wellness: schedules, duty, feedback and reminders. */
export const FEEDBACK_CATEGORIES = ['helpful', 'listened', 'clear_next_steps', 'felt_safe', 'timing', 'communication', 'environment', 'other'] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];
export const FEEDBACK_STATUSES = ['new', 'reviewed', 'escalated', 'closed'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/**
 * upcoming / follow_up / missed_follow_up / reschedule are scheduled automatically;
 * task (counsellor-created) and student_requested are created by people.
 */
export const REMINDER_KINDS = ['upcoming', 'follow_up', 'missed_follow_up', 'reschedule', 'task', 'student_requested'] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const window = z.object({ start: hhmm, end: hhmm });

export const counsellorScheduleSchema = z.object({
  weekly: z.array(window.extend({ weekday: z.number().int().min(0).max(6) })).max(50),
  slotMinutes: z.coerce.number().int().min(15).max(180).default(50),
  timezone: z.string().max(64).default('Asia/Kolkata'),
  blockedDates: z.array(ymd).max(366).default([]),
  breaks: z.array(window.extend({ weekday: z.number().int().min(0).max(6).nullable().default(null) })).max(30).default([]),
  dateOverrides: z.array(z.object({ date: ymd, closed: z.boolean().default(false), windows: z.array(window).max(10).default([]) })).max(120).default([]),
  /** Appointments per day; defaults to 10. */
  maxDailySessions: z.coerce.number().int().min(1).max(24).default(10),
});

/** On/Off Duty. Stored as `acceptingRequests` on the counsellor's availability. */
export const dutyToggleSchema = z.object({ onDuty: z.boolean(), reason: z.string().trim().max(300).optional() });

export const feedbackSubmitSchema = z
  .object({
    anonymous: z.boolean().default(true),
    rating: z.number().int().min(1).max(5).nullish(),
    categories: z.array(z.enum(FEEDBACK_CATEGORIES)).max(FEEDBACK_CATEGORIES.length).default([]),
    comment: z.string().trim().max(2000).optional(),
    concern: z.boolean().default(false),
  })
  .refine((v) => v.rating || v.categories.length || v.comment, 'Add a rating, a category or a comment.');

export const feedbackModerateSchema = z.object({ status: z.enum(FEEDBACK_STATUSES), note: z.string().trim().max(1000).optional() });

export const reminderCreateSchema = z.object({
  dueAt: z.coerce.date().refine((d) => d.getTime() > Date.now() + 60_000, 'Choose a time in the future.'),
  /** Counsellors may remind themselves or the student; students only themselves. */
  audience: z.enum(['self', 'student']).default('self'),
  note: z.string().trim().max(500).optional(),
});
