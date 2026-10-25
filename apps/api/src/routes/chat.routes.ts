import { Router } from 'express';
import { Types } from 'mongoose';
import { chatMessageSchema, chatReportSchema } from '@campuscare/shared';
import { AppError, asyncHandler, escapeRegex, notFound, ok, parse } from '../lib/http';
import { ChatBlock, ChatChannel, ChatMembership, ChatMessage, ChatReport } from '../models/chat';
import { Evidence } from '../models/incident';
import { requireAuth, requirePermission } from '../middleware/auth';
import { requireTurnstile, upload } from '../middleware/security';
import { channelAccess, loadChannelFor, mediaScopeFor, openSupportThread, postChatMessage, serializeMessages } from '../services/chat.service';
import { attachmentView, storeUpload, streamFile } from '../services/files.service';
import { audit } from '../services/audit.service';
import { getSettings } from '../services/settings.service';
import { User } from '../models/user';

export const chatRouter = Router();
chatRouter.use(requireAuth);

/** Channels and threads visible to the caller, plus the media policy the UI should apply. */
chatRouter.get(
  '/channels',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const settings = await getSettings();
    const community = settings.chat.communityEnabled
      ? await ChatChannel.find({ kind: 'community', published: true }).sort({ order: 1 }).lean()
      : [];
    const services = await ChatChannel.find({ kind: 'support_service', published: true }).sort({ order: 1 }).lean();
    let threads: Record<string, unknown>[] = [];
    if (user.role === 'student') {
      threads = await ChatChannel.find({ kind: { $in: ['support_thread', 'counselling_thread'] }, studentId: user._id }).sort({ lastMessageAt: -1, createdAt: -1 }).lean();
    } else {
      const candidate = await ChatChannel.find({ kind: { $in: ['support_thread', 'counselling_thread'] }, closed: false }).sort({ lastMessageAt: -1 }).limit(300);
      const visible = [];
      for (const c of candidate) if ((await channelAccess(user, c)) !== 'none') visible.push(c.toObject());
      threads = visible;
    }
    const memberships = await ChatMembership.find({ userId: user._id }).lean();
    const lastRead = new Map(memberships.map((m) => [String(m.channelId), m.lastReadAt]));
    const withUnread = await Promise.all(threads.map(async (t) => {
      const since = lastRead.get(String(t._id)) ?? new Date(0);
      const unread = t.lastMessageAt && (t.lastMessageAt as Date) > since ? await ChatMessage.countDocuments({ channelId: t._id, createdAt: { $gt: since }, senderId: { $ne: user._id } }) : 0;
      const studentName = user.role !== 'student' && t.studentId ? (await User.findById(t.studentId, { fullName: 1 }).lean())?.fullName : undefined;
      return { id: String(t._id), kind: t.kind, name: t.name, closed: t.closed, lastMessageAt: t.lastMessageAt, unread, studentName, assigned: Boolean(t.assignedStaffId) };
    }));
    ok(res, {
      community: community.map((c) => ({ id: String(c._id), name: c.name, slug: c.slug, description: c.description, readOnly: c.readOnly })),
      services: services.map((s) => ({ id: String(s._id), name: s.name, description: s.description, serviceRole: s.serviceRole })),
      threads: withUnread,
      media: settings.chat.media,
      limits: { maxImageMb: settings.chat.maxImageMb, maxVideoMb: settings.chat.maxVideoMb },
    });
  }),
);

chatRouter.post(
  '/services/:id/open',
  requirePermission('chat:support'),
  asyncHandler(async (req, res) => {
    if (req.user!.role !== 'student') throw new AppError(403, 'forbidden', 'Only students open support conversations.');
    const thread = await openSupportThread(req.user!, req.params.id);
    ok(res, { id: String(thread._id) }, 201);
  }),
);

chatRouter.get(
  '/channels/:id',
  asyncHandler(async (req, res) => {
    const { channel, access } = await loadChannelFor(req.user!, req.params.id);
    const settings = await getSettings();
    const scope = mediaScopeFor(channel.kind);
    ok(res, {
      id: String(channel._id), kind: channel.kind, name: channel.name, description: channel.description, readOnly: channel.readOnly && access !== 'moderator',
      closed: channel.closed, access, mediaScope: scope, media: settings.chat.media[scope],
      limits: { maxImageMb: settings.chat.maxImageMb, maxVideoMb: settings.chat.maxVideoMb },
    });
  }),
);

