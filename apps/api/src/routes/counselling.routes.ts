import { Router } from 'express';
import { Types } from 'mongoose';
import {
  ACTIVE_APPOINTMENT_STATUSES,
  appointmentRequestSchema,
  appointmentReassignSchema,
  appointmentUpdateSchema,
  availabilitySchema,
  counsellingNoteSchema,
  feedbackReportSchema,
  hasPermission,
  type AppointmentStatus,
  type Role,
} from '@campuscare/shared';
import { AppError, asyncHandler, notFound, ok, pageParams, parse } from '../lib/http';
import { Appointment, Availability, CounsellingNote, type AppointmentDoc } from '../models/counselling';
import { User, UserAvatar, type UserDoc } from '../models/user';
import { CounsellingFeedback, FeedbackReport } from '../models/wellness';
import { feedbackReportLimiter } from '../middleware/security';
import { AuditLog } from '../models/platform';
import { requireAuth, requirePermission, requireRole } from '../middleware/auth';
import { audit } from '../services/audit.service';
import { notify, notifyMany } from '../services/notification.service';
import { getSettings } from '../services/settings.service';
import {
  eligibleCounsellorFilter, feedbackMinimum, findCommentByRef, isStudentVisible, listDirectory, publicComments, publicCounsellor, ratingSummaries,
} from '../services/counsellor-directory.service';
import { appLink } from '../services/email/email.service';
import {
  CounsellorAssignmentService,
  ALGORITHM_VERSION,
  DEFAULT_MAX_ACTIVE_CASELOAD,
} from '../services/counsellor-assignment.service';
import { conflictError, slotConflict, slotsFor, startResponseClock } from '../services/counselling-schedule.service';
import { activateCounsellingChat, declineRequest, onAppointmentStatus, scheduleFollowUp, scheduleUpcomingReminders } from '../services/counselling-workflow.service';

export const counsellingRouter = Router();
counsellingRouter.use(requireAuth);

const slotLockOf = (counsellorId: unknown, startAt: Date) => `${String(counsellorId)}:${startAt.toISOString()}`;
const fmt = (d?: Date | null) => (d ? d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : 'TBD');

function serializeAppointment(
  a: AppointmentDoc | Record<string, unknown>,
  viewer: 'student' | 'counsellor' | 'admin',
  people: Map<string, { fullName: string; studentId?: string | null; department?: string | null }>,
) {
  const ap = a as AppointmentDoc;
  const student = people.get(String(ap.studentId));
  const counsellor = ap.counsellorId ? people.get(String(ap.counsellorId)) : null;
  return {
    id: String(ap._id),
    startAt: ap.startAt ?? null,
    endAt: ap.endAt ?? null,
    mode: ap.mode,
    status: ap.status,
    statusReason: ap.statusReason,
    reason: ap.reason,
    meetingLink: ap.status === 'confirmed' || ap.status === 'rescheduled' ? ap.meetingLink : null,
    threadId: ap.threadId ? String(ap.threadId) : null,
    counsellor: counsellor ? { id: String(ap.counsellorId), name: counsellor.fullName } : null,
    // Counsellors/Admins see student details for triage and session context.
    student: (viewer === 'counsellor' || viewer === 'admin') && student ? { id: String(ap.studentId), name: student.fullName, studentId: student.studentId ?? null, department: student.department ?? null } : undefined,
    followUpAt: ap.followUpAt,
    responseDueAt: ap.status === 'requested' ? ap.responseDueAt ?? null : null,
    allowReassignment: ap.allowReassignment ?? false,
    chatOpen: Boolean(ap.chatActivatedAt),
    createdAt: (ap as unknown as { createdAt: Date }).createdAt,
  };
}

async function peopleFor(list: { studentId: unknown; counsellorId?: unknown }[]) {
  const ids = [...new Set(list.flatMap((a) => [String(a.studentId), ...(a.counsellorId ? [String(a.counsellorId)] : [])]))];
  const users = await User.find({ _id: { $in: ids } }, { fullName: 1, studentId: 1, department: 1 }).lean();
  return new Map(users.map((u) => [String(u._id), u]));
}

