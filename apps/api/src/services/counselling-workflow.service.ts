import type { Request } from 'express';
import { Types } from 'mongoose';
import type { ReminderKind } from '@campuscare/shared';
import { logger } from '../lib/logger';
import { Appointment, type AppointmentDoc } from '../models/counselling';
import { ChatChannel, ChatMembership } from '../models/chat';
import { CounsellingReminder } from '../models/wellness';
import { User, type UserDoc } from '../models/user';
import { emitToUser, evictFromRoom } from '../realtime/socket';
import { audit } from './audit.service';
import { CounsellorAssignmentService } from './counsellor-assignment.service';
import { isCurrentAssignment } from './counselling-schedule.service';
import { appLink } from './email/email.service';
import { registerJob, registerPeriodic } from './jobs.service';
import { notify, notifyMany } from './notification.service';

const TZ = 'Asia/Kolkata';
const when = (d?: Date | null) => (d ? d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ }) : 'to be scheduled');
const studentLink = '/student/counselling';
const counsellorLink = (id: unknown) => `/consultancy/appointments?focus=${id}`;

// ------------------------------------------------------------------ acceptance → private chat

/**
 * Called when the currently assigned counsellor accepts. Creates (or reuses — one thread per
 * appointment, enforced by a unique index) the private conversation, makes the student and this
 * counsellor its only members, and tells both. Safe to call twice.
 */
export async function activateCounsellingChat(appt: AppointmentDoc, counsellor: UserDoc) {
  const now = new Date();
  const thread = await ChatChannel.findOneAndUpdate(
    { appointmentId: appt._id },
    { $setOnInsert: { kind: 'counselling_thread', name: 'Counselling', appointmentId: appt._id, studentId: appt.studentId, published: true, createdBy: counsellor._id } },
    { upsert: true, new: true },
  );
  const removed = await ChatMembership.find({ channelId: thread._id, role: 'staff', userId: { $ne: counsellor._id } }, { userId: 1 }).lean();
  await ChatMembership.deleteMany({ channelId: thread._id, role: 'staff', userId: { $ne: counsellor._id } });
  await Promise.all(removed.map((m) => evictFromRoom(String(m.userId), `chat:${thread._id}`)));
  await ChatMembership.updateOne({ channelId: thread._id, userId: appt.studentId }, { $setOnInsert: { role: 'student' } }, { upsert: true });
  await ChatMembership.updateOne({ channelId: thread._id, userId: counsellor._id }, { $setOnInsert: { role: 'staff' } }, { upsert: true });
  thread.closed = false;
  thread.assignedStaffId = counsellor._id;
  await thread.save();

  const firstActivation = !appt.chatActivatedAt;
  appt.threadId = thread._id;
  appt.chatActivatedAt ??= now;
  appt.respondedAt ??= now;
  appt.responseDueAt = null;
  await appt.save();
  if (firstActivation) {
    // No counselling detail in either notification (lock screens).
    await notify({ userId: String(appt.studentId), kind: 'counselling_accepted', category: 'appointments', priority: 'high', title: 'Your request was accepted', body: 'You can now message your counsellor privately in CampusCare.', link: `/student/support/${thread._id}` });
    await notify({ userId: String(counsellor._id), kind: 'counselling_accepted', category: 'chat_messages', title: 'Conversation opened', body: 'The private conversation for this request is now open.', link: `/support/threads/${thread._id}` });
    emitToUser(String(appt.studentId), 'chats:changed', { channelId: String(thread._id) });
  }
  return thread;
}

// ------------------------------------------------------------------ decline / timeout → reassignment

async function coordinators() {
  const people = await User.find({ accountStatus: 'active', $or: [{ role: 'super_admin' }, { role: 'admin' }, { permissions: 'appointments:read_aggregate' }] }, { _id: 1 }).limit(50).lean();
  return people.map((p) => String(p._id));
}

/** Moves a still-pending request to the next eligible counsellor (excluding everyone who declined or timed out). */
export async function reassignToNext(appt: AppointmentDoc, reason: 'declined' | 'no_response', req?: Request) {
  const previous = appt.counsellorId ? String(appt.counsellorId) : null;
  appt.reassignCount = (appt.reassignCount ?? 0) + 1;
  await appt.save();
  const result = await CounsellorAssignmentService.autoAssign(String(appt._id), String(appt.studentId));
  if (previous && appt.threadId) {
    await ChatMembership.deleteMany({ channelId: appt.threadId, userId: previous, role: 'staff' });
    await evictFromRoom(previous, `chat:${appt.threadId}`);
  }
  await audit({ action: 'counselling.request_reassigned', req, actorId: req ? undefined : null, actorType: req ? undefined : 'system', targetType: 'appointment', targetId: String(appt._id), meta: { reason, from: previous, to: result.counsellorId ?? null, assigned: result.assigned } } as never);
  if (!result.assigned) {
    await notify({ userId: String(appt.studentId), kind: 'appointment', category: 'appointments', title: 'Update on your request', body: 'We are finding another counsellor for you. You will be notified when one accepts.', link: studentLink });
  }
  return result;
}

