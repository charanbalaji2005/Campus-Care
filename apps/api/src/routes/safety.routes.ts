import { Router } from 'express';
import { Types } from 'mongoose';
import {
  SOS_ACTIVE_STATUSES, checkInSchema, hasPermission, locationShareSchema, locationUpdateSchema, safeWalkStartSchema, sosCreateSchema, sosNoteSchema, sosResolveSchema,
  trustedContactSchema, type Role,
} from '@campuscare/shared';
import { z } from 'zod';
import { AppError, asyncHandler, notFound, ok, parse } from '../lib/http';
import { decryptSecret, randomToken, sha256 } from '../lib/crypto';
import { AlertDeliveryEvent, CampusAlert, EmergencyAlert, LocationShare, SafeWalkSession, SafetyCheckIn, TrustedContact } from '../models/safety';
import { ContactConsentToken, User } from '../models/user';
import { requireAuth, requirePermission } from '../middleware/auth';
import { authLimiter, sosLimiter } from '../middleware/security';
import { raiseSos, serializeAlert } from '../services/safety.service';
import { getSettings } from '../services/settings.service';
import { audit } from '../services/audit.service';
import { notify } from '../services/notification.service';
import { appLink, sendEmail } from '../services/email/email.service';
import { emitToRoom } from '../realtime/socket';

export const safetyRouter = Router();

// ------------------------------------------------------------------ public: trusted-contact consent (link from email)
safetyRouter.post(
  '/trusted-contacts/consent',
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = parse(z.object({ token: z.string().min(20).max(200), decision: z.enum(['accept', 'decline']) }), req.body);
    const doc = await ContactConsentToken.findOneAndUpdate({ tokenHash: sha256(input.token), consumedAt: null, expiresAt: { $gt: new Date() } }, { $set: { consumedAt: new Date() } }, { new: true });
    if (!doc) throw new AppError(400, 'invalid_token', 'This link is invalid or has expired.');
    const contact = await TrustedContact.findById(doc.trustedContactId);
    if (!contact || contact.status !== 'pending') throw new AppError(400, 'invalid_token', 'This request is no longer pending.');
    contact.status = input.decision === 'accept' ? 'verified' : 'declined';
    contact.verifiedAt = input.decision === 'accept' ? new Date() : null;
    await contact.save();
    await notify({ userId: String(contact.userId), kind: 'trusted_contact', priority: 'high', title: `${contact.name} ${input.decision === 'accept' ? 'accepted' : 'declined'}`, body: input.decision === 'accept' ? 'They can now receive your safety notifications.' : 'They will not receive safety notifications.', link: '/student/trusted-contacts' });
    ok(res, { status: contact.status });
  }),
);

safetyRouter.use(requireAuth);

// ------------------------------------------------------------------ SOS (student)
safetyRouter.post(
  '/sos',
  sosLimiter,
  requirePermission('sos:raise'),
  asyncHandler(async (req, res) => {
    const settings = await getSettings();
    if (!settings.sos.enabled) throw new AppError(503, 'sos_disabled', 'In-app SOS is unavailable. Call 112 or campus security now.');
    const input = parse(sosCreateSchema, req.body);
    try {
      const alert = await raiseSos(String(req.user!._id), input);
      ok(res, serializeAlert(alert, false), 201);
    } catch (err) {
      if ((err as Error).message === 'conflict') throw new AppError(409, 'conflict', 'Duplicate alert key.');
      throw err;
    }
  }),
);

safetyRouter.get(
  '/sos/mine',
  asyncHandler(async (req, res) => {
    const list = await EmergencyAlert.find({ userId: req.user!._id }).sort({ createdAt: -1 }).limit(20).lean();
    ok(res, list.map((a) => serializeAlert(a as never, false)));
  }),
);

const isResponder = (u: Express.Request['user']) => Boolean(u) && hasPermission({ role: u!.role as Role, permissions: u!.permissions }, 'sos:respond');

