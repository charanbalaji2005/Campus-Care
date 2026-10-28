import { Router } from 'express';
import {
  PRIVILEGED_ROLES, parseAppAudience, type AppAudience, googleIdTokenSchema, changePasswordSchema, forgotPasswordSchema, homePathFor, loginSchema, mfaChallengeSchema, mfaDisableSchema, mfaRecoverySchema, mfaVerifySchema,
  passwordSchema, profileUpdateSchema, reauthSchema, registerSchema, resendVerificationSchema, resetPasswordSchema, tokenSchema, totpCodeSchema, type Role,
} from '@campuscare/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError, asyncHandler, ok, parse } from '../lib/http';
import { hashPassword, randomToken, sha256, verifyPassword } from '../lib/crypto';
import { ExternalIdentity, InviteToken, Session, User, publicUser } from '../models/user';
import { RealtimeTicket } from '../models/platform';
import {
  ACCOUNT_EMAIL_COOLDOWN_SECONDS, CSRF_COOKIE, checkEmailVerification, clearAuthCookies, consumeEmailVerification, consumePasswordReset, createSession,
  isDomainAllowed, issueEmailVerification, mfaRequiredFor, requestPasswordReset, resendEmailVerification, resetTokenState, revokeAllSessions, revokeSession, setCsrfCookie,
  verifyMfaCode, assertAppForUser, wrongAppError, wrongAppFor,
} from '../services/auth.service';
import {
  consumeMfaChallenge, consumeRecoveryCode, createMfaChallenge, failMfaChallenge, loadMfaChallenge, mfaStatus, regenerateRecoveryCodes, removeTotp,
  startTotpEnrollment, verifyTotpEnrollment,
} from '../services/mfa.service';
import { audit, ipHashOf } from '../services/audit.service';
import { buildGoogleAuthUrl, exchangeGoogleCode, getGoogleConfig, sealState, unsealState, verifyGoogleIdToken } from '../services/google.service';
import { getSettings, publicSettings } from '../services/settings.service';
import { emailReadiness, sendEmail } from '../services/email/email.service';
import { requireAuth, requireRecentAuth } from '../middleware/auth';
import { authLimiter, emailLimiter, mfaLimiter, requireTurnstile } from '../middleware/security';
import type { UserDoc } from '../models/user';
import { env } from '../config/env';

export const authRouter = Router();
const GENERIC_RESET = 'If an account exists for that email, a password reset link is on its way. It can take a few minutes to arrive; check your spam folder too.';
const GENERIC_RESEND = 'If that account still needs verification, a new verification link is on its way. It can take a few minutes to arrive; check your spam folder too.';

async function withGenericTiming<T>(work: () => Promise<T>): Promise<T> {
  const floor = new Promise((resolve) => setTimeout(resolve, env.AUTH_GENERIC_RESPONSE_MS));
  try {
    return await work();
  } finally {
    await floor;
  }
}

async function requireEmailReady() {
  const r = await emailReadiness();
  if (!r.ready) throw new AppError(503, 'email_unavailable', r.message, { reason: r.reason });
}
const MFA_COOKIE = 'cc_mfa';
const MFA_COOKIE_PATH = '/';

function setMfaCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(MFA_COOKIE, token, { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'strict', path: MFA_COOKIE_PATH, expires: expiresAt });
}

/** Creates the full session only after every required factor passed, and builds the sign-in response. */
async function completeSignIn(req: Request, res: Response, user: UserDoc, opts: { method: 'password' | 'google'; remember?: boolean; mfaVerified: boolean }) {
  assertAppForUser(req, user);
  const session = await createSession(req, res, user, { remember: opts.remember ?? undefined, method: opts.method, mfaVerified: opts.mfaVerified });
  await audit({ action: 'auth.login', actorId: String(user._id), actorRole: user.role, req, meta: { client: req.isMobileClient ? 'android' : 'web', app: req.clientApp ?? null, method: opts.method, mfa: opts.mfaVerified } });
  const needsMfaSetup = !user.mfaEnabled && (await mfaRequiredFor(user));
  const pubUser = publicUser(user);
  if (req.isMobileClient && user.role === 'super_admin') pubUser.role = 'counsellor';
  return {
    user: pubUser,
    redirectTo: needsMfaSetup ? '/super-admin/authenticator?setup=required' : homePathFor(pubUser.role as Role),
    needsMfaSetup,
    ...(session.plainToken ? { sessionToken: session.plainToken, expiresAt: session.expiresAt } : {}),
  };
}

authRouter.get('/csrf', (req, res) => {
  const token = (req.cookies?.[CSRF_COOKIE] as string | undefined) ?? setCsrfCookie(res);
  ok(res, { csrfToken: token });
});

authRouter.get('/public-settings', asyncHandler(async (_req, res) => ok(res, await publicSettings())));

