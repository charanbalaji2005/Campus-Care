import { Router } from 'express';
import { Types } from 'mongoose';
import {
  ACTIVE_APPOINTMENT_STATUSES, appointmentRequestSchema, appointmentUpdateSchema, availabilitySchema, counsellingNoteSchema,
  hasPermission, type AppointmentStatus, type Role,
} from '@campuscare/shared';
import { AppError, asyncHandler, notFound, ok, parse } from '../lib/http';
import { generateSlots } from '../lib/time';
import { Appointment, Availability, CounsellingNote, type AppointmentDoc } from '../models/counselling';
import { ChatChannel, ChatMembership } from '../models/chat';
import { User, type UserDoc } from '../models/user';
import { requireAuth, requirePermission, requireRole } from '../middleware/auth';
import { audit } from '../services/audit.service';
import { notify } from '../services/notification.service';
import { appLink } from '../services/email/email.service';

export const counsellingRouter = Router();
counsellingRouter.use(requireAuth);

const slotLockOf = (counsellorId: unknown, startAt: Date) => `${String(counsellorId)}:${startAt.toISOString()}`;
const fmt = (d: Date) => d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });

async function bookedStarts(counsellorId: unknown) {
  const active = await Appointment.find({ counsellorId, status: { $in: ACTIVE_APPOINTMENT_STATUSES }, startAt: { $gt: new Date() } }, { startAt: 1 }).lean();
  return new Set(active.map((a) => a.startAt.toISOString()));
}

function serializeAppointment(a: AppointmentDoc | Record<string, unknown>, viewer: 'student' | 'counsellor', people: Map<string, { fullName: string; studentId?: string | null; department?: string | null }>) {
  const ap = a as AppointmentDoc;
  const student = people.get(String(ap.studentId));
  const counsellor = people.get(String(ap.counsellorId));
  return {
    id: String(ap._id),
    startAt: ap.startAt,
    endAt: ap.endAt,
    mode: ap.mode,
    status: ap.status,
    statusReason: ap.statusReason,
    reason: ap.reason,
    meetingLink: ap.status === 'confirmed' || ap.status === 'rescheduled' ? ap.meetingLink : null,
    threadId: ap.threadId ? String(ap.threadId) : null,
    counsellor: counsellor ? { id: String(ap.counsellorId), name: counsellor.fullName } : null,
    // Counsellors see only what they need for the session.
    student: viewer === 'counsellor' && student ? { id: String(ap.studentId), name: student.fullName, studentId: student.studentId ?? null, department: student.department ?? null } : undefined,
    followUpAt: ap.followUpAt,
    createdAt: (ap as unknown as { createdAt: Date }).createdAt,
  };
}

async function peopleFor(list: { studentId: unknown; counsellorId: unknown }[]) {
  const ids = [...new Set(list.flatMap((a) => [String(a.studentId), String(a.counsellorId)]))];
  const users = await User.find({ _id: { $in: ids } }, { fullName: 1, studentId: 1, department: 1 }).lean();
  return new Map(users.map((u) => [String(u._id), u]));
}

// ------------------------------------------------------------------ directory and slots (students)
counsellingRouter.get(
  '/counsellors',
  asyncHandler(async (_req, res) => {
    const counsellors = await User.find({ role: 'counsellor', accountStatus: 'active' }, { fullName: 1 }).lean();
    const avail = await Availability.find({ counsellorId: { $in: counsellors.map((c) => c._id) } }).lean();
    const map = new Map(avail.map((a) => [String(a.counsellorId), a]));
    ok(res, counsellors.map((c) => {
      const a = map.get(String(c._id));
      return { id: String(c._id), name: c.fullName, title: a?.title ?? 'Counsellor', bio: a?.bio ?? '', acceptingRequests: a?.acceptingRequests ?? false };
    }));
  }),
);

