import { Types } from 'mongoose';
import { PUBLIC_FEEDBACK_MIN_FLOOR, type PlatformSettings } from '@campuscare/shared';
import { env } from '../config/env';
import { hmac } from '../lib/crypto';
import { nextAvailable } from '../lib/schedule';
import { Availability } from '../models/counselling';
import { User } from '../models/user';
import { CounsellingFeedback } from '../models/wellness';
import { slotsFor } from './counselling-schedule.service';
import { counsellorPresence } from './counsellor-availability';
import { getSettings } from './settings.service';

/**
 * Public counsellor directory: who students may see and book, what they see (an explicit allowlist),
 * and the privacy rules for ratings and feedback.
 *
 *  - Eligible = counsellor role, active (verified) account, and listed by a Super Admin.
 *  - Ratings, themes and comments are public only once at least `feedbackMinimum` DISTINCT students
 *    (pseudonymous rater keys) have given non-concern feedback that a moderator has not hidden. One
 *    student's repeat sessions therefore never unlock it, and the same threshold applies to averages
 *    (counted over raters who left a star rating), so a lone rating can never be read off the average.
 *  - Comments additionally need the student's opt-in and a moderator's approval; only the masked
 *    `publicText` is ever returned, with no date, rating or id that could link it to a session.
 */

const raterPepper = () => hmac(env.APP_ENCRYPTION_KEY, 'campuscare:feedback-rater:v1');
const refPepper = () => hmac(env.APP_ENCRYPTION_KEY, 'campuscare:feedback-public-ref:v1');

/** Same student + counsellor → same key; different counsellors → unrelated keys. */
export const raterKeyFor = (counsellorId: unknown, studentId: unknown) => hmac(raterPepper(), `${String(counsellorId)}:${String(studentId)}`);
/** Opaque handle for a public comment (an ObjectId would reveal when it was written). */
export const commentRefFor = (feedbackId: unknown) => hmac(refPepper(), String(feedbackId)).slice(0, 24);

export const feedbackMinimum = (s: PlatformSettings) => Math.max(PUBLIC_FEEDBACK_MIN_FLOOR, Math.floor(s.counsellorDirectory?.feedbackMinimum ?? PUBLIC_FEEDBACK_MIN_FLOOR));

/** Feedback that may count toward anything public. Legacy rows without a rater key are left out. */
export const publicFeedbackFilter = (counsellorIds: unknown[]) => ({
  counsellorId: { $in: counsellorIds },
  concern: false,
  hiddenFromPublic: { $ne: true },
  raterKey: { $type: 'string' },
});

export type PublicRating =
  | { status: 'insufficient'; minimum: number }
  | { status: 'available'; minimum: number; average: number | null; ratingCount: number; distribution: Record<'1' | '2' | '3' | '4' | '5', number> | null; themes: { category: string; count: number }[] };

/** Server-side aggregates per counsellor, already reduced to what may be shown publicly. */
export async function ratingSummaries(counsellorIds: unknown[], s?: PlatformSettings): Promise<Map<string, PublicRating>> {
  const settings = s ?? (await getSettings());
  const min = feedbackMinimum(settings);
  const ids = counsellorIds.map((x) => new Types.ObjectId(String(x)));
  const rows = await CounsellingFeedback.aggregate<{
    _id: Types.ObjectId; raters: string[]; ratedRaters: string[]; ratings: number[]; categories: string[][];
  }>([
    { $match: publicFeedbackFilter(ids) },
    {
      $group: {
        _id: '$counsellorId',
        raters: { $addToSet: '$raterKey' },
        // Missing and null both fail `> 0`; nulls are dropped below.
        ratedRaters: { $addToSet: { $cond: [{ $gt: ['$rating', 0] }, '$raterKey', null] } },
        ratings: { $push: '$rating' },
        categories: { $push: '$categories' },
      },
    },
  ]);
  const out = new Map<string, PublicRating>();
  for (const id of ids) out.set(String(id), { status: 'insufficient', minimum: min });
  for (const r of rows) {
    if (r.raters.length < min) continue;
    const ratings = r.ratings.filter((x): x is number => typeof x === 'number' && x >= 1 && x <= 5);
    const ratingsPublic = r.ratedRaters.filter(Boolean).length >= min && ratings.length > 0;
    const distribution = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 } as Record<'1' | '2' | '3' | '4' | '5', number>;
    ratings.forEach((x) => { distribution[String(x) as '1'] += 1; });
    const counts: Record<string, number> = {};
    r.categories.flat().forEach((c) => { counts[c] = (counts[c] ?? 0) + 1; });
    out.set(String(r._id), {
      status: 'available',
      minimum: min,
      average: ratingsPublic ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null,
      ratingCount: ratingsPublic ? ratings.length : 0,
      distribution: ratingsPublic ? distribution : null,
      themes: Object.entries(counts).map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count).slice(0, 6),
    });
  }
  return out;
}

