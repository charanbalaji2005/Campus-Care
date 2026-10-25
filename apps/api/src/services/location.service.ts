import type { Request } from 'express';
import { Types } from 'mongoose';
import {
  LOCATION_STALE_SECONDS, MAX_LOCATION_POINTS_PER_SUBJECT, SOS_ACTIVE_STATUSES, SOS_LOCATION_HISTORY_DAYS, classifyLocationQuality, hasPermission, type Role,
} from '@campuscare/shared';
import { AppError, forbidden, notFound } from '../lib/http';
import { EmergencyAlert, LocationAccessAudit, LocationPoint, LocationShare } from '../models/safety';
import { ResponderAvailability, ResponseZone } from '../models/duty';
import { CampusPlace } from '../models/community';
import { User, type UserDoc } from '../models/user';
import { getSettings } from './settings.service';
import { audit } from './audit.service';
import { emitToRoom } from '../realtime/socket';
import { registerPeriodic } from './jobs.service';

/**
 * Consented, time-limited location sharing and the Super Admin live map.
 *
 * - Freshness is measured with the server clock: locationAt = receive time − age reported by the device.
 * - Coordinates are never "improved": the reported accuracy travels with every point and stale
 *   points are labelled stale, not shown as current.
 * - Map markers carry no names. Opening a record's details is a separate, audited request, and
 *   every location a viewer received is written to LocationAccessAudit.
 */

const subject = (u: { role: string; permissions?: string[] }) => ({ role: u.role as Role, permissions: u.permissions ?? [] });
/** Writes closer together than this are accepted but not stored (protects battery-friendly clients from bursts). */
const MIN_UPDATE_INTERVAL_MS = 3_000;
/** A viewer re-seeing the same subject within this window is not logged again (the map polls). */
const MAP_AUDIT_DEDUPE_MS = 5 * 60_000;

function fixTime(now: Date, ageSeconds?: number) {
  return new Date(now.getTime() - Math.min(Math.max(ageSeconds ?? 0, 0), 3600) * 1000);
}

export interface FixInput {
  latitude: number; longitude: number; accuracyMeters?: number; locationAgeSeconds?: number;
  clientSeq?: number; speedMps?: number; headingDeg?: number; altitudeMeters?: number; source?: string; clientQuality?: string;
}

/** Server-side assessment of one fix: capture time on the server clock and our own quality label. */
export function assessFix(input: FixInput, now: Date, staleSeconds: number) {
  const capturedAt = fixTime(now, input.locationAgeSeconds);
  const quality = classifyLocationQuality({ accuracyMeters: input.accuracyMeters ?? null, ageSeconds: input.locationAgeSeconds ?? null }, { staleSeconds });
  return { capturedAt, quality };
}

/**
 * Appends one point to a session's history. Returns "duplicate" for a retried clientSeq, so a
 * client retrying after a lost response never creates a second point. Bounded per session.
 */
async function recordPoint(
  subjectType: 'sos' | 'share', subjectId: unknown, userId: unknown, input: FixInput,
  a: { capturedAt: Date; quality: string }, now: Date, outOfOrder: boolean, purgeAt: Date,
): Promise<'stored' | 'duplicate' | 'full'> {
  if (input.clientSeq != null && (await LocationPoint.exists({ subjectType, subjectId, clientSeq: input.clientSeq }))) return 'duplicate';
  if ((await LocationPoint.countDocuments({ subjectType, subjectId })) >= MAX_LOCATION_POINTS_PER_SUBJECT) return 'full';
  await LocationPoint.create({
    subjectType, subjectId, userId, latitude: input.latitude, longitude: input.longitude, accuracyMeters: input.accuracyMeters ?? null,
    capturedAt: a.capturedAt, receivedAt: now, ageSecondsAtReceipt: input.locationAgeSeconds ?? null, quality: a.quality,
    clientQuality: input.clientQuality ?? null, source: input.source ?? 'unknown', speedMps: input.speedMps ?? null, headingDeg: input.headingDeg ?? null,
    altitudeMeters: input.altitudeMeters ?? null, clientSeq: input.clientSeq ?? null, outOfOrder, purgeAt,
  });
  return 'stored';
}

const SOS_LOCATION_STATUSES: string[] = ['pending', ...SOS_ACTIVE_STATUSES];

