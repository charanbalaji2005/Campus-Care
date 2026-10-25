import { Router } from 'express';
import { NOTIFICATION_CATEGORIES, dataRequestSchema, notificationPrefsSchema, safetyCardSchema } from '@campuscare/shared';
import { AppError, asyncHandler, ok, parse } from '../lib/http';
import { anonymousReporterTag, decryptSecret, encryptSecret } from '../lib/crypto';
import { ExternalIdentity, Session, User, publicUser } from '../models/user';
import { Incident } from '../models/incident';
import { Appointment } from '../models/counselling';
import { EmergencyAlert, LocationShare, SafeWalkSession, TrustedContact } from '../models/safety';
import { AuditLog } from '../models/platform';
import { DataRequest, HazardReport, LostFoundItem } from '../models/community';
import { Notification, TrainingProgress } from '../models/content';
import { requireAuth } from '../middleware/auth';
import { audit } from '../services/audit.service';

/** The signed-in user's own data: safety card, notification preferences, privacy dashboard, export. */
export const meRouter = Router();
meRouter.use(requireAuth);

// ------------------------------------------------------------------ digital safety card (encrypted, consent-based)
meRouter.get(
  '/safety-card',
  asyncHandler(async (req, res) => {
    const u = await User.findById(req.user!._id).select('+safetyCardEnc').lean();
    const card = u?.safetyCardEnc ? JSON.parse(decryptSecret(u.safetyCardEnc)) : safetyCardSchema.parse({});
    ok(res, { ...card, shareWithResponders: Boolean(u?.safetyCardShare), updatedAt: u?.safetyCardUpdatedAt ?? null });
  }),
);

meRouter.put(
  '/safety-card',
  asyncHandler(async (req, res) => {
    const input = parse(safetyCardSchema, req.body);
    const { shareWithResponders, ...card } = input;
    await User.updateOne(
      { _id: req.user!._id },
      { $set: { safetyCardEnc: encryptSecret(JSON.stringify(card)), safetyCardShare: shareWithResponders, safetyCardUpdatedAt: new Date() } },
    );
    await audit({ action: 'safety_card.updated', req, targetType: 'user', targetId: String(req.user!._id), meta: { shareWithResponders } });
    ok(res, { ...card, shareWithResponders, updatedAt: new Date() });
  }),
);

meRouter.delete(
  '/safety-card',
  asyncHandler(async (req, res) => {
    await User.updateOne({ _id: req.user!._id }, { $set: { safetyCardEnc: null, safetyCardShare: false, safetyCardUpdatedAt: new Date() } });
    await audit({ action: 'safety_card.deleted', req, targetType: 'user', targetId: String(req.user!._id) });
    ok(res, { ok: true });
  }),
);

// ------------------------------------------------------------------ notification preferences
function fullPrefs(stored: Record<string, { inApp?: boolean; email?: boolean; push?: boolean }> | undefined) {
  return Object.fromEntries(NOTIFICATION_CATEGORIES.map((c) => [c, { inApp: stored?.[c]?.inApp !== false, email: stored?.[c]?.email !== false, push: stored?.[c]?.push !== false }]));
}

meRouter.get('/notification-prefs', asyncHandler(async (req, res) => ok(res, fullPrefs(req.user!.notificationPrefs as never))));

meRouter.put(
  '/notification-prefs',
  asyncHandler(async (req, res) => {
    const input = parse(notificationPrefsSchema, req.body);
    const merged = fullPrefs({ ...(req.user!.notificationPrefs as object), ...input } as never);
    await User.updateOne({ _id: req.user!._id }, { $set: { notificationPrefs: merged } });
    ok(res, merged);
  }),
);

// ------------------------------------------------------------------ privacy dashboard
const ACCESS_LABELS: Record<string, string> = {
  'incident.viewed': 'Your case was opened by the case team',
  'incident.status_changed': 'Your case status was updated',
  'evidence.accessed': 'Evidence on your case was downloaded',
  'sos.viewed': 'Your SOS alert (with location, if shared) was opened by Campus Security',
  'counselling.student_viewed': 'Your counselling history was opened by your counsellor',
  'counselling_notes.viewed': 'Session notes were opened',
  'safety_card.viewed': 'Your safety card was viewed by a responder during your SOS',
};

