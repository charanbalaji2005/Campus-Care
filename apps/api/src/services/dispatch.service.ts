import type { Request } from 'express';
import { Types } from 'mongoose';
import { SOS_ACKNOWLEDGEABLE_STATUSES, hasPermission, type DutyStatus, type Role } from '@campuscare/shared';
import { AppError, notFound } from '../lib/http';
import { AlertAssignment, AlertDeliveryEvent, EmergencyAlert, EmergencyRecipient, type AlertAssignmentDoc } from '../models/safety';
import { ResponderAvailability, ResponseZone } from '../models/duty';
import { User, type UserDoc } from '../models/user';
import { getSettings } from './settings.service';
import { audit } from './audit.service';
import { notify } from './notification.service';
import { appLink, sendEmail } from './email/email.service';
import { emitToRoom, emitToUser, registerRoomAuthoriser } from '../realtime/socket';
import { registerPeriodic } from './jobs.service';
import { changeDutyStatus, dutySupervisors, getAvailability, isResponder, onResponderRemovedFromDuty, onResponderUnreachable } from './duty.service';
import { rankResponders, zoneForLocation, type DispatchCandidate, type DispatchRules } from './dispatch.policy';
import { logger } from '../lib/logger';

/**
 * SOS dispatch: chooses responders, offers them the alert with an acknowledgement deadline,
 * and escalates on decline / timeout / unreachability until someone acknowledges.
 *
 * Concurrency guarantees (no transactions needed, so this also holds on a standalone MongoDB):
 * - a responder's capacity is reserved with one conditional $inc (activeAssignmentCount < max);
 * - partial unique indexes allow one open assignment per (alert, slot) and per (alert, responder);
 * - the alert is acknowledged by exactly one compare-and-set on its status;
 * - every expiry/decline/close is a compare-and-set on the assignment status, so the matching
 *   capacity release happens exactly once.
 */

const subject = (u: { role: string; permissions?: string[] }) => ({ role: u.role as Role, permissions: u.permissions ?? [] });
const ACKABLE = [...SOS_ACKNOWLEDGEABLE_STATUSES] as string[];

// ops:alerts carries alert ids/states for dispatchers; ops:livemap only says "something moved" so the
// map refetches through the audited HTTP endpoint (no coordinates over the socket).
registerRoomAuthoriser('ops', async (user, id) => {
  const sub = subject(user);
  if (id === 'alerts') return hasPermission(sub, 'sos:dispatch') || hasPermission(sub, 'duty:manage');
  if (id === 'livemap') return hasPermission(sub, 'location:view_live') || hasPermission(sub, 'sos:dispatch') || hasPermission(sub, 'duty:view');
  return false;
});

function opsEmit(alertId: unknown, extra: Record<string, unknown> = {}) {
  emitToRoom('ops:alerts', 'ops:alert', { id: String(alertId), ...extra });
}

async function pushEvent(alertId: unknown, type: string, opts: { actorId?: string | null; actorLabel?: string | null; note?: string | null; studentVisible?: boolean } = {}) {
  await EmergencyAlert.updateOne(
    { _id: alertId },
    { $push: { events: { type, at: new Date(), actorId: opts.actorId ?? null, actorLabel: opts.actorLabel ?? null, note: opts.note ?? null, studentVisible: opts.studentVisible ?? false } } },
  );
}

export function dispatchRules(s: Awaited<ReturnType<typeof getSettings>>): DispatchRules {
  return {
    staleThresholdSeconds: s.duty.staleThresholdSeconds,
    maxActiveAssignmentsPerResponder: s.dispatch.maxActiveAssignmentsPerResponder,
    allowBusyResponders: s.dispatch.allowBusyResponders,
    requiredSkills: s.dispatch.requiredSkills,
    preferredSkills: s.dispatch.preferredSkills,
    trustedLocationAccuracyMeters: s.dispatch.trustedLocationAccuracyMeters,
    proximityBandMeters: s.dispatch.proximityBandMeters,
  };
}

