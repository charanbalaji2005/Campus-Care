/**
 * One-time email codes (OTP) next to the existing links, for email verification and password recovery.
 * Runs against a private in-memory MongoDB; email goes to the console provider (setup-env.ts), and the
 * provider-failure case replaces Nodemailer's transport with a stub, so nothing can leave the machine.
 * Set SKIP_DB_TESTS=true to skip.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';

process.env.AUTH_GENERIC_RESPONSE_MS = '40';

const d = process.env.SKIP_DB_TESTS === 'true' ? describe.skip : describe;
const PASSWORD = 'Otp-Original-Pass-1';
const NEW_PASSWORD = 'Otp-Brand-New-Pass-2';
const STUDENT_APP = { 'X-CampusCare-Client': 'android', 'X-CampusCare-App': 'student' };
const COLLEGE_APP = { 'X-CampusCare-Client': 'android', 'X-CampusCare-App': 'college' };

d('Email codes (OTP) and links: verification and password recovery (integration)', () => {
  let mongo: { stop: () => Promise<boolean>; getUri: () => string };
  let app: import('express').Express;
  let M: typeof import('../src/models/user') & typeof import('../src/models/platform');
  let jobs: typeof import('../src/services/jobs.service');
  let crypto: typeof import('../src/lib/crypto');
  let hash: string;

  const post = (path: string, body: Record<string, unknown>, headers: Record<string, string> = STUDENT_APP) =>
    request(app).post(`/api/v1/auth${path}`).set(headers).send(body);

  async function makeUser(email: string, extra: Record<string, unknown> = {}) {
    return M.User.create({ fullName: email.split('@')[0], email, role: 'student', passwordHash: hash, emailVerified: true, accountStatus: 'active', ...extra });
  }
  function register(email: string, studentId: string, verificationMethod?: 'otp' | 'link') {
    return post('/register', {
      fullName: 'Otp Student', email, studentId, department: 'CSE', academicYear: 2, password: PASSWORD, confirmPassword: PASSWORD, acceptPolicy: true,
      ...(verificationMethod ? { verificationMethod } : {}),
    });
  }
  /** The plain code exists only in the queued email job (the database keeps an HMAC). */
  async function latestVars(to: string, template: string) {
    const delivery = await M.EmailDelivery.findOne({ to, template }).sort({ createdAt: -1, _id: -1 }).lean();
    expect(delivery, `${template} email to ${to}`).toBeTruthy();
    const job = await M.Job.findOne({ type: 'email.send', 'payload.deliveryId': String(delivery!._id) }).lean();
    return (job!.payload as { vars: Record<string, string> }).vars;
  }
  const codeFor = async (to: string, template: 'verify_email_code' | 'password_reset_code') => (await latestVars(to, template)).code!;
  const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');
  /** Lets the per-account email cooldown pass without waiting. */
  async function ageChallenges(userId: unknown, ms = 120_000) {
    const past = new Date(Date.now() - ms);
    for (const m of [M.EmailOtp, M.EmailVerificationToken, M.PasswordResetToken]) await m.collection.updateMany({ userId }, { $set: { createdAt: past } });
  }

  beforeAll(async () => {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    mongo = await MongoMemoryServer.create();
    const { connectDatabase } = await import('../src/db/connect');
    await connectDatabase(mongo.getUri());
    const { createApp } = await import('../src/app');
    app = createApp();
    M = { ...(await import('../src/models/user')), ...(await import('../src/models/platform')) };
    jobs = await import('../src/services/jobs.service');
    crypto = await import('../src/lib/crypto');
    for (const name of mongoose.modelNames()) await mongoose.model(name).syncIndexes();
    const settings = await import('../src/services/settings.service');
    await settings.updateSettings({
      turnstile: { enabled: false },
      registration: { studentRegistrationOpen: true, requireEmailVerification: true },
      security: { requireMfaForSuperAdmin: false, requireMfaForAdmins: false },
    } as never, '000000000000000000000000');
    hash = await crypto.hashPassword(PASSWORD);
  }, 180_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await mongoose.disconnect();
    await mongo?.stop();
  });

  it('generates uniform 6-digit codes', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const c = crypto.randomDigits(6);
      expect(c).toMatch(/^\d{6}$/);
      seen.add(c);
    }
    expect(seen.size).toBeGreaterThan(190);
  });

  // ---------------------------------------------------------------- verification by code
  it('registers with a code, stores only its hash, and verifies once without signing in', async () => {
    const email = 'otp-reg1@srmap.edu.in';
    const reg = await register(email, 'OTP-1', 'otp');
    expect(reg.status, JSON.stringify(reg.body)).toBe(201);
    expect(reg.body.data.verificationMethod).toBe('otp');
    expect(reg.body.data.maskedEmail).toBe('o***@srmap.edu.in');
    const ticket = reg.body.data.verificationTicket as string;
    expect(ticket).toMatch(/^vt1\./);

    const code = await codeFor(email, 'verify_email_code');
    expect(code).toMatch(/^\d{6}$/);
    const user = await M.User.findOne({ email });
    const otp = await M.EmailOtp.findOne({ userId: user!._id }).lean();
    expect(otp!.codeHash).not.toContain(code);
    expect(JSON.stringify(otp)).not.toContain(`"${code}"`);
    // No link was sent alongside the code.
    expect(await M.EmailVerificationToken.countDocuments({ userId: user!._id })).toBe(0);

    // Queuing the email did not verify anything, and sign-in is still refused (with a ticket, after the right password).
    const blocked = await post('/login', { email, password: PASSWORD });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('email_not_verified');
    expect(blocked.body.error.details.verificationTicket).toMatch(/^vt1\./);
    expect(blocked.body.error.details.maskedEmail).toBe('o***@srmap.edu.in');
    const badPassword = await post('/login', { email, password: 'Not-The-Password-9' });
    expect(badPassword.body.error.details?.verificationTicket).toBeUndefined();

    const status = await post('/verification/status', { ticket });
    expect(status.status).toBe(200);
    expect(status.body.data).toMatchObject({ emailVerified: false, method: 'otp', active: true, attemptsLeft: 5, otpAvailable: true, maskedEmail: 'o***@srmap.edu.in' });
    expect(status.body.data.delivery.status).toBe('sending'); // queued, not yet accepted: never reported as delivered
    expect(JSON.stringify(status.body)).not.toContain(code);
    expect(JSON.stringify(status.body)).not.toContain(email);

    const miss = await post('/verify-email/otp', { email, code: wrong(code), ticket });
    expect(miss.status).toBe(400);
    expect(miss.body.error.code).toBe('invalid_code');
    expect(miss.body.error.details.attemptsLeft).toBe(4);

    const okRes = await post('/verify-email/otp', { email, code, ticket });
    expect(okRes.status, JSON.stringify(okRes.body)).toBe(200);
    expect(okRes.body.data).toEqual({ result: 'verified' });
    expect(okRes.body.data.sessionToken).toBeUndefined();
    const after = await M.User.findById(user!._id).lean();
    expect(after!.emailVerified).toBe(true);
    expect(after!.accountStatus).toBe('active');

    // Single use: replay is refused (detailed for the ticket holder, generic otherwise).
    expect((await post('/verify-email/otp', { email, code, ticket })).body.data.result).toBe('already_verified');
    const replay = await post('/verify-email/otp', { email, code });
    expect(replay.status).toBe(400);
    expect(replay.body.error.code).toBe('invalid_code');
    expect((await post('/login', { email, password: PASSWORD })).status).toBe(200);
  });

  it('answers code checks without a ticket identically for unknown and real accounts', async () => {
    const email = 'otp-enum@srmap.edu.in';
    await register(email, 'OTP-2', 'otp');
    const code = await codeFor(email, 'verify_email_code');
    const real = await post('/verify-email/otp', { email, code: wrong(code) });
    const ghost = await post('/verify-email/otp', { email: 'otp-ghost@srmap.edu.in', code: '123456' });
    expect(real.status).toBe(400);
    expect(real.body).toEqual(ghost.body);
    expect(real.body.error.details).toBeUndefined();
    // A ticket for another account does not unlock detailed answers.
    const other = await register('otp-other@srmap.edu.in', 'OTP-3', 'otp');
    const foreign = await post('/verify-email/otp', { email, code: wrong(code), ticket: other.body.data.verificationTicket });
    expect(foreign.body).toEqual(ghost.body);
    // Malformed and forged tickets are refused.
    expect((await post('/verification/status', { ticket: 'vt1.000000000000000000000000.zz.deadbeef' })).body.error.code).toBe('invalid_ticket');
    const t = other.body.data.verificationTicket as string;
    const forged = t.replace(/^vt1\.[a-f0-9]{24}/, `vt1.${String((await M.User.findOne({ email }))!._id)}`);
    expect((await post('/verification/status', { ticket: forged })).status).toBe(401);
  });

  it('burns a code after 5 wrong guesses, even if the right one comes next', async () => {
    const email = 'otp-brute@srmap.edu.in';
    const reg = await register(email, 'OTP-4', 'otp');
    const ticket = reg.body.data.verificationTicket;
    const code = await codeFor(email, 'verify_email_code');
    // Parallel guesses cannot get more than 5 tries.
    const guesses = await Promise.all(Array.from({ length: 8 }, (_, i) => post('/verify-email/otp', { email, code: String((Number(code) + 1 + i) % 1_000_000).padStart(6, '0'), ticket })));
    expect(guesses.every((g) => g.status >= 400)).toBe(true);
    const otp = await M.EmailOtp.findOne({ email }).lean();
    expect(otp!.attempts).toBeLessThanOrEqual(5);
    expect(otp!.endedReason).toBe('too_many_attempts');
    const late = await post('/verify-email/otp', { email, code, ticket });
    expect(late.status).toBe(429);
    expect(late.body.error.code).toBe('too_many_attempts');
    expect((await M.User.findOne({ email }).lean())!.emailVerified).toBe(false);
  });

  it('expires codes', async () => {
    const email = 'otp-expire@srmap.edu.in';
    const reg = await register(email, 'OTP-5', 'otp');
    const code = await codeFor(email, 'verify_email_code');
    await M.EmailOtp.updateMany({ email }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const r = await post('/verify-email/otp', { email, code, ticket: reg.body.data.verificationTicket });
    expect(r.status).toBe(410);
    expect(r.body.error.code).toBe('expired_code');
    expect(r.body.error.message).toBe('Code expired. Request a new one.');
    expect((await post('/verify-email/otp', { email, code })).body.error.code).toBe('invalid_code');
  });

  it('switches between code and link with a cooldown, and only the newest one works', async () => {
    const email = 'otp-switch@srmap.edu.in';
    const reg = await register(email, 'OTP-6', 'otp');
    const ticket = reg.body.data.verificationTicket;
    const user = await M.User.findOne({ email });
    const firstCode = await codeFor(email, 'verify_email_code');

    const tooSoon = await post('/verification/send', { ticket, method: 'link' });
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.error.code).toBe('resend_cooldown');
    expect(tooSoon.body.error.details.retryAfterSeconds).toBeGreaterThan(0);

    await ageChallenges(user!._id);
    const toLink = await post('/verification/send', { ticket, method: 'link' });
    expect(toLink.status, JSON.stringify(toLink.body)).toBe(200);
    expect(toLink.body.data.method).toBe('link');
    expect(toLink.body.data.retryAfterSeconds).toBeGreaterThan(0);
    // The superseded code no longer works.
    expect((await post('/verify-email/otp', { email, code: firstCode, ticket })).status).toBe(400);
    const link = new URL((await latestVars(email, 'verify_email')).link!);
    expect(link.pathname).toBe('/verify-email');
    const linkToken = link.searchParams.get('token')!;

    await ageChallenges(user!._id);
    const backToCode = await post('/verification/send', { ticket, method: 'otp' });
    expect(backToCode.body.data.method).toBe('otp');
    // The superseded link no longer works either.
    expect((await post('/verify-email/check', { token: linkToken })).body.data.state).toBe('invalid');
    const code = await codeFor(email, 'verify_email_code');
    expect((await post('/verify-email/otp', { email, code, ticket })).body.data.result).toBe('verified');
    const done = await post('/verification/send', { ticket, method: 'otp' });
    expect(done.status).toBe(200);
    expect(done.body.data.emailVerified).toBe(true);
  });

  it('keeps link verification working and lets it end an outstanding code', async () => {
    const email = 'otp-link@srmap.edu.in';
    const reg = await register(email, 'OTP-7'); // older clients: no method means a link
    expect(reg.body.data.verificationMethod).toBe('link');
    const token = new URL((await latestVars(email, 'verify_email')).link!).searchParams.get('token')!;
    expect((await post('/verify-email', { token })).body.data.result).toBe('verified');
    expect((await M.User.findOne({ email }).lean())!.emailVerified).toBe(true);
  });

  it('caps verification emails per account per hour across links and codes', async () => {
    const email = 'otp-cap@srmap.edu.in';
    const reg = await register(email, 'OTP-8', 'otp');
    const user = await M.User.findOne({ email });
    for (let i = 0; i < 4; i++) {
      await ageChallenges(user!._id, 61_000);
      const r = await post('/verification/send', { ticket: reg.body.data.verificationTicket, method: i % 2 ? 'otp' : 'link' });
      expect(r.status, `send ${i}: ${JSON.stringify(r.body)}`).toBe(200);
    }
    await ageChallenges(user!._id, 61_000);
    const capped = await post('/verification/send', { ticket: reg.body.data.verificationTicket, method: 'otp' });
    expect(capped.status).toBe(429);
    // The public resend stays generic even when capped.
    const generic = await post('/resend-verification', { email, method: 'otp' });
    const ghost = await post('/resend-verification', { email: 'otp-cap-ghost@srmap.edu.in', method: 'otp' });
    expect(generic.status).toBe(200);
    expect({ ...generic.body.data }).toEqual({ ...ghost.body.data });
  });

  // ---------------------------------------------------------------- password recovery by code
  it('resets a password with a code: generic answers, single use, sessions revoked, no sign-in', async () => {
    const email = 'otp-reset1@srmap.edu.in';
    const user = await makeUser(email);
    const signedIn = await post('/login', { email, password: PASSWORD });
    const oldSession = signedIn.body.data.sessionToken as string;

    const known = await post('/forgot-password', { email, method: 'otp' });
    const unknown = await post('/forgot-password', { email: 'otp-reset-ghost@srmap.edu.in', method: 'otp' });
    expect(known.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    expect(known.body.data.method).toBe('otp');
    expect(await M.PasswordResetToken.countDocuments({ userId: user._id })).toBe(0); // a code, not a link
    const code = await codeFor(email, 'password_reset_code');

    const bad = await post('/reset-password/otp', { email, code: wrong(code) });
    const ghost = await post('/reset-password/otp', { email: 'otp-reset-ghost@srmap.edu.in', code });
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual(ghost.body);

    const exchanged = await post('/reset-password/otp', { email, code });
    expect(exchanged.status, JSON.stringify(exchanged.body)).toBe(200);
    const resetToken = exchanged.body.data.resetToken as string;
    expect(exchanged.body.data.sessionToken).toBeUndefined();
    // The code is single use.
    expect((await post('/reset-password/otp', { email, code })).status).toBe(400);
    // The password is unchanged until the new one is submitted; the old session still works for now.
    expect((await post('/login', { email, password: PASSWORD })).status).toBe(200);

    // Existing password rules apply.
    const weak = await post('/reset-password', { token: resetToken, password: 'short', confirmPassword: 'short' });
    expect(weak.status).toBe(422);
    const done = await post('/reset-password', { token: resetToken, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.data.sessionToken).toBeUndefined();
    // Replay of the reset token is refused.
    expect((await post('/reset-password', { token: resetToken, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })).status).toBe(400);

    const me = await request(app).get('/api/v1/auth/me').set(STUDENT_APP).set('Authorization', `Bearer ${oldSession}`);
    expect(me.status).toBe(401);
    expect((await post('/login', { email, password: PASSWORD })).status).toBe(401);
    expect((await post('/login', { email, password: NEW_PASSWORD })).status).toBe(200);
    expect(await M.EmailDelivery.countDocuments({ to: email, template: 'password_changed' })).toBe(1);
  });

  it('limits reset code guesses and invalidates codes when a link is used instead', async () => {
    const email = 'otp-reset2@srmap.edu.in';
    const user = await makeUser(email);
    await post('/forgot-password', { email, method: 'otp' });
    const code = await codeFor(email, 'password_reset_code');
    for (let i = 0; i < 5; i++) expect((await post('/reset-password/otp', { email, code: wrong(code) })).status).toBe(400);
    expect((await post('/reset-password/otp', { email, code })).status).toBe(400);

    await ageChallenges(user._id);
    await post('/forgot-password', { email, method: 'otp' });
    const second = await codeFor(email, 'password_reset_code');
    await ageChallenges(user._id);
    await post('/forgot-password', { email, method: 'link' });
    // Asking for a link ended the code.
    expect((await post('/reset-password/otp', { email, code: second })).status).toBe(400);
    const token = new URL((await latestVars(email, 'password_reset')).link!).searchParams.get('token')!;
    expect((await post('/reset-password', { token, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })).status).toBe(200);
  });

  it('lets eligible staff use codes in CampusCare College', async () => {
    const email = 'otp-counsellor@srmap.edu.in';
    await makeUser(email, { role: 'counsellor' });
    expect((await post('/forgot-password', { email, method: 'otp' }, COLLEGE_APP)).status).toBe(200);
    const code = await codeFor(email, 'password_reset_code');
    const ex = await post('/reset-password/otp', { email, code }, COLLEGE_APP);
    expect(ex.status).toBe(200);
    expect((await post('/reset-password', { token: ex.body.data.resetToken, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }, COLLEGE_APP)).status).toBe(200);
    expect((await post('/login', { email, password: NEW_PASSWORD }, COLLEGE_APP)).status).toBe(200);
  });

  it('never gives Super Admin accounts a code: they get their usual reset link', async () => {
    const email = 'otp-root@srmap.edu.in';
    const admin = await makeUser(email, { role: 'super_admin' });
    const r = await post('/forgot-password', { email, method: 'otp' });
    const ghost = await post('/forgot-password', { email: 'otp-root-ghost@srmap.edu.in', method: 'otp' });
    expect(r.body).toEqual(ghost.body);
    expect(await M.EmailOtp.countDocuments({ userId: admin._id })).toBe(0);
    expect(await M.EmailDelivery.countDocuments({ to: email, template: 'password_reset_code' })).toBe(0);
    expect(await M.EmailDelivery.countDocuments({ to: email, template: 'password_reset' })).toBe(1);
    // Even a code planted for the account is refused.
    await M.EmailOtp.create({ userId: admin._id, email, purpose: 'password_reset', codeHash: 'x', expiresAt: new Date(Date.now() + 600_000) });
    expect((await post('/reset-password/otp', { email, code: '000000' })).status).toBe(400);

    const unverified = await makeUser('otp-root2@srmap.edu.in', { role: 'super_admin', emailVerified: false, accountStatus: 'pending_verification' });
    await post('/resend-verification', { email: 'otp-root2@srmap.edu.in', method: 'otp' });
    expect(await M.EmailOtp.countDocuments({ userId: unverified._id })).toBe(0);
    expect(await M.EmailDelivery.countDocuments({ to: 'otp-root2@srmap.edu.in', template: 'verify_email' })).toBe(1);
  });

  it('keeps codes out of the delivery log and of finished email jobs', async () => {
    const email = 'otp-log@srmap.edu.in';
    await makeUser(email);
    await post('/forgot-password', { email, method: 'otp' });
    const code = await codeFor(email, 'password_reset_code');
    const delivery = await M.EmailDelivery.findOne({ to: email, template: 'password_reset_code' }).lean();
    expect(JSON.stringify(delivery)).not.toContain(code);
    // Once the job runs, its payload (which held the code) is wiped.
    while ((await jobs.runDueJobs()) > 0) { /* drain */ }
    const job = await M.Job.findOne({ 'payload.deliveryId': String(delivery!._id) }).lean();
    expect(job).toBeNull();
    const ran = await M.Job.find({ type: 'email.send', status: 'done' }).lean();
    expect(JSON.stringify(ran)).not.toContain(code);
  });

  // ---------------------------------------------------------------- provider problems (keep last)
  it('shows a refused recipient as rejected and leaves the account unverified and recoverable', async () => {
    const nodemailer = (await import('nodemailer')).default;
    while ((await jobs.runDueJobs()) > 0) { /* drain the console-provider queue first */ }
    const sendMail = vi.fn().mockRejectedValue(Object.assign(new Error('550 5.1.1 The email account that you tried to reach does not exist (stub)'), { responseCode: 550 }));
    const spy = vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail, close: vi.fn(), verify: vi.fn() } as never);
    const cfg = await M.EmailProviderConfig.create({
      type: 'nodemailer', service: 'gmail', fromName: 'CampusCare', fromEmail: 'noreply@example.invalid',
      authUser: 'stub@example.invalid', authPassEnc: crypto.encryptSecret('stub-password'), active: true,
    });
    try {
      const email = 'otp-bounce@srmap.edu.in';
      const reg = await register(email, 'OTP-9', 'otp');
      expect(reg.status).toBe(201);
      await jobs.runDueJobs();
      const status = await post('/verification/status', { ticket: reg.body.data.verificationTicket });
      expect(status.body.data.delivery.status).toBe('rejected');
      expect(status.body.data.emailVerified).toBe(false);
      const u = await M.User.findOne({ email }).lean();
      expect(u!.accountStatus).toBe('pending_verification');
      expect(u!.emailVerified).toBe(false);
    } finally {
      spy.mockRestore();
      await M.EmailProviderConfig.deleteOne({ _id: cfg._id });
    }
  });
});
