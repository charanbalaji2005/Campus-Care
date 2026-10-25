import { Router, type Request } from 'express';
import { Types } from 'mongoose';
import { COUNSELLING_TOPICS, COUNSELLING_TOPIC_LABELS, FEED_LIMITS, channelPostCreateSchema, channelPostUpdateSchema, channelPublisherSchema, normaliseTag, screenCommunityText } from '@campuscare/shared';
import { AppError, asyncHandler, notFound, ok, parse } from '../lib/http';
import { ChannelFollow, ChannelPublisher, FeedComment, FeedPost, FeedReaction } from '../models/feed';
import { Availability } from '../models/counselling';
import { User } from '../models/user';
import { requireAuth, requirePermission } from '../middleware/auth';
import { bindUploads } from '../services/files.service';
import { audit } from '../services/audit.service';
import { notify } from '../services/notification.service';
import { counsellorPresence } from '../services/counsellor-availability';
import {
  contentHashOf, cursorFilter, encodeCursor, ensureCounsellingChannel, isActivePublisher, notifyFollowers, promoteScheduledPosts, sameId, serializePosts,
} from '../services/feed.service';

/**
 * Official Counselling Support channel: GET /community/channels/counselling[/posts|/dashboard|/publishers].
 * Only verified counsellors (role + Super Admin verification) publish; everyone reads, reacts and comments.
 * Private counselling conversations are a separate system and are never published here.
 */
export const channelRouter = Router();
channelRouter.use(requireAuth);

const EMERGENCY_NOTICE = 'This channel is not an emergency service and counsellors may not reply straight away. If you or someone else is in immediate danger, use SOS or call 112.';

async function publisherList() {
  const channel = await ensureCounsellingChannel();
  const pubs = await ChannelPublisher.find({ channelId: channel._id, revokedAt: null }, { userId: 1 }).lean();
  const users = await User.find({ _id: { $in: pubs.map((p) => p.userId) }, role: 'counsellor', accountStatus: 'active' }, { fullName: 1 }).lean();
  const avail = await Availability.find({ counsellorId: { $in: users.map((u) => u._id) } }).lean();
  const amap = new Map(avail.map((a) => [String(a.counsellorId), a]));
  return users.map((u) => {
    const a = amap.get(String(u._id));
    const presence = counsellorPresence(a as never);
    return { counsellorId: String(u._id), name: u.fullName, title: a?.title ?? 'Counsellor', availability: presence.status, nextAvailableAt: presence.nextAvailableAt };
  });
}

channelRouter.get(
  '/counselling',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const channel = await ensureCounsellingChannel();
    const [following, followers, canPublish, publishers] = await Promise.all([
      ChannelFollow.exists({ channelId: channel._id, userId: user._id }),
      ChannelFollow.countDocuments({ channelId: channel._id }),
      isActivePublisher(user, channel._id),
      publisherList(),
    ]);
    ok(res, {
      id: String(channel._id), slug: channel.slug, name: channel.name, description: channel.description, verified: true,
      commentsEnabled: channel.commentsEnabled, following: Boolean(following), followers, canPublish,
      topics: COUNSELLING_TOPICS.map((t) => ({ key: t, label: COUNSELLING_TOPIC_LABELS[t] })),
      counsellors: publishers,
      emergencyNotice: EMERGENCY_NOTICE,
    });
  }),
);

channelRouter.post(
  '/counselling/follow',
  asyncHandler(async (req, res) => {
    const channel = await ensureCounsellingChannel();
    const follow = req.body?.following !== false;
    if (follow) await ChannelFollow.updateOne({ channelId: channel._id, userId: req.user!._id }, { $setOnInsert: { channelId: channel._id, userId: req.user!._id } }, { upsert: true });
    else await ChannelFollow.deleteOne({ channelId: channel._id, userId: req.user!._id });
    ok(res, { following: follow });
  }),
);

