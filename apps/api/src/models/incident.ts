import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { COMMITTEE_TYPES, INCIDENT_CATEGORIES, INCIDENT_STATUSES, PRIORITIES, SEVERITIES } from '@campuscare/shared';

// ------------------------------------------------------------------ atomic counters (case numbers)
const counterSchema = new Schema({ _id: { type: String, required: true }, seq: { type: Number, default: 0 } });
export const Counter = model('Counter', counterSchema);

export async function nextSequence(key: string): Promise<number> {
  const doc = await Counter.findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return doc!.seq;
}

// ------------------------------------------------------------------ committees
const committeeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: COMMITTEE_TYPES, required: true },
    mandate: { type: String, default: '' },
    contactEmail: { type: String, default: null },
    contactPhone: { type: String, default: null },
    categories: { type: [String], enum: INCIDENT_CATEGORIES, default: [] },
    /** Confidential committees (e.g. ICC): case content is limited to members and the assigned handler. */
    confidential: { type: Boolean, default: false },
    slaAcknowledgeHours: { type: Number, default: 24 },
    slaResolveDays: { type: Number, default: 30 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
committeeSchema.index({ name: 1 }, { unique: true });
export const Committee = model('Committee', committeeSchema);
export type CommitteeDoc = HydratedDocument<InferSchemaType<typeof committeeSchema>>;

// ------------------------------------------------------------------ routing rules (Super Admin)
const routingRuleSchema = new Schema(
  {
    category: { type: String, enum: INCIDENT_CATEGORIES, required: true },
    committeeId: { type: Schema.Types.ObjectId, ref: 'Committee', required: true },
    defaultPriority: { type: String, enum: PRIORITIES, default: 'normal' },
    escalateAfterHours: { type: Number, default: 48 },
    escalateToCommitteeId: { type: Schema.Types.ObjectId, ref: 'Committee', default: null },
  },
  { timestamps: true },
);
routingRuleSchema.index({ category: 1 }, { unique: true });
export const RoutingRule = model('RoutingRule', routingRuleSchema);

// ------------------------------------------------------------------ incidents
const incidentSchema = new Schema(
  {
    caseNumber: { type: String, required: true },
    category: { type: String, enum: INCIDENT_CATEGORIES, required: true },
    title: { type: String, required: true, maxlength: 140 },
    description: { type: String, required: true, maxlength: 5000 },
    incidentDate: { type: Date, required: true },
    location: { type: String, required: true, maxlength: 200 },
    involvedParties: { type: String, default: null, maxlength: 1000 },
    severity: { type: String, enum: SEVERITIES, default: 'medium' },
    priority: { type: String, enum: PRIORITIES, default: 'normal' },
    urgent: { type: Boolean, default: false },
    preferredContact: { type: String, enum: ['in_app', 'email', 'phone'], default: 'in_app' },
    /** Null for anonymous reports. */
    reporterId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    /** HMAC(userId) for anonymous reports so only the reporter can find and follow the case. */
    reporterTag: { type: String, default: null, select: false },
    anonymous: { type: Boolean, default: false },
    source: { type: String, enum: ['app', 'email'], default: 'app' },
    committeeId: { type: Schema.Types.ObjectId, ref: 'Committee', default: null },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    status: { type: String, enum: INCIDENT_STATUSES, default: 'submitted' },
    evidenceIds: [{ type: Schema.Types.ObjectId, ref: 'Evidence' }],
    acknowledgedAt: { type: Date, default: null },
    dueAcknowledgeAt: { type: Date, default: null },
    dueResolveAt: { type: Date, default: null },
    escalatedAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    resolutionSummary: { type: String, default: null, maxlength: 2000 },
    closureReason: { type: String, default: null, maxlength: 500 },
    idempotencyKey: { type: String, required: true },
    lastStudentVisibleUpdateAt: { type: Date, default: Date.now },
    messageCount: { type: Number, default: 0 },
    lastMessageAt: { type: Date, default: null },
    /** Optional pin. Only ever used in aggregate (k-anonymous) heatmaps — never displayed per case. */
    latitude: { type: Number, default: null, select: false },
    longitude: { type: Number, default: null, select: false },
    /** What the automated helper suggested, kept to review its accuracy; the student's choice is `category`. */
    suggestedCategory: { type: String, enum: [...INCIDENT_CATEGORIES, null], default: null },
    withdrawnAt: { type: Date, default: null },
    reopenedAt: { type: Date, default: null },
    reopenCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);
incidentSchema.index({ caseNumber: 1 }, { unique: true });
incidentSchema.index({ idempotencyKey: 1 }, { unique: true });
incidentSchema.index({ reporterId: 1, createdAt: -1 });
incidentSchema.index({ reporterTag: 1, createdAt: -1 });
incidentSchema.index({ committeeId: 1, status: 1, createdAt: -1 });
incidentSchema.index({ assignedTo: 1, status: 1 });
incidentSchema.index({ status: 1, dueAcknowledgeAt: 1 });
export const Incident = model('Incident', incidentSchema);
export type IncidentAttrs = InferSchemaType<typeof incidentSchema>;
export type IncidentDoc = HydratedDocument<IncidentAttrs>;

// ------------------------------------------------------------------ case activity (status history, notes, assignments)
const caseActivitySchema = new Schema(
  {
    incidentId: { type: Schema.Types.ObjectId, ref: 'Incident', required: true },
    type: {
      type: String,
      enum: ['created', 'status_changed', 'assigned', 'escalated', 'internal_note', 'student_update', 'evidence_added', 'evidence_accessed', 'priority_changed'],
      required: true,
    },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    actorRole: { type: String, default: null },
    fromStatus: { type: String, default: null },
    toStatus: { type: String, default: null },
    /** Visible to the reporting student? Internal notes are never visible. */
    studentVisible: { type: Boolean, default: false },
    body: { type: String, default: null, maxlength: 4000 },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);
caseActivitySchema.index({ incidentId: 1, createdAt: 1 });
export const CaseActivity = model('CaseActivity', caseActivitySchema);

// ------------------------------------------------------------------ complaint-specific chat
const caseMessageSchema = new Schema(
  {
    caseId: { type: Schema.Types.ObjectId, ref: 'Incident', required: true },
    /** Null when the sender is an anonymous reporter. */
    senderId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    senderKind: { type: String, enum: ['reporter', 'staff', 'system'], required: true },
    senderLabel: { type: String, required: true },
    messageType: { type: String, enum: ['text', 'attachment', 'system'], default: 'text' },
    body: { type: String, default: '', maxlength: 4000 },
    attachmentIds: [{ type: Schema.Types.ObjectId, ref: 'Evidence' }],
    clientMessageId: { type: String, required: true },
    readBy: [{ userKey: String, at: Date }],
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
caseMessageSchema.index({ caseId: 1, createdAt: -1 });
caseMessageSchema.index({ caseId: 1, clientMessageId: 1 }, { unique: true });
export const CaseMessage = model('CaseMessage', caseMessageSchema);

/** Per-participant read state for unread counts. userKey = user id, or "reporter" for anonymous reporters. */
const caseReadStateSchema = new Schema({
  caseId: { type: Schema.Types.ObjectId, ref: 'Incident', required: true },
  userKey: { type: String, required: true },
  lastReadAt: { type: Date, default: new Date(0) },
});
caseReadStateSchema.index({ caseId: 1, userKey: 1 }, { unique: true });
export const CaseReadState = model('CaseReadState', caseReadStateSchema);

// ------------------------------------------------------------------ private files (evidence and chat media)
const evidenceSchema = new Schema(
  {
    purpose: { type: String, enum: ['evidence', 'case_chat', 'chat', 'lost_found', 'feed'], required: true },
    uploaderId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    uploaderTag: { type: String, default: null, select: false },
    incidentId: { type: Schema.Types.ObjectId, ref: 'Incident', default: null },
    channelId: { type: Schema.Types.ObjectId, ref: 'ChatChannel', default: null },
    /** Bound to a message/case after the sender attaches it; unbound uploads are cleaned up. */
    bound: { type: Boolean, default: false },
    storageKey: { type: String, required: true, select: false },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    sha256: { type: String, required: true },
    scanStatus: { type: String, enum: ['not_scanned', 'pending', 'clean', 'infected'], default: 'not_scanned' },
  },
  { timestamps: true },
);
evidenceSchema.index({ incidentId: 1 });
evidenceSchema.index({ channelId: 1 });
evidenceSchema.index({ bound: 1, createdAt: 1 });
export const Evidence = model('Evidence', evidenceSchema);
export type EvidenceDoc = HydratedDocument<InferSchemaType<typeof evidenceSchema>>;
