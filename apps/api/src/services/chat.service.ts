import { Types } from 'mongoose';
import { hasPermission, type MediaScope, type Role } from '@campuscare/shared';
import { AppError, notFound } from '../lib/http';
import { ChatBlock, ChatChannel, ChatMembership, ChatMessage, type ChatChannelDoc } from '../models/chat';
import { Evidence } from '../models/incident';
import { User, type UserDoc } from '../models/user';
import { attachmentView, bindUploads } from './files.service';
import { notifyMany } from './notification.service';
import { emitToRoom, registerRoomAuthoriser } from '../realtime/socket';
import { getSettings } from './settings.service';

export type ChatAccess = 'participant' | 'moderator' | 'none';

export function mediaScopeFor(kind: string): MediaScope {
  if (kind === 'community') return 'community';
  if (kind === 'counselling_thread') return 'counselling';
  return 'support';
}

const subjectOf = (u: UserDoc) => ({ role: u.role as Role, permissions: u.permissions ?? [] });

/**
 * Channel access is decided from membership/role data on the server. Configuring channels
 * (chat:configure) does NOT grant access to private message content.
 */
export async function channelAccess(user: UserDoc, channel: ChatChannelDoc): Promise<ChatAccess> {
  const uid = String(user._id);
  switch (channel.kind) {
    case 'community': {
      if (!channel.published) return hasPermission(subjectOf(user), 'chat:moderate') ? 'moderator' : 'none';
      if (hasPermission(subjectOf(user), 'chat:moderate') || channel.moderatorIds?.some((m) => String(m) === uid)) return 'moderator';
      return hasPermission(subjectOf(user), 'chat:community') ? 'participant' : 'none';
    }
    case 'support_service':
      return 'none'; // services are entry points; messages live in threads
    case 'support_thread': {
      if (String(channel.studentId) === uid) return 'participant';
      const service = channel.serviceId ? await ChatChannel.findById(channel.serviceId).lean() : null;
      if (!service || !service.serviceRole) return 'none';
      if (channel.assignedStaffId) return String(channel.assignedStaffId) === uid ? 'participant' : 'none';
      // Unassigned threads are visible to the service's staff pool (and committee, if scoped).
      if (user.role !== service.serviceRole) return 'none';
      if (service.committeeId && !(user.committeeMemberships ?? []).some((m) => String(m.committeeId) === String(service.committeeId))) return 'none';
      return 'participant';
    }
    case 'counselling_thread': {
      const member = await ChatMembership.findOne({ channelId: channel._id, userId: user._id }).lean();
      return member ? 'participant' : 'none';
    }
    default:
      return 'none';
  }
}

export async function loadChannelFor(user: UserDoc, channelId: string) {
  if (!Types.ObjectId.isValid(channelId)) throw notFound();
  const channel = await ChatChannel.findById(channelId);
  if (!channel) throw notFound();
  const access = await channelAccess(user, channel);
  if (access === 'none') throw notFound();
  return { channel, access };
}

registerRoomAuthoriser('chat', async (user, channelId) => {
  try {
    await loadChannelFor(user, channelId);
    return true;
  } catch {
    return false;
  }
});

export async function openSupportThread(student: UserDoc, serviceId: string) {
  if (!Types.ObjectId.isValid(serviceId)) throw notFound();
  const service = await ChatChannel.findOne({ _id: serviceId, kind: 'support_service', published: true });
  if (!service) throw notFound();
  const existing = await ChatChannel.findOne({ kind: 'support_thread', serviceId: service._id, studentId: student._id, closed: false });
  if (existing) return existing;
  const thread = await ChatChannel.create({
    kind: 'support_thread', name: service.name, serviceId: service._id, studentId: student._id, published: true, createdBy: student._id,
  });
  await ChatMembership.create({ channelId: thread._id, userId: student._id, role: 'student' });
  const staffFilter: Record<string, unknown> = { role: service.serviceRole, accountStatus: 'active' };
  if (service.committeeId) staffFilter['committeeMemberships.committeeId'] = service.committeeId;
  const staff = await User.find(staffFilter, { _id: 1 }).lean();
  await notifyMany(staff.map((s) => String(s._id)), { kind: 'support_thread', category: 'chat_messages', priority: 'high', title: `New ${service.name} conversation`, body: 'A student opened a private support conversation.', link: `/support/threads/${thread._id}` });
  return thread;
}

export async function senderLabelFor(user: UserDoc, channel: ChatChannelDoc) {
  if (user.role === 'student') {
    if (channel.kind === 'community' && user.privacy?.showNameInCommunity === false) return 'Student';
    return user.fullName;
  }
  const roleLabel: Record<string, string> = { counsellor: 'Counsellor', security_officer: 'Campus Security', committee_member: 'Committee', admin: 'Moderator', super_admin: 'Moderator' };
  return `${user.fullName.split(' ')[0]} · ${roleLabel[user.role] ?? 'Staff'}`;
}

