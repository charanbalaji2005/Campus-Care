import type { Request, Response } from 'express';
import { env } from '../config/env';
import { hmac, randomToken, sha256 } from '../lib/crypto';
import {
  EmailVerificationToken, PasswordResetToken, Session, User, type SessionDoc, type UserDoc,
} from '../models/user';
import { isAllowedAccountEmail, ACCOUNT_EMAIL_DOMAIN } from '@campuscare/shared';
import { EmailDomain } from '../models/platform';
import { getSettings } from './settings.service';
import { appLink, sendEmail } from './email/email.service';
import { disconnectUser } from '../realtime/socket';
import { DeviceRegistration } from '../models/mobile';
import { MfaChallenge } from '../models/mfa';
import { startTotpEnrollment, verifyTotpEnrollment, verifyTotpForUser } from './mfa.service';

export const SESSION_COOKIE = 'cc_session';
/** Header the Android app sends on every request. Browsers cannot send it cross-site without a CORS preflight. */
export const MOBILE_CLIENT_HEADER = 'x-campuscare-client';
export const CSRF_COOKIE = 'cc_csrf';
const VERIFY_TTL_MS = env.EMAIL_VERIFICATION_TTL_HOURS * 3600 * 1000;
const RESET_TTL_MS = env.PASSWORD_RESET_TTL_MINUTES * 60 * 1000;


function cookieBase() {
  return { secure: env.COOKIE_SECURE, sameSite: 'lax' as const, path: '/', domain: env.COOKIE_DOMAIN || undefined };
}

export function setCsrfCookie(res: Response, token = randomToken(24)) {
  res.cookie(CSRF_COOKIE, token, { ...cookieBase(), httpOnly: false, maxAge: 30 * 24 * 3600 * 1000 });
  return token;
}

// ------------------------------------------------------------------ sessions
export async function createSession(
  req: Request,
  res: Response,
  user: UserDoc,
  opts: { remember?: boolean; method: 'password' | 'google'; mfaVerified: boolean },
): Promise<SessionDoc & { plainToken?: string }> {
  const s = await getSettings();
  const token = randomToken(32);
  const now = Date.now();
  const mobile = Boolean(req.isMobileClient);
  // Students on the mobile app stay signed in for the "remember me" period; staff keep the standard limits.
  const longLived = (opts.remember || mobile) && user.role === 'student';
  const absoluteMs = longLived ? s.security.rememberMeDays * 86400_000 : s.security.sessionAbsoluteHours * 3600_000;
  const idleMs = mobile && longLived ? absoluteMs : s.security.sessionIdleMinutes * 60_000;
  const knownDevice = await isKnownDevice(String(user._id), req);
  const session = await Session.create({
    tokenHash: sha256(token),
    userId: user._id,
    idleExpiresAt: new Date(now + idleMs),
    expiresAt: new Date(now + absoluteMs),
    method: opts.method,
    mfaVerified: opts.mfaVerified,
    reauthAt: new Date(),
    ipHash: req.ip ? hmac(env.SESSION_SECRET, `ip:${req.ip}`).slice(0, 32) : null,
    userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
    client: mobile ? 'android' : 'web',
    deviceName: mobile ? String(req.headers['x-device-name'] ?? '').slice(0, 120) || null : null,
  });
  if (mobile) {
    // The app keeps the token in Android Keystore-backed storage and sends it as a bearer token.
    (session as SessionDoc & { plainToken?: string }).plainToken = token;
  } else {
    res.cookie(SESSION_COOKIE, token, { ...cookieBase(), httpOnly: true, expires: session.expiresAt });
    setCsrfCookie(res); // rotate CSRF token on login (prevents fixation)
  }
  if (!knownDevice && user.lastLoginAt) {
    // Suspicious-login alert: first sign-in from this device/network in 90 days.
    await sendEmail('security_alert', user.email, {
      name: user.fullName,
      message: `New sign-in to your account from ${mobile ? 'the CampusCare app' : 'a web browser'}${session.deviceName ? ` (${session.deviceName})` : ''} at ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}. If this wasn't you, reset your password and sign out other sessions.`,
    }, `newdevice:${session._id}`);
  }
  user.lastLoginAt = new Date();
  user.failedLoginCount = 0;
  user.lockedUntil = null;
  await user.save();
  return session;
}

