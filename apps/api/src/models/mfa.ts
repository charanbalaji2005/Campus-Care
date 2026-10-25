import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

/**
 * Authenticator-app (TOTP) configuration, one per user. Secrets are AES-256-GCM encrypted and never
 * returned by the API after enrolment. `User.mfaEnabled` mirrors `status === 'active'` for quick checks.
 */
const totpConfigurationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['pending', 'active'], default: 'pending' },
    secretEnc: { type: String, default: null, select: false },
    /** A secret being enrolled or rotated. It only replaces `secretEnc` after a valid code is entered. */
    pendingSecretEnc: { type: String, default: null, select: false },
    pendingCreatedAt: { type: Date, default: null },
    activatedAt: { type: Date, default: null },
    rotatedAt: { type: Date, default: null },
    /** Highest 30-second time step already accepted. A code from this step or earlier is a replay. */
    lastUsedStep: { type: Number, default: 0 },
    lastUsedAt: { type: Date, default: null },
    /** Only codes in this set are valid; switching the id invalidates the previous set in one write. */
    activeRecoverySetId: { type: String, default: null },
    recoveryCodesIssuedAt: { type: Date, default: null },
    failedAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
  },
  { timestamps: true },
);
totpConfigurationSchema.index({ userId: 1 }, { unique: true });
totpConfigurationSchema.set('toJSON', {
  transform: (_doc, ret: Record<string, unknown>) => {
    delete ret.secretEnc;
    delete ret.pendingSecretEnc;
    return ret;
  },
});
export const TotpConfiguration = model('TotpConfiguration', totpConfigurationSchema);
export type TotpConfigurationDoc = HydratedDocument<InferSchemaType<typeof totpConfigurationSchema>>;

/** Single-use recovery codes. Only a keyed hash is stored; the code itself is shown once. */
const recoveryCodeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    setId: { type: String, required: true },
    codeHash: { type: String, required: true },
    usedAt: { type: Date, default: null },
    usedIpHash: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
recoveryCodeSchema.index({ codeHash: 1 }, { unique: true });
recoveryCodeSchema.index({ userId: 1, setId: 1 });
export const RecoveryCode = model('RecoveryCode', recoveryCodeSchema);

/**
 * Restricted, short-lived proof that the first factor succeeded. It can only be exchanged for a
 * session by completing the second factor — it grants no access on its own.
 */
const mfaChallengeSchema = new Schema({
  tokenHash: { type: String, required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  method: { type: String, enum: ['password', 'google'], required: true },
  client: { type: String, enum: ['web', 'android'], required: true },
  remember: { type: Boolean, default: false },
  attempts: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true },
  consumedAt: { type: Date, default: null },
  ipHash: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
});
mfaChallengeSchema.index({ tokenHash: 1 }, { unique: true });
mfaChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });
export const MfaChallenge = model('MfaChallenge', mfaChallengeSchema);
