import { Router, type NextFunction, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import {
  DUTY_STATUSES, SOS_ACTIVE_STATUSES, TERMINAL_STATUSES, adminSearchSchema, alertAssignSchema, alertDeclineSchema, chatReviewEndSchema, chatReviewRequestSchema,
  dutyOverrideSchema, dutySelfStatusSchema, dutyShiftSchema, dutyShiftUpdateSchema, hasPermission, heartbeatSchema, locationShareSchema, locationUpdateSchema,
  responderLocationConsentSchema, responderProfileSchema, responseZoneSchema, shiftDecisionSchema, type DutyStatus, type Permission, type Role,
} from '@campuscare/shared';
import { z } from 'zod';
import { AppError, asyncHandler, escapeRegex, forbidden, notFound, ok, pageParams, parse } from '../lib/http';
import { sha256 } from '../lib/crypto';
import { requireAuth, requireMfaPolicy, requirePermission, requireRecentAuth } from '../middleware/auth';
import { heartbeatLimiter } from '../middleware/security';
import { DutyShift, DutyStatusEvent, ResponderAvailability, ResponseZone } from '../models/duty';
import { AlertAssignment, AlertDeliveryEvent, EmergencyAlert, LocationShare } from '../models/safety';
import { ChatChannel, ChatMembership, ChatMessage, ChatReport, ChatReviewGrant } from '../models/chat';
import { Committee, Incident } from '../models/incident';
import { AuditLog, EmailDelivery, Job } from '../models/platform';
import { Notification } from '../models/content';
import { DeviceRegistration } from '../models/mobile';
import { TotpConfiguration, RecoveryCode } from '../models/mfa';
import { User } from '../models/user';
import { getSettings } from '../services/settings.service';
import { audit } from '../services/audit.service';
import {
  changeDutyStatus, createShift, decideShift, endShift, freshness, getAvailability, isResponder, publicAvailability, recordHeartbeat, startShift,
} from '../services/duty.service';
import { acknowledgeAlert, declineAssignment, dispatchRules, loadCandidates, runAssignment } from '../services/dispatch.service';
import { rankResponders } from '../services/dispatch.policy';
import { liveMap, liveMapDetail, startLocationShare, stopLocationShare, updateLocationShare } from '../services/location.service';
import { endReview, exportReview, requestReview, reviewMessages, serializeGrant } from '../services/chat-review.service';
import { serializeAlert } from '../services/safety.service';
import { pushConfigured } from '../services/push.service';
import { databaseReady } from '../db/connect';
import { emitToRoom } from '../realtime/socket';
import { env, turnstileKeys } from '../config/env';

/**
 * Operations API (versioned under /api/v1): duty roster, responder self-service, SOS dispatch,
 * live map, location shares, chat governance, console search and dashboard metrics.
 * Every route declares its own authentication and permission guard — nothing relies on the UI.
 */
export const opsRouter = Router();

const subject = (u: { role: string; permissions?: string[] }) => ({ role: u.role as Role, permissions: u.permissions ?? [] });
const can = (req: Request, p: Permission) => hasPermission(subject(req.user!), p);

/** Passes when the user holds at least one of the permissions. */
function requireAnyPermission(...perms: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(forbidden());
    if (perms.some((p) => can(req, p))) return next();
    void audit({ action: 'access.denied', req, outcome: 'denied', meta: { path: req.path, method: req.method, anyOf: perms } });
    next(forbidden());
  };
}
const admin = [requireAuth, requireMfaPolicy] as const;
const oid = (v: string) => {
  if (!Types.ObjectId.isValid(v)) throw notFound();
  return v;
};
/** Stable, non-identifying reference for a reporter (lists never show student names). */
const reporterRef = (userId: unknown) => `R-${sha256(`reporter:${String(userId)}`).slice(0, 8).toUpperCase()}`;

// ================================================================== responder self-service
const responder = [requireAuth, requirePermission('duty:self')] as const;

opsRouter.get('/responders/me/duty', ...responder, asyncHandler(async (req, res) => {
  const s = await getSettings();
  const a = await getAvailability(req.user!._id);
  const now = new Date();
  const [shifts, assignments] = await Promise.all([
    DutyShift.find({ responderId: req.user!._id, endAt: { $gte: new Date(now.getTime() - 12 * 3600_000) }, status: { $in: ['offered', 'accepted', 'active', 'completed'] } }).sort({ startAt: 1 }).limit(20).lean(),
    AlertAssignment.find({ responderId: req.user!._id, open: true }).lean(),
  ]);
  const alerts = await EmergencyAlert.find({ _id: { $in: assignments.map((x) => x.alertId) } }, { alertNumber: 1, status: 1 }).lean();
  const amap = new Map(alerts.map((x) => [String(x._id), x]));
  ok(res, {
    availability: publicAvailability(a, s.duty.staleThresholdSeconds),
    policy: { heartbeatIntervalSeconds: s.duty.heartbeatIntervalSeconds, staleThresholdSeconds: s.duty.staleThresholdSeconds, allowDutyWithoutShift: s.duty.allowDutyWithoutShift, shiftStartGraceMinutes: s.duty.shiftStartGraceMinutes, responderLocationSharing: s.duty.responderLocationSharing, ackDeadlineSeconds: s.dispatch.ackDeadlineSeconds },
    shifts: shifts.map((x) => ({ id: String(x._id), startAt: x.startAt, endAt: x.endAt, status: x.status, campus: x.campus, zoneId: x.zoneId ? String(x.zoneId) : null, notes: x.notes })),
    assignments: assignments.map((x) => ({ id: String(x._id), alertId: String(x.alertId), alertNumber: amap.get(String(x.alertId))?.alertNumber ?? null, alertStatus: amap.get(String(x.alertId))?.status ?? null, status: x.status, ackDeadlineAt: x.ackDeadlineAt })),
    serverTime: now.toISOString(),
  });
}));

opsRouter.patch('/responders/me/duty-status', ...responder, asyncHandler(async (req, res) => {
  const input = parse(dutySelfStatusSchema, req.body);
  const s = await getSettings();
  let shiftId: string | null = input.shiftId ?? null;
  if (input.status === 'on_duty' && !shiftId) {
    // Going back on duty inside a shift that is already running keeps that shift.
    const active = await DutyShift.findOne({ responderId: req.user!._id, status: 'active' }, { _id: 1 }).lean();
    shiftId = active ? String(active._id) : null;
  }
  const a = await changeDutyStatus(String(req.user!._id), input.status as DutyStatus, { actor: 'self', actorId: String(req.user!._id), reason: input.reason ?? null, shiftId, req });
  ok(res, publicAvailability(a, s.duty.staleThresholdSeconds));
}));

opsRouter.post('/responders/me/heartbeat', heartbeatLimiter, ...responder, asyncHandler(async (req, res) => {
  const input = parse(heartbeatSchema, req.body ?? {});
  ok(res, await recordHeartbeat(req.user!, input));
}));

