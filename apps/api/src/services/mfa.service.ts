import crypto from 'node:crypto';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { env } from '../config/env';
import { AppError } from '../lib/http';
import { decryptSecret, encryptSecret, hmac, randomToken, sha256 } from '../lib/crypto';
import { MfaChallenge, RecoveryCode, TotpConfiguration } from '../models/mfa';
import { User, type UserDoc } from '../models/user';
import { getSettings } from './settings.service';
import { sendEmail } from './email/email.service';
import { audit } from './audit.service';

/**
 * Authenticator-app MFA (RFC 6238 TOTP via otplib) and single-use recovery codes.
 *
 * - Secrets: generated with a CSPRNG, AES-256-GCM encrypted at rest, shown only during enrolment.
 * - Activation only after a valid code — displaying the QR code changes nothing.
 * - Clock drift: ±1 time step (30 s) is accepted.
 * - Replay: each 30-second step can be used once per account (compare-and-set on lastUsedStep).
 * - Recovery codes: exactly 8, CSPRNG, stored as keyed HMAC hashes, consumed atomically, never logged.
 * - Repeated failures lock second-factor checks for the account for a short period.
 */

export const RECOVERY_CODE_COUNT = 8;
const STEP_SECONDS = 30;
const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;
const CHALLENGE_TTL_MS = 5 * 60_000;
const CHALLENGE_MAX_ATTEMPTS = 5;
// No 0/o, 1/l/i: codes are read off paper.
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

authenticator.options = { window: 1, step: STEP_SECONDS };

function recoveryPepper() {
  return hmac(env.APP_ENCRYPTION_KEY, 'campuscare:recovery-code-pepper:v1');
}
export function hashRecoveryCode(code: string) {
  return hmac(recoveryPepper(), code.toLowerCase().replace(/[\s-]/g, ''));
}

export function generateRecoveryCode(): string {
  let raw = '';
  for (let i = 0; i < 10; i++) raw += RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)];
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

/** Accounts enrolled before TotpConfiguration existed keep working: their secret moves over on first use. */
async function migrateLegacy(userId: string) {
  const user = await User.findById(userId).select('+mfaSecretEnc');
  if (!user?.mfaEnabled || !user.mfaSecretEnc) return null;
  try {
    await TotpConfiguration.create({ userId, status: 'active', secretEnc: user.mfaSecretEnc, activatedAt: user.updatedAt ?? new Date() });
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err;
  }
  await User.updateOne({ _id: userId }, { $set: { mfaSecretEnc: null, mfaPendingSecretEnc: null } });
  return TotpConfiguration.findOne({ userId }).select('+secretEnc +pendingSecretEnc');
}

async function loadConfig(userId: string) {
  return (await TotpConfiguration.findOne({ userId }).select('+secretEnc +pendingSecretEnc')) ?? (await migrateLegacy(userId));
}

function assertNotLocked(cfg: { lockedUntil?: Date | null } | null) {
  if (cfg?.lockedUntil && cfg.lockedUntil.getTime() > Date.now()) {
    throw new AppError(429, 'mfa_locked', 'Too many incorrect codes. Try again in a few minutes.');
  }
}

async function recordFailure(userId: string) {
  const cfg = await TotpConfiguration.findOneAndUpdate({ userId }, { $inc: { failedAttempts: 1 } }, { new: true });
  if (cfg && cfg.failedAttempts >= MAX_FAILURES) {
    await TotpConfiguration.updateOne({ _id: cfg._id }, { $set: { lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000), failedAttempts: 0 } });
    const user = await User.findById(userId, { email: 1, fullName: 1 }).lean();
    if (user) await sendEmail('security_alert', user.email, { name: user.fullName, message: `Two-step verification was locked for ${LOCK_MINUTES} minutes after several incorrect codes. If this wasn't you, change your password now.` });
    await audit({ action: 'auth.mfa_locked', actorId: userId, targetType: 'user', targetId: userId, outcome: 'denied' });
  }
}

/** The 30-second step a valid code belongs to, or null. */
function matchStep(code: string, secret: string): number | null {
  const delta = authenticator.checkDelta(code, secret);
  if (delta === null) return null;
  return Math.floor(Date.now() / 1000 / STEP_SECONDS) + delta;
}

