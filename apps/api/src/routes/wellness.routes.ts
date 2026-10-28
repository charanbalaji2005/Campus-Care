import { Router } from 'express';
import { Types } from 'mongoose';
import {
  ACTIVE_APPOINTMENT_STATUSES, counsellorScheduleSchema, dutyToggleSchema, feedbackModerateSchema, feedbackSubmitSchema, hasPermission, reminderCreateSchema,
  sanitizeFeedbackText, type Role,
} from '@campuscare/shared';
import { AppError, asyncHandler, notFound, ok, pageParams, parse } from '../lib/http';
import { validateSchedule } from '../lib/schedule';
import { zonedParts } from '../lib/time';
import { Appointment, Availability } from '../models/counselling';
import { CounsellingFeedback, CounsellingReminder, FeedbackReceipt } from '../models/wellness';
import { User, type UserDoc } from '../models/user';
import { requireAuth, requirePermission, requireRole } from '../middleware/auth';
import { audit } from '../services/audit.service';
import { slotsFor } from '../services/counselling-schedule.service';
import { addReminder } from '../services/counselling-workflow.service';
import { raterKeyFor } from '../services/counsellor-directory.service';
import { notifyMany } from '../services/notification.service';

/**
 * Counselling wellness: counsellor duty and schedule, anonymous feedback, reminders and
 * aggregate analytics. Mounted under /api/v1/counselling next to the appointment routes.
 */
export const wellnessRouter = Router();
wellnessRouter.use(requireAuth);

const can = (u: UserDoc, p: Parameters<typeof hasPermission>[1]) => hasPermission({ role: u.role as Role, permissions: u.permissions ?? [] }, p);
/** Feedback for a single counsellor is only shown once there is enough of it to blur who wrote what. */
export const FEEDBACK_MIN_GROUP = 3;

async function upcomingAffected(counsellorId: unknown) {
  const soon = await Appointment.find(
    { counsellorId, status: { $in: ACTIVE_APPOINTMENT_STATUSES }, startAt: { $gte: new Date(), $lte: new Date(Date.now() + 7 * 86400_000) } },
    { startAt: 1, status: 1, mode: 1 },
  ).sort({ startAt: 1 }).limit(50).lean();
  return soon.map((a) => ({ id: String(a._id), startAt: a.startAt, status: a.status, mode: a.mode }));
}

// ------------------------------------------------------------------ duty
wellnessRouter.get(
  '/duty',
  requireRole('counsellor'),
  asyncHandler(async (req, res) => {
    const a = await Availability.findOne({ counsellorId: req.user!._id }, { acceptingRequests: 1, dutyChangedAt: 1 }).lean();
    ok(res, { onDuty: a?.acceptingRequests ?? false, changedAt: a?.dutyChangedAt ?? null, upcoming: await upcomingAffected(req.user!._id) });
  }),
);

/**
 * On/Off Duty (stored as `acceptingRequests`). Off duty stops new slots and new assignments
 * immediately; booked appointments and open conversations are kept, and the response lists the
 * upcoming appointments the counsellor still needs to attend, reschedule or hand over.
 */
wellnessRouter.put(
  '/duty',
  requireRole('counsellor'),
  asyncHandler(async (req, res) => {
    const { onDuty, reason } = parse(dutyToggleSchema, req.body);
    const prev = await Availability.findOne({ counsellorId: req.user!._id }, { acceptingRequests: 1 }).lean();
    const changed = Boolean(prev?.acceptingRequests) !== onDuty;
    await Availability.updateOne({ counsellorId: req.user!._id }, { $set: { acceptingRequests: onDuty, ...(changed ? { dutyChangedAt: new Date() } : {}) } }, { upsert: true });
    if (changed) await audit({ action: onDuty ? 'counsellor.on_duty' : 'counsellor.off_duty', req, targetType: 'user', targetId: String(req.user!._id), meta: { reason: reason ?? null } });
    const upcoming = await upcomingAffected(req.user!._id);
    const pendingRequests = await Appointment.countDocuments({ counsellorId: req.user!._id, status: 'requested' });
    ok(res, {
      onDuty,
      upcoming,
      warning: !onDuty && (upcoming.length || pendingRequests)
        ? `You still have ${upcoming.length} upcoming appointment(s) and ${pendingRequests} request(s) awaiting your response. They are not cancelled: attend, reschedule or ask a coordinator to reassign them.`
        : null,
    });
  }),
);

