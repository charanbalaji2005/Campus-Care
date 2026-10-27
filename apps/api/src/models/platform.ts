import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

// ------------------------------------------------------------------ approved email domains
const emailDomainSchema = new Schema(
  {
    domain: { type: String, required: true, lowercase: true, trim: true },
    purpose: { type: String, enum: ['students', 'staff', 'both'], default: 'both' },
    status: { type: String, enum: ['pending_verification', 'active', 'disabled'], default: 'pending_verification' },
    /** Publish as TXT record "campuscare-verification=<token>" to prove ownership. */
    verificationToken: { type: String, required: true },
    verifiedAt: { type: Date, default: null },
    lastCheckedAt: { type: Date, default: null },
    note: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);
emailDomainSchema.index({ domain: 1 }, { unique: true });
export const EmailDomain = model('EmailDomain', emailDomainSchema);

// ------------------------------------------------------------------ outbound email
const emailProviderConfigSchema = new Schema(
  {
    type: { type: String, enum: ['console', 'nodemailer'], required: true },
    /** Nodemailer well-known service, e.g. "gmail". */
    service: { type: String, default: 'gmail' },
    fromName: { type: String, required: true },
    fromEmail: { type: String, required: true },
    authUser: { type: String, default: null },
    /** App password, AES-256-GCM encrypted; never returned by the API. */
    authPassEnc: { type: String, default: null, select: false },
    active: { type: Boolean, default: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);
export const EmailProviderConfig = model('EmailProviderConfig', emailProviderConfigSchema);

const emailTemplateSchema = new Schema(
  {
    key: { type: String, required: true },
    subject: { type: String, required: true },
    html: { type: String, required: true },
    text: { type: String, required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);
emailTemplateSchema.index({ key: 1 }, { unique: true });
export const EmailTemplate = model('EmailTemplate', emailTemplateSchema);

/** Delivery log. Stores the template key and masked recipient — never the rendered body (it may contain links with tokens). */
const emailDeliverySchema = new Schema(
  {
    template: { type: String, required: true },
    to: { type: String, required: true },
    toMasked: { type: String, required: true },
    status: { type: String, enum: ['queued', 'sent', 'failed'], default: 'queued' },
    provider: { type: String, default: null },
    providerMessageId: { type: String, default: null },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },
    sentAt: { type: Date, default: null },
    dedupeKey: { type: String, default: null },
  },
  { timestamps: true },
);
emailDeliverySchema.index({ createdAt: -1 });
emailDeliverySchema.index({ dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } });
export const EmailDelivery = model('EmailDelivery', emailDeliverySchema);

// ------------------------------------------------------------------ inbound email
const inboundEmailEventSchema = new Schema(
  {
    provider: { type: String, required: true },
    messageId: { type: String, required: true },
    from: { type: String, required: true },
    to: { type: String, required: true },
    subject: { type: String, default: '' },
    outcome: { type: String, enum: ['case_created', 'reply_linked', 'quarantined', 'rejected'], required: true },
    reason: { type: String, default: null },
    incidentId: { type: Schema.Types.ObjectId, ref: 'Incident', default: null },
    attachmentCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);
inboundEmailEventSchema.index({ provider: 1, messageId: 1 }, { unique: true });
inboundEmailEventSchema.index({ createdAt: -1 });
export const InboundEmailEvent = model('InboundEmailEvent', inboundEmailEventSchema);

// ------------------------------------------------------------------ identity providers
const identityProviderSchema = new Schema(
  {
    provider: { type: String, enum: ['google'], required: true },
    enabled: { type: Boolean, default: false },
    clientId: { type: String, default: null },
    clientSecretEnc: { type: String, default: null, select: false },
    allowedDomains: { type: [String], default: [] },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);
identityProviderSchema.index({ provider: 1 }, { unique: true });
export const IdentityProviderConfig = model('IdentityProviderConfig', identityProviderSchema);

// ------------------------------------------------------------------ settings
const systemSettingSchema = new Schema(
  {
    key: { type: String, required: true },
    value: { type: Schema.Types.Mixed, required: true },
    version: { type: Number, default: 1 },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);
systemSettingSchema.index({ key: 1 }, { unique: true });
export const SystemSetting = model('SystemSetting', systemSettingSchema);

// ------------------------------------------------------------------ audit log (append-only, hash chained)
const auditLogSchema = new Schema(
  {
    seq: { type: Number, required: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    actorRole: { type: String, default: null },
    actorName: { type: String, default: null },
    actorType: { type: String, enum: ['user', 'admin', 'system', 'job', 'database_direct'], default: 'user' },
    action: { type: String, required: true },
    collectionName: { type: String, default: null },
    operation: { type: String, enum: ['insert', 'update', 'delete', 'restore', 'read', 'export', 'auth', 'system'], default: 'update' },
    targetType: { type: String, default: null },
    targetId: { type: String, default: null },
    outcome: { type: String, enum: ['success', 'denied', 'failure'], default: 'success' },
    severity: { type: String, enum: ['info', 'warn', 'critical'], default: 'info' },
    source: { type: String, enum: ['app', 'change_stream', 'security', 'job', 'migration'], default: 'app' },
    correlated: { type: Boolean, default: true },
    changedFields: [{ type: String }],
    diff: [
      {
        path: { type: String },
        prev: { type: Schema.Types.Mixed },
        next: { type: Schema.Types.Mixed },
      },
    ],
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    ipHash: { type: String, default: null },
    userAgent: { type: String, default: null },
    /** Redacted metadata only — no message bodies, passwords, tokens or secrets. */
    meta: { type: Schema.Types.Mixed, default: {} },
    /** Justification recorded by the actor, where the action requires one (overrides, private reviews). */
    reason: { type: String, default: null, maxlength: 1000 },
    /** Request id (X-Request-Id) linking this entry to the API request and server logs. */
    correlationId: { type: String, default: null },
    /** Hash format: 1 = original fields; 2 also covers reason and correlationId. */
    hv: { type: Number, default: 2 },
    prevHash: { type: String, required: true },
    hash: { type: String, required: true },
    at: { type: Date, required: true },
  },
  { timestamps: false },
);
auditLogSchema.index({ seq: 1 }, { unique: true });
auditLogSchema.index({ at: -1 });
auditLogSchema.index({ actorId: 1, at: -1 });
auditLogSchema.index({ action: 1, at: -1 });
auditLogSchema.index({ targetType: 1, targetId: 1 });
auditLogSchema.index({ targetId: 1, at: -1 });
auditLogSchema.index({ collectionName: 1, at: -1 });
auditLogSchema.index({ operation: 1, at: -1 });
auditLogSchema.index({ severity: 1, at: -1 });
auditLogSchema.index({ source: 1, at: -1 });
auditLogSchema.index({ correlationId: 1 }, { sparse: true });
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
  auditLogSchema.pre(op, function blockMutation(next) {
    if ((this as unknown as { getOptions?: () => Record<string, unknown> }).getOptions?.().allowAuditRetention) return next();
    next(new Error('Audit log entries are append-only'));
  });
}
// Documents cannot be edited in place either (save() on an existing entry).
auditLogSchema.pre('save', function blockEdit(next) {
  if (!this.isNew) return next(new Error('Audit log entries are append-only'));
  next();
});
export const AuditLog = model('AuditLog', auditLogSchema);

// ------------------------------------------------------------------ background jobs
const jobSchema = new Schema(
  {
    type: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ['pending', 'running', 'done', 'failed'], default: 'pending' },
    runAt: { type: Date, default: Date.now },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    lockedUntil: { type: Date, default: null },
    lastError: { type: String, default: null },
    dedupeKey: { type: String, default: null },
  },
  { timestamps: true },
);
jobSchema.index({ status: 1, runAt: 1 });
jobSchema.index({ dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } });
jobSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600, partialFilterExpression: { status: 'done' } });
export const Job = model('Job', jobSchema);
export type JobDoc = HydratedDocument<InferSchemaType<typeof jobSchema>>;

/** Short-lived realtime tickets (Socket.IO handshake auth for cross-origin deployments). */
const realtimeTicketSchema = new Schema({
  tokenHash: { type: String, required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  sessionId: { type: Schema.Types.ObjectId, ref: 'Session', required: true },
  expiresAt: { type: Date, required: true },
});
realtimeTicketSchema.index({ tokenHash: 1 }, { unique: true });
realtimeTicketSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const RealtimeTicket = model('RealtimeTicket', realtimeTicketSchema);