channelRouter.get(
  '/counselling/posts',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const channel = await ensureCounsellingChannel();
    void promoteScheduledPosts().catch(() => undefined);
    const limit = Math.min(30, Math.max(1, Number(req.query.limit) || 15));
    const base: Record<string, unknown> = { channelId: channel._id, status: 'published' };
    if (typeof req.query.topic === 'string' && (COUNSELLING_TOPICS as readonly string[]).includes(req.query.topic)) base.topic = req.query.topic;
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
    if (q.startsWith('#') && normaliseTag(q)) base.tags = normaliseTag(q);
    else if (q) base.$text = { $search: q };
    const first = !req.query.cursor;
    const pinned = first && !q ? await FeedPost.find({ ...base, pinned: true }).sort({ publishedAt: -1 }).limit(FEED_LIMITS.maxPinnedPerChannel).lean() : [];
    const filter = { ...base, ...cursorFilter(req.query.cursor), ...(pinned.length ? { _id: { $nin: pinned.map((p) => p._id) } } : {}) };
    const docs = await FeedPost.find(filter).sort({ publishedAt: -1, _id: -1 }).limit(limit + 1).lean();
    const hasMore = docs.length > limit;
    const page = docs.slice(0, limit);
    const publisherOf = (await isActivePublisher(user, channel._id)) ? new Set([String(channel._id)]) : new Set<string>();
    ok(res, {
      items: await serializePosts(user, page as never, { publisherOf }),
      pinned: await serializePosts(user, pinned as never, { publisherOf }),
      nextCursor: hasMore ? encodeCursor(page[page.length - 1]!) : null,
    });
  }),
);

async function requirePublisher(req: Request) {
  const channel = await ensureCounsellingChannel();
  if (!(await isActivePublisher(req.user!, channel._id))) {
    await audit({ action: 'counselling_channel.publish_denied', req, outcome: 'denied' });
    throw new AppError(403, 'not_publisher', 'Only verified counsellors can publish as Official Counselling Support.');
  }
  return channel;
}

async function assertPinRoom(channelId: unknown, exceptId?: unknown) {
  const pinned = await FeedPost.countDocuments({ channelId, pinned: true, status: { $in: ['published', 'scheduled'] }, ...(exceptId ? { _id: { $ne: exceptId } } : {}) });
  if (pinned >= FEED_LIMITS.maxPinnedPerChannel) throw new AppError(409, 'too_many_pinned', `Up to ${FEED_LIMITS.maxPinnedPerChannel} posts can be pinned. Unpin one first.`);
}

channelRouter.post(
  '/counselling/posts',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const channel = await requirePublisher(req);
    const input = parse(channelPostCreateSchema, req.body);
    const existing = await FeedPost.findOne({ authorId: user._id, clientId: input.clientId }).lean();
    if (existing) return ok(res, { post: (await serializePosts(user, [existing as never], { publisherOf: new Set([String(channel._id)]) }))[0], duplicate: true });
    if (input.status === 'scheduled') {
      if (!input.scheduledAt || input.scheduledAt.getTime() < Date.now() + 60_000) throw new AppError(422, 'validation_failed', 'Choose a time at least a minute from now.', { fields: { scheduledAt: 'Choose a future time' } });
      if (input.scheduledAt.getTime() > Date.now() + 90 * 86400_000) throw new AppError(422, 'validation_failed', 'Posts can be scheduled up to 90 days ahead.', { fields: { scheduledAt: 'Too far ahead' } });
    }
    if (input.pinned && input.status !== 'draft') await assertPinRoom(channel._id);
    const screen = screenCommunityText(input.body, { trusted: true });
    if (screen.flags.includes('credentials')) throw new AppError(422, 'credentials', 'Remove passwords, PINs or codes from the post before publishing.');
    const recent = await FeedPost.countDocuments({ authorId: user._id, createdAt: { $gt: new Date(Date.now() - 15 * 60_000) } });
    if (recent >= FEED_LIMITS.postsPer15Minutes * 4) throw new AppError(429, 'rate_limited', 'You are posting very often. Please wait a few minutes.');
    const files = await bindUploads(input.attachmentIds, { purpose: 'feed', uploaderId: String(user._id) });
    const post = await FeedPost.create({
      authorId: user._id, authorLabel: user.fullName, authorRole: user.role, channelId: channel._id, official: true,
      category: 'wellbeing', topic: input.topic, body: input.body, tags: input.tags, attachmentIds: files.map((f) => f._id), resourceLinks: input.resourceLinks,
      status: input.status, scheduledAt: input.status === 'scheduled' ? input.scheduledAt : null, publishedAt: input.status === 'published' ? new Date() : null,
      commentsEnabled: input.commentsEnabled, pinned: input.pinned, contentHash: contentHashOf(input.body), clientId: input.clientId,
    });
    // Who published what, and when — for accountability of official communications.
    await audit({ action: `counselling_channel.post_${input.status === 'published' ? 'published' : input.status === 'scheduled' ? 'scheduled' : 'drafted'}`, req, targetType: 'feed_post', targetId: String(post._id), meta: { topic: input.topic, scheduledAt: post.scheduledAt } });
    if (input.status === 'published') await notifyFollowers(channel, post);
    ok(res, { post: (await serializePosts(user, [post.toObject() as never], { publisherOf: new Set([String(channel._id)]) }))[0], duplicate: false }, 201);
  }),
);

