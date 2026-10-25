import crypto from 'node:crypto';
import { Types } from 'mongoose';
import {
  COUNSELLING_CHANNEL_DESCRIPTION, COUNSELLING_CHANNEL_NAME, COUNSELLING_CHANNEL_SLUG, COUNSELLING_TOPIC_LABELS, FEED_LIMITS, ROLE_LABELS,
  URGENT_REPORT_REASONS, hasPermission, type CounsellingTopic, type Permission, type Role,
} from '@campuscare/shared';
import { AppError, notFound } from '../lib/http';
import { ChannelFollow, ChannelPublisher, CommunityEvent, EventRsvp, FeedBookmark, FeedComment, FeedPost, FeedReaction, OfficialChannel, type FeedPostDoc } from '../models/feed';
import { ChatBlock } from '../models/chat';
import { Evidence } from '../models/incident';
import { User, type UserDoc } from '../models/user';
import { attachmentView } from './files.service';
import { notify, notifyMany } from './notification.service';
import { registerPeriodic } from './jobs.service';
import { logger } from '../lib/logger';

type Viewer = UserDoc;
type LeanPost = Record<string, unknown> & {
  _id: Types.ObjectId; authorId: Types.ObjectId; authorLabel: string; authorRole: string; channelId: Types.ObjectId | null; official: boolean;
  category: string; topic: string | null; body: string; tags: string[]; attachmentIds: Types.ObjectId[]; resourceLinks: { title: string; url: string }[];
  locationLabel: string | null; status: string; holdFlags: string[]; commentsEnabled: boolean; pinned: boolean; scheduledAt: Date | null; publishedAt: Date | null;
  editedAt: Date | null; createdAt: Date; reactionCount: number; commentCount: number; bookmarkCount: number; viewCount: number; openReportCount: number;
  moderation?: { action?: string | null; reason?: string | null; by?: Types.ObjectId | null; at?: Date | null };
};

export const can = (u: Viewer, p: Permission) => hasPermission({ role: u.role as Role, permissions: u.permissions ?? [] }, p);
export const isModerator = (u: Viewer) => can(u, 'community:moderate');
export const sameId = (a: unknown, b: unknown) => a != null && b != null && String(a) === String(b);

/** Name shown on community content. Students who hide their name appear as "Student". */
export function authorLabelFor(user: Viewer): string {
  if (user.role === 'student') return user.privacy?.showNameInCommunity === false ? 'Student' : user.fullName;
  return user.fullName;
}