/** Location history for an SOS is kept this long after the alert was raised, then purged automatically. */
export function sosHistoryPurgeAt(createdAt: Date) {
  return new Date(createdAt.getTime() + SOS_LOCATION_HISTORY_DAYS * 86400_000);
}

/** Records the location an SOS was raised with as the first point of its history (idempotent). */
export async function recordInitialSosLocation(alert: { _id: unknown; userId: unknown; latitude?: number | null; longitude?: number | null; accuracyMeters?: number | null; locationAgeSeconds?: number | null; createdAt: Date }) {
  if (alert.latitude == null || alert.longitude == null) return;
  if (await LocationPoint.exists({ subjectType: 'sos', subjectId: alert._id })) return;
  const input: FixInput = { latitude: alert.latitude, longitude: alert.longitude, accuracyMeters: alert.accuracyMeters ?? undefined, locationAgeSeconds: alert.locationAgeSeconds ?? undefined, source: 'fused', clientSeq: 0 };
  const a = assessFix(input, alert.createdAt, LOCATION_STALE_SECONDS.sos);
  await EmergencyAlert.updateOne({ _id: alert._id, locationAt: null }, { $set: { locationAt: a.capturedAt, locationQuality: a.quality, locationUpdateCount: 1, lastLocationReceivedAt: alert.createdAt, lastLocationSeq: 0 } });
  await recordPoint('sos', alert._id, alert.userId, input, a, alert.createdAt, false, sosHistoryPurgeAt(alert.createdAt));
}

/**
 * Live location from the student while their SOS is active. Only the alert's owner can send it;
 * points that arrive late (after a newer one) are kept in the history but never replace the current
 * position. Responders get the update in real time.
 */
export async function updateSosLocation(user: UserDoc, alertId: string, input: FixInput) {
  if (!Types.ObjectId.isValid(alertId)) throw notFound();
  const now = new Date();
  const alert = await EmergencyAlert.findOne({ _id: alertId, userId: user._id }, { status: 1, userId: 1, locationAt: 1, lastLocationSeq: 1, latitude: 1, createdAt: 1 }).lean();
  if (!alert) throw notFound();
  if (!SOS_LOCATION_STATUSES.includes(alert.status)) throw new AppError(410, 'sos_closed', 'This alert is closed. Location sharing for it has stopped.');
  const a = assessFix(input, now, LOCATION_STALE_SECONDS.sos);
  const outOfOrder = Boolean(alert.locationAt && a.capturedAt < alert.locationAt);
  const stored = await recordPoint('sos', alert._id, alert.userId, input, a, now, outOfOrder, sosHistoryPurgeAt(alert.createdAt));
  if (stored === 'duplicate') return { accepted: false, duplicate: true, quality: a.quality };
  if (outOfOrder) return { accepted: false, duplicate: false, outOfOrder: true, quality: a.quality };
  const hadLocation = alert.latitude != null;
  const updated = await EmergencyAlert.findOneAndUpdate(
    { _id: alert._id, status: { $in: SOS_LOCATION_STATUSES }, $or: [{ locationAt: null }, { locationAt: { $lte: a.capturedAt } }] },
    {
      $set: {
        latitude: input.latitude, longitude: input.longitude, accuracyMeters: input.accuracyMeters ?? null, locationAt: a.capturedAt,
        locationQuality: a.quality, locationSource: input.source ?? 'unknown', lastLocationReceivedAt: now, locationUnavailableReason: null,
        ...(input.clientSeq != null ? { lastLocationSeq: Math.max(input.clientSeq, alert.lastLocationSeq ?? 0) } : {}),
      },
      $inc: { locationUpdateCount: 1 },
      ...(hadLocation ? {} : { $push: { events: { type: 'location_received', at: now, actorLabel: 'CampusCare', note: 'Live location now available to responders', studentVisible: true } } }),
    },
    { new: true },
  );
  if (!updated) return { accepted: false, duplicate: false, quality: a.quality };
  const payload = { id: String(updated._id), latitude: updated.latitude, longitude: updated.longitude, accuracyMeters: updated.accuracyMeters, locationAt: updated.locationAt, locationQuality: updated.locationQuality };
  emitToRoom(`sos:${updated._id}`, 'sos:location', payload);
  emitToRoom('responders:all', 'sos:location', payload);
  emitToRoom('ops:livemap', 'livemap:changed', { kind: 'alert', id: String(updated._id) });
  return { accepted: true, duplicate: false, quality: a.quality };
}

