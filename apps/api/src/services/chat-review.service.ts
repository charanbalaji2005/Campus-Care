import type { Request } from 'express';
import { Types } from 'mongoose';
import { hasPermission, type Role } from '@campuscare/shared';
import { AppError, notFound } from '../lib/http';
import { ChatChannel, ChatMessage, ChatReviewGrant, type ChatReviewGrantDoc } from '../models/chat';
import { CaseMessage, Committee, Evidence, Incident } from '../models/incident';
import { User, type UserDoc } from '../models/user';
import { getSettings } from './settings.service';
import { audit } from './audit.service';
import { notifyMany } from './notification.service';
import { registerPeriodic } from './jobs.service';

/**
 * Exceptional review of a private support or complaint conversation.
 *
 * Configuring chat (chat:configure) never grants this. A review needs ALL of:
 *   1. the explicit `chat:read_private` permission (never part of any role),
 *   2. a recent password re-confirmation (enforced on the route),
 *   3. a stated legal/policy basis and a specific reason (plus a case reference when policy requires),
 *   4. a target that policy allows — counselling conversations are never reviewable here,
 *      and complaints of confidential committees also need `incidents:read_sensitive`.
 * Access is limited to the one conversation, ends automatically, and every read is audited.
 */

const subject = (u: UserDoc) => ({ role: u.role as Role, permissions: u.permissions ?? [] });

export interface ReviewRequest {
  scope: 'support_thread' | 'case_chat';
  targetId: string;
  basis: string;
  reason: string;
  caseReference?: string;
  durationMinutes: number;
}

async function resolveTarget(actor: UserDoc, scope: ReviewRequest['scope'], targetId: string) {
  if (!Types.ObjectId.isValid(targetId)) throw notFound();
  if (scope === 'support_thread') {
    const ch = await ChatChannel.findById(targetId).lean();
    if (!ch) throw notFound();
    if (ch.kind === 'counselling_thread') {
      throw new AppError(403, 'counselling_restricted', 'Counselling conversations are confidential and cannot be opened through chat review.');
    }
    if (ch.kind !== 'support_thread') throw new AppError(422, 'not_private', 'Only private support conversations can be reviewed here. Community channels use the moderation tools.');
    return { label: `${ch.name} conversation · opened ${ch.createdAt.toISOString().slice(0, 10)}` };
  }
  const inc = await Incident.findById(targetId, { caseNumber: 1, committeeId: 1 }).lean();
  if (!inc) throw notFound();
  if (inc.committeeId) {
    const committee = await Committee.findById(inc.committeeId, { confidential: 1 }).lean();
    if (committee?.confidential && !hasPermission(subject(actor), 'incidents:read_sensitive')) {
      throw new AppError(403, 'confidential_committee', 'This complaint belongs to a confidential committee. Reviewing it also requires sensitive-case access.');
    }
  }
  return { label: `Complaint ${inc.caseNumber} conversation` };
}

export function serializeGrant(g: ChatReviewGrantDoc | Record<string, unknown>, names?: Map<string, string>) {
  const x = g as ChatReviewGrantDoc;
  return {
    id: String(x._id), scope: x.scope, targetId: String(x.targetId), targetLabel: x.targetLabel, basis: x.basis, reason: x.reason,
    caseReference: x.caseReference ?? null, status: x.status, expiresAt: x.expiresAt, createdAt: x.createdAt, endedAt: x.endedAt ?? null,
    accessCount: x.accessCount ?? 0, lastAccessedAt: x.lastAccessedAt ?? null, exportedAt: x.exportedAt ?? null,
    requesterId: String(x.requesterId), requesterName: names?.get(String(x.requesterId)) ?? null,
  };
}

