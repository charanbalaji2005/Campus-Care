import type { Request } from 'express';
import { Types } from 'mongoose';
import {
  ACTIVE_APPOINTMENT_STATUSES, CHAT_CATEGORY_LABELS, TERMINAL_STATUSES, directChatPurpose, hasPermission,
  type ChatCategory, type ChatItemType, type Permission, type Role,
} from '@campuscare/shared';
import { AppError, escapeRegex, notFound } from '../lib/http';
import { anonymousReporterTag } from '../lib/crypto';
import { logger } from '../lib/logger';
import { ChatChannel, ChatMembership, ChatMessage, type ChatChannelDoc } from '../models/chat';
import { ChatPreference } from '../models/chat-center';
import { Announcement } from '../models/content';
import { Appointment } from '../models/counselling';
import { Incident } from '../models/incident';
import { SupportTicket } from '../models/support';
import { EmergencyAlert } from '../models/safety';
import { EmailDelivery } from '../models/platform';
import { User, type UserDoc } from '../models/user';
import { emitBroadcast, isUserOnline } from '../realtime/socket';
import { audit } from './audit.service';
import { channelAccess } from './chat.service';
import { loadIncidentFor } from './incident.service';
import { notifyMany } from './notification.service';
import { getSettings } from './settings.service';

export const can = (u: UserDoc, p: Permission) => hasPermission({ role: u.role as Role, permissions: u.permissions ?? [] }, p);
const isAdmin = (u: UserDoc) => u.role === 'admin' || u.role === 'super_admin';
const SERVICE_ROLES = ['counsellor', 'security_officer', 'committee_member'];
/** Counselling requests older than this without a decision are flagged for follow-up. */
export const COUNSELLING_RESPONSE_MS = 3600_000;

// ------------------------------------------------------------------ categories

/** Categories this user may open. Counts and lists inside each one are authorised separately. */
export async function categoriesFor(user: UserDoc): Promise<ChatCategory[]> {
  const settings = await getSettings();
  const out: ChatCategory[] = ['all', 'announcements'];
  if (user.role === 'counsellor' || can(user, 'appointments:read_aggregate') || user.role === 'student' || isAdmin(user)) {
    out.push('bookings');
  }
  if (['incidents:triage', 'incidents:read_committee', 'incidents:read_sensitive', 'incidents:read_own'].some((p) => can(user, p as Permission)) || isAdmin(user)) {
    out.push('reports');
  }
  if (user.role === 'counsellor' || can(user, 'appointments:read_aggregate')) { out.push('counselling'); }
  if (user.role === 'student' || user.role === 'counsellor' || can(user, 'appointments:read_aggregate')) {
    out.push('student_counsellor');
  }
  if (user.role === 'student' || isAdmin(user)) {
    out.push('student_admin');
  }
  if (isAdmin(user)) {
    out.push('admin_super_admin');
  }
  if (user.role === 'counsellor' || isAdmin(user)) {
    out.push('counsellor_admin');
  }
  if (can(user, 'support:manage') || can(user, 'chat:support') || SERVICE_ROLES.includes(user.role) || isAdmin(user) || user.role === 'student') {
    out.push('support');
  }
  if (can(user, 'sos:dispatch') || user.role === 'security_officer' || isAdmin(user)) {
    out.push('security');
  }
  if (can(user, 'chat:community') && (settings.chat.communityEnabled || (await ChatChannel.exists({ kind: 'community', published: true, readOnly: true })))) {
    out.push('community');
  }
  if (isAdmin(user) || user.role === 'counsellor' || user.role === 'student') {
    out.push('direct');
  }
  if (isAdmin(user) || can(user, 'email:manage') || can(user, 'admin:access')) {
    out.push('notifications');
  }
  out.push('unread', 'archived');
  return out;
}

export function categoryList(keys: ChatCategory[]) {
  return keys.map((key) => ({ key, label: CHAT_CATEGORY_LABELS[key] }));
}

function channelCategory(c: { kind: string; purpose?: string | null }): ChatCategory {
  if (c.kind === 'community') return 'community';
  if (c.kind === 'support_thread') return 'support';
  if (c.kind === 'counselling_thread') return 'student_counsellor';
  return (c.purpose as ChatCategory) ?? 'all';
}

// ------------------------------------------------------------------ unified conversation list

export interface ConversationItem {
  type: 'channel' | 'ticket' | 'appointment' | 'report' | 'sos' | 'notification' | 'announcement';
  id: string;
  category: ChatCategory;
  kind: string;
  title: string;
  /** Who is on the other side, only as far as the caller may know it. */
  subtitle: string | null;
  /** Last message text. Null whenever the caller cannot read the conversation. */
  preview: string | null;
  lastActivityAt: Date | null;
  unread: number;
  online: boolean | null;
  status: string | null;
  priority: string | null;
  /** Listed for oversight only — the content is restricted (counselling privacy, private support). */
  locked: boolean;
  lockedReason?: string;
  readOnly?: boolean;
  needsResponse: boolean;
  pinned: boolean;
  archived: boolean;
  muted: boolean;
  markedUnread: boolean;
  threadId?: string | null;
}

type Lean<T> = T & { _id: Types.ObjectId };
type ChannelLean = Lean<{ kind: string; name: string; purpose?: string | null; studentId?: unknown; serviceId?: unknown; assignedStaffId?: unknown; closed?: boolean | null; readOnly?: boolean | null; lastMessageAt?: Date | null; createdAt?: Date; description?: string | null }>;

const wants = (category: ChatCategory, ...cats: ChatCategory[]) => ['all', 'unread', 'archived'].includes(category) || cats.includes(category);

