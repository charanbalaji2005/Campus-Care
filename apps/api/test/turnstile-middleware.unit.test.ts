/**
 * requireTurnstile: every protected request is verified server-side; no request field can skip it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireTurnstile } from '../src/middleware/security';

// vi.mock calls are hoisted above the imports.
const verify = vi.hoisted(() => vi.fn());
vi.mock('../src/services/turnstile.service', () => ({ verifyTurnstile: (...a: unknown[]) => verify(...a) }));
vi.mock('../src/services/settings.service', () => ({
  getSettings: async () => ({ turnstile: { enabled: true, forms: { login: true } } }),
}));
vi.mock('../src/services/audit.service', () => ({ audit: async () => undefined }));

async function run(body: Record<string, unknown>) {
  let passed: unknown = 'not-called';
  await requireTurnstile('login')({ body, headers: {}, ip: '1.2.3.4' } as never, {} as never, (err?: unknown) => { passed = err ?? null; });
  return passed as { code?: string } | null;
}

describe('requireTurnstile (login)', () => {
  beforeEach(() => verify.mockReset());

  it('rejects a password + MFA code sign-in that has no Turnstile token', async () => {
    verify.mockResolvedValue({ ok: false, reason: 'missing_token' });
    const err = await run({ email: 'a@srmap.edu.in', password: 'x', mfaCode: '000000' });
    expect(verify).toHaveBeenCalledOnce();
    expect(err?.code).toBe('turnstile_failed');
  });

  it('rejects a reused token (Cloudflare reports timeout-or-duplicate)', async () => {
    verify.mockResolvedValue({ ok: false, reason: 'invalid', errorCodes: ['timeout-or-duplicate'] });
    expect((await run({ email: 'a@srmap.edu.in', password: 'x', turnstileToken: 'used' }))?.code).toBe('turnstile_failed');
  });

  it('fails closed when Cloudflare is unreachable', async () => {
    verify.mockResolvedValue({ ok: false, reason: 'provider_unavailable' });
    expect((await run({ email: 'a@srmap.edu.in', password: 'x', turnstileToken: 't' }))?.code).toBe('turnstile_failed');
  });

  it('passes a request whose token Siteverify accepted, checking the form action', async () => {
    verify.mockResolvedValue({ ok: true });
    expect(await run({ email: 'a@srmap.edu.in', password: 'x', turnstileToken: 'good' })).toBeNull();
    expect(verify).toHaveBeenCalledWith('good', expect.objectContaining({ expectedAction: 'login', remoteIp: '1.2.3.4' }));
  });
});