/** Time-ordered track of an SOS for authorised responders/dispatchers. Every read is audited. */
export async function sosTrack(viewer: UserDoc, alertId: string, req?: Request) {
  if (!Types.ObjectId.isValid(alertId)) throw notFound();
  const sub = subject(viewer);
  if (!hasPermission(sub, 'sos:respond') && !hasPermission(sub, 'sos:dispatch')) throw notFound();
  const alert = await EmergencyAlert.findById(alertId, { userId: 1, status: 1, alertNumber: 1 }).lean();
  if (!alert || alert.status === 'pending') throw notFound();
  const points = await LocationPoint.find({ subjectType: 'sos', subjectId: alert._id }).sort({ capturedAt: 1 }).limit(MAX_LOCATION_POINTS_PER_SUBJECT).lean();
  await LocationAccessAudit.create({ viewerId: viewer._id, viewerRole: viewer.role, access: 'detail', subjectType: 'sos', subjectId: alert._id, subjectUserId: alert.userId, correlationId: req?.correlationId ?? null });
  await audit({ action: 'location.track_viewed', req, targetType: 'sos', targetId: String(alert._id), meta: { points: points.length } });
  return points.map((p) => ({
    latitude: p.latitude, longitude: p.longitude, accuracyMeters: p.accuracyMeters, capturedAt: p.capturedAt, receivedAt: p.receivedAt,
    quality: p.quality, source: p.source, outOfOrder: p.outOfOrder, measured: true,
  }));
}

export async function startLocationShare(
  user: UserDoc,
  input: { durationMinutes: number; audience: 'security' | 'trusted_contacts'; latitude: number; longitude: number; accuracyMeters?: number; locationAgeSeconds?: number },
  req?: Request,
) {
  const settings = await getSettings();
  if (!settings.locationSharing.enabled) throw new AppError(403, 'disabled', 'Location sharing is turned off.');
  if (input.durationMinutes > settings.locationSharing.maxDurationMinutes) throw new AppError(422, 'validation_failed', `Share for at most ${settings.locationSharing.maxDurationMinutes} minutes.`);
  await LocationShare.updateMany({ userId: user._id, stoppedAt: null }, { $set: { stoppedAt: new Date() } });
  const now = new Date();
  const expiresAt = new Date(now.getTime() + input.durationMinutes * 60_000);
  const first = assessFix(input, now, LOCATION_STALE_SECONDS.share);
  const share = await LocationShare.create({
    userId: user._id, audience: input.audience, latitude: input.latitude, longitude: input.longitude, accuracyMeters: input.accuracyMeters ?? null,
    locationAt: first.capturedAt, locationQuality: first.quality, updateCount: 1,
    expiresAt, purgeAt: new Date(expiresAt.getTime() + settings.locationSharing.retentionHours * 3600_000),
  });
  await recordPoint('share', share._id, user._id, input, first, now, false, share.purgeAt);
  await audit({ action: 'location.share_started', req, targetType: 'location_share', targetId: String(share._id), meta: { audience: input.audience, minutes: input.durationMinutes } });
  if (share.audience === 'security') emitToRoom('ops:livemap', 'livemap:changed', { kind: 'share', id: String(share._id) });
  return share;
}

