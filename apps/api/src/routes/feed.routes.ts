import { Router, type Request } from 'express';
import { Types } from 'mongoose';
import {
  FEED_LIMITS, OPEN_FEED_CATEGORIES, ROLE_LABELS, feedAppealDecisionSchema, feedAppealSchema, feedCommentSchema, feedCommentUpdateSchema, feedModerationSchema,
  feedPostCreateSchema, feedPostUpdateSchema, feedReactionSchema, feedReportSchema, normaliseTag, screenCommunityText, type Role,
} from '@campuscare/shared';
import { AppError, asyncHandler, notFound, ok, pageParams, parse } from '../lib/http';
import { ChannelPublisher, CommunityEvent, FeedAppeal, FeedBookmark, FeedComment, FeedPost, FeedReaction, FeedReport, FeedView, OfficialChannel } from '../models/feed';
import { ChatBlock } from '../models/chat';
import { Evidence } from '../models/incident';
import { User } from '../models/user';
import { requireAuth, requirePermission } from '../middleware/auth';
import { upload } from '../middleware/security';
import { getSettings } from '../services/settings.service';
import { attachmentView, bindUploads, storeUpload, streamFile } from '../services/files.service';
import { notify, notifyMany } from '../services/notification.service';
import { audit } from '../services/audit.service';
import {
  applyReportThreshold, authorLabelFor, blockedIdsFor, can, canViewPost, contentHashOf, cursorFilter, encodeCursor, ensureCounsellingChannel, hasBlocked,
  isActivePublisher, isModerator, loadPostFor, moderatorIds, notifyReactionMilestone, promoteScheduledPosts, recountComments, sameId, serializeComments, serializePosts,
} from '../services/feed.service';

/**
 * Community feed: posts, comments, reactions, bookmarks, reports, blocks and moderation.
 * Mounted at /api/v1/community next to the safety-map / lost & found router.
 */
export const feedRouter = Router();
feedRouter.use(requireAuth);

const CRISIS_NOTE = 'If you or someone else is in danger or thinking about self-harm, use SOS or call 112 now. You can also talk privately to a campus counsellor.';

async function feedSettings() {
  return (await getSettings()).community;
}

async function assertFeedOpen() {
  if (!(await feedSettings()).feedEnabled) throw new AppError(403, 'feed_disabled', 'The community feed is turned off.');
}

function assertCanParticipate(user: Express.Request['user']) {
  if (!can(user!, 'chat:community')) throw new AppError(403, 'forbidden', 'Your account cannot post in the community.');
}

/** Rate limits and duplicate protection shared by posts. */
async function assertPostAllowed(userId: unknown, hash: string, staff: boolean) {
  const factor = staff ? 4 : 1;
  const [recent, today, dup] = await Promise.all([
    FeedPost.countDocuments({ authorId: userId, createdAt: { $gt: new Date(Date.now() - 15 * 60_000) } }),
    FeedPost.countDocuments({ authorId: userId, createdAt: { $gt: new Date(Date.now() - 86400_000) } }),
    FeedPost.exists({ authorId: userId, contentHash: hash, status: { $ne: 'deleted' }, createdAt: { $gt: new Date(Date.now() - 86400_000) } }),
  ]);
  if (recent >= FEED_LIMITS.postsPer15Minutes * factor) throw new AppError(429, 'rate_limited', 'You are posting very often. Please wait a few minutes.');
  if (today >= FEED_LIMITS.postsPerDay * factor) throw new AppError(429, 'rate_limited', 'You have reached today\'s posting limit.');
  if (dup) throw new AppError(409, 'duplicate_post', 'You already posted this in the last 24 hours.');
}

// ------------------------------------------------------------------ feed

/**
 * GET /community/posts
 *   scope=feed (default) | mine | bookmarks
 *   category, q (text search; "#tag" searches tags), tag, cursor, limit
 * The first page of the feed also returns pinned official announcements.
 */
feedRouter.get(
  '/posts',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const s = await feedSettings();
    const scope = String(req.query.scope ?? 'feed');
    if (!s.feedEnabled && scope === 'feed') return ok(res, { items: [], pinned: [], nextCursor: null, disabled: true });
    void promoteScheduledPosts().catch(() => undefined);

    if (scope === 'mine' || scope === 'bookmarks') {
      const { limit, skip, page } = pageParams(req.query, 30);
      let filter: Record<string, unknown>;
      if (scope === 'mine') {
        filter = { authorId: user._id, status: { $ne: 'deleted' } };
      } else {
        const marks = await FeedBookmark.find({ userId: user._id }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
        filter = { _id: { $in: marks.map((m) => m.postId) }, $or: [{ status: 'published' }, { authorId: user._id, status: { $ne: 'deleted' } }] };
      }
      const docs = await FeedPost.find(filter).sort({ createdAt: -1 }).skip(scope === 'mine' ? skip : 0).limit(limit).lean();
      const items = await serializePosts(user, docs as never);
      return ok(res, { items, pinned: [], page, nextCursor: docs.length === limit ? String(page + 1) : null });
    }

    const limit = Math.min(30, Math.max(1, Number(req.query.limit) || 15));
    const blocked = await blockedIdsFor(user._id);
    const base: Record<string, unknown> = { channelId: null, status: 'published' };
    if (blocked.length) base.authorId = { $nin: blocked };
    if (typeof req.query.category === 'string' && req.query.category !== 'all') base.category = req.query.category;
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
    const tag = typeof req.query.tag === 'string' ? normaliseTag(req.query.tag) : q.startsWith('#') ? normaliseTag(q) : null;
    if (tag) base.tags = tag;
    else if (q) base.$text = { $search: q };

    const first = !req.query.cursor;
    const pinnedDocs = first && !q && !tag ? await FeedPost.find({ ...base, pinned: true, official: true }).sort({ publishedAt: -1 }).limit(5).lean() : [];
    const filter = { ...base, ...cursorFilter(req.query.cursor), ...(pinnedDocs.length ? { _id: { $nin: pinnedDocs.map((p) => p._id) } } : {}) };
    const docs = await FeedPost.find(filter).sort({ publishedAt: -1, _id: -1 }).limit(limit + 1).lean();
    const hasMore = docs.length > limit;
    const page = docs.slice(0, limit);
    ok(res, {
      items: await serializePosts(user, page as never),
      pinned: await serializePosts(user, pinnedDocs as never),
      nextCursor: hasMore ? encodeCursor(page[page.length - 1]!) : null,
    });
  }),
);