chatRouter.get(
  '/channels/:id/messages',
  asyncHandler(async (req, res) => {
    const { channel, access } = await loadChannelFor(req.user!, req.params.id);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 30));
    const filter: Record<string, unknown> = { channelId: channel._id };
    // Message search inside a conversation the caller can already read.
    if (typeof req.query.q === 'string' && req.query.q.trim()) {
      filter.body = { $regex: escapeRegex(req.query.q.trim().slice(0, 80)), $options: 'i' };
      filter.hidden = false;
    }
    if (req.query.before && Types.ObjectId.isValid(String(req.query.before))) {
      const pivot = await ChatMessage.findOne({ _id: req.query.before, channelId: channel._id }, { createdAt: 1 }).lean();
      if (pivot) filter.createdAt = { $lt: pivot.createdAt };
    }
    const docs = await ChatMessage.find(filter).sort({ createdAt: -1 }).limit(limit + 1).lean();
    const hasMore = docs.length > limit;
    const page = docs.slice(0, limit).reverse();
    await ChatMembership.updateOne({ channelId: channel._id, userId: req.user!._id }, { $set: { lastReadAt: new Date() } }, { upsert: channel.kind === 'community' });
    ok(res, { items: await serializeMessages(req.user!, page as never, access), hasMore, nextCursor: hasMore ? String(page[0]?._id) : null });
  }),
);

chatRouter.post(
  '/channels/:id/messages',
  asyncHandler(async (req, res, next) => {
    // Community posts may require Turnstile (Super Admin setting); private threads don't.
    const channel = Types.ObjectId.isValid(req.params.id) ? await ChatChannel.findById(req.params.id, { kind: 1 }).lean() : null;
    if (channel?.kind === 'community') return requireTurnstile('communityPost')(req, res, next);
    next();
  }),
  asyncHandler(async (req, res) => {
    const input = parse(chatMessageSchema, req.body);
    const { channel, access } = await loadChannelFor(req.user!, req.params.id);
    const { message, duplicate } = await postChatMessage(req.user!, channel, access, input);
    ok(res, { message: (await serializeMessages(req.user!, [message as never], access))[0], duplicate }, duplicate ? 200 : 201);
  }),
);

/** Image/video upload for chat — refused unless the Super Admin has switched media on for this chat type. */
chatRouter.post(
  '/channels/:id/attachments',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const { channel, access } = await loadChannelFor(req.user!, req.params.id);
    if (channel.readOnly && access !== 'moderator') throw new AppError(403, 'read_only', 'Read-only channel.');
    const doc = await storeUpload(req.file, { purpose: 'chat', mediaScope: mediaScopeFor(channel.kind), uploaderId: String(req.user!._id), channelId: String(channel._id) });
    await audit({ action: 'chat.media_uploaded', req, targetType: 'channel', targetId: String(channel._id), meta: { mimeType: doc.mimeType, sizeBytes: doc.sizeBytes } });
    ok(res, attachmentView(doc), 201);
  }),
);

chatRouter.get(
  '/files/:fileId',
  asyncHandler(async (req, res) => {
    if (!Types.ObjectId.isValid(req.params.fileId)) throw notFound();
    const file = await Evidence.findOne({ _id: req.params.fileId, purpose: 'chat', bound: true }).lean();
    if (!file?.channelId) throw notFound();
    await loadChannelFor(req.user!, String(file.channelId)); // throws 404 if no access
    const msg = await ChatMessage.findOne({ channelId: file.channelId, attachmentIds: file._id }, { hidden: 1 }).lean();
    if (!msg || msg.hidden) throw notFound();
    await streamFile(res, req, req.params.fileId, 'inline');
  }),
);

chatRouter.post(
  '/channels/:id/close',
  asyncHandler(async (req, res) => {
    const { channel, access } = await loadChannelFor(req.user!, req.params.id);
    if (channel.kind !== 'support_thread') throw notFound();
    void access;
    channel.closed = true;
    await channel.save();
    await audit({ action: 'chat.thread_closed', req, targetType: 'channel', targetId: String(channel._id) });
    ok(res, { ok: true });
  }),
);

// ------------------------------------------------------------------ moderation and safety
chatRouter.post(
  '/messages/:id/report',
  asyncHandler(async (req, res) => {
    const { reason } = parse(chatReportSchema, req.body);
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const msg = await ChatMessage.findById(req.params.id);
    if (!msg) throw notFound();
    await loadChannelFor(req.user!, String(msg.channelId));
    try {
      await ChatReport.create({ messageId: msg._id, channelId: msg.channelId, reporterId: req.user!._id, reason });
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
    }
    await audit({ action: 'chat.message_reported', req, targetType: 'chat_message', targetId: String(msg._id) });
    ok(res, { ok: true }, 201);
  }),
);

