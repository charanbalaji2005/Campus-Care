import type { Request } from 'express';
import { Types } from 'mongoose';
import {
  DUTY_ACTIVE_STATUSES, canTransitionDuty, hasPermission, type DutyActor, type DutyStatus, type Role,
} from '@campuscare/shared';
import { AppError, notFound } from '../lib/http';
import { DutyShift, DutyStatusEvent, ResponderAvailability, ResponderHeartbeat, type ResponderAvailabilityDoc } from '../models/duty';
import { User, type UserDoc } from '../models/user';
import { getSettings } from './settings.service';
import { audit } from './audit.service';
import { notifyMany } from './notification.service';
import { emitToRoom, emitToUser, evictFromRoom, registerRoomAuthoriser } from '../realtime/socket';
import { registerPeriodic } from './jobs.service';
import { logger } from '../lib/logger';

/**
 * Duty roster: the server-side source of truth for who is on duty.
 *
 * - Server time is the only clock. Device timestamps are never used for freshness.
 * - Every change passes DUTY_TRANSITIONS and the actor rules in canTransitionDuty().
 * - Changes are compare-and-set on the current status, so two concurrent requests cannot both win.
 * - A missing heartbeat makes a responder "stale" (unreachable) — never "off duty".
 */

const subject = (u: { role: string; permissions?: string[] }) => ({ role: u.role as Role, permissions: u.permissions ?? [] });
export const isResponder = (u: { role: string; permissions?: string[] }) => hasPermission(subject(u), 'sos:respond');

/**
 * IDs of security officers / responders who are currently on active duty (on_duty, busy, responding).
 * Responders who are off_duty, unavailable, or on_break are excluded.
 */
export async function onDutyResponderIds(): Promise<string[]> {
  const onDutyAvail = await ResponderAvailability.find(
    { status: { $in: ['on_duty', 'busy', 'responding'] } },
    { userId: 1 },
  ).lean();
  return onDutyAvail.map((a) => String(a.userId));
}

/** Security officers who are currently on active duty with an active user account. */
export async function onDutySecurityOfficers(): Promise<Array<{ _id: Types.ObjectId; email: string; fullName: string }>> {
  const ids = await onDutyResponderIds();
  if (!ids.length) return [];
  return User.find(
    { _id: { $in: ids }, role: 'security_officer', accountStatus: 'active' },
    { _id: 1, email: 1, fullName: 1 },
  ).lean() as unknown as Array<{ _id: Types.ObjectId; email: string; fullName: string }>;
}

registerRoomAuthoriser('duty', async (user) => hasPermission(subject(user), 'duty:view') || hasPermission(subject(user), 'duty:manage'));

/** Hooks registered by dispatch.service (avoids a circular import): what to do when a responder can no longer respond. */
type ResponderHook = (userId: string, reason: string) => Promise<void>;
const hooks: { unreachable: ResponderHook[]; removed: ResponderHook[] } = { unreachable: [], removed: [] };
export function onResponderUnreachable(fn: ResponderHook) { hooks.unreachable.push(fn); }
export function onResponderRemovedFromDuty(fn: ResponderHook) { hooks.removed.push(fn); }

export async function getAvailability(userId: string | Types.ObjectId): Promise<ResponderAvailabilityDoc> {
  const doc = await ResponderAvailability.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId, status: 'off_duty', statusChangedAt: new Date() } },
    { upsert: true, new: true },
  );
  return doc!;
}

export interface DutyChange {
  actor: DutyActor;
  actorId?: string | null;
  reason?: string | null;
  shiftId?: string | Types.ObjectId | null;
  alertId?: string | Types.ObjectId | null;
  /** Supervisor only: take a responder with open assignments off duty (their alerts are reassigned). */
  force?: boolean;
  req?: Request;
}

