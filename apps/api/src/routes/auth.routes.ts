import { Router } from 'express';
import {
  PRIVILEGED_ROLES, googleIdTokenSchema, changePasswordSchema, forgotPasswordSchema, homePathFor, loginSchema, mfaVerifySchema,
  passwordSchema, profileUpdateSchema, reauthSchema, registerSchema, resendVerificationSchema, resetPasswordSchema, tokenSchema, type Role,
} from '@campuscare/shared';
import { z } from 'zod';
import { AppError, asyncHandler, ok, parse } from '../lib/http';
import { hashPassword, randomToken, sha256, verifyPassword } from '../lib/crypto';
import { ExternalIdentity, InviteToken, Session, User, publicUser } from '../models/user';
import { RealtimeTicket } from '../models/platform';
import {
  CSRF_COOKIE, checkResetToken, clearAuthCookies, confirmMfaEnrollment, consumeEmailVerification, consumePasswordReset, createSession,
  isDomainAllowed, issueEmailVerification, mfaRequiredFor, requestPasswordReset, revokeAllSessions, revokeSession, setCsrfCookie,
  startMfaEnrollment, verifyMfaCode,
} from '../services/auth.service';
import { buildGoogleAuthUrl, exchangeGoogleCode, getGoogleConfig, sealState, unsealState, verifyGoogleIdToken } from '../services/google.service';
import { getSettings, publicSettings } from '../services/settings.service';
import { audit } from '../services/audit.service';
import { sendEmail } from '../services/email/email.service';
import { requireAuth } from '../middleware/auth';
import { authLimiter, emailLimiter, requireTurnstile } from '../middleware/security';
import { env } from '../config/env';

export const authRouter = Router();
const GENERIC_RESET = 'If an account exists for that email, we have sent a password reset link.';
const GENERIC_RESEND = 'If that account needs verification, we have sent a new link.';

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
    if (input.password.length < s.security.passwordMinLength) throw new AppError(422, 'validation_failed', 'Password too short.', { fields: { password: `Use at least ${s.security.passwordMinLength} characters` } });
    // Any "role" in the body is ignored — public registration always creates a student.
    if (!(await isDomainAllowed(input.email, 'students'))) {
      throw new AppError(422, 'validation_failed', 'Use your university email address.', { fields: { email: 'Registration is limited to approved university email domains.' } });
    }
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
    const user = await User.findOne({ email });
    if (user && !user.emailVerified && user.accountStatus === 'pending_verification') await issueEmailVerification(user);
    ok(res, { message: GENERIC_RESEND });
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

    let mfaVerified = false;
    if (user.mfaEnabled) {
      if (!input.mfaCode) return ok(res, { mfaRequired: true });
      if (!(await verifyMfaCode(String(user._id), input.mfaCode))) return fail('invalid_mfa', 'That verification code is not valid.');
      mfaVerified = true;
    }
    if (req.isMobileClient && user.role === 'super_admin') {
      // Allow Super Admin to also access the mobile client as a Consultant / Counsellor
    } else if (!req.isMobileClient && user.role !== 'super_admin') {
      // The website is the Super Admin console only; everyone else uses the Android app.
      return fail('use_app', 'Students and staff sign in with the CampusCare app. This website is for the Super Admin only.');
    }
    const session = await createSession(req, res, user, { remember: input.rememberMe, method: 'password', mfaVerified });
    await audit({ action: 'auth.login', actorId: String(user._id), actorRole: user.role, req, meta: { client: req.isMobileClient ? 'android' : 'web' } });
    const needsMfaSetup = !user.mfaEnabled && (await mfaRequiredFor(user));
    const pubUser = publicUser(user);
    if (req.isMobileClient && user.role === 'super_admin') {
      pubUser.role = 'counsellor';
    }
    ok(res, {
      user: pubUser,
      redirectTo: needsMfaSetup ? '/account/security?setup=mfa' : homePathFor(pubUser.role as Role),
      needsMfaSetup,
      ...(session.plainToken ? { sessionToken: session.plainToken, expiresAt: session.expiresAt } : {}),
    });
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