// ------------------------------------------------------------------ registration (students only)
authRouter.post(
  '/register',
  authLimiter,
  requireTurnstile('register'),
  asyncHandler(async (req, res) => {
    const s = await getSettings();
    if (!s.registration.studentRegistrationOpen) throw new AppError(403, 'registration_closed', 'Student registration is currently closed.');
    const input = parse(registerSchema, req.body);
    if (req.clientApp === 'college') {
      throw new AppError(403, 'registration_student_only', 'CampusCare College has no sign-up: staff accounts are created by your campus administrator. Students register in CampusCare Student.');
    }
    if (input.password.length < s.security.passwordMinLength) throw new AppError(422, 'validation_failed', 'Password too short.', { fields: { password: `Use at least ${s.security.passwordMinLength} characters` } });
    // Any "role" in the body is ignored — public registration always creates a student.
    if (!(await isDomainAllowed(input.email, 'students'))) {
      throw new AppError(422, 'validation_failed', 'Use your university email address.', { fields: { email: 'Registration is limited to approved university email domains.' } });
    }
    // Do not create an account that would be stuck waiting for an email we cannot send.
    if (s.registration.requireEmailVerification) await requireEmailReady();
    const dupEmail = await User.exists({ email: input.email });
    const dupStudent = await User.exists({ studentId: input.studentId.toUpperCase() });
    if (dupEmail || dupStudent) {
      await audit({ action: 'auth.register_duplicate', req, outcome: 'denied' });
      throw new AppError(409, 'account_exists', 'An account with these details already exists. Try signing in or resetting your password.', {
        fields: { ...(dupEmail ? { email: 'Already registered' } : {}), ...(dupStudent ? { studentId: 'Already registered' } : {}) },
      });
    }
    const user = await User.create({
      fullName: input.fullName,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      role: 'student',
      accountStatus: s.registration.requireEmailVerification ? 'pending_verification' : 'active',
      emailVerified: !s.registration.requireEmailVerification,
      studentId: input.studentId.toUpperCase(),
      department: input.department,
      academicYear: input.academicYear,
      phone: input.phone || null,
    });
    if (s.registration.requireEmailVerification) await issueEmailVerification(user);
    await audit({ action: 'auth.registered', actorId: String(user._id), actorRole: 'student', targetType: 'user', targetId: String(user._id), req });
    ok(res, { requiresVerification: s.registration.requireEmailVerification, email: user.email }, 201);
  }),
);

/**
 * Read-only status of a verification link for the landing screen (valid / expired / invalid / already_verified).
 * Opening the link never verifies anything: only the explicit POST /verify-email below consumes the token,
 * so email security scanners that prefetch links cannot use it up.
 */
authRouter.post(
  '/verify-email/check',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { token } = parse(tokenSchema, req.body);
    ok(res, { state: await checkEmailVerification(token) });
  }),
);

authRouter.post(
  '/verify-email',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { token } = parse(tokenSchema, req.body);
    const { result, user } = await consumeEmailVerification(token);
    if (user) await audit({ action: 'auth.email_verified', actorId: String(user._id), targetType: 'user', targetId: String(user._id), req });
    if (result === 'invalid') throw new AppError(400, 'invalid_token', 'This verification link is invalid or has already been used.');
    if (result === 'expired') throw new AppError(410, 'expired_token', 'This verification link has expired. Request a new one.');
    ok(res, { result });
  }),
);

authRouter.post(
  '/resend-verification',
  emailLimiter,
  requireTurnstile('resendVerification'),
  asyncHandler(async (req, res) => {
    const { email } = parse(resendVerificationSchema, req.body);
    await requireEmailReady();
    // Per-account cooldown and hourly cap are applied inside; the answer is the same in every case.
    const outcome = await withGenericTiming(() => resendEmailVerification(email));
    await audit({ action: 'auth.verification_resend_requested', req, meta: { outcome } });
    ok(res, { message: GENERIC_RESEND, retryAfterSeconds: ACCOUNT_EMAIL_COOLDOWN_SECONDS, expiresInHours: env.EMAIL_VERIFICATION_TTL_HOURS });
  }),
);

// ------------------------------------------------------------------ login / logout
authRouter.post(
  '/login',
  authLimiter,
  requireTurnstile('login'),
  asyncHandler(async (req, res) => {
    const input = parse(loginSchema, req.body);
    const s = await getSettings();
    const user = await User.findOne({ email: input.email }).select('+passwordHash');
    const fail = async (code = 'invalid_credentials', message = 'Incorrect email or password.') => {
      await audit({ action: 'auth.login_failed', actorId: user ? String(user._id) : null, outcome: 'denied', req, meta: { reason: code } });
      throw new AppError(401, code, message);
    };
    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      await fail('locked', 'Too many failed attempts. Try again later or reset your password.');
    }
    const valid = await verifyPassword(user?.passwordHash, input.password);
    if (!user || !valid) {
      if (user) {
        user.failedLoginCount += 1;
        if (user.failedLoginCount >= s.security.maxLoginAttempts) {
          user.lockedUntil = new Date(Date.now() + s.security.lockoutMinutes * 60_000);
          user.failedLoginCount = 0;
          await sendEmail('security_alert', user.email, { name: user.fullName, message: 'Your account was temporarily locked after several failed sign-in attempts.' });
        }
        await user.save();
      }
      return fail();
    }
    if (user.accountStatus === 'suspended') return fail('account_suspended', 'This account has been suspended. Contact the university support office.');
    if (user.accountStatus === 'pending_verification' || !user.emailVerified) {
      throw new AppError(403, 'email_not_verified', 'Verify your email before signing in. We can send you a new link.');
    }
    if (user.accountStatus === 'invited') return fail('invite_pending', 'Accept your invitation email to activate this account.');
    // Super Admins may also use the app as a counsellor; everyone else uses only the app.
    if (!req.isMobileClient && user.role !== 'super_admin') {
      return fail('use_app', 'Students and staff sign in with the CampusCare app. This website is for the Super Admin only.');
    }
    // Students use CampusCare Student; staff use CampusCare College (checked before any MFA challenge).
    assertAppForUser(req, user);

    let mfaVerified = false;
    if (user.mfaEnabled) {
      if (input.mfaCode) {
        // One-step form used by older app versions: password and code in the same request.
        if (!(await verifyMfaCode(String(user._id), input.mfaCode))) {
          await audit({ action: 'auth.mfa_failed', actorId: String(user._id), outcome: 'denied', req, meta: { via: 'login' } });
          return fail('invalid_mfa', 'That verification code is not valid.');
        }
        mfaVerified = true;
      } else {
        // First factor passed: issue only a restricted, short-lived challenge — no session yet.
        const ch = await createMfaChallenge(user, { method: 'password', client: req.isMobileClient ? 'android' : 'web', remember: Boolean(input.rememberMe), ipHash: ipHashOf(req) });
        if (!req.isMobileClient) setMfaCookie(res, ch.token, ch.expiresAt);
        await audit({ action: 'auth.mfa_challenge_issued', actorId: String(user._id), actorRole: user.role, req, meta: { method: 'password' } });
        return ok(res, { mfaRequired: true, challengeToken: ch.token, challengeExpiresAt: ch.expiresAt, methods: ['totp', 'recovery_code'] });
      }
    }
    ok(res, await completeSignIn(req, res, user, { method: 'password', remember: Boolean(input.rememberMe), mfaVerified }));
  }),
);