export function freshness(a: { status: string; lastHeartbeatAt?: Date | null }, staleThresholdSeconds: number, now = Date.now()) {
  if (!a.lastHeartbeatAt) return { fresh: false, ageSeconds: null as number | null };
  const ageSeconds = Math.max(0, Math.round((now - a.lastHeartbeatAt.getTime()) / 1000));
  return { fresh: ageSeconds <= staleThresholdSeconds, ageSeconds };
}

function publicAvailability(a: ResponderAvailabilityDoc | Record<string, unknown>, staleThresholdSeconds: number) {
  const x = a as ResponderAvailabilityDoc;
  const f = freshness(x, staleThresholdSeconds);
  return {
    userId: String(x.userId),
    status: x.status as DutyStatus,
    statusBeforeStale: (x.statusBeforeStale ?? null) as DutyStatus | null,
    staleSince: x.staleSince ?? null,
    campus: x.campus,
    zoneId: x.zoneId ? String(x.zoneId) : null,
    skills: x.skills ?? [],
    responsibilities: x.responsibilities ?? [],
    currentShiftId: x.currentShiftId ? String(x.currentShiftId) : null,
    lastHeartbeatAt: x.lastHeartbeatAt ?? null,
    heartbeatAgeSeconds: f.ageSeconds,
    heartbeatFresh: f.fresh,
    activeAssignmentCount: x.activeAssignmentCount ?? 0,
    lastAssignedAt: x.lastAssignedAt ?? null,
    locationConsent: Boolean(x.locationConsent),
    statusChangedAt: x.statusChangedAt ?? null,
  };
}
export { publicAvailability };

function broadcast(a: ResponderAvailabilityDoc, staleThresholdSeconds: number) {
  const payload = publicAvailability(a, staleThresholdSeconds);
  emitToRoom('duty:roster', 'duty:updated', payload);
  emitToUser(String(a.userId), 'duty:updated', payload);
}

/**
 * Change a responder's duty status. Throws 409 when the transition is not allowed or the status
 * changed underneath us, and 422 when a rule (shift window, open assignments, reason) is not met.
 */
export async function changeDutyStatus(userId: string, to: DutyStatus, change: DutyChange): Promise<ResponderAvailabilityDoc> {
  const s = await getSettings();
  const now = new Date();
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await getAvailability(userId);
    const from = current.status as DutyStatus;
    if (from === to) return current;
    if (!canTransitionDuty(from, to, change.actor)) {
      throw new AppError(409, 'invalid_transition', `Cannot change duty status from ${from.replace('_', ' ')} to ${to.replace('_', ' ')}.`);
    }
    if (change.actor === 'supervisor' && (!change.reason || change.reason.trim().length < 5)) {
      throw new AppError(422, 'reason_required', 'Record why you are changing this responder’s duty status.');
    }
    const leaving = to === 'off_duty' || to === 'unavailable';
    if (leaving && (current.activeAssignmentCount ?? 0) > 0) {
      if (change.actor === 'self') throw new AppError(409, 'open_assignments', 'Resolve or hand over your active emergency before going off duty.');
      if (change.actor === 'supervisor' && !change.force) {
        throw new AppError(409, 'open_assignments', 'This responder has an active emergency. Confirm the override to move their alerts to another responder.');
      }
    }
    if (change.actor === 'self' && from === 'off_duty' && to === 'on_duty' && !s.duty.allowDutyWithoutShift && !change.shiftId) {
      throw new AppError(422, 'shift_required', 'Start an accepted shift to go on duty.');
    }

    const set: Record<string, unknown> = { status: to, statusChangedAt: now };
    if (to === 'stale') {
      set.statusBeforeStale = from;
      set.staleSince = now;
    } else {
      set.statusBeforeStale = null;
      set.staleSince = null;
    }
    // The device itself asked (self) — that request is proof it is reachable right now.
    if (change.actor === 'self' && (DUTY_ACTIVE_STATUSES as string[]).includes(to)) set.lastHeartbeatAt = now;
    if (to === 'off_duty') {
      set.location = null;
      set.currentShiftId = null;
    }
    if (change.shiftId) set.currentShiftId = change.shiftId;
    if (change.actor === 'supervisor') set.approvedBy = change.actorId ?? null;

    // Compare-and-set on the status we read: a concurrent change makes this a no-op and we retry.
    const updated = await ResponderAvailability.findOneAndUpdate({ _id: current._id, status: from }, { $set: set }, { new: true });
    if (!updated) continue;

    await DutyStatusEvent.create({
      userId, from, to, actor: change.actor, actorId: change.actorId ?? null, reason: change.reason ?? null,
      shiftId: change.shiftId ?? null, alertId: change.alertId ?? null,
    });
    await audit({
      action: change.actor === 'supervisor' ? 'duty.manual_override' : 'duty.status_changed',
      actorId: change.actorId ?? null,
      req: change.req,
      targetType: 'responder',
      targetId: userId,
      reason: change.reason ?? null,
      meta: { from, to, actor: change.actor, force: Boolean(change.force), shiftId: change.shiftId ? String(change.shiftId) : null },
    });
    broadcast(updated, s.duty.staleThresholdSeconds);
    if (leaving) {
      evictFromRoom(String(userId), 'responders:all').catch(() => undefined);
    }
    if (leaving && (current.activeAssignmentCount ?? 0) > 0) {
      for (const h of hooks.removed) await h(userId, change.reason ?? `Responder went ${to.replace('_', ' ')}`).catch((err) => logger.error({ err: (err as Error).message }, 'duty hook failed'));
    }
    return updated;
  }
  throw new AppError(409, 'conflict', 'The duty status changed at the same time. Refresh and try again.');
}