/** Channels the caller participates in (or can answer), never more than the chat service itself would allow. */
async function accessibleChannels(user: UserDoc, category: ChatCategory) {
  const memberships = await ChatMembership.find({ userId: user._id }, { channelId: 1, lastReadAt: 1 }).lean();
  const lastRead = new Map(memberships.map((m) => [String(m.channelId), m.lastReadAt as Date | null]));
  const kinds: string[] = [];
  if (wants(category, 'student_counsellor')) kinds.push('counselling_thread');
  if (wants(category, 'support')) kinds.push('support_thread');
  if (wants(category, 'student_admin', 'admin_super_admin', 'counsellor_admin')) kinds.push('direct');

  const or: Record<string, unknown>[] = [{ _id: { $in: memberships.map((m) => m.channelId) }, kind: { $in: kinds } }];
  // Unassigned support threads are open to the answering staff pool of their service.
  if (kinds.includes('support_thread') && SERVICE_ROLES.includes(user.role)) {
    const services = await ChatChannel.find({ kind: 'support_service', serviceRole: user.role }, { committeeId: 1 }).lean();
    const myCommittees = new Set((user.committeeMemberships ?? []).map((m) => String(m.committeeId)));
    const ids = services.filter((s) => !s.committeeId || myCommittees.has(String(s.committeeId))).map((s) => s._id);
    if (ids.length) or.push({ kind: 'support_thread', serviceId: { $in: ids }, closed: false, $or: [{ assignedStaffId: null }, { assignedStaffId: user._id }] });
  }
  let channels = (await ChatChannel.find({ $or: or }).sort({ lastMessageAt: -1 }).limit(300).lean()) as ChannelLean[];
  if (['student_admin', 'admin_super_admin', 'counsellor_admin'].includes(category)) channels = channels.filter((c) => c.kind !== 'direct' || c.purpose === category);
  if (category === 'direct') channels = channels.filter((c) => c.kind === 'direct' || c.kind === 'counselling_thread');

  if (wants(category, 'community') && can(user, 'chat:community')) {
    const settings = await getSettings();
    const community = (await ChatChannel.find({ kind: 'community', published: true, ...(settings.chat.communityEnabled ? {} : { readOnly: true }) }).sort({ order: 1 }).limit(50).lean()) as ChannelLean[];
    channels.push(...community);
  }
  return { channels, lastRead };
}

/** Oversight rows: conversations that exist but whose content the caller may not read. */
async function lockedChannels(user: UserDoc, category: ChatCategory, exclude: Set<string>) {
  const out: ChannelLean[] = [];
  if (category === 'student_counsellor' && can(user, 'appointments:read_aggregate')) {
    out.push(...((await ChatChannel.find({ kind: 'counselling_thread', _id: { $nin: [...exclude].map((id) => new Types.ObjectId(id)) } }).sort({ lastMessageAt: -1 }).limit(100).lean()) as ChannelLean[]));
  }
  if (category === 'support' && (can(user, 'support:manage') || can(user, 'chat:configure'))) {
    out.push(...((await ChatChannel.find({ kind: 'support_thread', _id: { $nin: [...exclude].map((id) => new Types.ObjectId(id)) } }).sort({ lastMessageAt: -1 }).limit(100).lean()) as ChannelLean[]));
  }
  return out;
}

async function unreadCounts(userId: Types.ObjectId, channels: ChannelLean[], lastRead: Map<string, Date | null>) {
  const clauses = channels
    .filter((c) => c.lastMessageAt && lastRead.has(String(c._id)) && c.lastMessageAt > (lastRead.get(String(c._id)) ?? new Date(0)))
    .map((c) => ({ channelId: c._id, createdAt: { $gt: lastRead.get(String(c._id)) ?? new Date(0) } }));
  if (!clauses.length) return new Map<string, number>();
  const rows = await ChatMessage.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { senderId: { $ne: userId }, hidden: false, $or: clauses } },
    { $group: { _id: '$channelId', n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.n]));
}

async function lastMessages(channelIds: Types.ObjectId[]) {
  if (!channelIds.length) return new Map<string, { body: string; senderId: string; senderLabel: string; hasAttachment: boolean }>();
  const rows = await ChatMessage.aggregate<{ _id: Types.ObjectId; body: string; senderId: Types.ObjectId; senderLabel: string; hidden: boolean; attachments: number }>([
    { $match: { channelId: { $in: channelIds } } },
    { $sort: { channelId: 1, createdAt: -1 } },
    { $group: { _id: '$channelId', body: { $first: '$body' }, senderId: { $first: '$senderId' }, senderLabel: { $first: '$senderLabel' }, hidden: { $first: '$hidden' }, attachments: { $first: { $size: '$attachmentIds' } } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), { body: r.hidden ? 'Message hidden by a moderator' : r.body, senderId: String(r.senderId), senderLabel: r.senderLabel, hasAttachment: r.attachments > 0 }]));
}

async function preferencesFor(userId: Types.ObjectId, ids: string[]) {
  if (!ids.length) return new Map<string, { pinned: boolean; archived: boolean; muted: boolean; markedUnread: boolean; lastReadAt: Date | null }>();
  const prefs = await ChatPreference.find({ userId, itemId: { $in: ids.map((id) => new Types.ObjectId(id)) } }).lean();
  return new Map(prefs.map((p) => [`${p.itemType}:${p.itemId}`, { pinned: p.pinned, archived: p.archived, muted: p.muted, markedUnread: p.markedUnread, lastReadAt: p.lastReadAt ?? null }]));
}