// ------------------------------------------------------------------ schedule (My Availability)
wellnessRouter.get(
  '/schedule',
  requireRole('counsellor'),
  asyncHandler(async (req, res) => {
    const a = await Availability.findOne({ counsellorId: req.user!._id }).lean();
    const { schedule, days } = await slotsFor(req.user!._id, { days: 14 });
    const upcoming = await Appointment.find({ counsellorId: req.user!._id, status: { $in: ACTIVE_APPOINTMENT_STATUSES }, startAt: { $gte: new Date() } }, { startAt: 1, endAt: 1, status: 1, mode: 1 }).sort({ startAt: 1 }).limit(50).lean();
    ok(res, {
      weekly: schedule.weekly, slotMinutes: schedule.slotMinutes, timezone: schedule.timezone, blockedDates: schedule.blockedDates,
      breaks: schedule.breaks, dateOverrides: schedule.dateOverrides, maxDailySessions: a?.maxDailySessions || 10,
      onDuty: schedule.acceptingRequests !== false,
      days: days.map((d) => ({ date: d.date, capacity: d.capacity, booked: d.booked, remaining: d.remaining, openSlots: d.slots.length })),
      upcoming: upcoming.map((u) => ({ id: String(u._id), startAt: u.startAt, endAt: u.endAt, status: u.status, mode: u.mode })),
    });
  }),
);

wellnessRouter.put(
  '/schedule',
  requireRole('counsellor'),
  asyncHandler(async (req, res) => {
    const input = parse(counsellorScheduleSchema, req.body);
    const errors = validateSchedule({ ...input, acceptingRequests: true });
    if (errors.length) throw new AppError(422, 'validation_failed', errors[0]!, { errors });
    await Availability.updateOne({ counsellorId: req.user!._id }, { $set: input }, { upsert: true });
    await audit({ action: 'availability.updated', req, targetType: 'user', targetId: String(req.user!._id), changedFields: Object.keys(input) });
    const { days } = await slotsFor(req.user!._id, { days: 14 });
    ok(res, { ok: true, days: days.map((d) => ({ date: d.date, capacity: d.capacity, booked: d.booked, remaining: d.remaining, openSlots: d.slots.length })) });
  }),
);

// ------------------------------------------------------------------ anonymous feedback
const ANONYMITY_NOTICE = 'Anonymous feedback is stored without your name and is never shown to your counsellor with your identity. '
  + 'Counsellors only see feedback once several students have given it, without dates. A separate record notes that this appointment '
  + 'already has feedback (to prevent duplicates); authorised administrators with database access could in principle match timing, '
  + 'and concerns about safety or conduct may need follow-up under campus policy.';

wellnessRouter.get('/feedback/notice', asyncHandler(async (_req, res) => ok(res, { notice: ANONYMITY_NOTICE })));