/** Approved, masked comments, only above the threshold. Shuffled so their order says nothing about recency. */
export async function publicComments(counsellorId: unknown, rating: PublicRating, s: PlatformSettings, limit = 10) {
  if (rating.status !== 'available' || !s.counsellorDirectory.showComments) return [];
  const rows = await CounsellingFeedback.find(
    { ...publicFeedbackFilter([counsellorId]), publicComment: 'approved', publicText: { $type: 'string' } },
    { publicText: 1 },
  ).limit(100).lean();
  return rows
    .map((r) => ({ ref: commentRefFor(r._id), text: r.publicText as string }))
    .sort(() => Math.random() - 0.5)
    .slice(0, limit);
}

/** Finds the comment a public `ref` points to (for reports), among this counsellor's approved comments only. */
export async function findCommentByRef(counsellorId: string, ref: string) {
  const rows = await CounsellingFeedback.find({ counsellorId, publicComment: 'approved' }, { _id: 1 }).lean();
  return rows.find((r) => commentRefFor(r._id) === ref) ?? null;
}

// ------------------------------------------------------------------ eligibility and the public allowlist
export const eligibleCounsellorFilter = { role: 'counsellor', accountStatus: 'active' } as const;

/** Whether a student may see and book this counsellor. */
export async function isStudentVisible(counsellorId: unknown) {
  if (!Types.ObjectId.isValid(String(counsellorId))) return false;
  const [user, a] = await Promise.all([
    User.exists({ _id: counsellorId, ...eligibleCounsellorFilter }),
    Availability.findOne({ counsellorId }, { listed: 1 }).lean(),
  ]);
  return Boolean(user) && a?.listed !== false;
}

type CounsellorUser = { _id: unknown; fullName: string; department?: string | null; avatarUpdatedAt?: Date | null };
// Availability is loosely typed here on purpose: older documents may lack the newer fields.
type AvailabilityLike = Record<string, any> | null | undefined;

const humanize = (k: string) => k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/**
 * The public counsellor profile. Every field is listed explicitly: never email, phone, employee id,
 * permissions, workload, other students, notes, or unapproved credentials.
 */