async function isKnownDevice(userId: string, req: Request) {
  const ipHash = req.ip ? hmac(env.SESSION_SECRET, `ip:${req.ip}`).slice(0, 32) : null;
  const ua = String(req.headers['user-agent'] ?? '').slice(0, 300);
  const since = new Date(Date.now() - 90 * 86400_000);
  return Boolean(await Session.exists({ userId, createdAt: { $gt: since }, $or: [{ userAgent: ua }, ...(ipHash ? [{ ipHash }] : [])] }));
}

export async function resolveSession(token: string | undefined): Promise<{ session: SessionDoc; user: UserDoc } | null> {
  if (!token || token.length > 200) return null;
  const now = new Date();
  const session = await Session.findOne({ tokenHash: sha256(token), revokedAt: null, expiresAt: { $gt: now }, idleExpiresAt: { $gt: now } });
  if (!session) return null;
  const user = await User.findById(session.userId);
  if (!user || ['suspended', 'deactivated', 'archived'].includes(user.accountStatus)) {
    session.revokedAt = now;
    await session.save();
    return null;
  }
  if (user.passwordChangedAt && user.passwordChangedAt > session.createdAt) {
    session.revokedAt = now;
    await session.save();
    return null;
  }
  // Sliding idle expiry, written at most once a minute.
  if (now.getTime() - session.lastSeenAt.getTime() > 60_000) {
    const s = await getSettings();
    session.lastSeenAt = now;
    session.idleExpiresAt = new Date(Math.min(now.getTime() + s.security.sessionIdleMinutes * 60_000, session.expiresAt.getTime()));
    await session.save();
  }
  return { session, user };
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(SESSION_COOKIE, { ...cookieBase(), httpOnly: true });
}

export async function revokeSession(session: SessionDoc) {
  session.revokedAt = new Date();
  await session.save();
  await DeviceRegistration.deleteMany({ sessionId: session._id }); // no more pushes to a signed-out device
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string) {
  await Session.updateMany({ userId, revokedAt: null, ...(exceptSessionId ? { _id: { $ne: exceptSessionId } } : {}) }, { $set: { revokedAt: new Date() } });
  await DeviceRegistration.deleteMany({ userId, ...(exceptSessionId ? { sessionId: { $ne: exceptSessionId } } : {}) });
  if (!exceptSessionId) await disconnectUser(userId);
}

// ------------------------------------------------------------------ domain policy
export function emailDomain(email: string) {
  return email.split('@')[1]?.toLowerCase() ?? '';
}

/**
 * Server-side domain policy — the client-supplied address is never trusted.
 * 1. Hard rule: every account must be an @srmap.edu.in address.
 * 2. The Super Admin can additionally pause that domain for students or staff
 *    (Approved domains → disable / change purpose) without a code change.
 */
export async function isDomainAllowed(email: string, audience: 'students' | 'staff'): Promise<boolean> {
  if (!isAllowedAccountEmail(email)) return false;
  const s = await getSettings();
  if (!s.registration.restrictToApprovedDomains) return true;
  const record = await EmailDomain.findOne({ domain: ACCOUNT_EMAIL_DOMAIN }).lean();
  if (!record) return true; // not configured yet: the hard rule above still applies
  return record.status === 'active' && (record.purpose === 'both' || record.purpose === audience);
}

// ------------------------------------------------------------------ account emails: per-account limits
/** Minimum gap between two verification (or two reset) emails for the same account. Per-IP limits live in middleware/security.ts. */
export const ACCOUNT_EMAIL_COOLDOWN_SECONDS = 60;
const ACCOUNT_EMAIL_MAX_PER_HOUR = 5;

/** What happened to a request for an account email. Never shown to the caller (responses stay generic). */
export type AccountEmailOutcome = 'queued' | 'throttled' | 'not_eligible';

async function accountEmailThrottled(kind: 'verify' | 'reset', userId: unknown): Promise<boolean> {
  const filter = { userId, createdAt: { $gt: new Date(Date.now() - 3600_000) } };
  const recent = kind === 'verify'
    ? await EmailVerificationToken.find(filter).sort({ createdAt: -1 }).limit(ACCOUNT_EMAIL_MAX_PER_HOUR).select('createdAt').lean()
    : await PasswordResetToken.find(filter).sort({ createdAt: -1 }).limit(ACCOUNT_EMAIL_MAX_PER_HOUR).select('createdAt').lean();
  if (recent.length >= ACCOUNT_EMAIL_MAX_PER_HOUR) return true;
  const last = recent[0]?.createdAt as Date | undefined;
  return Boolean(last && Date.now() - last.getTime() < ACCOUNT_EMAIL_COOLDOWN_SECONDS * 1000);
}