/** Featured banner: pinned official announcements + the next events + the counselling channel card. */
feedRouter.get(
  '/featured',
  asyncHandler(async (req, res) => {
    const s = await feedSettings();
    const channel = await ensureCounsellingChannel();
    const [announcements, events, latest] = await Promise.all([
      s.feedEnabled ? FeedPost.find({ channelId: null, status: 'published', official: true, pinned: true }).sort({ publishedAt: -1 }).limit(5).lean() : [],
      s.eventsEnabled ? CommunityEvent.find({ status: 'published', endsAt: { $gt: new Date() } }).sort({ startsAt: 1 }).limit(3).lean() : [],
      FeedPost.findOne({ channelId: channel._id, status: 'published' }, { publishedAt: 1 }).sort({ publishedAt: -1 }).lean(),
    ]);
    ok(res, {
      announcements: await serializePosts(req.user!, announcements as never),
      events: events.map((e) => ({ id: String(e._id), title: e.title, kind: e.kind, startsAt: e.startsAt, endsAt: e.endsAt, venue: e.venue, organizer: e.organizer })),
      channel: { slug: channel.slug, name: channel.name, description: channel.description, latestPostAt: latest?.publishedAt ?? null },
    });
  }),
);

feedRouter.post(
  '/posts',
  asyncHandler(async (req, res) => {
    await assertFeedOpen();
    const user = req.user!;
    assertCanParticipate(user);
    const input = parse(feedPostCreateSchema, req.body);
    const existing = await FeedPost.findOne({ authorId: user._id, clientId: input.clientId }).lean();
    if (existing) return ok(res, { post: (await serializePosts(user, [existing as never]))[0], duplicate: true });

    const official = input.official || input.category === 'announcements';
    if (official && !can(user, 'announcements:manage')) {
      await audit({ action: 'community.official_post_denied', req, outcome: 'denied' });
      throw new AppError(403, 'not_official', 'Only authorised university accounts can publish official announcements.');
    }
    if (!official && !OPEN_FEED_CATEGORIES.includes(input.category)) throw new AppError(422, 'validation_failed', 'Choose a category.', { fields: { category: 'Choose a category' } });
    const s = await feedSettings();
    if (input.attachmentIds.length && !official && !s.feedImagesEnabled) throw new AppError(403, 'media_disabled', 'Images in posts are turned off by your administrator.');

    const hash = contentHashOf(input.body);
    await assertPostAllowed(user._id, hash, user.role !== 'student');
    const screen = screenCommunityText(`${input.body} ${input.locationLabel ?? ''}`, { trusted: official });
    const hold = screen.hold || (s.feedPreModeration && user.role === 'student');
    const files = await bindUploads(input.attachmentIds, { purpose: 'feed', uploaderId: String(user._id) });

    let post;
    try {
      post = await FeedPost.create({
        authorId: user._id, authorLabel: official ? user.fullName : authorLabelFor(user), authorRole: user.role, channelId: null, official,
        category: official ? (input.category === 'announcements' ? 'announcements' : input.category) : input.category,
        body: input.body, tags: input.tags, attachmentIds: files.map((f) => f._id), locationLabel: input.locationLabel || null,
        status: hold ? 'pending_review' : 'published', holdFlags: hold ? (screen.flags.length ? screen.flags : ['pre_moderation']) : [],
        publishedAt: hold ? null : new Date(), contentHash: hash, clientId: input.clientId,
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        const again = await FeedPost.findOne({ authorId: user._id, clientId: input.clientId }).lean();
        if (again) return ok(res, { post: (await serializePosts(user, [again as never]))[0], duplicate: true });
      }
      throw err;
    }
    await audit({ action: official ? 'community.official_post_published' : 'community.post_created', req, targetType: 'feed_post', targetId: String(post._id), meta: { held: hold, flags: screen.flags, category: post.category } });
    if (hold && screen.flags.length) {
      await notifyMany(await moderatorIds(), { kind: 'community_report', priority: screen.flags.includes('self_harm') ? 'high' : 'low', title: 'Post waiting for review', body: 'A community post was held by automatic screening.', link: '/moderator/community' });
    }
    ok(res, {
      post: (await serializePosts(user, [post.toObject() as never]))[0],
      duplicate: false,
      held: hold,
      message: hold ? 'Submitted for review. A moderator will check it before it appears in the feed.' : 'Posted.',
      crisisSupport: screen.showCrisisSupport ? CRISIS_NOTE : null,
    }, 201);
  }),
);

feedRouter.get(
  '/posts/:id',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const post = await loadPostFor(user, req.params.id);
    if (post.status === 'published' && !sameId(post.authorId, user._id)) {
      if (await hasBlocked(user._id, post.authorId)) throw notFound();
      // Unique views only, counted for the author's dashboard.
      const r = await FeedView.updateOne({ postId: post._id, userId: user._id }, { $setOnInsert: { postId: post._id, userId: user._id } }, { upsert: true });
      if (r.upsertedCount) await FeedPost.updateOne({ _id: post._id }, { $inc: { viewCount: 1 } });
    }
    const publisherOf = new Set<string>();
    if (post.channelId && (await isActivePublisher(user, post.channelId))) publisherOf.add(String(post.channelId));
    ok(res, (await serializePosts(user, [post.toObject() as never], { publisherOf }))[0]);
  }),
);

