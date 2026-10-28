/**
 * Account emails (verification, password reset) must link to the app's own screens on the App Links
 * domain, in both the HTML (button and visible URL) and the plain-text part, and never to the Super
 * Admin console or its sign-in. Console mail provider; in-memory MongoDB. SKIP_DB_TESTS=true skips.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';

// A separate link origin, to prove these links do not follow the console's WEB_ORIGIN.
process.env.FRONTEND_AUTH_URL = 'https://links.campuscare.example';

const d = process.env.SKIP_DB_TESTS === 'true' ? describe.skip : describe;

d('account email links (integration)', () => {
  let mongo: { stop: () => Promise<boolean>; getUri: () => string };
  let M: typeof import('../src/models/user') & typeof import('../src/models/platform');
  let auth: typeof import('../src/services/auth.service');
  let tpl: typeof import('../src/services/email/templates');
  let email: typeof import('../src/services/email/email.service');

  beforeAll(async () => {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    mongo = await MongoMemoryServer.create();
    const { connectDatabase } = await import('../src/db/connect');
    await connectDatabase(mongo.getUri());
    M = { ...(await import('../src/models/user')), ...(await import('../src/models/platform')) };
    auth = await import('../src/services/auth.service');
    tpl = await import('../src/services/email/templates');
    email = await import('../src/services/email/email.service');
    for (const name of mongoose.modelNames()) await mongoose.model(name).syncIndexes();
  }, 120_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo?.stop();
  });

  /** The email exactly as it would be sent: default template rendered with the queued variables. */
  async function rendered(to: string, template: 'verify_email' | 'password_reset') {
    const delivery = await M.EmailDelivery.findOne({ to, template }).sort({ createdAt: -1 }).lean();
    const job = await M.Job.findOne({ type: 'email.send', 'payload.deliveryId': String(delivery!._id) }).lean();
    const vars = { platformName: 'CampusCare', universityName: 'SRM University-AP', supportEmail: 'help@example.invalid', ...(job!.payload as { vars: Record<string, string> }).vars };
    return tpl.renderTemplate(tpl.DEFAULT_TEMPLATES[template], vars);
  }
  const urls = (s: string) => [...s.matchAll(/https?:\/\/[^\s"'<>]+/g)].map((m) => m[0].replace(/&amp;/g, '&'));

  it.each([
    ['verify_email', '/verify-email'],
    ['password_reset', '/reset-password'],
  ] as const)('%s links only to the app screen %s on the App Links domain', async (template, path) => {
    const to = `${template}@srmap.edu.in`;
    if (template === 'verify_email') {
      const u = await M.User.create({ fullName: 'Link Test', email: to, role: 'student', emailVerified: false, accountStatus: 'pending_verification' });
      await auth.issueEmailVerification(u);
    } else {
      await M.User.create({ fullName: 'Link Test', email: to, role: 'student', emailVerified: true, accountStatus: 'active' });
      expect(await auth.requestPasswordReset(to)).toBe('queued');
    }
    const msg = await rendered(to, template);
    const all = [...urls(msg.html), ...urls(msg.text)];
    expect(urls(msg.html).length).toBeGreaterThanOrEqual(2); // button href + visible copy
    expect(urls(msg.text)).toHaveLength(1);
    for (const raw of all) {
      const u = new URL(raw);
      expect(u.origin).toBe('https://links.campuscare.example');
      expect(u.pathname).toBe(path);
      expect(u.searchParams.get('token')).toMatch(/^[A-Za-z0-9_-]{40,}$/);
      expect(raw).not.toMatch(/super-admin|\/login|console|dashboard/i);
    }
    expect(`${msg.html} ${msg.text}`).not.toMatch(/super ?admin/i);
  });

  it('refuses to build an account link for any other path', () => {
    expect(() => email.accountLink('/super-admin/login' as never, 'x')).toThrow();
  });
});