counsellingRouter.get(
  '/counsellors/:id/slots',
  asyncHandler(async (req, res) => {
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const a = await Availability.findOne({ counsellorId: req.params.id }).lean();
    if (!a || !a.acceptingRequests) return ok(res, { slots: [], slotMinutes: a?.slotMinutes ?? 50 });
    const booked = await bookedStarts(req.params.id);
    const slots = generateSlots({ weekly: a.weekly as never, slotMinutes: a.slotMinutes, timezone: a.timezone, blockedDates: a.blockedDates })
      .filter((s) => !booked.has(s.toISOString()));
    ok(res, { slots: slots.map((s) => s.toISOString()), slotMinutes: a.slotMinutes, timezone: a.timezone });
  }),
);

// ------------------------------------------------------------------ appointments
counsellingRouter.get(
  '/appointments',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    let filter: Record<string, unknown>;
    let view: 'student' | 'counsellor' = 'student';
    if (user.role === 'student') filter = { studentId: user._id };
    else if (user.role === 'counsellor') { filter = { counsellorId: user._id }; view = 'counsellor'; }
    else throw new AppError(403, 'forbidden', 'Administrators see aggregate counselling statistics only.');
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.upcoming === 'true') filter.startAt = { $gte: new Date(Date.now() - 3600_000) };
    const list = await Appointment.find(filter).sort({ startAt: req.query.upcoming === 'true' ? 1 : -1 }).limit(200).lean();
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
    const avail = await Availability.findOne({ counsellorId: input.counsellorId }).lean();
    if (!avail?.acceptingRequests) throw new AppError(422, 'not_accepting', 'This counsellor is not accepting requests right now.');
    const slots = generateSlots({ weekly: avail.weekly as never, slotMinutes: avail.slotMinutes, timezone: avail.timezone, blockedDates: avail.blockedDates });
    const startAt = new Date(input.startAt);
    if (!slots.some((s) => s.getTime() === startAt.getTime())) throw new AppError(422, 'invalid_slot', 'Choose one of the available time slots.');
    const activeCount = await Appointment.countDocuments({ studentId: req.user!._id, status: { $in: ACTIVE_APPOINTMENT_STATUSES }, startAt: { $gt: new Date() } });
    if (activeCount >= 3) throw new AppError(422, 'too_many', 'You already have 3 upcoming requests. Cancel one before booking another.');
    let appt;
    try {
      appt = await Appointment.create({
        studentId: req.user!._id, counsellorId: input.counsellorId, startAt, endAt: new Date(startAt.getTime() + avail.slotMinutes * 60_000),
        mode: input.mode, reason: input.reason ?? null, status: 'requested', slotLock: slotLockOf(input.counsellorId, startAt), idempotencyKey: input.idempotencyKey,
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new AppError(409, 'slot_taken', 'That slot was just taken. Please pick another time.');
      throw err;
    }
    // Private appointment thread (student + counsellor only).
    const thread = await ChatChannel.create({ kind: 'counselling_thread', name: 'Counselling', appointmentId: appt._id, studentId: req.user!._id, published: true });
    await ChatMembership.insertMany([{ channelId: thread._id, userId: req.user!._id, role: 'student' }, { channelId: thread._id, userId: input.counsellorId, role: 'staff' }]);
    appt.threadId = thread._id;
    await appt.save();
    await audit({ action: 'appointment.requested', req, targetType: 'appointment', targetId: String(appt._id) });
    await notify({ userId: input.counsellorId, kind: 'appointment', category: 'appointments', title: 'New appointment request', body: `Requested for ${fmt(startAt)}.`, link: `/consultancy/appointments?focus=${appt._id}` });
    ok(res, { id: String(appt._id), status: appt.status }, 201);
  }),
);

async function loadAppointmentFor(user: UserDoc, id: string) {
  if (!Types.ObjectId.isValid(id)) throw notFound();
  const appt = await Appointment.findById(id);
  if (!appt) throw notFound();
  const isStudent = String(appt.studentId) === String(user._id);
  const isCounsellor = String(appt.counsellorId) === String(user._id);
  if (!isStudent && !isCounsellor) throw notFound();
  return { appt, isStudent, isCounsellor };
}