feedRouter.patch(
  '/posts/:id',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const input = parse(feedPostUpdateSchema, req.body);
    const post = await loadPostFor(user, req.params.id);
    if (post.channelId) throw new AppError(409, 'use_channel', 'Edit channel posts from the counsellor dashboard.');
    const mine = sameId(post.authorId, user._id);
    if (input.pinned !== undefined) {
      if (!post.official || !can(user, 'announcements:manage')) throw new AppError(403, 'forbidden', 'Only official announcements can be pinned, by authorised accounts.');
      post.pinned = input.pinned;
    }
    const editsContent = input.body !== undefined || input.category !== undefined || input.tags !== undefined || input.locationLabel !== undefined;
    if (editsContent) {
      if (!mine || ['removed', 'deleted', 'hidden'].includes(post.status)) throw new AppError(403, 'forbidden', 'You can only edit your own posts.');
      if (input.category && !post.official && !OPEN_FEED_CATEGORIES.includes(input.category)) throw new AppError(422, 'validation_failed', 'Choose a category.');
      if (input.body !== undefined) { post.body = input.body; post.contentHash = contentHashOf(input.body); }
      if (input.category) post.category = input.category;
      if (input.tags) post.tags = input.tags;
      if (input.locationLabel !== undefined) post.locationLabel = input.locationLabel || null;
      post.editedAt = new Date();
      // Edited text is screened again; an edit can't be used to slip past review.
      const screen = screenCommunityText(`${post.body} ${post.locationLabel ?? ''}`, { trusted: post.official });
      if (screen.hold && post.status === 'published') {
        post.status = 'pending_review';
        post.holdFlags = screen.flags;
      }
    }
    await post.save();
    await audit({ action: input.pinned !== undefined && !editsContent ? `community.post_${input.pinned ? 'pinned' : 'unpinned'}` : 'community.post_edited', req, targetType: 'feed_post', targetId: String(post._id) });
    ok(res, (await serializePosts(user, [post.toObject() as never]))[0]);
  }),
);

feedRouter.delete(
  '/posts/:id',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const post = await loadPostFor(user, req.params.id);
    if (!sameId(post.authorId, user._id)) throw notFound();
    post.status = 'deleted';
    post.deletedAt = new Date();
    post.pinned = false;
    await post.save();
    await audit({ action: 'community.post_deleted', req, targetType: 'feed_post', targetId: String(post._id) });
    ok(res, { ok: true });
  }),
);

// ------------------------------------------------------------------ images

feedRouter.post(
  '/uploads',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    assertCanParticipate(user);
    const s = await feedSettings();
    const channel = await ensureCounsellingChannel();
    const publisher = await isActivePublisher(user, channel._id);
    const privileged = can(user, 'announcements:manage') || publisher;
    if (!s.feedImagesEnabled && !privileged) throw new AppError(403, 'media_disabled', 'Images in posts are turned off by your administrator.');
    const recent = await Evidence.countDocuments({ purpose: 'feed', uploaderId: user._id, createdAt: { $gt: new Date(Date.now() - 3600_000) } });
    if (recent >= 20) throw new AppError(429, 'rate_limited', 'Too many uploads. Please wait a while.');
    const doc = await storeUpload(req.file, { purpose: 'feed', uploaderId: String(user._id), allowDocuments: privileged });
    ok(res, attachmentView(doc), 201);
  }),
);

feedRouter.get(
  '/files/:id',
  asyncHandler(async (req, res) => {
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const file = await Evidence.findOne({ _id: req.params.id, purpose: 'feed' }, { uploaderId: 1, bound: 1 }).lean();
    if (!file) throw notFound();
    if (!file.bound) {
      // Preview of the uploader's own, not-yet-posted image.
      if (!sameId(file.uploaderId, req.user!._id)) throw notFound();
    } else {
      const post = await FeedPost.findOne({ attachmentIds: file._id }, { authorId: 1, status: 1 }).lean();
      if (!post || !canViewPost(req.user!, post)) throw notFound();
    }
    await streamFile(res, req, req.params.id, 'inline');
  }),
);

// ------------------------------------------------------------------ reactions and bookmarks

feedRouter.put(
  '/posts/:id/reaction',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const { kind } = parse(feedReactionSchema, req.body ?? {});
    const post = await loadPostFor(user, req.params.id);
    if (post.status !== 'published') throw new AppError(409, 'not_published', 'You can react once the post is published.');
    let inserted = false;
    try {
      const r = await FeedReaction.updateOne({ postId: post._id, userId: user._id }, { $set: { kind }, $setOnInsert: { postId: post._id, userId: user._id } }, { upsert: true });
      inserted = r.upsertedCount > 0;
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err; // concurrent double-tap: the other request inserted it
      await FeedReaction.updateOne({ postId: post._id, userId: user._id }, { $set: { kind } });
    }
    const updated = inserted ? await FeedPost.findByIdAndUpdate(post._id, { $inc: { reactionCount: 1 } }, { new: true, projection: { reactionCount: 1, authorId: 1 } }).lean() : post;
    if (inserted && updated) await notifyReactionMilestone(updated as never, updated.reactionCount, user._id);
    ok(res, { reactionCount: updated?.reactionCount ?? post.reactionCount, myReaction: kind });
  }),
);

feedRouter.delete(
  '/posts/:id/reaction',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const post = await loadPostFor(user, req.params.id);
    const r = await FeedReaction.deleteOne({ postId: post._id, userId: user._id });
    const updated = r.deletedCount ? await FeedPost.findOneAndUpdate({ _id: post._id, reactionCount: { $gt: 0 } }, { $inc: { reactionCount: -1 } }, { new: true, projection: { reactionCount: 1 } }).lean() : null;
    ok(res, { reactionCount: updated?.reactionCount ?? post.reactionCount, myReaction: null });
  }),
);

