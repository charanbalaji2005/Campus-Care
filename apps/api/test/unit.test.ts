import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DEFAULT_SETTINGS, deepMerge } from '@campuscare/shared';
import { verifyTurnstile } from '../src/services/turnstile.service';
import { anonymousReporterTag, decryptSecret, encryptSecret, hashPassword, verifyPassword } from '../src/lib/crypto';
import { safeFileName, sniffMime } from '../src/lib/sniff';
import { renderTemplate } from '../src/services/email/templates';
import { incidentAccess, canUpdateStatus, canChat, type Viewer } from '../src/services/incident.policy';
import { generateSlots, zonedToUtc } from '../src/lib/time';
import { csrfProtection, errorHandler } from '../src/middleware/security';
import { validateSettings } from '../src/services/settings.service';
import { emailProviderSchema } from '@campuscare/shared';

const jsonResponse = (body: unknown, ok = true, status = 200) => Promise.resolve({ ok, status, json: () => Promise.resolve(body) } as Response);

describe('Cloudflare Turnstile server-side verification', () => {
  it('rejects a missing token without calling Cloudflare', async () => {
    const fetchImpl = vi.fn();
    expect(await verifyTurnstile(undefined, { fetchImpl: fetchImpl as never })).toEqual({ ok: false, reason: 'missing_token' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('accepts a successful Siteverify response and sends the secret server-side', async () => {
    const fetchImpl = vi.fn(() => jsonResponse({ success: true, hostname: 'campus.example', action: 'login' }));
    const r = await verifyTurnstile('tok', { fetchImpl: fetchImpl as never, secret: 's3cret', expectedHostnames: ['campus.example'], expectedAction: 'login', remoteIp: '1.2.3.4' });
    expect(r.ok).toBe(true);
    const body = (fetchImpl.mock.calls[0] as unknown as [string, { body: URLSearchParams }])[1].body;
    expect(body.get('secret')).toBe('s3cret');
    expect(body.get('response')).toBe('tok');
    expect(body.get('remoteip')).toBe('1.2.3.4');
  });

  it('rejects reused/expired tokens reported by Cloudflare', async () => {
    const r = await verifyTurnstile('tok', { fetchImpl: (() => jsonResponse({ success: false, 'error-codes': ['timeout-or-duplicate'] })) as never, secret: 's' });
    expect(r).toMatchObject({ ok: false, reason: 'invalid', errorCodes: ['timeout-or-duplicate'] });
  });

  it('rejects hostname and action mismatches', async () => {
    const f = (() => jsonResponse({ success: true, hostname: 'evil.example', action: 'register' })) as never;
    expect((await verifyTurnstile('t', { fetchImpl: f, secret: 's', expectedHostnames: ['campus.example'] })).reason).toBe('hostname_mismatch');
    expect((await verifyTurnstile('t', { fetchImpl: f, secret: 's', expectedHostnames: [], expectedAction: 'login' })).reason).toBe('action_mismatch');
  });

  it('fails closed when Cloudflare is unreachable or errors', async () => {
    expect((await verifyTurnstile('t', { fetchImpl: (() => Promise.reject(new Error('network'))) as never, secret: 's' })).reason).toBe('provider_unavailable');
    expect((await verifyTurnstile('t', { fetchImpl: (() => jsonResponse({}, false, 500)) as never, secret: 's' })).reason).toBe('provider_unavailable');
  });
});

describe('crypto helpers', () => {
  it('encrypts provider secrets with authenticated encryption', () => {
    const enc = encryptSecret('mail-app-password');
    expect(enc).not.toContain('mail-app-password');
    expect(decryptSecret(enc)).toBe('mail-app-password');
    const parts = enc.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decryptSecret(parts.join('.'))).toThrow();
  });

  it('hashes passwords with Argon2id', async () => {
    const h = await hashPassword('Correct-Horse-9');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(h, 'Correct-Horse-9')).toBe(true);
    expect(await verifyPassword(h, 'wrong')).toBe(false);
    expect(await verifyPassword(null, 'anything')).toBe(false);
  });

  it('produces a stable pseudonymous tag that is not the user id', () => {
    const id = '64b7f0f0f0f0f0f0f0f0f0f0';
    expect(anonymousReporterTag(id)).toBe(anonymousReporterTag(id));
    expect(anonymousReporterTag(id)).not.toContain(id);
  });
});

describe('upload type sniffing', () => {
  it('detects real file types from bytes, ignoring the extension', () => {
    expect(sniffMime(Buffer.from('ffd8ffe000104a4649460001', 'hex'))).toBe('image/jpeg');
    expect(sniffMime(Buffer.from('89504e470d0a1a0a0000000d', 'hex'))).toBe('image/png');
    expect(sniffMime(Buffer.concat([Buffer.from('00000020', 'hex'), Buffer.from('ftypisom'), Buffer.alloc(8)]))).toBe('video/mp4');
    expect(sniffMime(Buffer.from('%PDF-1.7\n%%%%%%'))).toBe('application/pdf');
    expect(sniffMime(Buffer.from('MZ\x90\x00 this is an exe....'))).toBeNull();
    expect(sniffMime(Buffer.from('<html><script>alert(1)</script>'))).toBeNull();
  });

  it('sanitises file names', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('my "photo".jpg')).toBe('my _photo_.jpg');
  });
});