async function responderView(a: Record<string, unknown> & { _id: unknown; userId: unknown; acknowledgedBy?: unknown; assignedTo?: unknown }, viewerId: string) {
  const student = await User.findById(a.userId, { fullName: 1, phone: 1, studentId: 1, hostel: 1, department: 1, safetyCardShare: 1 }).select('+safetyCardEnc').lean();
  const ackBy = a.acknowledgedBy ? await User.findById(a.acknowledgedBy, { fullName: 1, phone: 1 }).lean() : null;
  const deliveries = await AlertDeliveryEvent.find({ alertId: a._id }).sort({ createdAt: 1 }).lean();
  // The digital safety card is shown only with the student's explicit consent, and only while the SOS is open.
  const open = (SOS_ACTIVE_STATUSES as readonly string[]).includes(String(a.status));
  const card = open && student?.safetyCardShare && student.safetyCardEnc ? JSON.parse(decryptSecret(student.safetyCardEnc)) : null;
  return {
    ...serializeAlert(a as never, true, student ? { fullName: student.fullName, phone: student.phone, studentId: student.studentId, hostel: student.hostel } : undefined),
    acknowledgedByName: ackBy?.fullName ?? null,
    assignedToMe: a.assignedTo ? String(a.assignedTo) === viewerId : false,
    safetyCard: card,
    deliveries: deliveries.map((d) => ({ channel: d.channel, outcome: d.outcome, recipient: d.channel === 'email' ? d.recipient : undefined, at: d.createdAt })),
    respondersReached: deliveries.filter((d) => d.channel === 'in_app' && d.outcome === 'delivered').length,
  };
}

safetyRouter.get(
  '/sos/:id',
  asyncHandler(async (req, res) => {
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const a = await EmergencyAlert.findById(req.params.id).lean();
    if (!a) throw notFound();
    const own = String(a.userId) === String(req.user!._id);
    if (!own) throw notFound(); // responders use /responder/alerts/:id (audited)
    const ackBy = a.acknowledgedBy ? await User.findById(a.acknowledgedBy, { fullName: 1 }).lean() : null;
    const reached = await AlertDeliveryEvent.countDocuments({ alertId: a._id, channel: 'in_app', outcome: 'delivered' });
    ok(res, {
      ...serializeAlert(a as never, false),
      acknowledgedByName: ackBy ? ackBy.fullName.split(' ')[0] + ' (Campus Security)' : null,
      respondersReached: reached,
    });
  }),
);

safetyRouter.post(
  '/sos/:id/cancel',
  asyncHandler(async (req, res) => {
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const settings = await getSettings();
    const a = await EmergencyAlert.findOne({ _id: req.params.id, userId: req.user!._id });
    if (!a) throw notFound();
    if (['resolved', 'cancelled'].includes(a.status)) return ok(res, serializeAlert(a, false));
    if (!settings.sos.allowCancelAfterSend && a.status !== 'queued') throw new AppError(409, 'cannot_cancel', 'This alert can no longer be cancelled. Call campus security to tell them you are safe.');
    const dispatched = a.status !== 'queued';
    a.status = 'cancelled';
    a.cancelledAt = new Date();
    // A cancellation after dispatch is recorded, never erased: responders still see the history.
    a.events.push({ type: dispatched ? 'cancelled_after_dispatch' : 'cancelled', at: new Date(), actorLabel: 'Student', note: typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 300) : null, studentVisible: true } as never);
    await a.save();
    emitToRoom('responders:all', 'sos:updated', { id: String(a._id), status: 'cancelled' });
    emitToRoom(`sos:${a._id}`, 'sos:updated', { id: String(a._id), status: 'cancelled' });
    if (dispatched && a.acknowledgedBy) {
      await notify({ userId: String(a.acknowledgedBy), kind: 'sos', priority: 'critical', title: `SOS ${a.alertNumber} cancelled by student`, body: 'The student marked themselves safe. Confirm before standing down.', link: `/security/alerts/${a._id}` });
    }
    await audit({ action: 'sos.cancelled', req, targetType: 'sos', targetId: String(a._id), meta: { afterDispatch: dispatched } });
    ok(res, serializeAlert(a, false));
  }),
);