export async function requestReview(actor: UserDoc, input: ReviewRequest, req?: Request) {
  const s = (await getSettings()).chatGovernance;
  if (!s.privateReviewEnabled) throw new AppError(403, 'review_disabled', 'Private conversation review is switched off in the chat governance policy.');
  if (s.requireCaseReference && !input.caseReference) throw new AppError(422, 'validation_failed', 'Enter the case or ticket reference that authorises this review.', { fields: { caseReference: 'Required by policy' } });
  if (input.durationMinutes > s.maxReviewMinutes) throw new AppError(422, 'validation_failed', `Reviews can last at most ${s.maxReviewMinutes} minutes.`, { fields: { durationMinutes: `At most ${s.maxReviewMinutes}` } });
  const { label } = await resolveTarget(actor, input.scope, input.targetId);

  const now = new Date();
  const existing = await ChatReviewGrant.findOne({ requesterId: actor._id, targetId: input.targetId, status: 'active', expiresAt: { $gt: now } });
  if (existing) return existing;
  const grant = await ChatReviewGrant.create({
    requesterId: actor._id, scope: input.scope, targetId: input.targetId, targetLabel: label, basis: input.basis, reason: input.reason,
    caseReference: input.caseReference || null, expiresAt: new Date(now.getTime() + input.durationMinutes * 60_000),
  });
  await audit({
    action: 'chat_review.granted', req, targetType: input.scope, targetId: input.targetId, reason: input.reason,
    meta: { grantId: String(grant._id), basis: input.basis, caseReference: input.caseReference || null, minutes: input.durationMinutes },
  });
  // Oversight: other security administrators learn that a private review was opened (never its content).
  const overseers = await User.find({ accountStatus: 'active', _id: { $ne: actor._id }, $or: [{ role: 'super_admin' }, { permissions: 'security:manage' }] }, { _id: 1 }).lean();
  await notifyMany(overseers.map((o) => String(o._id)), {
    kind: 'chat_review', priority: 'high', title: 'Private conversation review opened',
    body: `${actor.fullName} opened a time-limited review (${input.basis.replace(/_/g, ' ')}).`, link: '/super-admin/chat-access',
  });
  return grant;
}

/** Loads one of the actor's own grants and enforces expiry in application logic (not only via the sweep). */
export async function activeGrantFor(actor: UserDoc, grantId: string) {
  if (!Types.ObjectId.isValid(grantId)) throw notFound();
  const grant = await ChatReviewGrant.findOne({ _id: grantId, requesterId: actor._id });
  if (!grant) throw notFound();
  if (grant.status === 'active' && grant.expiresAt.getTime() <= Date.now()) {
    await ChatReviewGrant.updateOne({ _id: grant._id, status: 'active' }, { $set: { status: 'expired', endedAt: new Date() } });
    throw new AppError(410, 'review_expired', 'This review has expired. Request a new one if access is still justified.');
  }
  if (grant.status !== 'active') throw new AppError(410, 'review_ended', 'This review has ended.');
  if (!hasPermission(subject(actor), 'chat:read_private')) throw new AppError(403, 'forbidden', 'You no longer hold permission to review private conversations.');
  return grant;
}