chatRouter.post(
  '/messages/:id/block-sender',
  asyncHandler(async (req, res) => {
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const msg = await ChatMessage.findById(req.params.id);
    if (!msg) throw notFound();
    await loadChannelFor(req.user!, String(msg.channelId));
    if (String(msg.senderId) === String(req.user!._id)) throw new AppError(422, 'self', "You can't block yourself.");
    await ChatBlock.updateOne({ userId: req.user!._id, blockedUserId: msg.senderId }, { $setOnInsert: { userId: req.user!._id, blockedUserId: msg.senderId } }, { upsert: true });
    ok(res, { ok: true });
  }),
);

chatRouter.get(
  '/blocks',
  asyncHandler(async (req, res) => {
    const blocks = await ChatBlock.find({ userId: req.user!._id }).lean();
    ok(res, blocks.map((b) => ({ id: String(b._id), createdAt: b.createdAt })));
  }),
);

chatRouter.delete(
  '/blocks/:id',
  asyncHandler(async (req, res) => {
    await ChatBlock.deleteOne({ _id: req.params.id, userId: req.user!._id });
    ok(res, { ok: true });
  }),
);

chatRouter.get(
  '/moderation/reports',
  requirePermission('chat:moderate'),
  asyncHandler(async (req, res) => {
    const reports = await ChatReport.find({ status: String(req.query.status ?? 'open') }).sort({ createdAt: -1 }).limit(100).lean();
    const msgs = await ChatMessage.find({ _id: { $in: reports.map((r) => r.messageId) } }).lean();
    const channels = await ChatChannel.find({ _id: { $in: reports.map((r) => r.channelId) } }, { kind: 1, name: 1 }).lean();
    const msgMap = new Map(msgs.map((m) => [String(m._id), m]));
    const chMap = new Map(channels.map((c) => [String(c._id), c]));
    // Moderators only see reported messages in COMMUNITY channels. Private conversations are never exposed here.
    ok(res, reports
      .filter((r) => chMap.get(String(r.channelId))?.kind === 'community')
      .map((r) => {
        const m = msgMap.get(String(r.messageId));
        return { id: String(r._id), reason: r.reason, status: r.status, createdAt: r.createdAt, channel: chMap.get(String(r.channelId))?.name, message: m ? { id: String(m._id), body: m.body, senderLabel: m.senderLabel, hidden: m.hidden, createdAt: m.createdAt } : null };
      }));
  }),
);

chatRouter.post(
  '/moderation/reports/:id',
  requirePermission('chat:moderate'),
  asyncHandler(async (req, res) => {
    const action = String(req.body?.action);
    if (!['hide', 'dismiss'].includes(action)) throw new AppError(422, 'bad_action', 'Choose hide or dismiss.');
    const report = await ChatReport.findById(req.params.id);
    if (!report) throw notFound();
    const channel = await ChatChannel.findById(report.channelId);
    if (!channel || channel.kind !== 'community') throw notFound();
    if (action === 'hide') {
      await ChatMessage.updateOne({ _id: report.messageId }, { $set: { hidden: true, hiddenReason: String(req.body?.reason ?? 'Community guidelines').slice(0, 200), hiddenBy: req.user!._id } });
      await ChatReport.updateMany({ messageId: report.messageId, status: 'open' }, { $set: { status: 'actioned', reviewedBy: req.user!._id } });
    } else {
      report.status = 'dismissed';
      report.reviewedBy = req.user!._id;
      await report.save();
    }
    await audit({ action: `chat.moderation_${action}`, req, targetType: 'chat_message', targetId: String(report.messageId) });
    ok(res, { ok: true });
  }),
);

/** Moderators can hide any community message directly (e.g. abuse spotted live). */
chatRouter.post(
  '/messages/:id/hide',
  asyncHandler(async (req, res) => {
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const msg = await ChatMessage.findById(req.params.id);
    if (!msg) throw notFound();
    const { channel, access } = await loadChannelFor(req.user!, String(msg.channelId));
    if (channel.kind !== 'community' || access !== 'moderator') throw new AppError(403, 'forbidden', 'Moderators only.');
    msg.hidden = true;
    msg.hiddenBy = req.user!._id;
    msg.hiddenReason = 'Moderator action';
    await msg.save();
    await audit({ action: 'chat.moderation_hide', req, targetType: 'chat_message', targetId: String(msg._id) });
    ok(res, { ok: true });
  }),
);
