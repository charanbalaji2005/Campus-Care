import type { Request, Response } from 'express';
import { env } from '../config/env';
import { hmac, randomDigits, randomToken, safeEqual, sha256 } from '../lib/crypto';
import {
  EmailOtp, EmailVerificationToken, PasswordResetToken, Session, User, type SessionDoc, type UserDoc,
} from '../models/user';
import { isAllowedAccountEmail, ACCOUNT_EMAIL_DOMAIN, APP_NAMES, appAudienceForRole, type AppAudience, type EmailChallengeMethod, type Role } from '@campuscare/shared';
import { AppError } from '../lib/http';
import { EmailDelivery, EmailDomain } from '../models/platform';
import { getSettings } from './settings.service';
import { accountLink, appLink, maskEmail, sendEmail } from './email/email.service';
import { disconnectUser } from '../realtime/socket';
import { DeviceRegistration } from '../models/mobile';
import { MfaChallenge } from '../models/mfa';
import { StaffApplication } from '../models/staff-application';
import { startTotpEnrollment, verifyTotpEnrollment, verifyTotpForUser } from './mfa.service';

export const SESSION_COOKIE = 'cc_session';
/** Header the Android app sends on every request. Browsers cannot send it cross-site without a CORS preflight. */
export const MOBILE_CLIENT_HEADER = 'x-campuscare-client';
/** Which Android app is calling: 'student' (CampusCare Student) or 'college' (CampusCare College). */
export const MOBILE_APP_HEADER = 'x-campuscare-app';
export const CSRF_COOKIE = 'cc_csrf';
const VERIFY_TTL_MS = env.EMAIL_VERIFICATION_TTL_HOURS * 3600 * 1000;
const RESET_TTL_MS = env.PASSWORD_RESET_TTL_MINUTES * 60 * 1000;
const OTP_TTL_MS = env.EMAIL_OTP_TTL_MINUTES * 60 * 1000;


function cookieBase() {
  return { secure: env.COOKIE_SECURE, sameSite: 'lax' as const, path: '/', domain: env.COOKIE_DOMAIN || undefined };
}

export function setCsrfCookie(res: Response, token = randomToken(24)) {
  res.cookie(CSRF_COOKIE, token, { ...cookieBase(), httpOnly: false, maxAge: 30 * 24 * 3600 * 1000 });
  return token;
}

// ------------------------------------------------------------------ app audience (Student vs College app)
/** When `app` is set and is not the app this role uses, returns the app the account belongs to. */
export function wrongAppFor(role: string, app: AppAudience | null | undefined): AppAudience | null {
  if (!app) return null;
  const expected = appAudienceForRole(role as Role);
  return expected === app ? null : expected;
}

export function wrongAppError(expected: AppAudience, status = 403) {
  const message = expected === 'college'
    ? `This is a college staff account. Sign in with the ${APP_NAMES.college} app.`
    : `This is a student account. Sign in with the ${APP_NAMES.student} app.`;
  return new AppError(status, 'wrong_app', message, { app: expected });
}

/** Refuses a sign-in from the Android app that does not match the account's role. */
export function assertAppForUser(req: Request, user: { role: string }) {
  const expected = wrongAppFor(user.role, req.clientApp);
  if (expected) throw wrongAppError(expected);
}