export async function startTotpEnrollment(user: UserDoc) {
  const s = await getSettings();
  const secret = authenticator.generateSecret(20); // 160-bit, CSPRNG
  const existing = await loadConfig(String(user._id));
  const rotating = existing?.status === 'active';
  await TotpConfiguration.findOneAndUpdate(
    { userId: user._id },
    { $set: { pendingSecretEnc: encryptSecret(secret), pendingCreatedAt: new Date(), ...(rotating ? {} : { status: 'pending' }) } },
    { upsert: true },
  );
  const otpauthUrl = authenticator.keyuri(user.email, s.platform.name, secret);
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240, errorCorrectionLevel: 'M' });
  return { otpauthUrl, qrDataUrl, manualKey: secret.match(/.{1,4}/g)!.join(' '), secret, issuer: s.platform.name, accountName: user.email, rotating };
}

/**
 * Confirms the pending secret with a code from the app. First activation returns exactly eight
 * recovery codes (shown once); a rotation keeps the existing recovery set.
 */
export async function verifyTotpEnrollment(user: UserDoc, code: string): Promise<{ rotated: boolean; recoveryCodes: string[] | null }> {
  const uid = String(user._id);
  const cfg = await loadConfig(uid);
  assertNotLocked(cfg);
  if (!cfg?.pendingSecretEnc) throw new AppError(409, 'no_pending_enrollment', 'Start the setup again — no authenticator is waiting for confirmation.');
  if (cfg.pendingCreatedAt && Date.now() - cfg.pendingCreatedAt.getTime() > 30 * 60_000) throw new AppError(410, 'enrollment_expired', 'This setup expired. Start again to get a new QR code.');
  const secret = decryptSecret(cfg.pendingSecretEnc);
  const step = matchStep(code, secret);
  if (step === null) {
    await recordFailure(uid);
    throw new AppError(422, 'validation_failed', 'That code is not valid.', { fields: { code: 'Check your authenticator app and try again' } });
  }
  const rotated = cfg.status === 'active';
  const now = new Date();
  const activated = await TotpConfiguration.findOneAndUpdate(
    { _id: cfg._id, pendingSecretEnc: cfg.pendingSecretEnc },
    {
      $set: {
        secretEnc: cfg.pendingSecretEnc, pendingSecretEnc: null, pendingCreatedAt: null, status: 'active', lastUsedStep: step, lastUsedAt: now,
        failedAttempts: 0, lockedUntil: null, ...(rotated ? { rotatedAt: now } : { activatedAt: now }),
      },
    },
    { new: true },
  );
  if (!activated) throw new AppError(409, 'conflict', 'The setup changed at the same time. Start again.');
  await User.updateOne({ _id: uid }, { $set: { mfaEnabled: true, mfaSecretEnc: null, mfaPendingSecretEnc: null } });
  const recoveryCodes = rotated && activated.activeRecoverySetId ? null : await issueRecoveryCodes(uid);
  await sendEmail('security_alert', user.email, { name: user.fullName, message: rotated ? 'Your authenticator app was changed. Codes from the old app no longer work.' : 'Two-step verification with an authenticator app is now on for your account.' });
  return { rotated, recoveryCodes };
}

/**
 * Verifies a login or step-up code. Returns false for a wrong code, a replayed code, or a
 * user without active MFA. Throws 429 while the account's second factor is locked.
 */
export async function verifyTotpForUser(userId: string, code: string): Promise<boolean> {
  const cfg = await loadConfig(userId);
  if (!cfg || cfg.status !== 'active' || !cfg.secretEnc) return false;
  assertNotLocked(cfg);
  const step = matchStep(code, decryptSecret(cfg.secretEnc));
  if (step === null) {
    await recordFailure(userId);
    return false;
  }
  // Each time step works once: a code captured in transit cannot be replayed.
  const claimed = await TotpConfiguration.updateOne({ _id: cfg._id, lastUsedStep: { $lt: step } }, { $set: { lastUsedStep: step, lastUsedAt: new Date(), failedAttempts: 0 } });
  if (!claimed.modifiedCount) {
    await audit({ action: 'auth.mfa_replay_blocked', actorId: userId, targetType: 'user', targetId: userId, outcome: 'denied' });
    return false;
  }
  return true;
}

/** Issues a new set of exactly eight codes. Switching activeRecoverySetId invalidates the old set in one write. */
export async function issueRecoveryCodes(userId: string): Promise<string[]> {
  const setId = randomToken(12);
  const codes = new Set<string>();
  while (codes.size < RECOVERY_CODE_COUNT) codes.add(generateRecoveryCode());
  const list = [...codes];
  await RecoveryCode.insertMany(list.map((c) => ({ userId, setId, codeHash: hashRecoveryCode(c) })));
  const switched = await TotpConfiguration.updateOne({ userId, status: 'active' }, { $set: { activeRecoverySetId: setId, recoveryCodesIssuedAt: new Date() } });
  if (!switched.modifiedCount) {
    await RecoveryCode.deleteMany({ userId, setId });
    throw new AppError(409, 'mfa_not_enabled', 'Turn on two-step verification first.');
  }
  await RecoveryCode.deleteMany({ userId, setId: { $ne: setId } });
  return list;
}

