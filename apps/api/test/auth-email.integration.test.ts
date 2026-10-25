/**
 * Forgot password, reset password, email verification and resend verification (integration).
 * Always runs against a private in-memory MongoDB (never the database in .env). Email goes to the
 * console provider (see setup-env.ts); the "provider failure" cases replace Nodemailer's transport with
 * a stub, so no real message can leave the machine.
 * Set SKIP_DB_TESTS=true to skip (e.g. where the mongod binary cannot be downloaded).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';

// Keep the anti-enumeration timing floor short in tests (read when the env module first loads).
process.env.AUTH_GENERIC_RESPONSE_MS = '60';

const d = process.env.SKIP_DB_TESTS === 'true' ? describe.skip : describe;
const PASSWORD = 'Original-Pass-1';
const NEW_PASSWORD = 'Brand-New-Pass-2';
const APP = { 'X-CampusCare-Client': 'android' };

d('Account emails: reset, verification, resend (integration)', () => {
  let mongo: { stop: () => Promise<boolean>; getUri: () => string };
  let app: import('express').Express;
  let M: typeof import('../src/models/user') & typeof import('../src/models/platform') & typeof import('../src/models/mfa');
  let jobs: typeof import('../src/services/jobs.service');
  let crypto: typeof import('../src/lib/crypto');
  let hash: string;

  const post = (path: string, body: Record<string, unknown>) => request(app).post(`/api/v1/auth${path}`).set(APP).send(body);

  async function makeUser(email: string, extra: Record<string, unknown> = {}) {
    return M.User.create({ fullName: email.split('@')[0], email, role: 'student', passwordHash: hash, emailVerified: true, accountStatus: 'active', ...extra });
  }

  /** Reads the link from the newest queued email (the plain token exists only there, never in a token collection). */
  async function latestLink(to: string, template: string) {
    const delivery = await M.EmailDelivery.findOne({ to, template }).sort({ createdAt: -1, _id: -1 }).lean();
    expect(delivery, `${template} email to ${to}`).toBeTruthy();
    const job = await M.Job.findOne({ type: 'email.send', 'payload.deliveryId': String(delivery!._id) }).lean();
    const link = (job!.payload as { vars: { link: string } }).vars.link;
    return new URL(link);
  }
  async function tokenFor(to: string, template: 'password_reset' | 'verify_email') {
    return (await latestLink(to, template)).searchParams.get('token')!;
  }
  async function appLogin(email: string, password = PASSWORD) {
    return post('/login', { email, password });
  }
  /** Lets the account-email cooldown pass without waiting. */
  async function ageTokens(userId: unknown, ms = 120_000) {
    const past = new Date(Date.now() - ms);
    await M.PasswordResetToken.collection.updateMany({ userId }, { $set: { createdAt: past } });
    await M.EmailVerificationToken.collection.updateMany({ userId }, { $set: { createdAt: past } });
  }

  beforeAll(async () => {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    mongo = await MongoMemoryServer.create();
    const { connectDatabase } = await import('../src/db/connect');
    await connectDatabase(mongo.getUri());
    const { createApp } = await import('../src/app');
    app = createApp();
    M = { ...(await import('../src/models/user')), ...(await import('../src/models/platform')), ...(await import('../src/models/mfa')) };
    jobs = await import('../src/services/jobs.service');
    crypto = await import('../src/lib/crypto');
    for (const name of mongoose.modelNames()) await mongoose.model(name).syncIndexes();
    const settings = await import('../src/services/settings.service');
    await settings.updateSettings({ turnstile: { enabled: false }, registration: { studentRegistrationOpen: true, requireEmailVerification: true } }, '000000000000000000000000');
    hash = await crypto.hashPassword(PASSWORD);
  }, 120_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await mongoose.disconnect();
    await mongo?.stop();
  });

  // ---------------------------------------------------------------- forgot password
  it('forgot-password answers identically for known and unknown addresses and stores only a hash', async () => {
    const u = await makeUser('forgot1@srmap.edu.in');
    const t0 = Date.now();
    const known = await post('/forgot-password', { email: 'forgot1@srmap.edu.in' });
    const t1 = Date.now();
    const unknown = await post('/forgot-password', { email: 'nobody-here@srmap.edu.in' });
    const t2 = Date.now();
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    expect(known.body.data.message).not.toMatch(/\bsent\b/i); // queued, not claimed as delivered
    expect(known.body.data.expiresInMinutes).toBeGreaterThanOrEqual(15);
    expect(known.body.data.expiresInMinutes).toBeLessThanOrEqual(30);
    expect(t1 - t0).toBeGreaterThanOrEqual(55); // timing floor applies to both
    expect(t2 - t1).toBeGreaterThanOrEqual(55);

    const token = await tokenFor('forgot1@srmap.edu.in', 'password_reset');
    expect(token.length).toBeGreaterThanOrEqual(40); // 32 random bytes, base64url
    const docs = await M.PasswordResetToken.find({ userId: u._id }).lean();
    expect(docs).toHaveLength(1);
    expect(docs[0]!.tokenHash).toBe(crypto.sha256(token));
    expect(JSON.stringify(docs)).not.toContain(token);
    const ttl = docs[0]!.expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(14 * 60_000);
    expect(ttl).toBeLessThanOrEqual(30 * 60_000);
    // Unknown addresses produce no token and no email.
    expect(await M.EmailDelivery.countDocuments({ to: 'nobody-here@srmap.edu.in' })).toBe(0);
  });

  it('does not email suspended accounts, and applies a per-account cooldown with the same generic answer', async () => {
    await makeUser('suspended1@srmap.edu.in', { accountStatus: 'suspended' });
    const s = await post('/forgot-password', { email: 'suspended1@srmap.edu.in' });
    expect(s.status).toBe(200);
    expect(await M.EmailDelivery.countDocuments({ to: 'suspended1@srmap.edu.in' })).toBe(0);

    const u = await makeUser('cooldown1@srmap.edu.in');
    const a = await post('/forgot-password', { email: 'cooldown1@srmap.edu.in' });
    const b = await post('/forgot-password', { email: 'cooldown1@srmap.edu.in' });
    expect(a.body).toEqual(b.body);
    expect(await M.PasswordResetToken.countDocuments({ userId: u._id })).toBe(1); // second request throttled
    const first = await tokenFor('cooldown1@srmap.edu.in', 'password_reset');
    await ageTokens(u._id);
    await post('/forgot-password', { email: 'cooldown1@srmap.edu.in' });
    const second = await tokenFor('cooldown1@srmap.edu.in', 'password_reset');
    expect(second).not.toBe(first);
    // A newer link supersedes the older one.
    expect((await post('/reset-password/check', { token: first })).body.data).toEqual({ valid: false, state: 'used' });
    expect((await post('/reset-password/check', { token: second })).body.data.valid).toBe(true);
  });

  // ---------------------------------------------------------------- reset password
  it('checking or opening (GET) a reset link never consumes it', async () => {
    await makeUser('check1@srmap.edu.in');
    await post('/forgot-password', { email: 'check1@srmap.edu.in' });
    const token = await tokenFor('check1@srmap.edu.in', 'password_reset');
    for (let i = 0; i < 3; i++) expect((await post('/reset-password/check', { token })).body.data).toEqual({ valid: true, state: 'valid' });
    const get = await request(app).get(`/api/v1/auth/reset-password?token=${encodeURIComponent(token)}`);
    expect(get.status).toBeGreaterThanOrEqual(400); // there is no GET handler that could consume it
    expect((await M.PasswordResetToken.findOne({ tokenHash: crypto.sha256(token) }).lean())!.consumedAt).toBeNull();
  });

  it('rejects invalid, expired and policy-breaking resets', async () => {
    const u = await makeUser('reject1@srmap.edu.in');
    const bad = await post('/reset-password', { token: 'x'.repeat(43), password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('invalid_token');

    await post('/forgot-password', { email: 'reject1@srmap.edu.in' });
    const token = await tokenFor('reject1@srmap.edu.in', 'password_reset');
    const weak = await post('/reset-password', { token, password: 'alllowercase', confirmPassword: 'alllowercase' });
    expect(weak.status).toBe(422);
    const mismatch = await post('/reset-password', { token, password: NEW_PASSWORD, confirmPassword: `${NEW_PASSWORD}x` });
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error.details.fields.confirmPassword).toBeTruthy();
    // Failed validation does not use up the link.
    expect((await post('/reset-password/check', { token })).body.data.valid).toBe(true);

    await M.PasswordResetToken.updateOne({ tokenHash: crypto.sha256(token) }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await post('/reset-password/check', { token })).body.data).toEqual({ valid: false, state: 'expired' });
    const expired = await post('/reset-password', { token, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD });
    expect(expired.status).toBe(400);
    expect(expired.body.error.code).toBe('expired_token');
    const still = await M.User.findById(u._id).select('+passwordHash').lean();
    expect(await crypto.verifyPassword(still!.passwordHash, PASSWORD)).toBe(true);
  });

  it('resets the password once, revokes every session, sends a notice and does not sign in', async () => {
    const u = await makeUser('reset1@srmap.edu.in');
    const login = await appLogin('reset1@srmap.edu.in');
    expect(login.status).toBe(200);
    const bearer = login.body.data.sessionToken as string;
    expect((await request(app).get('/api/v1/auth/me').set(APP).set('Authorization', `Bearer ${bearer}`)).status).toBe(200);

    await post('/forgot-password', { email: 'reset1@srmap.edu.in' });
    const token = await tokenFor('reset1@srmap.edu.in', 'password_reset');
    const r = await post('/reset-password', { token, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.sessionToken).toBeUndefined();
    expect(r.headers['set-cookie']?.toString() ?? '').not.toMatch(/cc_session=[^;]/);

    // Old session is gone.
    expect((await request(app).get('/api/v1/auth/me').set(APP).set('Authorization', `Bearer ${bearer}`)).status).toBe(401);
    expect(await M.Session.countDocuments({ userId: u._id, revokedAt: null })).toBe(0);
    // Old password fails, new one works.
    expect((await appLogin('reset1@srmap.edu.in')).status).toBe(401);
    expect((await appLogin('reset1@srmap.edu.in', NEW_PASSWORD)).status).toBe(200);
    // Notification email without the password.
    const notice = await M.EmailDelivery.findOne({ to: 'reset1@srmap.edu.in', template: 'password_changed' }).lean();
    expect(notice).toBeTruthy();
    const noticeJob = await M.Job.findOne({ 'payload.deliveryId': String(notice!._id) }).lean();
    expect(JSON.stringify(noticeJob?.payload ?? {})).not.toContain(NEW_PASSWORD);
    // Replay is refused.
    const again = await post('/reset-password', { token, password: 'Another-Pass-3', confirmPassword: 'Another-Pass-3' });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('invalid_token');
    expect((await post('/reset-password/check', { token })).body.data.state).toBe('used');
  });

  it('lets exactly one of several concurrent resets with the same token succeed', async () => {
    const u = await makeUser('race1@srmap.edu.in');
    await post('/forgot-password', { email: 'race1@srmap.edu.in' });
    const token = await tokenFor('race1@srmap.edu.in', 'password_reset');
    const candidates = ['Race-Winner-A1', 'Race-Winner-B2', 'Race-Winner-C3', 'Race-Winner-D4', 'Race-Winner-E5'];
    const results = await Promise.all(candidates.map((p) => post('/reset-password', { token, password: p, confirmPassword: p })));
    const winners = results.filter((x) => x.status === 200);
    expect(winners).toHaveLength(1);
    expect(results.filter((x) => x.status === 400)).toHaveLength(candidates.length - 1);
    const stored = await M.User.findById(u._id).select('+passwordHash').lean();
    const matching = [];
    for (const p of candidates) if (await crypto.verifyPassword(stored!.passwordHash, p)) matching.push(p);
    expect(matching).toHaveLength(1);
    expect(await M.EmailDelivery.countDocuments({ to: 'race1@srmap.edu.in', template: 'password_changed' })).toBe(1);
  });

  it('keeps MFA required after a reset and cancels sign-in challenges started before it', async () => {
    await makeUser('mfa1@srmap.edu.in', { mfaEnabled: true });
    const before = await appLogin('mfa1@srmap.edu.in');
    expect(before.status).toBe(200);
    expect(before.body.data.mfaRequired).toBe(true);
    const oldChallenge = before.body.data.challengeToken as string;

    await post('/forgot-password', { email: 'mfa1@srmap.edu.in' });
    const token = await tokenFor('mfa1@srmap.edu.in', 'password_reset');
    const r = await post('/reset-password', { token, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD });
    expect(r.status).toBe(200);
    expect(r.body.data.sessionToken).toBeUndefined();

    const u = await M.User.findOne({ email: 'mfa1@srmap.edu.in' }).lean();
    expect(u!.mfaEnabled).toBe(true);
    const after = await appLogin('mfa1@srmap.edu.in', NEW_PASSWORD);
    expect(after.status).toBe(200);
    expect(after.body.data.mfaRequired).toBe(true);
    expect(after.body.data.sessionToken).toBeUndefined();
    // The challenge issued before the reset can no longer be completed.
    const stale = await post('/mfa/challenge', { challengeToken: oldChallenge, code: '123456' });
    expect(stale.status).toBe(401);
    expect(stale.body.error.code).toBe('mfa_challenge_expired');
  });

  // ---------------------------------------------------------------- email verification
  async function register(email: string, studentId: string) {
    return post('/register', {
      fullName: 'Verify Tester', email, studentId, department: 'Computer Science', academicYear: 2,
      password: PASSWORD, confirmPassword: PASSWORD, acceptPolicy: true,
    });
  }

  it('keeps a new account pending until the server consumes the verification token', async () => {
    const reg = await register('verify1@srmap.edu.in', 'VER-1');
    expect(reg.status, JSON.stringify(reg.body)).toBe(201);
    expect(reg.body.data.requiresVerification).toBe(true);
    const link = await latestLink('verify1@srmap.edu.in', 'verify_email');
    expect(link.origin).toBe(process.env.WEB_ORIGIN);
    expect(link.pathname).toBe('/verify-email');
    expect([...link.searchParams.keys()]).toEqual(['token']); // no email address or other personal data in the URL
    const token = link.searchParams.get('token')!;
    expect(await M.EmailVerificationToken.countDocuments({ tokenHash: crypto.sha256(token) })).toBe(1);
    expect(await M.EmailVerificationToken.countDocuments({ tokenHash: token })).toBe(0);

    // Pending: cannot sign in.
    const blocked = await appLogin('verify1@srmap.edu.in');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('email_not_verified');

    // Opening the link (GET) or checking it does not verify.
    expect((await request(app).get(`/api/v1/auth/verify-email?token=${encodeURIComponent(token)}`)).status).toBeGreaterThanOrEqual(400);
    expect((await post('/verify-email/check', { token })).body.data.state).toBe('valid');
    expect((await M.User.findOne({ email: 'verify1@srmap.edu.in' }).lean())!.emailVerified).toBe(false);

    const v = await post('/verify-email', { token });
    expect(v.status).toBe(200);
    expect(v.body.data.result).toBe('verified');
    const u = await M.User.findOne({ email: 'verify1@srmap.edu.in' }).lean();
    expect(u!.emailVerified).toBe(true);
    expect(u!.accountStatus).toBe('active');
    expect((await M.EmailVerificationToken.findOne({ tokenHash: crypto.sha256(token) }).lean())!.consumedAt).toBeTruthy();

    // Replay: reported as already verified, nothing else changes.
    const replay = await post('/verify-email', { token });
    expect(replay.status).toBe(200);
    expect(replay.body.data.result).toBe('already_verified');
    expect((await post('/verify-email/check', { token })).body.data.state).toBe('already_verified');
    // Verification does not sign in: the person signs in normally next.
    expect(v.body.data.sessionToken).toBeUndefined();
    expect((await appLogin('verify1@srmap.edu.in')).status).toBe(200);
  });

  it('reports invalid and expired verification links', async () => {
    const invalid = await post('/verify-email', { token: 'y'.repeat(43) });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('invalid_token');
    expect((await post('/verify-email/check', { token: 'y'.repeat(43) })).body.data.state).toBe('invalid');

    await register('verify2@srmap.edu.in', 'VER-2');
    const token = await tokenFor('verify2@srmap.edu.in', 'verify_email');
    await M.EmailVerificationToken.updateOne({ tokenHash: crypto.sha256(token) }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await post('/verify-email/check', { token })).body.data.state).toBe('expired');
    const expired = await post('/verify-email', { token });
    expect(expired.status).toBe(410);
    expect(expired.body.error.code).toBe('expired_token');
    expect((await M.User.findOne({ email: 'verify2@srmap.edu.in' }).lean())!.emailVerified).toBe(false);
  });

  // ---------------------------------------------------------------- resend verification
  it('resend answers generically, supersedes old links and is rate limited per account', async () => {
    await register('resend1@srmap.edu.in', 'RES-1');
    const user = await M.User.findOne({ email: 'resend1@srmap.edu.in' }).lean();
    const original = await tokenFor('resend1@srmap.edu.in', 'verify_email');
    await makeUser('verified-already@srmap.edu.in');

    // Within the cooldown right after registration: generic answer, no new email.
    const early = await post('/resend-verification', { email: 'resend1@srmap.edu.in' });
    expect(early.status).toBe(200);
    expect(await M.EmailVerificationToken.countDocuments({ userId: user!._id })).toBe(1);

    await ageTokens(user!._id);
    const pending = await post('/resend-verification', { email: 'resend1@srmap.edu.in' });
    const unknown = await post('/resend-verification', { email: 'ghost@srmap.edu.in' });
    const verified = await post('/resend-verification', { email: 'verified-already@srmap.edu.in' });
    expect(pending.status).toBe(200);
    expect(pending.body).toEqual(unknown.body);
    expect(pending.body).toEqual(verified.body);
    expect(pending.body.data.retryAfterSeconds).toBeGreaterThan(0);
    expect(pending.body.data.message).not.toMatch(/\bsent\b/i);
    expect(await M.EmailDelivery.countDocuments({ to: { $in: ['ghost@srmap.edu.in', 'verified-already@srmap.edu.in'] } })).toBe(0);

    const fresh = await tokenFor('resend1@srmap.edu.in', 'verify_email');
    expect(fresh).not.toBe(original);
    expect((await post('/verify-email', { token: original })).status).toBe(400); // superseded

    // Hourly cap: at most 5 links per account per hour, even with the cooldown out of the way.
    for (let i = 0; i < 6; i++) {
      await M.EmailVerificationToken.collection.updateMany({ userId: user!._id }, { $set: { createdAt: new Date(Date.now() - 61_000) } });
      expect((await post('/resend-verification', { email: 'resend1@srmap.edu.in' })).status).toBe(200);
    }
    expect(await M.EmailVerificationToken.countDocuments({ userId: user!._id })).toBe(5);
    expect((await post('/verify-email', { token: await tokenFor('resend1@srmap.edu.in', 'verify_email') })).body.data.result).toBe('verified');
  });

  // ---------------------------------------------------------------- verification status
  it('serves verification status only to the signed-in account', async () => {
    expect((await request(app).get('/api/v1/auth/verification-status').set(APP)).status).toBe(401);
    expect((await request(app).get('/api/v1/auth/verification-status').set(APP).set('Authorization', 'Bearer not-a-real-session-token')).status).toBe(401);
    await makeUser('status1@srmap.edu.in');
    const login = await appLogin('status1@srmap.edu.in');
    const r = await request(app).get('/api/v1/auth/verification-status').set(APP).set('Authorization', `Bearer ${login.body.data.sessionToken}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ emailVerified: true, accountStatus: 'active' });
    expect(r.body.data.email).toBeUndefined();
  });

  // ---------------------------------------------------------------- email provider problems (keep last)
  it('refuses honestly, for every address alike, when the mail service is not configured', async () => {
    await makeUser('noprov1@srmap.edu.in', { accountStatus: 'pending_verification', emailVerified: false });
    const cfg = await M.EmailProviderConfig.create({ type: 'nodemailer', service: 'gmail', fromName: 'CampusCare', fromEmail: 'noreply@example.invalid', authUser: null, active: true });
    try {
      const known = await post('/forgot-password', { email: 'noprov1@srmap.edu.in' });
      const unknown = await post('/forgot-password', { email: 'noprov-ghost@srmap.edu.in' });
      expect(known.status).toBe(503);
      expect(known.body.error.code).toBe('email_unavailable');
      expect(known.body).toEqual(unknown.body);
      const resend = await post('/resend-verification', { email: 'noprov1@srmap.edu.in' });
      expect(resend.status).toBe(503);
      const reg = await register('noprov2@srmap.edu.in', 'NOP-2');
      expect(reg.status).toBe(503);
      expect(await M.User.countDocuments({ email: 'noprov2@srmap.edu.in' })).toBe(0);
      expect(await M.EmailDelivery.countDocuments({ to: 'noprov1@srmap.edu.in' })).toBe(0);
    } finally {
      await M.EmailProviderConfig.deleteOne({ _id: cfg._id });
    }
  });

  it('records failed sends as failed (never sent) and then refuses new requests until the service recovers', async () => {
    const nodemailer = (await import('nodemailer')).default;
    const sendMail = vi.fn().mockRejectedValue(new Error('535 authentication failed (stub)'));
    const spy = vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail, close: vi.fn(), verify: vi.fn() } as never);
    // Settle everything queued by earlier tests with the console provider first.
    while ((await jobs.runDueJobs()) > 0) { /* drain */ }
    const cfg = await M.EmailProviderConfig.create({
      type: 'nodemailer', service: 'gmail', fromName: 'CampusCare', fromEmail: 'noreply@example.invalid',
      authUser: 'stub@example.invalid', authPassEnc: crypto.encryptSecret('stub-password'), active: true,
    });
    try {
      for (let i = 1; i <= 3; i++) {
        const email = `fail${i}@srmap.edu.in`;
        await makeUser(email);
        const r = await post('/forgot-password', { email });
        expect(r.status).toBe(200); // queued; the response never says it was delivered
        await jobs.runDueJobs();
        const delivery = await M.EmailDelivery.findOne({ to: email, template: 'password_reset' }).lean();
        expect(delivery!.status).toBe('failed');
        expect(delivery!.sentAt ?? null).toBeNull();
      }
      expect(sendMail).toHaveBeenCalledTimes(3);
      // Provider is now considered degraded: the honest error is the same for known and unknown addresses.
      const known = await post('/forgot-password', { email: 'fail1@srmap.edu.in' });
      const unknown = await post('/forgot-password', { email: 'fail-ghost@srmap.edu.in' });
      expect(known.status).toBe(503);
      expect(known.body.error.code).toBe('email_unavailable');
      expect(known.body).toEqual(unknown.body);
    } finally {
      spy.mockRestore();
      await M.EmailProviderConfig.deleteOne({ _id: cfg._id });
      await M.EmailDelivery.deleteMany({ status: 'failed' });
      await M.Job.deleteMany({ type: 'email.send', status: { $ne: 'done' } });
    }
  });
});