export async function updateLocationShare(user: UserDoc, shareId: string, input: FixInput) {
  if (!Types.ObjectId.isValid(shareId)) throw new AppError(410, 'expired', 'Location sharing has ended.');
  const now = new Date();
  const share = await LocationShare.findOne({ _id: shareId, userId: user._id, stoppedAt: null, expiresAt: { $gt: now } });
  if (!share) throw new AppError(410, 'expired', 'Location sharing has ended.'); // consent withdrawn, expired or not yours
  const a = assessFix(input, now, LOCATION_STALE_SECONDS.share);
  // Older than the position already held (e.g. a queued point delivered late): history only.
  const outOfOrder = Boolean(share.locationAt && a.capturedAt < share.locationAt);
  // Fresh bursts closer together than MIN_UPDATE_INTERVAL_MS are accepted but not stored.
  const burst = !outOfOrder && share.updatedAt && now.getTime() - share.updatedAt.getTime() < MIN_UPDATE_INTERVAL_MS && (input.locationAgeSeconds ?? 0) < 5;
  if (burst) return share;
  const stored = await recordPoint('share', share._id, user._id, input, a, now, outOfOrder, share.purgeAt);
  if (stored === 'duplicate' || outOfOrder) return share;
  const updated = await LocationShare.findOneAndUpdate(
    { _id: share._id, stoppedAt: null, expiresAt: { $gt: now }, $or: [{ locationAt: null }, { locationAt: { $lte: a.capturedAt } }] },
    {
      $set: {
        latitude: input.latitude, longitude: input.longitude, accuracyMeters: input.accuracyMeters ?? null, locationAt: a.capturedAt,
        locationQuality: a.quality, locationSource: input.source ?? 'unknown', ...(input.clientSeq != null ? { lastLocationSeq: input.clientSeq } : {}),
      },
      $inc: { updateCount: 1 },
    },
    { new: true },
  );
  if (!updated) return share;
  if (updated.audience === 'security') {
    emitToRoom('responders:all', 'location:update', { id: String(updated._id), latitude: updated.latitude, longitude: updated.longitude, accuracyMeters: updated.accuracyMeters, locationAt: updated.locationAt, locationQuality: updated.locationQuality });
    emitToRoom('ops:livemap', 'livemap:changed', { kind: 'share', id: String(updated._id) });
  }
  return updated;
}

export async function stopLocationShare(user: UserDoc, shareId: string, req?: Request) {
  if (!Types.ObjectId.isValid(shareId)) throw notFound();
  const r = await LocationShare.updateOne({ _id: shareId, userId: user._id, stoppedAt: null }, { $set: { stoppedAt: new Date() } });
  if (r.modifiedCount) {
    await audit({ action: 'location.share_stopped', req, targetType: 'location_share', targetId: shareId });
    emitToRoom('ops:livemap', 'livemap:changed', { kind: 'share', id: shareId, stopped: true });
  }
  return { stopped: r.modifiedCount > 0 };
}

export function locationFreshness(at: Date | null | undefined, staleSeconds: number, now = Date.now()) {
  if (!at) return { ageSeconds: null as number | null, stale: true };
  const ageSeconds = Math.max(0, Math.round((now - at.getTime()) / 1000));
  return { ageSeconds, stale: ageSeconds > staleSeconds };
}

async function logMapAccess(viewer: UserDoc, entries: { subjectType: 'location_share' | 'sos' | 'responder'; subjectId: unknown; subjectUserId: unknown }[], correlationId?: string) {
  if (!entries.length) return;
  const since = new Date(Date.now() - MAP_AUDIT_DEDUPE_MS);
  const recent = await LocationAccessAudit.find({ viewerId: viewer._id, access: 'live_map', createdAt: { $gte: since }, subjectId: { $in: entries.map((e) => e.subjectId) } }, { subjectId: 1 }).lean();
  const seen = new Set(recent.map((r) => String(r.subjectId)));
  const fresh = entries.filter((e) => !seen.has(String(e.subjectId)));
  if (fresh.length) {
    await LocationAccessAudit.insertMany(fresh.map((e) => ({ viewerId: viewer._id, viewerRole: viewer.role, access: 'live_map', subjectType: e.subjectType, subjectId: e.subjectId, subjectUserId: e.subjectUserId ?? null, correlationId: correlationId ?? null })));
  }
}

/** Layers the viewer may see. The server decides; the console only hides what came back empty. */
export function liveMapLayers(u: UserDoc) {
  const sub = subject(u);
  return {
    alerts: hasPermission(sub, 'sos:dispatch') || hasPermission(sub, 'sos:respond'),
    responders: hasPermission(sub, 'duty:view') || hasPermission(sub, 'duty:manage'),
    shares: hasPermission(sub, 'location:view_live'),
  };
}