/** Every account that can respond to SOS, with its current duty state. */
export async function loadCandidates(): Promise<DispatchCandidate[]> {
  const users = await User.find({ $or: [{ role: 'security_officer' }, { permissions: 'sos:respond' }] }, { fullName: 1, role: 1, permissions: 1, accountStatus: 1 }).lean();
  const avail = await ResponderAvailability.find({ userId: { $in: users.map((u) => u._id) } }).lean();
  const map = new Map(avail.map((a) => [String(a.userId), a]));
  return users.map((u) => {
    const a = map.get(String(u._id));
    return {
      userId: String(u._id),
      name: u.fullName,
      status: (a?.status ?? 'off_duty') as DutyStatus,
      lastHeartbeatAt: a?.lastHeartbeatAt ?? null,
      campus: a?.campus ?? 'main',
      zoneId: a?.zoneId ? String(a.zoneId) : null,
      skills: a?.skills ?? [],
      responsibilities: a?.responsibilities ?? ['sos_response'],
      activeAssignmentCount: a?.activeAssignmentCount ?? 0,
      lastAssignedAt: a?.lastAssignedAt ?? null,
      location: a?.location ? { latitude: a.location.latitude, longitude: a.location.longitude, accuracyMeters: a.location.accuracyMeters ?? null, at: a.location.at } : null,
      accountActive: u.accountStatus === 'active',
      canRespond: hasPermission(subject(u), 'sos:respond'),
    };
  });
}

/** Releases one unit of a responder's capacity; a responder with nothing left to do goes back on duty. */
export async function releaseResponder(userId: string | Types.ObjectId, alertId?: unknown) {
  const a = await ResponderAvailability.findOneAndUpdate({ userId, activeAssignmentCount: { $gt: 0 } }, { $inc: { activeAssignmentCount: -1 } }, { new: true });
  if (a && a.activeAssignmentCount === 0 && a.status === 'responding') {
    await changeDutyStatus(String(userId), 'on_duty', { actor: 'system', reason: 'Emergency closed', alertId: alertId ? String(alertId) : null }).catch(() => undefined);
  }
}

/** Closes one open assignment exactly once (compare-and-set) and releases the responder's capacity. */
async function closeAssignment(assignmentId: unknown, from: string[], to: string, reason: string): Promise<AlertAssignmentDoc | null> {
  const closed = await AlertAssignment.findOneAndUpdate(
    { _id: assignmentId, open: true, status: { $in: from } },
    { $set: { status: to, closedAt: new Date(), closeReason: reason.slice(0, 500) }, $unset: { open: 1 } },
    { new: true },
  );
  if (closed) await releaseResponder(closed.responderId, closed.alertId);
  return closed;
}

async function notifyAssignee(assignment: AlertAssignmentDoc, alert: { _id: unknown; alertNumber: string }) {
  const responderId = String(assignment.responderId);
  try {
    const n = await notify({
      userId: responderId, kind: 'sos_assignment', priority: 'critical', awaitPush: true,
      title: `SOS ${alert.alertNumber} assigned to you`,
      body: 'Acknowledge now — the alert moves to another responder if you do not.',
      link: `/security/alerts/${alert._id}`,
    });
    await AlertDeliveryEvent.create({ alertId: alert._id, assignmentId: assignment._id, channel: 'in_app', recipient: responderId, outcome: 'delivered' });
    if (n.push) {
      await AlertDeliveryEvent.create({
        alertId: alert._id, assignmentId: assignment._id, channel: 'push', recipient: responderId,
        outcome: !n.push.configured ? 'not_configured' : n.push.sent > 0 ? 'accepted' : 'failed',
        error: n.push.error ?? (n.push.configured && n.push.sent === 0 ? 'No registered device accepted the push' : null),
      });
    }
  } catch (err) {
    await AlertDeliveryEvent.create({ alertId: alert._id, assignmentId: assignment._id, channel: 'in_app', recipient: responderId, outcome: 'failed', error: (err as Error).message.slice(0, 200) });
  }

  // Priority On-Duty Alert Email: send specifically to the chosen on-duty responder who holds the assignment
  try {
    const responderUser = await User.findById(responderId, { email: 1, fullName: 1 }).lean();
    if (responderUser?.email) {
      const fullAlert = await EmergencyAlert.findById(alert._id, { alertNumber: 1, createdAt: 1, latitude: 1, longitude: 1, accuracyMeters: 1 }).lean();
      const locationText = fullAlert?.latitude != null
        ? `${fullAlert.latitude.toFixed(5)}, ${fullAlert.longitude!.toFixed(5)} (±${Math.round(fullAlert.accuracyMeters ?? 0)} m)`
        : 'Unavailable';
      await sendEmail(
        'sos_alert',
        responderUser.email,
        {
          alertNumber: alert.alertNumber,
          time: (fullAlert?.createdAt ?? new Date()).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
          studentName: 'A student',
          locationText,
          link: appLink(`/security/alerts/${alert._id}`),
        },
        `sos-assigned:${alert._id}:${responderUser.email}`,
      );
      await AlertDeliveryEvent.create({
        alertId: alert._id,
        assignmentId: assignment._id,
        channel: 'email',
        recipient: responderUser.email.replace(/^(.).*@/, '$1***@'),
        outcome: 'accepted',
      });
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message, responderId }, 'Could not send on-duty priority alert email to assigned responder');
  }

  emitToUser(responderId, 'sos:assigned', { alertId: String(alert._id), alertNumber: alert.alertNumber, assignmentId: String(assignment._id), ackDeadlineAt: assignment.ackDeadlineAt });
}

