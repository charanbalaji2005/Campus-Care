import { Schema, model } from 'mongoose';
import { FEEDBACK_CATEGORIES, FEEDBACK_REPORT_REASONS, FEEDBACK_STATUSES, PUBLIC_COMMENT_STATES, REMINDER_KINDS } from '@campuscare/shared';

/**
 * Anonymous counselling feedback. Identity is kept apart from content:
 *  - FeedbackReceipt says "this appointment already has feedback" (duplicate protection) and holds
 *    no rating or text;
 *  - CounsellingFeedback holds the content and, only when the student chose to be named, their id.
 * Nothing links the two except for timing, so receipts store the calendar day only and feedback
 * timestamps are never shown to counsellors.
 */
const feedbackReceiptSchema = new Schema({
  appointmentId: { type: Schema.Types.ObjectId, ref: 'Appointment', required: true },
  studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  submittedOn: { type: String, required: true }, // YYYY-MM-DD only
});
feedbackReceiptSchema.index({ appointmentId: 1 }, { unique: true });
feedbackReceiptSchema.index({ studentId: 1 });
export const FeedbackReceipt = model('FeedbackReceipt', feedbackReceiptSchema);

const counsellingFeedbackSchema = new Schema(
  {
    counsellorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    anonymous: { type: Boolean, default: true },
    /** Only set when the student chose to be identified. */
    studentId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    rating: { type: Number, min: 1, max: 5, default: null },
    categories: { type: [String], enum: FEEDBACK_CATEGORIES, default: [] },
    comment: { type: String, default: null, maxlength: 2000 },
    /** A reportable concern (conduct, safety, privacy): routed to authorised staff, never to the counsellor. */
    concern: { type: Boolean, default: false },
    /** Month of the session, coarse on purpose. */
    sessionMonth: { type: String, required: true },
    status: { type: String, enum: FEEDBACK_STATUSES, default: 'new' },
    moderationNote: { type: String, default: null, maxlength: 1000 },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    /**
     * Pseudonymous rater: HMAC(server pepper, counsellor + student). Lets public thresholds count distinct
     * students without storing who they are; it cannot be reversed without the server's key.
     */
    raterKey: { type: String, default: null },
    /** Moderator removed this item from every public aggregate and comment list. */
    hiddenFromPublic: { type: Boolean, default: false },
    /** The student opted in to an anonymised public comment. */
    sharePublicly: { type: Boolean, default: false },
    publicComment: { type: String, enum: PUBLIC_COMMENT_STATES, default: 'none' },
    /** Masked, shortened text shown publicly once approved. Never the original comment. */
    publicText: { type: String, default: null, maxlength: 600 },
    reportCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);
counsellingFeedbackSchema.index({ counsellorId: 1, createdAt: -1 });
counsellingFeedbackSchema.index({ status: 1, concern: -1, createdAt: -1 });
counsellingFeedbackSchema.index({ counsellorId: 1, concern: 1, hiddenFromPublic: 1 });
counsellingFeedbackSchema.index({ publicComment: 1, createdAt: -1 });
export const CounsellingFeedback = model('CounsellingFeedback', counsellingFeedbackSchema);

/** A viewer's report of a public comment. One per person per comment; the comment is withdrawn until reviewed. */
const feedbackReportSchema = new Schema(
  {
    feedbackId: { type: Schema.Types.ObjectId, ref: 'CounsellingFeedback', required: true },
    reporterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, enum: FEEDBACK_REPORT_REASONS, required: true },
    note: { type: String, default: null, maxlength: 300 },
  },
  { timestamps: true },
);
feedbackReportSchema.index({ feedbackId: 1, reporterId: 1 }, { unique: true });
feedbackReportSchema.index({ reporterId: 1, createdAt: -1 });
export const FeedbackReport = model('FeedbackReport', feedbackReportSchema);

/** Stored reminders, sent by a periodic sweep so they survive restarts. */
const counsellingReminderSchema = new Schema(
  {
    appointmentId: { type: Schema.Types.ObjectId, ref: 'Appointment', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: REMINDER_KINDS, required: true },
    dueAt: { type: Date, required: true },
    /** Private to the creator (counsellor task notes). Never put in the notification text. */
    note: { type: String, default: null, maxlength: 500 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    status: { type: String, enum: ['pending', 'sending', 'sent', 'cancelled'], default: 'pending' },
    sentAt: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
    /** Prevents the same automatic reminder being scheduled twice. */
    dedupeKey: { type: String, default: null },
  },
  { timestamps: true },
);
counsellingReminderSchema.index({ status: 1, dueAt: 1 });
counsellingReminderSchema.index({ appointmentId: 1, status: 1 });
counsellingReminderSchema.index({ dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } });
export const CounsellingReminder = model('CounsellingReminder', counsellingReminderSchema);