async function supportTickets(user: UserDoc, category: ChatCategory): Promise<ConversationItem[]> {
  if (!wants(category, 'support') || !can(user, 'support:manage') || !can(user, 'admin:access')) return [];
  const tickets = await SupportTicket.find(
    category === 'support' ? {} : { status: { $nin: ['closed', 'resolved'] } },
    { ticketNumber: 1, subject: 1, status: 1, priority: 1, studentId: 1, firstResponseAt: 1, updatedAt: 1, createdAt: 1, messages: { $slice: -1 } },
  ).sort({ updatedAt: -1 }).limit(category === 'support' ? 100 : 40).lean();
  const students = await User.find({ _id: { $in: tickets.map((t) => t.studentId) } }, { fullName: 1 }).lean();
  const names = new Map(students.map((s) => [String(s._id), s.fullName]));
  const prefs = await preferencesFor(user._id, tickets.map((t) => String(t._id)));
  return tickets.map((t) => {
    const last = t.messages?.[t.messages.length - 1] as { message?: string; isInternal?: boolean; senderRole?: string; createdAt?: Date } | undefined;
    const pref = prefs.get(`ticket:${t._id}`);
    const unanswered = ['new', 'open', 'reopened'].includes(t.status) && !t.firstResponseAt;
    const studentWroteLast = !last || last.senderRole === 'student';
    const seen = pref?.lastReadAt && pref.lastReadAt >= (t.updatedAt as Date);
    return {
      type: 'ticket', id: String(t._id), category: 'support', kind: 'ticket',
      title: `${t.ticketNumber} · ${t.subject}`, subtitle: names.get(String(t.studentId)) ?? 'Student',
      preview: last ? `${last.isInternal ? 'Internal note: ' : ''}${last.message ?? ''}`.slice(0, 160) : null,
      lastActivityAt: (t.updatedAt as Date) ?? null,
      unread: !seen && studentWroteLast && !['closed', 'resolved'].includes(t.status) ? 1 : 0,
      online: null, status: t.status, priority: t.priority, locked: false,
      needsResponse: unanswered || (studentWroteLast && ['open', 'reopened', 'assigned'].includes(t.status)),
      pinned: Boolean(pref?.pinned), archived: Boolean(pref?.archived), muted: Boolean(pref?.muted), markedUnread: Boolean(pref?.markedUnread),
    } satisfies ConversationItem;
  });
}

/** Counselling requests (appointments). Administrators see workflow metadata only — never the student or reason. */
async function counsellingRequests(user: UserDoc): Promise<ConversationItem[]> {
  const own = user.role === 'counsellor';
  if (!own && !can(user, 'appointments:read_aggregate')) return [];
  const appts = await Appointment.find(own ? { counsellorId: user._id, status: { $in: ACTIVE_APPOINTMENT_STATUSES } } : { status: { $in: ACTIVE_APPOINTMENT_STATUSES } })
    .sort({ createdAt: -1 }).limit(100).lean();
  const people = await User.find({ _id: { $in: appts.flatMap((a) => (own ? [a.studentId] : [a.counsellorId])).filter(Boolean) } }, { fullName: 1 }).lean();
  const names = new Map(people.map((p) => [String(p._id), p.fullName]));
  const prefs = await preferencesFor(user._id, appts.map((a) => String(a._id)));
  return appts.map((a) => {
    const pref = prefs.get(`channel:${a._id}`);
    const overdue = a.status === 'requested' && Date.now() - (a.createdAt as Date).getTime() > COUNSELLING_RESPONSE_MS;
    return {
      type: 'appointment', id: String(a._id), category: 'counselling', kind: 'appointment',
      title: `Request ${String(a._id).slice(-6).toUpperCase()}`,
      subtitle: own ? names.get(String(a.studentId)) ?? 'Student' : a.counsellorId ? `Counsellor: ${names.get(String(a.counsellorId)) ?? 'Assigned'}` : 'Awaiting assignment',
      preview: own ? a.reason ?? null : null,
      lastActivityAt: (a.updatedAt as Date) ?? null, unread: 0, online: null,
      status: a.status, priority: overdue ? 'urgent' : null,
      locked: !own, lockedReason: own ? undefined : 'Counselling requests are private. Administrators see workflow status only.',
      needsResponse: own && a.status === 'requested', threadId: own && a.threadId ? String(a.threadId) : null,
      pinned: Boolean(pref?.pinned), archived: Boolean(pref?.archived), muted: false, markedUnread: false,
    } satisfies ConversationItem;
  });
}



async function bookingItems(user: UserDoc, category: ChatCategory): Promise<ConversationItem[]> {
  if (!wants(category, 'bookings')) return [];
  const own = user.role === 'counsellor';
  const isStudent = user.role === 'student';
  const canAggregate = can(user, 'appointments:read_aggregate') || isAdmin(user);
  if (!own && !isStudent && !canAggregate) return [];

  const filter: Record<string, unknown> = {};
  if (own) filter.counsellorId = user._id;
  else if (isStudent) filter.studentId = user._id;

  const appts = await Appointment.find(filter).sort({ createdAt: -1 }).limit(category === 'bookings' ? 100 : 30).lean();
  const peopleIds = appts.flatMap((a) => [a.studentId, a.counsellorId]).filter(Boolean);
  const people = await User.find({ _id: { $in: peopleIds } }, { fullName: 1, role: 1 }).lean();
  const names = new Map(people.map((p) => [String(p._id), p.fullName]));
  const prefs = await preferencesFor(user._id, appts.map((a) => String(a._id)));

  return appts.map((a) => {
    const pref = prefs.get(`channel:${a._id}`);
    const overdue = a.status === 'requested' && Date.now() - (a.createdAt as Date).getTime() > COUNSELLING_RESPONSE_MS;
    const studentName = names.get(String(a.studentId)) ?? 'Student';
    const counsellorName = a.counsellorId ? names.get(String(a.counsellorId)) ?? 'Counsellor' : 'Awaiting Counsellor';
    const timeStr = a.startAt ? new Date(a.startAt).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Flexible';

    return {
      type: 'appointment',
      id: String(a._id),
      category: 'bookings',
      kind: 'appointment',
      title: `${(a.counsellingType || 'counselling').replace(/_/g, ' ').toUpperCase()} • ${a.mode === 'online' ? 'Video' : 'In-Person'}`,
      subtitle: isStudent ? `Counsellor: ${counsellorName} • ${timeStr}` : `${studentName} with ${counsellorName} • ${timeStr}`,
      preview: a.reason ? `Reason: ${a.reason}` : `Appointment status: ${a.status}`,
      lastActivityAt: (a.updatedAt as Date) ?? (a.createdAt as Date) ?? null,
      unread: a.status === 'requested' && (own || canAggregate) ? 1 : 0,
      online: null,
      status: a.status,
      priority: overdue ? 'urgent' : a.status === 'requested' ? 'high' : null,
      locked: false,
      needsResponse: a.status === 'requested' && (own || canAggregate),
      threadId: a.threadId ? String(a.threadId) : null,
      pinned: Boolean(pref?.pinned),
      archived: Boolean(pref?.archived),
      muted: false,
      markedUnread: false,
    } satisfies ConversationItem;
  });
}