meRouter.get(
  '/privacy',
  asyncHandler(async (req, res) => {
    const uid = req.user!._id;
    const tag = anonymousReporterTag(String(uid));
    const [cases, alerts, appts, shares, walk, google, sessions, contacts, me] = await Promise.all([
      Incident.find({ $or: [{ reporterId: uid }, { reporterTag: tag }] }, { _id: 1, caseNumber: 1 }).lean(),
      EmergencyAlert.find({ userId: uid }, { _id: 1, alertNumber: 1 }).lean(),
      Appointment.find({ studentId: uid }, { _id: 1 }).lean(),
      LocationShare.find({ userId: uid, stoppedAt: null, expiresAt: { $gt: new Date() } }).lean(),
      SafeWalkSession.findOne({ userId: uid, status: { $in: ['active', 'overdue', 'escalated'] } }).lean(),
      ExternalIdentity.exists({ userId: uid, provider: 'google' }),
      Session.find({ userId: uid, revokedAt: null, expiresAt: { $gt: new Date() } }, { client: 1, deviceName: 1, lastSeenAt: 1 }).lean(),
      TrustedContact.find({ userId: uid, status: { $in: ['pending', 'verified'] } }, { name: 1, status: 1, shareLocation: 1 }).lean(),
      User.findById(uid, { safetyCardShare: 1, safetyCardUpdatedAt: 1, privacy: 1 }).lean(),
    ]);
    const caseNumber = new Map(cases.map((c) => [String(c._id), c.caseNumber]));
    const alertNumber = new Map(alerts.map((a) => [String(a._id), a.alertNumber]));
    const targets = [...caseNumber.keys(), ...alertNumber.keys(), ...appts.map((a) => String(a._id)), String(uid)];
    const history = await AuditLog.find({ action: { $in: Object.keys(ACCESS_LABELS) }, targetId: { $in: targets }, actorId: { $ne: uid } }).sort({ at: -1 }).limit(50).lean();
    ok(res, {
      locationSharing: shares.map((s) => ({ id: String(s._id), audience: s.audience, startedAt: s.startedAt, expiresAt: s.expiresAt })),
      activeSafeWalk: walk ? { id: String(walk._id), destination: walk.destination, expectedArrivalAt: walk.expectedArrivalAt, status: walk.status } : null,
      linkedAccounts: { google: Boolean(google) },
      sessions: sessions.map((s) => ({ id: String(s._id), client: s.client ?? 'web', deviceName: s.deviceName ?? null, lastSeenAt: s.lastSeenAt })),
      trustedContacts: contacts.map((c) => ({ name: c.name, status: c.status, canSeeLocation: c.shareLocation })),
      safetyCard: { sharedWithResponders: Boolean(me?.safetyCardShare), updatedAt: me?.safetyCardUpdatedAt ?? null },
      communityNameVisible: me?.privacy?.showNameInCommunity !== false,
      // Who accessed your records — shown by role, never by name, as recorded in the audit log.
      accessHistory: history.map((h) => ({
        at: h.at,
        description: ACCESS_LABELS[h.action] ?? h.action,
        reference: caseNumber.get(String(h.targetId)) ?? alertNumber.get(String(h.targetId)) ?? null,
        byRole: h.actorRole ?? 'staff',
      })),
      dataRequests: await DataRequest.find({ userId: uid }).sort({ createdAt: -1 }).limit(10).lean().then((l) => l.map((d) => ({ id: String(d._id), type: d.type, status: d.status, createdAt: d.createdAt, note: d.note }))),
    });
  }),
);

// ------------------------------------------------------------------ data export & deletion requests
meRouter.get(
  '/export',
  asyncHandler(async (req, res) => {
    const uid = req.user!._id;
    const tag = anonymousReporterTag(String(uid));
    const [cases, alerts, appts, contacts, walks, notifications, training, hazards, lostFound] = await Promise.all([
      Incident.find({ $or: [{ reporterId: uid }, { reporterTag: tag }] }, { caseNumber: 1, category: 1, title: 1, description: 1, location: 1, incidentDate: 1, status: 1, anonymous: 1, createdAt: 1 }).lean(),
      EmergencyAlert.find({ userId: uid }, { alertNumber: 1, status: 1, createdAt: 1, resolvedAt: 1 }).lean(),
      Appointment.find({ studentId: uid }, { startAt: 1, endAt: 1, status: 1, mode: 1, createdAt: 1 }).lean(),
      TrustedContact.find({ userId: uid }, { name: 1, email: 1, phone: 1, relationship: 1, status: 1 }).lean(),
      SafeWalkSession.find({ userId: uid }, { destination: 1, expectedArrivalAt: 1, status: 1, createdAt: 1 }).lean(),
      Notification.find({ userId: uid }, { title: 1, body: 1, createdAt: 1 }).sort({ createdAt: -1 }).limit(500).lean(),
      TrainingProgress.find({ userId: uid }).lean(),
      HazardReport.find({ reporterId: uid }, { category: 1, description: 1, locationLabel: 1, status: 1, createdAt: 1 }).lean(),
      LostFoundItem.find({ ownerId: uid }, { type: 1, title: 1, status: 1, createdAt: 1 }).lean(),
    ]);
    await audit({ action: 'user.data_exported', req, targetType: 'user', targetId: String(uid) });
    res.setHeader('Content-Disposition', 'attachment; filename="campuscare-my-data.json"');
    res.json({
      exportedAt: new Date().toISOString(),
      note: 'Counselling session notes and internal case notes are held by the responsible service; request them through the university if needed.',
      profile: publicUser(req.user!),
      reports: cases, sosAlerts: alerts, appointments: appts, trustedContacts: contacts, safeWalks: walks, notifications, training, hazardReports: hazards, lostAndFound: lostFound,
    });
  }),
);

meRouter.post(
  '/data-requests',
  asyncHandler(async (req, res) => {
    const input = parse(dataRequestSchema, req.body);
    if (await DataRequest.exists({ userId: req.user!._id, type: input.type, status: 'pending' })) {
      throw new AppError(409, 'already_requested', 'You already have a pending request of this type.');
    }
    const d = await DataRequest.create({ userId: req.user!._id, type: input.type, reason: input.reason ?? null });
    await audit({ action: `data_request.${input.type}`, req, targetType: 'data_request', targetId: String(d._id) });
    ok(res, { id: String(d._id), status: d.status }, 201);
  }),
);