/** People alerted when dispatch finds nobody: backup recipients, supervisors, every active officer and dispatchers. */
async function fallbackRecipients() {
  const backup = await EmergencyRecipient.find({ active: true, tier: 'backup' }).lean();
  const ids = new Set<string>(backup.filter((r) => r.type === 'user' && r.userId).map((r) => String(r.userId)));
  (await dutySupervisors()).forEach((id) => ids.add(id));
  const others = await User.find({ accountStatus: 'active', $or: [{ role: { $in: ['security_officer', 'super_admin'] } }, { permissions: { $in: ['sos:dispatch', 'sos:respond'] } }] }, { _id: 1, role: 1, permissions: 1 }).lean();
  others.filter((u) => hasPermission(subject(u), 'sos:respond') || hasPermission(subject(u), 'sos:dispatch')).forEach((u) => ids.add(String(u._id)));
  return { userIds: [...ids], emails: backup.filter((r) => r.type === 'email' && r.email).map((r) => r.email!) };
}

async function enterFallback(alertId: unknown, why: string) {
  const now = new Date();
  // Only the first caller transitions to "unassigned" and notifies; later sweeps just retry assignment.
  const alert = await EmergencyAlert.findOneAndUpdate(
    { _id: alertId, status: { $in: ACKABLE }, assignmentState: { $nin: ['unassigned', 'acknowledged'] } },
    { $set: { assignmentState: 'unassigned', unassignedSince: now, lastAssignmentAttemptAt: now } },
    { new: true },
  );
  if (!alert) {
    await EmergencyAlert.updateOne({ _id: alertId }, { $set: { lastAssignmentAttemptAt: now } });
    return;
  }
  await pushEvent(alert._id, 'no_eligible_responder', { actorLabel: 'Dispatch', note: why });
  const { userIds, emails } = await fallbackRecipients();
  for (const uid of userIds) {
    try {
      await notify({ userId: uid, kind: 'sos', priority: 'critical', title: `UNASSIGNED SOS ${alert.alertNumber}`, body: 'No eligible on-duty responder could be assigned. Respond or dispatch someone now.', link: `/security/alerts/${alert._id}` });
      await AlertDeliveryEvent.create({ alertId: alert._id, channel: 'in_app', recipient: uid, outcome: 'delivered' });
    } catch (err) {
      await AlertDeliveryEvent.create({ alertId: alert._id, channel: 'in_app', recipient: uid, outcome: 'failed', error: (err as Error).message.slice(0, 200) });
    }
  }
  for (const to of new Set(emails)) {
    await sendEmail('sos_alert', to, {
      alertNumber: alert.alertNumber, time: alert.createdAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }), studentName: 'A student',
      locationText: alert.latitude != null ? `${alert.latitude.toFixed(5)}, ${alert.longitude!.toFixed(5)} (±${Math.round(alert.accuracyMeters ?? 0)} m)` : 'Unavailable', link: appLink(`/security/alerts/${alert._id}`),
    }, `sos-unassigned:${alert._id}:${to}`);
    await AlertDeliveryEvent.create({ alertId: alert._id, channel: 'email', recipient: to.replace(/^(.).*@/, '$1***@'), outcome: 'queued' });
  }
  await audit({ action: 'sos.unassigned', targetType: 'sos', targetId: String(alert._id), reason: why, meta: { fallbackRecipients: userIds.length + emails.length } });
  emitToRoom('responders:all', 'sos:unassigned', { id: String(alert._id), alertNumber: alert.alertNumber });
  opsEmit(alert._id, { assignmentState: 'unassigned' });
}