async function sosAlertItems(user: UserDoc, category: ChatCategory): Promise<ConversationItem[]> {
  if (!wants(category, 'security')) return [];
  if (!can(user, 'sos:dispatch') && user.role !== 'security_officer' && !isAdmin(user)) return [];

  const alerts = await EmergencyAlert.find({}).sort({ createdAt: -1 }).limit(category === 'security' ? 50 : 20).lean();
  const students = await User.find({ _id: { $in: alerts.map((a) => a.userId) } }, { fullName: 1, phone: 1 }).lean();
  const studentMap = new Map(students.map((s) => [String(s._id), s]));
  const prefs = await preferencesFor(user._id, alerts.map((a) => String(a._id)));

  return alerts.map((a) => {
    const pref = prefs.get(`channel:${a._id}`);
    const student = studentMap.get(String(a.userId));
    const active = ['active', 'queued', 'pending'].includes(a.status);
    const loc = a.latitude && a.longitude ? `Lat: ${a.latitude.toFixed(4)}, Lng: ${a.longitude.toFixed(4)}` : 'Location unavailable';

    return {
      type: 'sos',
      id: String(a._id),
      category: 'security',
      kind: 'sos_alert',
      title: `${a.alertNumber || 'SOS Alert'} • ${student?.fullName || 'Campus Member'}`,
      subtitle: `Status: ${a.status.toUpperCase()} • Battery: ${a.batteryLevel ?? 'N/A'}% • ${loc}`,
      preview: a.note ? `Note: ${a.note}` : `Emergency dispatch trigger (${a.triggerSource || 'app'}). ${a.status === 'resolved' ? 'Resolved successfully.' : 'Urgent officer response required.'}`,
      lastActivityAt: (a.updatedAt as Date) ?? (a.createdAt as Date) ?? null,
      unread: active ? 1 : 0,
      online: null,
      status: a.status,
      priority: active ? 'urgent' : null,
      locked: false,
      needsResponse: active,
      threadId: null,
      pinned: Boolean(pref?.pinned) || active,
      archived: Boolean(pref?.archived),
      muted: false,
      markedUnread: false,
    } satisfies ConversationItem;
  });
}

async function notificationDeliveryItems(user: UserDoc, category: ChatCategory): Promise<ConversationItem[]> {
  if (!wants(category, 'notifications')) return [];
  if (!isAdmin(user) && !can(user, 'email:manage') && !can(user, 'admin:access')) return [];

  const deliveries = await EmailDelivery.find({}).sort({ createdAt: -1 }).limit(category === 'notifications' ? 50 : 20).lean();
  const prefs = await preferencesFor(user._id, deliveries.map((d) => String(d._id)));

  return deliveries.map((d) => {
    const pref = prefs.get(`ticket:${d._id}`);
    const failed = d.status === 'failed' || d.status === 'bounced';

    const templateName = (d.template || 'System Notification').replace(/_/g, ' ');
    const to = (d as any).toMasked || (d as any).to || 'recipient';
    return {
      type: 'notification',
      id: String(d._id),
      category: 'notifications',
      kind: 'notification_delivery',
      title: templateName,
      subtitle: `To: ${to} • Provider: ${d.provider ?? 'SMTP'} • Attempts: ${d.attempts}`,
      preview: d.lastError ? `Delivery Error: ${d.lastError}` : `Delivered via ${d.provider ?? 'SMTP'} successfully.`,
      lastActivityAt: (d.sentAt ?? d.updatedAt ?? d.createdAt ?? null) as Date | null,
      unread: failed ? 1 : 0,
      online: null,
      status: d.status,
      priority: failed ? 'urgent' : null,
      locked: false,
      needsResponse: failed,
      threadId: null,
      pinned: Boolean(pref?.pinned),
      archived: Boolean(pref?.archived),
      muted: false,
      markedUnread: false,
    } satisfies ConversationItem;
  });
}

async function reportCases(user: UserDoc, category: ChatCategory): Promise<ConversationItem[]> {
  if (!wants(category, 'reports')) return [];
  const canTriage = can(user, 'incidents:triage') || user.role === 'super_admin';
  const canCommittee = can(user, 'incidents:read_committee');
  const canOwn = can(user, 'incidents:read_own');
  if (!canTriage && !canCommittee && !canOwn) return [];

  const filter: Record<string, unknown> = {};
  if (!canTriage) {
    if (canCommittee && (user.committeeMemberships ?? []).length) {
      filter.committeeId = { $in: user.committeeMemberships.map((m) => m.committeeId) };
    } else if (canOwn) {
      filter.reporterId = user._id;
    }
  }

  const reports = await Incident.find(filter, {
    caseNumber: 1, title: 1, status: 1, priority: 1, category: 1,
    description: 1, updatedAt: 1, createdAt: 1
  }).sort({ updatedAt: -1 }).limit(category === 'reports' ? 100 : 30).lean();

  const prefs = await preferencesFor(user._id, reports.map((r) => String(r._id)));

  return reports.map((r) => {
    const pref = prefs.get(`case:${r._id}`);
    const isNew = r.status === 'submitted';
    return {
      type: 'report',
      id: String(r._id),
      category: 'reports',
      kind: 'report',
      title: `${r.caseNumber} · ${r.title}`,
      subtitle: `Report · ${r.category} · ${r.status}`,
      preview: r.description ? r.description.slice(0, 160) : 'Incident report submitted.',
      lastActivityAt: (r.updatedAt as Date) ?? null,
      unread: isNew ? 1 : 0,
      online: null,
      status: r.status,
      priority: r.priority,
      locked: false,
      needsResponse: isNew,
      threadId: null,
      pinned: Boolean(pref?.pinned),
      archived: Boolean(pref?.archived),
      muted: Boolean(pref?.muted),
      markedUnread: Boolean(pref?.markedUnread),
    } satisfies ConversationItem;
  });
}