// ------------------------------------------------------------------ email verification
/**
 * Issues a fresh single-use verification link (only its SHA-256 hash is stored) and supersedes older ones.
 * The link carries the token only: no email address or other personal data in the URL.
 */
export async function issueEmailVerification(user: UserDoc) {
  await EmailVerificationToken.updateMany({ userId: user._id, consumedAt: null }, { $set: { consumedAt: new Date() } });
  const token = randomToken(32);
  await EmailVerificationToken.create({ userId: user._id, email: user.email, tokenHash: sha256(token), expiresAt: new Date(Date.now() + VERIFY_TTL_MS) });
  await sendEmail('verify_email', user.email, {
    name: user.fullName,
    link: appLink(`/verify-email?token=${encodeURIComponent(token)}`),
    expiresIn: `${env.EMAIL_VERIFICATION_TTL_HOURS} hours`,
  });
}

/** Resend for a pending account, subject to the per-account cooldown and hourly cap. */
export async function resendEmailVerification(email: string): Promise<AccountEmailOutcome> {
  const user = await User.findOne({ email });
  if (!user || user.emailVerified || user.accountStatus !== 'pending_verification') return 'not_eligible';
  if (await accountEmailThrottled('verify', user._id)) return 'throttled';
  await issueEmailVerification(user);
  return 'queued';
}

export type VerifyResult = 'verified' | 'expired' | 'invalid' | 'already_verified';

/** Read-only look at a verification link, for the landing screen. Never consumes the token. */
export async function checkEmailVerification(token: string): Promise<'valid' | Exclude<VerifyResult, 'verified'>> {
  const existing = await EmailVerificationToken.findOne({ tokenHash: sha256(token) }).lean();
  if (!existing) return 'invalid';
  const u = await User.findById(existing.userId).lean();
  if (!u || u.email !== existing.email) return 'invalid';
  if (u.emailVerified) return 'already_verified';
  if (existing.consumedAt) return 'invalid'; // superseded by a newer link
  if (existing.expiresAt <= new Date()) return 'expired';
  return 'valid';
}

export async function consumeEmailVerification(token: string): Promise<{ result: VerifyResult; user?: UserDoc }> {
  const tokenHash = sha256(token);
  // Atomically consume so the link works exactly once.
  const doc = await EmailVerificationToken.findOneAndUpdate(
    { tokenHash, consumedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { consumedAt: new Date() } },
    { new: true },
  );
  if (!doc) {
    const existing = await EmailVerificationToken.findOne({ tokenHash }).lean();
    if (!existing) return { result: 'invalid' };
    const u = await User.findById(existing.userId);
    if (u?.emailVerified && u.email === existing.email) return { result: 'already_verified' };
    return { result: existing.consumedAt ? 'invalid' : 'expired' };
  }
  const user = await User.findById(doc.userId);
  if (!user || user.email !== doc.email) return { result: 'invalid' };
  if (user.emailVerified) return { result: 'already_verified', user };
  user.emailVerified = true;
  user.emailVerifiedAt = new Date();
  if (user.accountStatus === 'pending_verification') user.accountStatus = 'active';
  await user.save();
  return { result: 'verified', user };
}

// ------------------------------------------------------------------ password reset
/** Accounts that may reset a password by email. Suspended, invited, deactivated and archived accounts may not. */
const RESETTABLE_STATUSES = ['active', 'pending_verification'];

export async function requestPasswordReset(email: string, opts: { ignoreAccountLimit?: boolean } = {}): Promise<AccountEmailOutcome> {
  const user = await User.findOne({ email });
  // Only eligible accounts get an email, but the caller always returns the same generic response.
  if (!user || !RESETTABLE_STATUSES.includes(user.accountStatus)) return 'not_eligible';
  if (!opts.ignoreAccountLimit && (await accountEmailThrottled('reset', user._id))) return 'throttled';
  await PasswordResetToken.updateMany({ userId: user._id, consumedAt: null }, { $set: { consumedAt: new Date() } });
  const token = randomToken(32); // 256 bits from crypto.randomBytes; only the SHA-256 hash is stored
  await PasswordResetToken.create({ userId: user._id, email: user.email, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) });
  await sendEmail('password_reset', user.email, {
    name: user.fullName,
    link: appLink(`/reset-password?token=${encodeURIComponent(token)}`),
    expiresIn: `${env.PASSWORD_RESET_TTL_MINUTES} minutes`,
  });
  return 'queued';
}