// ------------------------------------------------------------------ heartbeats
export interface HeartbeatInput {
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
  locationAgeSeconds?: number;
  batteryPercent?: number;
  appVersion?: string;
}

/** Records a heartbeat at server time. Only accepted while the responder is in an active duty state (or stale). */
export async function recordHeartbeat(user: UserDoc, input: HeartbeatInput) {
  const s = await getSettings();
  const now = new Date();
  let a = await getAvailability(user._id);
  if (!(DUTY_ACTIVE_STATUSES as string[]).includes(a.status) && a.status !== 'stale') {
    throw new AppError(409, 'not_on_duty', 'You are not on duty, so heartbeats are not accepted. Start a shift first.');
  }
  // Location is stored only when the policy allows it and the responder consented.
  const locationAccepted = input.latitude != null && input.longitude != null && s.duty.responderLocationSharing && a.locationConsent;
  const set: Record<string, unknown> = { lastHeartbeatAt: now };
  if (locationAccepted) {
    const age = Math.min(input.locationAgeSeconds ?? 0, 3600);
    set.location = { latitude: input.latitude, longitude: input.longitude, accuracyMeters: input.accuracyMeters ?? null, at: new Date(now.getTime() - age * 1000) };
  }
  a = (await ResponderAvailability.findOneAndUpdate({ _id: a._id }, { $set: set }, { new: true }))!;
  await ResponderHeartbeat.create({
    userId: user._id, receivedAt: now, status: a.status, hasLocation: locationAccepted, accuracyMeters: locationAccepted ? input.accuracyMeters ?? null : null,
    batteryPercent: input.batteryPercent ?? null, appVersion: input.appVersion ?? null,
  });
  if (a.status === 'stale') {
    // Heartbeats are back: restore whatever the responder was doing before they became unreachable.
    const restore = (a.statusBeforeStale as DutyStatus | null) ?? 'on_duty';
    a = await changeDutyStatus(String(user._id), restore, { actor: 'system', reason: 'Heartbeat resumed' });
  } else {
    emitToRoom('duty:roster', 'duty:heartbeat', { userId: String(user._id), lastHeartbeatAt: now, status: a.status });
  }
  return {
    status: a.status as DutyStatus,
    serverTime: now.toISOString(),
    heartbeatIntervalSeconds: s.duty.heartbeatIntervalSeconds,
    staleThresholdSeconds: s.duty.staleThresholdSeconds,
    locationAccepted,
  };
}

