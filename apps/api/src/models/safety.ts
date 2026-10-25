import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { ALERT_SEVERITIES, SAFE_WALK_STATUSES, SOS_STATUSES } from '@campuscare/shared';

const geoFields = {
  latitude: { type: Number, default: null },
  longitude: { type: Number, default: null },
  accuracyMeters: { type: Number, default: null },
};

const emergencyAlertSchema = new Schema(
  {
    alertNumber: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    idempotencyKey: { type: String, required: true },
    status: { type: String, enum: SOS_STATUSES, default: 'queued' },
    ...geoFields,
    locationUnavailableReason: { type: String, default: null },
    note: { type: String, default: null, maxlength: 300 },
    acknowledgedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    acknowledgedAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    cancelledAt: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    deliveryAttempts: { type: Number, default: 0 },
    lastDeliveryError: { type: String, default: null },
    /** Responder who owns the response (set on acknowledgement, can be reassigned). */
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    enRouteAt: { type: Date, default: null },
    /** 0 = primary responders, 1 = backup recipients notified, 2 = administrators notified. */
    escalationLevel: { type: Number, default: 0 },
    escalatedAt: { type: Date, default: null },
    resolutionOutcome: { type: String, enum: ['assisted', 'false_alarm', 'referred', 'unable_to_locate', 'other', null], default: null },
    /** Append-only response timeline (who did what, when). Notes are visible to responders only. */
    events: [
      {
        type: { type: String, required: true },
        at: { type: Date, default: Date.now },
        actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        actorLabel: { type: String, default: null },
        note: { type: String, default: null, maxlength: 1000 },
        studentVisible: { type: Boolean, default: true },
        _id: false,
      },
    ],
  },
  { timestamps: true },
);
emergencyAlertSchema.index({ idempotencyKey: 1 }, { unique: true });
emergencyAlertSchema.index({ alertNumber: 1 }, { unique: true });
emergencyAlertSchema.index({ status: 1, createdAt: -1 });
emergencyAlertSchema.index({ userId: 1, createdAt: -1 });
export const EmergencyAlert = model('EmergencyAlert', emergencyAlertSchema);
export type EmergencyAlertDoc = HydratedDocument<InferSchemaType<typeof emergencyAlertSchema>>;

const emergencyRecipientSchema = new Schema(
  {
    name: { type: String, required: true },
    type: { type: String, enum: ['user', 'email'], required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    email: { type: String, default: null, lowercase: true },
    /** primary = notified immediately; backup = notified when nobody acknowledges in time. */
    tier: { type: String, enum: ['primary', 'backup'], default: 'primary' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
export const EmergencyRecipient = model('EmergencyRecipient', emergencyRecipientSchema);

const alertDeliveryEventSchema = new Schema(
  {
    alertId: { type: Schema.Types.ObjectId, ref: 'EmergencyAlert', required: true },
    channel: { type: String, enum: ['in_app', 'realtime', 'email', 'sms'], required: true },
    recipient: { type: String, required: true },
    outcome: { type: String, enum: ['delivered', 'accepted', 'failed', 'not_configured'], required: true },
    error: { type: String, default: null },
  },
  { timestamps: true },
);
alertDeliveryEventSchema.index({ alertId: 1, createdAt: 1 });
export const AlertDeliveryEvent = model('AlertDeliveryEvent', alertDeliveryEventSchema);

const trustedContactSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    email: { type: String, required: true, lowercase: true },
    phone: { type: String, default: null },
    relationship: { type: String, default: null },
    shareLocation: { type: Boolean, default: false },
    /** Contacts must accept by email before they are ever notified. */
    status: { type: String, enum: ['pending', 'verified', 'declined', 'revoked'], default: 'pending' },
    verifiedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
trustedContactSchema.index({ userId: 1, email: 1 }, { unique: true });
export const TrustedContact = model('TrustedContact', trustedContactSchema);

const safeWalkSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    destination: { type: String, required: true },
    expectedArrivalAt: { type: Date, required: true },
    trustedContactIds: [{ type: Schema.Types.ObjectId, ref: 'TrustedContact' }],
    status: { type: String, enum: SAFE_WALK_STATUSES, default: 'active' },
    locationShareId: { type: Schema.Types.ObjectId, ref: 'LocationShare', default: null },
    checkIns: [{ at: Date, note: String, _id: false }],
    arrivedAt: { type: Date, default: null },
    escalatedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
safeWalkSchema.index({ status: 1, expectedArrivalAt: 1 });
safeWalkSchema.index({ userId: 1, createdAt: -1 });
export const SafeWalkSession = model('SafeWalkSession', safeWalkSchema);

const locationShareSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    audience: { type: String, enum: ['security', 'trusted_contacts'], required: true },
    ...geoFields,
    startedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    stoppedAt: { type: Date, default: null },
    /** Removed automatically after the retention period. */
    purgeAt: { type: Date, required: true },
  },
  { timestamps: true },
);
locationShareSchema.index({ userId: 1, stoppedAt: 1 });
locationShareSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });
export const LocationShare = model('LocationShare', locationShareSchema);

const campusAlertSchema = new Schema(
  {
    title: { type: String, required: true },
    body: { type: String, required: true },
    severity: { type: String, enum: ALERT_SEVERITIES, default: 'info' },
    audience: {
      all: { type: Boolean, default: true },
      hostels: { type: [String], default: [] },
      departments: { type: [String], default: [] },
    },
    requestCheckIn: { type: Boolean, default: false },
    expiresAt: { type: Date, default: null },
    publishedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);
campusAlertSchema.index({ createdAt: -1 });
export const CampusAlert = model('CampusAlert', campusAlertSchema);

const safetyCheckInSchema = new Schema(
  {
    alertId: { type: Schema.Types.ObjectId, ref: 'CampusAlert', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['safe', 'need_help'], required: true },
    note: { type: String, default: null, maxlength: 300 },
  },
  { timestamps: true },
);
safetyCheckInSchema.index({ alertId: 1, userId: 1 }, { unique: true });
export const SafetyCheckIn = model('SafetyCheckIn', safetyCheckInSchema);
