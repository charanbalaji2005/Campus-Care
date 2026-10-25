import { Router } from 'express';
import { Types } from 'mongoose';
import { chatMessageSchema, counsellingConversationSchema } from '@campuscare/shared';
import { AppError, asyncHandler, notFound, ok, parse } from '../lib/http';
import { ChatChannel, ChatMembership, ChatMessage } from '../models/chat';
import { Availability } from '../models/counselling';
import { User } from '../models/user';
import { requireAuth, requirePermission } from '../middleware/auth';
import { audit } from '../services/audit.service';
import { notify } from '../services/notification.service';
import { loadChannelFor, postChatMessage, serializeMessages } from '../services/chat.service';
import { counsellorPresence } from '../services/counsellor-availability';

/**
 * One-to-one private conversations between a student and a counsellor:
 *   GET/POST /counselling/conversations, GET /counselling/conversations/:id[/messages], POST …/messages
 *
 * They are `counselling_thread` chat channels with exactly two memberships, so they inherit the chat
 * system's guarantees: membership-only access, no moderator access, and no private-review grants
 * (counselling threads can never be the subject of one). Nothing here is ever copied to the feed.
 */
export const counsellingChatRouter = Router();
counsellingChatRouter.use(requireAuth);

const EMERGENCY_NOTICE = 'Counsellor chat is not an emergency service and replies may take time. If you or someone else is in immediate danger, use SOS or call campus security / 112.';

async function counsellorOf(channelId: unknown, studentId: unknown) {
  const m = await ChatMembership.findOne({ channelId, userId: { $ne: studentId }, role: 'staff' }, { userId: 1 }).lean();
  return m?.userId ?? null;
}

async function conversationView(viewer: NonNullable<Express.Request['user']>, c: { _id: unknown; studentId?: unknown; appointmentId?: unknown; closed?: boolean | null; lastMessageAt?: Date | null; createdAt?: Date }) {
  const counsellorId = await counsellorOf(c._id, c.studentId);
  const isStudent = String(c.studentId) === String(viewer._id);
  const otherId = isStudent ? counsellorId : c.studentId;
  const [counsellor, student, avail, mine, other] = await Promise.all([
    counsellorId ? User.findById(counsellorId, { fullName: 1, accountStatus: 1 }).lean() : null,
    isStudent ? null : User.findById(c.studentId, { fullName: 1, studentId: 1 }).lean(),
    counsellorId ? Availability.findOne({ counsellorId }).lean() : null,
    ChatMembership.findOne({ channelId: c._id, userId: viewer._id }, { lastReadAt: 1 }).lean(),
    otherId ? ChatMembership.findOne({ channelId: c._id, userId: otherId }, { lastReadAt: 1 }).lean() : null,
  ]);
  const unread = c.lastMessageAt && mine?.lastReadAt && c.lastMessageAt > mine.lastReadAt
    ? await ChatMessage.countDocuments({ channelId: c._id, createdAt: { $gt: mine.lastReadAt }, senderId: { $ne: viewer._id } })
    : 0;
  const presence = counsellorPresence(avail as never);
  return {
    id: String(c._id),
    kind: c.appointmentId ? 'appointment' : 'direct',
    counsellor: counsellor ? { id: String(counsellorId), name: counsellor.fullName, title: avail?.title ?? 'Counsellor', active: counsellor.accountStatus === 'active' } : null,
    // Counsellors see the student's name and ID only — never other records from here.
    student: student ? { id: String(c.studentId), name: student.fullName, studentId: student.studentId ?? null } : undefined,
    availability: { status: counsellor?.accountStatus === 'active' ? presence.status : 'away', nextAvailableAt: presence.nextAvailableAt, message: presence.message },
    closed: Boolean(c.closed),
    lastMessageAt: c.lastMessageAt ?? null,
    unread,
    otherLastReadAt: other?.lastReadAt && other.lastReadAt.getTime() > 0 ? other.lastReadAt : null,
    emergencyNotice: EMERGENCY_NOTICE,
    createdAt: c.createdAt,
  };
}

async function loadConversation(user: NonNullable<Express.Request['user']>, id: string) {
  if (!Types.ObjectId.isValid(id)) throw notFound();
  const { channel, access } = await loadChannelFor(user, id); // 404 unless a member
  if (channel.kind !== 'counselling_thread') throw notFound();
  return { channel, access };
}