// ------------------------------------------------------------------ directory and slots (students)
const listParam = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 60) : null);
const dateParam = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

const sortParam = (v: unknown) => (v === 'availability' || v === 'rating' || v === 'name' ? v : null);

/**
 * Directory. Students see only listed, accepting counsellors with an open slot; staff see everyone
 * eligible (with the listing flag). Paged with ?page&limit; the total is in X-Total-Count so older
 * app builds that expect a plain list keep working.
 */
counsellingRouter.get(
  '/counsellors',
  asyncHandler(async (req, res) => {
    const rows = await listDirectory(
      {
        q: listParam(req.query.q), specialization: listParam(req.query.specialization), language: listParam(req.query.language),
        mode: listParam(req.query.mode), campus: listParam(req.query.campus), department: listParam(req.query.department),
        date: dateParam(req.query.date), sort: sortParam(req.query.sort),
      },
      { student: req.user!.role === 'student' },
    );
    const { limit, skip } = pageParams(req.query, 100);
    const paged = req.query.page || req.query.limit ? rows.slice(skip, skip + limit) : rows.slice(0, 200);
    res.setHeader('X-Total-Count', String(rows.length));
    ok(res, paged);
  }),
);

/** Public profile with slots, the privacy-thresholded rating and approved anonymous comments. */
counsellingRouter.get(
  '/counsellors/:id',
  asyncHandler(async (req, res) => {
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const student = req.user!.role === 'student';
    const c = await User.findOne({ _id: req.params.id, ...eligibleCounsellorFilter }, { fullName: 1, department: 1, avatarUpdatedAt: 1 }).lean();
    if (!c) throw notFound();
    const a = await Availability.findOne({ counsellorId: c._id }).lean();
    if (student && a?.listed === false) throw notFound();
    const s = await getSettings();
    const rating = (await ratingSummaries([c._id], s)).get(String(c._id))!;
    const entry = await publicCounsellor(c, a, { withSlots: true, rating, staff: !student });
    ok(res, { ...entry, comments: await publicComments(c._id, rating, s), feedbackMinimum: feedbackMinimum(s) });
  }),
);

/** Profile photo, only for a visible counsellor whose photo a Super Admin has not hidden. */
counsellingRouter.get(
  '/counsellors/:id/photo',
  asyncHandler(async (req, res) => {
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const a = await Availability.findOne({ counsellorId: req.params.id }, { listed: 1, photoVisible: 1 }).lean();
    const visible = req.user!.role === 'student' ? await isStudentVisible(req.params.id) : Boolean(await User.exists({ _id: req.params.id, ...eligibleCounsellorFilter }));
    if (!visible || a?.photoVisible === false) throw notFound();
    const photo = await UserAvatar.findOne({ userId: req.params.id });
    if (!photo) throw notFound();
    res.setHeader('Content-Type', photo.mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(photo.data);
  }),
);

/** Report an approved public comment (e.g. it identifies someone). It is withdrawn until a moderator reviews it. */
counsellingRouter.post(
  '/counsellors/:id/comments/:ref/report',
  feedbackReportLimiter,
  asyncHandler(async (req, res) => {
    const input = parse(feedbackReportSchema, req.body);
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const fb = await findCommentByRef(req.params.id, req.params.ref);
    if (!fb) throw notFound();
    try {
      await FeedbackReport.create({ feedbackId: fb._id, reporterId: req.user!._id, reason: input.reason, note: input.note ?? null });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) return ok(res, { ok: true, alreadyReported: true });
      throw err;
    }
    await CounsellingFeedback.updateOne({ _id: fb._id }, { $inc: { reportCount: 1 }, $set: { publicComment: 'pending' } });
    await audit({ action: 'counselling.feedback_reported', req, targetType: 'counselling_feedback', targetId: String(fb._id), meta: { reason: input.reason } });
    const staff = await User.find({ accountStatus: 'active', $or: [{ role: 'super_admin' }, { permissions: 'appointments:read_aggregate' }] }, { _id: 1 }).limit(50).lean();
    await notifyMany(staff.map((x) => String(x._id)), { kind: 'counselling_feedback_reported', category: 'appointments', priority: 'normal', title: 'A public counselling comment was reported', body: 'It has been withdrawn from the profile until someone reviews it.', link: '/super-admin/counselling-insights' });
    ok(res, { ok: true }, 201);
  }),
);