/** Messages of the one conversation in scope. Attachments are listed by type and size only. */
export async function reviewMessages(actor: UserDoc, grantId: string, opts: { before?: string; limit?: number }, req?: Request) {
  const grant = await activeGrantFor(actor, grantId);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const before = opts.before && !Number.isNaN(Date.parse(opts.before)) ? { createdAt: { $lt: new Date(opts.before) } } : {};
  let items: { id: string; sender: string; body: string; at: Date; hidden?: boolean; attachments: { type: string; sizeBytes: number }[] }[];
  if (grant.scope === 'support_thread') {
    const msgs = await ChatMessage.find({ channelId: grant.targetId, ...before }).sort({ createdAt: -1 }).limit(limit).lean();
    const files = await Evidence.find({ _id: { $in: msgs.flatMap((m) => m.attachmentIds ?? []) } }, { mimeType: 1, sizeBytes: 1 }).lean();
    const fmap = new Map(files.map((f) => [String(f._id), f]));
    items = msgs.map((m) => ({
      id: String(m._id), sender: m.senderLabel, body: m.body, at: m.createdAt, hidden: m.hidden,
      attachments: (m.attachmentIds ?? []).map((a) => fmap.get(String(a))).filter(Boolean).map((f) => ({ type: f!.mimeType, sizeBytes: f!.sizeBytes })),
    }));
  } else {
    const msgs = await CaseMessage.find({ caseId: grant.targetId, deletedAt: null, ...before }).sort({ createdAt: -1 }).limit(limit).lean();
    const files = await Evidence.find({ _id: { $in: msgs.flatMap((m) => m.attachmentIds ?? []) } }, { mimeType: 1, sizeBytes: 1 }).lean();
    const fmap = new Map(files.map((f) => [String(f._id), f]));
    items = msgs.map((m) => ({
      id: String(m._id), sender: m.senderLabel, body: m.body, at: m.createdAt,
      attachments: (m.attachmentIds ?? []).map((a) => fmap.get(String(a))).filter(Boolean).map((f) => ({ type: f!.mimeType, sizeBytes: f!.sizeBytes })),
    }));
  }
  await ChatReviewGrant.updateOne({ _id: grant._id }, { $inc: { accessCount: 1 }, $set: { lastAccessedAt: new Date() } });
  await audit({ action: 'chat_review.accessed', req, targetType: grant.scope, targetId: String(grant.targetId), meta: { grantId: String(grant._id), messages: items.length, page: opts.before ? 'older' : 'latest' } });
  return { grant: serializeGrant(grant), items: items.reverse(), hasMore: items.length === limit };
}

export async function exportReview(actor: UserDoc, grantId: string, req?: Request) {
  if (!(await getSettings()).chatGovernance.allowExport) throw new AppError(403, 'export_disabled', 'Exports are switched off in the chat governance policy.');
  const grant = await activeGrantFor(actor, grantId);
  const all: Awaited<ReturnType<typeof reviewMessages>>['items'] = [];
  let before: string | undefined;
  for (let i = 0; i < 50; i++) {
    const page = await reviewMessages(actor, grantId, { before, limit: 100 }, req);
    all.unshift(...page.items);
    if (!page.hasMore || !page.items.length) break;
    before = new Date(page.items[0]!.at).toISOString();
  }
  await ChatReviewGrant.updateOne({ _id: grant._id }, { $set: { exportedAt: new Date() } });
  await audit({ action: 'chat_review.exported', req, targetType: grant.scope, targetId: String(grant.targetId), reason: grant.reason, meta: { grantId: String(grant._id), messages: all.length } });
  return { exportedAt: new Date().toISOString(), exportedBy: actor.fullName, grant: serializeGrant(grant), messages: all };
}

export async function endReview(actor: UserDoc, grantId: string, note: string | undefined, opts: { revoke?: boolean; req?: Request } = {}) {
  if (!Types.ObjectId.isValid(grantId)) throw notFound();
  const filter: Record<string, unknown> = { _id: grantId, status: 'active' };
  if (!opts.revoke) filter.requesterId = actor._id;
  const grant = await ChatReviewGrant.findOneAndUpdate(filter, { $set: { status: opts.revoke ? 'revoked' : 'ended', endedAt: new Date(), endedBy: actor._id, endNote: note ?? null } }, { new: true });
  if (!grant) throw new AppError(409, 'not_active', 'This review is not active.');
  await audit({ action: opts.revoke ? 'chat_review.revoked' : 'chat_review.ended', req: opts.req, targetType: grant.scope, targetId: String(grant.targetId), reason: note ?? null, meta: { grantId } });
  return grant;
}

/** Revokes every active review held by a user (e.g. when their permission is removed). */
export async function revokeAllReviewsFor(userId: string, reason: string) {
  const r = await ChatReviewGrant.updateMany({ requesterId: userId, status: 'active' }, { $set: { status: 'revoked', endedAt: new Date(), endNote: reason } });
  return r.modifiedCount;
}

export async function expireReviews(now = Date.now()) {
  const r = await ChatReviewGrant.updateMany({ status: 'active', expiresAt: { $lte: new Date(now) } }, { $set: { status: 'expired', endedAt: new Date(now) } });
  return r.modifiedCount;
}
registerPeriodic('chat-review-expiry', 30_000, async () => { await expireReviews(); });