counsellingChatRouter.get(
  '/conversations',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    let threads;
    if (user.role === 'student') {
      threads = await ChatChannel.find({ kind: 'counselling_thread', studentId: user._id }).sort({ lastMessageAt: -1, createdAt: -1 }).limit(100).lean();
    } else {
      const memberships = await ChatMembership.find({ userId: user._id, role: 'staff' }, { channelId: 1 }).lean();
      threads = await ChatChannel.find({ _id: { $in: memberships.map((m) => m.channelId) }, kind: 'counselling_thread' }).sort({ lastMessageAt: -1, createdAt: -1 }).limit(200).lean();
    }
    ok(res, await Promise.all(threads.map((t) => conversationView(user, t))));
  }),
);

/** A student opens (or re-opens) a private conversation with a specific counsellor. */
counsellingChatRouter.post(
  '/conversations',
  requirePermission('chat:support'),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    if (user.role !== 'student') throw new AppError(403, 'forbidden', 'Only students start counselling conversations.');
    const { counsellorId } = parse(counsellingConversationSchema, req.body);
    const counsellor = await User.findOne({ _id: counsellorId, role: 'counsellor', accountStatus: 'active' }, { fullName: 1 }).lean();
    if (!counsellor) throw new AppError(404, 'not_found', 'This counsellor is not available on CampusCare.');
    const direct = { kind: 'counselling_thread', studentId: user._id, appointmentId: null, assignedStaffId: counsellor._id, closed: false };
    const existing = await ChatChannel.findOne(direct).lean();
    if (existing) return ok(res, await conversationView(user, existing));
    const opened = await ChatChannel.countDocuments({ kind: 'counselling_thread', studentId: user._id, appointmentId: null, createdAt: { $gt: new Date(Date.now() - 86400_000) } });
    if (opened >= 5) throw new AppError(429, 'rate_limited', 'You have started several conversations today. Continue an existing one, or call a helpline if you need help now.');
    const thread = await ChatChannel.create({ ...direct, name: 'Counselling', published: true, createdBy: user._id });
    await ChatMembership.insertMany([
      { channelId: thread._id, userId: user._id, role: 'student' },
      { channelId: thread._id, userId: counsellor._id, role: 'staff' },
    ]);
    await audit({ action: 'counselling.conversation_opened', req, targetType: 'channel', targetId: String(thread._id) });
    // No message content or student name in the notification (lock screens).
    await notify({ userId: String(counsellor._id), kind: 'support_thread', category: 'chat_messages', priority: 'high', title: 'New counselling conversation', body: 'A student started a private conversation with you.', link: `/support/threads/${thread._id}` });
    ok(res, await conversationView(user, thread.toObject()), 201);
  }),
);

counsellingChatRouter.get(
  '/conversations/:id',
  asyncHandler(async (req, res) => {
    const { channel } = await loadConversation(req.user!, req.params.id);
    ok(res, await conversationView(req.user!, channel.toObject()));
  }),
);

counsellingChatRouter.get(
  '/conversations/:id/messages',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const { channel, access } = await loadConversation(user, req.params.id);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 30));
    const filter: Record<string, unknown> = { channelId: channel._id };
    if (req.query.before && Types.ObjectId.isValid(String(req.query.before))) {
      const pivot = await ChatMessage.findOne({ _id: req.query.before, channelId: channel._id }, { createdAt: 1 }).lean();
      if (pivot) filter.createdAt = { $lt: pivot.createdAt };
    }
    const docs = await ChatMessage.find(filter).sort({ createdAt: -1 }).limit(limit + 1).lean();
    const hasMore = docs.length > limit;
    const page = docs.slice(0, limit).reverse();
    await ChatMembership.updateOne({ channelId: channel._id, userId: user._id }, { $set: { lastReadAt: new Date() } });
    ok(res, { items: await serializeMessages(user, page as never, access), hasMore, nextCursor: hasMore ? String(page[0]?._id) : null });
  }),
);

counsellingChatRouter.post(
  '/conversations/:id/messages',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const input = parse(chatMessageSchema, req.body);
    const { channel, access } = await loadConversation(user, req.params.id);
    const { message, duplicate } = await postChatMessage(user, channel, access, input);
    ok(res, { message: (await serializeMessages(user, [message as never], access))[0], duplicate }, duplicate ? 200 : 201);
  }),
);
