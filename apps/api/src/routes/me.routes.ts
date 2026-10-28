import { Router } from 'express';
import {
  ACTIVE_APPOINTMENT_STATUSES, NOTIFICATION_CATEGORIES, SOS_ACTIVE_STATUSES, dataRequestSchema, notificationPrefsSchema, permissionsFor, safetyCardSchema, type Role,
} from '@campuscare/shared';
import { AppError, asyncHandler, ok, parse } from '../lib/http';
import { anonymousReporterTag, decryptSecret, encryptSecret } from '../lib/crypto';
import { ExternalIdentity, Session, User, UserAvatar, publicUser } from '../models/user';
import { Incident } from '../models/incident';
import { Appointment, Availability } from '../models/counselling';
import { DutyShift, ResponderAvailability, ResponseZone } from '../models/duty';
import { upload } from '../middleware/security';
import { sniffMime } from '../lib/sniff';
import { capacityOf } from '../lib/schedule';
import { mfaRequiredFor } from '../services/auth.service';
import { EmergencyAlert, LocationAccessAudit, LocationShare, SafeWalkSession, TrustedContact } from '../models/safety';
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

// ------------------------------------------------------------------ profile photo
const AVATAR_MAX_BYTES = 512 * 1024;
const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

meRouter.get(
  '/avatar',
  asyncHandler(async (req, res) => {
    // Not lean: a hydrated document gives the photo back as a Buffer rather than a BSON Binary.
    const a = await UserAvatar.findOne({ userId: req.user!._id });
    if (!a) throw new AppError(404, 'not_found', 'No profile photo.');
    res.setHeader('Content-Type', a.mime);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(a.data);
  }),
);

meRouter.put(
  '/avatar',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) throw new AppError(400, 'bad_request', 'Choose a photo to upload.');
    const mime = sniffMime(file.buffer);
    if (!mime || !AVATAR_TYPES.includes(mime)) throw new AppError(415, 'unsupported_type', 'Profile photos must be JPG, PNG or WEBP images.');
    if (file.size > AVATAR_MAX_BYTES) throw new AppError(413, 'too_large', 'Profile photos must be 512 KB or smaller.');
    await UserAvatar.findOneAndUpdate({ userId: req.user!._id }, { $set: { mime, data: file.buffer } }, { upsert: true });
    req.user!.avatarUpdatedAt = new Date();
    await req.user!.save();
    await audit({ action: 'user.avatar_updated', req, targetType: 'user', targetId: String(req.user!._id) });
    ok(res, { user: publicUser(req.user!) });
  }),
);

meRouter.delete(
  '/avatar',
  asyncHandler(async (req, res) => {
    await UserAvatar.deleteOne({ userId: req.user!._id });
    req.user!.avatarUpdatedAt = null;
    await req.user!.save();
    await audit({ action: 'user.avatar_removed', req, targetType: 'user', targetId: String(req.user!._id) });
    ok(res, { user: publicUser(req.user!) });
  }),
);

// ------------------------------------------------------------------ profile overview (role-specific)
const SECURITY_ACTIONS = /^(auth\.|session\.|user\.(sessions_revoked|mfa_reset|password|recovery))/;

/**
 * Everything the Profile page shows besides the user record itself, shaped by role. It holds
 * counts and statuses only: no student names, counselling content or SOS details.
 */
