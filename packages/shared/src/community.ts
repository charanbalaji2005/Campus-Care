import { z } from 'zod';

// ------------------------------------------------------------------ community feed

export const FEED_CATEGORIES = ['campus_safety', 'announcements', 'events', 'awareness', 'academic', 'wellbeing', 'lost_found'] as const;
export type FeedCategory = (typeof FEED_CATEGORIES)[number];
export const FEED_CATEGORY_LABELS: Record<FeedCategory, string> = {
  campus_safety: 'Campus Safety',
  announcements: 'Announcements',
  events: 'Events',
  awareness: 'Awareness',
  academic: 'Academic',
  wellbeing: 'Well-being',
  lost_found: 'Lost & Found',
};
/** "Announcements" is reserved for official accounts; everyone else picks one of these. */
export const OPEN_FEED_CATEGORIES: FeedCategory[] = FEED_CATEGORIES.filter((c) => c !== 'announcements');

/** Topics used to file posts in the Official Counselling Support channel. */
export const COUNSELLING_TOPICS = ['mental_wellness', 'stress_management', 'exam_anxiety', 'relationships', 'emotional_wellbeing', 'support_resources'] as const;
export type CounsellingTopic = (typeof COUNSELLING_TOPICS)[number];
export const COUNSELLING_TOPIC_LABELS: Record<CounsellingTopic, string> = {
  mental_wellness: 'Mental wellness',
  stress_management: 'Stress management',
  exam_anxiety: 'Exam anxiety',
  relationships: 'Relationships',
  emotional_wellbeing: 'Emotional well-being',
  support_resources: 'Support resources',
};

export const COUNSELLING_CHANNEL_SLUG = 'counselling';
export const COUNSELLING_CHANNEL_NAME = 'Official Counselling Support';
export const COUNSELLING_CHANNEL_DESCRIPTION = 'Trusted mental-wellness guidance, support resources, and updates from CampusCare counsellors.';

/**
 * Post lifecycle. "pending_review" posts are visible only to their author and moderators;
 * "hidden" and "removed" are moderator decisions (hidden can be restored, both can be appealed);
 * "deleted" is the author's own soft delete.
 */
export const FEED_POST_STATUSES = ['draft', 'scheduled', 'pending_review', 'published', 'hidden', 'removed', 'deleted'] as const;
export type FeedPostStatus = (typeof FEED_POST_STATUSES)[number];
export const FEED_COMMENT_STATUSES = ['published', 'pending_review', 'hidden', 'removed', 'deleted'] as const;

export const FEED_REACTIONS = ['like', 'helpful', 'support'] as const;
export type FeedReaction = (typeof FEED_REACTIONS)[number];

export const FEED_REPORT_REASONS = ['spam', 'harassment', 'threat', 'discrimination', 'personal_info', 'misinformation', 'self_harm', 'other'] as const;
export type FeedReportReason = (typeof FEED_REPORT_REASONS)[number];
export const FEED_REPORT_REASON_LABELS: Record<FeedReportReason, string> = {
  spam: 'Spam or advertising',
  harassment: 'Harassment or bullying',
  threat: 'Threat or violence',
  discrimination: 'Hate or discrimination',
  personal_info: "Shares someone's personal information",
  misinformation: 'False or misleading safety information',
  self_harm: 'Someone may be at risk of self-harm',
  other: 'Something else',
};
/** Reports that should reach moderators straight away (and hide the content pending review sooner). */
export const URGENT_REPORT_REASONS: FeedReportReason[] = ['threat', 'self_harm', 'personal_info'];

export const MODERATION_ACTIONS = ['approve', 'hide', 'remove', 'restore', 'dismiss'] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export const EVENT_KINDS = ['workshop', 'awareness', 'campus_event', 'counselling_session'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  workshop: 'Safety workshop',
  awareness: 'Awareness campaign',
  campus_event: 'Campus event',
  counselling_session: 'Counselling session',
};
export const RSVP_STATUSES = ['going', 'interested'] as const;