// ------------------------------------------------------------------ sessions
export async function createSession(
  req: Request,
  res: Response,
  user: UserDoc,
  opts: { remember?: boolean; method: 'password' | 'google'; mfaVerified: boolean; mobile?: boolean; app?: AppAudience | null },
): Promise<SessionDoc & { plainToken?: string }> {
  const s = await getSettings();
  const token = randomToken(32);
  const now = Date.now();
  const mobile = Boolean(opts.mobile ?? req.isMobileClient);
  const isSuperAdminWeb = user.role === 'super_admin' && !mobile;
  // Students on the mobile app stay signed in for the "remember me" period when checked.
  const longLived = Boolean(opts.remember) && user.role === 'student' && mobile;
  // Super Admin on the Next.js web portal has a fixed absolute maximum session lifetime of 12 hours.
  // Active usage, token renewal, or idle extension must never extend past this absolute 12-hour mark.
  const absoluteMs = isSuperAdminWeb
    ? 12 * 3600_000
    : longLived
    ? s.security.rememberMeDays * 86400_000
    : s.security.sessionAbsoluteHours * 3600_000;
  const idleMs = isSuperAdminWeb
    ? Math.min(s.security.sessionIdleMinutes * 60_000, absoluteMs)
    : mobile && longLived
    ? absoluteMs
    : s.security.sessionIdleMinutes * 60_000;
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
    app: mobile ? (opts.app ?? req.clientApp ?? null) : null,
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

/** Seconds until this account may be sent another verification (or reset) email; 0 = now. Links and codes count together. */
export async function accountEmailWait(kind: 'verify' | 'reset', userId: unknown): Promise<number> {
  const filter = { userId, createdAt: { $gt: new Date(Date.now() - 3600_000) } };
  const opts = { sort: { createdAt: -1 as const }, limit: ACCOUNT_EMAIL_MAX_PER_HOUR };
  const [links, codes] = await Promise.all([
    kind === 'verify'
      ? EmailVerificationToken.find(filter, 'createdAt', opts).lean()
      : PasswordResetToken.find({ ...filter, via: { $ne: 'otp' } }, 'createdAt', opts).lean(),
    EmailOtp.find({ ...filter, purpose: kind === 'verify' ? 'verify_email' : 'password_reset' }, 'createdAt', opts).lean(),
  ]);
  const times = [...links, ...codes].map((d) => (d.createdAt as Date).getTime()).sort((a, b) => b - a);
  const now = Date.now();
  if (times.length >= ACCOUNT_EMAIL_MAX_PER_HOUR) return Math.max(1, Math.ceil((times[ACCOUNT_EMAIL_MAX_PER_HOUR - 1]! + 3600_000 - now) / 1000));
  const last = times[0];
  return last ? Math.max(0, Math.ceil((last + ACCOUNT_EMAIL_COOLDOWN_SECONDS * 1000 - now) / 1000)) : 0;
}

async function accountEmailThrottled(kind: 'verify' | 'reset', userId: unknown): Promise<boolean> {
  return (await accountEmailWait(kind, userId)) > 0;
}

// ------------------------------------------------------------------ one-time email codes (OTP)
export type OtpPurpose = 'verify_email' | 'password_reset';
/** Wrong guesses allowed per code before it is burned (a new code must be requested). */
export const OTP_MAX_ATTEMPTS = 5;
/** Lifetime of the reset token handed out for a correct reset code: just long enough to type a new password. */
const OTP_EXCHANGE_TTL_MS = 10 * 60_000;

/**
 * Codes are for students and staff. Super Admin accounts never get one: their recovery stays link-only
 * (plus MFA at the next sign-in), and a request for a code is answered with a link instead.
 */
export function otpAllowedFor(user: { role: string }): boolean {
  return user.role !== 'super_admin';
}

/** Keyed hash of a code, bound to the account and purpose. The code itself is never stored or logged. */
function otpHash(purpose: OtpPurpose, userId: string, code: string) {
  return hmac(env.SESSION_SECRET, `email-otp:${purpose}:${userId}:${code}`);
}

/** Ends every outstanding code and link for this purpose, so only the newest credential works. */
async function endOutstandingChallenges(userId: unknown, purpose: OtpPurpose, reason = 'superseded') {
  const now = new Date();
  await EmailOtp.updateMany({ userId, purpose, consumedAt: null }, { $set: { consumedAt: now, endedReason: reason } });
  if (purpose === 'verify_email') await EmailVerificationToken.updateMany({ userId, consumedAt: null }, { $set: { consumedAt: now } });
  else await PasswordResetToken.updateMany({ userId, consumedAt: null }, { $set: { consumedAt: now } });
}

async function issueEmailOtp(user: UserDoc, purpose: OtpPurpose) {
  await endOutstandingChallenges(user._id, purpose);
  const code = randomDigits(6);
  const otp = await EmailOtp.create({
    userId: user._id, email: user.email, purpose, codeHash: otpHash(purpose, String(user._id), code), expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });
  // The code travels only in the queued email job (its payload is wiped once sent or given up) and the email.
  const delivery = await sendEmail(purpose === 'verify_email' ? 'verify_email_code' : 'password_reset_code', user.email, {
    name: user.fullName, code, expiresIn: `${env.EMAIL_OTP_TTL_MINUTES} minutes`,
  });
  if (delivery) await EmailOtp.updateOne({ _id: otp._id }, { $set: { deliveryId: delivery._id } });
  return otp;
}

export type OtpCheck =
  | { result: 'ok'; email: string }
  | { result: 'invalid'; attemptsLeft: number }
  | { result: 'expired' | 'locked' | 'none' };

/**
 * Checks a code against the newest one for this account and purpose. Every check first reserves an
 * attempt atomically, so even parallel guesses cannot exceed OTP_MAX_ATTEMPTS; the matching check then
 * claims the code (single use). After the last wrong guess the code is burned.
 */
async function checkEmailOtp(userId: unknown, purpose: OtpPurpose, code: string): Promise<OtpCheck> {
  const now = new Date();
  const latest = await EmailOtp.findOne({ userId, purpose }).sort({ createdAt: -1 }).lean();
  if (!latest) return { result: 'none' };
  if (latest.consumedAt) return { result: latest.endedReason === 'too_many_attempts' ? 'locked' : 'none' };
  if (latest.expiresAt <= now) return { result: 'expired' };
  const reserved = await EmailOtp.findOneAndUpdate(
    { _id: latest._id, consumedAt: null, expiresAt: { $gt: now }, attempts: { $lt: OTP_MAX_ATTEMPTS } },
    { $inc: { attempts: 1 } },
    { new: true },
  );
  if (!reserved) return { result: 'locked' };
  if (safeEqual(otpHash(purpose, String(userId), code), reserved.codeHash)) {
    const claimed = await EmailOtp.findOneAndUpdate({ _id: reserved._id, consumedAt: null }, { $set: { consumedAt: new Date(), endedReason: 'used' } }, { new: true });
    return claimed ? { result: 'ok', email: claimed.email } : { result: 'none' };
  }
  if (reserved.attempts >= OTP_MAX_ATTEMPTS) {
    await EmailOtp.updateOne({ _id: reserved._id, consumedAt: null }, { $set: { consumedAt: new Date(), endedReason: 'too_many_attempts' } });
    return { result: 'locked' };
  }
  return { result: 'invalid', attemptsLeft: OTP_MAX_ATTEMPTS - reserved.attempts };
}

// ------------------------------------------------------------------ verification tickets
const TICKET_TTL_MS = 24 * 3600_000;

/**
 * Signed handle for the person who just created an account (or signed in with the right password to an
 * unverified one). It lets that person choose a code or a link and see whether the email was sent,
 * without the API answering such questions for an arbitrary address.
 */
export function issueVerificationTicket(userId: string): string {
  const body = `${userId}.${(Date.now() + TICKET_TTL_MS).toString(36)}`;
  return `vt1.${body}.${hmac(env.SESSION_SECRET, `verify-ticket:${body}`)}`;
}

export function readVerificationTicket(ticket: string | null | undefined): string | null {
  const parts = (ticket ?? '').split('.');
  if (parts.length !== 4 || parts[0] !== 'vt1' || !/^[a-f0-9]{24}$/.test(parts[1]!)) return null;
  const body = `${parts[1]}.${parts[2]}`;
  if (!safeEqual(parts[3]!, hmac(env.SESSION_SECRET, `verify-ticket:${body}`))) return null;
  if (!(parseInt(parts[2]!, 36) > Date.now())) return null;
  return parts[1]!;
}

/** Delivery states shown to the person: never "delivered" unless the provider reported delivery. */
export type PublicDeliveryStatus = 'sending' | 'accepted' | 'delivered' | 'bounced' | 'rejected' | 'failed';
export function publicDeliveryStatus(status: string): PublicDeliveryStatus {
  switch (status) {
    case 'queued': case 'sending': return 'sending';
    case 'accepted_by_provider': case 'sent': return 'accepted';
    case 'delivered': return 'delivered';
    case 'bounced': return 'bounced';
    case 'rejected': return 'rejected';
    default: return 'failed';
  }
}

/** Verification state for a ticket holder: method in use, whether the email went out, and the resend wait. */
export async function verificationStatus(userId: string) {
  const user = await User.findById(userId);
  if (!user) return null;
  const [link, code] = await Promise.all([
    EmailVerificationToken.findOne({ userId }).sort({ createdAt: -1 }).lean(),
    EmailOtp.findOne({ userId, purpose: 'verify_email' }).sort({ createdAt: -1 }).lean(),
  ]);
  const useCode = Boolean(code && (!link || (code.createdAt as Date) >= (link.createdAt as Date)));
  const latest = useCode ? code : link;
  const delivery = latest?.deliveryId ? await EmailDelivery.findById(latest.deliveryId).select('status updatedAt').lean() : null;
  const now = new Date();
  const method: EmailChallengeMethod | null = latest ? (useCode ? 'otp' : 'link') : null;
  return {
    emailVerified: Boolean(user.emailVerified),
    maskedEmail: maskEmail(user.email),
    otpAvailable: otpAllowedFor(user),
    method,
    active: Boolean(latest && !latest.consumedAt && latest.expiresAt > now),
    expiresAt: latest && !latest.consumedAt ? latest.expiresAt : null,
    attemptsLeft: useCode && code && !code.consumedAt ? Math.max(0, OTP_MAX_ATTEMPTS - (code.attempts ?? 0)) : null,
    delivery: delivery ? { status: publicDeliveryStatus(delivery.status), updatedAt: delivery.updatedAt } : null,
    retryAfterSeconds: user.emailVerified ? 0 : await accountEmailWait('verify', user._id),
  };
}

// ------------------------------------------------------------------ email verification
/**
 * Issues a fresh single-use verification link (only its SHA-256 hash is stored) and supersedes older ones.
 * The link carries the token only: no email address or other personal data in the URL.
 */
export async function issueEmailVerification(user: UserDoc, method: EmailChallengeMethod = 'link'): Promise<EmailChallengeMethod> {
  if (method === 'otp' && otpAllowedFor(user)) {
    await issueEmailOtp(user, 'verify_email');
    return 'otp';
  }
  await endOutstandingChallenges(user._id, 'verify_email');
  const token = randomToken(32);
  const doc = await EmailVerificationToken.create({ userId: user._id, email: user.email, tokenHash: sha256(token), expiresAt: new Date(Date.now() + VERIFY_TTL_MS) });
  const delivery = await sendEmail('verify_email', user.email, {
    name: user.fullName,
    link: accountLink('/verify-email', token),
    expiresIn: `${env.EMAIL_VERIFICATION_TTL_HOURS} hours`,
  });
  if (delivery) await EmailVerificationToken.updateOne({ _id: doc._id }, { $set: { deliveryId: delivery._id } });
  return 'link';
}

/**
 * Whether proving the email address may switch a pending account to active. It never does for a
 * self-registered staff applicant: email verification is not institutional approval, so the account
 * stays pending until a reviewer approves it (see /super-admin/users/verifications).
 */
export function emailProofActivates(user: { approvalRequired?: boolean | null }): boolean {
  return !user.approvalRequired;
}

/**
 * Email proof moves a staff application from "pending email verification" to "pending institutional
 * review". It changes nothing else: the role and any access still wait for a Super Admin's approval.
 */
export async function markStaffApplicationEmailVerified(userId: unknown): Promise<void> {
  await StaffApplication.updateOne(
    { userId, status: 'pending_email_verification' },
    { $set: { status: 'pending_review' }, $push: { history: { at: new Date(), action: 'email_verified', from: 'pending_email_verification', to: 'pending_review' } } },
  );
}

/** A self-registered staff applicant who proved their email and is waiting for institutional approval. */
export function isPendingApplicant(user: { approvalRequired?: boolean | null; emailVerified?: boolean | null; accountStatus?: string | null }): boolean {
  return Boolean(user.approvalRequired && user.emailVerified && user.accountStatus === 'pending_verification');
}

function verificationEligible(user: UserDoc | null): user is UserDoc {
  return Boolean(user && !user.emailVerified && (user.accountStatus === 'pending_verification' || user.accountStatus === 'active'));
}

/** Resend for a pending account, subject to the per-account cooldown and hourly cap. */
export async function resendEmailVerification(email: string, method: EmailChallengeMethod = 'link'): Promise<AccountEmailOutcome> {
  const normalized = email.trim().toLowerCase();
  const user = await User.findOne({ email: normalized });
  if (!verificationEligible(user)) return 'not_eligible';
  if (await accountEmailThrottled('verify', user._id)) return 'throttled';
  await issueEmailVerification(user, method);
  return 'queued';
}

/** Ticket-holder resend: the same limits, but the answer may say what happened (the holder knows the account exists). */
export async function sendVerificationForTicket(userId: string, method: EmailChallengeMethod): Promise<'queued' | 'already_verified' | 'not_eligible' | { wait: number }> {
  const user = await User.findById(userId);
  if (user?.emailVerified) return 'already_verified';
  if (!verificationEligible(user)) return 'not_eligible';
  const wait = await accountEmailWait('verify', user._id);
  if (wait > 0) return { wait };
  await issueEmailVerification(user, method);
  return 'queued';
}

export type OtpVerifyResult = 'verified' | 'already_verified' | 'invalid' | 'expired' | 'locked' | 'none';

/** Verifies an email address with a code. Marks it verified only when the code matches; no session is created. */
export async function verifyEmailWithOtp(email: string, code: string): Promise<{ result: OtpVerifyResult; attemptsLeft?: number; user?: UserDoc }> {
  const user = await User.findOne({ email: email.trim().toLowerCase() });
  if (!user || !otpAllowedFor(user)) return { result: 'none' };
  if (user.emailVerified) return { result: 'already_verified', user };
  const check = await checkEmailOtp(user._id, 'verify_email', code);
  if (check.result !== 'ok') return { result: check.result, attemptsLeft: check.result === 'invalid' ? check.attemptsLeft : undefined, user };
  if (check.email !== user.email) return { result: 'none', user }; // the address changed after the code was sent
  // Conditional update: a concurrent link verification cannot make this run twice.
  const updated = await User.findOneAndUpdate(
    { _id: user._id, email: check.email, emailVerified: { $ne: true } },
    { $set: { emailVerified: true, emailVerifiedAt: new Date(), ...(user.accountStatus === 'pending_verification' && emailProofActivates(user) ? { accountStatus: 'active' } : {}) } },
    { new: true },
  );
  await endOutstandingChallenges(user._id, 'verify_email', 'used');
  if (updated) await markStaffApplicationEmailVerified(user._id);
  return { result: updated ? 'verified' : 'already_verified', user: updated ?? user };
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
  if (user.accountStatus === 'pending_verification' && emailProofActivates(user)) user.accountStatus = 'active';
  await user.save();
  await endOutstandingChallenges(user._id, 'verify_email', 'used');
  await markStaffApplicationEmailVerified(user._id);
  return { result: 'verified', user };
}

// ------------------------------------------------------------------ password reset
/** Accounts that may reset a password by email. Suspended, invited, deactivated and archived accounts may not. */
const RESETTABLE_STATUSES = ['active', 'pending_verification'];

export async function requestPasswordReset(email: string, opts: { ignoreAccountLimit?: boolean; method?: EmailChallengeMethod } = {}): Promise<AccountEmailOutcome> {
  const normalized = email.trim().toLowerCase();
  const user = await User.findOne({ email: normalized });
  // Only eligible accounts get an email, but the caller always returns the same generic response.
  if (!user || !RESETTABLE_STATUSES.includes(user.accountStatus)) return 'not_eligible';
  if (!opts.ignoreAccountLimit && (await accountEmailThrottled('reset', user._id))) return 'throttled';
  if (opts.method === 'otp' && otpAllowedFor(user)) {
    await issueEmailOtp(user, 'password_reset');
    return 'queued';
  }
  // A link. Also what a Super Admin gets when a code is asked for: their recovery stays link-only.
  await endOutstandingChallenges(user._id, 'password_reset');
  const token = randomToken(32); // 256 bits from crypto.randomBytes; only the SHA-256 hash is stored
  const doc = await PasswordResetToken.create({ userId: user._id, email: user.email, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) });
  const delivery = await sendEmail('password_reset', user.email, {
    name: user.fullName,
    link: accountLink('/reset-password', token),
    expiresIn: `${env.PASSWORD_RESET_TTL_MINUTES} minutes`,
  });
  if (delivery) await PasswordResetToken.updateOne({ _id: doc._id }, { $set: { deliveryId: delivery._id } });
  return 'queued';
}