// ------------------------------------------------------------------ SOS (responders)
safetyRouter.get(
  '/responder/alerts',
  requirePermission('sos:respond'),
  asyncHandler(async (req, res) => {
    const active = req.query.all === 'true' ? {} : { status: { $in: [...SOS_ACTIVE_STATUSES] } };
    const list = await EmergencyAlert.find(active).sort({ createdAt: -1 }).limit(100).lean();
    const students = await User.find({ _id: { $in: list.map((a) => a.userId) } }, { fullName: 1, phone: 1, studentId: 1, hostel: 1 }).lean();
    const map = new Map(students.map((s) => [String(s._id), s]));
    ok(res, list.map((a) => {
      const s = map.get(String(a.userId));
      return { ...serializeAlert(a as never, true, s ? { fullName: s.fullName, phone: s.phone, studentId: s.studentId, hostel: s.hostel } : undefined), assignedToMe: a.assignedTo ? String(a.assignedTo) === String(req.user!._id) : false };
    }));
  }),
);

safetyRouter.get(
  '/responder/alerts/:id',
  requirePermission('sos:respond'),
  asyncHandler(async (req, res) => {
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const a = await EmergencyAlert.findById(req.params.id).lean();
    if (!a) throw notFound();
    await audit({ action: 'sos.viewed', req, targetType: 'sos', targetId: String(a._id), meta: { location: a.latitude != null } });
    const view = await responderView(a as never, String(req.user!._id));
    // Every responder view of the safety card appears in the student's privacy dashboard.
    if (view.safetyCard) await audit({ action: 'safety_card.viewed', req, targetType: 'user', targetId: String(a.userId), meta: { alert: a.alertNumber } });
    ok(res, view);
  }),
);

async function afterResponderChange(a: { _id: unknown; userId: unknown; status: string }, extra: Record<string, unknown> = {}) {
  emitToRoom(`sos:${a._id}`, 'sos:updated', { id: String(a._id), status: a.status, ...extra });
  emitToRoom('responders:all', 'sos:updated', { id: String(a._id), status: a.status });
}

safetyRouter.post(
  '/responder/alerts/:id/acknowledge',
  requirePermission('sos:respond'),
  asyncHandler(async (req, res) => {
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const name = req.user!.fullName.split(' ')[0];
    // Atomic: the first responder to acknowledge owns the response.
    const a = await EmergencyAlert.findOneAndUpdate(
      { _id: req.params.id, status: { $in: ['queued', 'sending', 'sent', 'failed'] } },
      {
        $set: { status: 'acknowledged', acknowledgedBy: req.user!._id, acknowledgedAt: new Date(), assignedTo: req.user!._id },
        $push: { events: { type: 'acknowledged', at: new Date(), actorId: req.user!._id, actorLabel: `${name} (Campus Security)`, studentVisible: true } },
      },
      { new: true },
    );
    if (!a) throw new AppError(409, 'already_handled', 'This alert was already acknowledged, resolved or cancelled.');
    await audit({ action: 'sos.acknowledged', req, targetType: 'sos', targetId: String(a._id), meta: { secondsToAck: Math.round((a.acknowledgedAt!.getTime() - a.createdAt.getTime()) / 1000) } });
    await notify({ userId: String(a.userId), kind: 'sos', priority: 'critical', title: 'Help is responding', body: `${name} from Campus Security acknowledged your SOS.`, link: `/student/emergency?alert=${a._id}` });
    await afterResponderChange(a, { acknowledgedByName: `${name} (Campus Security)` });
    ok(res, await responderView(a.toObject() as never, String(req.user!._id)));
  }),
);

safetyRouter.post(
  '/responder/alerts/:id/en-route',
  requirePermission('sos:respond'),
  asyncHandler(async (req, res) => {
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const name = req.user!.fullName.split(' ')[0];
    const a = await EmergencyAlert.findOneAndUpdate(
      { _id: req.params.id, status: 'acknowledged' },
      { $set: { status: 'en_route', enRouteAt: new Date(), assignedTo: req.user!._id }, $push: { events: { type: 'en_route', at: new Date(), actorId: req.user!._id, actorLabel: `${name} (Campus Security)`, studentVisible: true } } },
      { new: true },
    );
    if (!a) throw new AppError(409, 'invalid_state', 'Acknowledge the alert first.');
    await audit({ action: 'sos.en_route', req, targetType: 'sos', targetId: String(a._id) });
    await notify({ userId: String(a.userId), kind: 'sos', priority: 'critical', title: 'A responder is on the way', body: `${name} from Campus Security is heading to you.`, link: `/student/emergency?alert=${a._id}` });
    await afterResponderChange(a);
    ok(res, await responderView(a.toObject() as never, String(req.user!._id)));
  }),
);