export interface AssignOptions {
  reason: string;
  actorId?: string | null;
  req?: Request;
  /** Manual dispatch to a named responder (bypasses ranking and capacity, not basic safety checks). */
  targetResponderId?: string;
  manual?: boolean;
}

/**
 * Fills the alert's free assignment slots with the best eligible responders. Safe to call
 * concurrently and repeatedly: reservations and slots are claimed atomically.
 */
export async function runAssignment(alertId: string, opts: AssignOptions): Promise<{ assigned: string[]; unassigned: boolean }> {
  const s = await getSettings();
  const alert = await EmergencyAlert.findById(alertId);
  if (!alert || !ACKABLE.includes(alert.status) || !alert.dispatchedAt) return { assigned: [], unassigned: false };
  if (!s.dispatch.autoAssign && !opts.manual) return { assigned: [], unassigned: false };
  const now = Date.now();

  // Zone: only from a location precise enough to place the alert inside one.
  if (!alert.zoneId && alert.latitude != null) {
    const zones = await ResponseZone.find({ active: true, campus: alert.campus }).lean();
    const zone = zoneForLocation(
      { latitude: alert.latitude ?? null, longitude: alert.longitude ?? null, accuracyMeters: alert.accuracyMeters ?? null },
      zones.map((z) => ({ ...z, id: String(z._id) })),
      s.dispatch.trustedLocationAccuracyMeters,
    );
    if (zone) await EmergencyAlert.updateOne({ _id: alert._id }, { $set: { zoneId: zone._id } });
    if (zone) alert.zoneId = zone._id;
  }

  const open = await AlertAssignment.find({ alertId: alert._id, open: true }).lean();
  const slotCount = s.dispatch.policy === 'group' ? s.dispatch.groupSize : 1;
  const usedSlots = new Set(open.map((a) => a.slot));
  const freeSlots = Array.from({ length: slotCount }, (_, i) => i).filter((i) => !usedSlots.has(i));
  if (opts.manual && opts.targetResponderId && !freeSlots.length) {
    // A dispatcher's explicit choice replaces the current offer(s).
    for (const a of open.filter((x) => x.status === 'offered')) await closeAssignment(a._id, ['offered'], 'superseded', 'Replaced by manual assignment');
    return runAssignment(alertId, opts);
  }
  if (!freeSlots.length) return { assigned: [], unassigned: false };

  const tried = await AlertAssignment.distinct('responderId', { alertId: alert._id });
  const rules = dispatchRules(s);
  let ordered: { candidate: DispatchCandidate; explanation: string }[];
  if (opts.targetResponderId) {
    const target = (await loadCandidates()).find((c) => c.userId === opts.targetResponderId);
    if (!target || !target.accountActive || !target.canRespond) throw new AppError(422, 'validation_failed', 'Choose an active responder.');
    if (target.status === 'off_duty' || target.status === 'unavailable') throw new AppError(422, 'responder_unavailable', 'That responder is off duty or unavailable.');
    if (open.some((a) => String(a.responderId) === target.userId)) throw new AppError(409, 'already_assigned', 'That responder already holds this alert.');
    ordered = [{ candidate: target, explanation: `Manually assigned${target.status === 'stale' ? ' (heartbeat stale)' : ''}` }];
  } else {
    const { ranked } = rankResponders(await loadCandidates(), {
      campus: alert.campus ?? 'main', zoneId: alert.zoneId ? String(alert.zoneId) : null,
      latitude: alert.latitude ?? null, longitude: alert.longitude ?? null, accuracyMeters: alert.accuracyMeters ?? null,
      excludedResponderIds: new Set(tried.map(String)),
    }, rules, now);
    ordered = ranked;
  }

  const freshCutoff = new Date(now - s.duty.staleThresholdSeconds * 1000);
  const eligibleStatuses = s.dispatch.allowBusyResponders ? ['on_duty', 'busy'] : ['on_duty'];
  const assigned: string[] = [];
  let next = 0;
  for (const slot of freeSlots) {
    while (next < ordered.length) {
      const { candidate, explanation } = ordered[next++]!;
      // 1. Reserve capacity atomically. Manual assignment skips the capacity/freshness filter but still counts.
      const reservation = opts.targetResponderId
        ? await ResponderAvailability.findOneAndUpdate({ userId: candidate.userId }, { $inc: { activeAssignmentCount: 1 }, $set: { lastAssignedAt: new Date() } }, { new: true, upsert: true })
        : await ResponderAvailability.findOneAndUpdate(
          { userId: candidate.userId, status: { $in: eligibleStatuses }, lastHeartbeatAt: { $gte: freshCutoff }, activeAssignmentCount: { $lt: s.dispatch.maxActiveAssignmentsPerResponder } },
          { $inc: { activeAssignmentCount: 1 }, $set: { lastAssignedAt: new Date() } },
          { new: true },
        );
      if (!reservation) continue; // lost a race for this responder — try the next one

      // 2. Claim the slot. The unique indexes reject a duplicate created concurrently.
      let assignment: AlertAssignmentDoc;
      try {
        const attempt = (await AlertAssignment.countDocuments({ alertId: alert._id })) + 1;
        assignment = await AlertAssignment.create({
          alertId: alert._id, responderId: candidate.userId, status: 'offered', open: true, slot, attempt, policy: s.dispatch.policy,
          assignedBy: opts.actorId ?? null, assignReason: opts.reason.slice(0, 500), rankExplanation: explanation.slice(0, 500),
          ackDeadlineAt: new Date(Date.now() + s.dispatch.ackDeadlineSeconds * 1000),
        });
      } catch (err) {
        await releaseResponder(candidate.userId);
        if ((err as { code?: number }).code === 11000) {
          if (String((err as Error).message).includes('slot')) break; // someone else filled this slot
          continue;
        }
        throw err;
      }

      // 3. The alert may have been acknowledged or cancelled while we worked — never leave a dangling offer.
      const fresh = await EmergencyAlert.findOneAndUpdate(
        { _id: alert._id, status: { $in: ACKABLE } },
        { $set: { assignmentState: 'offered', unassignedSince: null, lastAssignmentAttemptAt: new Date() }, $inc: { assignmentAttempts: 1 } },
        { new: true },
      );
      if (!fresh) {
        await closeAssignment(assignment._id, ['offered'], 'superseded', 'Alert no longer needs a responder');
        return { assigned, unassigned: false };
      }
      assigned.push(candidate.userId);
      await pushEvent(alert._id, opts.manual ? 'assigned_manually' : 'assigned', { actorId: opts.actorId ?? null, actorLabel: candidate.name ?? 'Responder', note: explanation });
      await audit({
        action: opts.manual ? 'sos.assigned_manually' : 'sos.assigned', actorId: opts.actorId ?? null, req: opts.req,
        targetType: 'sos', targetId: String(alert._id), reason: opts.manual ? opts.reason : null,
        meta: { responderId: candidate.userId, slot, attempt: assignment.attempt, policy: s.dispatch.policy, ackDeadlineSeconds: s.dispatch.ackDeadlineSeconds },
      });
      await notifyAssignee(assignment, fresh);
      opsEmit(alert._id, { assignmentState: 'offered' });
      break;
    }
  }

  if (!assigned.length && !open.length) {
    const why = ordered.length ? 'All eligible responders were taken by other alerts' : 'No on-duty, reachable, qualified responder is available';
    await enterFallback(alert._id, why);
    return { assigned, unassigned: true };
  }
  const attempts = (await EmergencyAlert.findById(alert._id, { assignmentAttempts: 1 }).lean())?.assignmentAttempts ?? 0;
  if (attempts >= s.dispatch.maxAttempts && !opts.manual) {
    // Keep trying, but make sure the fallback group knows this alert is struggling.
    await enterFallback(alert._id, `No acknowledgement after ${attempts} assignment attempts`);
  }
  return { assigned, unassigned: false };
}