export async function listConversations(user: UserDoc, opts: { category: ChatCategory; view?: 'archived' | 'unread' | 'pinned'; q?: string }): Promise<ConversationItem[]> {
  const { category } = opts;
  const view = opts.view ?? (category === 'archived' ? 'archived' : category === 'unread' ? 'unread' : undefined);
  if (category === 'counselling') return finish(await counsellingRequests(user), view, opts.q);
  if (category === 'announcements' || category === 'reports') return [];
  if (category === 'bookings') return finish(await bookingItems(user, category), view, opts.q);
  if (category === 'security') return finish(await sosAlertItems(user, category), view, opts.q);
  if (category === 'notifications') return finish(await notificationDeliveryItems(user, category), view, opts.q);

  const { channels, lastRead } = await accessibleChannels(user, category);
  const accessible = new Set(channels.map((c) => String(c._id)));
  const locked = await lockedChannels(user, category, accessible);
  const [unread, last, prefs] = await Promise.all([
    unreadCounts(user._id, channels.filter((c) => c.kind !== 'community'), lastRead),
    lastMessages(channels.map((c) => c._id)),
    preferencesFor(user._id, [...channels, ...locked].map((c) => String(c._id))),
  ]);

  // Who is on the other side of each private conversation (one query each, no per-row lookups).
  const privateIds = [...channels, ...locked].filter((c) => ['direct', 'counselling_thread'].includes(c.kind)).map((c) => c._id);
  const members = privateIds.length ? await ChatMembership.find({ channelId: { $in: privateIds } }, { channelId: 1, userId: 1, role: 1 }).lean() : [];
  const peopleIds = new Set<string>(members.map((m) => String(m.userId)));
  [...channels, ...locked].forEach((c) => { if (c.studentId) peopleIds.add(String(c.studentId)); });
  const services = await ChatChannel.find({ _id: { $in: [...channels, ...locked].map((c) => c.serviceId).filter(Boolean) } }, { name: 1 }).lean();
  const serviceNames = new Map(services.map((s) => [String(s._id), s.name]));
  const people = await User.find({ _id: { $in: [...peopleIds].map((id) => new Types.ObjectId(id)) } }, { fullName: 1, role: 1, studentId: 1 }).lean();
  const person = new Map(people.map((p) => [String(p._id), p]));
  const membersOf = (id: unknown) => members.filter((m) => String(m.channelId) === String(id));
  const me = String(user._id);

  const items: ConversationItem[] = [];
  for (const c of channels) {
    const id = String(c._id);
    const pref = prefs.get(`channel:${id}`);
    const lm = last.get(id);
    let title = c.name;
    let subtitle: string | null = null;
    let otherId: string | null = null;
    if (c.kind === 'direct' || c.kind === 'counselling_thread') {
      const other = membersOf(c._id).find((m) => String(m.userId) !== me);
      otherId = other ? String(other.userId) : null;
      const p = otherId ? person.get(otherId) : null;
      title = p?.fullName ?? (c.kind === 'counselling_thread' ? 'Counsellor' : 'Conversation');
      subtitle = c.kind === 'counselling_thread' ? (user.role === 'student' ? 'Private counselling' : `Student${p?.studentId ? ` · ${p.studentId}` : ''}`) : roleName(p?.role);
    } else if (c.kind === 'support_thread') {
      const service = serviceNames.get(String(c.serviceId)) ?? c.name;
      if (user.role === 'student') title = service;
      else { title = person.get(String(c.studentId))?.fullName ?? 'Student'; subtitle = service; }
    } else if (c.kind === 'community') {
      subtitle = c.readOnly ? 'Official channel' : 'Community channel';
    }
    const n = unread.get(id) ?? 0;
    const lastFromOther = Boolean(lm && lm.senderId !== me);
    items.push({
      type: 'channel', id, category: channelCategory(c), kind: c.kind, title, subtitle,
      preview: lm ? `${lm.senderId === me ? 'You: ' : c.kind === 'community' ? `${lm.senderLabel}: ` : ''}${lm.body || (lm.hasAttachment ? '📎 Attachment' : '')}`.slice(0, 160) : null,
      lastActivityAt: c.lastMessageAt ?? c.createdAt ?? null, unread: n,
      online: otherId ? isUserOnline(otherId) : null,
      status: c.closed ? 'closed' : 'open', priority: null, locked: false,
      readOnly: c.kind === 'community' ? Boolean(c.readOnly) && !isAdmin(user) : undefined,
      needsResponse: c.kind !== 'community' && !c.closed && lastFromOther && n > 0,
      pinned: Boolean(pref?.pinned), archived: Boolean(pref?.archived), muted: Boolean(pref?.muted), markedUnread: Boolean(pref?.markedUnread),
    });
  }
  for (const c of locked) {
    const id = String(c._id);
    const pref = prefs.get(`channel:${id}`);
    const counsellorM = membersOf(c._id).find((m) => m.role === 'staff');
    const isCounselling = c.kind === 'counselling_thread';
    items.push({
      type: 'channel', id, category: channelCategory(c), kind: c.kind,
      title: isCounselling ? 'Private counselling conversation' : `${serviceNames.get(String(c.serviceId)) ?? 'Support'} conversation`,
      subtitle: isCounselling ? (counsellorM ? `Counsellor: ${person.get(String(counsellorM.userId))?.fullName ?? 'Assigned'}` : null) : c.assignedStaffId ? 'Assigned to staff' : 'Waiting for staff',
      preview: null, lastActivityAt: c.lastMessageAt ?? c.createdAt ?? null, unread: 0, online: null,
      status: c.closed ? 'closed' : 'open', priority: null, locked: true,
      lockedReason: isCounselling
        ? 'Counselling conversations are confidential between the student and counsellor. Administrators never see their content.'
        : 'Private support conversations are visible to their participants only. Content access needs an exceptional, audited review grant.',
      needsResponse: false,
      pinned: Boolean(pref?.pinned), archived: Boolean(pref?.archived), muted: Boolean(pref?.muted), markedUnread: false,
    });
  }
  items.push(...(await supportTickets(user, category)));
  items.push(...(await reportCases(user, category)));
  return finish(items, view, opts.q);
}