counsellingRouter.get(
  '/counsellors/:id/slots',
  asyncHandler(async (req, res) => {
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const date = dateParam(req.query.date) ?? undefined;
    const { schedule, days } = await slotsFor(req.params.id, { onlyDate: date, days: date ? 31 : 14 });
    ok(res, {
      slots: days.flatMap((d) => d.slots).map((x) => x.toISOString()),
      days: days.map((d) => ({ date: d.date, slots: d.slots.map((x) => x.toISOString()), full: d.remaining === 0 })),
      slotMinutes: schedule.slotMinutes,
      timezone: schedule.timezone,
      onDuty: schedule.acceptingRequests !== false,
    });
  }),
);

// ------------------------------------------------------------------ appointments
counsellingRouter.get(
  '/appointments',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    let filter: Record<string, unknown>;
    let view: 'student' | 'counsellor' | 'admin' = 'student';
    if (user.role === 'student') {
      filter = { studentId: user._id };
    } else if (user.role === 'counsellor') {
      filter = { counsellorId: user._id };
      view = 'counsellor';
    } else if (user.role === 'super_admin' || hasPermission({ role: user.role as Role, permissions: user.permissions }, 'appointments:read_aggregate')) {
      filter = {};
      view = 'admin';
    } else {
      throw new AppError(403, 'forbidden', 'Administrators see aggregate counselling statistics only.');
    }

    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.upcoming === 'true') filter.startAt = { $gte: new Date(Date.now() - 3600_000) };
    const list = await Appointment.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    const people = await peopleFor(list);
    ok(res, list.map((a) => serializeAppointment(a as never, view, people)));
  }),
);