opsRouter.patch('/responders/me/location-consent', ...responder, asyncHandler(async (req, res) => {
  const { shareLocation } = parse(responderLocationConsentSchema, req.body);
  await getAvailability(req.user!._id);
  // Withdrawing consent also deletes the stored position immediately.
  await ResponderAvailability.updateOne({ userId: req.user!._id }, { $set: { locationConsent: shareLocation, ...(shareLocation ? {} : { location: null }) } });
  await audit({ action: shareLocation ? 'duty.location_consent_given' : 'duty.location_consent_withdrawn', req, targetType: 'responder', targetId: String(req.user!._id) });
  ok(res, { shareLocation });
}));

opsRouter.post('/responders/me/shifts/:id/decision', ...responder, asyncHandler(async (req, res) => {
  const input = parse(shiftDecisionSchema, req.body);
  const shift = await decideShift(req.user!, req.params.id, input.decision, input.reason, req);
  ok(res, { id: String(shift._id), status: shift.status });
}));

opsRouter.post('/responders/me/shifts/:id/start', ...responder, asyncHandler(async (req, res) => {
  const shift = await startShift(req.user!, req.params.id, req);
  ok(res, { id: String(shift._id), status: shift.status, startedAt: shift.startedAt });
}));

opsRouter.post('/responders/me/shifts/:id/end', ...responder, asyncHandler(async (req, res) => {
  oid(req.params.id);
  const own = await DutyShift.exists({ _id: req.params.id, responderId: req.user!._id });
  if (!own) throw notFound();
  const reason = typeof req.body?.reason === 'string' && req.body.reason.trim() ? String(req.body.reason).slice(0, 300) : 'Ended by responder';
  const shift = await endShift(req.params.id, { actor: 'self', actorId: String(req.user!._id), reason, req });
  ok(res, { id: String(shift._id), status: shift.status });
}));

// ================================================================== emergency alerts (spec paths)
opsRouter.post('/emergency-alerts/:id/acknowledge', requireAuth, requirePermission('sos:respond'), asyncHandler(async (req, res) => {
  const a = await acknowledgeAlert(req.params.id, req.user!, req);
  emitToRoom(`sos:${a._id}`, 'sos:updated', { id: String(a._id), status: a.status });
  emitToRoom('responders:all', 'sos:updated', { id: String(a._id), status: a.status });
  ok(res, serializeAlert(a as never, true));
}));

opsRouter.post('/emergency-alerts/:id/decline', requireAuth, requirePermission('sos:respond'), asyncHandler(async (req, res) => {
  const { reason } = parse(alertDeclineSchema, req.body);
  await declineAssignment(req.params.id, req.user!, reason, req);
  ok(res, { ok: true });
}));

opsRouter.post('/emergency-alerts/:id/assign', ...admin, requirePermission('sos:dispatch'), asyncHandler(async (req, res) => {
  oid(req.params.id);
  const input = parse(alertAssignSchema, req.body);
  const alert = await EmergencyAlert.findById(req.params.id, { status: 1, dispatchedAt: 1 }).lean();
  if (!alert || alert.status === 'pending') throw notFound();
  if (!['queued', 'sending', 'sent', 'failed'].includes(alert.status)) throw new AppError(409, 'invalid_state', 'Only alerts waiting for a responder can be assigned. Use reassign for acknowledged alerts.');
  const result = await runAssignment(req.params.id, { reason: input.reason, actorId: String(req.user!._id), req, targetResponderId: input.responderId, manual: true });
  ok(res, result);
}));

opsRouter.get('/admin/emergency-alerts', ...admin, requirePermission('sos:dispatch'), asyncHandler(async (req, res) => {
  const { page, limit, skip } = pageParams(req.query, 100);
  const filter: Record<string, unknown> = { status: { $ne: 'pending' } };
  const status = String(req.query.status ?? 'active');
  if (status === 'active') filter.status = { $in: [...SOS_ACTIVE_STATUSES] };
  else if (status !== 'all') filter.status = status;
  if (req.query.assignment) filter.assignmentState = String(req.query.assignment);
  if (req.query.campus) filter.campus = String(req.query.campus);
  if (req.query.from || req.query.to) filter.createdAt = { ...(req.query.from ? { $gte: new Date(String(req.query.from)) } : {}), ...(req.query.to ? { $lte: new Date(String(req.query.to)) } : {}) };
  const [items, total, summary] = await Promise.all([
    EmergencyAlert.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    EmergencyAlert.countDocuments(filter),
    EmergencyAlert.aggregate([
      { $match: { status: { $in: [...SOS_ACTIVE_STATUSES] } } },
      { $group: { _id: null, active: { $sum: 1 }, unacknowledged: { $sum: { $cond: [{ $eq: ['$acknowledgedAt', null] }, 1, 0] } }, unassigned: { $sum: { $cond: [{ $eq: ['$assignmentState', 'unassigned'] }, 1, 0] } }, escalated: { $sum: { $cond: [{ $gt: ['$escalationLevel', 0] }, 1, 0] } } } },
    ]),
  ]);
  const ids = items.map((a) => a._id);
  const [assignments, deliveries, zones] = await Promise.all([
    AlertAssignment.find({ alertId: { $in: ids } }).sort({ createdAt: 1 }).lean(),
    AlertDeliveryEvent.aggregate([{ $match: { alertId: { $in: ids } } }, { $group: { _id: { a: '$alertId', o: '$outcome' }, n: { $sum: 1 } } }]),
    ResponseZone.find({}, { name: 1 }).lean(),
  ]);
  const names = new Map((await User.find({ _id: { $in: assignments.map((x) => x.responderId) } }, { fullName: 1 }).lean()).map((u) => [String(u._id), u.fullName]));
  const zoneName = new Map(zones.map((z) => [String(z._id), z.name]));
  ok(res, {
    summary: summary[0] ?? { active: 0, unacknowledged: 0, unassigned: 0, escalated: 0 },
    total, page, limit,
    items: items.map((a) => {
      const d: Record<string, number> = {};
      deliveries.filter((x) => String(x._id.a) === String(a._id)).forEach((x) => { d[x._id.o] = x.n; });
      return {
        id: String(a._id), alertNumber: a.alertNumber, status: a.status, assignmentState: a.assignmentState ?? 'none', reporterRef: reporterRef(a.userId),
        createdAt: a.createdAt, dispatchedAt: a.dispatchedAt, acknowledgedAt: a.acknowledgedAt, resolvedAt: a.resolvedAt, cancelledAt: a.cancelledAt,
        escalationLevel: a.escalationLevel ?? 0, campus: a.campus ?? 'main', zone: a.zoneId ? zoneName.get(String(a.zoneId)) ?? null : null,
        locationAvailable: a.latitude != null, accuracyMeters: a.accuracyMeters ?? null, unassignedSince: a.unassignedSince ?? null,
        assignees: assignments.filter((x) => String(x.alertId) === String(a._id)).map((x) => ({ name: names.get(String(x.responderId)) ?? 'Responder', status: x.status })),
        delivery: d,
      };
    }),
  });
}));