/** Limits enforced on the server (the app shows the same numbers). */
export const FEED_LIMITS = {
  postMaxChars: 2000,
  commentMaxChars: 1000,
  maxTags: 5,
  maxAttachments: 4,
  attachmentMaxMb: 5,
  maxResourceLinks: 5,
  postsPer15Minutes: 5,
  postsPerDay: 20,
  commentsPer5Minutes: 15,
  reportsToAutoHide: 3,
  maxPinnedPerChannel: 3,
} as const;

// ------------------------------------------------------------------ content screening

export interface ScreeningResult {
  /** True when the text must wait for a moderator before anyone else can see it. */
  hold: boolean;
  /** Machine-readable reasons, shown to moderators (never to other students). */
  flags: ('personal_info' | 'credentials' | 'links' | 'flagged_language' | 'self_harm')[];
  /** The author should be shown crisis support resources. */
  showCrisisSupport: boolean;
}

const PHONE = /(?:\+?91[\s-]?)?(?<!\d)[6-9]\d{4}[\s-]?\d{5}(?!\d)/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const ID_NUMBER = /(?<!\d)\d{4}[\s-]?\d{4}[\s-]?\d{4}(?!\d)/; // Aadhaar-style 12-digit numbers
const CREDENTIALS = /\b(password|passcode|pin|otp)\s*(is|:|=)\s*\S+/i;
const LINK = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;
const FLAGGED = ['kill you', 'beat you up', 'you will regret', 'i will hurt', 'slut', 'whore', 'go die', 'kys', 'rape you', 'acid attack'];
const CRISIS = ['kill myself', 'suicide', 'end my life', 'self harm', 'self-harm', 'hurt myself', 'want to die', 'no reason to live'];

/**
 * Deterministic, explainable pre-publication screening. It never rejects anything by itself: text
 * that may expose personal information, credentials or threats is held for a human moderator.
 * [trusted] authors (verified official accounts) are only checked for credentials.
 */
export function screenCommunityText(text: string, opts: { trusted?: boolean } = {}): ScreeningResult {
  const t = ` ${text.toLowerCase().replace(/\s+/g, ' ')} `;
  const flags: ScreeningResult['flags'] = [];
  if (CREDENTIALS.test(text)) flags.push('credentials');
  if (!opts.trusted) {
    if (PHONE.test(text) || EMAIL.test(text) || ID_NUMBER.test(text)) flags.push('personal_info');
    if ((text.match(LINK) ?? []).length > 2) flags.push('links');
    if (FLAGGED.some((k) => t.includes(k))) flags.push('flagged_language');
  }
  const crisis = CRISIS.some((k) => t.includes(k));
  if (crisis && !opts.trusted) flags.push('self_harm');
  return { hold: flags.length > 0, flags, showCrisisSupport: crisis };
}

/** Normalises user-entered tags: "#Night Safety" -> "night-safety". Invalid tags are dropped. */
export function normaliseTag(raw: string): string | null {
  const t = raw.trim().replace(/^#+/, '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
  return t.length >= 2 && t.length <= 24 ? t : null;
}

// ------------------------------------------------------------------ request schemas

const trimmed = (max: number) => z.string().trim().max(max);
const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
const clientId = z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9-]+$/, 'Invalid request id');
const tagList = z
  .array(z.string().max(40))
  .max(FEED_LIMITS.maxTags, `Use up to ${FEED_LIMITS.maxTags} tags`)
  .default([])
  .transform((tags) => [...new Set(tags.map(normaliseTag).filter((t): t is string => Boolean(t)))]);
const resourceLink = z.object({
  title: trimmed(80).min(2, 'Give the link a title'),
  url: z.string().trim().url('Enter a valid link').max(500).refine((u) => u.startsWith('https://'), 'Links must start with https://'),
});

export const feedPostCreateSchema = z.object({
  body: trimmed(FEED_LIMITS.postMaxChars).min(3, 'Write at least 3 characters'),
  category: z.enum(FEED_CATEGORIES, { errorMap: () => ({ message: 'Choose a category' }) }),
  tags: tagList,
  attachmentIds: z.array(objectId).max(FEED_LIMITS.maxAttachments, `Attach up to ${FEED_LIMITS.maxAttachments} images`).default([]),
  /** Free text the author typed and confirmed (e.g. "Library walkway"). GPS coordinates are never accepted. */
  locationLabel: trimmed(120).nullish(),
  /** Ask to publish as an official campus communication (requires the announcements permission). */
  official: z.boolean().default(false),
  clientId,
});
export type FeedPostCreateInput = z.infer<typeof feedPostCreateSchema>;

