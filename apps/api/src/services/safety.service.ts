import { formatSosNumber, hasPermission, type Role } from '@campuscare/shared';
import { Types } from 'mongoose';
import { AlertDeliveryEvent, EmergencyAlert, EmergencyRecipient, SafeWalkSession, TrustedContact, type EmergencyAlertDoc } from '../models/safety';
import { nextSequence } from '../models/incident';
import { User } from '../models/user';
import { enqueueJob, registerJob, registerPeriodic } from './jobs.service';
import { notify } from './notification.service';
import { appLink, sendEmail } from './email/email.service';
import { emitToRoom, emitToUser, registerRoomAuthoriser } from '../realtime/socket';
import { getSettings } from './settings.service';
import { audit } from './audit.service';
import { logger } from '../lib/logger';

registerRoomAuthoriser('responders', async (user) => hasPermission({ role: user.role as Role, permissions: user.permissions }, 'sos:respond'));
registerRoomAuthoriser('sos', async (user, alertId) => {
  if (!Types.ObjectId.isValid(alertId)) return false;
  const a = await EmergencyAlert.findById(alertId, { userId: 1 }).lean();
  if (!a) return false;
  return String(a.userId) === String(user._id) || hasPermission({ role: user.role as Role, permissions: user.permissions }, 'sos:respond');
});

/** Appends an entry to the alert's response timeline. */
export async function recordSosEvent(alertId: unknown, type: string, opts: { actorId?: string | null; actorLabel?: string | null; note?: string | null; studentVisible?: boolean } = {}) {
  await EmergencyAlert.updateOne(
    { _id: alertId },
    { $push: { events: { type, at: new Date(), actorId: opts.actorId ?? null, actorLabel: opts.actorLabel ?? null, note: opts.note ?? null, studentVisible: opts.studentVisible ?? true } } },
  );
}

export function sosTimeline(a: { events?: { type: string; at: Date; actorLabel?: string | null; note?: string | null; studentVisible?: boolean }[] }, forResponder: boolean) {
  return (a.events ?? [])
    .filter((e) => forResponder || e.studentVisible !== false)
    .map((e) => ({ type: e.type, at: e.at, actorLabel: e.actorLabel ?? null, note: forResponder ? e.note ?? null : null }));
}

export function serializeAlert(a: EmergencyAlertDoc | Record<string, unknown>, forResponder: boolean, student?: { fullName: string; phone?: string | null; studentId?: string | null; hostel?: string | null }) {
  const al = a as EmergencyAlertDoc;
  return {
    id: String(al._id),
    alertNumber: al.alertNumber,
    status: al.status,
    createdAt: al.createdAt,
    sentAt: al.sentAt,
    acknowledgedAt: al.acknowledgedAt,
    resolvedAt: al.resolvedAt,
    cancelledAt: al.cancelledAt,
    locationAvailable: al.latitude != null && al.longitude != null,
    locationUnavailableReason: al.locationUnavailableReason,
    // Precise coordinates only for authorised responders (and the student themself).
    latitude: al.latitude,
    longitude: al.longitude,
    accuracyMeters: al.accuracyMeters,
    mapLink: forResponder && al.latitude != null ? `https://www.openstreetmap.org/?mlat=${al.latitude}&mlon=${al.longitude}#map=18/${al.latitude}/${al.longitude}` : null,
    note: al.note,
    lastDeliveryError: al.lastDeliveryError,
    enRouteAt: al.enRouteAt ?? null,
    escalationLevel: al.escalationLevel ?? 0,
    resolutionOutcome: al.resolutionOutcome ?? null,
    assignedToMe: undefined as boolean | undefined,
    timeline: sosTimeline(al as never, forResponder),
    student: forResponder ? student : undefined,
  };
}