opsRouter.get('/admin/emergency-alerts/:id', ...admin, requirePermission('sos:dispatch'), asyncHandler(async (req, res) => {
  oid(req.params.id);
  const a = await EmergencyAlert.findById(req.params.id).lean();
  if (!a || a.status === 'pending') throw notFound();
  const s = await getSettings();
  const [assignments, deliveries, student, auditTrail, zone] = await Promise.all([
    AlertAssignment.find({ alertId: a._id }).sort({ createdAt: 1 }).lean(),
    AlertDeliveryEvent.find({ alertId: a._id }).sort({ createdAt: 1 }).lean(),
    User.findById(a.userId, { fullName: 1, phone: 1, studentId: 1, hostel: 1 }).lean(),
    can(req, 'audit:read') ? AuditLog.find({ targetType: 'sos', targetId: String(a._id) }).sort({ seq: 1 }).limit(200).lean() : Promise.resolve(null),
    a.zoneId ? ResponseZone.findById(a.zoneId, { name: 1 }).lean() : Promise.resolve(null),
  ]);
  const people = await User.find({ _id: { $in: [...assignments.map((x) => x.responderId), ...assignments.map((x) => x.assignedBy).filter(Boolean)] } }, { fullName: 1 }).lean();
  const names = new Map(people.map((u) => [String(u._id), u.fullName]));
  // Who dispatch would try next, and why others are ineligible — computed live, never stored.
  const { ranked, ineligible } = ['queued', 'sending', 'sent', 'failed'].includes(a.status)
    ? rankResponders(await loadCandidates(), {
      campus: a.campus ?? 'main', zoneId: a.zoneId ? String(a.zoneId) : null, latitude: a.latitude ?? null, longitude: a.longitude ?? null, accuracyMeters: a.accuracyMeters ?? null,
      excludedResponderIds: new Set(assignments.map((x) => String(x.responderId))),
    }, dispatchRules(s))
    : { ranked: [], ineligible: [] };
  await audit({ action: 'sos.viewed', req, targetType: 'sos', targetId: String(a._id), meta: { via: 'operations', location: a.latitude != null } });
  ok(res, {
    alert: { ...serializeAlert(a as never, true, student ? { fullName: student.fullName, phone: student.phone, studentId: student.studentId, hostel: student.hostel } : undefined), reporterRef: reporterRef(a.userId), campus: a.campus ?? 'main', zone: zone?.name ?? null, deliveryAttempts: a.deliveryAttempts },
    assignments: assignments.map((x) => ({ id: String(x._id), responderId: String(x.responderId), responder: names.get(String(x.responderId)) ?? 'Responder', status: x.status, slot: x.slot, attempt: x.attempt, policy: x.policy, offeredAt: x.offeredAt, ackDeadlineAt: x.ackDeadlineAt, acknowledgedAt: x.acknowledgedAt, closedAt: x.closedAt, closeReason: x.closeReason, assignedBy: x.assignedBy ? names.get(String(x.assignedBy)) ?? 'Dispatcher' : 'Dispatch algorithm', assignReason: x.assignReason, rankExplanation: x.rankExplanation })),
    deliveries: deliveries.map((d) => ({ channel: d.channel, outcome: d.outcome, recipient: d.channel === 'email' ? d.recipient : names.get(d.recipient) ?? (d.recipient === 'gateway' ? 'SMS gateway' : 'Staff member'), error: d.error, at: d.createdAt })),
    candidates: ranked.slice(0, 10).map((r) => ({ userId: r.candidate.userId, name: r.candidate.name, explanation: r.explanation, distanceMeters: r.distanceMeters != null ? Math.round(r.distanceMeters) : null })),
    ineligible: ineligible.map((r) => ({ userId: r.candidate.userId, name: r.candidate.name, reason: r.reason })),
    auditTrail: auditTrail?.map((e) => ({ seq: e.seq, at: e.at, action: e.action, outcome: e.outcome, reason: e.reason ?? null, correlationId: e.correlationId ?? null })) ?? null,
  });
}));

// ================================================================== duty roster (supervisors and administrators)
async function rosterRows(filter: { campus?: string; zoneId?: string; status?: string; skill?: string; workload?: string; q?: string }) {
  const s = await getSettings();
  const userFilter: Record<string, unknown> = { $or: [{ role: 'security_officer' }, { permissions: 'sos:respond' }], accountStatus: { $ne: 'suspended' } };
  if (filter.q) userFilter.fullName = { $regex: escapeRegex(filter.q), $options: 'i' };
  const users = (await User.find(userFilter, { fullName: 1, email: 1, phone: 1, role: 1, permissions: 1, accountStatus: 1 }).sort({ fullName: 1 }).lean()).filter((u) => isResponder(u));
  const ids = users.map((u) => u._id);
  const now = new Date();
  const [avail, shifts, zones] = await Promise.all([
    ResponderAvailability.find({ userId: { $in: ids } }).lean(),
    DutyShift.find({ responderId: { $in: ids }, status: { $in: ['offered', 'accepted', 'active'] }, endAt: { $gte: now } }).sort({ startAt: 1 }).lean(),
    ResponseZone.find({}, { name: 1 }).lean(),
  ]);
  const amap = new Map(avail.map((a) => [String(a.userId), a]));
  const zname = new Map(zones.map((z) => [String(z._id), z.name]));
  const supervisors = new Map((await User.find({ _id: { $in: avail.map((a) => a.approvedBy).filter(Boolean) } }, { fullName: 1 }).lean()).map((u) => [String(u._id), u.fullName]));
  return users.map((u) => {
    const a = amap.get(String(u._id));
    const f = freshness({ status: a?.status ?? 'off_duty', lastHeartbeatAt: a?.lastHeartbeatAt ?? null }, s.duty.staleThresholdSeconds);
    const mine = shifts.filter((x) => String(x.responderId) === String(u._id));
    const current = mine.find((x) => x.status === 'active') ?? null;
    const next = mine.find((x) => x.status !== 'active') ?? null;
    return {
      userId: String(u._id), name: u.fullName, identifier: u.email.split('@')[0], phone: u.phone ?? null, accountStatus: u.accountStatus,
      status: (a?.status ?? 'off_duty') as DutyStatus, statusChangedAt: a?.statusChangedAt ?? null, staleSince: a?.staleSince ?? null,
      lastHeartbeatAt: a?.lastHeartbeatAt ?? null, heartbeatAgeSeconds: f.ageSeconds, heartbeatFresh: f.fresh,
      campus: a?.campus ?? 'main', zoneId: a?.zoneId ? String(a.zoneId) : null, zone: a?.zoneId ? zname.get(String(a.zoneId)) ?? null : null,
      skills: a?.skills ?? [], responsibilities: a?.responsibilities ?? ['sos_response'], activeAssignmentCount: a?.activeAssignmentCount ?? 0, lastAssignedAt: a?.lastAssignedAt ?? null,
      locationConsent: Boolean(a?.locationConsent), supervisor: a?.approvedBy ? supervisors.get(String(a.approvedBy)) ?? null : null,
      currentShift: current ? { id: String(current._id), startAt: current.startAt, endAt: current.endAt, status: current.status } : null,
      nextShift: next ? { id: String(next._id), startAt: next.startAt, endAt: next.endAt, status: next.status } : null,
    };
  }).filter((r) => (!filter.campus || r.campus === filter.campus)
    && (!filter.zoneId || r.zoneId === filter.zoneId)
    && (!filter.status || r.status === filter.status)
    && (!filter.skill || r.skills.includes(filter.skill as never))
    && (!filter.workload || (filter.workload === 'idle' ? r.activeAssignmentCount === 0 : r.activeAssignmentCount > 0)));
}

