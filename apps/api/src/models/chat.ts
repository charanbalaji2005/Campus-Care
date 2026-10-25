import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { CHAT_KINDS, CHAT_REVIEW_BASES, CHAT_REVIEW_SCOPES, CHAT_REVIEW_STATUSES } from '@campuscare/shared';

const chatChannelSchema = new Schema(
  {
    kind: { type: String, enum: CHAT_KINDS, required: true },
    name: { type: String, required: true, maxlength: 80 },
    slug: { type: String, default: null },
    description: { type: String, default: '' },
    published: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
    readOnly: { type: Boolean, default: false },
    /** support_service: which staff role answers threads opened from this service. */
    serviceRole: { type: String, enum: ['counsellor', 'security_officer', 'committee_member', null], default: null },
    committeeId: { type: Schema.Types.ObjectId, ref: 'Committee', default: null },
    /** support_thread / counselling_thread: the parent service and the student who opened it. */
    serviceId: { type: Schema.Types.ObjectId, ref: 'ChatChannel', default: null },
    studentId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    appointmentId: { type: Schema.Types.ObjectId, ref: 'Appointment', default: null },
    assignedStaffId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    moderatorIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    closed: { type: Boolean, default: false },
    lastMessageAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);
chatChannelSchema.index({ slug: 1 }, { unique: true, partialFilterExpression: { slug: { $type: 'string' } } });
chatChannelSchema.index({ kind: 1, published: 1, order: 1 });
chatChannelSchema.index({ kind: 1, studentId: 1, serviceId: 1 });
chatChannelSchema.index({ appointmentId: 1 }, { unique: true, partialFilterExpression: { appointmentId: { $type: 'objectId' } } });
export const ChatChannel = model('ChatChannel', chatChannelSchema);
export type ChatChannelDoc = HydratedDocument<InferSchemaType<typeof chatChannelSchema>>;

/** Explicit memberships for private threads (student + assigned staff) and read state. */
const chatMembershipSchema = new Schema(
  {
    channelId: { type: Schema.Types.ObjectId, ref: 'ChatChannel', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['student', 'staff', 'moderator'], default: 'student' },
    lastReadAt: { type: Date, default: new Date(0) },
    muted: { type: Boolean, default: false },
  },
  { timestamps: true },
);
chatMembershipSchema.index({ channelId: 1, userId: 1 }, { unique: true });
chatMembershipSchema.index({ userId: 1 });
export const ChatMembership = model('ChatMembership', chatMembershipSchema);

const chatMessageSchema = new Schema(
  {
    channelId: { type: Schema.Types.ObjectId, ref: 'ChatChannel', required: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    senderLabel: { type: String, required: true },
    body: { type: String, default: '', maxlength: 4000 },
    attachmentIds: [{ type: Schema.Types.ObjectId, ref: 'Evidence' }],
    clientMessageId: { type: String, required: true },
    hidden: { type: Boolean, default: false },
    hiddenReason: { type: String, default: null },
    hiddenBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);
chatMessageSchema.index({ channelId: 1, createdAt: -1 });
chatMessageSchema.index({ channelId: 1, clientMessageId: 1 }, { unique: true });
export const ChatMessage = model('ChatMessage', chatMessageSchema);

const chatReportSchema = new Schema(
  {
    messageId: { type: Schema.Types.ObjectId, ref: 'ChatMessage', required: true },
    channelId: { type: Schema.Types.ObjectId, ref: 'ChatChannel', required: true },
    reporterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, required: true, maxlength: 500 },
    status: { type: String, enum: ['open', 'actioned', 'dismissed'], default: 'open' },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);
chatReportSchema.index({ status: 1, createdAt: -1 });
chatReportSchema.index({ messageId: 1, reporterId: 1 }, { unique: true });
export const ChatReport = model('ChatReport', chatReportSchema);

const chatBlockSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    blockedUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);
chatBlockSchema.index({ userId: 1, blockedUserId: 1 }, { unique: true });
export const ChatBlock = model('ChatBlock', chatBlockSchema);

/**
 * Exceptional, time-limited permission for one administrator to read one private conversation.
 * Configuring chat never implies this. Counselling threads can never be the subject of a grant.
 */
const chatReviewGrantSchema = new Schema(
  {
    requesterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    scope: { type: String, enum: CHAT_REVIEW_SCOPES, required: true },
    /** support_thread → ChatChannel id; case_chat → Incident id. */
    targetId: { type: Schema.Types.ObjectId, required: true },
    targetLabel: { type: String, required: true },
    basis: { type: String, enum: CHAT_REVIEW_BASES, required: true },
    reason: { type: String, required: true, maxlength: 1000 },
    caseReference: { type: String, default: null, maxlength: 60 },
    status: { type: String, enum: CHAT_REVIEW_STATUSES, default: 'active' },
    expiresAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },
    endedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    endNote: { type: String, default: null, maxlength: 500 },
    accessCount: { type: Number, default: 0 },
    lastAccessedAt: { type: Date, default: null },
    exportedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
chatReviewGrantSchema.index({ requesterId: 1, status: 1, expiresAt: 1 });
chatReviewGrantSchema.index({ status: 1, createdAt: -1 });
chatReviewGrantSchema.index({ targetId: 1, createdAt: -1 });
export const ChatReviewGrant = model('ChatReviewGrant', chatReviewGrantSchema);
export type ChatReviewGrantDoc = HydratedDocument<InferSchemaType<typeof chatReviewGrantSchema>>;