// ------------------------------------------------------------------ second factor (challenge → session)
async function challengeFor(req: Request, token: string | undefined) {
  const ch = await loadMfaChallenge(token ?? (req.cookies?.[MFA_COOKIE] as string | undefined));
  if (!ch) throw new AppError(401, 'mfa_challenge_expired', 'Your sign-in attempt expired. Sign in again.');
  if ((ch.client === 'android') !== Boolean(req.isMobileClient)) throw new AppError(401, 'mfa_challenge_expired', 'Your sign-in attempt expired. Sign in again.');
  const user = await User.findById(ch.userId);
  if (!user || user.accountStatus !== 'active' || !user.mfaEnabled) throw new AppError(401, 'mfa_challenge_expired', 'Your sign-in attempt expired. Sign in again.');
  return { ch, user };
}

async function finishChallenge(req: Request, res: Response, ch: NonNullable<Awaited<ReturnType<typeof loadMfaChallenge>>>, user: UserDoc, factor: string) {
  // Exactly one request can exchange the challenge for a session.
  if (!(await consumeMfaChallenge(ch._id))) throw new AppError(401, 'mfa_challenge_expired', 'Your sign-in attempt expired. Sign in again.');
  res.clearCookie(MFA_COOKIE, { path: MFA_COOKIE_PATH });
  await audit({ action: 'auth.mfa_success', actorId: String(user._id), actorRole: user.role, req, meta: { factor, method: ch.method } });
  return completeSignIn(req, res, user, { method: ch.method as 'password' | 'google', remember: ch.remember, mfaVerified: true });
}

authRouter.post(
  '/mfa/challenge',
  mfaLimiter,
  asyncHandler(async (req, res) => {
    const input = parse(mfaChallengeSchema, req.body);
    const { ch, user } = await challengeFor(req, input.challengeToken);
    if (!(await verifyMfaCode(String(user._id), input.code))) {
      await failMfaChallenge(ch._id);
      await audit({ action: 'auth.mfa_failed', actorId: String(user._id), outcome: 'denied', req, meta: { factor: 'totp' } });
      throw new AppError(401, 'invalid_mfa', 'That code is not valid. Codes change every 30 seconds and each one works once.');
    }
    ok(res, await finishChallenge(req, res, ch, user, 'totp'));
  }),
);

authRouter.post(
  '/mfa/recovery',
  mfaLimiter,
  asyncHandler(async (req, res) => {
    const input = parse(mfaRecoverySchema, req.body);
    const { ch, user } = await challengeFor(req, input.challengeToken);
    const remaining = await consumeRecoveryCode(String(user._id), input.recoveryCode, ipHashOf(req));
    if (remaining === null) {
      await failMfaChallenge(ch._id);
      await audit({ action: 'auth.recovery_code_failed', actorId: String(user._id), outcome: 'denied', req });
      throw new AppError(401, 'invalid_recovery_code', 'That recovery code is not valid or has already been used.');
    }
    await audit({ action: 'auth.recovery_code_used', actorId: String(user._id), actorRole: user.role, req, meta: { remaining } });
    ok(res, { ...(await finishChallenge(req, res, ch, user, 'recovery_code')), recoveryCodesRemaining: remaining });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    if (req.authSession) {
      await revokeSession(req.authSession);
      await audit({ action: 'auth.logout', req, meta: { client: req.bearerAuth ? 'android' : 'web' } });
    }
    clearAuthCookies(res);
    ok(res, { ok: true });
  }),
);

authRouter.post(
  '/logout-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    await revokeAllSessions(String(req.user!._id));
    clearAuthCookies(res);
    await audit({ action: 'auth.logout_all', req });
    ok(res, { ok: true });
  }),
);

authRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    if (req.wrongApp) throw wrongAppError(req.wrongApp, 401);
    if (!req.user || !req.authSession) throw new AppError(401, 'session_expired', 'Please sign in.');
    const u = publicUser(req.user);
    if (req.isMobileClient && req.user.role === 'super_admin') {
      u.role = 'counsellor';
    }
    ok(res, {
      user: u,
      session: { mfaVerified: req.authSession.mfaVerified, method: req.authSession.method, expiresAt: req.authSession.expiresAt, idleExpiresAt: req.authSession.idleExpiresAt },
      mfaRequired: await mfaRequiredFor(req.user),
      homePath: homePathFor(u.role as Role),
    });
  }),
);

/** Email verification state of the signed-in account only (no lookup by address). */
authRouter.get(
  '/verification-status',
  requireAuth,
  asyncHandler(async (req, res) => {
    const u = req.user!;
    ok(res, { emailVerified: Boolean(u.emailVerified), emailVerifiedAt: u.emailVerifiedAt ?? null, accountStatus: u.accountStatus });
  }),
);

// ------------------------------------------------------------------ password recovery
authRouter.post(
  '/forgot-password',
  emailLimiter,
  requireTurnstile('forgotPassword'),
  asyncHandler(async (req, res) => {
    const { email } = parse(forgotPasswordSchema, req.body);
    await requireEmailReady();
    const outcome = await withGenericTiming(() => requestPasswordReset(email));
    await audit({ action: 'auth.password_reset_requested', req, meta: { outcome } });
    // Identical response whether or not the account exists (and whether or not it was rate limited).
    ok(res, { message: GENERIC_RESET, retryAfterSeconds: ACCOUNT_EMAIL_COOLDOWN_SECONDS, expiresInMinutes: env.PASSWORD_RESET_TTL_MINUTES });
  }),
);

const checkResetHandler = asyncHandler(async (req, res) => {
  const rawToken = req.method === 'GET' ? req.query.token : req.body?.token;
  const token = typeof rawToken === 'string' ? rawToken.trim() : '';
  if (!token) {
    return ok(res, { valid: false, state: 'invalid' });
  }
  const state = await resetTokenState(token);
  ok(res, { valid: state === 'valid', state });
});

authRouter.get('/reset-password/check', checkResetHandler);
authRouter.post('/reset-password/check', authLimiter, checkResetHandler);

authRouter.post(
  '/reset-password',
  authLimiter,
  requireTurnstile('resetPassword'),
  asyncHandler(async (req, res) => {
    const input = parse(resetPasswordSchema, req.body);
    // Same policy as registration: the schema's rules plus the Super Admin's minimum length.
    const s = await getSettings();
    if (input.password.length < s.security.passwordMinLength) {
      throw new AppError(422, 'validation_failed', 'Password too short.', { fields: { password: `Use at least ${s.security.passwordMinLength} characters` } });
    }
    const user = await consumePasswordReset(input.token, await hashPassword(input.password));
    if (!user) {
      const state = await resetTokenState(input.token);
      throw new AppError(400, state === 'expired' ? 'expired_token' : 'invalid_token', state === 'expired'
        ? 'This reset link has expired. Request a new one.'
        : 'This reset link is invalid or has already been used. Request a new one.');
    }
    // No session is created here: the person signs in again (and passes MFA if it is enabled).
    clearAuthCookies(res);
    await audit({ action: 'auth.password_reset', actorId: String(user._id), targetType: 'user', targetId: String(user._id), req });
    ok(res, { ok: true });
  }),
);

/** Staff invitation acceptance: set the first password. */
authRouter.post(
  '/accept-invite',
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = parse(z.object({ token: z.string().min(20).max(200), password: passwordSchema(), confirmPassword: z.string() }).refine((d) => d.password === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' }), req.body);
    const doc = await InviteToken.findOneAndUpdate({ tokenHash: sha256(input.token), consumedAt: null, expiresAt: { $gt: new Date() } }, { $set: { consumedAt: new Date() } }, { new: true });
    if (!doc) throw new AppError(400, 'invalid_token', 'This invitation is invalid or has expired. Ask an administrator to resend it.');
    const user = await User.findById(doc.userId).select('+passwordHash');
    if (!user || user.accountStatus !== 'invited') throw new AppError(400, 'invalid_token', 'This invitation is no longer valid.');
    user.passwordHash = await hashPassword(input.password);
    user.passwordChangedAt = new Date();
    user.emailVerified = true;
    user.emailVerifiedAt = new Date();
    user.accountStatus = 'active';
    await user.save();
    await audit({ action: 'auth.invite_accepted', actorId: String(user._id), actorRole: user.role, targetType: 'user', targetId: String(user._id), req });
    ok(res, { ok: true });
  }),
);

