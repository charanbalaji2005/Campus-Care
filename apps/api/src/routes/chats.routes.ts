import { Router } from 'express';
import { Types } from 'mongoose';
import {
  ANNOUNCEMENT_CATEGORIES, CHAT_CATEGORIES, announcementPublishSchema, announcementUpdateSchema, chatItemRefSchema, chatPreferenceSchema, directChatOpenSchema,
  type ChatCategory,
} from '@campuscare/shared';
import { AppError, asyncHandler, escapeRegex, notFound, ok, pageParams, parse } from '../lib/http';
import { ChatMembership } from '../models/chat';
import { ChatPreference } from '../models/chat-center';
import { Announcement } from '../models/content';
import { requireAuth, requirePermission } from '../middleware/auth';
import { audit } from '../services/audit.service';
import { loadChannelFor } from '../services/chat.service';
import {
  announcementAudienceFilter, assertItemVisible, can, categoriesFor, categoryList, chatsOverview, directContacts, fanOutAnnouncement, listConversations,
  openDirectConversation, participantsOf, serializeAnnouncement, settleAnnouncementSchedule,
} from '../services/chats.service';
import { emitBroadcast, emitToUser } from '../realtime/socket';
import { campusScopeOf, inCampusScope } from '../services/campus-scope.service';

/**
 * Unified Chats center. It only organises what other APIs already authorise:
 * messages are still read and sent through /chat, /counselling and /incidents, which re-check
 * membership and case access on every request. Nothing here widens access to private content.
 */
export const chatsRouter = Router();
chatsRouter.use(requireAuth);

chatsRouter.get(
  '/categories',
  asyncHandler(async (req, res) => {
    ok(res, { categories: categoryList(await categoriesFor(req.user!)) });
  }),
);

chatsRouter.get(
  '/overview',
  asyncHandler(async (req, res) => {
    ok(res, await chatsOverview(req.user!));
  }),
);

chatsRouter.get(
  '/conversations',
  asyncHandler(async (req, res) => {
    const category = String(req.query.category ?? 'all') as ChatCategory;
    if (!CHAT_CATEGORIES.includes(category)) throw new AppError(400, 'bad_category', 'Unknown category.');
    if (!(await categoriesFor(req.user!)).includes(category)) throw new AppError(403, 'forbidden', 'This category is not available to you.');
    const view = ['archived', 'unread', 'pinned'].includes(String(req.query.view)) ? (String(req.query.view) as 'archived' | 'unread' | 'pinned') : undefined;
    const items = await listConversations(req.user!, { category, view, q: typeof req.query.q === 'string' ? req.query.q : undefined });
    ok(res, { items });
  }),
);

// ------------------------------------------------------------------ direct conversations
chatsRouter.get(
  '/contacts',
  asyncHandler(async (req, res) => {
    ok(res, await directContacts(req.user!, String(req.query.q ?? '')));
  }),
);

chatsRouter.post(
  '/direct',
  asyncHandler(async (req, res) => {
    const { userId } = parse(directChatOpenSchema, req.body);
    const { channel, created } = await openDirectConversation(req.user!, userId, req);
    if (created) emitToUser(userId, 'chats:changed', { channelId: String(channel._id) });
    ok(res, { id: String(channel._id), purpose: channel.purpose, created }, created ? 201 : 200);
  }),
);

chatsRouter.get(
  '/channels/:id/participants',
  asyncHandler(async (req, res) => {
    const { channel } = await loadChannelFor(req.user!, req.params.id); // 404 unless the caller can read it
    ok(res, await participantsOf(req.user!, channel));
  }),
);

// ------------------------------------------------------------------ per-user organisation
chatsRouter.patch(
  '/preferences',
  asyncHandler(async (req, res) => {
    const input = parse(chatPreferenceSchema, req.body);
    await assertItemVisible(req.user!, input.itemType, input.itemId);
    const set: Record<string, boolean> = {};
    for (const k of ['pinned', 'archived', 'muted', 'markedUnread'] as const) if (input[k] !== undefined) set[k] = input[k]!;
    const pref = await ChatPreference.findOneAndUpdate(
      { userId: req.user!._id, itemType: input.itemType, itemId: new Types.ObjectId(input.itemId) },
      { $set: set },
      { upsert: true, new: true },
    ).lean();
    // Muting a membership-based conversation is mirrored on the membership for other clients.
    if (input.itemType === 'channel' && input.muted !== undefined) await ChatMembership.updateOne({ channelId: input.itemId, userId: req.user!._id }, { $set: { muted: input.muted } });
    ok(res, { pinned: pref.pinned, archived: pref.archived, muted: pref.muted, markedUnread: pref.markedUnread });
  }),
);

chatsRouter.post(
  '/read',
  asyncHandler(async (req, res) => {
    const { itemType, itemId } = parse(chatItemRefSchema, req.body);
    const { channel, member } = await assertItemVisible(req.user!, itemType, itemId);
    const now = new Date();
    if (channel && member) {
      await ChatMembership.updateOne({ channelId: channel._id, userId: req.user!._id }, { $set: { lastReadAt: now } }, { upsert: channel.kind === 'community' });
    }
    if (itemType === 'announcement') {
      // Idempotent: the conditional filter means repeated reads never double count.
      await Announcement.updateOne({ _id: itemId, 'readBy.userId': { $ne: req.user!._id } }, { $push: { readBy: { userId: req.user!._id, readAt: now } }, $inc: { readCount: 1 } });
    }
    await ChatPreference.updateOne(
      { userId: req.user!._id, itemType, itemId: new Types.ObjectId(itemId) },
      { $set: { markedUnread: false, lastReadAt: now } },
      { upsert: itemType === 'ticket' || itemType === 'case' },
    );
    ok(res, { ok: true });
  }),
);

