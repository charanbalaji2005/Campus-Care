/**
 * Native Google sign-in for the Android apps (POST /auth/google/mobile). ID tokens are signed here with
 * a test RSA key; only Google's public-certificate download is stubbed, so signature, audience, issuer,
 * expiry and nonce are verified by the real google-auth-library code. Private in-memory MongoDB.
 * SKIP_DB_TESTS=true skips.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';

const d = process.env.SKIP_DB_TESTS === 'true' ? describe.skip : describe;
const WEB_CLIENT = '1234567890-web.apps.googleusercontent.com';
const KID = 'test-key-1';
const signer = generateKeyPairSync('rsa', { modulusLength: 2048 });
const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = (k: typeof signer) => k.publicKey.export({ type: 'spki', format: 'pem' }).toString();

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
function idToken(claims: Record<string, unknown>, key = signer) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', kid: KID, typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iss: 'https://accounts.google.com', aud: WEB_CLIENT, iat: now, exp: now + 3600, email_verified: true, ...claims }));
  const sig = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(key.privateKey);
  return `${header}.${payload}.${b64url(sig)}`;
}

d('Native Google sign-in (integration)', () => {
  let mongo: { stop: () => Promise<boolean>; getUri: () => string };
  let app: import('express').Express;
  let M: typeof import('../src/models/user') & typeof import('../src/models/platform');
  const ids: Record<string, string> = {};

  const post = (appAudience: 'student' | 'college', body: Record<string, unknown>) =>
    request(app).post('/api/v1/auth/google/mobile').set('X-CampusCare-Client', 'android').set('X-CampusCare-App', appAudience).send(body);
  const signIn = (appAudience: 'student' | 'college', sub: string, email: string, extra: Record<string, unknown> = {}) =>
    post(appAudience, { idToken: idToken({ sub, email, nonce: 'n-1', ...extra }), nonce: 'n-1' });

  beforeAll(async () => {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    mongo = await MongoMemoryServer.create();
    await (await import('../src/db/connect')).connectDatabase(mongo.getUri());
    app = (await import('../src/app')).createApp();
    M = { ...(await import('../src/models/user')), ...(await import('../src/models/platform')) };
    for (const name of mongoose.modelNames()) await mongoose.model(name).syncIndexes();
    const { encryptSecret } = await import('../src/lib/crypto');
    await M.IdentityProviderConfig.create({ provider: 'google', enabled: true, clientId: WEB_CLIENT, clientSecretEnc: encryptSecret('test-secret'), allowedDomains: [] });
    // The only stub: Google's signing certificates.
    vi.spyOn(OAuth2Client.prototype, 'getFederatedSignonCertsAsync').mockResolvedValue({ certs: { [KID]: pem(signer) }, format: 'PEM' } as never);
    const make = async (name: string, role: string, extra: Record<string, unknown> = {}) => {
      const u = await M.User.create({ fullName: `${name} Person`, email: `${name}@srmap.edu.in`, role, emailVerified: true, accountStatus: 'active', ...extra });
      ids[name] = String(u._id);
    };
    await make('counsellor1', 'counsellor');
    await make('guard1', 'security_officer');
    await make('campusadmin', 'admin');
    await make('student1', 'student', { studentId: 'AP22110010001' });
    await make('suspended', 'counsellor', { accountStatus: 'suspended' });
    await make('invited', 'counsellor', { accountStatus: 'pending_verification' });
  }, 120_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await mongoose.disconnect();
    await mongo?.stop();
  });

  it('signs eligible staff into the College app with a session token bound to that app', async () => {
    for (const [name, role] of [['counsellor1', 'counsellor'], ['guard1', 'security_officer'], ['campusadmin', 'admin']] as const) {
      const r = await signIn('college', `sub-${name}`, `${name}@srmap.edu.in`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.data.user.role).toBe(role);
      expect(r.body.data.sessionToken).toEqual(expect.any(String));
      expect(r.body.data.created).toBe(false);
      const session = await M.Session.findOne({ userId: ids[name] }).sort({ createdAt: -1 }).lean();
      expect(session).toBeTruthy();
    }
    // The Google identity is now linked by its stable subject, not by email.
    expect(await M.ExternalIdentity.countDocuments({ provider: 'google', subject: 'sub-counsellor1', userId: ids.counsellor1 })).toBe(1);
  });

  it('keeps the session across requests and ends it on logout', async () => {
    const r = await signIn('college', 'sub-counsellor1', 'counsellor1@srmap.edu.in');
    const token = r.body.data.sessionToken as string;
    const authed = () => request(app).get('/api/v1/auth/google/status').set('Authorization', `Bearer ${token}`).set('X-CampusCare-Client', 'android').set('X-CampusCare-App', 'college');
    expect((await authed()).body.data).toEqual({ linked: true });
    // A College session cannot be used by the Student app (the session is not honoured there).
    expect((await request(app).get('/api/v1/auth/google/status').set('Authorization', `Bearer ${token}`).set('X-CampusCare-Client', 'android').set('X-CampusCare-App', 'student')).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/logout').set('Authorization', `Bearer ${token}`).set('X-CampusCare-Client', 'android').set('X-CampusCare-App', 'college')).status).toBe(200);
    expect((await authed()).status).toBe(401);
  });

  it('rejects a student account in the College app without creating a session', async () => {
    const before = await M.Session.countDocuments({ userId: ids.student1 });
    const r = await signIn('college', 'sub-student1', 'student1@srmap.edu.in');
    expect(r.status).toBe(403);
    expect(r.body.error.message).toMatch(/student/i);
    expect(await M.Session.countDocuments({ userId: ids.student1 })).toBe(before);
    // The same student signs in normally in the Student app.
    expect((await signIn('student', 'sub-student1', 'student1@srmap.edu.in')).status).toBe(200);
  });

  it('never creates an account from the College app, whatever the client sends', async () => {
    const r = await post('college', { idToken: idToken({ sub: 'sub-new', email: 'newperson@srmap.edu.in', nonce: 'n-1' }), nonce: 'n-1', role: 'super_admin', email: 'counsellor1@srmap.edu.in' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('no_staff_account');
    expect(r.body.error.message).toMatch(/campus administrator/);
    expect(await M.User.countDocuments({ email: 'newperson@srmap.edu.in' })).toBe(0);
    expect(await M.ExternalIdentity.countDocuments({ subject: 'sub-new' })).toBe(0);
  });

  it('applies the account status policy', async () => {
    expect((await signIn('college', 'sub-suspended', 'suspended@srmap.edu.in')).body.error.code).toBe('account_suspended');
    expect((await signIn('college', 'sub-invited', 'invited@srmap.edu.in')).body.error.code).toBe('account_inactive');
  });

  it('refuses tokens that fail verification and never stores or logs them', async () => {
    const bad: [string, string][] = [
      ['wrong audience', idToken({ sub: 'sub-guard1', email: 'guard1@srmap.edu.in', nonce: 'n-1', aud: 'someone-else.apps.googleusercontent.com' })],
      ['expired', idToken({ sub: 'sub-guard1', email: 'guard1@srmap.edu.in', nonce: 'n-1', iat: Math.floor(Date.now() / 1000) - 7200, exp: Math.floor(Date.now() / 1000) - 3600 })],
      ['wrong issuer', idToken({ sub: 'sub-guard1', email: 'guard1@srmap.edu.in', nonce: 'n-1', iss: 'https://evil.example.com' })],
      ['forged signature', idToken({ sub: 'sub-guard1', email: 'guard1@srmap.edu.in', nonce: 'n-1' }, stranger)],
    ];
    for (const [label, token] of bad) {
      const r = await post('college', { idToken: token, nonce: 'n-1' });
      expect(r.status, label).toBe(401);
      expect(r.body.error.code, label).toBe('oauth_failed');
    }
    const replay = await post('college', { idToken: idToken({ sub: 'sub-guard1', email: 'guard1@srmap.edu.in', nonce: 'n-1' }), nonce: 'other-nonce' });
    expect(replay.status).toBe(401);
    const unverified = await signIn('college', 'sub-guard1', 'guard1@srmap.edu.in', { email_verified: false });
    expect(unverified.body.error.code).toBe('google_email_unverified');
    const logs = JSON.stringify(await M.AuditLog.find({}).lean());
    expect(logs).not.toContain(bad[0]![1].split('.')[2]);
    expect(await M.AuditLog.countDocuments({ action: 'auth.google_failed' })).toBeGreaterThanOrEqual(5);
  });
});
