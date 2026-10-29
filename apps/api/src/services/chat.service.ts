import { Types } from 'mongoose';
import { hasPermission, type MediaScope, type Role } from '@campuscare/shared';
import { AppError, notFound } from '../lib/http';
import { ChatBlock, ChatChannel, ChatMembership, ChatMessage, type ChatChannelDoc } from '../models/chat';
import { ChatPreference } from '../models/chat-center';
import { Evidence } from '../models/incident';
import { User, type UserDoc } from '../models/user';
import { attachmentView, bindUploads } from './files.service';
import { notifyMany } from './notification.service';
import { emitToRoom, emitToUser, registerRoomAuthoriser } from '../realtime/socket';
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
      if (
        hasPermission(subjectOf(user), 'chat:moderate') ||
        hasPermission(subjectOf(user), 'announcements:manage') ||
        user.role === 'super_admin' ||
        user.role === 'admin' ||
        channel.moderatorIds?.some((m) => String(m) === uid)
      ) return 'moderator';
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
    case 'counselling_thread':
    case 'direct': {
      // Explicit membership
      const member = await ChatMembership.findOne({ channelId: channel._id, userId: user._id }).lean();
      if (member) return 'participant';
      // Staff channels for security officers, committee members, and admins
      if (channel.slug?.startsWith('security-') && (user.role === 'security_officer' || user.role === 'admin' || user.role === 'super_admin')) {
        return 'participant';
      }
      if (channel.slug?.startsWith('committee-') && (user.role === 'committee_member' || user.role === 'admin' || user.role === 'super_admin')) {
        return 'participant';
      }
      return 'none';
    }
    default:
      return 'none';
  }
}

export interface StaffChannelAlias {
  slug: string;
  name: string;
  description: string;
  serviceRole?: 'security_officer' | 'committee_member';
  initialMessage?: { senderLabel: string; body: string };
}

export const KNOWN_STAFF_CHANNEL_ALIASES: Record<string, StaffChannelAlias> = {
  'msg-ctrl': {
    slug: 'security-control-room',
    name: 'Control Room',
    description: 'Security Control Room & Dispatch Channel',
    serviceRole: 'security_officer',
    initialMessage: { senderLabel: 'Control Room Dispatch', body: 'SOS alert assigned to duty patrol team. Standby for situation updates.' },
  },
  'msg-admin': {
    slug: 'security-campus-admin',
    name: 'Campus Admin',
    description: 'Campus Admin Coordination with Security',
    initialMessage: { senderLabel: 'Campus Admin', body: 'Safety drill at 3 PM today. Ensure all gates and patrol responders are in position.' },
  },
  'msg-ravi': {
    slug: 'security-ravi-singh',
    name: 'Ravi Singh',
    description: 'Officer Ravi Singh Direct Line',
    serviceRole: 'security_officer',
    initialMessage: { senderLabel: 'Ravi Singh', body: 'En route to location. Situation is being monitored.' },
  },
  'msg-sita': {
    slug: 'security-sita-thomas',
    name: 'Sita Thomas',
    description: 'Officer Sita Thomas Direct Line',
    serviceRole: 'security_officer',
    initialMessage: { senderLabel: 'Sita Thomas', body: 'On site at Library. Area secure and peaceful.' },
  },
  'msg-team': {
    slug: 'security-officer-team',
    name: 'Officer Team',
    description: 'Campus Security Officer Team Channel',
    serviceRole: 'security_officer',
    initialMessage: { senderLabel: 'Officer Team Lead', body: 'Share live patrol updates, check-ins, and shift notes here.' },
  },
  'rep-msg-1': {
    slug: 'committee-report-discussion',
    name: 'Report #2026-0871',
    description: 'Investigation Discussion for Report #2026-0871',
    serviceRole: 'committee_member',
    initialMessage: { senderLabel: 'Case Officer', body: 'New evidence submitted for Report #2026-0871. Ready for committee review.' },
  },
  'team-msg-1': {
    slug: 'committee-team',
    name: 'Committee Team',
    description: 'Internal Complaints Committee Team',
    serviceRole: 'committee_member',
    initialMessage: { senderLabel: 'Committee Chair', body: 'Committee meeting scheduled for 4 PM in Admin Conference Room.' },
  },
  'team-msg-2': {
    slug: 'committee-kavya',
    name: 'Dr. Kavya S',
    description: 'Dr. Kavya S Direct Thread',
    serviceRole: 'committee_member',
    initialMessage: { senderLabel: 'Dr. Kavya S', body: 'Please review section 3 of the report draft.' },
  },
  'team-msg-3': {
    slug: 'committee-campus-admin',
    name: 'Campus Admin',
    description: 'Campus Admin Coordination with Committee',
    initialMessage: { senderLabel: 'Campus Admin', body: 'Policy update on handling anonymous incident reports.' },
  },
  'team-msg-4': {
    slug: 'committee-legal',
    name: 'Legal Advisor',
    description: 'Legal Advisor Advisory Thread',
    serviceRole: 'committee_member',
    initialMessage: { senderLabel: 'Legal Advisor', body: 'Guidelines for documentation and student privacy standards.' },
  },
};