meRouter.get(
  '/profile',
  asyncHandler(async (req, res) => {
    const u = req.user!;
    const uid = u._id;
    const now = new Date();
    const [sessions, google, mfaRequired] = await Promise.all([
      Session.countDocuments({ userId: uid, revokedAt: null, expiresAt: { $gt: now } }),
      ExternalIdentity.exists({ userId: uid, provider: 'google' }),
      mfaRequiredFor(u),
    ]);
    const out: Record<string, unknown> = {
      account: {
        emailVerified: u.emailVerified,
        mfaEnabled: u.mfaEnabled,
        mfaRequired,
        activeSessions: sessions,
        googleLinked: Boolean(google),
        lastLoginAt: u.lastLoginAt ?? null,
        passwordChangedAt: u.passwordChangedAt ?? null,
        memberSince: (u as { createdAt?: Date }).createdAt ?? null,
      },
    };

    if (u.role === 'student') {
      const [next, upcoming, contacts, card] = await Promise.all([
        Appointment.findOne({ studentId: uid, status: { $in: ACTIVE_APPOINTMENT_STATUSES }, startAt: { $gte: now } }, { startAt: 1, mode: 1, status: 1 }).sort({ startAt: 1 }).lean(),
        Appointment.countDocuments({ studentId: uid, status: { $in: ACTIVE_APPOINTMENT_STATUSES }, $or: [{ startAt: { $gte: now } }, { startAt: null }] }),
        TrustedContact.countDocuments({ userId: uid, status: { $in: ['pending', 'verified'] } }),
        User.findById(uid, { safetyCardEnc: 1, safetyCardShare: 1 }).select('+safetyCardEnc').lean(),
      ]);
      out.student = {
        upcomingAppointments: upcoming,
        nextAppointment: next ? { startAt: next.startAt, mode: next.mode, status: next.status } : null,
        trustedContacts: contacts,
        safetyCardSet: Boolean(card?.safetyCardEnc),
        safetyCardShared: Boolean(card?.safetyCardShare),
      };
    }

    if (u.role === 'counsellor') {
      const dayAhead = new Date(now.getTime() + 24 * 3600_000);
      const [a, upcoming, pending, next24h, decided] = await Promise.all([
        Availability.findOne({ counsellorId: uid }).lean(),
        Appointment.countDocuments({ counsellorId: uid, status: { $in: ['confirmed', 'rescheduled'] }, startAt: { $gte: now } }),
        Appointment.countDocuments({ counsellorId: uid, status: 'requested' }),
        Appointment.countDocuments({ counsellorId: uid, status: { $in: ['confirmed', 'rescheduled'] }, startAt: { $gte: now, $lt: dayAhead } }),
        Appointment.find({ counsellorId: uid, status: { $ne: 'requested' }, createdAt: { $gte: new Date(now.getTime() - 30 * 86400_000) } }, { createdAt: 1, updatedAt: 1 }).limit(200).lean(),
      ]);
      const hours = decided
        .map((r) => ((r.updatedAt as Date).getTime() - (r.createdAt as Date).getTime()) / 3600_000)
        .filter((h) => h >= 0)
        .sort((x, y) => x - y);
      const today = now.toISOString().slice(0, 10);
      out.counsellor = {
        onDuty: Boolean(a?.acceptingRequests),
        title: a?.title ?? 'Counsellor',
        bio: a?.bio ?? '',
        campus: a?.campus ?? 'main',
        specializations: a?.specializations ?? [],
        languages: a?.languages ?? [],
        supportedModes: a?.supportedModes ?? [],
        slotMinutes: a?.slotMinutes ?? 50,
        maxDailySessions: a?.maxDailySessions || 10,
        workingDays: [...new Set((a?.weekly ?? []).map((w) => w.weekday as number))].sort(),
        upcomingBlockedDates: (a?.blockedDates ?? []).filter((d) => d >= today).sort().slice(0, 5),
        upcomingAppointments: upcoming,
        pendingRequests: pending,
        sessionsNext24h: next24h,
        // Median time from a request to the counsellor's decision over the last 30 days (aggregate only).
        medianResponseHours: hours.length ? Math.round(hours[Math.floor(hours.length / 2)] * 10) / 10 : null,
        decidedLast30Days: hours.length,
      };
    }

    if (u.role === 'security_officer') {
      const [avail, shift, active] = await Promise.all([
        ResponderAvailability.findOne({ userId: uid }).lean(),
        DutyShift.findOne({ responderId: uid, status: { $in: ['accepted', 'active'] }, endAt: { $gt: now } }, { startAt: 1, endAt: 1, status: 1, zoneId: 1, campus: 1 }).sort({ startAt: 1 }).lean(),
        EmergencyAlert.find({ assignedTo: uid, status: { $in: SOS_ACTIVE_STATUSES } }, { alertNumber: 1, status: 1, createdAt: 1 }).sort({ createdAt: -1 }).limit(10).lean(),
      ]);
      const zoneIds = [avail?.zoneId, shift?.zoneId].filter(Boolean);
      const zones = zoneIds.length ? await ResponseZone.find({ _id: { $in: zoneIds } }, { name: 1 }).lean() : [];
      const zoneName = (id: unknown) => (id ? zones.find((z) => String(z._id) === String(id))?.name ?? null : null);
      out.officer = {
        dutyStatus: avail?.status ?? 'off_duty',
        statusChangedAt: avail?.statusChangedAt ?? null,
        campus: avail?.campus ?? 'main',
        zone: zoneName(avail?.zoneId) ?? u.dutyZone ?? null,
        responsibilities: avail?.responsibilities ?? [],
        skills: avail?.skills ?? [],
        locationConsent: Boolean(avail?.locationConsent),
        lastHeartbeatAt: avail?.lastHeartbeatAt ?? null,
        shift: shift ? { startAt: shift.startAt, endAt: shift.endAt, status: shift.status, zone: zoneName(shift.zoneId), campus: shift.campus } : null,
        // Reference numbers and status only; student details stay on the response screen.
        activeIncidents: active.map((a) => ({ id: String(a._id), alertNumber: a.alertNumber ?? null, status: a.status, createdAt: a.createdAt })),
      };
    }

    if (u.role === 'admin' || u.role === 'super_admin') {
      const permissions = [...permissionsFor({ role: u.role as Role, permissions: u.permissions })].sort();
      const [recent, security] = await Promise.all([
        AuditLog.find({ actorId: uid, action: { $not: SECURITY_ACTIONS } }, { action: 1, at: 1, targetType: 1, outcome: 1 }).sort({ at: -1 }).limit(8).lean(),
        AuditLog.find({ $or: [{ actorId: uid }, { targetType: 'user', targetId: String(uid) }], action: SECURITY_ACTIONS }, { action: 1, at: 1, outcome: 1 }).sort({ at: -1 }).limit(10).lean(),
      ]);
      out.admin = {
        scope: u.role === 'super_admin' ? 'system' : 'campus',
        managedCampuses: u.managedCampuses ?? [],
        campusZone: u.campusZone ?? null,
        permissions,
        // Grants beyond the role's defaults (set by a Super Admin in Roles & Permissions).
        extraPermissions: (u.permissions ?? []).filter((p) => permissions.includes(p as never)),
        recentActivity: recent.map((r) => ({ action: r.action, at: r.at, targetType: r.targetType ?? null, outcome: r.outcome })),
        securityActivity: security.map((e) => ({ action: e.action, at: e.at, outcome: e.outcome })),
      };
    }

    ok(res, out);
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
      // Every time your live location or SOS position was shown to staff (map markers and opened details).
      locationAccess: await LocationAccessAudit.find({ subjectUserId: uid }).sort({ createdAt: -1 }).limit(50).lean().then((l) => l.map((x) => ({
        at: x.createdAt, byRole: x.viewerRole, kind: x.subjectType, access: x.access === 'detail' ? 'Opened your details' : 'Saw your position on the live map',
      }))),
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
