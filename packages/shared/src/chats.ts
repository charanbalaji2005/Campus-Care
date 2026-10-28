import { z } from 'zod';
import { ANNOUNCEMENT_CATEGORIES, ANNOUNCEMENT_PRIORITIES, ROLES, type Role } from './enums';
import { objectId } from './schemas';

/**
 * Unified Chats center. Categories are navigation only: every list and every message read is
 * still authorised by the API that owns the data (chat channels, cases, tickets, announcements).
 */
export const CHAT_CATEGORIES = [
  'all',
  'announcements',
  'counselling',
  'student_counsellor',
  'student_admin',
  'admin_super_admin',
  'counsellor_admin',
  'support',
  'security',
  'community',
  'reports',
  'archived',
  'unread',
] as const;
export type ChatCategory = (typeof CHAT_CATEGORIES)[number];

export const CHAT_CATEGORY_LABELS: Record<ChatCategory, string> = {
  all: 'All Chats',
  announcements: 'Official Announcements',
  counselling: 'Counselling',
  student_counsellor: 'Student–Counsellor Chats',
  student_admin: 'Student–Admin Chats',
  admin_super_admin: 'Admin–Super Admin Chats',
  counsellor_admin: 'Counsellor–Admin Chats',
  support: 'Support Chats',
  security: 'Security & SOS',
  community: 'Community Channels',
  reports: 'Reports',
  archived: 'Archived',
  unread: 'Unread',
};

/** Why a one-to-one `direct` conversation exists. Each one has exactly two explicit members. */
export const DIRECT_CHAT_PURPOSES = ['student_admin', 'admin_super_admin', 'counsellor_admin'] as const;
export type DirectChatPurpose = (typeof DIRECT_CHAT_PURPOSES)[number];

const isAdmin = (r: Role) => r === 'admin' || r === 'super_admin';

/**
 * The purpose under which `initiator` may open a direct conversation with `other`, or null when
 * that pairing is not allowed. Students never start these (they use support services and
 * counselling); staff reach out to them.
 */
export function directChatPurpose(initiator: Role, other: Role): DirectChatPurpose | null {
  if (isAdmin(initiator) && isAdmin(other)) return initiator === 'super_admin' || other === 'super_admin' ? 'admin_super_admin' : null;
  if (isAdmin(initiator) && other === 'counsellor') return 'counsellor_admin';
  if (initiator === 'counsellor' && isAdmin(other)) return 'counsellor_admin';
  if (isAdmin(initiator) && other === 'student') return 'student_admin';
  return null;
}

export const CHAT_ITEM_TYPES = ['channel', 'case', 'ticket', 'announcement'] as const;
export type ChatItemType = (typeof CHAT_ITEM_TYPES)[number];

export const chatPreferenceSchema = z
  .object({
    itemType: z.enum(CHAT_ITEM_TYPES),
    itemId: objectId,
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
    muted: z.boolean().optional(),
    markedUnread: z.boolean().optional(),
  })
  .refine((v) => v.pinned !== undefined || v.archived !== undefined || v.muted !== undefined || v.markedUnread !== undefined, 'Nothing to change.');

export const chatItemRefSchema = z.object({ itemType: z.enum(CHAT_ITEM_TYPES), itemId: objectId });
export const directChatOpenSchema = z.object({ userId: objectId });

export const ANNOUNCEMENT_AUDIENCES = ['all', ...ROLES] as const;

const announcementFields = {
  title: z.string().trim().min(3).max(140),
  body: z.string().trim().min(3).max(5000),
  category: z.enum(ANNOUNCEMENT_CATEGORIES).default('general'),
  priority: z.enum(ANNOUNCEMENT_PRIORITIES).default('standard'),
  campus: z.string().trim().min(1).max(60).default('all'),
  targetRoles: z.array(z.enum(ANNOUNCEMENT_AUDIENCES)).min(1).max(ANNOUNCEMENT_AUDIENCES.length).default(['all']),
  pinned: z.boolean().default(false),
  scheduledAt: z.coerce.date().nullish(),
  expiresAt: z.coerce.date().nullish(),
};

/** Publishing an official announcement. `scheduled` needs a future `scheduledAt`. */
export const announcementPublishSchema = z
  .object({ ...announcementFields, status: z.enum(['draft', 'published', 'scheduled']).default('published') })
  .refine((v) => v.status !== 'scheduled' || (v.scheduledAt && v.scheduledAt.getTime() > Date.now()), { message: 'Choose a future time to schedule.', path: ['scheduledAt'] })
  .refine((v) => !v.expiresAt || v.expiresAt.getTime() > (v.scheduledAt?.getTime() ?? Date.now()), { message: 'Expiry must be after publishing.', path: ['expiresAt'] });

export const announcementUpdateSchema = z
  .object({
    title: announcementFields.title.optional(),
    body: announcementFields.body.optional(),
    category: z.enum(ANNOUNCEMENT_CATEGORIES).optional(),
    priority: z.enum(ANNOUNCEMENT_PRIORITIES).optional(),
    campus: z.string().trim().min(1).max(60).optional(),
    targetRoles: z.array(z.enum(ANNOUNCEMENT_AUDIENCES)).min(1).max(ANNOUNCEMENT_AUDIENCES.length).optional(),
    pinned: z.boolean().optional(),
    scheduledAt: z.coerce.date().nullish(),
    expiresAt: z.coerce.date().nullish(),
    status: z.enum(['draft', 'published', 'scheduled', 'archived']).optional(),
    note: z.string().trim().max(300).optional(),
  })
  .refine((v) => v.status !== 'scheduled' || (v.scheduledAt && v.scheduledAt.getTime() > Date.now()), { message: 'Choose a future time to schedule.', path: ['scheduledAt'] });