export async function regenerateRecoveryCodes(user: UserDoc): Promise<string[]> {
  const codes = await issueRecoveryCodes(String(user._id));
  await sendEmail('security_alert', user.email, { name: user.fullName, message: 'New recovery codes were generated for your account. Your previous recovery codes no longer work.' });
  return codes;
}

/** Consumes one unused code from the active set atomically. Returns the number left, or null if the code is not valid. */
export async function consumeRecoveryCode(userId: string, code: string, ipHash: string | null): Promise<number | null> {
  const cfg = await loadConfig(userId);
  if (!cfg || cfg.status !== 'active' || !cfg.activeRecoverySetId) return null;
  assertNotLocked(cfg);
  const used = await RecoveryCode.findOneAndUpdate(
    { userId, setId: cfg.activeRecoverySetId, codeHash: hashRecoveryCode(code), usedAt: null },
    { $set: { usedAt: new Date(), usedIpHash: ipHash } },
    { new: true },
  );
  if (!used) {
    await recordFailure(userId);
    return null;
  }
  await TotpConfiguration.updateOne({ _id: cfg._id }, { $set: { failedAttempts: 0 } });
  const remaining = await RecoveryCode.countDocuments({ userId, setId: cfg.activeRecoverySetId, usedAt: null });
  const user = await User.findById(userId, { email: 1, fullName: 1 }).lean();
  if (user) {
    await sendEmail('security_alert', user.email, {
      name: user.fullName,
      message: `A recovery code was used to sign in to your account. ${remaining} unused recovery code${remaining === 1 ? '' : 's'} left.${remaining <= 2 ? ' Generate a new set from Account security soon.' : ''} If this wasn't you, change your password now.`,
    });
  }
  return remaining;
}

export async function mfaStatus(userId: string) {
  const cfg = await loadConfig(userId);
  const active = cfg?.status === 'active';
  const remaining = active && cfg!.activeRecoverySetId ? await RecoveryCode.countDocuments({ userId, setId: cfg!.activeRecoverySetId, usedAt: null }) : 0;
  return {
    enabled: active,
    pendingEnrollment: Boolean(cfg?.pendingSecretEnc),
    activatedAt: active ? cfg!.activatedAt ?? null : null,
    rotatedAt: active ? cfg!.rotatedAt ?? null : null,
    lastUsedAt: active ? cfg!.lastUsedAt ?? null : null,
    recoveryCodesRemaining: remaining,
    recoveryCodesTotal: active && cfg!.activeRecoverySetId ? RECOVERY_CODE_COUNT : 0,
    recoveryCodesIssuedAt: active ? cfg!.recoveryCodesIssuedAt ?? null : null,
    lockedUntil: cfg?.lockedUntil && cfg.lockedUntil.getTime() > Date.now() ? cfg.lockedUntil : null,
  };
}

/** Removes the authenticator and all recovery codes. Callers enforce re-authentication and policy. */
export async function removeTotp(userId: string) {
  await TotpConfiguration.deleteOne({ userId });
  await RecoveryCode.deleteMany({ userId });
  await User.updateOne({ _id: userId }, { $set: { mfaEnabled: false, mfaSecretEnc: null, mfaPendingSecretEnc: null } });
}

// ------------------------------------------------------------------ login challenges
export async function createMfaChallenge(user: UserDoc, opts: { method: 'password' | 'google'; client: 'web' | 'android'; remember?: boolean; ipHash: string | null }) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
  await MfaChallenge.create({ tokenHash: sha256(token), userId: user._id, method: opts.method, client: opts.client, remember: Boolean(opts.remember), expiresAt, ipHash: opts.ipHash });
  return { token, expiresAt };
}

/** Loads a live challenge (not used, not expired, attempts left). */
export async function loadMfaChallenge(token: string | undefined | null) {
  if (!token || token.length > 200) return null;
  return MfaChallenge.findOne({ tokenHash: sha256(token), consumedAt: null, expiresAt: { $gt: new Date() }, attempts: { $lt: CHALLENGE_MAX_ATTEMPTS } });
}

export async function failMfaChallenge(id: unknown) {
  await MfaChallenge.updateOne({ _id: id }, { $inc: { attempts: 1 } });
}

/** Single use: exactly one caller can exchange a challenge for a session. */
export async function consumeMfaChallenge(id: unknown) {
  return MfaChallenge.findOneAndUpdate({ _id: id, consumedAt: null, expiresAt: { $gt: new Date() } }, { $set: { consumedAt: new Date() } }, { new: true });
}