feedRouter.put(
  '/posts/:id/bookmark',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const post = await loadPostFor(user, req.params.id);
    const r = await FeedBookmark.updateOne({ postId: post._id, userId: user._id }, { $setOnInsert: { postId: post._id, userId: user._id } }, { upsert: true }).catch((err) => {
      if ((err as { code?: number }).code === 11000) return { upsertedCount: 0 };
      throw err;
    });
    if (r.upsertedCount) await FeedPost.updateOne({ _id: post._id }, { $inc: { bookmarkCount: 1 } });
    ok(res, { bookmarked: true });
  }),
);

feedRouter.delete(
  '/posts/:id/bookmark',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const r = await FeedBookmark.deleteOne({ postId: req.params.id, userId: user._id });
    if (r.deletedCount) await FeedPost.updateOne({ _id: req.params.id, bookmarkCount: { $gt: 0 } }, { $inc: { bookmarkCount: -1 } });
    ok(res, { bookmarked: false });
  }),
);

// ------------------------------------------------------------------ comments

/** Top-level comments, oldest first, with their replies. Paginated by `cursor` (last comment id). */
feedRouter.get(
  '/posts/:id/comments',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const post = await loadPostFor(user, req.params.id);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const blocked = await blockedIdsFor(user._id);
    const moderator = isModerator(user);
    const visible: Record<string, unknown> = moderator
      ? { status: { $in: ['published', 'pending_review', 'hidden'] } }
      : { $or: [{ status: 'published' }, { authorId: user._id, status: 'pending_review' }] };
    const base: Record<string, unknown> = { postId: post._id, ...visible, ...(blocked.length ? { authorId: { $nin: blocked } } : {}) };
    const top: Record<string, unknown> = { ...base, parentId: null };
    if (typeof req.query.cursor === 'string' && Types.ObjectId.isValid(req.query.cursor)) {
      const pivot = await FeedComment.findById(req.query.cursor, { createdAt: 1 }).lean();
      if (pivot) top.$and = [{ $or: [{ createdAt: { $gt: pivot.createdAt } }, { createdAt: pivot.createdAt, _id: { $gt: pivot._id } }] }];
    }
    const parents = await FeedComment.find(top).sort({ createdAt: 1, _id: 1 }).limit(limit + 1).lean();
    const hasMore = parents.length > limit;
    const pageItems = parents.slice(0, limit);
    const replies = pageItems.length ? await FeedComment.find({ ...base, parentId: { $in: pageItems.map((p) => p._id) } }).sort({ createdAt: 1 }).limit(500).lean() : [];
    const all = await serializeComments(user, [...pageItems, ...replies] as never, post);
    const byParent = new Map<string, typeof all>();
    for (const c of all) if (c.parentId) byParent.set(c.parentId, [...(byParent.get(c.parentId) ?? []), c]);
    ok(res, {
      items: all.filter((c) => !c.parentId).map((c) => ({ ...c, replies: byParent.get(c.id) ?? [] })),
      nextCursor: hasMore ? String(pageItems[pageItems.length - 1]!._id) : null,
      commentCount: post.commentCount,
      commentsEnabled: post.commentsEnabled,
    });
  }),
);

feedRouter.post(
  '/posts/:id/comments',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    assertCanParticipate(user);
    const input = parse(feedCommentSchema, req.body);
    const post = await loadPostFor(user, req.params.id);
    const dup = await FeedComment.findOne({ authorId: user._id, clientId: input.clientId }).lean();
    if (dup) return ok(res, { comment: (await serializeComments(user, [dup as never], post))[0], duplicate: true, commentCount: post.commentCount });
    if (post.status !== 'published') throw new AppError(409, 'not_published', 'Comments open once the post is published.');
    if (!post.commentsEnabled) throw new AppError(403, 'comments_closed', 'Comments are turned off for this post.');
    if (post.channelId) {
      const ch = await OfficialChannel.findById(post.channelId, { commentsEnabled: 1 }).lean();
      if (!ch?.commentsEnabled) throw new AppError(403, 'comments_closed', 'Comments are turned off in this channel.');
    }
    if (await hasBlocked(post.authorId, user._id)) throw new AppError(403, 'cannot_comment', "You can't comment on this post.");
    let parentId: Types.ObjectId | null = null;
    if (input.parentId) {
      const parent = await FeedComment.findOne({ _id: input.parentId, postId: post._id, status: 'published' }).lean();
      if (!parent) throw new AppError(404, 'not_found', 'That comment is no longer available.');
      parentId = (parent.parentId ?? parent._id) as Types.ObjectId; // replies stay one level deep
    }
    const recent = await FeedComment.countDocuments({ authorId: user._id, createdAt: { $gt: new Date(Date.now() - 5 * 60_000) } });
    if (recent >= FEED_LIMITS.commentsPer5Minutes) throw new AppError(429, 'rate_limited', 'You are commenting very quickly. Please wait a moment.');
    const screen = screenCommunityText(input.body);
    let comment;
    try {
      comment = await FeedComment.create({
        postId: post._id, parentId, authorId: user._id, authorLabel: authorLabelFor(user), authorRole: user.role, body: input.body,
        status: screen.hold ? 'pending_review' : 'published', holdFlags: screen.flags, clientId: input.clientId,
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        const again = await FeedComment.findOne({ authorId: user._id, clientId: input.clientId }).lean();
        if (again) return ok(res, { comment: (await serializeComments(user, [again as never], post))[0], duplicate: true, commentCount: post.commentCount });
      }
      throw err;
    }
    const commentCount = await recountComments(post._id);
    if (!screen.hold) {
      const link = `/student/community/posts/${post._id}`;
      const parentAuthor = parentId ? (await FeedComment.findById(parentId, { authorId: 1 }).lean())?.authorId : null;
      if (!sameId(post.authorId, user._id) && !(await hasBlocked(post.authorId, user._id))) {
        await notify({ userId: String(post.authorId), kind: 'community_comment', category: 'community', title: post.official ? 'New comment on your official post' : 'New comment on your post', body: 'Someone commented on your post.', link });
      }
      if (parentAuthor && !sameId(parentAuthor, user._id) && !sameId(parentAuthor, post.authorId) && !(await hasBlocked(parentAuthor, user._id))) {
        await notify({ userId: String(parentAuthor), kind: 'community_reply', category: 'community', title: 'New reply to your comment', body: 'Someone replied to your comment.', link });
      }
    }
    ok(res, {
      comment: (await serializeComments(user, [comment.toObject() as never], post))[0],
      duplicate: false, commentCount, held: screen.hold,
      message: screen.hold ? 'Submitted for review. Others will see it once a moderator approves it.' : null,
      crisisSupport: screen.showCrisisSupport ? CRISIS_NOTE : null,
    }, 201);
  }),
);