safetyRouter.post(
  '/responder/alerts/:id/assign',
  requirePermission('sos:respond'),
  asyncHandler(async (req, res) => {
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const input = parse(z.object({ userId: z.string().regex(/^[a-f0-9]{24}$/i) }), req.body);
    const target = await User.findOne({ _id: input.userId, accountStatus: 'active' }, { fullName: 1, role: 1, permissions: 1 });
    if (!target || !hasPermission({ role: target.role as Role, permissions: target.permissions }, 'sos:respond')) throw new AppError(422, 'validation_failed', 'Choose an active responder.');
    const a = await EmergencyAlert.findOneAndUpdate(
      { _id: req.params.id, status: { $in: ['acknowledged', 'en_route'] } },
      { $set: { assignedTo: target._id }, $push: { events: { type: 'reassigned', at: new Date(), actorId: req.user!._id, actorLabel: req.user!.fullName, note: `Assigned to ${target.fullName}`, studentVisible: false } } },
      { new: true },
    );
    if (!a) throw new AppError(409, 'invalid_state', 'Only acknowledged alerts can be reassigned.');
    await notify({ userId: String(target._id), kind: 'sos', priority: 'critical', title: `You now own SOS ${a.alertNumber}`, body: 'Open the alert for location and details.', link: `/security/alerts/${a._id}` });
    await audit({ action: 'sos.reassigned', req, targetType: 'sos', targetId: String(a._id), meta: { to: String(target._id) } });
    await afterResponderChange(a);
    ok(res, await responderView(a.toObject() as never, String(req.user!._id)));
  }),
);

safetyRouter.post(
  '/responder/alerts/:id/notes',
  requirePermission('sos:respond'),
  asyncHandler(async (req, res) => {
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const { note } = parse(sosNoteSchema, req.body);
    const a = await EmergencyAlert.findByIdAndUpdate(req.params.id, { $push: { events: { type: 'note', at: new Date(), actorId: req.user!._id, actorLabel: req.user!.fullName, note, studentVisible: false } } }, { new: true });
    if (!a) throw notFound();
    await audit({ action: 'sos.note_added', req, targetType: 'sos', targetId: String(a._id) });
    emitToRoom('responders:all', 'sos:updated', { id: String(a._id), status: a.status });
    ok(res, await responderView(a.toObject() as never, String(req.user!._id)));
  }),
);

safetyRouter.post(
  '/responder/alerts/:id/resolve',
  requirePermission('sos:respond'),
  asyncHandler(async (req, res) => {
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const input = parse(sosResolveSchema, { outcome: req.body?.outcome ?? 'other', note: req.body?.note || undefined });
    const a = await EmergencyAlert.findOneAndUpdate(
      { _id: req.params.id, status: { $in: ['acknowledged', 'en_route', 'sent', 'failed', 'cancelled'] }, resolvedAt: null },
      {
        $set: { status: 'resolved', resolvedAt: new Date(), resolvedBy: req.user!._id, resolutionOutcome: input.outcome },
        $push: { events: { type: 'resolved', at: new Date(), actorId: req.user!._id, actorLabel: req.user!.fullName.split(' ')[0] + ' (Campus Security)', note: input.note ?? null, studentVisible: true } },
      },
      { new: true },
    );
    if (!a) throw new AppError(409, 'invalid_state', 'This alert is already resolved.');
    await audit({ action: 'sos.resolved', req, targetType: 'sos', targetId: String(a._id), meta: { outcome: input.outcome, hasNote: Boolean(input.note) } });
    await notify({ userId: String(a.userId), kind: 'sos', priority: 'high', title: `SOS ${a.alertNumber} resolved`, body: 'Campus Security closed your emergency alert. Reach out if you still need help.', link: `/student/emergency?alert=${a._id}` });
    await afterResponderChange(a);
    ok(res, await responderView(a.toObject() as never, String(req.user!._id)));
  }),
);