export async function liveMap(viewer: UserDoc, opts: { campus?: string; correlationId?: string }) {
  const layers = liveMapLayers(viewer);
  if (!layers.alerts && !layers.responders && !layers.shares) throw forbidden();
  const s = await getSettings();
  const staleSeconds = s.duty.staleThresholdSeconds;
  const now = Date.now();
  const campusFilter = opts.campus ? { campus: opts.campus } : {};
  const [zones, places] = await Promise.all([
    ResponseZone.find({ active: true, ...campusFilter }).lean(),
    CampusPlace.find({ active: true, verified: true }).lean(),
  ]);
  const accessLog: Parameters<typeof logMapAccess>[1] = [];

  let alerts: unknown[] = [];
  if (layers.alerts) {
    const list = await EmergencyAlert.find({ status: { $in: [...SOS_ACTIVE_STATUSES] }, latitude: { $ne: null }, ...campusFilter }).sort({ createdAt: -1 }).limit(100).lean();
    alerts = list.map((a) => {
      const at = a.locationAt ?? new Date((a.dispatchedAt ?? a.createdAt).getTime() - (a.locationAgeSeconds ?? 0) * 1000);
      accessLog.push({ subjectType: 'sos', subjectId: a._id, subjectUserId: a.userId });
      return {
        id: String(a._id), alertNumber: a.alertNumber, status: a.status, assignmentState: a.assignmentState ?? 'none', escalationLevel: a.escalationLevel ?? 0,
        latitude: a.latitude, longitude: a.longitude, accuracyMeters: a.accuracyMeters ?? null, locationAt: at,
        locationQuality: classifyLocationQuality({ accuracyMeters: a.accuracyMeters, ageSeconds: (now - at.getTime()) / 1000 }, { staleSeconds: LOCATION_STALE_SECONDS.sos }),
        locationUpdateCount: a.locationUpdateCount ?? 0,
        // Live while the app sends updates; otherwise the last fix, labelled with its age (never as current).
        ...locationFreshness(at, staleSeconds, now), zoneId: a.zoneId ? String(a.zoneId) : null, createdAt: a.createdAt,
      };
    });
  }

  let responders: unknown[] = [];
  if (layers.responders) {
    const list = await ResponderAvailability.find({ status: { $nin: ['off_duty'] }, ...campusFilter }).lean();
    const users = await User.find({ _id: { $in: list.map((r) => r.userId) } }, { fullName: 1 }).lean();
    const names = new Map(users.map((u) => [String(u._id), u.fullName]));
    responders = list.map((r) => {
      // A responder's position is shown only with their consent and while the policy allows it.
      const showPosition = s.duty.responderLocationSharing && r.locationConsent && r.location;
      const hb = locationFreshness(r.lastHeartbeatAt, staleSeconds, now);
      if (showPosition) accessLog.push({ subjectType: 'responder', subjectId: r._id, subjectUserId: r.userId });
      return {
        userId: String(r.userId), name: names.get(String(r.userId)) ?? 'Responder', status: r.status, activeAssignmentCount: r.activeAssignmentCount ?? 0,
        zoneId: r.zoneId ? String(r.zoneId) : null, heartbeatAgeSeconds: hb.ageSeconds, heartbeatStale: hb.stale,
        position: showPosition ? { latitude: r.location!.latitude, longitude: r.location!.longitude, accuracyMeters: r.location!.accuracyMeters ?? null, locationAt: r.location!.at, ...locationFreshness(r.location!.at, staleSeconds, now) } : null,
      };
    });
  }

  let shares: unknown[] = [];
  if (layers.shares) {
    const list = await LocationShare.find({ audience: 'security', stoppedAt: null, expiresAt: { $gt: new Date(now) }, latitude: { $ne: null } }).lean();
    shares = list.map((x) => {
      accessLog.push({ subjectType: 'location_share', subjectId: x._id, subjectUserId: x.userId });
      return {
        id: String(x._id), latitude: x.latitude, longitude: x.longitude, accuracyMeters: x.accuracyMeters ?? null,
        locationQuality: classifyLocationQuality({ accuracyMeters: x.accuracyMeters, ageSeconds: (now - (x.locationAt ?? x.updatedAt).getTime()) / 1000 }, { staleSeconds: LOCATION_STALE_SECONDS.share }),
        locationAt: x.locationAt ?? x.updatedAt, ...locationFreshness(x.locationAt ?? x.updatedAt, staleSeconds, now),
        startedAt: x.startedAt, expiresAt: x.expiresAt, updateCount: x.updateCount ?? 0,
      };
    });
  }

  await logMapAccess(viewer, accessLog, opts.correlationId);
  return {
    generatedAt: new Date(now).toISOString(),
    staleThresholdSeconds: staleSeconds,
    layers,
    center: { latitude: s.map.centerLatitude, longitude: s.map.centerLongitude, zoom: s.map.zoom },
    zones: zones.map((z) => ({ id: String(z._id), name: z.name, code: z.code, campus: z.campus, latitude: z.latitude, longitude: z.longitude, radiusMeters: z.radiusMeters })),
    places: places.map((p) => ({ id: String(p._id), name: p.name, kind: p.kind, latitude: p.latitude, longitude: p.longitude })),
    alerts, responders, shares,
  };
}

