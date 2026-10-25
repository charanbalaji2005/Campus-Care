import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import {
  COUNSELLING_TOPICS, EVENT_KINDS, FEED_CATEGORIES, FEED_COMMENT_STATUSES, FEED_POST_STATUSES, FEED_REACTIONS, FEED_REPORT_REASONS, RSVP_STATUSES,
} from '@campuscare/shared';

/**
 * Community feed. Everything here is PUBLIC to signed-in campus users once published — private
 * support chats, counselling threads, complaint chats, SOS and location data live in their own
 * collections and are never copied into these.
 */

/** Official channels (today: Official Counselling Support). Created on first use. */
const officialChannelSchema = new Schema(
  {
    slug: { type: String, required: true },
    name: { type: String, required: true, maxlength: 80 },
    description: { type: String, default: '', maxlength: 400 },
    commentsEnabled: { type: Boolean, default: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
officialChannelSchema.index({ slug: 1 }, { unique: true });
export const OfficialChannel = model('OfficialChannel', officialChannelSchema);

/**
 * Explicit, Super-Admin-verified publishing right in an official channel. A counsellor role alone is
 * never enough to publish; revoking keeps the record (who verified, who revoked, when) for audit.
 */
const channelPublisherSchema = new Schema(
  {
    channelId: { type: Schema.Types.ObjectId, ref: 'OfficialChannel', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    verifiedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    verifiedAt: { type: Date, default: Date.now },
    note: { type: String, default: null, maxlength: 300 },
    revokedAt: { type: Date, default: null },
    revokedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);
channelPublisherSchema.index({ channelId: 1, userId: 1 }, { unique: true });
export const ChannelPublisher = model('ChannelPublisher', channelPublisherSchema);

/** Students who follow a channel get a notification when it publishes. */
const channelFollowSchema = new Schema(
  {
    channelId: { type: Schema.Types.ObjectId, ref: 'OfficialChannel', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);
channelFollowSchema.index({ channelId: 1, userId: 1 }, { unique: true });
export const ChannelFollow = model('ChannelFollow', channelFollowSchema);

const resourceLinkSchema = new Schema({ title: { type: String, required: true }, url: { type: String, required: true } }, { _id: false });

const feedPostSchema = new Schema(
  {
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /** Snapshot taken at posting time ("Student" when the author hides their name in community spaces). */
    authorLabel: { type: String, required: true, maxlength: 140 },
    authorRole: { type: String, required: true },
    /** null = main community feed; otherwise an official channel. */
    channelId: { type: Schema.Types.ObjectId, ref: 'OfficialChannel', default: null },
    /** Official campus communication (announcement or channel post) — shown with an "Official" label. */
    official: { type: Boolean, default: false },
    category: { type: String, enum: FEED_CATEGORIES, required: true },
    topic: { type: String, enum: [...COUNSELLING_TOPICS, null], default: null },
    body: { type: String, required: true, maxlength: 2000 },
    tags: { type: [String], default: [] },
    attachmentIds: [{ type: Schema.Types.ObjectId, ref: 'Evidence' }],
    resourceLinks: { type: [resourceLinkSchema], default: [] },
    /** Text the author typed and confirmed. Never coordinates. */
    locationLabel: { type: String, default: null, maxlength: 120 },
    status: { type: String, enum: FEED_POST_STATUSES, default: 'published' },
    /** Why screening held the post (personal_info, links…) — moderators only. */
    holdFlags: { type: [String], default: [] },
    commentsEnabled: { type: Boolean, default: true },
    pinned: { type: Boolean, default: false },
    scheduledAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    moderation: {
      action: { type: String, default: null },
      reason: { type: String, default: null, maxlength: 300 },
      by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      at: { type: Date, default: null },
    },
    reactionCount: { type: Number, default: 0 },
    commentCount: { type: Number, default: 0 },
    bookmarkCount: { type: Number, default: 0 },
    viewCount: { type: Number, default: 0 },
    openReportCount: { type: Number, default: 0 },
    /** Normalised body hash for duplicate-post protection. */
    contentHash: { type: String, required: true },
    clientId: { type: String, required: true },
  },
  { timestamps: true },
);
feedPostSchema.index({ channelId: 1, status: 1, pinned: -1, publishedAt: -1, _id: -1 });
feedPostSchema.index({ channelId: 1, status: 1, category: 1, publishedAt: -1, _id: -1 });
feedPostSchema.index({ channelId: 1, status: 1, topic: 1, publishedAt: -1 });
feedPostSchema.index({ authorId: 1, createdAt: -1 });
feedPostSchema.index({ authorId: 1, clientId: 1 }, { unique: true });
feedPostSchema.index({ authorId: 1, contentHash: 1, createdAt: -1 });
feedPostSchema.index({ tags: 1, publishedAt: -1 });
feedPostSchema.index({ status: 1, scheduledAt: 1 });
feedPostSchema.index({ attachmentIds: 1 });
feedPostSchema.index({ status: 1, openReportCount: -1 });
feedPostSchema.index({ body: 'text', tags: 'text' }, { weights: { tags: 3, body: 1 }, name: 'feed_text' });
export const FeedPost = model('FeedPost', feedPostSchema);
export type FeedPostDoc = HydratedDocument<InferSchemaType<typeof feedPostSchema>>;

/** Comments and one level of replies (parentId → top-level comment). */
const feedCommentSchema = new Schema(
  {
    postId: { type: Schema.Types.ObjectId, ref: 'FeedPost', required: true },
    parentId: { type: Schema.Types.ObjectId, ref: 'FeedComment', default: null },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    authorLabel: { type: String, required: true, maxlength: 140 },
    authorRole: { type: String, required: true },
    body: { type: String, required: true, maxlength: 1000 },
    status: { type: String, enum: FEED_COMMENT_STATUSES, default: 'published' },
    holdFlags: { type: [String], default: [] },
    editedAt: { type: Date, default: null },
    moderation: {
      action: { type: String, default: null },
      reason: { type: String, default: null, maxlength: 300 },
      by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      at: { type: Date, default: null },
    },
    openReportCount: { type: Number, default: 0 },
    clientId: { type: String, required: true },
  },
  { timestamps: true },
);
feedCommentSchema.index({ postId: 1, status: 1, createdAt: 1, _id: 1 });
feedCommentSchema.index({ authorId: 1, createdAt: -1 });
feedCommentSchema.index({ authorId: 1, clientId: 1 }, { unique: true });
feedCommentSchema.index({ status: 1, openReportCount: -1 });
feedCommentSchema.index({ parentId: 1, createdAt: 1 });
export const FeedComment = model('FeedComment', feedCommentSchema);

/** One reaction per person per post — the unique index makes double-likes impossible. */
const feedReactionSchema = new Schema(
  {
    postId: { type: Schema.Types.ObjectId, ref: 'FeedPost', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: FEED_REACTIONS, default: 'like' },
  },
  { timestamps: true },
);
feedReactionSchema.index({ postId: 1, userId: 1 }, { unique: true });
feedReactionSchema.index({ userId: 1, postId: 1 });
export const FeedReaction = model('FeedReaction', feedReactionSchema);

const feedBookmarkSchema = new Schema(
  {
    postId: { type: Schema.Types.ObjectId, ref: 'FeedPost', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);
feedBookmarkSchema.index({ userId: 1, postId: 1 }, { unique: true });
feedBookmarkSchema.index({ userId: 1, createdAt: -1 });
export const FeedBookmark = model('FeedBookmark', feedBookmarkSchema);

/** Unique views, used only to show counts to the author (no list of viewers is ever exposed). */
const feedViewSchema = new Schema(
  {
    postId: { type: Schema.Types.ObjectId, ref: 'FeedPost', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
feedViewSchema.index({ postId: 1, userId: 1 }, { unique: true });
export const FeedView = model('FeedView', feedViewSchema);

const feedReportSchema = new Schema(
  {
    targetType: { type: String, enum: ['post', 'comment', 'user'], required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    /** The post the report relates to (for comments and user reports made from a post/comment). */
    postId: { type: Schema.Types.ObjectId, ref: 'FeedPost', default: null },
    /** For user reports: the reported account (never shown to the reporter). */
    reportedUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reporterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, enum: FEED_REPORT_REASONS, required: true },
    details: { type: String, default: null, maxlength: 500 },
    status: { type: String, enum: ['open', 'actioned', 'dismissed'], default: 'open' },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
feedReportSchema.index({ targetType: 1, targetId: 1, reporterId: 1 }, { unique: true });
feedReportSchema.index({ status: 1, createdAt: -1 });
feedReportSchema.index({ targetId: 1, status: 1 });
export const FeedReport = model('FeedReport', feedReportSchema);

/** An author's request to have a moderation decision looked at again (by a different moderator). */
const feedAppealSchema = new Schema(
  {
    targetType: { type: String, enum: ['post', 'comment'], required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, required: true, maxlength: 1000 },
    /** The moderator whose decision is appealed — they cannot decide the appeal themselves. */
    originalModeratorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    status: { type: String, enum: ['pending', 'upheld', 'reversed'], default: 'pending' },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
    note: { type: String, default: null, maxlength: 500 },
  },
  { timestamps: true },
);
feedAppealSchema.index({ targetType: 1, targetId: 1 }, { unique: true });
feedAppealSchema.index({ status: 1, createdAt: 1 });
export const FeedAppeal = model('FeedAppeal', feedAppealSchema);

/** Official campus events and awareness campaigns. Only organisers/administrators/verified publishers create them. */
const communityEventSchema = new Schema(
  {
    title: { type: String, required: true, maxlength: 120 },
    description: { type: String, required: true, maxlength: 2000 },
    kind: { type: String, enum: EVENT_KINDS, required: true },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    venue: { type: String, required: true, maxlength: 160 },
    organizer: { type: String, required: true, maxlength: 120 },
    capacity: { type: Number, default: null },
    channelId: { type: Schema.Types.ObjectId, ref: 'OfficialChannel', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['published', 'cancelled'], default: 'published' },
    reminderSentAt: { type: Date, default: null },
  },
  { timestamps: true },
);
communityEventSchema.index({ status: 1, startsAt: 1 });
communityEventSchema.index({ channelId: 1, startsAt: 1 });
export const CommunityEvent = model('CommunityEvent', communityEventSchema);

const eventRsvpSchema = new Schema(
  {
    eventId: { type: Schema.Types.ObjectId, ref: 'CommunityEvent', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: RSVP_STATUSES, required: true },
  },
  { timestamps: true },
);
eventRsvpSchema.index({ eventId: 1, userId: 1 }, { unique: true });
eventRsvpSchema.index({ eventId: 1, status: 1 });
export const EventRsvp = model('EventRsvp', eventRsvpSchema);