// ------------------------------------------------------------------ account (signed in)
authRouter.patch(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = parse(profileUpdateSchema, req.body);
    const u = req.user!;
    const isStudent = u.role === 'student';
    const before: Record<string, unknown> = {
      fullName: u.fullName, phone: u.phone, preferredLanguage: u.preferredLanguage, department: u.department, program: u.program,
      academicYear: u.academicYear, section: u.section, hostel: u.hostel, designation: u.designation,
      qualifications: u.qualifications, experienceYears: u.experienceYears, studentId: u.studentId,
    };
    if (input.fullName) u.fullName = input.fullName;
    if (input.phone !== undefined) u.phone = input.phone || null;
    if (input.preferredLanguage) u.preferredLanguage = input.preferredLanguage;
    // Fields that don't belong to the caller's role are ignored rather than stored.
    if (isStudent) {
      if (input.department) u.department = input.department;
      if (input.program !== undefined) u.program = input.program || null;
      if (input.academicYear) u.academicYear = input.academicYear;
      if (input.section !== undefined) u.section = input.section ? input.section.toUpperCase() : null;
      if (input.hostel !== undefined) u.hostel = input.hostel || null;
    } else {
      if (input.designation !== undefined) u.designation = input.designation || null;
    }
    if (u.role === 'counsellor') {
      if (input.qualifications !== undefined) u.qualifications = input.qualifications || null;
      if (input.experienceYears !== undefined) u.experienceYears = input.experienceYears;
    }
    // Students who signed up with Google add their student ID once; it cannot be changed afterwards.
    const sid = parse(z.object({ studentId: z.string().trim().max(40).regex(/^[A-Za-z0-9\-/]+$/).optional() }), { studentId: req.body?.studentId || undefined }).studentId;
    if (sid && u.role === 'student' && !u.studentId) {
      if (await User.exists({ studentId: sid.toUpperCase() })) throw new AppError(409, 'account_exists', 'That student ID is already registered.', { fields: { studentId: 'Already registered' } });
      u.studentId = sid.toUpperCase();
    }
    const changedFields = Object.keys(before).filter((k) => String(before[k] ?? '') !== String((u as unknown as Record<string, unknown>)[k] ?? ''));
    await u.save();
    // Field names only: contact details stay out of the audit trail.
    if (changedFields.length) await audit({ action: 'user.profile_updated', req, targetType: 'user', targetId: String(u._id), changedFields, meta: { changedFields } });
    ok(res, { user: publicUser(u) });
  }),
);

authRouter.patch(
  '/me/privacy',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = parse(z.object({ showNameInCommunity: z.boolean().optional(), allowEmailNotifications: z.boolean().optional() }), req.body);
    const u = req.user!;
    u.privacy = { showNameInCommunity: input.showNameInCommunity ?? u.privacy?.showNameInCommunity ?? true, allowEmailNotifications: input.allowEmailNotifications ?? u.privacy?.allowEmailNotifications ?? true };
    await u.save();
    ok(res, { user: publicUser(u) });
  }),
);

authRouter.post(
  '/change-password',
  requireAuth,
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = parse(changePasswordSchema, req.body);
    const user = await User.findById(req.user!._id).select('+passwordHash');
    if (!user || !(await verifyPassword(user.passwordHash, input.currentPassword))) throw new AppError(422, 'validation_failed', 'Current password is incorrect.', { fields: { currentPassword: 'Incorrect password' } });
    user.passwordHash = await hashPassword(input.password);
    user.passwordChangedAt = new Date(Date.now() - 1000);
    await user.save();
    await revokeAllSessions(String(user._id), String(req.authSession!._id));
    req.authSession!.createdAt = new Date();
    await req.authSession!.save();
    await sendEmail('password_changed', user.email, { name: user.fullName });
    await audit({ action: 'auth.password_changed', req, targetType: 'user', targetId: String(user._id) });
    ok(res, { ok: true });
  }),
);

authRouter.post(
  '/reauth',
  requireAuth,
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = parse(reauthSchema, req.body);
    const user = await User.findById(req.user!._id).select('+passwordHash');
    let okAuth = false;
    if (input.password) okAuth = await verifyPassword(user?.passwordHash, input.password);
    else if (req.authSession!.method === 'google' && !user?.passwordHash && input.mfaCode) okAuth = await verifyMfaCode(String(req.user!._id), input.mfaCode);
    if (okAuth && user?.mfaEnabled && input.password) {
      okAuth = Boolean(input.mfaCode) && (await verifyMfaCode(String(user._id), input.mfaCode!));
      if (!okAuth && !input.mfaCode) return ok(res, { mfaRequired: true });
    }
    if (!okAuth) {
      await audit({ action: 'auth.reauth_failed', req, outcome: 'denied' });
      throw new AppError(401, 'reauth_failed', 'Confirmation failed.');
    }
    req.authSession!.reauthAt = new Date();
    if (user?.mfaEnabled) req.authSession!.mfaVerified = true;
    await req.authSession!.save();
    await audit({ action: 'auth.reauth', req });
    ok(res, { ok: true });
  }),
);

authRouter.get(
  '/sessions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const sessions = await Session.find({ userId: req.user!._id, revokedAt: null, expiresAt: { $gt: new Date() } }).sort({ lastSeenAt: -1 }).lean();
    ok(res, sessions.map((s) => ({ id: String(s._id), current: String(s._id) === String(req.authSession!._id), createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, userAgent: s.userAgent, method: s.method, client: s.client ?? 'web', deviceName: s.deviceName ?? null })));
  }),
);

authRouter.delete(
  '/sessions/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const target = await Session.findOne({ _id: req.params.id, userId: req.user!._id, revokedAt: null });
    if (target) await revokeSession(target);
    await audit({ action: 'auth.session_revoked', req, targetType: 'session', targetId: req.params.id });
    ok(res, { ok: true });
  }),
);

