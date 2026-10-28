/**
 * Email delivery: honest statuses, permanent vs transient failures, bounce parsing and suppression,
 * and a worker that keeps sending even when a periodic task hangs. Nodemailer is stubbed, so no real
 * message is ever sent. Always runs against a private in-memory MongoDB. Set SKIP_DB_TESTS=true to skip.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { classifySendError, sanitizeProviderText } from '../src/services/email/email.service';
import { parseBounce } from '../src/services/email/bounce.service';

/** Shape of a Gmail "Address not found" notice (headers trimmed). */
const GMAIL_DSN = [
  'Return-Path: <>',
  'From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
  'To: sender@gmail.com',
  'X-Failed-Recipients: cc-demo-student@srmap.edu.in',
  'Subject: Delivery Status Notification (Failure)',
  'Message-ID: <dsn-1@mx.google.com>',
  'Date: Tue, 27 Oct 2026 19:21:14 -0700',
  'Content-Type: multipart/report; report-type=delivery-status; boundary="b"',
  '',
  '--b',
  'Content-Type: message/delivery-status',
  '',
  'Reporting-MTA: dns; googlemail.com',
  'Arrival-Date: Tue, 27 Oct 2026 19:21:13 -0700 (PDT)',
  '',
  'Final-Recipient: rfc822; cc-demo-student@srmap.edu.in',
  'Action: failed',
  'Status: 5.1.1',
  'Diagnostic-Code: smtp; 550-5.1.1 The email account that you tried to reach does not exist. Please try',
  '    550-5.1.1 double-checking the recipient\'s email address for typos.',
  '',
  '--b',
  'Content-Type: text/rfc822-headers',
  '',
  'From: CampusCare <sender@gmail.com>',
  'To: cc-demo-student@srmap.edu.in',
  'Subject: Report received',
  'Message-ID: <original-123@gmail.com>',
  '--b--',
].join('\r\n');

describe('email error handling (unit)', () => {
  it('tells a missing mailbox apart from provider and network problems', () => {
    expect(classifySendError({ responseCode: 550, response: '550-5.1.1 The email account that you tried to reach does not exist' })).toBe('recipient');
    expect(classifySendError({ code: 'EENVELOPE', responseCode: 553, response: '553 5.1.3 invalid address' })).toBe('recipient');
    expect(classifySendError({ code: 'EAUTH', responseCode: 535, response: '535-5.7.8 Username and Password not accepted' })).toBe('auth');
    expect(classifySendError(new Error('535 authentication failed'))).toBe('auth');
    expect(classifySendError({ responseCode: 550, response: '550 5.4.5 Daily user sending limit exceeded' })).toBe('transient');
    expect(classifySendError({ responseCode: 421, response: '421 4.7.0 Try again later' })).toBe('transient');
    expect(classifySendError({ code: 'ETIMEDOUT', message: 'Connection timeout' })).toBe('transient');
    expect(classifySendError({ responseCode: 552, response: '552 5.7.0 message content rejected' })).toBe('rejected');
  });

  it('never keeps addresses or links in stored provider text', () => {
    expect(sanitizeProviderText('550 5.1.1 <a.b@srmap.edu.in> unknown; see https://x.y/reset?token=abc\r\nmore')).toBe('550 5.1.1 <<address>> unknown; see <link>');
  });

  it('parses a Gmail bounce notice', () => {
    const n = parseBounce(GMAIL_DSN)!;
    expect(n.recipient).toBe('cc-demo-student@srmap.edu.in');
    expect(n.status).toBe('5.1.1');
    expect(n.permanent).toBe(true);
    expect(n.diagnostic).toMatch(/^550 5\.1\.1 The email account that you tried to reach does not exist/);
    expect(n.originalMessageId).toBe('<original-123@gmail.com>');
    expect(parseBounce('Subject: hello\r\n\r\nnot a bounce')).toBeNull();
  });
});

const d = process.env.SKIP_DB_TESTS === 'true' ? describe.skip : describe;