/**
 * Marks active responders whose heartbeat stopped as stale. A responder who has just been put on duty
 * by a supervisor (no heartbeat yet) gets one stale-threshold of grace from the status change.
 */
export async function sweepStaleResponders(now = Date.now()): Promise<number> {
  const s = await getSettings();
  const cutoff = new Date(now - s.duty.staleThresholdSeconds * 1000);
  const candidates = await ResponderAvailability.find({
    status: { $in: DUTY_ACTIVE_STATUSES },
    statusChangedAt: { $lt: cutoff },
    $or: [{ lastHeartbeatAt: null }, { lastHeartbeatAt: { $lt: cutoff } }],
  }).limit(200);
  let count = 0;
  for (const c of candidates) {
    try {
      await changeDutyStatus(String(c.userId), 'stale', { actor: 'system', reason: `No heartbeat for over ${s.duty.staleThresholdSeconds} seconds` });
      count++;
      for (const h of hooks.unreachable) await h(String(c.userId), 'Responder heartbeat went stale').catch((err) => logger.error({ err: (err as Error).message }, 'stale hook failed'));
      if (s.duty.notifySupervisorsOnStale) {
        const responder = await User.findById(c.userId, { fullName: 1 }).lean();
        const supervisors = await dutySupervisors();
        await notifyMany(supervisors, {
          kind: 'duty_stale', priority: (c.activeAssignmentCount ?? 0) > 0 ? 'critical' : 'high',
          title: `${responder?.fullName ?? 'A responder'} is unreachable`,
          body: (c.activeAssignmentCount ?? 0) > 0 ? 'Their heartbeat stopped while handling an emergency. Check on them and the alert.' : 'Their duty heartbeat stopped. They are shown as stale, not off duty.',
          link: '/super-admin/duty-roster',
        });
      }
    } catch (err) {
      if (!(err instanceof AppError)) logger.error({ err: (err as Error).message }, 'stale sweep failed');
    }
  }
  return count;
}

/** People who receive operational duty alerts: anyone with duty:manage, plus responders with the supervisor responsibility. */
export async function dutySupervisors(): Promise<string[]> {
  const users = await User.find({ accountStatus: 'active', $or: [{ role: 'super_admin' }, { permissions: 'duty:manage' }] }, { _id: 1, role: 1, permissions: 1 }).lean();
  const ids = new Set(users.filter((u) => hasPermission(subject(u), 'duty:manage')).map((u) => String(u._id)));
  const sup = await ResponderAvailability.find({ responsibilities: 'supervisor' }, { userId: 1 }).lean();
  sup.forEach((x) => ids.add(String(x.userId)));
  return [...ids];
}

// ------------------------------------------------------------------ shifts
async function assertNoOverlap(responderId: string, startAt: Date, endAt: Date, exceptId?: string) {
  const clash = await DutyShift.exists({
    responderId,
    status: { $in: ['offered', 'accepted', 'active'] },
    startAt: { $lt: endAt },
    endAt: { $gt: startAt },
    ...(exceptId ? { _id: { $ne: exceptId } } : {}),
  });
  if (clash) throw new AppError(409, 'shift_overlap', 'This responder already has a shift that overlaps that time.');
}