feedRouter.patch(
  '/comments/:id',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const { body } = parse(feedCommentUpdateSchema, req.body);
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const c = await FeedComment.findById(req.params.id);
    if (!c || !sameId(c.authorId, user._id) || !['published', 'pending_review'].includes(c.status)) throw notFound();
    const post = await loadPostFor(user, String(c.postId));
    c.body = body;
    c.editedAt = new Date();
    const screen = screenCommunityText(body);
    if (screen.hold && c.status === 'published') { c.status = 'pending_review'; c.holdFlags = screen.flags; }
    await c.save();
    await recountComments(c.postId);
    ok(res, (await serializeComments(user, [c.toObject() as never], post))[0]);
  }),
);

feedRouter.delete(
  '/comments/:id',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const c = await FeedComment.findById(req.params.id);
    if (!c || !sameId(c.authorId, user._id) || c.status === 'deleted') throw notFound();
    c.status = 'deleted';
    await c.save();
    const commentCount = await recountComments(c.postId);
    await audit({ action: 'community.comment_deleted', req, targetType: 'feed_comment', targetId: String(c._id) });
    ok(res, { ok: true, commentCount });
  }),
);

// ------------------------------------------------------------------ author preview and blocking

async function resolveAuthored(viewer: Express.Request['user'], via: 'post' | 'comment', id: string) {
  if (!Types.ObjectId.isValid(id)) throw notFound();
  if (via === 'post') {
    const post = await loadPostFor(viewer!, id);
    return { authorId: post.authorId, authorLabel: post.authorLabel, authorRole: post.authorRole, official: post.official, postId: post._id };
  }
  const c = await FeedComment.findById(id).lean();
  if (!c || c.status === 'deleted') throw notFound();
  const post = await loadPostFor(viewer!, String(c.postId));
  if (c.status !== 'published' && !sameId(c.authorId, viewer!._id) && !isModerator(viewer!)) throw notFound();
  return { authorId: c.authorId, authorLabel: c.authorLabel, authorRole: c.authorRole, official: false, postId: post._id };
}

/**
 * Profile preview. Shows only what the author already shows publicly; students who hide their name
 * in community spaces stay anonymous here too. Verified counsellors include a way to message them.
 */
async function authorPreview(req: Request, via: 'post' | 'comment', id: string) {
  const viewer = req.user!;
  const a = await resolveAuthored(viewer, via, id);
  const author = await User.findById(a.authorId, { fullName: 1, role: 1, department: 1, createdAt: 1, privacy: 1, accountStatus: 1 }).lean();
  const anonymous = a.authorLabel === 'Student' && author?.privacy?.showNameInCommunity === false;
  const channel = await ensureCounsellingChannel();
  const verified = author?.role === 'counsellor' && author.accountStatus === 'active' && Boolean(await ChannelPublisher.exists({ channelId: channel._id, userId: a.authorId, revokedAt: null }));
  const posts = anonymous ? null : await FeedPost.countDocuments({ authorId: a.authorId, status: 'published' });
  return {
    name: a.authorLabel,
    roleLabel: (a.authorRole as Role) === 'student' ? 'Student' : verified ? 'Verified counsellor' : ROLE_LABELS[a.authorRole as Role] ?? 'Staff',
    verified,
    official: a.official,
    department: anonymous || author?.role !== 'student' ? null : author?.department ?? null,
    memberSince: anonymous ? null : author ? new Date(author.createdAt as Date).getFullYear() : null,
    posts,
    isSelf: sameId(a.authorId, viewer._id),
    blocked: await hasBlocked(viewer._id, a.authorId),
    // Students can start a private conversation with an active counsellor from their profile.
    counsellorId: author?.role === 'counsellor' && author.accountStatus === 'active' && viewer.role === 'student' ? String(a.authorId) : null,
  };
}

feedRouter.get('/posts/:id/author', asyncHandler(async (req, res) => ok(res, await authorPreview(req, 'post', req.params.id))));
feedRouter.get('/comments/:id/author', asyncHandler(async (req, res) => ok(res, await authorPreview(req, 'comment', req.params.id))));

async function blockAuthor(req: Request, via: 'post' | 'comment', id: string) {
  const user = req.user!;
  const a = await resolveAuthored(user, via, id);
  if (sameId(a.authorId, user._id)) throw new AppError(422, 'self', "You can't block yourself.");
  if (a.official && (a.authorRole as Role) !== 'student') throw new AppError(422, 'official', "Official university accounts can't be blocked. You can report a post instead.");
  await ChatBlock.updateOne({ userId: user._id, blockedUserId: a.authorId }, { $setOnInsert: { userId: user._id, blockedUserId: a.authorId } }, { upsert: true });
  await audit({ action: 'community.user_blocked', req, targetType: via === 'post' ? 'feed_post' : 'feed_comment', targetId: id });
  return { ok: true, message: "You won't see posts or comments from this person. They are not told." };
}