describe('email templates', () => {
  it('escapes variables in HTML and strips newlines from subjects', () => {
    const r = renderTemplate({ subject: 'Hi {{name}}', html: '<p>{{name}}</p>', text: '{{name}}' }, { name: '<script>x</script>\nBcc: evil@x' });
    expect(r.html).not.toContain('<script>');
    expect(r.subject).not.toMatch(/\n/);
  });
});

describe('incident access policy', () => {
  const committee = 'c1';
  const base: Viewer = { id: 'u1', role: 'student', permissions: [], committeeIds: [], reporterTag: 'tag-u1' };
  const inc = { reporterId: 'u1', reporterTag: null, committeeId: committee, assignedTo: null };

  it('gives the reporter access, including through the anonymous tag', () => {
    expect(incidentAccess(base, inc)).toBe('reporter');
    expect(incidentAccess(base, { ...inc, reporterId: null, reporterTag: 'tag-u1' })).toBe('reporter');
  });

  it('denies other students', () => {
    expect(incidentAccess({ ...base, id: 'u2', reporterTag: 'tag-u2' }, inc)).toBe('none');
  });

  it('limits committee members to their own committees', () => {
    const member: Viewer = { ...base, id: 'm1', role: 'committee_member', committeeIds: [committee], reporterTag: 't' };
    expect(incidentAccess(member, inc)).toBe('handler');
    expect(incidentAccess({ ...member, committeeIds: ['other'] }, inc)).toBe('none');
  });

  it('gives admins metadata-only triage access unless explicitly granted', () => {
    const admin: Viewer = { ...base, id: 'a1', role: 'admin', reporterTag: 't' };
    expect(incidentAccess(admin, inc)).toBe('triage');
    expect(canChat('triage')).toBe(false);
    expect(canUpdateStatus(admin, 'triage', 'resolved')).toBe(false);
    expect(canUpdateStatus(admin, 'triage', 'assigned')).toBe(true);
    expect(incidentAccess({ ...admin, permissions: ['incidents:read_sensitive'] }, inc)).toBe('handler');
  });

  it('does not let counsellors read cases', () => {
    expect(incidentAccess({ ...base, id: 'c', role: 'counsellor', reporterTag: 't' }, inc)).toBe('none');
  });
});

describe('appointment slots', () => {
  it('converts IST wall-clock times correctly', () => {
    expect(zonedToUtc(2026, 10, 26, 10, 0, 'Asia/Kolkata').toISOString()).toBe('2026-10-26T04:30:00.000Z');
  });

  it('generates slots inside the weekly windows and skips blocked dates', () => {
    const from = new Date('2026-10-25T18:30:00Z'); // Monday 00:00 IST
    const slots = generateSlots({ weekly: [{ weekday: 1, start: '10:00', end: '12:00' }], slotMinutes: 50, timezone: 'Asia/Kolkata', blockedDates: ['2026-11-02'], days: 14, from, minLeadMinutes: 0 });
    expect(slots.map((s) => s.toISOString())).toEqual(['2026-10-26T04:30:00.000Z', '2026-10-26T05:20:00.000Z']);
  });
});

describe('settings guard rails', () => {
  it('rejects unsafe values', () => {
    expect(() => validateSettings(deepMerge(DEFAULT_SETTINGS, { sos: { countdownSeconds: 0 } }))).toThrow();
    expect(() => validateSettings(deepMerge(DEFAULT_SETTINGS, { chat: { maxVideoMb: 5000 } }))).toThrow();
    expect(() => validateSettings(DEFAULT_SETTINGS)).not.toThrow();
    // Wrong types are rejected even when the value looks harmless.
    expect(() => validateSettings(deepMerge(DEFAULT_SETTINGS, { chat: { media: { support: { images: 'yes' } } } }))).toThrow();
    expect(() => validateSettings(deepMerge(DEFAULT_SETTINGS, { sos: { enabled: 'false' } }))).toThrow();
    expect(() => validateSettings(deepMerge(DEFAULT_SETTINGS, { platform: { name: 42 } }))).toThrow();
  });
});

