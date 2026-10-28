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
  },
  { timestamps: true },
);
availabilitySchema.index({ counsellorId: 1 }, { unique: true });
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