opsRouter.get('/admin/duty-roster', ...admin, requireAnyPermission('duty:view', 'duty:manage'), asyncHandler(async (req, res) => {
  const s = await getSettings();
  const q = (k: string) => (typeof req.query[k] === 'string' && req.query[k] ? String(req.query[k]) : undefined);
  const rows = await rosterRows({ campus: q('campus'), zoneId: q('zoneId'), status: q('status'), skill: q('skill'), workload: q('workload'), q: q('q') });
  const counts = Object.fromEntries(DUTY_STATUSES.map((st) => [st, rows.filter((r) => r.status === st).length]));
  ok(res, { policy: { heartbeatIntervalSeconds: s.duty.heartbeatIntervalSeconds, staleThresholdSeconds: s.duty.staleThresholdSeconds, ackDeadlineSeconds: s.dispatch.ackDeadlineSeconds, dispatchPolicy: s.dispatch.policy }, counts, rows, generatedAt: new Date().toISOString() });
}));

opsRouter.get('/admin/duty-shifts', ...admin, requireAnyPermission('duty:view', 'duty:manage'), asyncHandler(async (req, res) => {
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 86400_000);
  const to = req.query.to ? new Date(String(req.query.to)) : new Date(Date.now() + 7 * 86400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new AppError(422, 'validation_failed', 'Invalid date range.');
  const filter: Record<string, unknown> = { startAt: { $lt: to }, endAt: { $gt: from } };
  if (req.query.responderId) filter.responderId = oid(String(req.query.responderId));
  if (req.query.status) filter.status = String(req.query.status);
  const list = await DutyShift.find(filter).sort({ startAt: 1 }).limit(500).lean();
  const names = new Map((await User.find({ _id: { $in: [...list.map((x) => x.responderId), ...list.map((x) => x.createdBy)] } }, { fullName: 1 }).lean()).map((u) => [String(u._id), u.fullName]));
  ok(res, list.map((x) => ({ id: String(x._id), responderId: String(x.responderId), responder: names.get(String(x.responderId)) ?? 'Responder', startAt: x.startAt, endAt: x.endAt, status: x.status, campus: x.campus, zoneId: x.zoneId ? String(x.zoneId) : null, notes: x.notes, createdBy: names.get(String(x.createdBy)) ?? null, assignedDirectly: Boolean(x.assignedBy), startedAt: x.startedAt, endedAt: x.endedAt, endReason: x.endReason, declinedReason: x.declinedReason })));
}));

opsRouter.post('/admin/duty-shifts', ...admin, requirePermission('duty:manage'), asyncHandler(async (req, res) => {
  const input = parse(dutyShiftSchema, req.body);
  const shift = await createShift(req.user!, input, req);
  ok(res, { id: String(shift._id), status: shift.status }, 201);
}));

opsRouter.patch('/admin/duty-shifts/:id', ...admin, requirePermission('duty:manage'), asyncHandler(async (req, res) => {
  oid(req.params.id);
  const input = parse(dutyShiftUpdateSchema, req.body);
  const shift = await DutyShift.findById(req.params.id);
  if (!shift) throw notFound();
  if (input.action === 'end') {
    const ended = await endShift(req.params.id, { actor: 'supervisor', actorId: String(req.user!._id), reason: input.reason, req, force: req.body?.force === true });
    return ok(res, { id: String(ended._id), status: ended.status });
  }
  if (input.action === 'cancel') {
    if (shift.status === 'active') throw new AppError(409, 'invalid_state', 'End an active shift instead of cancelling it.');
    const r = await DutyShift.findOneAndUpdate({ _id: shift._id, status: { $in: ['offered', 'accepted'] } }, { $set: { status: 'cancelled', cancelledBy: req.user!._id, endReason: input.reason } }, { new: true });
    if (!r) throw new AppError(409, 'invalid_state', 'This shift can no longer be cancelled.');
    await audit({ action: 'duty.shift_cancelled', req, targetType: 'duty_shift', targetId: req.params.id, reason: input.reason });
    emitToRoom('duty:roster', 'duty:shift', { id: req.params.id, status: 'cancelled' });
    return ok(res, { id: req.params.id, status: 'cancelled' });
  }
  // reassign: cancel this shift and offer the same slot to another responder
  if (!input.responderId) throw new AppError(422, 'validation_failed', 'Choose the new responder.', { fields: { responderId: 'Required' } });
  if (!['offered', 'accepted', 'declined'].includes(shift.status)) throw new AppError(409, 'invalid_state', 'Only shifts that have not started can be reassigned.');
  await DutyShift.updateOne({ _id: shift._id }, { $set: { status: 'cancelled', cancelledBy: req.user!._id, endReason: `Reassigned: ${input.reason}` } });
  const created = await createShift(req.user!, { responderId: input.responderId, startAt: shift.startAt, endAt: shift.endAt, campus: shift.campus, zoneId: shift.zoneId ? String(shift.zoneId) : null, notes: shift.notes ?? undefined, assignDirectly: req.body?.assignDirectly === true }, req);
  await audit({ action: 'duty.shift_reassigned', req, targetType: 'duty_shift', targetId: req.params.id, reason: input.reason, meta: { newShiftId: String(created._id), to: input.responderId } });
  ok(res, { id: String(created._id), status: created.status, replaced: req.params.id });
}));

/** Supervisor override of a responder's duty status — always with a recorded reason. */
opsRouter.post('/admin/responders/:id/duty-status', ...admin, requirePermission('duty:manage'), asyncHandler(async (req, res) => {
  oid(req.params.id);
  const input = parse(dutyOverrideSchema, req.body);
  const target = await User.findById(req.params.id, { role: 1, permissions: 1 }).lean();
  if (!target || !isResponder(target)) throw notFound();
  if (String(target._id) === String(req.user!._id)) throw new AppError(422, 'self', 'Change your own duty status from the app.');
  const s = await getSettings();
  const a = await changeDutyStatus(req.params.id, input.status as DutyStatus, { actor: 'supervisor', actorId: String(req.user!._id), reason: input.reason, force: input.force, req });
  ok(res, publicAvailability(a, s.duty.staleThresholdSeconds));
}));