counsellingRouter.post(
  '/appointments',
  requirePermission('appointments:request'),
  asyncHandler(async (req, res) => {
    const input = parse(appointmentRequestSchema, req.body);
    const existing = await Appointment.findOne({ idempotencyKey: input.idempotencyKey }).lean();
    if (existing) {
      if (String(existing.studentId) !== String(req.user!._id)) throw new AppError(409, 'conflict', 'Duplicate request key.');
      return ok(res, { id: String(existing._id), status: existing.status });
    }

    const activeCount = await Appointment.countDocuments({
      studentId: req.user!._id,
      status: { $in: ACTIVE_APPOINTMENT_STATUSES },
      $or: [{ startAt: { $gt: new Date() } }, { startAt: null }],
    });
    if (activeCount >= 3) {
      throw new AppError(422, 'too_many', 'You already have 3 upcoming requests. Cancel one before booking another.');
    }

    const isAuto = !input.counsellorId || input.counsellorId === 'auto';
    let assignedCounsellorId: Types.ObjectId | null = null;
    let startAt: Date | null = input.startAt ? new Date(input.startAt) : null;
    let endAt: Date | null = null;
    let slotLock: string | null = null;

    if (!isAuto) {
      // Only counsellors a student can see in the directory can be booked directly.
      if (!(await isStudentVisible(input.counsellorId))) throw new AppError(422, 'not_bookable', 'This counsellor is not taking bookings through the directory right now.');
      assignedCounsellorId = new Types.ObjectId(input.counsellorId as string);
      const { schedule, days } = await slotsFor(assignedCounsellorId, { days: 31 });
      if (!schedule.acceptingRequests) {
        throw new AppError(422, 'not_accepting', 'This counsellor is not accepting requests right now.');
      }
      if (!startAt || !days.some((d) => d.slots.some((x) => x.getTime() === startAt!.getTime()))) {
        throw new AppError(422, 'invalid_slot', 'Choose one of the available time slots.');
      }
      endAt = new Date(startAt.getTime() + schedule.slotMinutes * 60_000);
      slotLock = slotLockOf(assignedCounsellorId, startAt);
    }

    let appt;
    try {
      appt = await Appointment.create({
        studentId: req.user!._id,
        counsellorId: assignedCounsellorId,
        startAt,
        endAt,
        mode: input.mode,
        reason: input.reason ?? null,
        status: 'requested',
        slotLock,
        idempotencyKey: input.idempotencyKey,
        // Auto-assignment implies consent to move between counsellors; a chosen counsellor is only replaced if the student agreed.
        allowReassignment: isAuto ? true : input.allowReassignment ?? false,
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw new AppError(409, 'slot_taken', 'That slot was just taken. Please pick another time.');
      }
      throw err;
    }

    // Concurrency guard: overlapping or over-capacity bookings lose deterministically and are removed.
    const conflict = await slotConflict(appt);
    if (conflict) {
      await appt.deleteOne();
      throw conflictError(conflict);
    }
    // The private conversation is created only when the assigned counsellor accepts (see PATCH below).

    await audit({ action: 'appointment.requested', req, targetType: 'appointment', targetId: String(appt._id) });

    if (isAuto) {
      const autoResult = await CounsellorAssignmentService.autoAssign(
        String(appt._id),
        String(req.user!._id),
        String(req.user!._id),
      );
      return ok(
        res,
        {
          id: String(appt._id),
          status: appt.status,
          autoAssignment: autoResult,
        },
        201,
      );
    }

    await startResponseClock(appt);
    await notify({
      userId: String(assignedCounsellorId),
      kind: 'appointment',
      category: 'appointments',
      priority: 'high',
      title: 'New appointment request',
      body: `Requested for ${fmt(startAt)}. Please accept or decline within an hour.`,
      link: `/consultancy/appointments?focus=${appt._id}`,
    });
    await notify({ userId: String(req.user!._id), kind: 'appointment', category: 'appointments', title: 'Request sent', body: `Your request for ${fmt(startAt)} was sent. You will be notified when it is accepted.`, link: '/student/counselling' });

    ok(res, { id: String(appt._id), status: appt.status, responseDueAt: appt.responseDueAt }, 201);
  }),
);

async function loadAppointmentFor(user: UserDoc, id: string) {
  if (!Types.ObjectId.isValid(id)) throw notFound();
  const appt = await Appointment.findById(id);
  if (!appt) throw notFound();
  const isStudent = String(appt.studentId) === String(user._id);
  const isCounsellor = appt.counsellorId && String(appt.counsellorId) === String(user._id);
  const isSuperAdmin = user.role === 'super_admin' || hasPermission({ role: user.role as Role, permissions: user.permissions }, 'appointments:read_aggregate');
  if (!isStudent && !isCounsellor && !isSuperAdmin) throw notFound();
  return { appt, isStudent, isCounsellor: Boolean(isCounsellor || isSuperAdmin), isAssigned: Boolean(isCounsellor) };
}

counsellingRouter.patch(
  '/appointments/:id',
  asyncHandler(async (req, res) => {
    const input = parse(appointmentUpdateSchema, req.body);
    const { appt, isStudent, isCounsellor, isAssigned } = await loadAppointmentFor(req.user!, req.params.id);
    const from = appt.status as AppointmentStatus;
    const to = input.status;
    // Accepting or declining a request is the assigned counsellor's decision; accepting opens the private chat.
    if (from === 'requested' && (to === 'confirmed' || to === 'rejected') && !isAssigned) {
      throw new AppError(403, 'forbidden', 'Only the assigned counsellor can accept or decline this request.');
    }
    if (from === 'requested' && to === 'rejected' && isAssigned) {
      if (!input.reason) throw new AppError(422, 'reason_required', 'Please give the student a reason.');
      const outcome = await declineRequest(appt, req.user!, input.reason, req);
      if (outcome.reassigned) {
        // Shown from the declining counsellor's side (existing app builds parse this as an appointment).
        const people = await peopleFor([{ studentId: appt.studentId }]);
        return ok(res, { ...serializeAppointment(appt, 'counsellor', people), status: 'rejected', statusReason: 'Passed to another counsellor', counsellor: null, chatOpen: false, reassigned: true });
      }
      const people = await peopleFor([appt]);
      return ok(res, serializeAppointment(appt, 'counsellor', people));
    }
    const allowedForStudent: AppointmentStatus[] = ['cancelled'];
    const counsellorTransitions: Record<string, AppointmentStatus[]> = {
      requested: ['confirmed', 'rejected', 'rescheduled', 'cancelled'],
      confirmed: ['rescheduled', 'cancelled', 'completed', 'missed'],
      rescheduled: ['confirmed', 'cancelled', 'completed', 'missed'],
    };
    if (to) {
      if (isStudent && !isCounsellor && !(allowedForStudent.includes(to) && ACTIVE_APPOINTMENT_STATUSES.includes(from))) throw new AppError(403, 'forbidden', 'You can only cancel an upcoming appointment.');
      if (isCounsellor && !(counsellorTransitions[from] ?? []).includes(to)) throw new AppError(422, 'invalid_transition', `Cannot change from ${from} to ${to}.`);
      if ((to === 'rejected' || (to === 'cancelled' && isCounsellor)) && !input.reason) throw new AppError(422, 'reason_required', 'Please give the student a reason.');
      if ((to === 'completed' || to === 'missed') && appt.startAt && appt.startAt > new Date()) throw new AppError(422, 'too_early', 'You can record attendance after the session starts.');
    }
    if (input.startAt) {
      if (!isCounsellor) throw new AppError(403, 'forbidden', 'Only the counsellor can propose a new time.');
      const avail = appt.counsellorId ? await Availability.findOne({ counsellorId: appt.counsellorId }).lean() : null;
      const newStart = new Date(input.startAt);
      if (newStart <= new Date()) throw new AppError(422, 'invalid_slot', 'Choose a future time.');
      const newEnd = new Date(newStart.getTime() + (avail?.slotMinutes ?? 50) * 60_000);
      const clash = appt.counsellorId && await Appointment.exists({ _id: { $ne: appt._id }, counsellorId: appt.counsellorId, status: { $in: ACTIVE_APPOINTMENT_STATUSES }, startAt: { $lt: newEnd }, endAt: { $gt: newStart } });
      if (clash) throw new AppError(409, 'slot_taken', 'You already have an appointment overlapping that time.');
      appt.startAt = newStart;
      appt.endAt = newEnd;
      appt.reminderSentAt = null;
    }
    if (to) appt.status = to;
    if (input.reason) appt.statusReason = input.reason;
    if (input.meetingLink !== undefined && isCounsellor) appt.meetingLink = input.meetingLink || null;
    appt.slotLock = (appt.counsellorId && appt.startAt && ACTIVE_APPOINTMENT_STATUSES.includes(appt.status as AppointmentStatus))
      ? slotLockOf(appt.counsellorId, appt.startAt)
      : null;
    try {
      await appt.save();
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new AppError(409, 'slot_taken', 'You already have an appointment at that time.');
      throw err;
    }
    await audit({ action: 'appointment.updated', req, targetType: 'appointment', targetId: String(appt._id), meta: { from, to: appt.status } });
    // The assigned counsellor accepting a request is what opens the private chat.
    if (from === 'requested' && appt.status === 'confirmed' && isAssigned) await activateCounsellingChat(appt, req.user!);
    if (from !== appt.status) await onAppointmentStatus(appt, from);
    else if (input.startAt) await scheduleUpcomingReminders(appt);
    if (appt.counsellorId) {
      const otherParty = isCounsellor ? String(appt.studentId) : String(appt.counsellorId);
      await notify({
        userId: otherParty, kind: 'appointment', category: 'appointments', title: `Appointment ${appt.status}`, body: `Your appointment on ${fmt(appt.startAt)} is now ${appt.status}.`,
        link: isCounsellor ? '/student/counselling' : `/consultancy/appointments?focus=${appt._id}`,
        email: isCounsellor ? { template: 'appointment_update', vars: { when: fmt(appt.startAt), status: appt.status, link: appLink('/student/counselling') } } : undefined,
      });
    }
    const people = await peopleFor([appt]);
    ok(res, serializeAppointment(appt, isCounsellor ? 'counsellor' : 'student', people));
  }),
);

// ------------------------------------------------------------------ Reassign endpoint (Admin / Coordinator)
counsellingRouter.post(
  '/appointments/:id/reassign',
  requirePermission('appointments:read_aggregate'),
  asyncHandler(async (req, res) => {
    const input = parse(appointmentReassignSchema, req.body);
    const updated = await CounsellorAssignmentService.reassign(
      req.params.id,
      input.counsellorId,
      input.reason,
      String(req.user!._id),
    );
    ok(res, { id: String(updated._id), counsellorId: String(updated.counsellorId), status: updated.status, message: 'Reassigned successfully.' });
  }),
);

// ------------------------------------------------------------------ Manual Auto-Assign trigger
counsellingRouter.post(
  '/appointments/:id/auto-assign',
  requirePermission('appointments:read_aggregate'),
  asyncHandler(async (req, res) => {
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const appt = await Appointment.findById(req.params.id);
    if (!appt) throw notFound();
    const result = await CounsellorAssignmentService.autoAssign(
      String(appt._id),
      String(appt.studentId),
      String(req.user!._id),
    );
    ok(res, result);
  }),
);

// ------------------------------------------------------------------ Admin Workload & Queue
counsellingRouter.get(
  '/admin/workload',
  requirePermission('appointments:read_aggregate'),
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const counsellors = await User.find(
      { role: 'counsellor', accountStatus: 'active' },
      { fullName: 1, email: 1, department: 1, accountStatus: 1 },
    ).lean();

    const counsellorIds = counsellors.map((c) => c._id);
    const availabilities = await Availability.find({ counsellorId: { $in: counsellorIds } }).lean();
    const availMap = new Map(availabilities.map((a) => [String(a.counsellorId), a]));

    const activeAppts = await Appointment.find({
      counsellorId: { $in: counsellorIds },
      status: { $in: ACTIVE_APPOINTMENT_STATUSES },
      startAt: { $gt: now },
    }).lean();

    const caseloadMap = new Map<string, number>();
    for (const a of activeAppts) {
      const cId = String(a.counsellorId);
      caseloadMap.set(cId, (caseloadMap.get(cId) ?? 0) + 1);
    }

    const counsellorWorkload = counsellors.map((c) => {
      const cId = String(c._id);
      const avail = availMap.get(cId);
      const activeCaseload = caseloadMap.get(cId) ?? 0;
      const capacity = DEFAULT_MAX_ACTIVE_CASELOAD;
      return {
        id: cId,
        name: c.fullName,
        email: c.email,
        department: c.department ?? 'General Counselling',
        activeCaseload,
        capacity,
        openCapacity: Math.max(0, capacity - activeCaseload),
        acceptingRequests: avail?.acceptingRequests ?? false,
        slotsPublished: (avail?.weekly?.length ?? 0) > 0,
      };
    });

    // Unassigned requests queue (status: requested, no counsellor assigned or queued for auto-assign)
    const unassigned = await Appointment.find({
      status: 'requested',
      counsellorId: null,
    })
      .sort({ createdAt: 1 })
      .lean();

    const studentIds = unassigned.map((u) => u.studentId);
    const students = await User.find({ _id: { $in: studentIds } }, { fullName: 1, studentId: 1, department: 1 }).lean();
    const studentMap = new Map(students.map((s) => [String(s._id), s]));

    const unassignedQueue = unassigned.map((u) => {
      const st = studentMap.get(String(u.studentId));
      return {
        id: String(u._id),
        studentName: st?.fullName ?? 'Student',
        studentId: st?.studentId ?? null,
        department: st?.department ?? null,
        mode: u.mode,
        reason: u.reason ?? 'General Consultation',
        statusReason: u.statusReason ?? 'Awaiting counsellor assignment',
        createdAt: (u as unknown as { createdAt: Date }).createdAt,
      };
    });

    // Recent assignment audit history
    const recentAudit = await AuditLog.find({
      action: { $in: ['counsellor.auto_assigned', 'counsellor.reassigned'] },
    })
      .sort({ at: -1 })
      .limit(20)
      .lean();

    ok(res, {
      counsellors: counsellorWorkload,
      unassignedQueue,
      unassignedCount: unassignedQueue.length,
      recentAssignments: recentAudit.map((a) => ({
        id: String(a._id),
        action: a.action,
        appointmentId: a.targetId,
        actorId: a.actorId,
        at: a.at,
        meta: a.meta,
      })),
      algorithm: {
        version: ALGORITHM_VERSION,
        defaultMaxCaseload: DEFAULT_MAX_ACTIVE_CASELOAD,
        weights: {
          workload: 40,
          availability: 20,
          continuity: 25,
          fairRotation: 15,
        },
      },
    });
  }),
);

