import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { ALERT_ASSIGNMENT_STATES, ALERT_SEVERITIES, ASSIGNMENT_STATUSES, DISPATCH_POLICIES, SAFE_WALK_STATUSES, SOS_STATUSES } from '@campuscare/shared';

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
    /** Server-side countdown: the alert is dispatched at this time unless cancelled first. */
    dispatchAt: { type: Date, default: null },
    /** Set exactly once, atomically, when the alert leaves "pending". Cancellations after this never delete the alert. */
    dispatchedAt: { type: Date, default: null },
    countdownMode: { type: String, enum: ['client', 'server'], default: 'client' },
    /** in_app, quick_tile, shortcut, notification or recovery (what started the countdown). */
    triggerSource: { type: String, default: null },
    /** The student's choice, applied when a server-side countdown dispatches the alert. */
    notifyTrustedContacts: { type: Boolean, default: true },
    locationAgeSeconds: { type: Number, default: null },
    /** When the current coordinates were captured (server clock: receive time − device-reported age). */
    locationAt: { type: Date, default: null },
    /** Server-computed quality of the current coordinates (never the client's label). */
    locationQuality: { type: String, default: null },
    locationSource: { type: String, default: null },
    locationUpdateCount: { type: Number, default: 0 },
    lastLocationReceivedAt: { type: Date, default: null },
    /** Highest client sequence number accepted, for duplicate/out-of-order protection. */
    lastLocationSeq: { type: Number, default: null },
    campus: { type: String, default: 'main' },
    zoneId: { type: Schema.Types.ObjectId, ref: 'ResponseZone', default: null },
    assignmentState: { type: String, enum: ALERT_ASSIGNMENT_STATES, default: 'none' },
    assignmentAttempts: { type: Number, default: 0 },
    lastAssignmentAttemptAt: { type: Date, default: null },
    /** When dispatch first found nobody eligible. Cleared once someone is assigned. */
    unassignedSince: { type: Date, default: null },
    batteryLevel: { type: Number, default: null },
    deviceInfo: {
      appVersion: { type: String, default: null },
      osVersion: { type: String, default: null },
      model: { type: String, default: null },
    },
    isCachedFix: { type: Boolean, default: false },
    evidence: [
      {
        evidenceId: { type: Schema.Types.ObjectId, ref: 'Evidence' },
        kind: { type: String, enum: ['image', 'audio', 'video'] },
        filename: { type: String },
        mimeType: { type: String },
        size: { type: Number },
        capturedAt: { type: Date, default: Date.now },
      },
    ],
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
emergencyAlertSchema.index({ status: 1, dispatchAt: 1 });
emergencyAlertSchema.index({ assignmentState: 1, status: 1 });
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

/**
 * One row per delivery attempt. "accepted"/"sent" mean a channel or provider took the message —
 * that is NOT a human acknowledgement, which lives on AlertAssignment.
 */
const alertDeliveryEventSchema = new Schema(
  {
    alertId: { type: Schema.Types.ObjectId, ref: 'EmergencyAlert', required: true },
    assignmentId: { type: Schema.Types.ObjectId, ref: 'AlertAssignment', default: null },
    channel: { type: String, enum: ['in_app', 'realtime', 'push', 'email', 'sms'], required: true },
    recipient: { type: String, required: true },
    outcome: { type: String, enum: ['queued', 'sent', 'delivered', 'accepted', 'failed', 'not_configured'], required: true },
    attempt: { type: Number, default: 1 },
    error: { type: String, default: null },
  },
  { timestamps: true },
);
alertDeliveryEventSchema.index({ alertId: 1, createdAt: 1 });
alertDeliveryEventSchema.index({ outcome: 1, createdAt: -1 });
export const AlertDeliveryEvent = model('AlertDeliveryEvent', alertDeliveryEventSchema);

/**
 * A responder's assignment to an SOS. Duplicate or conflicting assignments are prevented by the
 * database, not by timing: `open` is set only while offered/acknowledged, and two partial unique
 * indexes allow at most one open assignment per (alert, slot) and per (alert, responder).
 */