counsellingRouter.patch(
  '/appointments/:id',
  asyncHandler(async (req, res) => {
    const input = parse(appointmentUpdateSchema, req.body);
    const { appt, isStudent, isCounsellor } = await loadAppointmentFor(req.user!, req.params.id);
    const from = appt.status as AppointmentStatus;
    const to = input.status;
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
      if ((to === 'completed' || to === 'missed') && appt.startAt > new Date()) throw new AppError(422, 'too_early', 'You can record attendance after the session starts.');
    }
    if (input.startAt) {
      if (!isCounsellor) throw new AppError(403, 'forbidden', 'Only the counsellor can propose a new time.');
      const avail = await Availability.findOne({ counsellorId: appt.counsellorId }).lean();
      const newStart = new Date(input.startAt);
      if (newStart <= new Date()) throw new AppError(422, 'invalid_slot', 'Choose a future time.');
      appt.startAt = newStart;
      appt.endAt = new Date(newStart.getTime() + (avail?.slotMinutes ?? 50) * 60_000);
      appt.reminderSentAt = null;
    }
    if (to) appt.status = to;
    if (input.reason) appt.statusReason = input.reason;
    if (input.meetingLink !== undefined && isCounsellor) appt.meetingLink = input.meetingLink || null;
    appt.slotLock = ACTIVE_APPOINTMENT_STATUSES.includes(appt.status as AppointmentStatus) ? slotLockOf(appt.counsellorId, appt.startAt) : null;
    try {
      await appt.save();
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new AppError(409, 'slot_taken', 'You already have an appointment at that time.');
      throw err;
    }
    await audit({ action: 'appointment.updated', req, targetType: 'appointment', targetId: String(appt._id), meta: { from, to: appt.status } });
    const otherParty = isCounsellor ? String(appt.studentId) : String(appt.counsellorId);
    await notify({
      userId: otherParty, kind: 'appointment', category: 'appointments', title: `Appointment ${appt.status}`, body: `Your appointment on ${fmt(appt.startAt)} is now ${appt.status}.`,
      link: isCounsellor ? '/student/counselling' : `/consultancy/appointments?focus=${appt._id}`,
      email: isCounsellor ? { template: 'appointment_update', vars: { when: fmt(appt.startAt), status: appt.status, link: appLink('/student/counselling') } } : undefined,
    });
    const people = await peopleFor([appt]);
    ok(res, serializeAppointment(appt, isCounsellor ? 'counsellor' : 'student', people));
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
    if (input.followUpAt) { appt.followUpAt = input.followUpAt; await appt.save(); }
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
    ok(res, a ?? { weekly: [], slotMinutes: 50, timezone: 'Asia/Kolkata', blockedDates: [], acceptingRequests: false, title: 'Counsellor', bio: '' });
  }),
);

counsellingRouter.put(
  '/availability',
  requireRole('counsellor'),
  asyncHandler(async (req, res) => {
    const input = parse(availabilitySchema, req.body);
    for (const w of input.weekly) if (w.end <= w.start) throw new AppError(422, 'validation_failed', 'Each window must end after it starts.');
    const extra = { title: typeof req.body?.title === 'string' ? req.body.title.slice(0, 80) : undefined, bio: typeof req.body?.bio === 'string' ? req.body.bio.slice(0, 600) : undefined };
    const a = await Availability.findOneAndUpdate({ counsellorId: req.user!._id }, { $set: { ...input, ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined)) } }, { upsert: true, new: true });
    await audit({ action: 'availability.updated', req });
    ok(res, a);
  }),
);

counsellingRouter.get(
  '/students/:studentId',
  requireRole('counsellor'),
  asyncHandler(async (req, res) => {
    if (!Types.ObjectId.isValid(req.params.studentId)) throw notFound();
    // Minimum necessary: only students this counsellor has appointments with.
    const has = await Appointment.exists({ counsellorId: req.user!._id, studentId: req.params.studentId });
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
    if (req.user!.role === 'counsellor') match.counsellorId = req.user!._id;
    else if (!hasPermission(subject, 'appointments:read_aggregate')) throw new AppError(403, 'forbidden', 'Not permitted.');
    // Aggregates only — never names or notes.
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