async function loadOwnChannelPost(req: Request, channelId: unknown) {
  if (!Types.ObjectId.isValid(req.params.postId)) throw notFound();
  const post = await FeedPost.findOne({ _id: req.params.postId, channelId });
  if (!post || post.status === 'deleted') throw notFound();
  return post;
}

channelRouter.patch(
  '/counselling/posts/:postId',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const channel = await requirePublisher(req);
    const input = parse(channelPostUpdateSchema, req.body);
    const post = await loadOwnChannelPost(req, channel._id);
    const mine = sameId(post.authorId, user._id);
    const onlyPin = Object.keys(input).every((k) => k === 'pinned');
    // Another counsellor's drafts and scheduled posts stay private to their author.
    if (!mine && post.status !== 'published' && !['hidden', 'removed'].includes(post.status)) throw notFound();
    // Any verified publisher may pin/unpin published posts; content changes are limited to the author's own posts.
    if (!mine && !onlyPin) throw new AppError(403, 'forbidden', 'You can only edit your own posts.');
    if (['hidden', 'removed'].includes(post.status)) throw new AppError(409, 'moderated', 'This post was moderated and cannot be changed or pinned.');
    const wasPublished = post.status === 'published';
    if (input.pinned === true && !post.pinned) await assertPinRoom(channel._id, post._id);
    if (input.pinned !== undefined) post.pinned = input.pinned;
    if (input.body !== undefined) {
      if (screenCommunityText(input.body, { trusted: true }).flags.includes('credentials')) throw new AppError(422, 'credentials', 'Remove passwords, PINs or codes from the post.');
      post.body = input.body;
      post.contentHash = contentHashOf(input.body);
    }
    if (input.topic) post.topic = input.topic;
    if (input.tags) post.tags = input.tags;
    if (input.resourceLinks) post.resourceLinks = input.resourceLinks as never;
    if (input.commentsEnabled !== undefined) post.commentsEnabled = input.commentsEnabled;
    if (input.status && input.status !== post.status) {
      if (wasPublished && input.status !== 'published') throw new AppError(409, 'already_published', 'Published posts cannot go back to draft. Delete it instead.');
      if (input.status === 'scheduled') {
        const at = input.scheduledAt ?? post.scheduledAt;
        if (!at || at.getTime() < Date.now() + 60_000) throw new AppError(422, 'validation_failed', 'Choose a future time.', { fields: { scheduledAt: 'Choose a future time' } });
        post.scheduledAt = at;
      }
      post.status = input.status;
      if (input.status === 'published') { post.publishedAt = new Date(); post.scheduledAt = null; }
    } else if (input.scheduledAt && post.status === 'scheduled') {
      post.scheduledAt = input.scheduledAt;
    }
    if (!onlyPin && wasPublished) post.editedAt = new Date();
    await post.save();
    const becamePublished = !wasPublished && post.status === 'published';
    await audit({ action: onlyPin ? `counselling_channel.post_${input.pinned ? 'pinned' : 'unpinned'}` : becamePublished ? 'counselling_channel.post_published' : 'counselling_channel.post_edited', req, targetType: 'feed_post', targetId: String(post._id) });
    if (becamePublished) await notifyFollowers(channel, post);
    ok(res, (await serializePosts(user, [post.toObject() as never], { publisherOf: new Set([String(channel._id)]) }))[0]);
  }),
);

channelRouter.delete(
  '/counselling/posts/:postId',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const channel = await requirePublisher(req);
    const post = await loadOwnChannelPost(req, channel._id);
    if (!sameId(post.authorId, user._id)) throw new AppError(403, 'forbidden', 'You can only delete your own posts.');
    post.status = 'deleted';
    post.deletedAt = new Date();
    post.pinned = false;
    await post.save();
    await audit({ action: 'counselling_channel.post_deleted', req, targetType: 'feed_post', targetId: String(post._id) });
    ok(res, { ok: true });
  }),
);

/**
 * Counsellor dashboard: own drafts, scheduled and published posts with engagement counts. Counts
 * only — never who reacted, viewed or bookmarked.
 */