/** A counsellor declined: reassign right away when the student agreed to that; otherwise close it as declined. */
export async function declineRequest(appt: AppointmentDoc, counsellor: UserDoc, reason: string, req?: Request) {
  appt.declinedBy = [...(appt.declinedBy ?? []), counsellor._id] as never;
  appt.respondedAt = new Date();
  if (appt.allowReassignment) {
    await appt.save();
    await audit({ action: 'counselling.request_declined', req, targetType: 'appointment', targetId: String(appt._id), meta: { reassign: true } });
    return { reassigned: true, result: await reassignToNext(appt, 'declined', req) };
  }
  appt.status = 'rejected';
  appt.statusReason = reason;
  appt.slotLock = null;
  await appt.save();
  await audit({ action: 'counselling.request_declined', req, targetType: 'appointment', targetId: String(appt._id), meta: { reassign: false } });
  await notify({ userId: String(appt.studentId), kind: 'appointment', category: 'appointments', title: 'Update on your request', body: 'Your chosen counsellor could not take this request. You can choose another counsellor in CampusCare.', link: studentLink });
  return { reassigned: false };
}

registerJob('counselling.response_reminder', async (payload) => {
  const appt = await Appointment.findById(String(payload.appointmentId));
  if (!isCurrentAssignment(appt, payload)) return; // accepted, declined or reassigned meanwhile
  await notify({
    userId: String(appt!.counsellorId), kind: 'counselling_response_due', category: 'appointments', priority: 'high',
    title: 'A request is waiting for you', body: 'Please accept or decline within 15 minutes.', link: counsellorLink(appt!._id),
    email: { template: 'appointment_reminder', vars: { when: when(appt!.startAt), link: appLink(counsellorLink(appt!._id)) }, dedupeKey: `cc-remind:${appt!._id}:${payload.assignedAt}` },
  });
});

registerJob('counselling.response_deadline', async (payload) => {
  const appt = await Appointment.findById(String(payload.appointmentId));
  if (!isCurrentAssignment(appt, payload)) return;
  const a = appt!;
  const lateCounsellor = String(a.counsellorId);
  a.timedOutBy = [...(a.timedOutBy ?? []), new Types.ObjectId(lateCounsellor)] as never;
  a.responseOverdueAt = new Date();
  await a.save();
  await audit({ action: 'counselling.response_overdue', actorId: null, actorType: 'system', targetType: 'appointment', targetId: String(a._id), meta: { counsellorId: lateCounsellor, reassign: a.allowReassignment } } as never);
  await notify({
    userId: lateCounsellor, kind: 'counselling_response_overdue', category: 'appointments', priority: 'high',
    title: 'Response time passed',
    body: a.allowReassignment ? 'A request was passed to another counsellor because it was not answered within an hour.' : 'A request has waited over an hour. Please accept or decline it now.',
    link: counsellorLink(a._id),
    email: { template: 'appointment_reminder', vars: { when: when(a.startAt), link: appLink(counsellorLink(a._id)) }, dedupeKey: `cc-deadline:${a._id}:${payload.assignedAt}` },
  });
  if (a.allowReassignment) {
    await reassignToNext(a, 'no_response');
    return;
  }
  // The student chose this counsellor and did not agree to a swap: tell them and the coordinators instead.
  await notify({ userId: String(a.studentId), kind: 'appointment', category: 'appointments', title: 'Update on your request', body: 'Your chosen counsellor has not replied yet. You can keep waiting or choose another counsellor.', link: studentLink });
  await notifyMany(await coordinators(), { kind: 'counselling_overdue', category: 'appointments', priority: 'high', title: 'Counselling request overdue', body: 'A request has waited over an hour for a counsellor response.', link: '/super-admin/counselling' });
});

// ------------------------------------------------------------------ reminders

export async function addReminder(input: { appointmentId: unknown; userId: unknown; kind: ReminderKind; dueAt: Date; note?: string | null; createdBy?: unknown; dedupeKey?: string }) {
  try {
    return await CounsellingReminder.create({ ...input, note: input.note ?? null, createdBy: input.createdBy ?? null, dedupeKey: input.dedupeKey ?? null });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return null; // already scheduled
    throw err;
  }
}

export async function cancelReminders(appointmentId: unknown, kinds?: ReminderKind[]) {
  await CounsellingReminder.updateMany({ appointmentId, status: 'pending', ...(kinds ? { kind: { $in: kinds } } : {}) }, { $set: { status: 'cancelled' } });
}

/** Upcoming-session reminders for both people, one hour before. Replaces earlier ones after a reschedule. */
export async function scheduleUpcomingReminders(appt: AppointmentDoc) {
  await cancelReminders(appt._id, ['upcoming']);
  if (!appt.startAt || !appt.counsellorId) return;
  const dueAt = new Date(appt.startAt.getTime() - 60 * 60_000);
  if (dueAt.getTime() <= Date.now()) return;
  const key = `${appt._id}:${appt.startAt.getTime()}`;
  await addReminder({ appointmentId: appt._id, userId: appt.studentId, kind: 'upcoming', dueAt, dedupeKey: `upcoming:student:${key}` });
  await addReminder({ appointmentId: appt._id, userId: appt.counsellorId, kind: 'upcoming', dueAt, dedupeKey: `upcoming:counsellor:${key}` });
}