export async function postChatMessage(user: UserDoc, channel: ChatChannelDoc, access: ChatAccess, input: { body: string; attachmentIds: string[]; clientMessageId: string }) {
  if (channel.closed) throw new AppError(409, 'closed', 'This conversation is closed.');
  if (channel.readOnly && access !== 'moderator') throw new AppError(403, 'read_only', 'Only moderators can post in this channel.');
  if (!input.body.trim() && !input.attachmentIds.length) throw new AppError(422, 'empty', 'Write a message or attach a file.');
  const settings = await getSettings();
  if (channel.kind === 'community') {
    if (!settings.chat.communityEnabled) throw new AppError(403, 'community_disabled', 'Community chat is turned off.');
    const recent = await ChatMessage.countDocuments({ channelId: channel._id, senderId: user._id, createdAt: { $gt: new Date(Date.now() - 60_000) } });
    if (recent >= settings.chat.communityPostRateLimitPerMinute) throw new AppError(429, 'rate_limited', 'You are posting too quickly. Please wait a moment.');
  }
  const dup = await ChatMessage.findOne({ channelId: channel._id, clientMessageId: input.clientMessageId }).lean();
  if (dup) return { message: dup, duplicate: true };

  // Media gate is re-checked at send time: if the Super Admin switched media off after the
  // upload, the message is refused.
  let attachments: { _id: unknown; mimeType?: string }[] = [];
  if (input.attachmentIds.length) {
    const scope = mediaScopeFor(channel.kind);
    const policy = settings.chat.media[scope];
    if (!policy.images && !policy.videos) throw new AppError(403, 'media_disabled', 'Image and video sending is turned off by your administrator.');
    attachments = await bindUploads(input.attachmentIds, { purpose: 'chat', uploaderId: String(user._id), channelId: String(channel._id) });
    for (const a of attachments as { mimeType: string }[]) {
      const isVideo = a.mimeType.startsWith('video/');
      if ((isVideo && !policy.videos) || (!isVideo && !policy.images)) throw new AppError(403, 'media_disabled', `${isVideo ? 'Video' : 'Image'} sending is turned off by your administrator.`);
    }
  }

  const message = await ChatMessage.create({
    channelId: channel._id, senderId: user._id, senderLabel: await senderLabelFor(user, channel), body: input.body,
    attachmentIds: attachments.map((a) => a._id), clientMessageId: input.clientMessageId,
  });
  channel.lastMessageAt = message.createdAt;
  // First staff reply claims an unassigned support thread.
  if (channel.kind === 'support_thread' && !channel.assignedStaffId && user.role !== 'student') {
    channel.assignedStaffId = user._id;
    await ChatMembership.updateOne({ channelId: channel._id, userId: user._id }, { $setOnInsert: { role: 'staff' } }, { upsert: true });
  }
  await channel.save();
  await ChatMembership.updateOne({ channelId: channel._id, userId: user._id }, { $set: { lastReadAt: message.createdAt } });
  emitToRoom(`chat:${channel._id}`, 'chat:message', { channelId: String(channel._id), messageId: String(message._id) });

  if (channel.kind !== 'community') {
    const others = channel.kind === 'support_thread'
      ? (user.role === 'student' ? (channel.assignedStaffId ? [String(channel.assignedStaffId)] : []) : [String(channel.studentId)])
      : (await ChatMembership.find({ channelId: channel._id, userId: { $ne: user._id } }, { userId: 1 }).lean()).map((m) => String(m.userId));
    await notifyMany(others, { kind: 'chat_message', category: 'chat_messages', title: 'New private message', body: `New message in ${channel.name}.`, link: user.role === 'student' ? `/support/threads/${channel._id}` : `/student/support/${channel._id}` });
  }
  return { message, duplicate: false };
}

export async function serializeMessages(user: UserDoc, docs: { _id: unknown; senderId: unknown; senderLabel: string; body: string; attachmentIds: unknown[]; clientMessageId: string; createdAt: Date; hidden: boolean }[], access: ChatAccess) {
  const blocked = new Set((await ChatBlock.find({ userId: user._id }, { blockedUserId: 1 }).lean()).map((b) => String(b.blockedUserId)));
  const ids = docs.flatMap((d) => d.attachmentIds.map(String));
  const files = await Evidence.find({ _id: { $in: ids } }, { originalName: 1, mimeType: 1, sizeBytes: 1, sha256: 1 }).lean();
  const fileMap = new Map(files.map((f) => [String(f._id), attachmentView(f)]));
  return docs
    .filter((d) => !blocked.has(String(d.senderId)))
    .map((d) => ({
      id: String(d._id),
      senderId: access === 'moderator' || String(d.senderId) === String(user._id) ? String(d.senderId) : undefined,
      senderLabel: d.senderLabel,
      mine: String(d.senderId) === String(user._id),
      body: d.hidden ? '' : d.body,
      hidden: d.hidden,
      attachments: d.hidden ? [] : d.attachmentIds.map((a) => fileMap.get(String(a))).filter(Boolean),
      clientMessageId: d.clientMessageId,
      createdAt: d.createdAt,
      canReport: !d.hidden && String(d.senderId) !== String(user._id),
    }));
}
