import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import {
  SUPPORT_CATEGORIES,
  SUPPORT_STATUSES,
  SUPPORT_PRIORITIES,
  FAQ_STATUSES,
  type SupportCategory,
  type SupportStatus,
  type SupportPriority,
  type FaqStatus,
} from '@campuscare/shared';
import { Counter } from './incident';

export async function nextSupportTicketNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const counter = await Counter.findOneAndUpdate(
    { _id: `support_ticket_${year}` },
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  );
  return `SUP-${year}-${String(counter!.seq).padStart(6, '0')}`;
}

// ------------------------------------------------------------------ Support Ticket Message
const supportMessageSchema = new Schema(
  {
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    senderRole: { type: String, required: true },
    senderName: { type: String, required: true },
    message: { type: String, required: true, trim: true },
    attachments: { type: [String], default: [] },
    /** Internal notes are strictly staff-only and MUST NEVER be leaked to student endpoints */
    isInternal: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// ------------------------------------------------------------------ Status History Entry
const statusHistorySchema = new Schema(
  {
    status: { type: String, enum: SUPPORT_STATUSES, required: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    actorRole: { type: String, required: true },
    actorName: { type: String, required: true },
    reason: { type: String, default: '' },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false },
);

// ------------------------------------------------------------------ Support Ticket
const supportTicketSchema = new Schema(
  {
    ticketNumber: { type: String, required: true, unique: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    subject: { type: String, required: true, trim: true },
    category: { type: String, enum: SUPPORT_CATEGORIES, required: true, index: true },
    description: { type: String, required: true, trim: true },
    attachments: { type: [String], default: [] },
    preferredChannel: { type: String, enum: ['in_app', 'email'], default: 'in_app' },
    status: { type: String, enum: SUPPORT_STATUSES, default: 'new', index: true },
    priority: { type: String, enum: SUPPORT_PRIORITIES, default: 'normal', index: true },
    campus: { type: String, default: 'main', index: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    assignedAt: { type: Date, default: null },
    firstResponseAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    messages: { type: [supportMessageSchema], default: [] },
    statusHistory: { type: [statusHistorySchema], default: [] },
    feedback: {
      helpful: { type: Boolean },
      comment: { type: String, default: '' },
      submittedAt: { type: Date },
    },
    publishedAsFaqId: { type: Schema.Types.ObjectId, ref: 'FaqArticle', default: null },
  },
  { timestamps: true },
);

supportTicketSchema.index({ studentId: 1, createdAt: -1 });
supportTicketSchema.index({ status: 1, createdAt: -1 });
supportTicketSchema.index({ category: 1, status: 1 });
supportTicketSchema.index({ assignedTo: 1, status: 1 });
supportTicketSchema.index({ campus: 1, status: 1 });

export const SupportTicket = model('SupportTicket', supportTicketSchema);
export type SupportTicketDoc = HydratedDocument<InferSchemaType<typeof supportTicketSchema>>;

// ------------------------------------------------------------------ FAQ Article Version History
const faqVersionSchema = new Schema(
  {
    version: { type: Number, required: true },
    title: { type: String, required: true },
    summary: { type: String, required: true },
    content: { type: String, required: true },
    modifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    modifiedByName: { type: String },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false },
);

// ------------------------------------------------------------------ FAQ Knowledge Base Article
const faqArticleSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    category: { type: String, enum: SUPPORT_CATEGORIES, required: true, index: true },
    summary: { type: String, required: true, trim: true },
    content: { type: String, required: true },
    instructions: { type: [String], default: [] },
    status: { type: String, enum: FAQ_STATUSES, default: 'published', index: true },
    helpfulCount: { type: Number, default: 0 },
    unhelpfulCount: { type: Number, default: 0 },
    views: { type: Number, default: 0 },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    authorName: { type: String, default: 'CampusCare Support Team' },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewerName: { type: String, default: null },
    sourceTicketId: { type: Schema.Types.ObjectId, ref: 'SupportTicket', default: null },
    version: { type: Number, default: 1 },
    versionHistory: { type: [faqVersionSchema], default: [] },
  },
  { timestamps: true },
);

faqArticleSchema.index({ slug: 1 }, { unique: true });
faqArticleSchema.index({ status: 1, category: 1 });
faqArticleSchema.index({ title: 'text', summary: 'text', content: 'text' });

export const FaqArticle = model('FaqArticle', faqArticleSchema);
export type FaqArticleDoc = HydratedDocument<InferSchemaType<typeof faqArticleSchema>>;