function roleName(role?: string | null) {
  return role === 'super_admin' ? 'Super Admin' : role === 'admin' ? 'Campus Admin' : role === 'counsellor' ? 'Counsellor' : role === 'student' ? 'Student' : null;
}

function finish(items: ConversationItem[], view: 'archived' | 'unread' | 'pinned' | undefined, q?: string) {
  let out = items;
  if (view === 'archived') out = out.filter((i) => i.archived);
  else out = out.filter((i) => !i.archived);
  if (view === 'unread') out = out.filter((i) => i.unread > 0 || i.markedUnread);
  if (view === 'pinned') out = out.filter((i) => i.pinned);
  const needle = q?.trim().toLowerCase().slice(0, 80);
  if (needle) out = out.filter((i) => [i.title, i.subtitle, i.preview].some((s) => s?.toLowerCase().includes(needle)));
  return out.sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.lastActivityAt?.getTime() ?? 0) - (a.lastActivityAt?.getTime() ?? 0)).slice(0, 200);
}

// ------------------------------------------------------------------ item access (preferences / read markers)

/** Throws 404 unless the caller can at least see this item in their Chats lists. */
export async function assertItemVisible(user: UserDoc, itemType: ChatItemType, itemId: string): Promise<{ channel?: ChatChannelDoc; member?: boolean }> {
  if (!Types.ObjectId.isValid(itemId)) throw notFound();
  switch (itemType) {
    case 'channel': {
      const channel = await ChatChannel.findById(itemId);
      if (channel) {
        if ((await channelAccess(user, channel)) !== 'none') return { channel, member: true };
        if (channel.kind === 'counselling_thread' && can(user, 'appointments:read_aggregate')) return { channel, member: false };
        if (channel.kind === 'support_thread' && (can(user, 'support:manage') || can(user, 'chat:configure'))) return { channel, member: false };
        throw notFound();
      }
      // Counselling requests share the "channel" preference namespace.
      const appt = await Appointment.findById(itemId, { counsellorId: 1 }).lean();
      if (appt && (String(appt.counsellorId) === String(user._id) || can(user, 'appointments:read_aggregate'))) return {};
      throw notFound();
    }
    case 'case':
      await loadIncidentFor(user, itemId);
      return {};
    case 'ticket':
      if (!can(user, 'support:manage') || !can(user, 'admin:access') || !(await SupportTicket.exists({ _id: itemId }))) throw notFound();
      return {};
    case 'announcement': {
      const visible = can(user, 'announcements:manage') ? await Announcement.exists({ _id: itemId }) : await Announcement.exists({ _id: itemId, ...announcementAudienceFilter(user) });
      if (!visible) throw notFound();
      return {};
    }
    case 'appointment': {
      const appt = await Appointment.findById(itemId).lean();
      if (!appt) throw notFound();
      const isOwner = String(appt.studentId) === String(user._id);
      const isCounsellor = String(appt.counsellorId) === String(user._id);
      const canAgg = can(user, 'appointments:read_aggregate') || user.role === 'super_admin';
      if (!isOwner && !isCounsellor && !canAgg) throw notFound();
      return {};
    }
    case 'sos': {
      if (!can(user, 'sos:dispatch') && user.role !== 'security_officer' && !isAdmin(user)) throw notFound();
      const alert = await EmergencyAlert.findById(itemId).lean();
      if (!alert) throw notFound();
      return {};
    }
    case 'notification': {
      if (!isAdmin(user) && !can(user, 'email:manage') && !can(user, 'admin:access')) throw notFound();
      const delivery = await EmailDelivery.findById(itemId).lean();
      if (!delivery) throw notFound();
      return {};
    }
    default:
      return {};
  }
}

// ------------------------------------------------------------------ direct conversations

export function directKeyFor(a: string, b: string) {
  return [a, b].sort().join(':');
}

export async function openDirectConversation(user: UserDoc, otherId: string, req?: Request) {
  if (String(user._id) === otherId) throw new AppError(422, 'self', 'You cannot start a conversation with yourself.');
  const other = Types.ObjectId.isValid(otherId) ? await User.findOne({ _id: otherId, accountStatus: 'active' }, { fullName: 1, role: 1 }).lean() : null;
  if (!other) throw notFound('That person is not available on CampusCare.');
  const purpose = directChatPurpose(user.role as Role, other.role as Role);
  if (!purpose) throw new AppError(403, 'forbidden', 'You are not permitted to start a conversation with this person.');
  const directKey = directKeyFor(String(user._id), String(other._id));
  const existing = await ChatChannel.findOne({ kind: 'direct', directKey });
  if (existing) {
    if (existing.closed) { existing.closed = false; await existing.save(); }
    return { channel: existing, created: false };
  }
  const recent = await ChatChannel.countDocuments({ kind: 'direct', createdBy: user._id, createdAt: { $gt: new Date(Date.now() - 3600_000) } });
  if (recent >= 30) throw new AppError(429, 'rate_limited', 'You have started many conversations in the last hour. Please wait a moment.');
  let channel: ChatChannelDoc;
  try {
    channel = await ChatChannel.create({ kind: 'direct', purpose, directKey, name: CHAT_CATEGORY_LABELS[purpose], published: true, createdBy: user._id });
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err;
    return { channel: (await ChatChannel.findOne({ kind: 'direct', directKey }))!, created: false }; // concurrent open
  }
  const roleOf = (r: string) => (r === 'student' ? 'student' : 'staff');
  await ChatMembership.insertMany([
    { channelId: channel._id, userId: user._id, role: roleOf(user.role) },
    { channelId: channel._id, userId: other._id, role: roleOf(other.role) },
  ]);
  await audit({ action: 'chat.direct_opened', req, targetType: 'channel', targetId: String(channel._id), meta: { purpose, otherRole: other.role } });
  return { channel, created: true };
}