export const feedPostUpdateSchema = z.object({
  body: trimmed(FEED_LIMITS.postMaxChars).min(3, 'Write at least 3 characters').optional(),
  category: z.enum(FEED_CATEGORIES).optional(),
  tags: tagList.optional(),
  locationLabel: trimmed(120).nullish(),
  pinned: z.boolean().optional(),
});

/** Official Counselling Support posts: drafts, scheduling, topics and trusted resource links. */
export const channelPostCreateSchema = z.object({
  body: trimmed(FEED_LIMITS.postMaxChars).min(3, 'Write at least 3 characters'),
  topic: z.enum(COUNSELLING_TOPICS, { errorMap: () => ({ message: 'Choose a topic' }) }),
  tags: tagList,
  attachmentIds: z.array(objectId).max(FEED_LIMITS.maxAttachments).default([]),
  resourceLinks: z.array(resourceLink).max(FEED_LIMITS.maxResourceLinks).default([]),
  status: z.enum(['draft', 'published', 'scheduled']).default('published'),
  scheduledAt: z.coerce.date().nullish(),
  commentsEnabled: z.boolean().default(true),
  pinned: z.boolean().default(false),
  clientId,
});
export const channelPostUpdateSchema = z.object({
  body: trimmed(FEED_LIMITS.postMaxChars).min(3).optional(),
  topic: z.enum(COUNSELLING_TOPICS).optional(),
  tags: tagList.optional(),
  resourceLinks: z.array(resourceLink).max(FEED_LIMITS.maxResourceLinks).optional(),
  status: z.enum(['draft', 'published', 'scheduled']).optional(),
  scheduledAt: z.coerce.date().nullish(),
  commentsEnabled: z.boolean().optional(),
  pinned: z.boolean().optional(),
});

export const feedCommentSchema = z.object({
  body: trimmed(FEED_LIMITS.commentMaxChars).min(1, 'Write a comment'),
  parentId: objectId.nullish(),
  clientId,
});
export const feedCommentUpdateSchema = z.object({ body: trimmed(FEED_LIMITS.commentMaxChars).min(1, 'Write a comment') });

export const feedReactionSchema = z.object({ kind: z.enum(FEED_REACTIONS).default('like') });

export const feedReportSchema = z.object({
  /** "user" reports the author of the post or comment given in targetId (see `via`). */
  targetType: z.enum(['post', 'comment', 'user']),
  targetId: objectId,
  via: z.enum(['post', 'comment']).optional(),
  reason: z.enum(FEED_REPORT_REASONS, { errorMap: () => ({ message: 'Choose a reason' }) }),
  details: trimmed(500).nullish(),
});

export const feedModerationSchema = z.object({
  action: z.enum(MODERATION_ACTIONS),
  reason: trimmed(300).nullish(),
});

export const feedAppealSchema = z.object({ reason: trimmed(1000).min(10, 'Explain why in at least 10 characters') });
export const feedAppealDecisionSchema = z.object({ decision: z.enum(['upheld', 'reversed']), note: trimmed(500).nullish() });

export const communityEventSchema = z
  .object({
    title: trimmed(120).min(3, 'Add a title'),
    description: trimmed(2000).min(10, 'Describe the event'),
    kind: z.enum(EVENT_KINDS),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    venue: trimmed(160).min(2, 'Where is it?'),
    organizer: trimmed(120).min(2, 'Who is organising it?'),
    capacity: z.coerce.number().int().min(1).max(10000).nullish(),
    /** "counselling" files the event in the Official Counselling Support channel. */
    channel: z.enum([COUNSELLING_CHANNEL_SLUG]).nullish(),
  })
  .refine((e) => e.endsAt > e.startsAt, { message: 'The event must end after it starts', path: ['endsAt'] });

export const rsvpSchema = z.object({ status: z.enum(['going', 'interested', 'none']) });

export const counsellingConversationSchema = z.object({ counsellorId: objectId });
export const channelPublisherSchema = z.object({ userId: objectId, note: trimmed(300).nullish() });