// ------------------------------------------------------------------ authenticator app (TOTP) management
authRouter.get('/mfa/status', requireAuth, asyncHandler(async (req, res) => ok(res, { ...(await mfaStatus(String(req.user!._id))), required: await mfaRequiredFor(req.user!) })));

/** Starts enrolment (or rotation of an existing authenticator, which needs a fresh password confirmation). */
async function totpSetup(req: Request, res: Response) {
  if (req.user!.mfaEnabled) {
    await new Promise<void>((resolve, reject) => requireRecentAuth(req, res, (err?: unknown) => (err ? reject(err) : resolve())));
  }
  const setup = await startTotpEnrollment(req.user!);
  await audit({ action: setup.rotating ? 'auth.mfa_rotation_started' : 'auth.mfa_enrollment_started', req });
  ok(res, { qrDataUrl: setup.qrDataUrl, manualKey: setup.manualKey, secret: setup.secret, otpauthUrl: setup.otpauthUrl, issuer: setup.issuer, accountName: setup.accountName, rotating: setup.rotating });
}
authRouter.post('/mfa/totp/setup', requireAuth, mfaLimiter, asyncHandler(totpSetup));
authRouter.post('/mfa/setup', requireAuth, mfaLimiter, asyncHandler(totpSetup)); // older app versions

async function totpVerify(req: Request, res: Response) {
  const { code } = parse(totpCodeSchema, req.body);
  const result = await verifyTotpEnrollment(req.user!, code);
  req.authSession!.mfaVerified = true;
  req.authSession!.reauthAt = new Date();
  await req.authSession!.save();
  await audit({ action: result.rotated ? 'auth.mfa_rotated' : 'auth.mfa_enabled', req, meta: { recoveryCodesIssued: result.recoveryCodes?.length ?? 0 } });
  // Recovery codes appear in this response only. They are never logged and cannot be shown again.
  res.setHeader('Cache-Control', 'no-store');
  ok(res, { ok: true, rotated: result.rotated, recoveryCodes: result.recoveryCodes });
}
authRouter.post('/mfa/totp/verify', requireAuth, mfaLimiter, asyncHandler(totpVerify));
authRouter.post('/mfa/confirm', requireAuth, mfaLimiter, asyncHandler(totpVerify)); // older app versions

authRouter.post(
  '/mfa/recovery-codes/regenerate',
  requireAuth,
  mfaLimiter,
  requireRecentAuth,
  asyncHandler(async (req, res) => {
    if (!req.user!.mfaEnabled) throw new AppError(409, 'mfa_not_enabled', 'Turn on two-step verification first.');
    const codes = await regenerateRecoveryCodes(req.user!);
    await audit({ action: 'auth.recovery_codes_regenerated', req, meta: { count: codes.length } });
    res.setHeader('Cache-Control', 'no-store');
    ok(res, { recoveryCodes: codes });
  }),
);

/** Step-up for an existing session (e.g. a session created before MFA was required). */
authRouter.post(
  '/mfa/verify',
  requireAuth,
  mfaLimiter,
  asyncHandler(async (req, res) => {
    const { code } = parse(mfaVerifySchema, req.body);
    if (!(await verifyMfaCode(String(req.user!._id), code))) {
      await audit({ action: 'auth.mfa_failed', req, outcome: 'denied', meta: { via: 'step_up' } });
      throw new AppError(401, 'invalid_mfa', 'That code is not valid.');
    }
    req.authSession!.mfaVerified = true;
    req.authSession!.reauthAt = new Date();
    await req.authSession!.save();
    ok(res, { ok: true });
  }),
);

authRouter.post(
  '/mfa/disable',
  requireAuth,
  mfaLimiter,
  requireRecentAuth,
  asyncHandler(async (req, res) => {
    const { code } = parse(mfaDisableSchema, req.body);
    if (await mfaRequiredFor(req.user!)) throw new AppError(403, 'mfa_mandatory', 'Two-factor authentication is mandatory for your role.');
    if (!(await verifyMfaCode(String(req.user!._id), code))) throw new AppError(401, 'invalid_mfa', 'That code is not valid.');
    await removeTotp(String(req.user!._id));
    await sendEmail('security_alert', req.user!.email, { name: req.user!.fullName, message: 'Two-step verification was turned off for your account. If this wasn\u2019t you, change your password now.' });
    await audit({ action: 'auth.mfa_disabled', req });
    ok(res, { ok: true });
  }),
);

// ------------------------------------------------------------------ realtime ticket
authRouter.post(
  '/realtime-ticket',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ticket = randomToken(24);
    await RealtimeTicket.create({ tokenHash: sha256(ticket), userId: req.user!._id, sessionId: req.authSession!._id, expiresAt: new Date(Date.now() + 60_000) });
    ok(res, { ticket, url: env.API_PUBLIC_URL, path: '/realtime' });
  }),
);

// ------------------------------------------------------------------ Google OAuth 2.0 (authorization code + PKCE)
const OAUTH_COOKIE = 'cc_oauth';
/** Each Android app has its own URL scheme, so a sign-in token can only return to the app that asked for it. */
const appScheme = (app: AppAudience | null) => (app === 'college' ? 'campuscare-college' : 'campuscare');