export async function raiseSos(userId: string, input: { idempotencyKey: string; latitude?: number; longitude?: number; accuracyMeters?: number; locationUnavailableReason?: string; note?: string; notifyTrustedContacts?: boolean }) {
  const existing = await EmergencyAlert.findOne({ idempotencyKey: input.idempotencyKey });
  if (existing) {
    if (String(existing.userId) !== userId) throw new Error('conflict');
    return existing; // retry after a dropped connection — never a second alert
  }
  const year = new Date().getFullYear();
  const seq = await nextSequence(`sos:${year}`);
  const alert = await EmergencyAlert.create({
    alertNumber: formatSosNumber(year, seq),
    userId,
    idempotencyKey: input.idempotencyKey,
    status: 'queued',
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    accuracyMeters: input.accuracyMeters ?? null,
    locationUnavailableReason: input.latitude == null ? input.locationUnavailableReason ?? 'Location not shared' : null,
    note: input.note ?? null,
    events: [{ type: 'raised', at: new Date(), actorLabel: 'Student', note: null, studentVisible: true }],
  });
  await audit({ action: 'sos.raised', actorId: userId, actorRole: 'student', targetType: 'sos', targetId: String(alert._id), meta: { location: alert.latitude != null } });
  // Deliver immediately in-process, with a durable job as the retry path.
  await enqueueJob('sos.deliver', { alertId: String(alert._id) }, { dedupeKey: `sos:${alert._id}:1`, maxAttempts: 8 });
  if (input.notifyTrustedContacts !== false) await enqueueJob('sos.trusted_contacts', { alertId: String(alert._id) }, { dedupeKey: `sos-tc:${alert._id}` });
  return alert;
}

async function responderRecipients(tier: 'primary' | 'backup' = 'primary') {
  const configured = await EmergencyRecipient.find({ active: true, tier: tier === 'primary' ? { $in: ['primary', null] } : 'backup' }).lean();
  if (tier === 'backup') {
    return {
      userIds: configured.filter((r) => r.type === 'user' && r.userId).map((r) => String(r.userId)),
      emails: configured.filter((r) => r.type === 'email' && r.email).map((r) => r.email!),
    };
  }
  const userIds = new Set(configured.filter((r) => r.type === 'user' && r.userId).map((r) => String(r.userId)));
  const emails = new Set(configured.filter((r) => r.type === 'email' && r.email).map((r) => r.email!));
  // Always include active security officers so an empty configuration never means "nobody".
  const officers = await User.find({ role: 'security_officer', accountStatus: 'active' }, { _id: 1 }).lean();
  officers.forEach((o) => userIds.add(String(o._id)));
  return { userIds: [...userIds], emails: [...emails] };
}

registerJob('sos.deliver', async (payload) => {
  const alert = await EmergencyAlert.findById(payload.alertId);
  if (!alert || ['cancelled', 'acknowledged', 'en_route', 'resolved'].includes(alert.status)) return;
  if (alert.status === 'sent') return;
  alert.status = 'sending';
  alert.deliveryAttempts += 1;
  await alert.save();
  emitToRoom(`sos:${alert._id}`, 'sos:updated', { id: String(alert._id), status: alert.status });

  const settings = await getSettings();
  const student = await User.findById(alert.userId, { fullName: 1, phone: 1, studentId: 1, hostel: 1 }).lean();
  const { userIds, emails } = await responderRecipients();
  let delivered = 0;
  const locationText = alert.latitude != null ? `${alert.latitude.toFixed(5)}, ${alert.longitude!.toFixed(5)} (±${Math.round(alert.accuracyMeters ?? 0)} m)` : `Unavailable — ${alert.locationUnavailableReason ?? 'not shared'}`;

  for (const uid of userIds) {
    try {
      await notify({ userId: uid, kind: 'sos', priority: 'critical', title: `SOS ${alert.alertNumber}`, body: 'An emergency alert needs a responder now.', link: `/security/alerts/${alert._id}` });
      await AlertDeliveryEvent.create({ alertId: alert._id, channel: 'in_app', recipient: uid, outcome: 'delivered' });
      delivered++;
    } catch (err) {
      await AlertDeliveryEvent.create({ alertId: alert._id, channel: 'in_app', recipient: uid, outcome: 'failed', error: (err as Error).message.slice(0, 200) });
    }
  }
  emitToRoom('responders:all', 'sos:new', serializeAlert(alert, true, student ? { fullName: student.fullName, phone: student.phone, studentId: student.studentId, hostel: student.hostel } : undefined));

  if (settings.sos.emailRecipients) {
    const responderUsers = await User.find({ _id: { $in: userIds } }, { email: 1 }).lean();
    const allEmails = new Set([...emails, ...responderUsers.map((u) => u.email)]);
    for (const to of allEmails) {
      const d = await sendEmail('sos_alert', to, {
        alertNumber: alert.alertNumber, time: alert.createdAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }), studentName: student?.fullName ?? 'Student',
        locationText, link: appLink(`/security/alerts/${alert._id}`),
      }, `sos:${alert._id}:${to}`);
      await AlertDeliveryEvent.create({ alertId: alert._id, channel: 'email', recipient: to.replace(/^(.).*@/, '$1***@'), outcome: 'accepted', error: d ? null : 'already queued' });
    }
  }
  await AlertDeliveryEvent.create({ alertId: alert._id, channel: 'sms', recipient: 'gateway', outcome: 'not_configured' });

  if (delivered === 0) {
    alert.status = 'failed';
    alert.lastDeliveryError = userIds.length ? 'Could not reach any responder' : 'No active responders are configured';
    await alert.save();
    emitToUser(String(alert.userId), 'sos:updated', { id: String(alert._id), status: alert.status });
    emitToRoom(`sos:${alert._id}`, 'sos:updated', { id: String(alert._id), status: alert.status });
    logger.error({ alert: alert.alertNumber }, 'SOS delivery failed');
    throw new Error(alert.lastDeliveryError); // retried by the job queue
  }
  alert.status = 'sent';
  alert.sentAt = new Date();
  alert.lastDeliveryError = null;
  alert.events.push({ type: 'delivered', at: new Date(), actorLabel: `${delivered} responder(s) reached`, note: null, studentVisible: true } as never);
  await alert.save();
  emitToRoom(`sos:${alert._id}`, 'sos:updated', { id: String(alert._id), status: alert.status, sentAt: alert.sentAt, responders: delivered });
});