safetyRouter.get(
  '/responder/team',
  requirePermission('sos:respond'),
  asyncHandler(async (_req, res) => {
    const staff = await User.find({ role: 'security_officer', accountStatus: 'active' }, { fullName: 1, phone: 1 }).sort({ fullName: 1 }).lean();
    ok(res, staff.map((s) => ({ id: String(s._id), name: s.fullName, phone: s.phone })));
  }),
);

safetyRouter.get(
  '/responder/locations',
  requirePermission('safety:responder_view'),
  asyncHandler(async (req, res) => {
    const shares = await LocationShare.find({ audience: 'security', stoppedAt: null, expiresAt: { $gt: new Date() } }).lean();
    const users = await User.find({ _id: { $in: shares.map((s) => s.userId) } }, { fullName: 1, phone: 1 }).lean();
    const map = new Map(users.map((u) => [String(u._id), u]));
    await audit({ action: 'location.responder_view', req, meta: { count: shares.length } });
    ok(res, shares.map((s) => ({ id: String(s._id), student: map.get(String(s.userId))?.fullName, phone: map.get(String(s.userId))?.phone, latitude: s.latitude, longitude: s.longitude, accuracyMeters: s.accuracyMeters, updatedAt: s.updatedAt, expiresAt: s.expiresAt })));
  }),
);

safetyRouter.get(
  '/responder/safe-walks',
  requirePermission('safety:responder_view'),
  asyncHandler(async (_req, res) => {
    const walks = await SafeWalkSession.find({ status: { $in: ['overdue', 'escalated'] } }).sort({ expectedArrivalAt: 1 }).limit(50).lean();
    const users = await User.find({ _id: { $in: walks.map((w) => w.userId) } }, { fullName: 1, phone: 1 }).lean();
    const map = new Map(users.map((u) => [String(u._id), u]));
    ok(res, walks.map((w) => ({ id: String(w._id), student: map.get(String(w.userId))?.fullName, phone: map.get(String(w.userId))?.phone, destination: w.destination, expectedArrivalAt: w.expectedArrivalAt, status: w.status })));
  }),
);

// ------------------------------------------------------------------ trusted contacts
safetyRouter.get(
  '/trusted-contacts',
  asyncHandler(async (req, res) => {
    const list = await TrustedContact.find({ userId: req.user!._id, status: { $ne: 'revoked' } }).sort({ createdAt: 1 }).lean();
    ok(res, list.map((c) => ({ id: String(c._id), name: c.name, email: c.email, phone: c.phone, relationship: c.relationship, shareLocation: c.shareLocation, status: c.status })));
  }),
);

safetyRouter.post(
  '/trusted-contacts',
  requirePermission('safety:self'),
  asyncHandler(async (req, res) => {
    const input = parse(trustedContactSchema, req.body);
    if (input.email === req.user!.email) throw new AppError(422, 'validation_failed', 'Add someone other than yourself.', { fields: { email: 'Use another person’s email' } });
    const count = await TrustedContact.countDocuments({ userId: req.user!._id, status: { $in: ['pending', 'verified'] } });
    if (count >= 5) throw new AppError(422, 'limit', 'You can have up to 5 trusted contacts.');
    const contact = await TrustedContact.findOneAndUpdate(
      { userId: req.user!._id, email: input.email },
      { $set: { ...input, phone: input.phone || null, status: 'pending', verifiedAt: null } },
      { upsert: true, new: true },
    );
    const token = randomToken(32);
    await ContactConsentToken.create({ userId: req.user!._id, trustedContactId: contact._id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 7 * 86400_000) });
    await sendEmail('trusted_contact_consent', input.email, { name: input.name, studentName: req.user!.fullName, link: appLink(`/trusted-contact?token=${encodeURIComponent(token)}`) });
    await audit({ action: 'trusted_contact.added', req, targetType: 'trusted_contact', targetId: String(contact._id) });
    ok(res, { id: String(contact._id), status: contact.status }, 201);
  }),
);

safetyRouter.delete(
  '/trusted-contacts/:id',
  asyncHandler(async (req, res) => {
    await TrustedContact.updateOne({ _id: req.params.id, userId: req.user!._id }, { $set: { status: 'revoked' } });
    ok(res, { ok: true });
  }),
);