// ------------------------------------------------------------------ official announcements
/** Campus Admins publish only to campuses they manage; "all campuses" is for Super Admins. */
function assertAnnouncementCampus(user: { role: string; campusZone?: string | null; managedCampuses?: string[] | null }, campus: string) {
  const scope = campusScopeOf(user);
  if (scope === null) return;
  if (campus === 'all' || !inCampusScope(scope, campus)) {
    throw new AppError(403, 'campus_out_of_scope', 'You can only publish announcements for the campuses you manage.');
  }
}
const announcementAuthorRole = (role: string) => (role === 'super_admin' ? 'Super Admin' : role === 'admin' ? 'Campus Admin' : role === 'counsellor' ? 'Counsellor' : 'Staff');

chatsRouter.get(
  '/announcements',
  asyncHandler(async (req, res) => {
    await settleAnnouncementSchedule();
    const user = req.user!;
    const manage = req.query.view === 'manage';
    if (manage && !can(user, 'announcements:manage')) throw new AppError(403, 'forbidden', 'You cannot manage announcements.');
    const { page, limit, skip } = pageParams(req.query, 50);
    const and: Record<string, unknown>[] = [manage ? {} : announcementAudienceFilter(user)];
    if (manage && typeof req.query.status === 'string' && req.query.status) and.push({ status: req.query.status });
    if (typeof req.query.category === 'string' && (ANNOUNCEMENT_CATEGORIES as readonly string[]).includes(req.query.category)) and.push({ category: req.query.category });
    if (typeof req.query.q === 'string' && req.query.q.trim()) {
      const rx = { $regex: escapeRegex(req.query.q.trim().slice(0, 80)), $options: 'i' };
      and.push({ $or: [{ title: rx }, { body: rx }] });
    }
    if (req.query.unread === 'true') and.push({ 'readBy.userId': { $ne: user._id } });
    const filter = { $and: and };
    const [docs, total] = await Promise.all([
      Announcement.find(filter, { readBy: 0 }).sort({ pinned: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
      Announcement.countDocuments(filter),
    ]);
    const readIds = new Set((await Announcement.find({ _id: { $in: docs.map((d) => d._id) }, 'readBy.userId': user._id }, { _id: 1 }).lean()).map((d) => String(d._id)));
    ok(res, { items: docs.map((d) => serializeAnnouncement(d as never, { readIds, manage })), total, page, limit, canPublish: can(user, 'announcements:manage') });
  }),
);

chatsRouter.post(
  '/announcements',
  requirePermission('announcements:manage'),
  asyncHandler(async (req, res) => {
    const input = parse(announcementPublishSchema, req.body);
    const user = req.user!;
    assertAnnouncementCampus(user, input.campus);
    const doc = await Announcement.create({
      ...input,
      scheduledAt: input.status === 'scheduled' ? input.scheduledAt : null,
      expiresAt: input.expiresAt ?? null,
      published: input.status === 'published',
      authorId: user._id, authorName: user.fullName, authorRole: announcementAuthorRole(user.role),
      history: [{ changedBy: user._id, changedByName: user.fullName, action: input.status === 'draft' ? 'drafted' : input.status, changedAt: new Date() }],
    });
    await audit({ action: `announcement.${input.status === 'draft' ? 'drafted' : input.status}`, req, targetType: 'announcement', targetId: String(doc._id), meta: { category: input.category, priority: input.priority, targetRoles: input.targetRoles, campus: input.campus } });
    if (input.status === 'published') fanOutAnnouncement(doc.toObject() as never);
    ok(res, serializeAnnouncement(doc.toObject() as never, { readIds: new Set(), manage: true }), 201);
  }),
);

chatsRouter.patch(
  '/announcements/:id',
  requirePermission('announcements:manage'),
  asyncHandler(async (req, res) => {
    const input = parse(announcementUpdateSchema, req.body);
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const doc = await Announcement.findById(req.params.id);
    if (!doc) throw notFound();
    const user = req.user!;
    // A Campus Admin edits only announcements for their own campuses, and cannot move one elsewhere.
    assertAnnouncementCampus(user, doc.campus ?? 'all');
    if (input.campus !== undefined) assertAnnouncementCampus(user, input.campus);
    const before = doc.toObject();
    const wasPublished = (doc.status ?? (doc.published ? 'published' : 'draft')) === 'published';
    const { note, ...changes } = input;
    for (const [k, v] of Object.entries(changes)) if (v !== undefined) doc.set(k, v);
    if (input.status) doc.published = input.status === 'published';
    if (input.status && input.status !== 'scheduled') doc.scheduledAt = input.status === 'published' ? null : doc.scheduledAt;
    const action = input.status === 'archived' ? 'archived'
      : input.status === 'published' && !wasPublished ? 'published'
      : input.status === 'scheduled' ? 'scheduled'
      : input.pinned !== undefined && Object.keys(changes).length === 1 ? (input.pinned ? 'pinned' : 'unpinned')
      : 'edited';
    doc.history.push({ changedBy: user._id, changedByName: user.fullName, changedAt: new Date(), action, note: note ?? '' } as never);
    await doc.save();
    await audit({ action: `announcement.${action}`, req, targetType: 'announcement', targetId: String(doc._id), before: { status: before.status, pinned: before.pinned, title: before.title }, after: { status: doc.status, pinned: doc.pinned, title: doc.title } });
    if (action === 'published') fanOutAnnouncement(doc.toObject() as never);
    else emitBroadcast('announcements:changed', { id: String(doc._id) });
    ok(res, serializeAnnouncement(doc.toObject() as never, { readIds: new Set(), manage: true }));
  }),
);