feedRouter.post('/posts/:id/block-author', asyncHandler(async (req, res) => ok(res, await blockAuthor(req, 'post', req.params.id))));
feedRouter.post('/comments/:id/block-author', asyncHandler(async (req, res) => ok(res, await blockAuthor(req, 'comment', req.params.id))));

/** People I have blocked (chat and feed share one block list). */
feedRouter.get(
  '/blocks',
  asyncHandler(async (req, res) => {
    const blocks = await ChatBlock.find({ userId: req.user!._id }).sort({ createdAt: -1 }).lean();
    const users = await User.find({ _id: { $in: blocks.map((b) => b.blockedUserId) } }, { fullName: 1, role: 1, privacy: 1 }).lean();
    const map = new Map(users.map((u) => [String(u._id), u]));
    ok(res, blocks.map((b) => {
      const u = map.get(String(b.blockedUserId));
      const hidden = u?.role === 'student' && u.privacy?.showNameInCommunity === false;
      return { id: String(b._id), name: !u ? 'Former member' : hidden ? 'A student (name hidden)' : u.fullName, createdAt: b.createdAt };
    }));
  }),
);

feedRouter.delete(
  '/blocks/:id',
  asyncHandler(async (req, res) => {
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    await ChatBlock.deleteOne({ _id: req.params.id, userId: req.user!._id });
    ok(res, { ok: true });
  }),
);

// ------------------------------------------------------------------ reports

feedRouter.post(
  '/reports',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const input = parse(feedReportSchema, req.body);
    let targetId: Types.ObjectId;
    let postId: Types.ObjectId | null = null;
    let reportedUserId: Types.ObjectId | null = null;
    if (input.targetType === 'post') {
      const post = await loadPostFor(user, input.targetId);
      if (sameId(post.authorId, user._id)) throw new AppError(422, 'own_content', "You can't report your own post.");
      targetId = post._id; postId = post._id; reportedUserId = post.authorId as Types.ObjectId;
    } else if (input.targetType === 'comment') {
      const a = await resolveAuthored(user, 'comment', input.targetId);
      if (sameId(a.authorId, user._id)) throw new AppError(422, 'own_content', "You can't report your own comment.");
      targetId = new Types.ObjectId(input.targetId); postId = a.postId as Types.ObjectId; reportedUserId = a.authorId as Types.ObjectId;
    } else {
      const a = await resolveAuthored(user, input.via ?? 'post', input.targetId);
      if (sameId(a.authorId, user._id)) throw new AppError(422, 'own_content', "You can't report yourself.");
      targetId = a.authorId as Types.ObjectId; postId = a.postId as Types.ObjectId; reportedUserId = a.authorId as Types.ObjectId;
    }
    const recent = await FeedReport.countDocuments({ reporterId: user._id, createdAt: { $gt: new Date(Date.now() - 3600_000) } });
    if (recent >= 20) throw new AppError(429, 'rate_limited', 'You have sent many reports recently. Moderators are reviewing them.');
    let duplicate = false;
    try {
      await FeedReport.create({ targetType: input.targetType, targetId, postId, reportedUserId, reporterId: user._id, reason: input.reason, details: input.details || null });
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
      duplicate = true;
    }
    let held = false;
    if (!duplicate && input.targetType !== 'user') {
      const Model = (input.targetType === 'post' ? FeedPost : FeedComment) as unknown as typeof FeedPost;
      const open = await FeedReport.countDocuments({ targetType: input.targetType, targetId, status: 'open' });
      await Model.updateOne({ _id: targetId }, { $set: { openReportCount: open } });
      held = await applyReportThreshold(input.targetType, targetId, open, input.reason);
    } else if (!duplicate) {
      await notifyMany(await moderatorIds(), { kind: 'community_report', priority: 'normal', title: 'A community member was reported', body: 'Please review the user report.', link: '/moderator/community' });
    }
    await audit({ action: 'community.report_created', req, targetType: `feed_${input.targetType}`, targetId: String(targetId), meta: { reason: input.reason, duplicate } });
    ok(res, {
      ok: true, duplicate, held,
      message: 'Thanks for reporting. Moderators will review it — the author is not told who reported it.',
      crisisSupport: input.reason === 'self_harm' ? 'If someone is in immediate danger, call campus security or 112 now. Reporting here is not an emergency service.' : null,
    }, duplicate ? 200 : 201);
  }),
);

// ------------------------------------------------------------------ appeals (authors)

async function fileAppeal(req: Request, kind: 'post' | 'comment', id: string) {
  const user = req.user!;
  const { reason } = parse(feedAppealSchema, req.body);
  if (!Types.ObjectId.isValid(id)) throw notFound();
  const Model = (kind === 'post' ? FeedPost : FeedComment) as unknown as typeof FeedPost;
  const target = await Model.findById(id, { authorId: 1, status: 1, moderation: 1 }).lean();
  if (!target || !sameId(target.authorId, user._id)) throw notFound();
  if (!['hidden', 'removed'].includes(target.status)) throw new AppError(409, 'not_moderated', 'Only hidden or removed content can be appealed.');
  try {
    await FeedAppeal.create({ targetType: kind, targetId: target._id, userId: user._id, reason, originalModeratorId: target.moderation?.by ?? null });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw new AppError(409, 'already_appealed', 'You have already appealed this decision.');
    throw err;
  }
  await notifyMany(await moderatorIds(), { kind: 'community_appeal', title: 'New moderation appeal', body: 'An author asked for a decision to be reviewed.', link: '/moderator/community' });
  await audit({ action: 'community.appeal_filed', req, targetType: `feed_${kind}`, targetId: id });
  return { ok: true, message: 'Appeal sent. A different moderator will review the decision and you will be notified.' };
}

