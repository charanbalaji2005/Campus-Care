import { Schema, model } from 'mongoose';
import { CONTACT_CATEGORIES } from '@campuscare/shared';

/** In-app notifications. Text must never contain complaint details or counselling content. */
const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, required: true },
    title: { type: String, required: true, maxlength: 140 },
    body: { type: String, required: true, maxlength: 400 },
    link: { type: String, default: null },
    priority: { type: String, enum: ['critical', 'high', 'normal', 'low'], default: 'normal' },
    category: { type: String, default: null },
    pushedAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
);
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, readAt: 1 });
export const Notification = model('Notification', notificationSchema);

const announcementSchema = new Schema(
  {
    title: { type: String, required: true },
    body: { type: String, required: true },
    pinned: { type: Boolean, default: false },
    published: { type: Boolean, default: true },
    kind: { type: String, enum: ['notice', 'event'], default: 'notice' },
    eventAt: { type: Date, default: null },
    venue: { type: String, default: null },
    safetyContact: { type: String, default: null },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);
announcementSchema.index({ published: 1, pinned: -1, createdAt: -1 });
export const Announcement = model('Announcement', announcementSchema);

const trainingModuleSchema = new Schema(
  {
    title: { type: String, required: true },
    category: { type: String, required: true },
    summary: { type: String, default: '' },
    durationMinutes: { type: Number, default: 10 },
    sections: [{ heading: String, body: String, _id: false }],
    quiz: [{ question: String, options: [String], correctIndex: Number, _id: false }],
    passPercent: { type: Number, default: 70 },
    published: { type: Boolean, default: false },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);
export const TrainingModule = model('TrainingModule', trainingModuleSchema);

const trainingProgressSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    moduleId: { type: Schema.Types.ObjectId, ref: 'TrainingModule', required: true },
    bestScore: { type: Number, default: 0 },
    attempts: { type: Number, default: 0 },
    completedAt: { type: Date, default: null },
    /** Random, unguessable certificate number issued when the module is passed. */
    certificateId: { type: String, default: null },
  },
  { timestamps: true },
);
trainingProgressSchema.index({ userId: 1, moduleId: 1 }, { unique: true });
trainingProgressSchema.index({ certificateId: 1 }, { unique: true, partialFilterExpression: { certificateId: { $type: 'string' } } });
export const TrainingProgress = model('TrainingProgress', trainingProgressSchema);

const contactSchema = new Schema(
  {
    name: { type: String, required: true },
    purpose: { type: String, default: '' },
    category: { type: String, enum: CONTACT_CATEGORIES, required: true },
    phone: { type: String, default: null },
    email: { type: String, default: null },
    location: { type: String, default: null },
    hours: { type: String, default: null },
    /** Only verified contacts show call/email actions to students. */
    verified: { type: Boolean, default: false },
    emergency: { type: Boolean, default: false },
    order: { type: Number, default: 100 },
  },
  { timestamps: true },
);
contactSchema.index({ category: 1, order: 1 });
export const Contact = model('Contact', contactSchema);