export async function createShift(actor: UserDoc, input: { responderId: string; startAt: Date; endAt: Date; campus: string; zoneId?: string | null; notes?: string; assignDirectly: boolean }, req?: Request) {
  const responder = await User.findOne({ _id: input.responderId, accountStatus: 'active' });
  if (!responder || !isResponder(responder)) throw new AppError(422, 'validation_failed', 'Choose an active responder.', { fields: { responderId: 'Not an active responder' } });
  if (input.endAt.getTime() < Date.now()) throw new AppError(422, 'validation_failed', 'That shift has already ended.', { fields: { endAt: 'In the past' } });
  await assertNoOverlap(input.responderId, input.startAt, input.endAt);
  const shift = await DutyShift.create({
    responderId: responder._id, campus: input.campus, zoneId: input.zoneId ?? null, startAt: input.startAt, endAt: input.endAt, notes: input.notes ?? null,
    createdBy: actor._id, status: input.assignDirectly ? 'accepted' : 'offered',
    assignedBy: input.assignDirectly ? actor._id : null, acceptedAt: input.assignDirectly ? new Date() : null,
  });
  await audit({ action: input.assignDirectly ? 'duty.shift_assigned' : 'duty.shift_offered', req, targetType: 'duty_shift', targetId: String(shift._id), meta: { responderId: input.responderId, startAt: input.startAt, endAt: input.endAt, campus: input.campus } });
  await notifyMany([String(responder._id)], {
    kind: 'duty_shift', priority: 'high',
    title: input.assignDirectly ? 'You have been assigned a shift' : 'New shift offered',
    body: `${input.startAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} – ${input.endAt.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', timeStyle: 'short' })}`,
    link: '/security/duty',
  });
  emitToRoom('duty:roster', 'duty:shift', { id: String(shift._id), status: shift.status });
  return shift;
}

async function loadOwnShift(user: UserDoc, shiftId: string) {
  if (!Types.ObjectId.isValid(shiftId)) throw notFound();
  const shift = await DutyShift.findOne({ _id: shiftId, responderId: user._id });
  if (!shift) throw notFound();
  return shift;
}

export async function decideShift(user: UserDoc, shiftId: string, decision: 'accept' | 'decline', reason: string | undefined, req?: Request) {
  const shift = await loadOwnShift(user, shiftId);
  const updated = await DutyShift.findOneAndUpdate(
    { _id: shift._id, status: 'offered' },
    decision === 'accept' ? { $set: { status: 'accepted', acceptedAt: new Date() } } : { $set: { status: 'declined', declinedReason: reason ?? null } },
    { new: true },
  );
  if (!updated) throw new AppError(409, 'invalid_state', 'This shift is no longer waiting for your answer.');
  await audit({ action: `duty.shift_${decision === 'accept' ? 'accepted' : 'declined'}`, req, targetType: 'duty_shift', targetId: shiftId, reason: reason ?? null });
  emitToRoom('duty:roster', 'duty:shift', { id: shiftId, status: updated.status });
  if (decision === 'decline') {
    await notifyMany(await dutySupervisors(), { kind: 'duty_shift', priority: 'high', title: `${user.fullName} declined a shift`, body: 'The shift needs another responder.', link: '/super-admin/duty-roster' });
  }
  return updated;
}