/** Moves a pending (countdown) alert to dispatched exactly once. Returns null if it was cancelled first. */
export async function claimDispatch(alertId: string, opts: { force?: boolean } = {}) {
  const now = new Date();
  return EmergencyAlert.findOneAndUpdate(
    { _id: alertId, status: 'pending', ...(opts.force ? {} : { dispatchAt: { $lte: now } }) },
    {
      $set: { status: 'queued', dispatchedAt: now },
      $push: { events: { type: 'dispatched', at: now, actorLabel: 'CampusCare', studentVisible: true } },
    },
    { new: true },
  );
}

// ------------------------------------------------------------------ responder actions
export async function acknowledgeAlert(alertId: string, responder: UserDoc, req?: Request) {
  if (!Types.ObjectId.isValid(alertId)) throw notFound();
  const name = responder.fullName.split(' ')[0];
  const now = new Date();
  // Exactly one responder wins the acknowledgement.
  const alert = await EmergencyAlert.findOneAndUpdate(
    { _id: alertId, status: { $in: ACKABLE }, dispatchedAt: { $ne: null } },
    {
      $set: { status: 'acknowledged', acknowledgedBy: responder._id, acknowledgedAt: now, assignedTo: responder._id, assignmentState: 'acknowledged', unassignedSince: null },
      $push: { events: { type: 'acknowledged', at: now, actorId: responder._id, actorLabel: `${name} (Campus Security)`, studentVisible: true } },
    },
    { new: true },
  );
  if (!alert) {
    const existing = await EmergencyAlert.findById(alertId).lean();
    if (!existing) throw notFound();
    if (existing.status === 'acknowledged' && String(existing.acknowledgedBy) === String(responder._id)) return existing; // idempotent retry
    throw new AppError(409, 'already_handled', 'This alert was already acknowledged, resolved or cancelled.');
  }

  let own = await AlertAssignment.findOneAndUpdate(
    { alertId: alert._id, responderId: responder._id, open: true, status: 'offered' },
    { $set: { status: 'acknowledged', acknowledgedAt: now } },
    { new: true },
  );
  const viaOffer = Boolean(own);
  // Close every other open offer: the alert is owned now.
  const others = await AlertAssignment.find({ alertId: alert._id, open: true, status: 'offered', responderId: { $ne: responder._id } }).lean();
  for (const o of others) {
    const closed = await closeAssignment(o._id, ['offered'], 'superseded', `Acknowledged by ${name}`);
    if (closed) emitToUser(String(closed.responderId), 'sos:assignment_closed', { alertId: String(alert._id), reason: 'acknowledged_by_other' });
  }
  if (!own) {
    // A responder who was not offered this alert took it: record that as an acknowledged assignment.
    await ResponderAvailability.updateOne({ userId: responder._id }, { $inc: { activeAssignmentCount: 1 }, $set: { lastAssignedAt: now } }, { upsert: true });
    for (let i = 0; i < 3 && !own; i++) {
      try {
        own = await AlertAssignment.create({
          alertId: alert._id, responderId: responder._id, status: 'acknowledged', open: true, slot: 0, attempt: alert.assignmentAttempts + 1,
          policy: 'single', assignReason: 'Acknowledged without an offer', ackDeadlineAt: now, acknowledgedAt: now, offeredAt: now,
        });
      } catch (err) {
        if ((err as { code?: number }).code !== 11000) throw err;
        // A late offer slipped in; it is moot now that the alert is acknowledged.
        const stray = await AlertAssignment.find({ alertId: alert._id, open: true, status: 'offered' }).lean();
        for (const st of stray) await closeAssignment(st._id, ['offered'], 'superseded', `Acknowledged by ${name}`);
      }
    }
  }

  const a = await getAvailability(responder._id);
  if (['on_duty', 'busy', 'stale'].includes(a.status)) {
    await changeDutyStatus(String(responder._id), 'responding', { actor: 'system', reason: `Acknowledged SOS ${alert.alertNumber}`, alertId: alert._id }).catch(() => undefined);
  } else if (a.status !== 'responding') {
    await pushEvent(alert._id, 'acknowledged_off_roster', { actorId: String(responder._id), actorLabel: name, note: `Responder was ${a.status.replace('_', ' ')} when they acknowledged` });
  }
  await audit({ action: 'sos.acknowledged', req, targetType: 'sos', targetId: String(alert._id), meta: { secondsToAck: Math.round((now.getTime() - (alert.dispatchedAt ?? alert.createdAt).getTime()) / 1000), viaOffer } });
  await notify({ userId: String(alert.userId), kind: 'sos', priority: 'critical', title: 'Help is responding', body: `${name} from Campus Security acknowledged your SOS.`, link: `/student/emergency?alert=${alert._id}` });
  opsEmit(alert._id, { status: 'acknowledged', assignmentState: 'acknowledged' });
  return alert;
}