// ------------------------------------------------------------------ password recovery
authRouter.post(
  '/forgot-password',
  emailLimiter,
  requireTurnstile('forgotPassword'),
  asyncHandler(async (req, res) => {
    const { email } = parse(forgotPasswordSchema, req.body);
    await requestPasswordReset(email);
    await audit({ action: 'auth.password_reset_requested', req });
    ok(res, { message: GENERIC_RESET }); // identical response whether or not the account exists
  }),
);

authRouter.post(
  '/reset-password/check',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { token } = parse(tokenSchema, req.body);
    ok(res, { valid: await checkResetToken(token) });
  }),
);

authRouter.post(
  '/reset-password',
  authLimiter,
  requireTurnstile('resetPassword'),
  asyncHandler(async (req, res) => {
    const input = parse(resetPasswordSchema, req.body);
    const user = await consumePasswordReset(input.token, await hashPassword(input.password));
    if (!user) throw new AppError(400, 'invalid_token', 'This reset link is invalid, expired or already used. Request a new one.');
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
    if (input.fullName) u.fullName = input.fullName;
    if (input.phone !== undefined) u.phone = input.phone || null;
    if (input.department) u.department = input.department;
    if (input.academicYear) u.academicYear = input.academicYear;
    if (input.hostel !== undefined) u.hostel = input.hostel || null;
    // Students who signed up with Google add their student ID once; it cannot be changed afterwards.
    const sid = parse(z.object({ studentId: z.string().trim().max(40).regex(/^[A-Za-z0-9\-/]+$/).optional() }), { studentId: req.body?.studentId || undefined }).studentId;
    if (sid && u.role === 'student' && !u.studentId) {
      if (await User.exists({ studentId: sid.toUpperCase() })) throw new AppError(409, 'account_exists', 'That student ID is already registered.', { fields: { studentId: 'Already registered' } });
      u.studentId = sid.toUpperCase();
    }
    await u.save();
    await audit({ action: 'user.profile_updated', req, targetType: 'user', targetId: String(u._id) });
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

// ------------------------------------------------------------------ MFA
authRouter.post(
  '/mfa/setup',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user!.mfaEnabled) throw new AppError(409, 'mfa_enabled', 'Two-factor authentication is already on.');
    const { qrDataUrl, secret } = await startMfaEnrollment(req.user!);
    ok(res, { qrDataUrl, secret });
  }),
);

authRouter.post(
  '/mfa/confirm',
  requireAuth,
  authLimiter,
  asyncHandler(async (req, res) => {
    const { code } = parse(mfaVerifySchema, req.body);
    if (!(await confirmMfaEnrollment(String(req.user!._id), code))) throw new AppError(422, 'validation_failed', 'That code is not valid.', { fields: { code: 'Check your authenticator app and try again' } });
    req.authSession!.mfaVerified = true;
    await req.authSession!.save();
    await audit({ action: 'auth.mfa_enabled', req });
    ok(res, { ok: true });
  }),
);

authRouter.post(
  '/mfa/verify',
  requireAuth,
  authLimiter,
  asyncHandler(async (req, res) => {
    const { code } = parse(mfaVerifySchema, req.body);
    if (!(await verifyMfaCode(String(req.user!._id), code))) throw new AppError(401, 'invalid_mfa', 'That code is not valid.');
    req.authSession!.mfaVerified = true;
    req.authSession!.reauthAt = new Date();
    await req.authSession!.save();
    ok(res, { ok: true });
  }),
);