opsRouter.patch('/admin/responders/:id/profile', ...admin, requirePermission('duty:manage'), asyncHandler(async (req, res) => {
  oid(req.params.id);
  const input = parse(responderProfileSchema, req.body);
  const target = await User.findById(req.params.id, { role: 1, permissions: 1 }).lean();
  if (!target || !isResponder(target)) throw notFound();
  if (input.zoneId && !(await ResponseZone.exists({ _id: input.zoneId }))) throw new AppError(422, 'validation_failed', 'Unknown zone.', { fields: { zoneId: 'Unknown zone' } });
  await getAvailability(req.params.id);
  const set: Record<string, unknown> = { approvedBy: req.user!._id };
  for (const k of ['campus', 'zoneId', 'skills', 'responsibilities'] as const) if (input[k] !== undefined) set[k] = input[k];
  const before = await ResponderAvailability.findOneAndUpdate({ userId: req.params.id }, { $set: set });
  await audit({ action: 'duty.responder_profile_updated', req, targetType: 'responder', targetId: req.params.id, reason: input.reason, meta: { fields: Object.keys(set).filter((k) => k !== 'approvedBy'), before: { campus: before?.campus, skills: before?.skills, responsibilities: before?.responsibilities } } });
  ok(res, { ok: true });
}));

opsRouter.get('/admin/responders', ...admin, requireAnyPermission('duty:view', 'duty:manage'), asyncHandler(async (req, res) => {
  const rows = await rosterRows({ q: typeof req.query.q === 'string' ? req.query.q : undefined });
  const since = new Date(Date.now() - 30 * 86400_000);
  const stats = await AlertAssignment.aggregate([
    { $match: { createdAt: { $gte: since } } },
    { $group: {
      _id: '$responderId', offers: { $sum: 1 },
      acknowledged: { $sum: { $cond: [{ $ne: ['$acknowledgedAt', null] }, 1, 0] } },
      declined: { $sum: { $cond: [{ $eq: ['$status', 'declined'] }, 1, 0] } },
      expired: { $sum: { $cond: [{ $eq: ['$status', 'expired'] }, 1, 0] } },
      ackMs: { $push: { $cond: [{ $ne: ['$acknowledgedAt', null] }, { $subtract: ['$acknowledgedAt', '$offeredAt'] }, '$$REMOVE'] } },
    } },
  ]);
  const smap = new Map(stats.map((x) => [String(x._id), x]));
  ok(res, rows.map((r) => {
    const st = smap.get(r.userId);
    const ack = ((st?.ackMs ?? []) as number[]).filter((n) => n >= 0).sort((a, b) => a - b);
    return { ...r, stats30d: { offers: st?.offers ?? 0, acknowledged: st?.acknowledged ?? 0, declined: st?.declined ?? 0, expired: st?.expired ?? 0, medianAckSeconds: ack.length ? Math.round(ack[Math.floor(ack.length / 2)]! / 1000) : null } };
  }));
}));

opsRouter.get('/admin/responders/:id/history', ...admin, requireAnyPermission('duty:view', 'duty:manage'), asyncHandler(async (req, res) => {
  oid(req.params.id);
  const [events, shifts, assignments] = await Promise.all([
    DutyStatusEvent.find({ userId: req.params.id }).sort({ createdAt: -1 }).limit(100).lean(),
    DutyShift.find({ responderId: req.params.id }).sort({ startAt: -1 }).limit(50).lean(),
    AlertAssignment.find({ responderId: req.params.id }).sort({ createdAt: -1 }).limit(50).lean(),
  ]);
  const actors = new Map((await User.find({ _id: { $in: events.map((e) => e.actorId).filter(Boolean) } }, { fullName: 1 }).lean()).map((u) => [String(u._id), u.fullName]));
  const alerts = new Map((await EmergencyAlert.find({ _id: { $in: assignments.map((a) => a.alertId) } }, { alertNumber: 1 }).lean()).map((a) => [String(a._id), a.alertNumber]));
  ok(res, {
    events: events.map((e) => ({ at: e.createdAt, from: e.from, to: e.to, actor: e.actor, actorName: e.actorId ? actors.get(String(e.actorId)) ?? null : null, reason: e.reason })),
    shifts: shifts.map((x) => ({ id: String(x._id), startAt: x.startAt, endAt: x.endAt, status: x.status, startedAt: x.startedAt, endedAt: x.endedAt, endReason: x.endReason })),
    assignments: assignments.map((a) => ({ id: String(a._id), alertNumber: alerts.get(String(a.alertId)) ?? null, status: a.status, offeredAt: a.offeredAt, acknowledgedAt: a.acknowledgedAt, closeReason: a.closeReason })),
  });
}));

// ------------------------------------------------------------------ response zones
opsRouter.get('/admin/response-zones', ...admin, requireAnyPermission('duty:view', 'duty:manage', 'sos:dispatch'), asyncHandler(async (_req, res) => {
  const zones = await ResponseZone.find({}).sort({ campus: 1, name: 1 }).lean();
  ok(res, zones.map((z) => ({ id: String(z._id), name: z.name, code: z.code, campus: z.campus, latitude: z.latitude, longitude: z.longitude, radiusMeters: z.radiusMeters, description: z.description, active: z.active })));
}));
opsRouter.post('/admin/response-zones', ...admin, requirePermission('duty:manage'), asyncHandler(async (req, res) => {
  const input = parse(responseZoneSchema, req.body);
  const z = await ResponseZone.create({ ...input, updatedBy: req.user!._id });
  await audit({ action: 'duty.zone_created', req, targetType: 'response_zone', targetId: String(z._id), meta: { code: input.code } });
  ok(res, { id: String(z._id) }, 201);
}));
opsRouter.patch('/admin/response-zones/:id', ...admin, requirePermission('duty:manage'), asyncHandler(async (req, res) => {
  oid(req.params.id);
  const input = parse(responseZoneSchema.partial(), req.body);
  const z = await ResponseZone.findByIdAndUpdate(req.params.id, { $set: { ...input, updatedBy: req.user!._id } }, { new: true });
  if (!z) throw notFound();
  await audit({ action: 'duty.zone_updated', req, targetType: 'response_zone', targetId: req.params.id, meta: { fields: Object.keys(input) } });
  ok(res, { ok: true });
}));

// ================================================================== live map
opsRouter.get('/admin/live-locations', ...admin, asyncHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  ok(res, await liveMap(req.user!, { campus: typeof req.query.campus === 'string' && req.query.campus ? req.query.campus : undefined, correlationId: req.correlationId }));
}));
opsRouter.get('/admin/live-locations/:kind/:id', ...admin, asyncHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  ok(res, await liveMapDetail(req.user!, req.params.kind, req.params.id, req));
}));

