import type { Request } from 'express';
import { User, type UserDoc } from '../models/user';
import { ResponderAvailability } from '../models/duty';
import { audit } from './audit.service';
import { changeDutyStatus } from './duty.service';
import { handOffResponder } from './dispatch.service';
import { revokeAllSessions } from './auth.service';
import { sendEmail } from './email/email.service';
import { disconnectUser } from '../realtime/socket';
import { registerPeriodic } from './jobs.service';
import { logger } from '../lib/logger';

/**
 * What happens when an account stops being operational (suspended, deactivated, archived):
 * every session ends at once (the backend rejects them, not just the UI), and a responder is taken
 * off duty through the duty service, whose hand-off moves their open SOS offers and acknowledged
 * alerts to other eligible responders, so no emergency is left with a suspended officer.
 * Reports, messages, bookings, incidents and audit history are never touched.
 */
export async function standDownAccount(target: UserDoc, opts: { actorId: string | null; reason: string; req?: Request }) {
  await revokeAllSessions(String(target._id));
  await disconnectUser(String(target._id));
  const why = `Account no longer active: ${opts.reason}`.slice(0, 300);
  const availability = await ResponderAvailability.findOne({ userId: target._id }).lean();
  if (availability && availability.status !== 'off_duty') {
    try {
      await changeDutyStatus(String(target._id), 'off_duty', { actor: 'supervisor', actorId: opts.actorId, reason: why, force: true, req: opts.req });
    } catch (err) {
      logger.warn({ err: (err as Error).message, userId: String(target._id) }, 'could not record duty stand-down');
    }
  }
  // Idempotent: also covers alerts that are still open while the duty record already says off duty.
  await handOffResponder(String(target._id), why);
}

/** Effective status once a temporary suspension ends: a pending applicant stays pending. */
function statusAfterSuspension(u: { emailVerified?: boolean | null; approvalRequired?: boolean | null }) {
  return u.emailVerified && !u.approvalRequired ? 'active' : 'pending_verification';
}

/**
 * Ends temporary suspensions whose end time has passed. Runs on the server (job worker), so it does not
 * depend on the person signing in. Compare-and-set per account, so two workers cannot both reinstate.
 */
export async function expireTemporarySuspensions(now = new Date()): Promise<number> {
  const due = await User.find({ accountStatus: 'suspended', suspendedUntil: { $ne: null, $lte: now } }).limit(200);
  let reinstated = 0;
  for (const u of due) {
    const r = await User.updateOne(
      { _id: u._id, accountStatus: 'suspended', suspendedUntil: u.suspendedUntil },
      { $set: { accountStatus: statusAfterSuspension(u), suspendedUntil: null, suspendedReason: null, suspendedAt: null, suspendedBy: null } },
    );
    if (!r.modifiedCount) continue;
    reinstated++;
    await audit({ action: 'user.suspension_expired', actorType: 'system', targetType: 'user', targetId: String(u._id), meta: { until: u.suspendedUntil } });
    await sendEmail('security_alert', u.email, { name: u.fullName, message: 'Your temporary account suspension has ended. You can sign in again.' }).catch(() => undefined);
  }
  return reinstated;
}

registerPeriodic('suspension-expiry', 60_000, async () => { await expireTemporarySuspensions(); });