wellnessRouter.post(
  '/appointments/:id/feedback',
  requireRole('student'),
  asyncHandler(async (req, res) => {
    const input = parse(feedbackSubmitSchema, req.body);
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const appt = await Appointment.findOne({ _id: req.params.id, studentId: req.user!._id }, { status: 1, counsellorId: 1, startAt: 1 }).lean();
    if (!appt) throw notFound();
    if (appt.status !== 'completed' || !appt.counsellorId) throw new AppError(422, 'not_completed', 'Feedback opens after a completed appointment.');
    try {
      // Receipt first: the unique index makes a second submission fail before any content is stored.
      await FeedbackReceipt.create({ appointmentId: appt._id, studentId: req.user!._id, submittedOn: zonedParts(new Date(), 'Asia/Kolkata').ymd });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new AppError(409, 'already_submitted', 'You have already shared feedback for this appointment.');
      throw err;
    }
    const sessionMonth = zonedParts(appt.startAt ?? new Date(), 'Asia/Kolkata').ymd.slice(0, 7);
    // A public comment needs the student's opt-in, is masked here and still waits for a moderator.
    const publicText = input.sharePublicly && input.comment && !input.concern ? sanitizeFeedbackText(input.comment) : '';
    const fb = await CounsellingFeedback.create({
      counsellorId: appt.counsellorId, anonymous: input.anonymous, studentId: input.anonymous ? null : req.user!._id,
      rating: input.rating ?? null, categories: input.categories, comment: input.comment || null, concern: input.concern, sessionMonth,
      raterKey: raterKeyFor(appt.counsellorId, req.user!._id),
      sharePublicly: Boolean(publicText),
      publicComment: publicText.length >= 3 ? 'pending' : 'none',
      publicText: publicText.length >= 3 ? publicText : null,
    });
    // The audit entry names neither the student nor the appointment for anonymous feedback.
    await audit({ action: 'counselling.feedback_submitted', actorId: input.anonymous ? null : String(req.user!._id), actorRole: 'student', targetType: 'counselling_feedback', targetId: String(fb._id), meta: { anonymous: input.anonymous, concern: input.concern } });
    if (input.concern) {
      // Role grants (admin, super_admin) and individual grants of appointments:read_aggregate.
      const staff = await User.find({ accountStatus: 'active', $or: [{ role: { $in: ['super_admin', 'admin'] } }, { permissions: 'appointments:read_aggregate' }] }, { _id: 1 }).limit(50).lean();
      await notifyMany(staff.map((s) => String(s._id)), { kind: 'counselling_feedback_concern', category: 'appointments', priority: 'high', title: 'Feedback needs review', body: 'A counselling feedback item was marked as a concern.', link: '/super-admin/counselling-insights' });
    }
    ok(res, { ok: true, anonymous: input.anonymous, notice: ANONYMITY_NOTICE }, 201);
  }),
);

/** Which of my completed appointments still accept feedback (students). */
wellnessRouter.get(
  '/feedback/pending',
  requireRole('student'),
  asyncHandler(async (req, res) => {
    const done = await Appointment.find({ studentId: req.user!._id, status: 'completed', counsellorId: { $ne: null } }, { startAt: 1, counsellorId: 1 }).sort({ startAt: -1 }).limit(20).lean();
    const given = new Set((await FeedbackReceipt.find({ appointmentId: { $in: done.map((d) => d._id) } }, { appointmentId: 1 }).lean()).map((r) => String(r.appointmentId)));
    const names = new Map((await User.find({ _id: { $in: done.map((d) => d.counsellorId) } }, { fullName: 1 }).lean()).map((u) => [String(u._id), u.fullName]));
    ok(res, done.filter((d) => !given.has(String(d._id))).map((d) => ({ appointmentId: String(d._id), startAt: d.startAt, counsellor: names.get(String(d.counsellorId)) ?? 'Counsellor' })));
  }),
);

/** A counsellor's own feedback: aggregates always; comments only in groups, undated, and never concerns. */
wellnessRouter.get(
  '/feedback/summary',
  requireRole('counsellor'),
  asyncHandler(async (req, res) => {
    const rows = await CounsellingFeedback.find({ counsellorId: req.user!._id, concern: false }, { rating: 1, categories: 1, comment: 1 }).lean();
    const rated = rows.filter((r) => r.rating);
    const categories: Record<string, number> = {};
    rows.forEach((r) => r.categories.forEach((c) => { categories[c] = (categories[c] ?? 0) + 1; }));
    const enough = rows.length >= FEEDBACK_MIN_GROUP;
    ok(res, {
      count: rows.length,
      averageRating: enough && rated.length ? Math.round((rated.reduce((s, r) => s + r.rating!, 0) / rated.length) * 10) / 10 : null,
      categories: enough ? categories : {},
      // Shuffled so order does not hint at recency.
      comments: enough ? rows.map((r) => r.comment).filter(Boolean).sort(() => Math.random() - 0.5).slice(0, 20) : [],
      minimumForDetails: FEEDBACK_MIN_GROUP,
    });
  }),
);