export function contentHashOf(body: string) {
  return crypto.createHash('sha256').update(body.toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex');
}

export async function blockedIdsFor(userId: unknown): Promise<Types.ObjectId[]> {
  const rows = await ChatBlock.find({ userId }, { blockedUserId: 1 }).lean();
  return rows.map((r) => r.blockedUserId as Types.ObjectId);
}

export async function hasBlocked(userId: unknown, otherId: unknown) {
  return Boolean(await ChatBlock.exists({ userId, blockedUserId: otherId }));
}

// ------------------------------------------------------------------ official channel

let channelCache: { id: Types.ObjectId; at: number } | null = null;

/** The Official Counselling Support channel, created on first use. */
export async function ensureCounsellingChannel() {
  if (channelCache && Date.now() - channelCache.at < 60_000) {
    const cached = await OfficialChannel.findById(channelCache.id).lean();
    if (cached) return cached;
  }
  const ch = await OfficialChannel.findOneAndUpdate(
    { slug: COUNSELLING_CHANNEL_SLUG },
    { $setOnInsert: { slug: COUNSELLING_CHANNEL_SLUG, name: COUNSELLING_CHANNEL_NAME, description: COUNSELLING_CHANNEL_DESCRIPTION, commentsEnabled: true, active: true } },
    { upsert: true, new: true },
  ).lean();
  channelCache = { id: ch!._id, at: Date.now() };
  return ch!;
}

/** Test hook: channels are dropped between suites. */
export function resetChannelCache() {
  channelCache = null;
}

/**
 * Publishing in an official channel needs ALL of: an active account, the counsellor role (set by an
 * administrator, never self-selected) and an unrevoked publisher verification from a Super Admin.
 */
export async function isActivePublisher(user: Viewer, channelId: unknown): Promise<boolean> {
  if (user.role !== 'counsellor' || user.accountStatus !== 'active') return false;
  return Boolean(await ChannelPublisher.exists({ channelId, userId: user._id, revokedAt: null }));
}

/** Authors among [ids] who are verified, active publishers of any official channel (for the badge). */
async function verifiedPublisherIds(ids: unknown[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await ChannelPublisher.find({ userId: { $in: ids }, revokedAt: null }, { userId: 1 }).lean();
  if (!rows.length) return new Set();
  const active = await User.find({ _id: { $in: rows.map((r) => r.userId) }, role: 'counsellor', accountStatus: 'active' }, { _id: 1 }).lean();
  return new Set(active.map((u) => String(u._id)));
}

export function authorView(p: { authorLabel: string; authorRole: string; official: boolean }, verified: boolean) {
  const role = p.authorRole as Role;
  const badge = p.official ? (verified ? 'counsellor' : 'official') : role === 'student' ? null : verified ? 'counsellor' : 'staff';
  return {
    name: p.authorLabel,
    roleLabel: role === 'student' ? 'Student' : verified ? 'Verified counsellor' : ROLE_LABELS[role] ?? 'Staff',
    badge,
    verified: verified || (p.official && role !== 'student'),
  };
}

// ------------------------------------------------------------------ visibility

/** Can [viewer] see this post at all? (Lists apply the same rules as query filters.) */
export function canViewPost(viewer: Viewer, p: { authorId: unknown; status: string }) {
  const mine = sameId(p.authorId, viewer._id);
  if (p.status === 'deleted') return false;
  if (p.status === 'published') return true;
  if (mine) return true;
  // Moderators review held/hidden/removed content, but never someone else's drafts or scheduled posts.
  return isModerator(viewer) && ['pending_review', 'hidden', 'removed'].includes(p.status);
}

export async function loadPostFor(viewer: Viewer, id: string) {
  if (!Types.ObjectId.isValid(id)) throw notFound();
  const post = await FeedPost.findById(id);
  if (!post || !canViewPost(viewer, post)) throw notFound();
  return post;
}

// ------------------------------------------------------------------ serialisation

export async function serializePosts(viewer: Viewer, posts: LeanPost[], opts: { publisherOf?: Set<string> } = {}) {
  if (!posts.length) return [];
  const ids = posts.map((p) => p._id);
  const [reactions, bookmarks, files, verified, channels] = await Promise.all([
    FeedReaction.find({ userId: viewer._id, postId: { $in: ids } }, { postId: 1, kind: 1 }).lean(),
    FeedBookmark.find({ userId: viewer._id, postId: { $in: ids } }, { postId: 1 }).lean(),
    Evidence.find({ _id: { $in: posts.flatMap((p) => p.attachmentIds ?? []) } }, { originalName: 1, mimeType: 1, sizeBytes: 1 }).lean(),
    verifiedPublisherIds([...new Set(posts.map((p) => String(p.authorId)))]),
    OfficialChannel.find({ _id: { $in: posts.map((p) => p.channelId).filter(Boolean) } }, { slug: 1, name: 1 }).lean(),
  ]);
  const myReaction = new Map(reactions.map((r) => [String(r.postId), r.kind]));
  const marked = new Set(bookmarks.map((b) => String(b.postId)));
  const fileMap = new Map(files.map((f) => [String(f._id), attachmentView(f)]));
  const channelMap = new Map(channels.map((c) => [String(c._id), c]));
  const moderator = isModerator(viewer);
  return posts.map((p) => {
    const mine = sameId(p.authorId, viewer._id);
    const channel = p.channelId ? channelMap.get(String(p.channelId)) : null;
    const publisher = Boolean(channel && opts.publisherOf?.has(String(channel._id)));
    const showMetrics = mine || moderator;
    const isHeld = ['pending_review', 'hidden', 'removed'].includes(p.status);
    return {
      id: String(p._id),
      body: p.body,
      category: p.category,
      topic: p.topic,
      topicLabel: p.topic ? COUNSELLING_TOPIC_LABELS[p.topic as CounsellingTopic] : null,
      tags: p.tags ?? [],
      attachments: (p.attachmentIds ?? []).map((a) => fileMap.get(String(a))).filter(Boolean),
      resourceLinks: (p.resourceLinks ?? []).map((l) => ({ title: l.title, url: l.url })),
      locationLabel: p.locationLabel,
      official: p.official,
      channel: channel ? { slug: channel.slug, name: channel.name } : null,
      author: authorView(p, verified.has(String(p.authorId))),
      status: p.status,
      pinned: p.pinned,
      commentsEnabled: p.commentsEnabled,
      reactionCount: p.reactionCount,
      commentCount: p.commentCount,
      myReaction: myReaction.get(String(p._id)) ?? null,
      bookmarked: marked.has(String(p._id)),
      // Engagement numbers only — never who viewed or reacted.
      viewCount: showMetrics ? p.viewCount : null,
      bookmarkCount: showMetrics ? p.bookmarkCount : null,
      mine,
      canEdit: mine && !['removed', 'deleted'].includes(p.status) && (!p.channelId || publisher),
      canDelete: mine && p.status !== 'deleted',
      canPin: p.channelId ? publisher && p.status === 'published' : p.official && can(viewer, 'announcements:manage') && p.status === 'published',
      canModerate: moderator && !mine,
      canAppeal: mine && (p.status === 'hidden' || p.status === 'removed'),
      // The author learns why their post is held or was hidden; nobody else sees moderation detail.
      moderationNote: mine && isHeld ? moderationNoteFor(p) : null,
      holdFlags: moderator ? p.holdFlags : undefined,
      openReports: moderator ? p.openReportCount : undefined,
      scheduledAt: mine ? p.scheduledAt : null,
      publishedAt: p.publishedAt,
      editedAt: p.editedAt,
      createdAt: p.createdAt,
    };
  });
}

function moderationNoteFor(p: LeanPost): string {
  if (p.status === 'pending_review') {
    return p.holdFlags?.includes('reported')
      ? 'This post is hidden while moderators review reports about it.'
      : 'Submitted for review. A moderator will check it before it appears in the feed.';
  }
  const reason = p.moderation?.reason ? ` Reason: ${p.moderation.reason}` : '';
  return p.status === 'removed' ? `Removed by a moderator.${reason}` : `Hidden by a moderator.${reason}`;
}

type LeanComment = Record<string, unknown> & {
  _id: Types.ObjectId; postId: Types.ObjectId; parentId: Types.ObjectId | null; authorId: Types.ObjectId; authorLabel: string; authorRole: string;
  body: string; status: string; editedAt: Date | null; createdAt: Date; openReportCount: number; holdFlags: string[];
};

export async function serializeComments(viewer: Viewer, comments: LeanComment[], post: { authorId: unknown; official: boolean }) {
  const verified = await verifiedPublisherIds([...new Set(comments.map((c) => String(c.authorId)))]);
  const moderator = isModerator(viewer);
  return comments.map((c) => {
    const mine = sameId(c.authorId, viewer._id);
    return {
      id: String(c._id),
      parentId: c.parentId ? String(c.parentId) : null,
      body: c.body,
      author: authorView({ authorLabel: c.authorLabel, authorRole: c.authorRole, official: false }, verified.has(String(c.authorId))),
      isPostAuthor: sameId(c.authorId, post.authorId),
      status: c.status,
      mine,
      canEdit: mine && ['published', 'pending_review'].includes(c.status),
      canDelete: mine,
      canModerate: moderator && !mine,
      moderationNote: mine && c.status === 'pending_review' ? 'Submitted for review. Others will see it once a moderator approves it.' : null,
      editedAt: c.editedAt,
      createdAt: c.createdAt,
    };
  });
}

// ------------------------------------------------------------------ counters and moderation helpers

/** Counts are recomputed from source rows after state changes so they never drift. */
export async function recountComments(postId: unknown) {
  const n = await FeedComment.countDocuments({ postId, status: 'published' });
  await FeedPost.updateOne({ _id: postId }, { $set: { commentCount: n } });
  return n;
}

export async function moderatorIds(): Promise<string[]> {
  const rows = await User.find(
    { accountStatus: 'active', $or: [{ role: { $in: ['moderator', 'admin'] } }, { permissions: 'community:moderate' }] },
    { _id: 1 },
  ).lean();
  return rows.map((r) => String(r._id));
}

/**
 * After a report: content with enough distinct open reports (or one urgent report from two people)
 * is hidden pending review, and moderators are told once.
 */
export async function applyReportThreshold(kind: 'post' | 'comment', id: Types.ObjectId, openReports: number, reason: string) {
  const urgent = (URGENT_REPORT_REASONS as string[]).includes(reason);
  const threshold = urgent ? Math.min(2, FEED_LIMITS.reportsToAutoHide) : FEED_LIMITS.reportsToAutoHide;
  const Model = (kind === 'post' ? FeedPost : FeedComment) as unknown as typeof FeedPost;
  let held = false;
  if (openReports >= threshold) {
    const r = await Model.updateOne({ _id: id, status: 'published' }, { $set: { status: 'pending_review', 'moderation.action': 'auto_hold', 'moderation.at': new Date() }, $addToSet: { holdFlags: 'reported' } });
    held = r.modifiedCount > 0;
    if (held && kind === 'comment') {
      const c = await FeedComment.findById(id, { postId: 1 }).lean();
      if (c) await recountComments(c.postId);
    }
  }
  if (urgent || held) {
    await notifyMany(await moderatorIds(), {
      kind: 'community_report', priority: urgent ? 'high' : 'normal',
      title: urgent ? 'Urgent community report' : 'Community content held for review',
      body: urgent ? 'A post or comment was reported as urgent. Please review it.' : 'Reported content was hidden automatically and needs a decision.',
      link: '/moderator/community',
    });
  }
  return held;
}

// ------------------------------------------------------------------ notifications

const MILESTONES = new Set([1, 5, 10, 25, 50, 100, 250]);

export async function notifyReactionMilestone(post: FeedPostDoc | LeanPost, count: number, reactorId: unknown) {
  if (!MILESTONES.has(count) || sameId(post.authorId, reactorId)) return;
  await notify({
    userId: String(post.authorId), kind: 'community_reaction', category: 'community', priority: 'low',
    title: count === 1 ? 'Someone reacted to your post' : `${count} people reacted to your post`,
    body: 'Open CampusCare to see your post.', link: `/student/community/posts/${post._id}`,
  });
}

export async function notifyFollowers(channel: { _id: unknown; name: string }, post: { _id: unknown; authorId: unknown; topic?: string | null }) {
  const followers = await ChannelFollow.find({ channelId: channel._id, userId: { $ne: post.authorId } }, { userId: 1 }).lean();
  if (!followers.length) return;
  const topic = post.topic ? COUNSELLING_TOPIC_LABELS[post.topic as CounsellingTopic] : null;
  await notifyMany(followers.map((f) => String(f.userId)), {
    kind: 'channel_post', category: 'announcements',
    title: `New from ${channel.name}`,
    body: topic ? `A new ${topic.toLowerCase()} post is available.` : 'A new post is available.',
    link: `/student/community/posts/${post._id}`,
  });
}

/** Scheduled channel posts go live at their time (also run lazily when feeds are read). */
export async function promoteScheduledPosts() {
  const due = await FeedPost.find({ status: 'scheduled', scheduledAt: { $lte: new Date() } }, { _id: 1 }).limit(25).lean();
  for (const d of due) {
    const post = await FeedPost.findOneAndUpdate({ _id: d._id, status: 'scheduled' }, [{ $set: { status: 'published', publishedAt: '$scheduledAt' } }], { new: true });
    if (!post) continue; // another instance got it
    if (post.channelId) {
      const channel = await OfficialChannel.findById(post.channelId).lean();
      if (channel) await notifyFollowers(channel, post).catch((err) => logger.warn({ err: (err as Error).message }, 'channel notify failed'));
    }
  }
}

registerPeriodic('feed-scheduled-posts', 60_000, promoteScheduledPosts);

/** Reminder ~24 h before an event to people who said they are going or interested. */
registerPeriodic('community-event-reminders', 5 * 60_000, async () => {
  const soon = await CommunityEvent.find({ status: 'published', reminderSentAt: null, startsAt: { $gt: new Date(), $lte: new Date(Date.now() + 24 * 3600_000) } }).limit(20);
  for (const e of soon) {
    const claimed = await CommunityEvent.updateOne({ _id: e._id, reminderSentAt: null }, { $set: { reminderSentAt: new Date() } });
    if (!claimed.modifiedCount) continue;
    const rsvps = await EventRsvp.find({ eventId: e._id }, { userId: 1 }).lean();
    await notifyMany(rsvps.map((r) => String(r.userId)), {
      kind: 'event_reminder', category: 'community', title: `Reminder: ${e.title}`,
      body: `Starts ${e.startsAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })} at ${e.venue}.`,
      link: `/student/community/events/${e._id}`,
    });
  }
});

// ------------------------------------------------------------------ feed cursor

export function encodeCursor(p: { publishedAt?: Date | null; createdAt: Date; _id: unknown }) {
  return Buffer.from(JSON.stringify([(p.publishedAt ?? p.createdAt).toISOString(), String(p._id)])).toString('base64url');
}

export function cursorFilter(cursor: unknown): Record<string, unknown> {
  if (typeof cursor !== 'string' || !cursor) return {};
  try {
    const [at, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as [string, string];
    const t = new Date(at);
    if (Number.isNaN(t.getTime()) || !Types.ObjectId.isValid(id)) return {};
    return { $or: [{ publishedAt: { $lt: t } }, { publishedAt: t, _id: { $lt: new Types.ObjectId(id) } }] };
  } catch {
    throw new AppError(400, 'bad_cursor', 'Invalid page cursor.');
  }
}