export async function publicCounsellor(c: CounsellorUser, a: AvailabilityLike, opts: { date?: string | null; withSlots?: boolean; rating?: PublicRating; staff?: boolean }) {
  const { schedule, days } = await slotsFor(c._id, { days: 14 });
  const presence = counsellorPresence(a as never);
  const bookable = schedule.acceptingRequests !== false && a?.listed !== false;
  const day = opts.date ? days.find((d) => d.date === opts.date) : undefined;
  const credentialsApproved = Boolean(a?.credentialsApprovedAt);
  const photo = c.avatarUpdatedAt && a?.photoVisible !== false ? `/counselling/counsellors/${String(c._id)}/photo?v=${new Date(c.avatarUpdatedAt).getTime()}` : null;
  return {
    id: String(c._id),
    name: c.fullName,
    title: a?.title ?? 'Counsellor',
    department: c.department ?? null,
    bio: a?.bio ?? '',
    avatarUrl: a?.avatarUrl ?? null,
    photoUrl: photo,
    specializations: a?.specializations ?? [],
    languages: a?.languages ?? [],
    supportedModes: a?.supportedModes ?? ['in_person'],
    campus: a?.campus ?? 'main',
    qualifications: credentialsApproved ? a?.qualifications ?? [] : [],
    yearsExperience: credentialsApproved ? a?.yearsExperience ?? null : null,
    acceptingRequests: bookable,
    onDuty: schedule.acceptingRequests !== false,
    availability: !bookable ? 'unavailable' : presence.status === 'available' ? 'available_now' : 'by_appointment',
    nextAvailableAt: nextAvailable(days),
    slotsToday: days[0]?.slots.length ?? 0,
    timezone: schedule.timezone,
    slotMinutes: schedule.slotMinutes,
    rating: opts.rating ?? null,
    ...(opts.staff ? { listed: a?.listed !== false } : {}),
    ...(opts.withSlots ? { days: days.map((d) => ({ date: d.date, slots: d.slots.map((x) => x.toISOString()), full: d.remaining === 0 })) } : {}),
    ...(opts.date ? { slotsOnDate: day?.slots.length ?? 0 } : {}),
  };
}

export type PublicCounsellor = Awaited<ReturnType<typeof publicCounsellor>>;

export interface DirectoryQuery {
  q?: string | null;
  specialization?: string | null;
  language?: string | null;
  mode?: string | null;
  campus?: string | null;
  department?: string | null;
  date?: string | null;
  sort?: 'name' | 'availability' | 'rating' | null;
}

function matchesText(e: PublicCounsellor, q: string) {
  const needle = q.toLowerCase();
  const hay = [e.name, e.title, e.department ?? '', e.campus, ...e.languages, ...e.specializations, ...e.specializations.map(humanize)].join(' ').toLowerCase();
  return needle.split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

/** The directory for one viewer. Students only get listed, accepting counsellors with an open slot. */
export async function listDirectory(query: DirectoryQuery, viewer: { student: boolean }) {
  const settings = await getSettings();
  const counsellors = await User.find(eligibleCounsellorFilter, { fullName: 1, department: 1, avatarUpdatedAt: 1 }).sort({ fullName: 1 }).limit(300).lean();
  const avail = await Availability.find({ counsellorId: { $in: counsellors.map((c) => c._id) } }).lean();
  const byId = new Map(avail.map((a) => [String(a.counsellorId), a as AvailabilityLike]));
  const ratings = await ratingSummaries(counsellors.map((c) => c._id), settings);
  const rows: PublicCounsellor[] = [];
  for (const c of counsellors) {
    const a = byId.get(String(c._id));
    if (viewer.student && a?.listed === false) continue;
    if (query.specialization && !(a?.specializations ?? []).includes(query.specialization)) continue;
    if (query.language && !(a?.languages ?? []).some((l: string) => l.toLowerCase() === query.language!.toLowerCase())) continue;
    if (query.mode && !(a?.supportedModes ?? []).includes(query.mode)) continue;
    if (query.campus && (a?.campus ?? 'main') !== query.campus) continue;
    if (query.department && (c.department ?? '').toLowerCase() !== query.department.toLowerCase()) continue;
    const entry = await publicCounsellor(c, a, { date: query.date, rating: ratings.get(String(c._id)), staff: !viewer.student });
    if (viewer.student && (!entry.acceptingRequests || !entry.nextAvailableAt)) continue;
    if (query.date && !entry.slotsOnDate) continue;
    if (query.q && !matchesText(entry, query.q)) continue;
    rows.push(entry);
  }
  const avg = (e: PublicCounsellor) => (e.rating?.status === 'available' && e.rating.average != null ? e.rating.average : -1);
  if (query.sort === 'availability') {
    rows.sort((x, y) => (x.nextAvailableAt?.getTime() ?? Infinity) - (y.nextAvailableAt?.getTime() ?? Infinity) || x.name.localeCompare(y.name));
  } else if (query.sort === 'rating') {
    rows.sort((x, y) => avg(y) - avg(x) || x.name.localeCompare(y.name));
  }
  return rows;
}