// ------------------------------------------------------------------ Safe Walk
safetyRouter.get(
  '/safe-walk',
  asyncHandler(async (req, res) => {
    const list = await SafeWalkSession.find({ userId: req.user!._id }).sort({ createdAt: -1 }).limit(10).lean();
    ok(res, list.map((w) => ({ id: String(w._id), destination: w.destination, expectedArrivalAt: w.expectedArrivalAt, status: w.status, arrivedAt: w.arrivedAt, checkIns: w.checkIns, trustedContactIds: w.trustedContactIds.map(String), createdAt: w.createdAt })));
  }),
);

safetyRouter.post(
  '/safe-walk',
  requirePermission('safety:self'),
  asyncHandler(async (req, res) => {
    const s = await getSettings();
    if (!s.safeWalk.enabled) throw new AppError(403, 'disabled', 'Safe Walk is turned off.');
    const input = parse(safeWalkStartSchema, req.body);
    const arrival = new Date(input.expectedArrivalAt);
    if (arrival.getTime() < Date.now() + 2 * 60_000 || arrival.getTime() > Date.now() + 6 * 3600_000) throw new AppError(422, 'validation_failed', 'Choose an arrival time between 2 minutes and 6 hours from now.', { fields: { expectedArrivalAt: 'Between 2 minutes and 6 hours from now' } });
    const active = await SafeWalkSession.exists({ userId: req.user!._id, status: { $in: ['active', 'overdue'] } });
    if (active) throw new AppError(409, 'active_walk', 'Finish your current Safe Walk first.');
    const contacts = await TrustedContact.find({ _id: { $in: input.trustedContactIds }, userId: req.user!._id, status: 'verified' }).lean();
    const walk = await SafeWalkSession.create({ userId: req.user!._id, destination: input.destination, expectedArrivalAt: arrival, trustedContactIds: contacts.map((c) => c._id) });
    await audit({ action: 'safe_walk.started', req, targetType: 'safe_walk', targetId: String(walk._id), meta: { contacts: contacts.length } });
    ok(res, { id: String(walk._id), status: walk.status, verifiedContacts: contacts.length }, 201);
  }),
);

safetyRouter.post(
  '/safe-walk/:id/:action',
  asyncHandler(async (req, res) => {
    const action = req.params.action;
    if (!['check-in', 'arrived', 'cancel', 'extend'].includes(action)) throw notFound();
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const walk = await SafeWalkSession.findOne({ _id: req.params.id, userId: req.user!._id });
    if (!walk) throw notFound();
    if (!['active', 'overdue', 'escalated'].includes(walk.status)) throw new AppError(409, 'finished', 'This Safe Walk has finished.');
    if (action === 'check-in') {
      walk.checkIns.push({ at: new Date(), note: typeof req.body?.note === 'string' ? req.body.note.slice(0, 120) : undefined });
      if (walk.status === 'overdue') walk.status = 'active';
    } else if (action === 'extend') {
      const minutes = Math.min(120, Math.max(5, Number(req.body?.minutes) || 15));
      walk.expectedArrivalAt = new Date(Math.max(walk.expectedArrivalAt.getTime(), Date.now()) + minutes * 60_000);
      walk.status = 'active';
    } else if (action === 'arrived') {
      walk.status = 'arrived';
      walk.arrivedAt = new Date();
    } else {
      walk.status = 'cancelled';
    }
    await walk.save();
    await audit({ action: `safe_walk.${action}`, req, targetType: 'safe_walk', targetId: String(walk._id) });
    ok(res, { id: String(walk._id), status: walk.status, expectedArrivalAt: walk.expectedArrivalAt });
  }),
);

// ------------------------------------------------------------------ live location sharing (consent, time-limited)
safetyRouter.get(
  '/location-share',
  asyncHandler(async (req, res) => {
    const s = await LocationShare.findOne({ userId: req.user!._id, stoppedAt: null, expiresAt: { $gt: new Date() } }).lean();
    ok(res, s ? { id: String(s._id), audience: s.audience, startedAt: s.startedAt, expiresAt: s.expiresAt, updatedAt: s.updatedAt } : null);
  }),
);