// ------------------------------------------------------------------ Safe Walk escalation
registerPeriodic('safe-walk-overdue', 30_000, async () => {
  const settings = await getSettings();
  const graceMs = settings.safeWalk.graceMinutes * 60_000;
  const due = await SafeWalkSession.find({ status: { $in: ['active', 'overdue'] }, expectedArrivalAt: { $lt: new Date(Date.now()) } }).limit(50);
  for (const walk of due) {
    const overdueBy = Date.now() - walk.expectedArrivalAt.getTime();
    if (walk.status === 'active') {
      walk.status = 'overdue';
      await walk.save();
      await notify({ userId: String(walk.userId), kind: 'safe_walk', priority: 'critical', title: 'Are you safe?', body: 'You have not checked in from your Safe Walk. Tap to check in.', link: '/student/safe-walk' });
      continue;
    }
    if (walk.status === 'overdue' && overdueBy >= graceMs) {
      walk.status = 'escalated';
      walk.escalatedAt = new Date();
      await walk.save();
      const student = await User.findById(walk.userId, { fullName: 1 }).lean();
      const contacts = await TrustedContact.find({ _id: { $in: walk.trustedContactIds }, userId: walk.userId, status: 'verified' }).lean();
      for (const c of contacts) {
        await sendEmail('safe_walk_overdue', c.email, {
          name: c.name, studentName: student?.fullName ?? 'A student', destination: walk.destination,
          expected: walk.expectedArrivalAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
        }, `safewalk:${walk._id}:${c._id}`);
      }
      if (settings.safeWalk.notifySecurityOnEscalation) {
        const officers = await User.find({ role: 'security_officer', accountStatus: 'active' }, { _id: 1 }).lean();
        for (const o of officers) {
          await notify({ userId: String(o._id), kind: 'safe_walk', priority: 'critical', title: 'Missed Safe Walk check-in', body: `${student?.fullName ?? 'A student'} has not arrived at ${walk.destination}.`, link: '/security/alerts' });
        }
      }
      await audit({ action: 'safe_walk.escalated', targetType: 'safe_walk', targetId: String(walk._id), meta: { contacts: contacts.length } });
    }
  }
});

// Safety net: retry stuck SOS alerts that never left "queued"/"sending".
registerPeriodic('sos-watchdog', 15_000, async () => {
  const stuck = await EmergencyAlert.find({ status: { $in: ['queued', 'sending'] }, updatedAt: { $lt: new Date(Date.now() - 20_000) } }).limit(20);
  for (const a of stuck) await enqueueJob('sos.deliver', { alertId: String(a._id) }, { dedupeKey: `sos:${a._id}:${a.deliveryAttempts + 1}` });
});

