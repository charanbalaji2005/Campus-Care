import type { NextFunction, Request, Response } from 'express';
import { hasPermission, type Permission, type Role } from '@campuscare/shared';
import { AppError, forbidden, unauthorized } from '../lib/http';
import { MOBILE_CLIENT_HEADER, SESSION_COOKIE, clearAuthCookies, mfaRequiredFor, resolveSession } from '../services/auth.service';
import { getSettings } from '../services/settings.service';
import { audit } from '../services/audit.service';

/** Loads the session (if any) for every request. Never trusts a role sent by the browser. */
export async function loadSession(req: Request, res: Response, next: NextFunction) {
  try {
    const cookieToken = req.cookies?.[SESSION_COOKIE] as string | undefined;
    const authz = req.headers.authorization;
    const bearer = typeof authz === 'string' && authz.startsWith('Bearer ') ? authz.slice(7).trim() : undefined;
    // The Android app identifies itself and never sends cookies; its sessions are bearer tokens.
    req.isMobileClient = req.headers[MOBILE_CLIENT_HEADER] === 'android' && !cookieToken;
    const token = cookieToken ?? bearer;
    if (token) {
      const resolved = await resolveSession(token);
      if (resolved) {
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

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user || !req.authSession) return next(new AppError(401, 'session_expired', 'Your session has expired. Please sign in again.'));
  if (req.user.accountStatus !== 'active') return next(new AppError(403, 'account_inactive', 'Your account is not active. Verify your email or contact support.'));
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
