import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { APPOINTMENT_MODES, APPOINTMENT_STATUSES } from '@campuscare/shared';

const availabilitySchema = new Schema(
  {
    counsellorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    weekly: [{ weekday: Number, start: String, end: String, _id: false }],
    slotMinutes: { type: Number, default: 50 },
    timezone: { type: String, default: 'Asia/Kolkata' },
    blockedDates: { type: [String], default: [] },
    acceptingRequests: { type: Boolean, default: true },
    title: { type: String, default: 'Counsellor' },
    bio: { type: String, default: '' },
  },
  { timestamps: true },
);
availabilitySchema.index({ counsellorId: 1 }, { unique: true });
export const Availability = model('Availability', availabilitySchema);

const appointmentSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    counsellorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    mode: { type: String, enum: APPOINTMENT_MODES, default: 'in_person' },
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
  },
  { timestamps: true },
);
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
