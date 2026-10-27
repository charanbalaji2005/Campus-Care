import { Schema, model, type InferSchemaType, type HydratedDocument, Types } from 'mongoose';
import { ACCOUNT_STATUSES, ROLES, STUDENT_VERIFICATION_STATUSES } from '@campuscare/shared';

const membershipSchema = new Schema(
  {
    committeeId: { type: Schema.Types.ObjectId, ref: 'Committee', required: true },
    position: { type: String, enum: ['chair', 'member'], default: 'member' },
    since: { type: Date, default: Date.now },
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    emailVerified: { type: Boolean, default: false },
    emailVerifiedAt: { type: Date, default: null },
    passwordHash: { type: String, default: null, select: false },
    passwordChangedAt: { type: Date, default: null },
    role: { type: String, enum: ROLES, default: 'student', required: true },
    permissions: { type: [String], default: [] },
    accountStatus: { type: String, enum: ACCOUNT_STATUSES, default: 'pending_verification' },
    suspendedReason: { type: String, default: null },
    suspendedAt: { type: Date, default: null },
    suspendedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    suspendedUntil: { type: Date, default: null },
    deactivatedAt: { type: Date, default: null },
    deactivatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    archivedAt: { type: Date, default: null },
    archivedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    studentId: { type: String, trim: true, default: null },
    department: { type: String, trim: true, default: null },
    academicYear: { type: Number, default: null },
    phone: { type: String, trim: true, default: null },
    hostel: { type: String, trim: true, default: null },
    campusZone: { type: String, trim: true, default: null },
    counsellorApproved: { type: Boolean, default: false },
    counsellorApprovedAt: { type: Date, default: null },
    counsellorApprovedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    counsellingPublishAllowed: { type: Boolean, default: false },
    communityMuted: { type: Boolean, default: false },
    communityMutedReason: { type: String, default: null },
    communityMutedUntil: { type: Date, default: null },
    responderEligible: { type: Boolean, default: false },
    dutyZone: { type: String, trim: true, default: null },
    committeeMemberships: { type: [membershipSchema], default: [] },
    mfaEnabled: { type: Boolean, default: false },
    mfaSecretEnc: { type: String, default: null, select: false },
    mfaPendingSecretEnc: { type: String, default: null, select: false },
    failedLoginCount: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    verificationStatus: { type: String, enum: STUDENT_VERIFICATION_STATUSES, default: 'pending' },
    verificationReviewedAt: { type: Date, default: null },
    verificationReviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    verificationReason: { type: String, default: null },
    verificationNotes: { type: String, default: null },
    mustChangePassword: { type: Boolean, default: false },
    staffId: { type: String, trim: true, default: null },
    managedCampuses: { type: [String], default: [] },
    counsellorCredentials: { type: String, trim: true, default: null },
    privacy: {
      showNameInCommunity: { type: Boolean, default: true },
      allowEmailNotifications: { type: Boolean, default: true },
    },
    /**
     * Digital safety card (blood group, allergies, accessibility needs…), AES-256-GCM encrypted.
     * Shown to responders only during an active SOS, and only with the student's explicit consent.
     */
    safetyCardEnc: { type: String, default: null, select: false },
    safetyCardShare: { type: Boolean, default: false },
    safetyCardUpdatedAt: { type: Date, default: null },
    /** Per-category notification channel preferences. Critical safety alerts ignore these. */
    notificationPrefs: { type: Schema.Types.Mixed, default: {} },
    /** Set when a data-deletion request is completed: the account is anonymised, case records kept per policy. */
    anonymisedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ studentId: 1 }, { unique: true, partialFilterExpression: { studentId: { $type: 'string' } } });
userSchema.index({ role: 1, accountStatus: 1 });
userSchema.index({ role: 1, verificationStatus: 1 });
userSchema.index({ staffId: 1 }, { sparse: true });
userSchema.index({ accountStatus: 1, createdAt: -1 });
userSchema.index({ department: 1 });
userSchema.index({ 'committeeMemberships.committeeId': 1 });

/** Never serialise secrets, even if a query accidentally selected them. */
userSchema.set('toJSON', {
  transform: (_doc, ret: Record<string, unknown>) => {
    delete ret.passwordHash;
    delete ret.mfaSecretEnc;
    delete ret.mfaPendingSecretEnc;
    delete ret.__v;
    return ret;
  },
});

export type UserAttrs = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<UserAttrs>;
export const User = model('User', userSchema);

