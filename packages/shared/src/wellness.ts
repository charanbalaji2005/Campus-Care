import { z } from 'zod';

/** Counselling wellness: schedules, duty, feedback and reminders. */
export const FEEDBACK_CATEGORIES = ['helpful', 'listened', 'clear_next_steps', 'felt_safe', 'timing', 'communication', 'environment', 'other'] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];
export const FEEDBACK_STATUSES = ['new', 'reviewed', 'escalated', 'closed'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
/** none = no public comment (no consent or no text) · pending = awaiting a moderator · approved/rejected = decided. */
export const PUBLIC_COMMENT_STATES = ['none', 'pending', 'approved', 'rejected'] as const;
export type PublicCommentState = (typeof PUBLIC_COMMENT_STATES)[number];
export const PUBLIC_COMMENT_MAX = 400;
export const FEEDBACK_REPORT_REASONS = ['identifying', 'inappropriate', 'offensive', 'not_about_counselling', 'other'] as const;
export type FeedbackReportReason = (typeof FEEDBACK_REPORT_REASONS)[number];
/** Floor for the public feedback threshold: never fewer distinct students than this. */
export const PUBLIC_FEEDBACK_MIN_FLOOR = 3;

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
    /** Opt-in: an anonymised, moderator-approved version of the comment may appear on the counsellor's public profile. */
    sharePublicly: z.boolean().default(false),
  })
  .refine((v) => v.rating || v.categories.length || v.comment, 'Add a rating, a category or a comment.');

export const feedbackModerateSchema = z.object({
  status: z.enum(FEEDBACK_STATUSES),
  note: z.string().trim().max(1000).optional(),
  /** Decision on the public, anonymised comment (only for feedback whose author opted in). */
  publicComment: z.enum(['approved', 'rejected']).optional(),
  /** Moderator's edit of the public text; it is masked again on save. */
  publicText: z.string().trim().min(3).max(PUBLIC_COMMENT_MAX).optional(),
  /** Leaves the item out of every public rating, theme count and comment. */
  hiddenFromPublic: z.boolean().optional(),
});

export const reminderCreateSchema = z.object({
  dueAt: z.coerce.date().refine((d) => d.getTime() > Date.now() + 60_000, 'Choose a time in the future.'),
  /** Counsellors may remind themselves or the student; students only themselves. */
  audience: z.enum(['self', 'student']).default('self'),
  note: z.string().trim().max(500).optional(),
});

// ------------------------------------------------------------------ public counsellor directory
export const feedbackReportSchema = z.object({
  reason: z.enum(FEEDBACK_REPORT_REASONS),
  note: z.string().trim().max(300).optional(),
});

const shortText = (max: number) => z.string().trim().max(max);

/** What a counsellor may change on their own public profile. Credentials wait for Super Admin approval. */
export const counsellorPublicProfileSchema = z.object({
  title: shortText(80).min(2).optional(),
  bio: shortText(1000).optional(),
  specializations: z.array(z.string().trim().min(2).max(40)).max(12).optional(),
  languages: z.array(z.string().trim().min(2).max(40)).max(12).optional(),
  supportedModes: z.array(z.enum(['in_person', 'online', 'phone'])).min(1).max(3).optional(),
  /** Submitted for approval; the public profile keeps showing the last approved values meanwhile. */
  qualifications: z.array(z.string().trim().min(2).max(120)).max(10).optional(),
  yearsExperience: z.number().int().min(0).max(60).nullable().optional(),
});

/** Super Admin decisions on a counsellor's public listing. Every change needs a recorded reason. */
export const counsellorDirectoryAdminSchema = z
  .object({
    listed: z.boolean().optional(),
    photoVisible: z.boolean().optional(),
    credentials: z.enum(['approve', 'reject']).optional(),
    reason: z.string().trim().min(5, 'Record why you are making this change').max(500),
  })
  .refine((v) => v.listed !== undefined || v.photoVisible !== undefined || v.credentials !== undefined, 'Nothing to change.');

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL = /\b(?:https?:\/\/|www\.)\S+/gi;
const PHONE = /(?:\+?\d[\s().-]?){7,}\d/g;
/** Student/employee ids: letters followed by a long run of digits (e.g. AP22110010123), or 6+ digit numbers. */
const ID_LIKE = /\b[A-Z]{1,4}\d{6,}\b|\b\d{6,}\b/gi;
const HANDLE = /(^|\s)@[A-Z0-9_.]{2,}/gi;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * Prepares a feedback comment for public display: removes markup and control characters, masks
 * obvious identifiers (emails, links, phone numbers, ids, @handles) and shortens it. This lowers the
 * risk of identifying someone; it cannot guarantee anonymity, so public comments also need a moderator.
 */
export function sanitizeFeedbackText(input: string, max = PUBLIC_COMMENT_MAX): string {
  let t = input
    .replace(/<[^>]*>/g, ' ')
    .replace(/[<>]/g, ' ')
    .replace(CONTROL, '')
    .replace(EMAIL, '[email removed]')
    .replace(URL, '[link removed]')
    .replace(ID_LIKE, '[id removed]')
    .replace(PHONE, '[number removed]')
    .replace(HANDLE, '$1[handle removed]')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length > max) t = `${t.slice(0, max - 1).trimEnd()}…`;
  return t;
}