/** The officer confirms the start of duty. The server checks the account, permission and shift window. */
export async function startShift(user: UserDoc, shiftId: string, req?: Request) {
  if (user.accountStatus !== 'active' || !isResponder(user) || !hasPermission(subject(user), 'duty:self')) {
    throw new AppError(403, 'forbidden', 'Your account is not permitted to go on duty.');
  }
  const s = await getSettings();
  const shift = await loadOwnShift(user, shiftId);
  const now = Date.now();
  if (shift.status !== 'accepted') throw new AppError(409, 'invalid_state', shift.status === 'offered' ? 'Accept the shift before starting it.' : 'This shift cannot be started.');
  if (now < shift.startAt.getTime() - s.duty.shiftStartGraceMinutes * 60_000) throw new AppError(422, 'too_early', `You can start this shift from ${s.duty.shiftStartGraceMinutes} minutes before it begins.`);
  if (now >= shift.endAt.getTime()) throw new AppError(422, 'shift_ended', 'This shift has already ended.');
  const claimed = await DutyShift.findOneAndUpdate({ _id: shift._id, status: 'accepted' }, { $set: { status: 'active', startedAt: new Date() } }, { new: true });
  if (!claimed) throw new AppError(409, 'invalid_state', 'This shift was changed at the same time. Refresh and try again.');
  await ResponderAvailability.updateOne({ userId: user._id }, { $set: { campus: shift.campus, ...(shift.zoneId ? { zoneId: shift.zoneId } : {}) } });
  try {
    const a = await getAvailability(user._id);
    const target: DutyStatus = 'on_duty';
    if (a.status !== target) {
      // From stale/break/busy a new shift simply means "available"; system makes that move when self cannot.
      const actor: DutyActor = canTransitionDuty(a.status as DutyStatus, target, 'self') ? 'self' : 'system';
      await changeDutyStatus(String(user._id), target, { actor, actorId: String(user._id), shiftId: shift._id, reason: 'Shift started', req });
    } else {
      await ResponderAvailability.updateOne({ _id: a._id }, { $set: { currentShiftId: shift._id, lastHeartbeatAt: new Date() } });
    }
  } catch (err) {
    await DutyShift.updateOne({ _id: shift._id, status: 'active' }, { $set: { status: 'accepted', startedAt: null } }); // roll back
    throw err;
  }
  await audit({ action: 'duty.shift_started', req, targetType: 'duty_shift', targetId: shiftId });
  return claimed;
}

export async function endShift(shiftId: string, by: { actor: DutyActor; actorId?: string | null; reason: string; req?: Request; force?: boolean }) {
  if (!Types.ObjectId.isValid(shiftId)) throw notFound();
  const shift = await DutyShift.findById(shiftId);
  if (!shift) throw notFound();
  if (shift.status !== 'active') throw new AppError(409, 'invalid_state', 'Only an active shift can be ended.');
  const a = await getAvailability(shift.responderId);
  if (a.status !== 'off_duty' && String(a.currentShiftId ?? '') === String(shift._id)) {
    await changeDutyStatus(String(shift.responderId), 'off_duty', { actor: by.actor, actorId: by.actorId, reason: by.reason, shiftId: shift._id, req: by.req, force: by.force });
  }
  shift.status = 'completed';
  shift.endedAt = new Date();
  shift.endReason = by.reason;
  await shift.save();
  await audit({ action: 'duty.shift_ended', actorId: by.actorId ?? null, req: by.req, targetType: 'duty_shift', targetId: shiftId, reason: by.reason, meta: { actor: by.actor } });
  emitToRoom('duty:roster', 'duty:shift', { id: shiftId, status: shift.status });
  return shift;
}

/** Shift lifecycle: end shifts that are over (unless the responder is mid-emergency) and mark unstarted ones missed. */
export async function sweepShifts(now = Date.now()) {
  const nowDate = new Date(now);
  const missed = await DutyShift.updateMany({ status: { $in: ['offered', 'accepted'] }, endAt: { $lte: nowDate } }, { $set: { status: 'missed' } });
  const over = await DutyShift.find({ status: 'active', endAt: { $lte: nowDate } }).limit(100);
  let ended = 0;
  for (const shift of over) {
    const a = await getAvailability(shift.responderId);
    if ((a.activeAssignmentCount ?? 0) > 0) continue; // finish the emergency first; retried on the next sweep
    try {
      await endShift(String(shift._id), { actor: 'system', reason: 'Scheduled shift end' });
      ended++;
    } catch (err) {
      logger.warn({ err: (err as Error).message, shift: String(shift._id) }, 'could not end shift');
    }
  }
  return { missed: missed.modifiedCount, ended };
}

registerPeriodic('duty-stale-sweep', 10_000, async () => { await sweepStaleResponders(); });
registerPeriodic('duty-shift-sweep', 30_000, async () => { await sweepShifts(); });
