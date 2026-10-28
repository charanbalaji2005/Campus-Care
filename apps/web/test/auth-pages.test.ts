/**
 * The user-facing account-email pages: result handling, and a source guard that none of them links
 * or redirects to the Super Admin console or its sign-in, and that they only call the backend's
 * /auth/* endpoints (proxied to API_ORIGIN by next.config.mjs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUTH_PAGES, forgotPasswordBackTarget, linkProblem, linkProblemText, readOutcome, rememberOutcome, resetErrorPath, verificationErrorPath } from '../lib/auth-flow';

const appDir = path.resolve(__dirname, '../app/(auth)');
const source = (page: string) => fs.readFileSync(path.join(appDir, page.replace(/^\//, ''), 'page.tsx'), 'utf8');

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

describe('account-email result pages', () => {
  it('maps link problems to the error pages and never echoes raw input', () => {
    expect(verificationErrorPath('expired')).toBe('/verification-error?reason=expired');
    expect(resetErrorPath('used')).toBe('/reset-password-error?reason=used');
    expect(linkProblem('expired')).toBe('expired');
    expect(linkProblem('<script>')).toBe('invalid');
    expect(linkProblem(null)).toBe('invalid');
    expect(linkProblemText('reset', 'expired').title).toMatch(/expired/);
    expect(linkProblemText('verify', 'used').title).toMatch(/already used/);
  });

  it('shows success only after the server confirmed it in this tab, and only briefly', () => {
    const s = memoryStorage();
    expect(readOutcome(['verified'], s)).toBeNull(); // opened directly: no claim of success
    rememberOutcome('verified', s);
    expect(readOutcome(['verified', 'already_verified'], s)).toBe('verified');
    expect(readOutcome(['password_reset'], s)).toBeNull(); // a verification never shows as a password change
    expect(readOutcome(['verified'], s, Date.now() + 11 * 60_000)).toBeNull();
  });

  it('offers the Super Admin sign-in from forgot-password only when it was opened from there', () => {
    expect(forgotPasswordBackTarget(null)).toBe('app');
    expect(forgotPasswordBackTarget('student')).toBe('app');
    expect(forgotPasswordBackTarget('admin')).toBe('admin');
  });
});

describe('account-email pages: no Super Admin, only the auth API', () => {
  it.each(AUTH_PAGES)('%s exists and never links or redirects to the console or its sign-in', (page) => {
    const src = source(page);
    expect(src).not.toMatch(/super-admin/);
    expect(src).not.toMatch(/(router\.(push|replace)|redirect)\(\s*['"`]\/(login|dashboard)/);
    // The only /login link is the admin-only "Back to sign in" on forgot-password, behind ?from=admin.
    const loginLinks = src.match(/href="\/login"/g) ?? [];
    expect(loginLinks.length).toBe(page === '/forgot-password' ? 1 : 0);
    if (page === '/forgot-password') expect(src).toMatch(/back === 'admin'\s*\?\s*<Link href="\/login"/);
  });

  it.each(AUTH_PAGES)('%s calls only the backend /auth/* endpoints', (page) => {
    const calls = [...source(page).matchAll(/api\.(get|post)(?:<[^>]*>)?\(\s*[`'"]([^`'"?]+)/g)].map((m) => m[2]);
    for (const c of calls) expect(c).toMatch(/^\/auth\/(verify-email|verify-email\/check|reset-password|reset-password\/check|forgot-password|resend-verification)$/);
  });

  it('pages submit the token by POST only (never change state with GET)', () => {
    expect(source('/verify-email')).toMatch(/api\.post<[^>]*>\('\/auth\/verify-email', \{ token \}\)/);
    expect(source('/reset-password')).toMatch(/api\.post\('\/auth\/reset-password', data\)/);
  });
});