// ================================================================== location shares (spec paths; same rules as /safety/location-share)
opsRouter.get('/location-shares/current', requireAuth, asyncHandler(async (req, res) => {
  const s = await LocationShare.findOne({ userId: req.user!._id, stoppedAt: null, expiresAt: { $gt: new Date() } }).lean();
  ok(res, s ? { id: String(s._id), audience: s.audience, startedAt: s.startedAt, expiresAt: s.expiresAt, locationAt: s.locationAt ?? s.updatedAt, accuracyMeters: s.accuracyMeters } : null);
}));
opsRouter.post('/location-shares', requireAuth, requirePermission('safety:self'), asyncHandler(async (req, res) => {
  const share = await startLocationShare(req.user!, parse(locationShareSchema, req.body), req);
  ok(res, { id: String(share._id), expiresAt: share.expiresAt }, 201);
}));
opsRouter.patch('/location-shares/:id', requireAuth, asyncHandler(async (req, res) => {
  const share = await updateLocationShare(req.user!, req.params.id, parse(locationUpdateSchema, req.body));
  ok(res, { ok: true, expiresAt: share.expiresAt });
}));
opsRouter.delete('/location-shares/:id', requireAuth, asyncHandler(async (req, res) => {
  ok(res, await stopLocationShare(req.user!, req.params.id, req));
}));

// ================================================================== chat governance
opsRouter.get('/admin/chat-governance', ...admin, requireAnyPermission('chat:configure', 'chat:read_private'), asyncHandler(async (req, res) => {
  const s = await getSettings();
  const [byKind, members, reports, activeReviews, channels] = await Promise.all([
    ChatChannel.aggregate([{ $group: { _id: '$kind', n: { $sum: 1 } } }]),
    ChatMembership.countDocuments({}),
    ChatReport.countDocuments({ status: 'open' }),
    ChatReviewGrant.countDocuments({ status: 'active', expiresAt: { $gt: new Date() } }),
    ChatChannel.find({ kind: { $in: ['community', 'support_service'] } }, { name: 1, kind: 1, published: 1, moderatorIds: 1, readOnly: 1, serviceRole: 1 }).sort({ kind: 1, order: 1 }).lean(),
  ]);
  const mods = new Map((await User.find({ _id: { $in: channels.flatMap((c) => c.moderatorIds ?? []) } }, { fullName: 1 }).lean()).map((u) => [String(u._id), u.fullName]));
  ok(res, {
    policy: s.chatGovernance,
    retention: { communityMessagesDays: s.retention.communityMessagesDays, notificationsDays: s.retention.notificationsDays },
    media: s.chat.media,
    canReviewPrivate: can(req, 'chat:read_private'),
    counts: { channelsByKind: Object.fromEntries(byKind.map((k) => [k._id, k.n])), memberships: members, openReports: reports, activeReviews },
    channels: channels.map((c) => ({ id: String(c._id), name: c.name, kind: c.kind, published: c.published, readOnly: c.readOnly, serviceRole: c.serviceRole, moderators: (c.moderatorIds ?? []).map((m) => ({ id: String(m), name: mods.get(String(m)) ?? 'Moderator' })) })),
  });
}));

opsRouter.put('/admin/chat-channels/:id/moderators', ...admin, requirePermission('chat:configure'), asyncHandler(async (req, res) => {
  oid(req.params.id);
  const ids = parse(z.array(z.string().regex(/^[a-f0-9]{24}$/i)).max(20), req.body?.moderatorIds);
  const staff = await User.find({ _id: { $in: ids }, accountStatus: 'active', role: { $ne: 'student' } }, { _id: 1 }).lean();
  if (staff.length !== ids.length) throw new AppError(422, 'validation_failed', 'Moderators must be active staff accounts.');
  const c = await ChatChannel.findOneAndUpdate({ _id: req.params.id, kind: 'community' }, { $set: { moderatorIds: ids } }, { new: true });
  if (!c) throw notFound();
  await audit({ action: 'chat_channel.moderators_changed', req, targetType: 'chat_channel', targetId: req.params.id, meta: { count: ids.length } });
  ok(res, { ok: true });
}));

/** Find a conversation to review by its reference — metadata only, never content. */
opsRouter.get('/admin/chat-reviews/targets', ...admin, requirePermission('chat:read_private'), asyncHandler(async (req, res) => {
  const scope = String(req.query.scope ?? 'case_chat');
  const q = String(req.query.q ?? '').trim();
  if (q.length < 3) return ok(res, []);
  if (scope === 'case_chat') {
    const list = await Incident.find({ caseNumber: { $regex: `^${escapeRegex(q.toUpperCase())}` } }, { caseNumber: 1, category: 1, status: 1, messageCount: 1, createdAt: 1 }).limit(10).lean();
    return ok(res, list.map((i) => ({ id: String(i._id), label: i.caseNumber, detail: `${i.category} · ${i.status} · ${i.messageCount ?? 0} messages`, createdAt: i.createdAt })));
  }
  if (!Types.ObjectId.isValid(q)) return ok(res, []);
  const ch = await ChatChannel.findOne({ _id: q, kind: 'support_thread' }, { name: 1, createdAt: 1, closed: 1 }).lean();
  if (!ch) return ok(res, []);
  const count = await ChatMessage.countDocuments({ channelId: ch._id });
  ok(res, [{ id: String(ch._id), label: `${ch.name} conversation`, detail: `${count} messages · ${ch.closed ? 'closed' : 'open'}`, createdAt: ch.createdAt }]);
}));

opsRouter.get('/admin/chat-reviews', ...admin, requireAnyPermission('chat:configure', 'chat:read_private', 'security:manage'), asyncHandler(async (req, res) => {
  // Reviewers see their own grants; governance roles see every grant's metadata (never content).
  const oversight = can(req, 'chat:configure') || can(req, 'security:manage');
  const filter: Record<string, unknown> = oversight ? {} : { requesterId: req.user!._id };
  if (req.query.status) filter.status = String(req.query.status);
  const list = await ChatReviewGrant.find(filter).sort({ createdAt: -1 }).limit(100).lean();
  const names = new Map((await User.find({ _id: { $in: list.map((g) => g.requesterId) } }, { fullName: 1 }).lean()).map((u) => [String(u._id), u.fullName]));
  ok(res, list.map((g) => ({ ...serializeGrant(g, names), mine: String(g.requesterId) === String(req.user!._id) })));
}));

opsRouter.post('/admin/chat-reviews', ...admin, requirePermission('chat:read_private'), requireRecentAuth, asyncHandler(async (req, res) => {
  const input = parse(chatReviewRequestSchema, req.body);
  const grant = await requestReview(req.user!, { ...input, caseReference: input.caseReference || undefined }, req);
  ok(res, serializeGrant(grant), 201);
}));

opsRouter.get('/admin/chat-reviews/:id/messages', ...admin, requirePermission('chat:read_private'), asyncHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  ok(res, await reviewMessages(req.user!, req.params.id, { before: typeof req.query.before === 'string' ? req.query.before : undefined, limit: Number(req.query.limit) || 50 }, req));
}));

opsRouter.post('/admin/chat-reviews/:id/export', ...admin, requirePermission('chat:read_private'), requireRecentAuth, asyncHandler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  ok(res, await exportReview(req.user!, req.params.id, req));
}));

