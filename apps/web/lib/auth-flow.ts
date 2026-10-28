/**
 * The user-facing account-email pages (verification and password reset). Students and staff reach
 * them from email links; they never lead to the Super Admin sign-in or console.
 */
export const AUTH_PAGES = [
  '/verify-email',
  '/verification-success',
  '/verification-error',
  '/forgot-password',
  '/reset-password',
  '/reset-password-success',
  '/reset-password-error',
] as const;

export type LinkProblem = 'expired' | 'used' | 'invalid';
export type AuthOutcome = 'verified' | 'already_verified' | 'password_reset';

export const verificationErrorPath = (reason: LinkProblem) => `/verification-error?reason=${reason}`;
export const resetErrorPath = (reason: LinkProblem) => `/reset-password-error?reason=${reason}`;

/** Anything else in ?reason= is treated as an invalid link (the page never echoes raw input). */
export function linkProblem(reason: string | null | undefined): LinkProblem {
  return reason === 'expired' || reason === 'used' ? reason : 'invalid';
}

export function linkProblemText(kind: 'verify' | 'reset', reason: LinkProblem): { title: string; body: string } {
  if (reason === 'expired') return { title: 'This link has expired', body: kind === 'verify' ? 'Verification links work for a limited time. Send yourself a new one below.' : 'Reset links work once and only for a short time. Request a new one below.' };
  if (reason === 'used') return { title: kind === 'verify' ? 'This link was already used' : 'This link was already used or replaced', body: 'Each link works once, and only the newest link you requested is valid.' };
  return { title: 'This link can’t be used', body: 'It may be incomplete or replaced by a newer one. Copy the whole link from the email, or request a new one below.' };
}

const OUTCOME_KEY = 'cc_auth_outcome';
const OUTCOME_TTL_MS = 10 * 60_000;

/**
 * Success pages show success only after the server confirmed it in this browser tab. Opening a
 * success URL directly shows a neutral message instead of a false "verified" / "password changed".
 */
export function rememberOutcome(outcome: AuthOutcome, storage: Pick<Storage, 'setItem'> | undefined = safeSession()) {
  try {
    storage?.setItem(OUTCOME_KEY, JSON.stringify({ outcome, at: Date.now() }));
  } catch { /* storage unavailable: the page falls back to the neutral message */ }
}

export function readOutcome(expected: AuthOutcome[], storage: Pick<Storage, 'getItem'> | undefined = safeSession(), now = Date.now()): AuthOutcome | null {
  try {
    const v = JSON.parse(storage?.getItem(OUTCOME_KEY) ?? 'null') as { outcome?: AuthOutcome; at?: number } | null;
    if (!v?.outcome || !expected.includes(v.outcome) || typeof v.at !== 'number' || now - v.at > OUTCOME_TTL_MS) return null;
    return v.outcome;
  } catch {
    return null;
  }
}

export function clearOutcome(storage: Pick<Storage, 'removeItem'> | undefined = safeSession()) {
  try {
    storage?.removeItem(OUTCOME_KEY);
  } catch { /* ignore */ }
}

function safeSession(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

/**
 * The forgot-password page is user-facing. Only when it was opened from the Super Admin sign-in
 * (?from=admin) does it offer a way back there.
 */
export function forgotPasswordBackTarget(from: string | null | undefined): 'admin' | 'app' {
  return from === 'admin' ? 'admin' : 'app';
}
