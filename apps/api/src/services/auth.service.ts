import type { Request, Response } from 'express';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { env } from '../config/env';
import { decryptSecret, encryptSecret, hmac, randomToken, sha256 } from '../lib/crypto';
import {
  EmailVerificationToken, PasswordResetToken, Session, User, type SessionDoc, type UserDoc,
} from '../models/user';
import { isAllowedAccountEmail, ACCOUNT_EMAIL_DOMAIN } from '@campuscare/shared';
import { EmailDomain } from '../models/platform';
import { getSettings } from './settings.service';
import { appLink, sendEmail } from './email/email.service';
import { disconnectUser } from '../realtime/socket';
import { DeviceRegistration } from '../models/mobile';

export const SESSION_COOKIE = 'cc_session';
/** Header the Android app sends on every request. Browsers cannot send it cross-site without a CORS preflight. */
export const MOBILE_CLIENT_HEADER = 'x-campuscare-client';
export const CSRF_COOKIE = 'cc_csrf';
const VERIFY_TTL_MS = 24 * 3600 * 1000;
const RESET_TTL_MS = 30 * 60 * 1000;

authenticator.options = { window: 1 };

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
  if (!user || user.accountStatus === 'suspended') {
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

// ------------------------------------------------------------------ email verification
export async function issueEmailVerification(user: UserDoc) {
  await EmailVerificationToken.updateMany({ userId: user._id, consumedAt: null }, { $set: { consumedAt: new Date() } });
  const token = randomToken(32);
  await EmailVerificationToken.create({ userId: user._id, email: user.email, tokenHash: sha256(token), expiresAt: new Date(Date.now() + VERIFY_TTL_MS) });
  await sendEmail('verify_email', user.email, { name: user.fullName, link: appLink(`/verify-email?token=${encodeURIComponent(token)}`) });
}

export type VerifyResult = 'verified' | 'expired' | 'invalid' | 'already_verified';

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
    if (u?.emailVerified) return { result: 'already_verified' };
    return { result: existing.consumedAt ? 'invalid' : 'expired' };
  }
  const user = await User.findById(doc.userId);
  if (!user || user.email !== doc.email) return { result: 'invalid' };
  user.emailVerified = true;
  user.emailVerifiedAt = new Date();
  if (user.accountStatus === 'pending_verification') user.accountStatus = 'active';
  await user.save();
  return { result: 'verified', user };
}

// ------------------------------------------------------------------ password reset
export async function requestPasswordReset(email: string) {
  const user = await User.findOne({ email });
  // Only eligible accounts get an email, but the caller always returns the same generic response.
  if (!user || user.accountStatus === 'suspended' || user.accountStatus === 'invited') return;
  await PasswordResetToken.updateMany({ userId: user._id, consumedAt: null }, { $set: { consumedAt: new Date() } });
  const token = randomToken(32);
  await PasswordResetToken.create({ userId: user._id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) });
  await sendEmail('password_reset', user.email, { name: user.fullName, link: appLink(`/reset-password?token=${encodeURIComponent(token)}`) });
}

export async function checkResetToken(token: string) {
  const doc = await PasswordResetToken.findOne({ tokenHash: sha256(token), consumedAt: null, expiresAt: { $gt: new Date() } }).lean();
  return Boolean(doc);
}

export async function consumePasswordReset(token: string, newHash: string): Promise<UserDoc | null> {
  const doc = await PasswordResetToken.findOneAndUpdate(
    { tokenHash: sha256(token), consumedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { consumedAt: new Date() } },
    { new: true },
  );
  if (!doc) return null;
  const user = await User.findById(doc.userId).select('+passwordHash');
  if (!user || user.accountStatus === 'suspended') return null;
  user.passwordHash = newHash;
  user.passwordChangedAt = new Date();
  user.failedLoginCount = 0;
  user.lockedUntil = null;
  // Proving control of the inbox also verifies the address.
  if (!user.emailVerified) {
    user.emailVerified = true;
    user.emailVerifiedAt = new Date();
    if (user.accountStatus === 'pending_verification') user.accountStatus = 'active';
  }
  await user.save();
  await revokeAllSessions(String(user._id));
  await sendEmail('password_changed', user.email, { name: user.fullName });
  return user;
}

// ------------------------------------------------------------------ MFA (TOTP)
export async function startMfaEnrollment(user: UserDoc) {
  const secret = authenticator.generateSecret();
  const s = await getSettings();
  await User.updateOne({ _id: user._id }, { $set: { mfaPendingSecretEnc: encryptSecret(secret) } });
  const otpauth = authenticator.keyuri(user.email, s.platform.name, secret);
  const qrDataUrl = await QRCode.toDataURL(otpauth, { margin: 1, width: 220 });
  return { otpauth, qrDataUrl, secret };
}

export async function confirmMfaEnrollment(userId: string, code: string): Promise<boolean> {
  const user = await User.findById(userId).select('+mfaPendingSecretEnc');
  if (!user?.mfaPendingSecretEnc) return false;
  const secret = decryptSecret(user.mfaPendingSecretEnc);
  if (!authenticator.check(code, secret)) return false;
  user.mfaSecretEnc = user.mfaPendingSecretEnc;
  user.mfaPendingSecretEnc = null;
  user.mfaEnabled = true;
  await user.save();
  return true;
}

export async function verifyMfaCode(userId: string, code: string): Promise<boolean> {
  const user = await User.findById(userId).select('+mfaSecretEnc');
  if (!user?.mfaEnabled || !user.mfaSecretEnc) return false;
  return authenticator.check(code, decryptSecret(user.mfaSecretEnc));
}

export async function mfaRequiredFor(user: UserDoc): Promise<boolean> {
  const s = await getSettings();
  if (user.role === 'super_admin') return s.security.requireMfaForSuperAdmin;
  if (user.role === 'admin') return s.security.requireMfaForAdmins;
  return false;
}