export async function declineAssignment(alertId: string, responder: UserDoc, reason: string, req?: Request) {
  if (!Types.ObjectId.isValid(alertId)) throw notFound();
  const offer = await AlertAssignment.findOne({ alertId, responderId: responder._id, open: true, status: 'offered' });
  if (!offer) throw new AppError(409, 'no_offer', 'You have no pending assignment for this alert.');
  const closed = await closeAssignment(offer._id, ['offered'], 'declined', reason);
  if (!closed) throw new AppError(409, 'no_offer', 'This assignment already changed.');
  await pushEvent(alertId, 'assignment_declined', { actorId: String(responder._id), actorLabel: responder.fullName, note: reason });
  await audit({ action: 'sos.assignment_declined', req, targetType: 'sos', targetId: alertId, reason, meta: { assignmentId: String(offer._id) } });
  opsEmit(alertId);
  await runAssignment(alertId, { reason: `Previous responder declined: ${reason}` });
  return closed;
}

/** Resolve / cancel: closes every open assignment for the alert and frees the responders. */
export async function closeAlertAssignments(alertId: unknown, status: 'completed' | 'cancelled', reason: string) {
  const open = await AlertAssignment.find({ alertId, open: true }).lean();
  for (const a of open) {
    const closed = await closeAssignment(a._id, ['offered', 'acknowledged'], status, reason);
    if (closed && status === 'cancelled') {
      emitToUser(String(closed.responderId), 'sos:assignment_closed', { alertId: String(alertId), reason: 'cancelled' });
    }
  }
  await EmergencyAlert.updateOne({ _id: alertId }, { $set: { assignmentState: 'closed', unassignedSince: null } });
  opsEmit(alertId, { assignmentState: 'closed' });
  return open;
}