/** Details panel for one map record: identity and contact, audited individually. */
export async function liveMapDetail(viewer: UserDoc, kind: string, id: string, req?: Request) {
  if (!Types.ObjectId.isValid(id)) throw notFound();
  const layers = liveMapLayers(viewer);
  const log = async (subjectType: 'location_share' | 'sos' | 'responder', subjectId: unknown, subjectUserId: unknown) => {
    await LocationAccessAudit.create({ viewerId: viewer._id, viewerRole: viewer.role, access: 'detail', subjectType, subjectId, subjectUserId, correlationId: req?.correlationId ?? null });
    await audit({ action: 'location.detail_viewed', req, targetType: subjectType, targetId: String(subjectId), meta: { subjectUser: String(subjectUserId) } });
  };
  if (kind === 'share') {
    if (!layers.shares) throw notFound();
    const x = await LocationShare.findOne({ _id: id, audience: 'security' }).lean();
    if (!x) throw notFound();
    const u = await User.findById(x.userId, { fullName: 1, phone: 1, studentId: 1, hostel: 1 }).lean();
    await log('location_share', x._id, x.userId);
    return { kind, id, person: u ? { name: u.fullName, phone: u.phone ?? null, studentId: u.studentId ?? null, hostel: u.hostel ?? null } : null, startedAt: x.startedAt, expiresAt: x.expiresAt, stoppedAt: x.stoppedAt, accuracyMeters: x.accuracyMeters, locationAt: x.locationAt };
  }
  if (kind === 'alert') {
    if (!layers.alerts) throw notFound();
    const a = await EmergencyAlert.findById(id).lean();
    if (!a || a.status === 'pending') throw notFound();
    const u = await User.findById(a.userId, { fullName: 1, phone: 1, studentId: 1, hostel: 1 }).lean();
    await log('sos', a._id, a.userId);
    return { kind, id, alertNumber: a.alertNumber, status: a.status, person: u ? { name: u.fullName, phone: u.phone ?? null, studentId: u.studentId ?? null, hostel: u.hostel ?? null } : null, accuracyMeters: a.accuracyMeters, note: a.note, createdAt: a.createdAt };
  }
  if (kind === 'responder') {
    if (!layers.responders) throw notFound();
    const r = await ResponderAvailability.findOne({ userId: id }).lean();
    if (!r) throw notFound();
    const u = await User.findById(r.userId, { fullName: 1, phone: 1 }).lean();
    await log('responder', r._id, r.userId);
    return { kind, id, person: u ? { name: u.fullName, phone: u.phone ?? null } : null, status: r.status, skills: r.skills, activeAssignmentCount: r.activeAssignmentCount, lastHeartbeatAt: r.lastHeartbeatAt };
  }
  throw notFound();
}

/**
 * Escalation aid: an active SOS that still has no location 90 s after dispatch gets a responder-only
 * timeline note (call the student to confirm where they are). Dispatch itself never waits for a fix.
 */
export async function flagSosWithoutLocation(now = new Date()) {
  const cutoff = new Date(now.getTime() - 90_000);
  const list = await EmergencyAlert.find(
    { status: { $in: [...SOS_ACTIVE_STATUSES] }, latitude: null, dispatchedAt: { $ne: null, $lte: cutoff }, 'events.type': { $ne: 'location_unavailable' } },
    { _id: 1, status: 1 },
  ).limit(50).lean();
  for (const a of list) {
    const r = await EmergencyAlert.updateOne(
      { _id: a._id, latitude: null, 'events.type': { $ne: 'location_unavailable' } },
      { $push: { events: { type: 'location_unavailable', at: now, actorLabel: 'CampusCare', note: 'No location from the device yet. Call the student to confirm where they are.', studentVisible: false } } },
    );
    if (r.modifiedCount) {
      emitToRoom('responders:all', 'sos:updated', { id: String(a._id), status: a.status, locationUnavailable: true });
      emitToRoom(`sos:${a._id}`, 'sos:updated', { id: String(a._id), status: a.status });
    }
  }
  return list.length;
}

registerPeriodic('sos-location-watch', 30_000, () => flagSosWithoutLocation().then(() => undefined));