export function publicUser(u: UserDoc | (UserAttrs & { _id: Types.ObjectId; createdAt?: Date; updatedAt?: Date })) {
  return {
    id: String(u._id),
    fullName: u.fullName,
    email: u.email,
    emailVerified: u.emailVerified,
    role: u.role,
    permissions: u.permissions ?? [],
    accountStatus: u.accountStatus,
    suspendedReason: u.suspendedReason ?? null,
    suspendedAt: u.suspendedAt ?? null,
    suspendedBy: u.suspendedBy ? String(u.suspendedBy) : null,
    suspendedUntil: u.suspendedUntil ?? null,
    deactivatedAt: u.deactivatedAt ?? null,
    archivedAt: u.archivedAt ?? null,
    studentId: u.studentId ?? null,
    department: u.department ?? null,
    academicYear: u.academicYear ?? null,
    phone: u.phone ?? null,
    hostel: u.hostel ?? null,
    campusZone: u.campusZone ?? null,
    counsellorApproved: Boolean(u.counsellorApproved),
    counsellorApprovedAt: u.counsellorApprovedAt ?? null,
    counsellingPublishAllowed: Boolean(u.counsellingPublishAllowed),
    communityMuted: Boolean(u.communityMuted),
    communityMutedReason: u.communityMutedReason ?? null,
    communityMutedUntil: u.communityMutedUntil ?? null,
    responderEligible: Boolean(u.responderEligible),
    dutyZone: u.dutyZone ?? null,
    mfaEnabled: u.mfaEnabled,
    committeeMemberships: (u.committeeMemberships ?? []).map((m) => ({ committeeId: String(m.committeeId), position: m.position })),
    privacy: u.privacy,
    createdAt: (u as { createdAt?: Date }).createdAt ?? null,
    lastLoginAt: u.lastLoginAt ?? null,
    verificationStatus: (u as { verificationStatus?: string }).verificationStatus ?? 'pending',
    verificationReviewedAt: (u as { verificationReviewedAt?: Date }).verificationReviewedAt ?? null,
    verificationReviewedBy: (u as { verificationReviewedBy?: Types.ObjectId | null }).verificationReviewedBy ? String((u as { verificationReviewedBy?: Types.ObjectId | null }).verificationReviewedBy) : null,
    verificationReason: (u as { verificationReason?: string }).verificationReason ?? null,
    verificationNotes: (u as { verificationNotes?: string }).verificationNotes ?? null,
    mustChangePassword: Boolean((u as { mustChangePassword?: boolean }).mustChangePassword),
    staffId: (u as { staffId?: string }).staffId ?? null,
    managedCampuses: (u as { managedCampuses?: string[] }).managedCampuses ?? [],
    counsellorCredentials: (u as { counsellorCredentials?: string }).counsellorCredentials ?? null,
  };
}

// ------------------------------------------------------------------ external identities (Google)
const externalIdentitySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    provider: { type: String, enum: ['google'], required: true },
    /** Google's stable subject identifier — never match by email alone. */
    subject: { type: String, required: true },
    email: { type: String, lowercase: true },
    linkedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
externalIdentitySchema.index({ provider: 1, subject: 1 }, { unique: true });
externalIdentitySchema.index({ userId: 1, provider: 1 }, { unique: true });
export const ExternalIdentity = model('ExternalIdentity', externalIdentitySchema);

// ------------------------------------------------------------------ sessions (opaque, revocable)
const sessionSchema = new Schema(
  {
    tokenHash: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    idleExpiresAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    reauthAt: { type: Date, default: null },
    mfaVerified: { type: Boolean, default: false },
    method: { type: String, enum: ['password', 'google'], default: 'password' },
    ipHash: { type: String, default: null },
    userAgent: { type: String, default: null, maxlength: 300 },
    client: { type: String, enum: ['web', 'android'], default: 'web' },
    deviceName: { type: String, default: null, maxlength: 120 },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: false },
);
sessionSchema.index({ tokenHash: 1 }, { unique: true });
sessionSchema.index({ userId: 1, revokedAt: 1 });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const Session = model('Session', sessionSchema);
export type SessionDoc = HydratedDocument<InferSchemaType<typeof sessionSchema>>;

// ------------------------------------------------------------------ single-use tokens (hash only)
const tokenFields = {
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  tokenHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  consumedAt: { type: Date, default: null },
};

const emailVerificationTokenSchema = new Schema({ ...tokenFields, email: { type: String, required: true } }, { timestamps: true });
emailVerificationTokenSchema.index({ tokenHash: 1 }, { unique: true });
emailVerificationTokenSchema.index({ userId: 1, createdAt: -1 });
emailVerificationTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });
export const EmailVerificationToken = model('EmailVerificationToken', emailVerificationTokenSchema);

/** `email`: the address the link was sent to. If the account email changes, the link stops working. */
const passwordResetTokenSchema = new Schema({ ...tokenFields, email: { type: String, default: null } }, { timestamps: true });
passwordResetTokenSchema.index({ tokenHash: 1 }, { unique: true });
passwordResetTokenSchema.index({ userId: 1, createdAt: -1 });
passwordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 24 * 3600 });
export const PasswordResetToken = model('PasswordResetToken', passwordResetTokenSchema);

/** Invitation tokens for staff accounts (set-password link). */
const inviteTokenSchema = new Schema({ ...tokenFields }, { timestamps: true });
inviteTokenSchema.index({ tokenHash: 1 }, { unique: true });
inviteTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });
export const InviteToken = model('InviteToken', inviteTokenSchema);

/** Trusted-contact consent tokens. */
const contactConsentTokenSchema = new Schema(
  { ...tokenFields, trustedContactId: { type: Schema.Types.ObjectId, ref: 'TrustedContact', required: true } },
  { timestamps: true },
);
contactConsentTokenSchema.index({ tokenHash: 1 }, { unique: true });
contactConsentTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });
export const ContactConsentToken = model('ContactConsentToken', contactConsentTokenSchema);