// ------------------------------------------------------------------ confidential notes (separate store)
counsellingRouter.get(
  '/appointments/:id/notes',
  asyncHandler(async (req, res) => {
    const subject = { role: req.user!.role as Role, permissions: req.user!.permissions };
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const appt = await Appointment.findById(req.params.id).lean();
    if (!appt) throw notFound();
    const own = String(appt.counsellorId) === String(req.user!._id) && hasPermission(subject, 'counselling_notes:own');
    const explicit = hasPermission(subject, 'counselling_notes:read_all');
    if (!own && !explicit) {
      await audit({ action: 'counselling_notes.access_denied', req, outcome: 'denied', targetType: 'appointment', targetId: req.params.id });
      throw notFound();
    }
    const notes = await CounsellingNote.find({ appointmentId: appt._id }).sort({ createdAt: 1 }).lean();
    await audit({ action: 'counselling_notes.viewed', req, targetType: 'appointment', targetId: req.params.id, meta: { explicitGrant: !own } });
    ok(res, notes.map((n) => ({ id: String(n._id), body: n.body, supportPlan: n.supportPlan, followUpAt: n.followUpAt, createdAt: n.createdAt })));
  }),
);

counsellingRouter.post(
  '/appointments/:id/notes',
  requireRole('counsellor'),
  asyncHandler(async (req, res) => {
    const input = parse(counsellingNoteSchema, req.body);
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const appt = await Appointment.findById(req.params.id);
    if (!appt || String(appt.counsellorId) !== String(req.user!._id)) throw notFound();
    const note = await CounsellingNote.create({ appointmentId: appt._id, studentId: appt.studentId, counsellorId: req.user!._id, body: input.body, supportPlan: input.supportPlan ?? null, followUpAt: input.followUpAt ?? null });
    if (input.followUpAt) {
      appt.followUpAt = input.followUpAt;
      await appt.save();
      await scheduleFollowUp(appt, input.followUpAt);
    }
    await audit({ action: 'counselling_notes.created', req, targetType: 'appointment', targetId: String(appt._id) });
    ok(res, { id: String(note._id), body: note.body, supportPlan: note.supportPlan, followUpAt: note.followUpAt, createdAt: note.createdAt }, 201);
  }),
);

