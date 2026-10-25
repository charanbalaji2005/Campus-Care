import { turnstileKeys, env } from '../config/env';
import { logger } from '../lib/logger';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export interface TurnstileResult {
  ok: boolean;
  reason?: 'missing_token' | 'not_configured' | 'invalid' | 'hostname_mismatch' | 'action_mismatch' | 'provider_unavailable';
  errorCodes?: string[];
}

export interface TurnstileOptions {
  expectedAction?: string;
  remoteIp?: string;
  fetchImpl?: typeof fetch;
  secret?: string;
  expectedHostnames?: string[];
  timeoutMs?: number;
}

/**
 * Server-side Turnstile validation (Cloudflare Siteverify). Tokens are single use and
 * expire after five minutes; Cloudflare reports reuse as "timeout-or-duplicate".
 * Provider errors fail CLOSED — verification is never silently skipped.
 */
export async function verifyTurnstile(token: string | undefined, opts: TurnstileOptions = {}): Promise<TurnstileResult> {
  if (!token) return { ok: false, reason: 'missing_token' };
  const secret = opts.secret ?? turnstileKeys.secret;
  if (!secret) return { ok: false, reason: 'not_configured' };
  const hostnames = opts.expectedHostnames ?? env.TURNSTILE_EXPECTED_HOSTNAMES.split(',').map((h) => h.trim()).filter(Boolean);

  const body = new URLSearchParams({ secret, response: token });
  if (opts.remoteIp) body.set('remoteip', opts.remoteIp);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
  let data: { success?: boolean; hostname?: string; action?: string; 'error-codes'?: string[] };
  try {
    const res = await (opts.fetchImpl ?? fetch)(SITEVERIFY_URL, { method: 'POST', body, signal: controller.signal });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'turnstile siteverify http error');
      return { ok: false, reason: 'provider_unavailable' };
    }
    data = (await res.json()) as typeof data;
  } catch {
    logger.warn('turnstile siteverify unreachable');
    return { ok: false, reason: 'provider_unavailable' };
  } finally {
    clearTimeout(timeout);
  }

  if (!data.success) return { ok: false, reason: 'invalid', errorCodes: data['error-codes'] ?? [] };
  // Cloudflare test keys return hostname "example.com"; only enforce hostnames when configured.
  if (hostnames.length && (!data.hostname || !hostnames.includes(data.hostname))) return { ok: false, reason: 'hostname_mismatch' };
  if (opts.expectedAction && data.action && data.action !== opts.expectedAction) return { ok: false, reason: 'action_mismatch' };
  return { ok: true };
}