/** People the caller may start a direct conversation with. */
export async function directContacts(user: UserDoc, q: string) {
  const roles = (['student', 'counsellor', 'admin', 'super_admin'] as Role[]).filter((r) => directChatPurpose(user.role as Role, r));
  if (!roles.length) return [];
  const filter: Record<string, unknown> = { role: { $in: roles }, accountStatus: 'active', _id: { $ne: user._id } };
  const needle = q.trim().slice(0, 60);
  if (needle) {
    const rx = { $regex: escapeRegex(needle), $options: 'i' };
    filter.$or = [{ fullName: rx }, { email: rx }, { studentId: rx }];
  }
  const people = await User.find(filter, { fullName: 1, role: 1, email: 1, studentId: 1, department: 1 }).sort({ fullName: 1 }).limit(20).lean();
  return people.map((p) => ({ id: String(p._id), name: p.fullName, role: p.role, roleLabel: roleName(p.role), email: p.email, studentId: p.studentId ?? null, department: p.department ?? null, purpose: directChatPurpose(user.role as Role, p.role as Role), online: isUserOnline(String(p._id)) }));
}

/** Participants of a conversation the caller can read. Community channels only report a count. */
export async function participantsOf(user: UserDoc, channel: ChatChannelDoc) {
  if (channel.kind === 'community') return { count: await ChatMembership.countDocuments({ channelId: channel._id }), people: [] };
  const members = await ChatMembership.find({ channelId: channel._id }, { userId: 1, role: 1 }).lean();
  const ids = members.map((m) => m.userId);
  if (channel.kind === 'support_thread' && channel.assignedStaffId) ids.push(channel.assignedStaffId);
  const people = await User.find({ _id: { $in: ids } }, { fullName: 1, role: 1, studentId: 1, department: 1 }).lean();
  return {
    count: people.length,
    people: people.map((p) => ({
      id: String(p._id), name: p.fullName, role: roleName(p.role) ?? 'Staff', me: String(p._id) === String(user._id),
      studentId: user.role !== 'student' ? p.studentId ?? null : null, department: p.department ?? null, online: isUserOnline(String(p._id)),
    })),
  };
}

// ------------------------------------------------------------------ official announcements

/** Announcements a reader may see: published, live, and targeted at their role and campus zone. */
export function announcementAudienceFilter(user: UserDoc) {
  const now = new Date();
  return {
    $and: [
      { $or: [{ status: 'published' }, { status: { $exists: false }, published: true }] },
      { $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }] },
      { $or: [{ targetRoles: { $in: ['all', user.role] } }, { targetRoles: { $exists: false } }] },
      { $or: [{ campus: 'all' }, { campus: { $exists: false } }, ...(user.campusZone ? [{ campus: user.campusZone }] : [])] },
    ],
  };
}

/** Lazily applies schedules and expiry so the feed is correct without a separate worker. */
export async function settleAnnouncementSchedule() {
  const now = new Date();
  await Announcement.updateMany({ status: 'published', expiresAt: { $ne: null, $lte: now } }, { $set: { status: 'expired', published: false }, $push: { history: { action: 'expired', changedByName: 'System', changedAt: now } } });
  const due = await Announcement.find({ status: 'scheduled', scheduledAt: { $lte: now } }, { _id: 1 }).limit(20).lean();
  for (const d of due) {
    // Conditional update: only one caller wins, so subscribers are notified exactly once.
    const doc = await Announcement.findOneAndUpdate(
      { _id: d._id, status: 'scheduled' },
      { $set: { status: 'published', published: true }, $push: { history: { action: 'published', changedByName: 'Scheduler', changedAt: now, note: 'Scheduled publish' } } },
      { new: true },
    ).lean();
    if (doc) fanOutAnnouncement(doc as never);
  }
}

/** In-app + push notification to the targeted audience. Runs in the background in batches. */
export function fanOutAnnouncement(a: { _id: unknown; title: string; priority?: string | null; targetRoles?: string[] | null; campus?: string | null; authorId?: unknown }) {
  emitBroadcast('announcements:changed', { id: String(a._id) });
  const roles = a.targetRoles?.length && !a.targetRoles.includes('all') ? a.targetRoles : null;
  const filter: Record<string, unknown> = { accountStatus: 'active', _id: { $ne: a.authorId } };
  if (roles) filter.role = { $in: roles };
  if (a.campus && a.campus !== 'all') filter.campusZone = a.campus;
  void (async () => {
    const cursor = User.find(filter, { _id: 1 }).lean().cursor();
    let batch: string[] = [];
    const flush = async () => {
      const ids = batch;
      batch = [];
      await notifyMany(ids, {
        kind: 'announcement', category: 'announcements', priority: a.priority === 'urgent' ? 'high' : 'normal',
        title: a.priority === 'urgent' ? `Urgent: ${a.title}`.slice(0, 140) : 'New official announcement', body: a.title.slice(0, 200), link: `/student/announcements?id=${a._id}`,
      });
    };
    for await (const u of cursor) {
      batch.push(String(u._id));
      if (batch.length >= 200) await flush();
    }
    if (batch.length) await flush();
  })().catch((err) => logger.warn({ err: (err as Error).message }, 'announcement fan-out failed'));
}

