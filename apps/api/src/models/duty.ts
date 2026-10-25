import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { DUTY_ACTORS, DUTY_SHIFT_STATUSES, DUTY_STATUSES, RESPONDER_RESPONSIBILITIES, RESPONDER_SKILLS } from '@campuscare/shared';

const positionSchema = new Schema(
  {
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    accuracyMeters: { type: Number, default: null },
    /** Server receive time minus the age the device reported — never the device clock. */
    at: { type: Date, required: true },
  },
  { _id: false },
);

/**
 * Current duty state of one responder (one document per responder). Every change goes through
 * duty.service so that the transition rules, the event log and the audit log stay consistent.
 */
const responderAvailabilitySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: DUTY_STATUSES, default: 'off_duty', required: true },
    /** What the responder was doing before their heartbeat went stale; restored by the next heartbeat. */
    statusBeforeStale: { type: String, enum: [...DUTY_STATUSES, null], default: null },
    staleSince: { type: Date, default: null },
    campus: { type: String, default: 'main' },
    zoneId: { type: Schema.Types.ObjectId, ref: 'ResponseZone', default: null },
    skills: { type: [String], enum: RESPONDER_SKILLS, default: [] },
    responsibilities: { type: [String], enum: RESPONDER_RESPONSIBILITIES, default: ['sos_response'] },
    currentShiftId: { type: Schema.Types.ObjectId, ref: 'DutyShift', default: null },
    lastHeartbeatAt: { type: Date, default: null },
    /** Only stored while on duty, when policy allows it and the responder consented. */
    location: { type: positionSchema, default: null },
    locationConsent: { type: Boolean, default: false },
    activeAssignmentCount: { type: Number, default: 0, min: 0 },
    lastAssignedAt: { type: Date, default: null },
    /** Supervisor who approved the most recent manual change. */
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    statusChangedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
responderAvailabilitySchema.index({ userId: 1 }, { unique: true });
responderAvailabilitySchema.index({ status: 1, campus: 1, lastHeartbeatAt: -1 });
export const ResponderAvailability = model('ResponderAvailability', responderAvailabilitySchema);
export type ResponderAvailabilityDoc = HydratedDocument<InferSchemaType<typeof responderAvailabilitySchema>>;

/** Append-only history of every duty change (who, what, why). */
const dutyStatusEventSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    from: { type: String, enum: DUTY_STATUSES, required: true },
    to: { type: String, enum: DUTY_STATUSES, required: true },
    actor: { type: String, enum: DUTY_ACTORS, required: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reason: { type: String, default: null, maxlength: 500 },
    shiftId: { type: Schema.Types.ObjectId, ref: 'DutyShift', default: null },
    alertId: { type: Schema.Types.ObjectId, ref: 'EmergencyAlert', default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
dutyStatusEventSchema.index({ userId: 1, createdAt: -1 });
dutyStatusEventSchema.index({ createdAt: -1 });
export const DutyStatusEvent = model('DutyStatusEvent', dutyStatusEventSchema);

/** Raw heartbeat log for diagnostics; expires automatically. Freshness is read from ResponderAvailability. */
const responderHeartbeatSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  /** Server time — the device clock is never trusted. */
  receivedAt: { type: Date, required: true },
  status: { type: String, enum: DUTY_STATUSES, required: true },
  hasLocation: { type: Boolean, default: false },
  accuracyMeters: { type: Number, default: null },
  batteryPercent: { type: Number, default: null },
  appVersion: { type: String, default: null },
});
responderHeartbeatSchema.index({ userId: 1, receivedAt: -1 });
responderHeartbeatSchema.index({ receivedAt: 1 }, { expireAfterSeconds: 14 * 86400 });
export const ResponderHeartbeat = model('ResponderHeartbeat', responderHeartbeatSchema);

const dutyShiftSchema = new Schema(
  {
    responderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    campus: { type: String, default: 'main' },
    zoneId: { type: Schema.Types.ObjectId, ref: 'ResponseZone', default: null },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    status: { type: String, enum: DUTY_SHIFT_STATUSES, default: 'offered' },
    notes: { type: String, default: null, maxlength: 500 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /** Supervisor who assigned the shift directly (instead of the responder accepting it). */
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    acceptedAt: { type: Date, default: null },
    declinedReason: { type: String, default: null },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    endReason: { type: String, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);
dutyShiftSchema.index({ responderId: 1, startAt: -1 });
dutyShiftSchema.index({ status: 1, endAt: 1 });
dutyShiftSchema.index({ startAt: 1, endAt: 1 });
export const DutyShift = model('DutyShift', dutyShiftSchema);
export type DutyShiftDoc = HydratedDocument<InferSchemaType<typeof dutyShiftSchema>>;

/** Campus response zones. Alerts inside a zone prefer responders assigned to it. */
const responseZoneSchema = new Schema(
  {
    name: { type: String, required: true },
    code: { type: String, required: true, lowercase: true },
    campus: { type: String, default: 'main' },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    radiusMeters: { type: Number, required: true, min: 25, max: 5000 },
    description: { type: String, default: '' },
    active: { type: Boolean, default: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);
responseZoneSchema.index({ code: 1 }, { unique: true });
export const ResponseZone = model('ResponseZone', responseZoneSchema);