feedRouter.post('/posts/:id/appeal', asyncHandler(async (req, res) => ok(res, await fileAppeal(req, 'post', req.params.id), 201)));
feedRouter.post('/comments/:id/appeal', asyncHandler(async (req, res) => ok(res, await fileAppeal(req, 'comment', req.params.id), 201)));

// ------------------------------------------------------------------ moderation (community:moderate)
// Moderators act on PUBLIC feed content only. Nothing here reads private chats, counselling threads
// or complaint conversations, and holding this permission grants no access to them.

feedRouter.get(
  '/moderation/queue',
  requirePermission('community:moderate'),
  asyncHandler(async (_req, res) => {
    const heldOrReported = { $or: [{ status: 'pending_review' }, { openReportCount: { $gt: 0 }, status: { $in: ['published', 'hidden'] } }] };
    const [posts, comments, userReports] = await Promise.all([
      FeedPost.find(heldOrReported).sort({ openReportCount: -1, createdAt: 1 }).limit(100).lean(),
      FeedComment.find(heldOrReported).sort({ openReportCount: -1, createdAt: 1 }).limit(100).lean(),
      FeedReport.find({ targetType: 'user', status: 'open' }).sort({ createdAt: 1 }).limit(50).lean(),
    ]);
    const targetIds = [...posts.map((p) => p._id), ...comments.map((c) => c._id)];
    const reports = await FeedReport.find({ targetId: { $in: targetIds }, status: 'open' }, { targetId: 1, reason: 1, details: 1, createdAt: 1 }).lean();
    const byTarget = new Map<string, typeof reports>();
    for (const r of reports) byTarget.set(String(r.targetId), [...(byTarget.get(String(r.targetId)) ?? []), r]);
    const summarise = (id: unknown) => {
      const rs = byTarget.get(String(id)) ?? [];
      const counts: Record<string, number> = {};
      for (const r of rs) counts[r.reason] = (counts[r.reason] ?? 0) + 1;
      return { reasons: Object.entries(counts).map(([reason, count]) => ({ reason, count })), details: rs.map((r) => r.details).filter(Boolean).slice(0, 5) };
    };
    const reportedUsers = await User.find({ _id: { $in: userReports.map((r) => r.reportedUserId) } }, { fullName: 1, role: 1 }).lean();
    const userMap = new Map(reportedUsers.map((u) => [String(u._id), u]));
    ok(res, {
      posts: posts.map((p) => ({
        id: String(p._id), kind: 'post', body: p.body, category: p.category, official: p.official, channel: p.channelId ? 'counselling' : null,
        authorLabel: p.authorLabel, authorRole: p.authorRole, status: p.status, holdFlags: p.holdFlags, openReports: p.openReportCount,
        attachments: p.attachmentIds.length, createdAt: p.createdAt, ...summarise(p._id),
      })),
      comments: comments.map((c) => ({
        id: String(c._id), kind: 'comment', postId: String(c.postId), body: c.body, authorLabel: c.authorLabel, authorRole: c.authorRole,
        status: c.status, holdFlags: c.holdFlags, openReports: c.openReportCount, createdAt: c.createdAt, ...summarise(c._id),
      })),
      users: userReports.map((r) => ({
        id: String(r._id), reason: r.reason, details: r.details, createdAt: r.createdAt, postId: r.postId ? String(r.postId) : null,
        user: userMap.get(String(r.reportedUserId)) ? { name: userMap.get(String(r.reportedUserId))!.fullName, role: userMap.get(String(r.reportedUserId))!.role } : null,
      })),
    });
  }),
);

async function moderate(req: Request, kind: 'post' | 'comment', id: string) {
  const { action, reason } = parse(feedModerationSchema, req.body);
  if (!Types.ObjectId.isValid(id)) throw notFound();
  const Model = (kind === 'post' ? FeedPost : FeedComment) as unknown as typeof FeedPost;
  const target = await Model.findById(id);
  if (!target || target.status === 'deleted' || (kind === 'post' && ['draft', 'scheduled'].includes(target.status))) throw notFound();
  if (sameId(target.authorId, req.user!._id)) throw new AppError(409, 'own_content', 'Another moderator must review your own content.');
  if ((action === 'hide' || action === 'remove') && !reason) throw new AppError(422, 'reason_required', 'Give a reason — the author will see it.');
  const from = target.status;
  const now = new Date();
  let reportStatus: 'actioned' | 'dismissed' | null = null;
  switch (action) {
    case 'approve':
    case 'restore':
      if (!['pending_review', 'hidden', 'removed'].includes(from)) throw new AppError(409, 'invalid_state', 'This content is already visible.');
      target.status = 'published';
      if (kind === 'post' && !target.publishedAt) target.publishedAt = now;
      target.holdFlags = [];
      reportStatus = 'dismissed';
      break;
    case 'dismiss':
      reportStatus = 'dismissed';
      // Content held only because of reports goes back up when the reports are dismissed.
      if (from === 'pending_review' && target.holdFlags.every((f: string) => f === 'reported')) {
        target.status = 'published';
        target.holdFlags = [];
      }
      break;
    case 'hide':
      target.status = 'hidden';
      target.pinned = false;
      reportStatus = 'actioned';
      break;
    case 'remove':
      target.status = 'removed';
      target.pinned = false;
      reportStatus = 'actioned';
      break;
  }
  target.moderation = { action, reason: reason ?? null, by: req.user!._id, at: now };
  target.openReportCount = 0;
  await target.save();
  if (reportStatus) await FeedReport.updateMany({ targetId: target._id, status: 'open' }, { $set: { status: reportStatus, reviewedBy: req.user!._id, reviewedAt: now } });
  if (kind === 'comment') await recountComments((target as unknown as { postId: unknown }).postId);
  await audit({ action: `community.moderation_${action}`, req, targetType: `feed_${kind}`, targetId: id, reason: reason ?? null, meta: { from, to: target.status } });
  if (from !== target.status) {
    const link = kind === 'post' ? `/student/community/posts/${target._id}` : `/student/community/posts/${(target as unknown as { postId: unknown }).postId}`;
    const what = kind === 'post' ? 'post' : 'comment';
    const message: Record<string, [string, string]> = {
      approve: [`Your ${what} is now visible`, `A moderator approved your ${what}.`],
      restore: [`Your ${what} was restored`, `A moderator restored your ${what}.`],
      dismiss: [`Your ${what} is visible again`, `Moderators reviewed the reports and kept your ${what}.`],
      hide: [`Your ${what} was hidden`, `A moderator hid your ${what}: ${reason}. You can appeal from the app.`],
      remove: [`Your ${what} was removed`, `A moderator removed your ${what}: ${reason}. You can appeal from the app.`],
    };
    const [title, body] = message[action]!;
    // Moderation decisions are always delivered (no category), and never include the content itself.
    await notify({ userId: String(target.authorId), kind: 'community_moderation', title, body: body.slice(0, 400), link });
  }
  return { ok: true, status: target.status };
}