export function serializeAnnouncement(a: Record<string, unknown> & { _id: unknown }, opts: { readIds: Set<string>; manage: boolean }) {
  const x = a as Record<string, any>;
  return {
    id: String(x._id), title: x.title, body: x.body, category: x.category ?? 'general', priority: x.priority ?? 'standard',
    status: x.status ?? (x.published ? 'published' : 'draft'), pinned: Boolean(x.pinned), kind: x.kind ?? 'notice',
    campus: x.campus ?? 'all', targetRoles: x.targetRoles ?? ['all'], scheduledAt: x.scheduledAt ?? null, expiresAt: x.expiresAt ?? null,
    attachments: x.attachments ?? [], authorName: x.authorName ?? 'Administration', authorRole: x.authorRole ?? 'Administrator',
    createdAt: x.createdAt, updatedAt: x.updatedAt, read: opts.readIds.has(String(x._id)),
    ...(opts.manage ? { readCount: x.readCount ?? 0, history: (x.history ?? []).slice(-20) } : {}),
  };
}

// ------------------------------------------------------------------ overview

export async function chatsOverview(user: UserDoc) {
  await settleAnnouncementSchedule();
  const categories = await categoriesFor(user);
  const all = await listConversations(user, { category: 'all' });
  const own = user.role === 'counsellor';
  const aggregate = can(user, 'appointments:read_aggregate');

  let counselling: { activeConversations: number; pendingRequests: number; overdueRequests: number } | null = null;
  if (own || aggregate) {
    const scope = own ? { counsellorId: user._id } : {};
    const memberThreads = own ? (await ChatMembership.find({ userId: user._id, role: 'staff' }, { channelId: 1 }).lean()).map((m) => m.channelId) : null;
    const [activeConversations, pendingRequests, overdueRequests] = await Promise.all([
      ChatChannel.countDocuments({ kind: 'counselling_thread', closed: false, ...(memberThreads ? { _id: { $in: memberThreads } } : {}) }),
      Appointment.countDocuments({ ...scope, status: 'requested' }),
      Appointment.countDocuments({ ...scope, status: 'requested', createdAt: { $lt: new Date(Date.now() - COUNSELLING_RESPONSE_MS) } }),
    ]);
    counselling = { activeConversations, pendingRequests, overdueRequests };
  }

  let support: { unanswered: number; open: number } | null = null;
  if (can(user, 'support:manage') && can(user, 'admin:access')) {
    const [unanswered, open] = await Promise.all([
      SupportTicket.countDocuments({ status: { $in: ['new', 'open', 'reopened'] }, firstResponseAt: null }),
      SupportTicket.countDocuments({ status: { $nin: ['resolved', 'closed'] } }),
    ]);
    support = { unanswered, open };
  }

  let reports: { new: number; open: number; urgent: number; overdue: number } | null = null;
  if (categories.includes('reports')) {
    const scope = reportScopeFilter(user);
    if (scope) {
      const live = { ...scope, status: { $nin: TERMINAL_STATUSES } };
      const [n, open, urgent, overdue] = await Promise.all([
        Incident.countDocuments({ ...scope, status: 'submitted' }),
        Incident.countDocuments(live),
        Incident.countDocuments({ ...live, $or: [{ urgent: true }, { priority: 'urgent' }] }),
        Incident.countDocuments({ ...scope, status: { $nin: [...TERMINAL_STATUSES, 'resolved'] }, dueResolveAt: { $lt: new Date() } }),
      ]);
      reports = { new: n, open, urgent, overdue };
    }
  }

  const announcements = await Announcement.find(announcementAudienceFilter(user)).sort({ pinned: -1, createdAt: -1 }).limit(5).lean();
  const readIds = new Set((await Announcement.find({ _id: { $in: announcements.map((a) => a._id) }, 'readBy.userId': user._id }, { _id: 1 }).lean()).map((a) => String(a._id)));
  const unreadAnnouncements = await Announcement.countDocuments({ ...announcementAudienceFilter(user), 'readBy.userId': { $ne: user._id } });

  const byCategory: Record<string, { total: number; unread: number }> = {};
  for (const i of all) {
    const c = (byCategory[i.category] ??= { total: 0, unread: 0 });
    c.total += 1;
    c.unread += i.unread > 0 || i.markedUnread ? 1 : 0;
  }
  return {
    categories: categoryList(categories),
    conversations: { total: all.length, unreadConversations: all.filter((i) => i.unread > 0 || i.markedUnread).length, unreadMessages: all.reduce((s, i) => s + i.unread, 0), needsResponse: all.filter((i) => i.needsResponse).length, byCategory },
    counselling,
    support,
    reports,
    announcements: { unread: unreadAnnouncements, recent: announcements.map((a) => serializeAnnouncement(a as never, { readIds, manage: false })) },
    needsResponse: all.filter((i) => i.needsResponse).slice(0, 8),
    permissions: {
      publishAnnouncements: can(user, 'announcements:manage'),
      startDirect: (['student', 'counsellor', 'admin', 'super_admin'] as Role[]).some((r) => directChatPurpose(user.role as Role, r)),
      triageReports: can(user, 'incidents:triage'),
    },
  };
}

/** Same scoping rules as GET /incidents, reduced to a count filter. Null = no report access. */
export function reportScopeFilter(user: UserDoc): Record<string, unknown> | null {
  if (can(user, 'incidents:triage') || can(user, 'incidents:read_sensitive')) return {};
  if (can(user, 'incidents:read_committee')) {
    const committees = (user.committeeMemberships ?? []).map((m) => m.committeeId);
    return { $or: [{ assignedTo: user._id }, { committeeId: { $in: committees } }] };
  }
  if (can(user, 'incidents:read_own')) return { $or: [{ reporterId: user._id }, { reporterTag: anonymousReporterTag(String(user._id)) }] };
  return null;
}