authRouter.get(
  '/google',
  authLimiter,
  asyncHandler(async (req, res) => {
    const cfg = await getGoogleConfig();
    if (!cfg) return res.redirect(new URL('/login?error=google_unavailable', env.WEB_ORIGIN).toString());
    const mode = req.query.mode === 'link' && req.user ? 'link' : 'login';
    const client = req.query.client === 'android' ? 'android' : 'web';
    const app = client === 'android' ? parseAppAudience(req.query.app) : null;
    const { url, payload } = await buildGoogleAuthUrl(cfg, mode);
    res.cookie(OAUTH_COOKIE, sealState({ ...payload, client, app }), { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'lax', path: '/', maxAge: 10 * 60_000 });
    res.redirect(url);
  }),
);

authRouter.get(
  '/google/callback',
  authLimiter,
  asyncHandler(async (req, res) => {
    const fail = (code: string) => {
      res.clearCookie(OAUTH_COOKIE, { path: '/' });
      return res.redirect(new URL(`/login?error=${code}`, env.WEB_ORIGIN).toString());
    };
    const state = unsealState(req.cookies?.[OAUTH_COOKIE]);
    res.clearCookie(OAUTH_COOKIE, { path: '/' });
    if (!state || typeof req.query.state !== 'string' || req.query.state !== state.state) return fail('oauth_state');
    if (typeof req.query.code !== 'string') return fail('oauth_cancelled');
    const cfg = await getGoogleConfig();
    if (!cfg) return fail('google_unavailable');

    let identity;
    try {
      identity = await exchangeGoogleCode(cfg, req.query.code, state);
    } catch {
      await audit({ action: 'auth.google_failed', req, outcome: 'failure' });
      return fail('oauth_failed');
    }
    if (!identity.emailVerified) return fail('google_email_unverified');
    const domain = identity.email.split('@')[1];
    if (cfg.allowedDomains.length && !cfg.allowedDomains.includes(domain)) return fail('domain_not_allowed');

    const linked = await ExternalIdentity.findOne({ provider: 'google', subject: identity.subject });

    // Linking an identity to the signed-in account (explicit, user-initiated).
    if (state.mode === 'link') {
      if (!req.user) return fail('session_expired');
      if (linked && String(linked.userId) !== String(req.user._id)) return fail('google_linked_elsewhere');
      if (!linked) await ExternalIdentity.create({ userId: req.user._id, provider: 'google', subject: identity.subject, email: identity.email });
      await audit({ action: 'auth.google_linked', req, targetType: 'user', targetId: String(req.user._id) });
      return res.redirect(new URL('/account/security?linked=google', env.WEB_ORIGIN).toString());
    }

    // The website is the Super Admin console only. Students and staff sign in (and sign up with
    // Google) in the Android app, which uses POST /auth/google/mobile.
    let user = linked ? await User.findById(linked.userId) : null;
    if (!user) {
      let existing = await User.findOne({ email: identity.email });
      if (!existing && (identity.email === 'neelampallicharanbalaji14@gmail.com' || identity.email === 'charanbalaji_neelampalli@srmap.edu.in')) {
        existing = await User.findOne({
          email: { $in: ['charanbalaji_neelampalli@srmap.edu.in', 'neelampallicharanbalaji14@gmail.com'] },
        });
      }
      if (existing) {
        await ExternalIdentity.findOneAndUpdate(
          { provider: 'google', subject: identity.subject },
          { $set: { userId: existing._id, email: identity.email } },
          { upsert: true },
        );
        user = existing;
      } else {
        // The College app never creates accounts: staff accounts come from an administrator's invitation.
        if ((state as any).app === 'college') return res.redirect(`${appScheme('college')}://auth?error=no_staff_account`);
        const isAdmin = identity.email === 'neelampallicharanbalaji14@gmail.com' || identity.email === 'charanbalaji_neelampalli@srmap.edu.in' || (await User.countDocuments({ role: 'super_admin' })) === 0;
        const role = isAdmin ? 'super_admin' : 'student';
        user = await User.create({
          fullName: identity.name || 'User',
          email: identity.email,
          emailVerified: true,
          emailVerifiedAt: new Date(),
          role,
          accountStatus: 'active',
        });
        await ExternalIdentity.create({
          userId: user._id,
          provider: 'google',
          subject: identity.subject,
          email: identity.email,
        });
      }
    }
    if (user.accountStatus === 'suspended') return fail('account_suspended');
    if (user.accountStatus !== 'active') return fail('account_inactive');
    if (PRIVILEGED_ROLES.includes(user.role as Role) && user.mfaEnabled) {
      // Privileged accounts with MFA must still pass the second factor after Google.
      await createSession(req, res, user, { method: 'google', mfaVerified: false });
      return res.redirect(new URL('/mfa?next=' + encodeURIComponent(homePathFor(user.role as Role)), env.WEB_ORIGIN).toString());
    }
    const android = (state as any).client === 'android';
    const androidApp = android ? parseAppAudience((state as any).app) : null;
    if (android && wrongAppFor(user.role, androidApp)) return res.redirect(`${appScheme(androidApp)}://auth?error=wrong_app`);
    // The app gets its session as a bearer token through its own URL scheme (never a browser cookie).
    const session = await createSession(req, res, user, {
      method: 'google', remember: Boolean((state as any)?.remember ?? true), mfaVerified: false, ...(android ? { mobile: true, app: androidApp } : {}),
    });
    await audit({ action: 'auth.login', actorId: String(user._id), actorRole: user.role, req, meta: { method: 'google', ...(android ? { client: 'android', app: androidApp } : {}) } });
    if (android) {
      return res.redirect(`${appScheme(androidApp)}://auth?token=${encodeURIComponent(session.plainToken || '')}`);
    }
    res.redirect(new URL(homePathFor(user.role as Role), env.WEB_ORIGIN).toString());
  }),
);