/** Moderation list for authorised staff. Anonymous items never carry identity; every view is audited. */
wellnessRouter.get(
  '/feedback',
  requirePermission('appointments:read_aggregate'),
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = pageParams(req.query, 50);
    const filter: Record<string, unknown> = {};
    if (typeof req.query.status === 'string' && req.query.status) filter.status = req.query.status;
    if (req.query.concern === 'true') filter.concern = true;
    if (req.query.publicComment === 'pending') filter.publicComment = 'pending';
    if (req.query.reported === 'true') filter.reportCount = { $gt: 0 };
    const [rows, total] = await Promise.all([
      CounsellingFeedback.find(filter).sort({ concern: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
      CounsellingFeedback.countDocuments(filter),
    ]);
    const people = new Map((await User.find({ _id: { $in: rows.flatMap((r) => [r.counsellorId, r.studentId].filter(Boolean)) } }, { fullName: 1 }).lean()).map((u) => [String(u._id), u.fullName]));
    await audit({ action: 'counselling.feedback_viewed', req, targetType: 'counselling_feedback', meta: { count: rows.length, filter } });
    ok(res, {
      items: rows.map((r) => ({
        id: String(r._id), counsellor: people.get(String(r.counsellorId)) ?? 'Counsellor', rating: r.rating, categories: r.categories, comment: r.comment,
        concern: r.concern, anonymous: r.anonymous, student: r.anonymous ? null : people.get(String(r.studentId)) ?? 'Student',
        sessionMonth: r.sessionMonth, status: r.status, moderationNote: r.moderationNote, reviewedAt: r.reviewedAt,
        publicComment: r.publicComment ?? 'none', publicText: r.publicText ?? null, reportCount: r.reportCount ?? 0, hiddenFromPublic: Boolean(r.hiddenFromPublic),
        // Feedback from before rater keys existed is kept out of public figures.
        countsPublicly: Boolean(r.raterKey) && !r.concern && !r.hiddenFromPublic,
      })),
      total, page, limit,
    });
  }),
);

wellnessRouter.patch(
  '/feedback/:id',
  requirePermission('appointments:read_aggregate'),
  asyncHandler(async (req, res) => {
    const input = parse(feedbackModerateSchema, req.body);
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const fb = await CounsellingFeedback.findById(req.params.id);
    if (!fb) throw notFound();
    const before = { status: fb.status, publicComment: fb.publicComment, hiddenFromPublic: fb.hiddenFromPublic };
    fb.status = input.status;
    if (input.note !== undefined) fb.moderationNote = input.note || null;
    if (input.publicText !== undefined) {
      if (fb.publicComment === 'none') throw new AppError(422, 'no_consent', 'The student did not agree to a public comment.');
      fb.publicText = sanitizeFeedbackText(input.publicText); // masked again: a moderator's edit is held to the same rules
    }
    if (input.publicComment !== undefined) {
      if (fb.publicComment === 'none' || !fb.publicText) throw new AppError(422, 'no_consent', 'The student did not agree to a public comment.');
      if (input.publicComment === 'approved' && fb.concern) throw new AppError(422, 'concern', 'Concerns are never shown publicly.');
      fb.publicComment = input.publicComment;
    }
    if (input.hiddenFromPublic !== undefined) fb.hiddenFromPublic = input.hiddenFromPublic;
    fb.reviewedBy = req.user!._id;
    fb.reviewedAt = new Date();
    await fb.save();
    const after = { status: fb.status, publicComment: fb.publicComment, hiddenFromPublic: fb.hiddenFromPublic };
    await audit({ action: `counselling.feedback_${input.status}`, req, targetType: 'counselling_feedback', targetId: String(fb._id), before, after, reason: input.note ?? null });
    if (before.publicComment !== after.publicComment || before.hiddenFromPublic !== after.hiddenFromPublic || input.publicText !== undefined) {
      await audit({ action: 'counselling.feedback_public_moderated', req, targetType: 'counselling_feedback', targetId: String(fb._id), before, after, meta: { textEdited: input.publicText !== undefined } });
    }
    ok(res, { id: String(fb._id), status: fb.status, publicComment: fb.publicComment, publicText: fb.publicText, hiddenFromPublic: fb.hiddenFromPublic });
  }),
);

// ------------------------------------------------------------------ reminders
async function reminderAccess(user: UserDoc, appointmentId: string) {
  if (!Types.ObjectId.isValid(appointmentId)) throw notFound();
  const appt = await Appointment.findById(appointmentId, { studentId: 1, counsellorId: 1, status: 1 }).lean();
  if (!appt) throw notFound();
  const isStudent = String(appt.studentId) === String(user._id);
  const isCounsellor = Boolean(appt.counsellorId) && String(appt.counsellorId) === String(user._id);
  if (!isStudent && !isCounsellor) throw notFound();
  return { appt, isStudent, isCounsellor };
}

