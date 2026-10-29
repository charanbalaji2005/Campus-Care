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
  const payload = b64url(JSON.stringify({ iss: 'https://accounts.google.com', aud: WEB_CLIENT, iat: now, exp: now + 3600, email_verified: true, hd: 'srmap.edu.in', ...claims }));
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
    await make('superadmin1', 'super_admin', { mfaEnabled: true });
    await make('mfaadmin', 'admin', { mfaEnabled: true });
    await make('applicant1', 'security_officer', { accountStatus: 'pending_verification', approvalRequired: true });
    await make('unverified1', 'student', { emailVerified: false, studentId: 'AP22110010002' });
    await make('pwstudent', 'student', { studentId: 'AP22110010003' });
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
    // It offers a staff application (a sealed ticket for the form), never an account or a role.
    expect(r.body.error.message).toMatch(/register as college staff/);
    expect(r.body.error.details.staffRegistrationTicket).toMatch(/^gr1\./);
    expect(r.body.error.details.email).toBe('newperson@srmap.edu.in');
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

  it('Student app: sign-in never creates an account, sign-up creates only a student', async () => {
    const r = await post('student', { idToken: idToken({ sub: 'sub-fresh', email: 'fresh.student@srmap.edu.in', nonce: 'n-1' }), nonce: 'n-1', intent: 'sign_in' });
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('no_student_account');
    expect(await M.User.countDocuments({ email: 'fresh.student@srmap.edu.in' })).toBe(0);

    // A role in the body is ignored: Google sign-up in the Student app only ever makes a student.
    const up = await post('student', { idToken: idToken({ sub: 'sub-fresh', email: 'fresh.student@srmap.edu.in', nonce: 'n-1' }), nonce: 'n-1', intent: 'sign_up', role: 'admin' });
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    expect(up.body.data).toMatchObject({ created: true, needsStudentId: true, applicationPending: false });
    expect(up.body.data.user.role).toBe('student');
    expect(up.body.data.sessionToken).toEqual(expect.any(String));
    // Signing up again with the same Google account signs in to the same account (no duplicate).
    const again = await post('student', { idToken: idToken({ sub: 'sub-fresh', email: 'fresh.student@srmap.edu.in', nonce: 'n-1' }), nonce: 'n-1', intent: 'sign_up' });
    expect(again.body.data.created).toBe(false);
    expect(await M.User.countDocuments({ email: 'fresh.student@srmap.edu.in' })).toBe(1);
    expect(await M.ExternalIdentity.countDocuments({ subject: 'sub-fresh' })).toBe(1);
  });

  it('an older Student build (no app header) may still sign up; the website never can', async () => {
    const legacy = await request(app).post('/api/v1/auth/google/mobile').set('X-CampusCare-Client', 'android')
      .send({ idToken: idToken({ sub: 'sub-legacy', email: 'legacy.student@srmap.edu.in', nonce: 'n-1' }), nonce: 'n-1' });
    expect(legacy.status, JSON.stringify(legacy.body)).toBe(200);
    expect(legacy.body.data.user.role).toBe('student');
    const web = await request(app).post('/api/v1/auth/google/mobile')
      .send({ idToken: idToken({ sub: 'sub-web', email: 'web.person@srmap.edu.in', nonce: 'n-1' }), nonce: 'n-1', intent: 'sign_up' });
    expect(web.status).toBe(403);
    expect(await M.User.countDocuments({ email: 'web.person@srmap.edu.in' })).toBe(0);
  });

  it('refuses staff accounts in the Student app without linking, converting or creating anything', async () => {
    for (const name of ['guard1', 'campusadmin'] as const) {
      const sessions = await M.Session.countDocuments({ userId: ids[name] });
      const r = await post('student', { idToken: idToken({ sub: `sub-st-${name}`, email: `${name}@srmap.edu.in`, nonce: 'n-1' }), nonce: 'n-1', intent: 'sign_up' });
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('wrong_app');
      expect(r.body.error.details.app).toBe('college');
      expect(await M.Session.countDocuments({ userId: ids[name] })).toBe(sessions);
      expect(await M.ExternalIdentity.countDocuments({ subject: `sub-st-${name}` })).toBe(0);
    }
    expect((await M.User.findById(ids.guard1).lean())!.role).toBe('security_officer');
    expect(await M.User.countDocuments({ email: 'guard1@srmap.edu.in' })).toBe(1);
  });

  it('joins an existing account by email only when Google manages that address', async () => {
    // No Workspace `hd` claim: an email match alone is not proof, so nothing is linked.
    const r = await post('student', { idToken: idToken({ sub: 'sub-pw', email: 'pwstudent@srmap.edu.in', nonce: 'n-1', hd: undefined }), nonce: 'n-1' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('google_link_required');
    expect(await M.ExternalIdentity.countDocuments({ subject: 'sub-pw' })).toBe(0);
    // A Workspace domain other than the address's own is not proof either.
    const other = await post('student', { idToken: idToken({ sub: 'sub-pw', email: 'pwstudent@srmap.edu.in', nonce: 'n-1', hd: 'example.org' }), nonce: 'n-1' });
    expect(other.body.error.code).toBe('google_link_required');
    // With Google as the authority for the address, the existing account (same user ID) is linked.
    const linked = await signIn('student', 'sub-pw', 'pwstudent@srmap.edu.in');
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);
    expect(linked.body.data.user.id).toBe(ids.pwstudent);
    expect(await M.ExternalIdentity.countDocuments({ subject: 'sub-pw', userId: ids.pwstudent })).toBe(1);
    expect(await M.User.countDocuments({ email: 'pwstudent@srmap.edu.in' })).toBe(1);
  });

  it('a Google identity linked to one account never signs in to another', async () => {
    // sub-pw belongs to pwstudent now; a token for it carrying the counsellor's address still means pwstudent.
    const since = new Date();
    const r = await post('college', { idToken: idToken({ sub: 'sub-pw', email: 'counsellor1@srmap.edu.in', nonce: 'n-1' }), nonce: 'n-1' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('wrong_app');
    expect(await M.Session.countDocuments({ userId: ids.counsellor1, createdAt: { $gte: since } })).toBe(0);
  });

  it('never marks an existing account verified just because Google signed in', async () => {
    const r = await signIn('student', 'sub-unverified1', 'unverified1@srmap.edu.in');
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('email_not_verified');
    expect(r.body.error.details.verificationTicket).toEqual(expect.any(String));
    expect((await M.User.findById(ids.unverified1).lean())!.emailVerified).toBe(false);
    expect(await M.ExternalIdentity.countDocuments({ subject: 'sub-unverified1' })).toBe(0);
  });

  it('accounts with MFA (Super Admin, admins) get only a challenge, never a session, from Google', async () => {
    for (const name of ['superadmin1', 'mfaadmin'] as const) {
      const before = await M.Session.countDocuments({ userId: ids[name] });
      const r = await signIn('college', `sub-${name}`, `${name}@srmap.edu.in`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.data.mfaRequired).toBe(true);
      expect(r.body.data.challengeToken).toEqual(expect.any(String));
      expect(r.body.data.sessionToken).toBeUndefined();
      expect(await M.Session.countDocuments({ userId: ids[name] })).toBe(before);
    }
    const challenge = (await signIn('college', 'sub-mfaadmin', 'mfaadmin@srmap.edu.in')).body.data.challengeToken;
    const bad = await request(app).post('/api/v1/auth/mfa/challenge').set('X-CampusCare-Client', 'android').set('X-CampusCare-App', 'college')
      .send({ challengeToken: challenge, code: '000000' });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(await M.Session.countDocuments({ userId: ids.mfaadmin })).toBe(0);
  });

  it('a staff applicant gets only the restricted application session', async () => {
    const r = await signIn('college', 'sub-applicant1', 'applicant1@srmap.edu.in');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.applicationPending).toBe(true);
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${r.body.data.sessionToken}`).set('X-CampusCare-Client', 'android').set('X-CampusCare-App', 'college');
    expect((await auth(request(app).get('/api/v1/auth/me'))).status).toBe(200);
    const blocked = await auth(request(app).get('/api/v1/auth/google/status'));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('approval_pending');
    // No realtime (Socket.IO) ticket either.
    expect((await auth(request(app).post('/api/v1/auth/realtime-ticket'))).status).toBe(403);
  });

  it('student sign-up follows the student domain policy, not the staff one', async () => {
    const dom = await M.EmailDomain.create({ domain: 'srmap.edu.in', purpose: 'staff', status: 'active', verificationToken: 't' });
    try {
      const r = await post('student', { idToken: idToken({ sub: 'sub-staffdomain', email: 'staffdomain@srmap.edu.in', nonce: 'n-1' }), nonce: 'n-1', intent: 'sign_up' });
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('domain_not_allowed');
      expect(await M.User.countDocuments({ email: 'staffdomain@srmap.edu.in' })).toBe(0);
    } finally {
      await dom.deleteOne();
    }
  });

  it('only accepts tokens issued to the registered Android apps when they are configured', async () => {
    const { env } = await import('../src/config/env');
    const saved = env.GOOGLE_ANDROID_CLIENT_IDS;
    env.GOOGLE_ANDROID_CLIENT_IDS = 'student-android.apps.googleusercontent.com, college-android.apps.googleusercontent.com';
    try {
      const foreign = await signIn('college', 'sub-counsellor1', 'counsellor1@srmap.edu.in', { azp: 'other-app.apps.googleusercontent.com' });
      expect(foreign.status).toBe(401);
      expect(foreign.body.error.code).toBe('oauth_failed');
      expect((await signIn('college', 'sub-counsellor1', 'counsellor1@srmap.edu.in', { azp: 'college-android.apps.googleusercontent.com' })).status).toBe(200);
      expect((await signIn('student', 'sub-student1', 'student1@srmap.edu.in', { azp: 'student-android.apps.googleusercontent.com' })).status).toBe(200);
    } finally {
      env.GOOGLE_ANDROID_CLIENT_IDS = saved;
    }
  });
});