d('email delivery (integration)', () => {
  let mongo: { stop: () => Promise<boolean>; getUri: () => string };
  let M: typeof import('../src/models/platform');
  let email: typeof import('../src/services/email/email.service');
  let jobs: typeof import('../src/services/jobs.service');
  let crypto: typeof import('../src/lib/crypto');
  let sendMail: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    mongo = await MongoMemoryServer.create();
    const { connectDatabase } = await import('../src/db/connect');
    await connectDatabase(mongo.getUri());
    M = await import('../src/models/platform');
    email = await import('../src/services/email/email.service');
    jobs = await import('../src/services/jobs.service');
    crypto = await import('../src/lib/crypto');
    for (const name of mongoose.modelNames()) await mongoose.model(name).syncIndexes();
    const nodemailer = (await import('nodemailer')).default;
    sendMail = vi.fn();
    vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail: (...a: unknown[]) => sendMail(...a), close: vi.fn(), verify: vi.fn() } as never);
    await M.EmailProviderConfig.create({
      type: 'nodemailer', service: 'gmail', fromName: 'CampusCare', fromEmail: 'noreply@example.invalid',
      authUser: 'stub@example.invalid', authPassEnc: crypto.encryptSecret('stub-password'), active: true,
    });
  }, 120_000);

  afterEach(async () => {
    sendMail.mockReset();
    await M.EmailDelivery.deleteMany({});
    await M.Job.deleteMany({});
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await mongoose.disconnect();
    await mongo?.stop();
  });

  const deliveryTo = (to: string) => M.EmailDelivery.findOne({ to }).lean();

  it('records provider acceptance (not "delivered") with the provider reply', async () => {
    sendMail.mockResolvedValue({ messageId: '<m1@gmail.com>', response: '250 2.0.0 OK  1700000000 abc - gsmtp', accepted: ['ok@example.invalid'], rejected: [] });
    await email.sendEmail('password_reset', 'ok@example.invalid', { name: 'A', link: 'https://example.invalid/reset?token=secret', expiresIn: '30 minutes' });
    await jobs.runDueJobs();
    const dlv = await deliveryTo('ok@example.invalid');
    expect(dlv!.status).toBe('accepted_by_provider');
    expect(dlv!.providerResponse).toBe('250 2.0.0 OK  1700000000 abc - gsmtp');
    expect(dlv!.providerMessageId).toBe('<m1@gmail.com>');
  });

  it('a missing mailbox is rejected once, never retried, and does not block email for everyone', async () => {
    sendMail.mockRejectedValue(Object.assign(new Error('Can\'t send mail - all recipients were rejected'), { code: 'EENVELOPE', responseCode: 550, response: '550-5.1.1 The email account that you tried to reach does not exist.' }));
    for (const to of ['ghost1@example.invalid', 'ghost2@example.invalid', 'ghost3@example.invalid']) {
      await email.sendEmail('verify_email', to, { name: 'G', link: 'https://example.invalid/v', expiresIn: '1 day' });
    }
    while ((await jobs.runDueJobs()) > 0) { /* drain */ }
    const rejected = await M.EmailDelivery.find({ status: 'rejected' }).lean();
    expect(rejected).toHaveLength(3);
    expect(rejected[0]!.lastError).toMatch(/^Recipient rejected: 550 5\.1\.1|^Recipient rejected: 550-5\.1\.1/);
    expect(sendMail).toHaveBeenCalledTimes(3); // no retries
    expect(await M.Job.countDocuments({ status: 'pending' })).toBe(0);
    expect(await email.emailReadiness()).toEqual({ ready: true }); // three bad addresses ≠ a broken service
  });

  it('provider sign-in failures are retried and do mark the service as degraded', async () => {
    sendMail.mockRejectedValue(Object.assign(new Error('Invalid login'), { code: 'EAUTH', responseCode: 535, response: '535-5.7.8 Username and Password not accepted' }));
    for (const to of ['a1@example.invalid', 'a2@example.invalid', 'a3@example.invalid']) {
      await email.sendEmail('password_reset', to, { name: 'A', link: 'https://example.invalid/r', expiresIn: '30 minutes' });
    }
    await jobs.runDueJobs();
    const failed = await M.EmailDelivery.find({ status: 'failed' }).lean();
    expect(failed).toHaveLength(3);
    expect(failed[0]!.lastError).toMatch(/^Mail service sign-in failed: 535/);
    expect(await M.Job.countDocuments({ status: 'pending' })).toBe(3); // queued for retry with backoff
    expect((await email.emailReadiness()).ready).toBe(false);
  });

  it('suppresses an address that hard-bounced recently', async () => {
    await M.EmailDelivery.create({ template: 'verify_email', to: 'gone@example.invalid', toMasked: 'g***@example.invalid', status: 'bounced', bounceReason: '5.1.1: 550 5.1.1 does not exist' });
    await email.sendEmail('verify_email', 'gone@example.invalid', { name: 'G', link: 'https://example.invalid/v', expiresIn: '1 day' });
    await jobs.runDueJobs();
    expect(sendMail).not.toHaveBeenCalled();
    const latest = await M.EmailDelivery.findOne({ to: 'gone@example.invalid', status: 'rejected' }).lean();
    expect(latest!.lastError).toMatch(/earlier email to this address bounced/);
  });

  it('keeps sending queued email while a periodic task hangs', async () => {
    sendMail.mockResolvedValue({ messageId: '<m2@gmail.com>', response: '250 2.0.0 OK', accepted: ['x'], rejected: [] });
    jobs.registerPeriodic('test-hang', 1, () => new Promise<void>(() => { /* never resolves */ }));
    jobs.startWorker(50);
    try {
      await new Promise((r) => setTimeout(r, 200)); // the hung task is now running
      await email.sendEmail('password_reset', 'during-hang@example.invalid', { name: 'H', link: 'https://example.invalid/r', expiresIn: '30 minutes' });
      for (let i = 0; i < 40 && (await deliveryTo('during-hang@example.invalid'))?.status !== 'accepted_by_provider'; i++) await new Promise((r) => setTimeout(r, 50));
      expect((await deliveryTo('during-hang@example.invalid'))!.status).toBe('accepted_by_provider');
      const status = jobs.workerStatus();
      expect(status.runningInThisInstance).toBe(true);
      expect(status.secondsSinceLastTick).toBeLessThanOrEqual(1);
    } finally {
      jobs.stopWorker();
    }
  });
});