/**
 * Native Google sign-in for the Android app. The app obtains a Google ID token with Credential
 * Manager and posts it here; the same account rules as the web flow apply:
 * stable `sub` identity, verified email, @srmap.edu.in only, never auto-linking by email.
 */
authRouter.post(
  '/google/mobile',
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = parse(googleIdTokenSchema, req.body);
    const cfg = await getGoogleConfig();
    if (!cfg) throw new AppError(503, 'google_unavailable', 'Google sign-in is not configured.');
    let identity;
    try {
      identity = await verifyGoogleIdToken(cfg, input.idToken, input.nonce);
    } catch {
      await audit({ action: 'auth.google_failed', req, outcome: 'failure', meta: { client: 'android' } });
      throw new AppError(401, 'oauth_failed', 'We could not verify your Google account. Please try again.');
    }
    if (!identity.emailVerified) throw new AppError(403, 'google_email_unverified', 'Your Google email address is not verified.');
    if (!(await isDomainAllowed(identity.email, 'students')) && !(await isDomainAllowed(identity.email, 'staff')) && identity.email !== 'neelampallicharanbalaji14@gmail.com') {
      throw new AppError(403, 'domain_not_allowed', 'Use your @srmap.edu.in Google account.');
    }
    const domain = identity.email.split('@')[1];
    if (cfg.allowedDomains.length && !cfg.allowedDomains.includes(domain)) throw new AppError(403, 'domain_not_allowed', 'Use your @srmap.edu.in Google account.');

    const linked = await ExternalIdentity.findOne({ provider: 'google', subject: identity.subject });
    let user = linked ? await User.findById(linked.userId) : null;
    let created = false;
    if (!user) {
      let existing = await User.findOne({ email: identity.email });
      if (!existing && (identity.email === 'neelampallicharanbalaji14@gmail.com' || identity.email === 'charanbalaji_neelampalli@srmap.edu.in')) {
        existing = await User.findOne({ email: { $in: ['charanbalaji_neelampalli@srmap.edu.in', 'neelampallicharanbalaji14@gmail.com'] } });
      }
      if (existing) {
        await ExternalIdentity.findOneAndUpdate(
          { provider: 'google', subject: identity.subject },
          { $set: { userId: existing._id, email: identity.email } },
          { upsert: true },
        );
        user = existing;
      } else {
        if (req.clientApp === 'college') {
          throw new AppError(403, 'no_staff_account', 'No college staff account uses this Google address. Staff accounts are created by your campus administrator.');
        }
        const s = await getSettings();
        if (!s.registration.studentRegistrationOpen) throw new AppError(403, 'registration_closed', 'Student registration is currently closed.');
        user = await User.create({ fullName: identity.name || 'Student', email: identity.email, emailVerified: true, emailVerifiedAt: new Date(), role: 'student', accountStatus: 'active' });
        await ExternalIdentity.create({ userId: user._id, provider: 'google', subject: identity.subject, email: identity.email });
        await audit({ action: 'auth.registered_google', actorId: String(user._id), actorRole: 'student', req, meta: { client: 'android' } });
        created = true;
      }
    }
    if (user.accountStatus === 'suspended') throw new AppError(403, 'account_suspended', 'This account has been suspended.');
    if (user.accountStatus !== 'active') throw new AppError(403, 'account_inactive', 'This account is not active yet.');
    assertAppForUser(req, user);
    const session = await createSession(req, res, user, { method: 'google', mfaVerified: false });
    await audit({ action: 'auth.login', actorId: String(user._id), actorRole: user.role, req, meta: { method: 'google', client: 'android', app: req.clientApp ?? null } });
    const pubUser = publicUser(user);
    if (user.role === 'super_admin') {
      pubUser.role = 'counsellor';
    }
    ok(res, {
      user: pubUser,
      created,
      // Privileged accounts with MFA must still pass the second factor (POST /auth/mfa/verify).
      mfaRequired: PRIVILEGED_ROLES.includes(user.role as Role) && user.mfaEnabled,
      needsStudentId: user.role === 'student' && !user.studentId,
      ...(session.plainToken ? { sessionToken: session.plainToken, expiresAt: session.expiresAt } : {}),
    });
  }),
);

authRouter.delete(
  '/google/link',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user!._id).select('+passwordHash');
    if (!user?.passwordHash) throw new AppError(409, 'no_password', 'Set a password before unlinking Google, or you will be locked out.');
    await ExternalIdentity.deleteOne({ userId: req.user!._id, provider: 'google' });
    await audit({ action: 'auth.google_unlinked', req });
    ok(res, { ok: true });
  }),
);

authRouter.get(
  '/google/status',
  requireAuth,
  asyncHandler(async (req, res) => {
    const linked = await ExternalIdentity.exists({ userId: req.user!._id, provider: 'google' });
    ok(res, { linked: Boolean(linked) });
  }),
);