/** Moves an acknowledged alert to another responder (handover). */
export async function transferAlert(alertId: string, actor: UserDoc, targetId: string, reason: string, req?: Request) {
  const target = await User.findOne({ _id: targetId, accountStatus: 'active' });
  if (!target || !isResponder(target)) throw new AppError(422, 'validation_failed', 'Choose an active responder.');
  const alert = await EmergencyAlert.findOneAndUpdate(
    { _id: alertId, status: { $in: ['acknowledged', 'en_route'] } },
    { $set: { assignedTo: target._id }, $push: { events: { type: 'reassigned', at: new Date(), actorId: actor._id, actorLabel: actor.fullName, note: `Assigned to ${target.fullName}${reason ? ` — ${reason}` : ''}`, studentVisible: false } } },
    { new: true },
  );
  if (!alert) throw new AppError(409, 'invalid_state', 'Only acknowledged alerts can be reassigned.');
  const current = await AlertAssignment.find({ alertId: alert._id, open: true, status: 'acknowledged' }).lean();
  for (const c of current) if (String(c.responderId) !== String(target._id)) await closeAssignment(c._id, ['acknowledged'], 'released', `Handed over to ${target.fullName}`);
  if (!(await AlertAssignment.exists({ alertId: alert._id, open: true, responderId: target._id }))) {
    await ResponderAvailability.updateOne({ userId: target._id }, { $inc: { activeAssignmentCount: 1 }, $set: { lastAssignedAt: new Date() } }, { upsert: true });
    try {
      await AlertAssignment.create({ alertId: alert._id, responderId: target._id, status: 'acknowledged', open: true, slot: 0, attempt: alert.assignmentAttempts + 1, assignedBy: actor._id, assignReason: reason || 'Handover', ackDeadlineAt: new Date(), acknowledgedAt: new Date() });
    } catch (err) {
      await releaseResponder(target._id);
      if ((err as { code?: number }).code !== 11000) throw err;
    }
    const ta = await getAvailability(target._id);
    if (['on_duty', 'busy', 'stale'].includes(ta.status)) await changeDutyStatus(String(target._id), 'responding', { actor: 'system', reason: `Took over SOS ${alert.alertNumber}`, alertId: alert._id }).catch(() => undefined);
  }
  await notify({ userId: String(target._id), kind: 'sos', priority: 'critical', title: `You now own SOS ${alert.alertNumber}`, body: 'Open the alert for location and details.', link: `/security/alerts/${alert._id}` });
  await audit({ action: 'sos.reassigned', req, targetType: 'sos', targetId: String(alert._id), reason: reason || null, meta: { to: String(target._id) } });
  opsEmit(alert._id);
  return alert;
}