/** Keeps reminders in step with the appointment's status. */
export async function onAppointmentStatus(appt: AppointmentDoc, from: string) {
  const s = appt.status;
  if (s === 'cancelled' || s === 'rejected') return cancelReminders(appt._id);
  if (s === 'confirmed') return scheduleUpcomingReminders(appt);
  if (s === 'rescheduled') {
    await scheduleUpcomingReminders(appt);
    await addReminder({ appointmentId: appt._id, userId: appt.studentId, kind: 'reschedule', dueAt: new Date(Date.now() + 24 * 3600_000), dedupeKey: `reschedule:${appt._id}:${appt.startAt?.getTime()}` });
    return;
  }
  if (s === 'missed' && from !== 'missed') {
    await cancelReminders(appt._id, ['upcoming']);
    const dueAt = new Date(Date.now() + 60 * 60_000);
    await addReminder({ appointmentId: appt._id, userId: appt.studentId, kind: 'missed_follow_up', dueAt, dedupeKey: `missed:student:${appt._id}` });
    if (appt.counsellorId) await addReminder({ appointmentId: appt._id, userId: appt.counsellorId, kind: 'missed_follow_up', dueAt, dedupeKey: `missed:counsellor:${appt._id}` });
    return;
  }
  if (s === 'completed' && from !== 'completed') {
    await cancelReminders(appt._id, ['upcoming', 'reschedule']);
    await notify({ userId: String(appt.studentId), kind: 'counselling_feedback', category: 'appointments', title: 'How did it go?', body: 'You can share optional, anonymous feedback in CampusCare.', link: studentLink });
  }
}

/** Follow-up date set by the counsellor (session notes): remind both of them on that day. */
export async function scheduleFollowUp(appt: AppointmentDoc, followUpAt: Date) {
  await cancelReminders(appt._id, ['follow_up']);
  if (followUpAt.getTime() <= Date.now()) return;
  await addReminder({ appointmentId: appt._id, userId: appt.studentId, kind: 'follow_up', dueAt: followUpAt, dedupeKey: `follow:student:${appt._id}:${followUpAt.getTime()}` });
  if (appt.counsellorId) await addReminder({ appointmentId: appt._id, userId: appt.counsellorId, kind: 'follow_up', dueAt: followUpAt, dedupeKey: `follow:counsellor:${appt._id}:${followUpAt.getTime()}` });
}

/** Lock-screen safe text: no "counselling", no names, no notes. */
function reminderText(kind: ReminderKind, isStudent: boolean, appt: { startAt?: Date | null }) {
  switch (kind) {
    case 'upcoming': return `You have an appointment at ${appt.startAt?.toLocaleTimeString('en-IN', { timeStyle: 'short', timeZone: TZ }) ?? 'the scheduled time'}.`;
    case 'reschedule': return 'Your appointment time changed. Please check the new time.';
    case 'missed_follow_up': return isStudent ? 'You missed a recent appointment. You can book a new time whenever you are ready.' : 'A student missed an appointment. Consider following up.';
    case 'follow_up': return isStudent ? 'A planned follow-up is due. You can book or send a message.' : 'A follow-up you planned is due.';
    default: return 'A reminder you set is due.';
  }
}

export async function sendDueReminders(max = 100) {
  let sent = 0;
  for (let i = 0; i < max; i++) {
    const now = new Date();
    const r = await CounsellingReminder.findOneAndUpdate(
      { $or: [{ status: 'pending', dueAt: { $lte: now } }, { status: 'sending', updatedAt: { $lte: new Date(now.getTime() - 10 * 60_000) } }] },
      { $set: { status: 'sending' } },
      { sort: { dueAt: 1 }, new: true },
    );
    if (!r) break;
    try {
      const appt = await Appointment.findById(r.appointmentId, { status: 1, startAt: 1, studentId: 1 }).lean();
      const stale = !appt
        || (r.kind === 'upcoming' && (!['confirmed', 'rescheduled'].includes(appt.status) || !appt.startAt || appt.startAt <= now))
        || (r.kind === 'reschedule' && appt.status !== 'rescheduled');
      if (stale) {
        r.status = 'cancelled';
      } else {
        const isStudent = String(appt.studentId) === String(r.userId);
        await notify({ userId: String(r.userId), kind: 'appointment_reminder', category: 'appointments', title: 'CampusCare reminder', body: reminderText(r.kind as ReminderKind, isStudent, appt), link: isStudent ? studentLink : counsellorLink(r.appointmentId) });
        r.status = 'sent';
        r.sentAt = new Date();
        sent++;
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'reminder send failed');
      // Left in "sending": the sweep retries it after 10 minutes, at most 5 times.
      r.attempts = (r.attempts ?? 0) + 1;
      if (r.attempts >= 5) r.status = 'cancelled';
    }
    await r.save();
  }
  return sent;
}

registerPeriodic('counselling-reminders', 60_000, async () => { await sendDueReminders(); });