// ------------------------------------------------------------------ trusted contacts for SOS
registerJob('sos.trusted_contacts', async (payload) => {
  const alert = await EmergencyAlert.findById(payload.alertId);
  if (!alert || alert.status === 'cancelled') return;
  const student = await User.findById(alert.userId, { fullName: 1 }).lean();
  const contacts = await TrustedContact.find({ userId: alert.userId, status: 'verified' }).lean();
  for (const c of contacts) {
    // Location goes only to contacts the student allowed to see it.
    const locationText = c.shareLocation && alert.latitude != null
      ? `https://www.openstreetmap.org/?mlat=${alert.latitude}&mlon=${alert.longitude}#map=18/${alert.latitude}/${alert.longitude}`
      : 'Not shared with you';
    await sendEmail('sos_trusted_contact', c.email, {
      name: c.name, studentName: student?.fullName ?? 'A student', time: alert.createdAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }), locationText,
    }, `sos-tc:${alert._id}:${c._id}`);
    await AlertDeliveryEvent.create({ alertId: alert._id, channel: 'email', recipient: `trusted:${c.email.replace(/^(.).*@/, '$1***@')}`, outcome: 'accepted' });
  }
  if (contacts.length) await recordSosEvent(alert._id, 'trusted_contacts_notified', { actorLabel: `${contacts.length} trusted contact(s) emailed` });
});

// ------------------------------------------------------------------ escalation when nobody acknowledges
/**
 * Escalates SOS alerts nobody has acknowledged: level 1 alerts backup recipients (and re-alerts
 * primary responders), level 2 alerts administrators. Returns how many alerts were escalated.
 */
export async function runSosEscalation(now = Date.now()): Promise<number> {
  const s = await getSettings();
  let escalated = 0;
  const waiting = await EmergencyAlert.find({ status: { $in: ['sent', 'failed', 'sending', 'queued'] }, acknowledgedAt: null, escalationLevel: { $lt: 2 } }).limit(50);
  for (const a of waiting) {
    const age = now - a.createdAt.getTime();
    const level = age >= s.sos.secondEscalationAfterSeconds * 1000 ? 2 : age >= s.sos.escalateAfterSeconds * 1000 ? 1 : 0;
    if (level <= (a.escalationLevel ?? 0)) continue;
    // Claim the escalation level atomically so parallel workers never notify twice.
    const claimed = await EmergencyAlert.updateOne({ _id: a._id, escalationLevel: { $lt: level } }, { $set: { escalationLevel: level, escalatedAt: new Date() } });
    if (!claimed.modifiedCount) continue;
    let recipients: string[] = [];
    let emails: string[] = [];
    if (level === 1) {
      const backup = await responderRecipients('backup');
      recipients = backup.userIds;
      emails = backup.emails;
      // Re-alert every primary responder too.
      recipients.push(...(await responderRecipients('primary')).userIds);
    } else {
      const admins = await User.find({ role: { $in: ['admin', 'super_admin'] }, accountStatus: 'active' }, { _id: 1 }).lean();
      recipients = admins.map((u) => String(u._id));
    }
    for (const uid of new Set(recipients)) {
      await notify({ userId: uid, kind: 'sos', priority: 'critical', title: `ESCALATED SOS ${a.alertNumber}`, body: `No responder has acknowledged this SOS for ${Math.round(age / 60000)} min.`, link: `/security/alerts/${a._id}` });
      await AlertDeliveryEvent.create({ alertId: a._id, channel: 'in_app', recipient: uid, outcome: 'delivered' });
    }
    const student = await User.findById(a.userId, { fullName: 1 }).lean();
    for (const to of new Set(emails)) {
      await sendEmail('sos_alert', to, {
        alertNumber: a.alertNumber, time: a.createdAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }), studentName: student?.fullName ?? 'Student',
        locationText: a.latitude != null ? `${a.latitude.toFixed(5)}, ${a.longitude!.toFixed(5)}` : 'Unavailable', link: appLink(`/security/alerts/${a._id}`),
      }, `sos-esc:${a._id}:${level}:${to}`);
    }
    await recordSosEvent(a._id, level === 1 ? 'escalated_backup' : 'escalated_admins', { actorLabel: level === 1 ? 'Backup responders alerted' : 'Administrators alerted' });
    emitToRoom('responders:all', 'sos:updated', { id: String(a._id), status: a.status, escalationLevel: level });
    emitToRoom(`sos:${a._id}`, 'sos:updated', { id: String(a._id), status: a.status, escalationLevel: level });
    await audit({ action: 'sos.escalated', targetType: 'sos', targetId: String(a._id), meta: { level, recipients: recipients.length + emails.length } });
    escalated++;
  }
  return escalated;
}

registerPeriodic('sos-escalation', 15_000, async () => {
  await runSosEscalation();
});