/**
 * Exchanges a correct reset code for a short-lived, single-use reset token. The code only proves control
 * of the inbox: it never signs anyone in. The new password is then set through the normal reset (same
 * password rules, session revocation and "password changed" email). Returns null on any failure, so the
 * caller can answer generically.
 */
export async function exchangeResetOtp(email: string, code: string): Promise<{ token: string; user: UserDoc } | null> {
  const user = await User.findOne({ email: email.trim().toLowerCase() });
  if (!user || !RESETTABLE_STATUSES.includes(user.accountStatus) || !otpAllowedFor(user)) return null;
  const check = await checkEmailOtp(user._id, 'password_reset', code);
  if (check.result !== 'ok' || check.email !== user.email) return null;
  const token = randomToken(32);
  await PasswordResetToken.create({ userId: user._id, email: user.email, tokenHash: sha256(token), expiresAt: new Date(Date.now() + OTP_EXCHANGE_TTL_MS), via: 'otp' });
  return { token, user };
}

export type ResetTokenState = 'valid' | 'expired' | 'used' | 'invalid';

/** Read-only check for the reset screen. Never consumes the token. */
export async function resetTokenState(token: string): Promise<ResetTokenState> {
  const clean = token.trim();
  let doc = await PasswordResetToken.findOne({ tokenHash: sha256(clean) }).lean();
  if (!doc) {
    try {
      const decoded = decodeURIComponent(clean);
      if (decoded !== clean) {
        doc = await PasswordResetToken.findOne({ tokenHash: sha256(decoded) }).lean();
      }
    } catch {}
  }
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
  const clean = token.trim();
  let decoded = clean;
  try { decoded = decodeURIComponent(clean); } catch {}
  const doc = await PasswordResetToken.findOneAndUpdate(
    { tokenHash: { $in: [sha256(clean), sha256(decoded)] }, consumedAt: null, expiresAt: { $gt: claimedAt } },
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
      if (user.accountStatus === 'pending_verification' && emailProofActivates(user)) user.accountStatus = 'active';
    }
    await user.save();
    if (user.emailVerified) await markStaffApplicationEmailVerified(user._id);
  } catch (err) {
    await PasswordResetToken.updateOne({ _id: doc._id, consumedAt: claimedAt }, { $set: { consumedAt: null } }).catch(() => undefined);
    throw err;
  }
  const now = new Date();
  await PasswordResetToken.updateMany({ userId: user._id, consumedAt: null }, { $set: { consumedAt: now } });
  await EmailOtp.updateMany({ userId: user._id, purpose: 'password_reset', consumedAt: null }, { $set: { consumedAt: now, endedReason: 'superseded' } });
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