// ------------------------------------------------------------------ counsellor workspace
counsellingRouter.get(
  '/availability',
  requireRole('counsellor'),
  asyncHandler(async (req, res) => {
    const a = await Availability.findOne({ counsellorId: req.user!._id }).lean();
    ok(res, a ?? { weekly: [], slotMinutes: 50, maxDailySessions: 0, timezone: 'Asia/Kolkata', blockedDates: [], acceptingRequests: false, title: 'Counsellor', bio: '', specializations: [], languages: [] });
  }),
);

counsellingRouter.put(
  '/availability',
  requireRole('counsellor'),
  asyncHandler(async (req, res) => {
    const input = parse(availabilitySchema, req.body);
    for (const w of input.weekly) if (w.end <= w.start) throw new AppError(422, 'validation_failed', 'Each window must end after it starts.');
    const extra = { title: typeof req.body?.title === 'string' ? req.body.title.slice(0, 80) : undefined, bio: typeof req.body?.bio === 'string' ? req.body.bio.slice(0, 600) : undefined };
    const prev = await Availability.findOne({ counsellorId: req.user!._id }, { acceptingRequests: 1 }).lean();
    const fields: Record<string, unknown> = Object.fromEntries(Object.entries({ ...input, ...extra }).filter(([, v]) => v !== undefined));
    if (fields.maxDailySessions === 0) fields.maxDailySessions = 10; // older app builds send 0 for "not set"
    if (input.acceptingRequests !== undefined && Boolean(prev?.acceptingRequests) !== input.acceptingRequests) fields.dutyChangedAt = new Date();
    const a = await Availability.findOneAndUpdate({ counsellorId: req.user!._id }, { $set: fields }, { upsert: true, new: true });
    await audit({ action: 'availability.updated', req, changedFields: Object.keys(fields) });
    // On/off duty is recorded on its own so it is easy to find in the audit log.
    if (Boolean(prev?.acceptingRequests) !== a.acceptingRequests) {
      await audit({ action: a.acceptingRequests ? 'counsellor.on_duty' : 'counsellor.off_duty', req, targetType: 'user', targetId: String(req.user!._id) });
    }
    ok(res, a);
  }),
);