export async function resolveOrCreateStaffChannel(channelIdOrAlias: string, user?: UserDoc): Promise<ChatChannelDoc> {
  if (Types.ObjectId.isValid(channelIdOrAlias)) {
    const existing = await ChatChannel.findById(channelIdOrAlias);
    if (existing) return existing;
  }

  const alias = KNOWN_STAFF_CHANNEL_ALIASES[channelIdOrAlias];
  const targetSlug = alias ? alias.slug : channelIdOrAlias;

  let channel = await ChatChannel.findOne({ slug: targetSlug });
  if (!channel) {
    channel = await ChatChannel.create({
      kind: 'direct',
      name: alias?.name ?? targetSlug.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
      slug: targetSlug,
      description: alias?.description ?? '',
      published: true,
      serviceRole: alias?.serviceRole ?? null,
    });
  }

  if (alias?.initialMessage) {
    const msgCount = await ChatMessage.countDocuments({ channelId: channel._id });
    if (msgCount === 0) {
      const sender = (await User.findOne({ role: 'super_admin' }, { _id: 1 }).lean()) ?? user;
      const seedMsg = await ChatMessage.create({
        channelId: channel._id,
        senderId: sender?._id ?? channel._id,
        senderLabel: alias.initialMessage.senderLabel,
        body: alias.initialMessage.body,
        clientMessageId: `seed-${targetSlug}-${Date.now()}`,
      });
      channel.lastMessageAt = seedMsg.createdAt;
      await channel.save();
    }
  }

  if (user) {
    await ChatMembership.updateOne(
      { channelId: channel._id, userId: user._id },
      { $setOnInsert: { role: 'staff' } },
      { upsert: true },
    );
  }

  return channel;
}

export async function loadChannelFor(user: UserDoc, channelId: string) {
  let channel: ChatChannelDoc | null = null;
  if (Types.ObjectId.isValid(channelId)) {
    channel = await ChatChannel.findById(channelId);
  }
  if (!channel && (channelId in KNOWN_STAFF_CHANNEL_ALIASES || channelId.startsWith('security-') || channelId.startsWith('committee-'))) {
    channel = await resolveOrCreateStaffChannel(channelId, user);
  }
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

/** Deep link for a direct conversation: the Super Admin web Chats center, otherwise the app's chat screen. */
export function directChatLink(role: string, channelId: string) {
  if (role === 'super_admin') return `/super-admin/chats?c=${channelId}`;
  return role === 'student' ? `/student/support/${channelId}` : `/support/threads/${channelId}`;
}

export async function senderLabelFor(user: UserDoc, channel: ChatChannelDoc) {
  if (user.role === 'student') {
    if (channel.kind === 'community' && user.privacy?.showNameInCommunity === false) return 'Student';
    return user.fullName;
  }
  if (channel.kind === 'direct') return `${user.fullName} · ${user.role === 'super_admin' ? 'Super Admin' : user.role === 'admin' ? 'Campus Admin' : user.role === 'security_officer' ? 'Campus Security' : user.role === 'committee_member' ? 'Committee' : 'Staff'}`;
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
    // Ids only — list refresh hint for the Chats center; never message content.
    others.forEach((id) => emitToUser(id, 'chats:changed', { channelId: String(channel._id) }));
    if (channel.kind === 'direct') {
      const muted = new Set((await ChatPreference.find({ itemType: 'channel', itemId: channel._id, muted: true }, { userId: 1 }).lean()).map((p) => String(p.userId)));
      const recipients = await User.find({ _id: { $in: others.filter((id) => !muted.has(id)) } }, { role: 1 }).lean();
      await Promise.all(recipients.map((r) => notifyMany([String(r._id)], {
        kind: 'chat_message', category: 'chat_messages', title: 'New private message', body: `New message from ${user.fullName.split(' ')[0]}.`,
        link: directChatLink(r.role, String(channel._id)),
      })));
    } else {
      await notifyMany(others, { kind: 'chat_message', category: 'chat_messages', title: 'New private message', body: `New message in ${channel.name}.`, link: user.role === 'student' ? `/support/threads/${channel._id}` : `/student/support/${channel._id}` });
    }
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