safetyRouter.post(
  '/location-share',
  requirePermission('safety:self'),
  asyncHandler(async (req, res) => {
    const settings = await getSettings();
    if (!settings.locationSharing.enabled) throw new AppError(403, 'disabled', 'Location sharing is turned off.');
    const input = parse(locationShareSchema, req.body);
    if (input.durationMinutes > settings.locationSharing.maxDurationMinutes) throw new AppError(422, 'validation_failed', `Share for at most ${settings.locationSharing.maxDurationMinutes} minutes.`);
    await LocationShare.updateMany({ userId: req.user!._id, stoppedAt: null }, { $set: { stoppedAt: new Date() } });
    const expiresAt = new Date(Date.now() + input.durationMinutes * 60_000);
    const share = await LocationShare.create({
      userId: req.user!._id, audience: input.audience, latitude: input.latitude, longitude: input.longitude, accuracyMeters: input.accuracyMeters ?? null,
      expiresAt, purgeAt: new Date(expiresAt.getTime() + settings.locationSharing.retentionHours * 3600_000),
    });
    await audit({ action: 'location.share_started', req, targetType: 'location_share', targetId: String(share._id), meta: { audience: input.audience, minutes: input.durationMinutes } });
    ok(res, { id: String(share._id), expiresAt }, 201);
  }),
);

safetyRouter.patch(
  '/location-share/:id',
  asyncHandler(async (req, res) => {
    const input = parse(locationUpdateSchema, req.body);
    const share = await LocationShare.findOneAndUpdate(
      { _id: req.params.id, userId: req.user!._id, stoppedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { latitude: input.latitude, longitude: input.longitude, accuracyMeters: input.accuracyMeters ?? null } },
      { new: true },
    );
    if (!share) throw new AppError(410, 'expired', 'Location sharing has ended.');
    if (share.audience === 'security') emitToRoom('responders:all', 'location:update', { id: String(share._id), latitude: share.latitude, longitude: share.longitude });
    ok(res, { ok: true });
  }),
);

safetyRouter.post(
  '/location-share/:id/stop',
  asyncHandler(async (req, res) => {
    await LocationShare.updateOne({ _id: req.params.id, userId: req.user!._id, stoppedAt: null }, { $set: { stoppedAt: new Date() } });
    await audit({ action: 'location.share_stopped', req, targetType: 'location_share', targetId: req.params.id });
    ok(res, { ok: true });
  }),
);

// ------------------------------------------------------------------ campus alerts and safety check-ins
safetyRouter.get(
  '/campus-alerts',
  asyncHandler(async (req, res) => {
    const u = req.user!;
    const now = new Date();
    const alerts = await CampusAlert.find({
      $and: [
        { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
        { $or: [{ 'audience.all': true }, { 'audience.hostels': u.hostel ?? '__none__' }, { 'audience.departments': u.department ?? '__none__' }] },
      ],
    }).sort({ createdAt: -1 }).limit(20).lean();
    const checks = await SafetyCheckIn.find({ userId: u._id, alertId: { $in: alerts.map((a) => a._id) } }).lean();
    const checked = new Map(checks.map((c) => [String(c.alertId), c.status]));
    ok(res, alerts.map((a) => ({ id: String(a._id), title: a.title, body: a.body, severity: a.severity, requestCheckIn: a.requestCheckIn, createdAt: a.createdAt, expiresAt: a.expiresAt, myCheckIn: checked.get(String(a._id)) ?? null })));
  }),
);

safetyRouter.post(
  '/campus-alerts/:id/check-in',
  asyncHandler(async (req, res) => {
    const input = parse(checkInSchema, req.body);
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const alert = await CampusAlert.findOne({ _id: req.params.id, requestCheckIn: true }).lean();
    if (!alert) throw notFound();
    await SafetyCheckIn.findOneAndUpdate({ alertId: alert._id, userId: req.user!._id }, { $set: { status: input.status, note: input.note ?? null } }, { upsert: true });
    if (input.status === 'need_help') {
      const officers = await User.find({ role: 'security_officer', accountStatus: 'active' }, { _id: 1 }).lean();
      for (const o of officers) await notify({ userId: String(o._id), kind: 'check_in', priority: 'critical', title: 'Student needs help', body: `${req.user!.fullName} responded "need help" to "${alert.title}".`, link: '/security/alerts' });
    }
    await audit({ action: 'campus_alert.check_in', req, targetType: 'campus_alert', targetId: String(alert._id), meta: { status: input.status } });
    ok(res, { ok: true });
  }),
);