wellnessRouter.get(
  '/appointments/:id/reminders',
  asyncHandler(async (req, res) => {
    const { appt } = await reminderAccess(req.user!, req.params.id);
    // Each person sees only reminders addressed to them; a counsellor's private task note stays theirs.
    const rows = await CounsellingReminder.find({ appointmentId: appt._id, userId: req.user!._id, status: { $in: ['pending', 'sent'] } }).sort({ dueAt: 1 }).lean();
    ok(res, rows.map((r) => ({ id: String(r._id), kind: r.kind, dueAt: r.dueAt, status: r.status, note: String(r.createdBy) === String(req.user!._id) ? r.note : null, mine: String(r.createdBy) === String(req.user!._id) })));
  }),
);

wellnessRouter.post(
  '/appointments/:id/reminders',
  asyncHandler(async (req, res) => {
    const input = parse(reminderCreateSchema, req.body);
    const { appt, isStudent, isCounsellor } = await reminderAccess(req.user!, req.params.id);
    if (['cancelled', 'rejected'].includes(appt.status)) throw new AppError(422, 'inactive', 'This appointment is no longer active.');
    if (input.audience === 'student' && !isCounsellor) throw new AppError(403, 'forbidden', 'Only the counsellor can set a reminder for the student.');
    const pending = await CounsellingReminder.countDocuments({ appointmentId: appt._id, createdBy: req.user!._id, status: 'pending' });
    if (pending >= 10) throw new AppError(429, 'too_many', 'You already have 10 pending reminders for this appointment.');
    const recipient = input.audience === 'student' ? appt.studentId : req.user!._id;
    const r = await addReminder({ appointmentId: appt._id, userId: recipient, kind: isStudent ? 'student_requested' : 'task', dueAt: input.dueAt, note: input.note ?? null, createdBy: req.user!._id });
    ok(res, { id: String(r!._id), kind: r!.kind, dueAt: r!.dueAt, status: r!.status }, 201);
  }),
);

wellnessRouter.delete(
  '/reminders/:id',
  asyncHandler(async (req, res) => {
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const r = await CounsellingReminder.findOneAndUpdate({ _id: req.params.id, createdBy: req.user!._id, status: 'pending' }, { $set: { status: 'cancelled' } });
    if (!r) throw notFound();
    ok(res, { ok: true });
  }),
);

