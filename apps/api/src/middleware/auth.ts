import { User } from '../models/user';
import type { NextFunction, Request, Response } from 'express';
import { hasPermission, parseAppAudience, type Permission, type Role } from '@campuscare/shared';
import { AppError, forbidden, unauthorized } from '../lib/http';
import {
  MOBILE_APP_HEADER, MOBILE_CLIENT_HEADER, SESSION_COOKIE, clearAuthCookies, mfaRequiredFor, resolveSession, revokeSession, wrongAppError, wrongAppFor,
} from '../services/auth.service';
import { getSettings } from '../services/settings.service';
import { audit } from '../services/audit.service';
import { isPendingApplicant } from '../services/auth.service';

/** The only endpoints a staff applicant's restricted session can use before final approval. */
const APPLICANT_ENDPOINTS = new Set([
  'GET /api/v1/auth/me',
  'POST /api/v1/auth/logout',
  'POST /api/v1/auth/verification-evidence',
  'GET /api/v1/auth/verification-evidence/status',
  'GET /api/v1/auth/staff-registration/me',
  'PATCH /api/v1/auth/staff-registration/me',
]);

/** Loads the session (if any) for every request. Never trusts a role sent by the browser. */
export async function loadSession(req: Request, res: Response, next: NextFunction) {
  try {
    const cookieToken = req.cookies?.[SESSION_COOKIE] as string | undefined;
    const authz = req.headers.authorization;
    const bearer = typeof authz === 'string' && authz.startsWith('Bearer ') ? authz.slice(7).trim() : undefined;
    // The Android app identifies itself and never sends cookies; its sessions are bearer tokens.
    req.isMobileClient = req.headers[MOBILE_CLIENT_HEADER] === 'android' && !cookieToken;
    // CampusCare Student / CampusCare College. Older app builds send no app header and keep working.
    if (req.isMobileClient) req.clientApp = parseAppAudience(req.headers[MOBILE_APP_HEADER]) ?? undefined;
    const token = cookieToken ?? bearer;
    if (token) {
      const resolved = await resolveSession(token);
      // A session belongs to the app that created it, and an account only to the app for its role:
      // a student token can never be used by the College app (or a staff token by the Student app).
      const wrongApp = resolved
        ? wrongAppFor(resolved.user.role, resolved.session.app as 'student' | 'college' | null) ?? wrongAppFor(resolved.user.role, req.clientApp)
        : null;
      if (resolved && wrongApp) {
        // Useless in this app from now on: end it (and its push registration) so the phone signs out.
        req.wrongApp = wrongApp;
        await revokeSession(resolved.session);
      } else if (resolved) {
        req.user = resolved.user;
        req.authSession = resolved.session;
        req.bearerAuth = !cookieToken;
      } else if (cookieToken) {
        clearAuthCookies(res);
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.wrongApp) return next(wrongAppError(req.wrongApp, 401));
  if (!req.user || !req.authSession) return next(new AppError(401, 'session_expired', 'Your session has expired. Please sign in again.'));

  // Automatic expiration of temporary suspension
  if (req.user.accountStatus === 'suspended') {
    if (req.user.suspendedUntil && new Date() >= req.user.suspendedUntil) {
      req.user.accountStatus = 'active';
      req.user.suspendedUntil = null;
      req.user.suspendedReason = null;
      await User.updateOne({ _id: req.user._id }, { $set: { accountStatus: 'active', suspendedUntil: null, suspendedReason: null } });
      void audit({ action: 'user.suspension_expired', req, targetType: 'user', targetId: String(req.user._id) });
    } else {
      const untilMsg = req.user.suspendedUntil ? ` until ${req.user.suspendedUntil.toISOString()}` : '';
      const reasonMsg = req.user.suspendedReason ? `. Reason: ${req.user.suspendedReason}` : '';
      return next(new AppError(403, 'account_suspended', `Your account has been suspended${untilMsg}${reasonMsg}. Contact administration.`));
    }
  }

  if (req.user.accountStatus !== 'active') {
    // Only a staff applicant awaiting approval keeps a (restricted) session, and only for these exact
    // endpoints. Anything else, including every role permission, waits for final approval.
    const path = `${req.method} ${(req.originalUrl || '').split('?')[0]!.replace(/\/+$/, '').replace(/^\/api\/auth\//, '/api/v1/auth/')}`;
    if (!(isPendingApplicant(req.user) && APPLICANT_ENDPOINTS.has(path))) {
      return next(new AppError(403, req.user.approvalRequired ? 'approval_pending' : 'account_inactive', req.user.approvalRequired
        ? 'Your staff application is waiting for verification. You can upload identity documents and check its status.'
        : 'Your account is not active. Verify your email or contact support.'));
    }
  }

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
}

/** For super admin / admin routes: enforce MFA when the policy requires it. */
export async function requireMfaPolicy(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.user || !req.authSession) return next(unauthorized());
    if (await mfaRequiredFor(req.user)) {
      if (!req.user.mfaEnabled) return next(new AppError(403, 'mfa_enrollment_required', 'Set up two-factor authentication to continue.'));
      if (!req.authSession.mfaVerified) return next(new AppError(403, 'mfa_required', 'Two-factor verification is required.'));
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function requirePermission(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    const subject = { role: req.user.role as Role, permissions: req.user.permissions };
    if (!permissions.every((p) => hasPermission(subject, p))) {
      void audit({ action: 'access.denied', req, outcome: 'denied', meta: { path: req.path, method: req.method, permissions } });
      return next(forbidden());
    }
    next();
  };
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (req.user.role === 'super_admin') return next();
    if (!roles.includes(req.user.role as Role)) return next(forbidden());
    next();
  };
}

/** High-risk operations require a fresh password (and MFA, if enabled) confirmation. */
export async function requireRecentAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.authSession) return next(unauthorized());
    const s = await getSettings();
    const at = req.authSession.reauthAt?.getTime() ?? 0;
    if (Date.now() - at > s.security.reauthWindowMinutes * 60_000) {
      return next(new AppError(403, 'reauth_required', 'Please confirm your password to continue.'));
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function userKey(req: Request) {
  return String(req.user!._id);
}
