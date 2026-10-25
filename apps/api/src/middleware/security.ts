import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { ZodError } from 'zod';
import { allowedOrigins, env } from '../config/env';
import { AppError, validationError } from '../lib/http';
import { logger } from '../lib/logger';
import { safeEqual } from '../lib/crypto';
import { CSRF_COOKIE, setCsrfCookie } from '../services/auth.service';
import { verifyTurnstile } from '../services/turnstile.service';
import { getSettings } from '../services/settings.service';
import { audit } from '../services/audit.service';
import type { PlatformSettings } from '@campuscare/shared';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for cookie-authenticated requests:
 * 1. Origin/Referer must match an allowed origin.
 * 2. Double-submit token: x-csrf-token header must equal the cc_csrf cookie.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  // CSRF only applies to ambient (cookie) credentials. Requests from the Android app carry no cookies:
  // they authenticate with an explicit bearer token, or are unauthenticated (sign-in, registration).
  const hasCookies = Object.keys(req.cookies ?? {}).length > 0;
  if (!hasCookies && (req.bearerAuth || req.isMobileClient)) return next();
  if (!req.cookies?.[CSRF_COOKIE]) setCsrfCookie(res);
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = (req.headers.origin as string | undefined) ?? (req.headers.referer ? new URL(String(req.headers.referer)).origin : undefined);
  if (origin && !allowedOrigins.includes(origin) && origin !== env.API_PUBLIC_URL) {
    return next(new AppError(403, 'bad_origin', 'Request origin not allowed.'));
  }
  const cookie = req.cookies?.[CSRF_COOKIE] as string | undefined;
  const header = req.headers['x-csrf-token'];
  if (!cookie || typeof header !== 'string' || !safeEqual(cookie, header)) {
    return next(new AppError(403, 'csrf_failed', 'Your session security token is missing or out of date. Refresh the page and try again.'));
  }
  next();
}

type TurnstileForm = keyof PlatformSettings['turnstile']['forms'];

/** Verifies a Cloudflare Turnstile token on the server when the Super Admin has enabled it for this form. */
export function requireTurnstile(form: TurnstileForm) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const s = await getSettings();
      if (!s.turnstile.enabled || !s.turnstile.forms[form]) return next();
      const token = (req.body?.turnstileToken ?? req.headers['cf-turnstile-response']) as string | undefined;
      const result = await verifyTurnstile(token, { remoteIp: req.ip, expectedAction: form });
      if (!result.ok) {
        void audit({ action: 'turnstile.failed', req, outcome: 'denied', meta: { form, reason: result.reason } });
        const message = result.reason === 'provider_unavailable'
          ? 'Human verification is temporarily unavailable. Please try again in a moment.'
          : 'Please complete the human verification check and try again.';
        return next(new AppError(400, 'turnstile_failed', message, { reason: result.reason }));
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

const limiterBase = { standardHeaders: 'draft-7' as const, legacyHeaders: false, skip: () => env.NODE_ENV === 'test' };
const limited = (message: string) => (_req: Request, _res: Response, next: NextFunction) => next(new AppError(429, 'rate_limited', message));

export const authLimiter = rateLimit({ ...limiterBase, windowMs: 15 * 60_000, limit: 30, handler: limited('Too many attempts. Please wait a few minutes and try again.') });
export const emailLimiter = rateLimit({ ...limiterBase, windowMs: 60 * 60_000, limit: 6, handler: limited('Too many email requests. Please try again later.') });
export const apiLimiter = rateLimit({ ...limiterBase, windowMs: 60_000, limit: 300, handler: limited('Too many requests. Please slow down.') });
export const sosLimiter = rateLimit({ ...limiterBase, windowMs: 60_000, limit: 10, handler: limited('Too many SOS requests. If you need help, call 112 now.') });
export const webhookLimiter = rateLimit({ ...limiterBase, windowMs: 60_000, limit: 120, handler: limited('Rate limited') });

/** In-memory uploads with a hard ceiling; real type is sniffed from magic bytes before storage. */
export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024, files: 1, fields: 10 } });

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction) {
  next(new AppError(404, 'not_found', 'Not found.'));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) err = validationError(err);
  if (err instanceof multer.MulterError) {
    err = new AppError(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400, 'upload_failed', err.code === 'LIMIT_FILE_SIZE' ? 'That file is too large.' : 'Upload failed.');
  }
  const status = (err as { status?: number }).status;
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (status === 422) {
    return res.status(422).json({ error: { code: 'invalid_settings', message: (err as Error).message } });
  }
  if ((err as { code?: number }).code === 11000) {
    return res.status(409).json({ error: { code: 'conflict', message: 'This record already exists.' } });
  }
  if ((err as { type?: string }).type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'too_large', message: 'Request is too large.' } });
  }
  logger.error({ err: { message: (err as Error)?.message, stack: env.NODE_ENV === 'production' ? undefined : (err as Error)?.stack }, path: req.path }, 'unhandled error');
  res.status(500).json({ error: { code: 'internal', message: 'Something went wrong on our side. Please try again.' } });
}