counsellingRouter.get(
  '/students/:studentId',
  requireRole('counsellor'),
  asyncHandler(async (req, res) => {
    if (!Types.ObjectId.isValid(req.params.studentId)) throw notFound();
    const has = req.user!.role === 'super_admin' || (await Appointment.exists({ counsellorId: req.user!._id, studentId: req.params.studentId }));
    if (!has) throw notFound();
    const s = await User.findById(req.params.studentId, { fullName: 1, studentId: 1, department: 1, academicYear: 1 }).lean();
    const history = await Appointment.find({ counsellorId: req.user!._id, studentId: req.params.studentId }).sort({ startAt: -1 }).lean();
    await audit({ action: 'counselling.student_viewed', req, targetType: 'user', targetId: req.params.studentId });
    ok(res, { student: s ? { id: String(s._id), name: s.fullName, studentId: s.studentId, department: s.department, academicYear: s.academicYear } : null, appointments: history.map((a) => ({ id: String(a._id), startAt: a.startAt, status: a.status, mode: a.mode, followUpAt: a.followUpAt })) });
  }),
);

counsellingRouter.get(
  '/my-students',
  requireRole('counsellor'),
  asyncHandler(async (req, res) => {
    const rows = await Appointment.aggregate([
      { $match: { counsellorId: req.user!._id } },
      { $sort: { startAt: -1 } },
      { $group: { _id: '$studentId', last: { $first: '$startAt' }, sessions: { $sum: 1 }, followUpAt: { $max: '$followUpAt' } } },
      { $limit: 500 },
    ]);
    const users = await User.find({ _id: { $in: rows.map((r) => r._id) } }, { fullName: 1, studentId: 1, department: 1 }).lean();
    const map = new Map(users.map((u) => [String(u._id), u]));
    ok(res, rows.map((r) => ({ id: String(r._id), name: map.get(String(r._id))?.fullName ?? 'Student', studentId: map.get(String(r._id))?.studentId, department: map.get(String(r._id))?.department, lastSession: r.last, sessions: r.sessions, followUpAt: r.followUpAt })));
  }),
);

counsellingRouter.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const subject = { role: req.user!.role as Role, permissions: req.user!.permissions };
    const match: Record<string, unknown> = {};
    if (req.user!.role === 'counsellor' || req.user!.role === 'super_admin') match.counsellorId = req.user!._id;
    else if (!hasPermission(subject, 'appointments:read_aggregate')) throw new AppError(403, 'forbidden', 'Not permitted.');
    const byStatus = await Appointment.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 } } }]);
    const byMonth = await Appointment.aggregate([
      { $match: { ...match, startAt: { $gte: new Date(Date.now() - 180 * 86400_000) } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$startAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    const today0 = new Date(); today0.setHours(0, 0, 0, 0);
    const today = await Appointment.countDocuments({ ...match, startAt: { $gte: today0, $lt: new Date(today0.getTime() + 86400_000) }, status: { $in: ['confirmed', 'rescheduled'] } });
    const pending = await Appointment.countDocuments({ ...match, status: 'requested' });
    ok(res, { byStatus: Object.fromEntries(byStatus.map((b) => [b._id, b.count])), byMonth: byMonth.map((m) => ({ month: m._id, count: m.count })), today, pending });
  }),
);