opsRouter.post('/admin/chat-reviews/:id/end', ...admin, requirePermission('chat:read_private'), asyncHandler(async (req, res) => {
  const { note } = parse(chatReviewEndSchema, req.body ?? {});
  const g = await endReview(req.user!, req.params.id, note, { req });
  ok(res, serializeGrant(g));
}));

opsRouter.post('/admin/chat-reviews/:id/revoke', ...admin, requireAnyPermission('chat:configure', 'security:manage'), requireRecentAuth, asyncHandler(async (req, res) => {
  const { note } = parse(z.object({ note: z.string().trim().min(5, 'Record why you are revoking this review').max(500) }), req.body);
  const g = await endReview(req.user!, req.params.id, note, { revoke: true, req });
  ok(res, serializeGrant(g));
}));

// ================================================================== console search
opsRouter.get('/admin/search', ...admin, requirePermission('admin:access'), asyncHandler(async (req, res) => {
  const { q } = parse(adminSearchSchema, { q: req.query.q });
  const rx = { $regex: escapeRegex(q), $options: 'i' };
  const prefix = { $regex: `^${escapeRegex(q.toUpperCase())}` };
  const sections: Record<string, unknown[]> = {};
  const tasks: Promise<void>[] = [];
  if (can(req, 'users:manage')) tasks.push(User.find({ $or: [{ fullName: rx }, { email: rx }] }, { fullName: 1, email: 1, role: 1, accountStatus: 1 }).limit(6).lean().then((l) => { sections.users = l.map((u) => ({ id: String(u._id), title: u.fullName, subtitle: `${u.email} · ${u.role.replace('_', ' ')}`, href: `/super-admin/users?q=${encodeURIComponent(u.email)}` })); }));
  // Complaints are searchable by case number only — titles and descriptions are never matched or returned.
  if (can(req, 'incidents:triage')) tasks.push(Incident.find({ caseNumber: prefix }, { caseNumber: 1, category: 1, status: 1 }).limit(6).lean().then((l) => { sections.incidents = l.map((i) => ({ id: String(i._id), title: i.caseNumber, subtitle: `${i.category} · ${i.status.replace('_', ' ')}`, href: `/super-admin/incidents/${i._id}` })); }));
  if (can(req, 'sos:dispatch')) tasks.push(EmergencyAlert.find({ alertNumber: prefix, status: { $ne: 'pending' } }, { alertNumber: 1, status: 1, createdAt: 1 }).limit(6).lean().then((l) => { sections.alerts = l.map((a) => ({ id: String(a._id), title: a.alertNumber, subtitle: a.status.replace('_', ' '), href: `/super-admin/emergency-alerts?alert=${a._id}` })); }));
  if (can(req, 'committees:manage')) tasks.push(Committee.find({ name: rx }, { name: 1, type: 1 }).limit(6).lean().then((l) => { sections.committees = l.map((c) => ({ id: String(c._id), title: c.name, subtitle: c.type.replace('_', ' '), href: '/super-admin/committees' })); }));
  if (can(req, 'duty:view')) tasks.push(rosterRows({ q }).then((l) => { sections.responders = l.slice(0, 6).map((r) => ({ id: r.userId, title: r.name, subtitle: r.status.replace('_', ' '), href: `/super-admin/responders?id=${r.userId}` })); }));
  if (can(req, 'audit:read')) {
    tasks.push(AuditLog.find({ $or: [{ action: rx }, { targetId: q }, { correlationId: q }] }, { action: 1, at: 1, targetType: 1, targetId: 1, seq: 1 }).sort({ seq: -1 }).limit(6).lean().then((l) => { sections.audit = l.map((e) => ({ id: String(e._id), title: e.action, subtitle: `#${e.seq} · ${e.at.toISOString().slice(0, 16).replace('T', ' ')}${e.targetType ? ` · ${e.targetType}` : ''}`, href: `/super-admin/audit-logs?q=${encodeURIComponent(e.action)}` })); }));
  }
  await Promise.all(tasks);
  // Only the length is logged: the query itself may contain a name.
  await audit({ action: 'console.search', req, meta: { length: q.length, sections: Object.keys(sections) } });
  ok(res, sections);
}));