feedRouter.post('/moderation/posts/:id', requirePermission('community:moderate'), asyncHandler(async (req, res) => ok(res, await moderate(req, 'post', req.params.id))));
feedRouter.post('/moderation/comments/:id', requirePermission('community:moderate'), asyncHandler(async (req, res) => ok(res, await moderate(req, 'comment', req.params.id))));

feedRouter.post(
  '/moderation/user-reports/:id',
  requirePermission('community:moderate'),
  asyncHandler(async (req, res) => {
    const action = String(req.body?.action);
    if (!['dismiss', 'actioned'].includes(action)) throw new AppError(422, 'bad_action', 'Choose dismiss or actioned.');
    const r = await FeedReport.findOneAndUpdate({ _id: req.params.id, targetType: 'user', status: 'open' }, { $set: { status: action === 'dismiss' ? 'dismissed' : 'actioned', reviewedBy: req.user!._id, reviewedAt: new Date() } });
    if (!r) throw notFound();
    await audit({ action: `community.user_report_${action}`, req, targetType: 'user', targetId: String(r.targetId), reason: typeof req.body?.note === 'string' ? req.body.note.slice(0, 300) : null });
    ok(res, { ok: true });
  }),
);

feedRouter.get(
  '/moderation/appeals',
  requirePermission('community:moderate'),
  asyncHandler(async (req, res) => {
    const status = ['pending', 'upheld', 'reversed'].includes(String(req.query.status)) ? String(req.query.status) : 'pending';
    const appeals = await FeedAppeal.find({ status }).sort({ createdAt: 1 }).limit(100).lean();
    const posts = await FeedPost.find({ _id: { $in: appeals.filter((a) => a.targetType === 'post').map((a) => a.targetId) } }, { body: 1, authorLabel: 1, status: 1, moderation: 1 }).lean();
    const comments = await FeedComment.find({ _id: { $in: appeals.filter((a) => a.targetType === 'comment').map((a) => a.targetId) } }, { body: 1, authorLabel: 1, status: 1, moderation: 1 }).lean();
    const targets = new Map([...posts, ...comments].map((t) => [String(t._id), t]));
    ok(res, appeals.map((a) => {
      const t = targets.get(String(a.targetId));
      return {
        id: String(a._id), targetType: a.targetType, targetId: String(a.targetId), reason: a.reason, status: a.status, note: a.note, createdAt: a.createdAt,
        canDecide: req.user!.role === 'super_admin' || !sameId(a.originalModeratorId, req.user!._id),
        content: t ? { body: t.body, authorLabel: t.authorLabel, status: t.status, decision: t.moderation?.action ?? null, decisionReason: t.moderation?.reason ?? null } : null,
      };
    }));
  }),
);

feedRouter.post(
  '/moderation/appeals/:id',
  requirePermission('community:moderate'),
  asyncHandler(async (req, res) => {
    const input = parse(feedAppealDecisionSchema, req.body);
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const appeal = await FeedAppeal.findById(req.params.id);
    if (!appeal || appeal.status !== 'pending') throw notFound();
    if (sameId(appeal.originalModeratorId, req.user!._id) && req.user!.role !== 'super_admin') {
      throw new AppError(409, 'conflict_of_interest', 'A different moderator must review an appeal of your own decision.');
    }
    const Model = (appeal.targetType === 'post' ? FeedPost : FeedComment) as unknown as typeof FeedPost;
    if (input.decision === 'reversed') {
      const target = await Model.findById(appeal.targetId);
      if (target && ['hidden', 'removed'].includes(target.status)) {
        target.status = 'published';
        target.holdFlags = [];
        target.moderation = { action: 'appeal_reversed', reason: input.note ?? null, by: req.user!._id, at: new Date() };
        await target.save();
        if (appeal.targetType === 'comment') await recountComments((target as unknown as { postId: unknown }).postId);
      }
    }
    appeal.status = input.decision;
    appeal.decidedBy = req.user!._id;
    appeal.decidedAt = new Date();
    appeal.note = input.note ?? null;
    await appeal.save();
    await audit({ action: `community.appeal_${input.decision}`, req, targetType: `feed_${appeal.targetType}`, targetId: String(appeal.targetId), reason: input.note ?? null });
    await notify({
      userId: String(appeal.userId), kind: 'community_moderation',
      title: input.decision === 'reversed' ? 'Your appeal was accepted' : 'Your appeal was reviewed',
      body: input.decision === 'reversed' ? 'Your content has been restored.' : 'A moderator reviewed your appeal and kept the original decision.',
      link: '/student/community',
    });
    ok(res, { ok: true, status: appeal.status });
  }),
);