// ------------------------------------------------------------------ analytics (aggregate only)
wellnessRouter.get(
  '/analytics',
  requirePermission('appointments:read_aggregate'),
  asyncHandler(async (req, res) => {
    const to = req.query.to && !Number.isNaN(Date.parse(String(req.query.to))) ? new Date(String(req.query.to)) : new Date();
    const from = req.query.from && !Number.isNaN(Date.parse(String(req.query.from))) ? new Date(String(req.query.from)) : new Date(to.getTime() - 30 * 86400_000);
    const range = { createdAt: { $gte: from, $lte: to } };

    const [byStatusRows, byMonthRows, responseRows, waitRows, counsellorRows, feedbackRows, feedbackMonth] = await Promise.all([
      Appointment.aggregate([{ $match: range }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      Appointment.aggregate([{ $match: range }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: 'Asia/Kolkata' } }, n: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
      // Response compliance: answered within the hour vs. answered late or timed out.
      Appointment.aggregate([
        { $match: { ...range, assignedAt: { $ne: null }, $or: [{ respondedAt: { $ne: null } }, { responseOverdueAt: { $ne: null } }, { 'timedOutBy.0': { $exists: true } }] } },
        { $project: { onTime: { $and: [{ $ne: ['$respondedAt', null] }, { $lte: [{ $subtract: ['$respondedAt', '$assignedAt'] }, 3600_000] }, { $eq: [{ $size: { $ifNull: ['$timedOutBy', []] } }, 0] }] }, minutes: { $cond: [{ $ne: ['$respondedAt', null] }, { $divide: [{ $subtract: ['$respondedAt', '$assignedAt'] }, 60000] }, null] } } },
        { $group: { _id: null, total: { $sum: 1 }, onTime: { $sum: { $cond: ['$onTime', 1, 0] } }, avgMinutes: { $avg: '$minutes' } } },
      ]),
      Appointment.aggregate([
        { $match: { ...range, status: { $in: ['confirmed', 'rescheduled', 'completed', 'missed'] }, startAt: { $ne: null } } },
        { $group: { _id: null, avgHours: { $avg: { $divide: [{ $subtract: ['$startAt', '$createdAt'] }, 3600_000] } } } },
      ]),
      Appointment.aggregate([{ $match: { ...range, counsellorId: { $ne: null } } }, { $group: { _id: '$counsellorId', total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } }, missed: { $sum: { $cond: [{ $eq: ['$status', 'missed'] }, 1, 0] } } } }]),
      CounsellingFeedback.aggregate([{ $match: range }, { $group: { _id: '$counsellorId', n: { $sum: 1 }, avg: { $avg: '$rating' }, concerns: { $sum: { $cond: ['$concern', 1, 0] } } } }]),
      CounsellingFeedback.aggregate([{ $match: range }, { $group: { _id: '$sessionMonth', n: { $sum: 1 }, avg: { $avg: '$rating' } } }, { $sort: { _id: 1 } }]),
    ]);
    const byStatus: Record<string, number> = Object.fromEntries(byStatusRows.map((r) => [r._id, r.n]));
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    const attended = (byStatus.completed ?? 0) + (byStatus.missed ?? 0);
    const response = responseRows[0] ?? { total: 0, onTime: 0, avgMinutes: null };

    // Available vs booked over the next 14 days, from each on-duty counsellor's real schedule.
    const counsellors = await User.find({ role: 'counsellor', accountStatus: 'active' }, { fullName: 1 }).lean();
    let openSlots = 0;
    let bookedNext14 = 0;
    for (const c of counsellors) {
      const { days } = await slotsFor(c._id, { days: 14 });
      openSlots += days.reduce((s, d) => s + d.slots.length, 0);
      bookedNext14 += days.reduce((s, d) => s + d.booked, 0);
    }
    const names = new Map(counsellors.map((c) => [String(c._id), c.fullName]));
    const fbBy = new Map(feedbackRows.map((f) => [String(f._id), f]));
    const fbTotal = feedbackRows.reduce((s, f) => s + f.n, 0);
    const rated = feedbackRows.filter((f) => f.avg != null);

    ok(res, {
      range: { from, to },
      volume: { total, byStatus, byMonth: byMonthRows.map((m) => ({ month: m._id, count: m.n })) },
      capacity: { openSlotsNext14Days: openSlots, bookedNext14Days: bookedNext14 },
      rates: {
        cancellation: total ? (byStatus.cancelled ?? 0) / total : null,
        missed: attended ? (byStatus.missed ?? 0) / attended : null,
      },
      responseTime: { measured: response.total, withinOneHour: response.onTime, compliance: response.total ? response.onTime / response.total : null, averageMinutes: response.avgMinutes != null ? Math.round(response.avgMinutes) : null },
      averageWaitHours: waitRows[0]?.avgHours != null ? Math.round(waitRows[0].avgHours * 10) / 10 : null,
      feedback: {
        count: fbTotal,
        averageRating: rated.length ? Math.round((rated.reduce((s, f) => s + f.avg * f.n, 0) / rated.reduce((s, f) => s + f.n, 0)) * 10) / 10 : null,
        concerns: feedbackRows.reduce((s, f) => s + f.concerns, 0),
        byMonth: feedbackMonth.map((m) => ({ month: m._id, count: m.n, averageRating: m.avg != null ? Math.round(m.avg * 10) / 10 : null })),
      },
      // Staff workload metrics only; ratings are suppressed below the minimum group size.
      byCounsellor: counsellorRows.map((r) => {
        const f = fbBy.get(String(r._id));
        return { counsellor: names.get(String(r._id)) ?? 'Counsellor', appointments: r.total, completed: r.completed, missed: r.missed, feedbackCount: f?.n ?? 0, averageRating: f && f.n >= FEEDBACK_MIN_GROUP && f.avg != null ? Math.round(f.avg * 10) / 10 : null };
      }),
    });
  }),
);