// ================================================================== dashboard metrics (real data only)
opsRouter.get('/admin/ops-overview', ...admin, requireAnyPermission('super_admin:access', 'duty:view'), asyncHandler(async (_req, res) => {
  const s = await getSettings();
  const now = new Date();
  const day = new Date(now.getTime() - 86400_000);
  const week = new Date(now.getTime() - 7 * 86400_000);
  const freshCutoff = new Date(now.getTime() - s.duty.staleThresholdSeconds * 1000);
  const [dutyCounts, freshActive, activeSos, openAssignments, incidentOpen, overdueAck, overdueResolve, shares, emailFailed, alertFailed, pushFailed, jobsFailed, sec, demo, sample, locked] = await Promise.all([
    ResponderAvailability.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    ResponderAvailability.countDocuments({ status: { $in: ['on_duty', 'busy', 'responding', 'on_break'] }, lastHeartbeatAt: { $gte: freshCutoff } }),
    EmergencyAlert.find({ status: { $in: [...SOS_ACTIVE_STATUSES] } }, { acknowledgedAt: 1, assignmentState: 1 }).lean(),
    AlertAssignment.distinct('responderId', { open: true }),
    Incident.countDocuments({ status: { $nin: [...TERMINAL_STATUSES, 'resolved'] } }),
    Incident.countDocuments({ status: { $nin: [...TERMINAL_STATUSES, 'resolved'] }, acknowledgedAt: null, dueAcknowledgeAt: { $lt: now } }),
    Incident.countDocuments({ status: { $nin: [...TERMINAL_STATUSES, 'resolved'] }, dueResolveAt: { $lt: now } }),
    LocationShare.aggregate([{ $match: { stoppedAt: null, expiresAt: { $gt: now } } }, { $group: { _id: '$audience', n: { $sum: 1 } } }]),
    EmailDelivery.countDocuments({ status: 'failed', createdAt: { $gte: day } }),
    AlertDeliveryEvent.countDocuments({ outcome: 'failed', createdAt: { $gte: day } }),
    AlertDeliveryEvent.countDocuments({ channel: 'push', outcome: 'failed', createdAt: { $gte: day } }),
    Job.countDocuments({ status: 'failed' }),
    AuditLog.aggregate([{ $match: { at: { $gte: week }, action: { $in: ['auth.login_failed', 'auth.mfa_failed', 'auth.recovery_code_used', 'auth.recovery_code_failed', 'auth.mfa_replay_blocked', 'auth.mfa_locked', 'access.denied', 'turnstile.failed', 'chat_review.granted', 'location.detail_viewed'] } } }, { $group: { _id: '$action', n: { $sum: 1 } } }]),
    User.countDocuments({ email: { $regex: '^cc-demo-' } }),
    Incident.countDocuments({ title: { $regex: '\\(Sample Case\\)' } }),
    User.countDocuments({ lockedUntil: { $gt: now } }),
  ]);
  const dc = Object.fromEntries(dutyCounts.map((d) => [d._id, d.n])) as Record<string, number>;
  const sh = Object.fromEntries(shares.map((x) => [x._id, x.n])) as Record<string, number>;
  const se = Object.fromEntries(sec.map((x) => [x._id, x.n])) as Record<string, number>;
  const google = Boolean(env.GOOGLE_CLIENT_ID);
  ok(res, {
    generatedAt: now.toISOString(),
    environment: env.NODE_ENV,
    // Development databases often contain seeded demo data; the console labels it rather than hiding it.
    sampleData: { present: demo + sample > 0, demoAccounts: demo, sampleIncidents: sample },
    duty: {
      onDuty: (dc.on_duty ?? 0) + (dc.busy ?? 0) + (dc.responding ?? 0), onBreak: dc.on_break ?? 0, offDuty: dc.off_duty ?? 0, unavailable: dc.unavailable ?? 0,
      stale: dc.stale ?? 0, responding: dc.responding ?? 0, reachableActive: freshActive,
      heartbeatIntervalSeconds: s.duty.heartbeatIntervalSeconds, staleThresholdSeconds: s.duty.staleThresholdSeconds,
    },
    sos: { active: activeSos.length, unacknowledged: activeSos.filter((a) => !a.acknowledgedAt).length, unassigned: activeSos.filter((a) => a.assignmentState === 'unassigned').length, respondersAssigned: openAssignments.length },
    incidents: { open: incidentOpen, overdueAcknowledgement: overdueAck, overdueResolution: overdueResolve },
    location: { activeSecurityShares: sh.security ?? 0, activeTrustedContactShares: sh.trusted_contacts ?? 0 },
    delivery: { emailFailed24h: emailFailed, alertDeliveryFailed24h: alertFailed, pushFailed24h: pushFailed, jobsFailed },
    security: {
      loginFailures7d: se['auth.login_failed'] ?? 0, mfaFailures7d: (se['auth.mfa_failed'] ?? 0) + (se['auth.recovery_code_failed'] ?? 0), replayBlocked7d: se['auth.mfa_replay_blocked'] ?? 0,
      mfaLockouts7d: se['auth.mfa_locked'] ?? 0, recoveryCodesUsed7d: se['auth.recovery_code_used'] ?? 0, accessDenied7d: se['access.denied'] ?? 0, turnstileFailed7d: se['turnstile.failed'] ?? 0,
      privateChatReviews7d: se['chat_review.granted'] ?? 0, locationDetailViews7d: se['location.detail_viewed'] ?? 0, lockedAccounts: locked,
    },
    health: {
      database: databaseReady() ? 'ok' : 'down',
      worker: env.RUN_WORKER ? 'running in this instance' : 'disabled in this instance',
      push: pushConfigured() ? 'configured' : 'not configured',
      turnstile: env.TURNSTILE_SECRET ? 'configured' : turnstileKeys.secret ? 'test keys (development)' : 'not configured',
      email: env.EMAIL_PROVIDER,
      googleOAuth: google ? 'configured (environment)' : 'see Identity providers',
      sms: 'not integrated',
    },
  });
}));

// ================================================================== notifications health
opsRouter.get('/admin/notifications/health', ...admin, requirePermission('notifications:manage'), asyncHandler(async (_req, res) => {
  const s = await getSettings();
  const week = new Date(Date.now() - 7 * 86400_000);
  const [byKind, critical, criticalUnread, devices, devicesWithPush, emailByStatus, emailByTemplate, alertDelivery] = await Promise.all([
    Notification.aggregate([{ $match: { createdAt: { $gte: week } } }, { $group: { _id: '$kind', n: { $sum: 1 }, pushed: { $sum: { $cond: [{ $ne: ['$pushedAt', null] }, 1, 0] } } } }, { $sort: { n: -1 } }, { $limit: 20 }]),
    Notification.countDocuments({ createdAt: { $gte: week }, priority: 'critical' }),
    Notification.countDocuments({ createdAt: { $gte: week }, priority: 'critical', readAt: null }),
    DeviceRegistration.countDocuments({}),
    DeviceRegistration.countDocuments({ pushToken: { $ne: null } }),
    EmailDelivery.aggregate([{ $match: { createdAt: { $gte: week } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    EmailDelivery.aggregate([{ $match: { createdAt: { $gte: week }, status: 'failed' } }, { $group: { _id: '$template', n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
    AlertDeliveryEvent.aggregate([{ $match: { createdAt: { $gte: week } } }, { $group: { _id: { c: '$channel', o: '$outcome' }, n: { $sum: 1 } } }]),
  ]);
  ok(res, {
    policy: s.notifications,
    push: { configured: pushConfigured(), devices, devicesWithPush },
    inApp7d: { byKind: byKind.map((k) => ({ kind: k._id, count: k.n, pushed: k.pushed })), critical, criticalUnread },
    email7d: { byStatus: Object.fromEntries(emailByStatus.map((e) => [e._id, e.n])), failedByTemplate: emailByTemplate.map((t) => ({ template: t._id, failed: t.n })) },
    sosDelivery7d: alertDelivery.map((a) => ({ channel: a._id.c, outcome: a._id.o, count: a.n })),
  });
}));

// ================================================================== MFA overview for the security page
opsRouter.get('/admin/security/mfa-overview', ...admin, requirePermission('security:manage'), asyncHandler(async (_req, res) => {
  const privileged = await User.find({ role: { $in: ['admin', 'super_admin', 'security_officer', 'counsellor', 'committee_member', 'moderator'] }, accountStatus: { $ne: 'suspended' } }, { fullName: 1, email: 1, role: 1, mfaEnabled: 1, lastLoginAt: 1 }).sort({ role: 1, fullName: 1 }).lean();
  const configs = await TotpConfiguration.find({ userId: { $in: privileged.map((p) => p._id) }, status: 'active' }, { userId: 1, activeRecoverySetId: 1, activatedAt: 1, lastUsedAt: 1, lockedUntil: 1 }).lean();
  const remaining = await RecoveryCode.aggregate([
    { $match: { userId: { $in: privileged.map((p) => p._id) }, usedAt: null } },
    { $group: { _id: { u: '$userId', s: '$setId' }, n: { $sum: 1 } } },
  ]);
  const cmap = new Map(configs.map((c) => [String(c.userId), c]));
  ok(res, privileged.map((p) => {
    const c = cmap.get(String(p._id));
    const left = c ? remaining.find((r) => String(r._id.u) === String(p._id) && r._id.s === c.activeRecoverySetId)?.n ?? 0 : 0;
    return { id: String(p._id), name: p.fullName, email: p.email, role: p.role, mfaEnabled: p.mfaEnabled, activatedAt: c?.activatedAt ?? null, lastUsedAt: c?.lastUsedAt ?? null, recoveryCodesRemaining: c ? left : null, locked: Boolean(c?.lockedUntil && c.lockedUntil > new Date()), lastLoginAt: p.lastLoginAt };
  }));
}));
