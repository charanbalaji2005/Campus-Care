/**
 * Production link configuration: verification and reset links come from FRONTEND_AUTH_URL, are
 * public HTTPS, and production refuses to start with a localhost / development value.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const PROD = {
  NODE_ENV: 'production',
  COOKIE_SECURE: 'true',
  EMAIL_PROVIDER: 'console',
  WEB_ORIGIN: 'https://campuscare-web.onrender.com',
  API_PUBLIC_URL: 'https://campuscare-api-gywg.onrender.com',
};
const saved = { ...process.env };

async function loadWith(vars: Record<string, string>) {
  vi.resetModules();
  Object.assign(process.env, PROD, vars);
  return import('../src/config/env');
}

afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  vi.resetModules();
});

describe('FRONTEND_AUTH_URL', () => {
  it('accepts only public https origins', async () => {
    const { isPublicHttpsOrigin } = await import('../src/config/env');
    expect(isPublicHttpsOrigin('https://campuscare-web.onrender.com')).toBe(true);
    for (const bad of ['http://campuscare-web.onrender.com', 'https://localhost:3000', 'http://localhost:3000', 'https://127.0.0.1', 'https://10.0.2.2:3000', 'https://192.168.1.20', 'not a url']) {
      expect(isPublicHttpsOrigin(bad), bad).toBe(false);
    }
  });

  it.each(['http://localhost:3000', 'https://localhost:3000', 'http://campuscare-web.onrender.com', 'https://10.0.2.2:3000'])('production refuses to start with FRONTEND_AUTH_URL=%s', async (url) => {
    await expect(loadWith({ FRONTEND_AUTH_URL: url })).rejects.toThrow(/FRONTEND_AUTH_URL must be a public https/);
  });

  it('production builds verification and reset links on the authentication website', async () => {
    const cfg = await loadWith({ FRONTEND_AUTH_URL: 'https://campuscare-web.onrender.com/' });
    expect(cfg.authLinkOrigin).toBe('https://campuscare-web.onrender.com');
    expect(cfg.allowedOrigins).toContain('https://campuscare-web.onrender.com');
    const { accountLink } = await import('../src/services/email/email.service');
    const verify = accountLink('/verify-email', 'tok_123');
    const reset = accountLink('/reset-password', 'tok_456');
    expect(verify).toBe('https://campuscare-web.onrender.com/verify-email?token=tok_123');
    expect(reset).toBe('https://campuscare-web.onrender.com/reset-password?token=tok_456');
    for (const link of [verify, reset]) expect(link).not.toMatch(/localhost|127\.0\.0\.1|super-admin|\/login/);
  });

  it('falls back to WEB_ORIGIN when FRONTEND_AUTH_URL is not set', async () => {
    const cfg = await loadWith({ FRONTEND_AUTH_URL: '' });
    expect(cfg.authLinkOrigin).toBe('https://campuscare-web.onrender.com');
  });
});