/** A responder left duty or became unreachable: move their alerts on so nobody waits on them. */
async function handOff(userId: string, why: string, includeAcknowledged: boolean) {
  const open = await AlertAssignment.find({ responderId: userId, open: true, status: { $in: includeAcknowledged ? ['offered', 'acknowledged'] : ['offered'] } }).lean();
  for (const a of open) {
    const closed = await closeAssignment(a._id, [a.status], a.status === 'offered' ? 'expired' : 'released', why);
    if (!closed) continue;
    if (a.status === 'acknowledged') {
      // The alert needs a new owner: put it back to "waiting for a responder" (history stays in events).
      await EmergencyAlert.updateOne(
        { _id: a.alertId, status: { $in: ['acknowledged', 'en_route'] }, assignedTo: userId },
        // Clearing the acknowledgement re-arms the time-based escalation safety net for this alert.
        { $set: { status: 'sent', assignedTo: null, acknowledgedBy: null, acknowledgedAt: null, assignmentState: 'none' }, $push: { events: { type: 'responder_released', at: new Date(), actorLabel: 'Dispatch', note: why, studentVisible: false } } },
      );
    } else {
      await pushEvent(a.alertId, 'assignment_expired', { actorLabel: 'Dispatch', note: why });
    }
    await audit({ action: 'sos.assignment_handed_off', targetType: 'sos', targetId: String(a.alertId), reason: why, meta: { responderId: userId, previous: a.status } });
    await runAssignment(String(a.alertId), { reason: why });
  }
}
onResponderUnreachable((userId, why) => handOff(userId, why, false));
onResponderRemovedFromDuty((userId, why) => handOff(userId, why, true));

/** Expires unacknowledged offers and retries alerts that are still waiting for a responder. */
export async function sweepAssignments(now = Date.now()) {
  const s = await getSettings();
  let expired = 0;
  const due = await AlertAssignment.find({ open: true, status: 'offered', ackDeadlineAt: { $lt: new Date(now) } }).limit(100).lean();
  for (const a of due) {
    const closed = await closeAssignment(a._id, ['offered'], 'expired', 'No acknowledgement before the deadline');
    if (!closed) continue;
    expired++;
    emitToUser(String(a.responderId), 'sos:assignment_closed', { alertId: String(a.alertId), reason: 'expired' });
    await pushEvent(a.alertId, 'assignment_expired', { actorLabel: 'Dispatch', note: `Not acknowledged within ${s.dispatch.ackDeadlineSeconds}s` });
    await audit({ action: 'sos.assignment_expired', targetType: 'sos', targetId: String(a.alertId), meta: { responderId: String(a.responderId), attempt: a.attempt } });
    await runAssignment(String(a.alertId), { reason: 'Previous responder did not acknowledge in time' });
  }
  const retryBefore = new Date(now - s.dispatch.unassignedRetrySeconds * 1000);
  const waiting = await EmergencyAlert.find({
    status: { $in: ACKABLE }, dispatchedAt: { $ne: null }, assignmentState: { $in: ['none', 'unassigned'] },
    $or: [{ lastAssignmentAttemptAt: null }, { lastAssignmentAttemptAt: { $lt: retryBefore } }],
  }, { _id: 1 }).limit(50).lean();
  for (const w of waiting) {
    await EmergencyAlert.updateOne({ _id: w._id }, { $set: { lastAssignmentAttemptAt: new Date(now) } });
    await runAssignment(String(w._id), { reason: 'Retrying assignment' }).catch((err) => logger.error({ err: (err as Error).message }, 'assignment retry failed'));
  }
  return { expired, retried: waiting.length };
}

registerPeriodic('sos-assignment-sweep', 5_000, async () => { await sweepAssignments(); });