describe('CSRF protection', () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(csrfProtection);
  app.post('/x', (_req, res) => res.json({ ok: true }));
  app.get('/x', (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);

  it('issues a token on safe requests', async () => {
    const r = await request(app).get('/x');
    expect(r.status).toBe(200);
    expect(String(r.headers['set-cookie'])).toContain('cc_csrf=');
  });

  it('rejects mutations without a matching header', async () => {
    expect((await request(app).post('/x').set('Cookie', 'cc_csrf=abc')).status).toBe(403);
    expect((await request(app).post('/x').set('Cookie', 'cc_csrf=abc').set('x-csrf-token', 'nope')).status).toBe(403);
    expect((await request(app).post('/x').set('Cookie', 'cc_csrf=abc').set('x-csrf-token', 'abc')).status).toBe(200);
  });

  it('rejects foreign origins', async () => {
    const r = await request(app).post('/x').set('Origin', 'https://evil.example').set('Cookie', 'cc_csrf=abc').set('x-csrf-token', 'abc');
    expect(r.status).toBe(403);
  });
});

describe('email provider (Nodemailer + app password)', () => {
  it('defaults to Gmail, strips spaces from app passwords and rejects SMTP-style providers', () => {
    const parsed = emailProviderSchema.parse({ type: 'nodemailer', fromName: 'CampusCare', user: 'noreply@campuscare.example', appPassword: 'abcd efgh ijkl mnop' });
    expect(parsed.service).toBe('gmail');
    expect(parsed.appPassword).toBe('abcdefghijklmnop');
    expect(emailProviderSchema.safeParse({ type: 'smtp', fromName: 'CampusCare', fromEmail: 'a@campuscare.example' }).success).toBe(false);
    expect(emailProviderSchema.safeParse({ type: 'nodemailer', service: 'sendmail-anything', fromName: 'CampusCare' }).success).toBe(false);
  });
});

describe('every offered mail service is a real Nodemailer well-known service', () => {
  it('resolves to a host for each service', async () => {
    const { MAIL_SERVICES } = await import('@campuscare/shared');
    // Nodemailer's own lookup table for `service:` names.
    const { createRequire } = await import('node:module');
    const wellKnown = createRequire(__filename)('nodemailer/lib/well-known') as (name: string) => { host?: string } | false;
    for (const service of MAIL_SERVICES) {
      const cfg = wellKnown(service);
      expect(cfg && cfg.host, service).toBeTruthy();
    }
  });
});

describe('Android app requests (bearer tokens, no cookies)', () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  // Same flag logic as loadSession, without a database.
  app.use((req, _res, next) => {
    const hasCookie = Boolean(req.cookies?.cc_session);
    req.isMobileClient = req.headers['x-campuscare-client'] === 'android' && !hasCookie;
    req.bearerAuth = typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ') && !hasCookie;
    next();
  });
  app.use(csrfProtection);
  app.post('/x', (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);

  it('skips CSRF for cookie-less app requests (bearer or sign-in)', async () => {
    expect((await request(app).post('/x').set('x-campuscare-client', 'android')).status).toBe(200);
    expect((await request(app).post('/x').set('Authorization', 'Bearer abc')).status).toBe(200);
  });

  it('still enforces CSRF whenever a browser cookie is present, even with the app header', async () => {
    expect((await request(app).post('/x').set('x-campuscare-client', 'android').set('Cookie', 'cc_csrf=abc')).status).toBe(403);
    expect((await request(app).post('/x').set('Authorization', 'Bearer abc').set('Cookie', 'cc_session=s; cc_csrf=abc')).status).toBe(403);
    expect((await request(app).post('/x')).status).toBe(403);
  });
});

describe('push notifications are optional', () => {
  it('reports push as not configured without a Firebase service account', async () => {
    const { pushConfigured, pushToUser } = await import('../src/services/push.service');
    expect(pushConfigured()).toBe(false);
    await expect(pushToUser('000000000000000000000000', { title: 't', body: 'b', kind: 'k', priority: 'normal' })).resolves.toEqual({ sent: 0, configured: false });
  });
});