export type ResetTokenState = 'valid' | 'expired' | 'used' | 'invalid';

/** Read-only check for the reset screen. Never consumes the token. */
export async function resetTokenState(token: string): Promise<ResetTokenState> {
  const doc = await PasswordResetToken.findOne({ tokenHash: sha256(token) }).lean();
  if (!doc) return 'invalid';
  if (doc.consumedAt) return 'used';
  if (doc.expiresAt <= new Date()) return 'expired';
  return 'valid';
}

export async function checkResetToken(token: string) {
  return (await resetTokenState(token)) === 'valid';
}

/**
 * Sets a new password with a single-use reset token.
 * - The token is claimed with one atomic findOneAndUpdate, so of several concurrent requests exactly one wins.
 * - If the password update then fails, the claim is released so the person can retry (compensating
 *   rollback: the deployment may not support multi-document transactions).
 * - Afterwards every session, pending MFA challenge and other reset link is revoked, and a
 *   "password changed" notice is emailed. No session is created: the person signs in again, and MFA
 *   (if enabled) is still required then.
 */
export async function consumePasswordReset(token: string, newHash: string): Promise<UserDoc | null> {
  const claimedAt = new Date();
  const doc = await PasswordResetToken.findOneAndUpdate(
    { tokenHash: sha256(token), consumedAt: null, expiresAt: { $gt: claimedAt } },
    { $set: { consumedAt: claimedAt } },
    { new: true },
  );
  if (!doc) return null;
  let user: UserDoc | null;
  try {
    user = await User.findById(doc.userId).select('+passwordHash');
    if (!user || !RESETTABLE_STATUSES.includes(user.accountStatus)) return null;
    if (doc.email && doc.email !== user.email) return null; // the address changed after the link was sent
    user.passwordHash = newHash;
    user.passwordChangedAt = new Date();
    user.failedLoginCount = 0;
    user.lockedUntil = null;
    // The link went to this address, which proves control of the inbox, so it also verifies the address.
    // This does not sign anyone in.
    if (!user.emailVerified) {
      user.emailVerified = true;
      user.emailVerifiedAt = new Date();
      if (user.accountStatus === 'pending_verification') user.accountStatus = 'active';
    }
    await user.save();
  } catch (err) {
    await PasswordResetToken.updateOne({ _id: doc._id, consumedAt: claimedAt }, { $set: { consumedAt: null } }).catch(() => undefined);
    throw err;
  }
  const now = new Date();
  await PasswordResetToken.updateMany({ userId: user._id, consumedAt: null }, { $set: { consumedAt: now } });
  await MfaChallenge.updateMany({ userId: user._id, consumedAt: null }, { $set: { consumedAt: now } });
  await revokeAllSessions(String(user._id));
  await sendEmail('password_changed', user.email, { name: user.fullName });
  return user;
}

// ------------------------------------------------------------------ MFA (TOTP) — see mfa.service.ts
/** Login / step-up / re-auth code check, with replay protection and lockout. */
export async function verifyMfaCode(userId: string, code: string): Promise<boolean> {
  return verifyTotpForUser(userId, code);
}

/** @deprecated compatibility shims for callers not yet moved to mfa.service. */
export async function startMfaEnrollment(user: UserDoc) {
  const r = await startTotpEnrollment(user);
  return { otpauth: r.otpauthUrl, qrDataUrl: r.qrDataUrl, secret: r.secret };
}
export async function confirmMfaEnrollment(userId: string, code: string): Promise<boolean> {
  const user = await User.findById(userId);
  if (!user) return false;
  try {
    await verifyTotpEnrollment(user, code);
    return true;
  } catch {
    return false;
  }
}

export async function mfaRequiredFor(user: UserDoc): Promise<boolean> {
  const s = await getSettings();
  if (user.role === 'super_admin') return s.security.requireMfaForSuperAdmin;
  if (user.role === 'admin') return s.security.requireMfaForAdmins;
  return false;
}