const alertAssignmentSchema = new Schema(
  {
    alertId: { type: Schema.Types.ObjectId, ref: 'EmergencyAlert', required: true },
    responderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ASSIGNMENT_STATUSES, default: 'offered' },
    open: { type: Boolean, default: undefined },
    /** single policy: always 0. group policy: 0..groupSize-1. */
    slot: { type: Number, required: true },
    attempt: { type: Number, required: true },
    policy: { type: String, enum: DISPATCH_POLICIES, default: 'single' },
    /** null = chosen by the dispatch algorithm. */
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    assignReason: { type: String, default: null, maxlength: 500 },
    rankExplanation: { type: String, default: null, maxlength: 500 },
    offeredAt: { type: Date, default: Date.now },
    ackDeadlineAt: { type: Date, required: true },
    acknowledgedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    closeReason: { type: String, default: null, maxlength: 500 },
  },
  { timestamps: true },
);
alertAssignmentSchema.index({ alertId: 1, slot: 1 }, { unique: true, partialFilterExpression: { open: true } });
alertAssignmentSchema.index({ alertId: 1, responderId: 1 }, { unique: true, partialFilterExpression: { open: true } });
alertAssignmentSchema.index({ status: 1, ackDeadlineAt: 1 });
alertAssignmentSchema.index({ responderId: 1, createdAt: -1 });
alertAssignmentSchema.index({ alertId: 1, createdAt: 1 });
export const AlertAssignment = model('AlertAssignment', alertAssignmentSchema);
export type AlertAssignmentDoc = HydratedDocument<InferSchemaType<typeof alertAssignmentSchema>>;

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
    /** When the current coordinates were fixed: server receive time minus the age the device reported. */
    locationAt: { type: Date, default: null },
    locationQuality: { type: String, default: null },
    locationSource: { type: String, default: null },
    lastLocationSeq: { type: Number, default: null },
    updateCount: { type: Number, default: 0 },
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
locationShareSchema.index({ audience: 1, stoppedAt: 1, expiresAt: 1 });
export const LocationShare = model('LocationShare', locationShareSchema);

/**
 * Time-ordered location history for an SOS response or a live share. Raw measured coordinates only
 * (never map-matched), with the reported accuracy and the server-computed quality. Readable only by
 * people authorised for that session, every read audited; removed automatically at purgeAt.
 */
const locationPointSchema = new Schema(
  {
    subjectType: { type: String, enum: ['sos', 'share'], required: true },
    subjectId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    accuracyMeters: { type: Number, default: null },
    /** Capture time on the server clock (receive time − device-reported age). */
    capturedAt: { type: Date, required: true },
    receivedAt: { type: Date, required: true },
    ageSecondsAtReceipt: { type: Number, default: null },
    quality: { type: String, required: true },
    clientQuality: { type: String, default: null },
    source: { type: String, default: 'unknown' },
    speedMps: { type: Number, default: null },
    headingDeg: { type: Number, default: null },
    altitudeMeters: { type: Number, default: null },
    clientSeq: { type: Number, default: null },
    /** Arrived after a newer point: kept for the record but not used as the current position. */
    outOfOrder: { type: Boolean, default: false },
    purgeAt: { type: Date, required: true },
  },
  { timestamps: false },
);
locationPointSchema.index({ subjectType: 1, subjectId: 1, capturedAt: 1 });
locationPointSchema.index({ subjectType: 1, subjectId: 1, clientSeq: 1 });
locationPointSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });
export const LocationPoint = model('LocationPoint', locationPointSchema);

/**
 * Who looked at whose location. Kept apart from the general audit log so a student's privacy
 * dashboard and an investigator can answer "who saw where I was" directly.
 */
const locationAccessAuditSchema = new Schema(
  {
    viewerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    viewerRole: { type: String, required: true },
    /** live_map = map markers (no identity); detail = a single record opened in the details panel. */
    access: { type: String, enum: ['live_map', 'detail', 'responder_list'], required: true },
    subjectType: { type: String, enum: ['location_share', 'sos', 'responder'], required: true },
    subjectId: { type: Schema.Types.ObjectId, required: true },
    subjectUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    correlationId: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
locationAccessAuditSchema.index({ subjectUserId: 1, createdAt: -1 });
locationAccessAuditSchema.index({ viewerId: 1, createdAt: -1 });
locationAccessAuditSchema.index({ createdAt: 1 }, { expireAfterSeconds: 400 * 86400 });
export const LocationAccessAudit = model('LocationAccessAudit', locationAccessAuditSchema);

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