authRouter.post(
  '/mfa/disable',
  requireAuth,
  authLimiter,
  asyncHandler(async (req, res) => {
    const { code } = parse(mfaVerifySchema, req.body);
    if (await mfaRequiredFor(req.user!)) throw new AppError(403, 'mfa_mandatory', 'Two-factor authentication is mandatory for your role.');
    if (!(await verifyMfaCode(String(req.user!._id), code))) throw new AppError(401, 'invalid_mfa', 'That code is not valid.');
    await User.updateOne({ _id: req.user!._id }, { $set: { mfaEnabled: false, mfaSecretEnc: null } });
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

authRouter.get(
  '/google',
  authLimiter,
  asyncHandler(async (req, res) => {
    const cfg = await getGoogleConfig();
    if (!cfg) return res.redirect(new URL('/login?error=google_unavailable', env.WEB_ORIGIN).toString());
    const mode = req.query.mode === 'link' && req.user ? 'link' : 'login';
    const { url, payload } = await buildGoogleAuthUrl(cfg, mode);
    res.cookie(OAUTH_COOKIE, sealState(payload), { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'lax', path: '/', maxAge: 10 * 60_000 });
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
    const user = linked ? await User.findById(linked.userId) : null;
    if (!user) {
      const existing = await User.findOne({ email: identity.email });
      if (existing && existing.role === 'super_admin') {
        // Never merge on email alone: the Super Admin must sign in with their password and link Google from Account security.
        await audit({ action: 'auth.google_link_required', actorId: String(existing._id), req, outcome: 'denied' });
        return fail('google_link_required');
      }
      return fail('use_app');
    }
    if (user.role !== 'super_admin') return fail('use_app');
    if (user.accountStatus === 'suspended') return fail('account_suspended');
    if (user.accountStatus !== 'active') return fail('account_inactive');
    if (PRIVILEGED_ROLES.includes(user.role as Role) && user.mfaEnabled) {
      // Privileged accounts with MFA must still pass the second factor after Google.
      await createSession(req, res, user, { method: 'google', mfaVerified: false });
      return res.redirect(new URL('/mfa?next=' + encodeURIComponent(homePathFor(user.role as Role)), env.WEB_ORIGIN).toString());
    }
    await createSession(req, res, user, { method: 'google', mfaVerified: false });
    await audit({ action: 'auth.login', actorId: String(user._id), actorRole: user.role, req, meta: { method: 'google' } });
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
    if (!(await isDomainAllowed(identity.email, 'students')) && !(await isDomainAllowed(identity.email, 'staff'))) {
      throw new AppError(403, 'domain_not_allowed', 'Use your @srmap.edu.in Google account.');
    }
    const domain = identity.email.split('@')[1];
    if (cfg.allowedDomains.length && !cfg.allowedDomains.includes(domain)) throw new AppError(403, 'domain_not_allowed', 'Use your @srmap.edu.in Google account.');

    const linked = await ExternalIdentity.findOne({ provider: 'google', subject: identity.subject });
    let user = linked ? await User.findById(linked.userId) : null;
    let created = false;
    if (!user) {
      const existing = await User.findOne({ email: identity.email });
      if (existing) {
        await audit({ action: 'auth.google_link_required', actorId: String(existing._id), req, outcome: 'denied' });
        throw new AppError(409, 'google_link_required', 'An account already exists for this email. Sign in with your password, then link Google in Profile → Security.');
      }
      const s = await getSettings();
      if (!s.registration.studentRegistrationOpen) throw new AppError(403, 'registration_closed', 'Student registration is currently closed.');
      if (!(await isDomainAllowed(identity.email, 'students'))) throw new AppError(403, 'domain_not_allowed', 'Use your @srmap.edu.in Google account.');
      user = await User.create({ fullName: identity.name, email: identity.email, emailVerified: true, emailVerifiedAt: new Date(), role: 'student', accountStatus: 'active' });
      await ExternalIdentity.create({ userId: user._id, provider: 'google', subject: identity.subject, email: identity.email });
      await audit({ action: 'auth.registered_google', actorId: String(user._id), actorRole: 'student', req, meta: { client: 'android' } });
      created = true;
    }
    if (user.accountStatus === 'suspended') throw new AppError(403, 'account_suspended', 'This account has been suspended.');
    if (user.accountStatus !== 'active') throw new AppError(403, 'account_inactive', 'This account is not active yet.');
    if (user.role === 'super_admin') throw new AppError(403, 'use_website', 'Super Admin accounts sign in on the CampusCare website.');
    const session = await createSession(req, res, user, { method: 'google', mfaVerified: false });
    await audit({ action: 'auth.login', actorId: String(user._id), actorRole: user.role, req, meta: { method: 'google', client: 'android' } });
    ok(res, {
      user: publicUser(user),
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
