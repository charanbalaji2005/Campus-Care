import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { APPOINTMENT_MODES, APPOINTMENT_STATUSES } from '@campuscare/shared';

const availabilitySchema = new Schema(
  {
    counsellorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    weekly: [{ weekday: Number, start: String, end: String, _id: false }],
    slotMinutes: { type: Number, default: 50 },
    /** Most appointments bookable on one local day. Default 10; 0 (older clients) is treated as 10. */
    maxDailySessions: { type: Number, default: 10, min: 0, max: 24 },
    timezone: { type: String, default: 'Asia/Kolkata' },
    blockedDates: { type: [String], default: [] },
    acceptingRequests: { type: Boolean, default: true },
    title: { type: String, default: 'Counsellor' },
    bio: { type: String, default: '' },
    specializations: {
      type: [String],
      default: ['general', 'academic_stress', 'anxiety_mental_health', 'career', 'relationships', 'grief_loss'],
      index: true,
    },
    languages: { type: [String], default: ['English', 'Telugu', 'Hindi'] },
    supportedModes: { type: [String], default: ['in_person', 'online', 'phone'] },
    campus: { type: String, default: 'main', index: true },
    avatarUrl: { type: String, default: null },
    /** When the counsellor last switched On/Off Duty (`acceptingRequests`). */
    dutyChangedAt: { type: Date, default: null },
    /** Recurring breaks; weekday null = every working day. */
    breaks: [{ weekday: { type: Number, default: null }, start: String, end: String, _id: false }],
    /** Custom hours (or closed) for specific dates, replacing the weekly pattern on that day. */
    dateOverrides: [{ date: String, closed: { type: Boolean, default: false }, windows: [{ start: String, end: String, _id: false }], _id: false }],
    // ---- public directory (Super Admin controls listing and photo; credentials need approval)
    /** Shown in the student directory and bookable by students. Only a Super Admin changes it. */
    listed: { type: Boolean, default: true },
    listingReason: { type: String, default: null, maxlength: 500 },
    photoVisible: { type: Boolean, default: true },
    /** Approved credentials: the only ones students see. */
    qualifications: { type: [String], default: [] },
    yearsExperience: { type: Number, default: null, min: 0, max: 60 },
    credentialsApprovedAt: { type: Date, default: null },
    credentialsApprovedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    /** Credentials the counsellor submitted, waiting for a Super Admin. */
    pendingCredentials: {
      type: new Schema({ qualifications: { type: [String], default: [] }, yearsExperience: { type: Number, default: null }, submittedAt: { type: Date, default: null } }, { _id: false }),
      default: null,
    },
    profileUpdatedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
availabilitySchema.index({ counsellorId: 1 }, { unique: true });
availabilitySchema.index({ 'pendingCredentials.submittedAt': 1 }, { partialFilterExpression: { 'pendingCredentials.submittedAt': { $type: 'date' } } });
export const Availability = model('Availability', availabilitySchema);

const appointmentSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    counsellorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
    mode: { type: String, enum: APPOINTMENT_MODES, default: 'in_person' },
    counsellingType: { type: String, default: 'general', index: true },
    status: { type: String, enum: APPOINTMENT_STATUSES, default: 'requested' },
    reason: { type: String, default: null, maxlength: 500 },
    statusReason: { type: String, default: null, maxlength: 500 },
    meetingLink: { type: String, default: null },
    /** "<counsellorId>:<startISO>" while active — a unique index prevents double booking. */
    slotLock: { type: String, default: null },
    idempotencyKey: { type: String, required: true },
    reminderSentAt: { type: Date, default: null },
    followUpAt: { type: Date, default: null },
    threadId: { type: Schema.Types.ObjectId, ref: 'ChatChannel', default: null },
    /** One-hour response policy for requests that need the counsellor's acceptance. */
    assignedAt: { type: Date, default: null },
    responseDueAt: { type: Date, default: null },
    respondedAt: { type: Date, default: null },
    responseOverdueAt: { type: Date, default: null },
    /** Student consent to move the request to another counsellor if this one declines or does not respond. */
    allowReassignment: { type: Boolean, default: true },
    declinedBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    timedOutBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    reassignCount: { type: Number, default: 0 },
    /** Private chat opens only when the assigned counsellor accepts. */
    chatActivatedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
appointmentSchema.index({ status: 1, responseDueAt: 1 });
appointmentSchema.index({ counsellorId: 1, status: 1, startAt: 1 });
appointmentSchema.index({ slotLock: 1 }, { unique: true, partialFilterExpression: { slotLock: { $type: 'string' } } });
appointmentSchema.index({ idempotencyKey: 1 }, { unique: true });
appointmentSchema.index({ counsellorId: 1, startAt: 1 });
appointmentSchema.index({ studentId: 1, startAt: -1 });
export const Appointment = model('Appointment', appointmentSchema);
export type AppointmentDoc = HydratedDocument<InferSchemaType<typeof appointmentSchema>>;

/** Stored separately from incidents. Only the authoring/assigned counsellor (or an explicit grant) can read. */
const counsellingNoteSchema = new Schema(
  {
    appointmentId: { type: Schema.Types.ObjectId, ref: 'Appointment', required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    counsellorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, maxlength: 10000 },
    supportPlan: { type: String, default: null, maxlength: 2000 },
    followUpAt: { type: Date, default: null },
  },
  { timestamps: true },
);
counsellingNoteSchema.index({ appointmentId: 1, createdAt: 1 });
counsellingNoteSchema.index({ counsellorId: 1, studentId: 1 });
export const CounsellingNote = model('CounsellingNote', counsellingNoteSchema);

/** Case management separate from general incident reports */
const counsellingCaseSchema = new Schema(
  {
    caseNumber: { type: String, required: true, unique: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    counsellorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: ['active', 'follow_up', 'closed'], default: 'active', index: true },
    priority: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
    concern: { type: String, required: true },
    tags: { type: [String], default: [] },
    keyObservations: { type: [String], default: [] },
    supportPlan: { type: [String], default: [] },
    reviewDate: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    closedReason: { type: String, default: null },
    referrals: [
      {
        team: { type: String, required: true },
        reason: { type: String, required: true },
        referredAt: { type: Date, default: Date.now },
        status: { type: String, enum: ['pending', 'accepted', 'completed'], default: 'pending' },
        _id: false,
      },
    ],
    timeline: [
      {
        action: { type: String, required: true },
        note: { type: String, default: '' },
        actorId: { type: Schema.Types.ObjectId, ref: 'User' },
        actorName: { type: String, default: 'Counsellor' },
        at: { type: Date, default: Date.now },
        _id: false,
      },
    ],
    escalation: {
      incidentId: { type: Schema.Types.ObjectId, ref: 'Incident', default: null },
      incidentRef: { type: String, default: null },
      urgencyLevel: { type: String, default: null },
      escalatedAt: { type: Date, default: null },
      notes: { type: String, default: null },
    },
  },
  { timestamps: true },
);
counsellingCaseSchema.index({ counsellorId: 1, status: 1 });
counsellingCaseSchema.index({ studentId: 1 });
export const CounsellingCase = model('CounsellingCase', counsellingCaseSchema);
export type CounsellingCaseDoc = HydratedDocument<InferSchemaType<typeof counsellingCaseSchema>>;

/** Searchable Resources Library for student wellbeing and guidance */
const counsellingResourceSchema = new Schema(
  {
    title: { type: String, required: true },
    category: {
      type: String,
      enum: ['all', 'mental_health', 'academic', 'career', 'mindfulness', 'healthy_habits', 'campus_support'],
      required: true,
      index: true,
    },
    type: { type: String, enum: ['article', 'video', 'pdf', 'exercise', 'guide'], required: true },
    readTime: { type: String, default: '5 min read' },
    fileSize: { type: String, default: null },
    summary: { type: String, required: true },
    content: { type: String, default: '' },
    url: { type: String, default: '' },
    tags: { type: [String], default: [] },
    bookmarkedBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    published: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);
counsellingResourceSchema.index({ category: 1, published: 1 });
export const CounsellingResource = model('CounsellingResource', counsellingResourceSchema);
export type CounsellingResourceDoc = HydratedDocument<InferSchemaType<typeof counsellingResourceSchema>>;