channelRouter.get(
  '/counselling/dashboard',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const channel = await requirePublisher(req);
    const posts = await FeedPost.find({ channelId: channel._id, authorId: user._id, status: { $ne: 'deleted' } }).sort({ createdAt: -1 }).limit(100).lean();
    const ids = posts.map((p) => p._id);
    const since = new Date(Date.now() - 7 * 86400_000);
    const [recentComments, reactionsWeek] = await Promise.all([
      FeedComment.countDocuments({ postId: { $in: ids }, status: 'published', authorId: { $ne: user._id }, createdAt: { $gt: since } }),
      FeedReaction.countDocuments({ postId: { $in: ids }, createdAt: { $gt: since } }),
    ]);
    const published = posts.filter((p) => p.status === 'published');
    ok(res, {
      posts: await serializePosts(user, posts as never, { publisherOf: new Set([String(channel._id)]) }),
      totals: {
        published: published.length,
        drafts: posts.filter((p) => p.status === 'draft').length,
        scheduled: posts.filter((p) => p.status === 'scheduled').length,
        reactions: published.reduce((n, p) => n + p.reactionCount, 0),
        comments: published.reduce((n, p) => n + p.commentCount, 0),
        views: published.reduce((n, p) => n + p.viewCount, 0),
        bookmarks: published.reduce((n, p) => n + p.bookmarkCount, 0),
        commentsLast7Days: recentComments,
        reactionsLast7Days: reactionsWeek,
      },
      followers: await ChannelFollow.countDocuments({ channelId: channel._id }),
    });
  }),
);

// ------------------------------------------------------------------ publisher verification (Super Admin)

channelRouter.get(
  '/counselling/publishers',
  requirePermission('community_channels:manage'),
  asyncHandler(async (_req, res) => {
    const channel = await ensureCounsellingChannel();
    const counsellors = await User.find({ role: 'counsellor' }, { fullName: 1, email: 1, accountStatus: 1 }).sort({ fullName: 1 }).lean();
    const pubs = await ChannelPublisher.find({ channelId: channel._id }).lean();
    const pmap = new Map(pubs.map((p) => [String(p.userId), p]));
    const verifiers = await User.find({ _id: { $in: pubs.flatMap((p) => [p.verifiedBy, p.revokedBy].filter(Boolean)) } }, { fullName: 1 }).lean();
    const vmap = new Map(verifiers.map((v) => [String(v._id), v.fullName]));
    ok(res, counsellors.map((c) => {
      const p = pmap.get(String(c._id));
      return {
        userId: String(c._id), name: c.fullName, email: c.email, accountStatus: c.accountStatus,
        publisher: Boolean(p && !p.revokedAt && c.accountStatus === 'active'),
        verifiedAt: p?.verifiedAt ?? null, verifiedBy: p ? vmap.get(String(p.verifiedBy)) ?? null : null,
        revokedAt: p?.revokedAt ?? null, revokedBy: p?.revokedBy ? vmap.get(String(p.revokedBy)) ?? null : null, note: p?.note ?? null,
      };
    }));
  }),
);

channelRouter.post(
  '/counselling/publishers',
  requirePermission('community_channels:manage'),
  asyncHandler(async (req, res) => {
    const input = parse(channelPublisherSchema, req.body);
    const channel = await ensureCounsellingChannel();
    const counsellor = await User.findById(input.userId, { role: 1, accountStatus: 1 }).lean();
    // The counsellor role itself is assigned through the existing staff workflow; this only adds publishing.
    if (!counsellor || counsellor.role !== 'counsellor') throw new AppError(422, 'not_counsellor', 'Only staff with the counsellor role can be verified to publish.');
    if (counsellor.accountStatus !== 'active') throw new AppError(422, 'inactive', 'The counsellor account must be active.');
    await ChannelPublisher.findOneAndUpdate(
      { channelId: channel._id, userId: input.userId },
      { $set: { verifiedBy: req.user!._id, verifiedAt: new Date(), note: input.note ?? null, revokedAt: null, revokedBy: null }, $setOnInsert: { channelId: channel._id, userId: input.userId } },
      { upsert: true },
    );
    await audit({ action: 'counselling_channel.publisher_verified', req, targetType: 'user', targetId: input.userId, reason: input.note ?? null });
    await notify({ userId: input.userId, kind: 'channel_publisher', title: 'You can now publish in Official Counselling Support', body: 'Your counselling posts will carry the verified badge.', link: '/consultancy/channel' });
    ok(res, { ok: true }, 201);
  }),
);

channelRouter.delete(
  '/counselling/publishers/:userId',
  requirePermission('community_channels:manage'),
  asyncHandler(async (req, res) => {
    if (!Types.ObjectId.isValid(req.params.userId)) throw notFound();
    const channel = await ensureCounsellingChannel();
    const r = await ChannelPublisher.updateOne({ channelId: channel._id, userId: req.params.userId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedBy: req.user!._id } });
    if (!r.modifiedCount) throw notFound();
    await audit({ action: 'counselling_channel.publisher_revoked', req, targetType: 'user', targetId: req.params.userId, reason: typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 300) : null });
    ok(res, { ok: true });
  }),
);
