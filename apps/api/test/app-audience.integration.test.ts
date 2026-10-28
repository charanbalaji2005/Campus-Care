/**
 * CampusCare Student vs CampusCare College: the API decides which app an account may use from its
 * role (never from anything the app claims), binds each session to the app that created it, and
 * keeps older app builds (no X-CampusCare-App header) working.
 * Runs against a private in-memory MongoDB; email goes to the console and push is unconfigured.
 * Set SKIP_DB_TESTS=true to skip.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';

const d = process.env.SKIP_DB_TESTS === 'true' ? describe.skip : describe;
const PASSWORD = 'App-Audience-Test-9';
const API = '/api/v1';
type App = 'student' | 'college' | null;

d('Student and College apps (integration)', () => {
  let mongo: { stop: () => Promise<boolean>; getUri: () => string };
  let app: import('express').Express;
  let M: typeof import('../src/models/user') & typeof import('../src/models/mobile');

  const headers = (which: App) => ({ 'X-CampusCare-Client': 'android', ...(which ? { 'X-CampusCare-App': which } : {}) });
  const login = (name: string, which: App, password = PASSWORD) =>
    request(app).post(`${API}/auth/login`).set(headers(which)).send({ email: `${name}@srmap.edu.in`, password });
  async function tokenFor(name: string, which: App) {
    const r = await login(name, which);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.data.sessionToken as string;
  }
  const me = (token: string, which: App) => request(app).get(`${API}/auth/me`).set(headers(which)).set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    mongo = await MongoMemoryServer.create();
    const { connectDatabase } = await import('../src/db/connect');
    await connectDatabase(mongo.getUri());
    const { createApp } = await import('../src/app');
    app = createApp();
    M = { ...(await import('../src/models/user')), ...(await import('../src/models/mobile')) };
    for (const name of mongoose.modelNames()) await mongoose.model(name).syncIndexes();
    const settings = await import('../src/services/settings.service');
    await settings.updateSettings({ turnstile: { enabled: false }, security: { requireMfaForSuperAdmin: false, requireMfaForAdmins: false } } as never, '000000000000000000000000');
    const { hashPassword } = await import('../src/lib/crypto');
    const hash = await hashPassword(PASSWORD);
    const make = (name: string, role: string, extra: Record<string, unknown> = {}) =>
      M.User.create({ fullName: `${name} Person`, email: `${name}@srmap.edu.in`, role, passwordHash: hash, emailVerified: true, accountStatus: 'active', ...extra });
    await make('aud-stu', 'student', { studentId: 'AP100' });
    await make('aud-stu2', 'student', { studentId: 'AP101' });
    await make('aud-cou', 'counsellor');
    await make('aud-sec', 'security_officer');
    await make('aud-adm', 'admin');
  }, 180_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo?.stop();
  });

  it('lets students into CampusCare Student only', async () => {
    const ok = await login('aud-stu', 'student');
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.user.role).toBe('student');
    const session = await M.Session.findOne({ userId: ok.body.data.user.id ?? ok.body.data.user._id }).sort({ createdAt: -1 });
    expect(session?.app).toBe('student');

    const refused = await login('aud-stu', 'college');
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('wrong_app');
    expect(refused.body.error.message).toContain('CampusCare Student');
    expect(refused.body.data?.sessionToken).toBeUndefined();
  });

  it('lets every staff role into CampusCare College only', async () => {
    for (const name of ['aud-cou', 'aud-sec', 'aud-adm']) {
      const ok = await login(name, 'college');
      expect(ok.status, `${name}: ${JSON.stringify(ok.body)}`).toBe(200);
      const refused = await login(name, 'student');
      expect(refused.status, name).toBe(403);
      expect(refused.body.error.code).toBe('wrong_app');
      expect(refused.body.error.message).toContain('CampusCare College');
    }
  });

  it('does not reveal the account type before the password is right', async () => {
    const r = await login('aud-cou', 'student', 'not-the-password-1');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('invalid_credentials');
  });

  it('refuses a student session presented by the College app, and ends it', async () => {
    const token = await tokenFor('aud-stu', 'student');
    expect((await me(token, 'student')).status).toBe(200);

    const swapped = await me(token, 'college');
    expect(swapped.status).toBe(401);
    expect(swapped.body.error.code).toBe('wrong_app');
    // Protected endpoints and realtime tickets refuse it the same way.
    const ticket = await request(app).post(`${API}/auth/realtime-ticket`).set(headers('college')).set('Authorization', `Bearer ${token}`).send({});
    expect(ticket.status).toBe(401);

    // The session was revoked, so it no longer works anywhere.
    const after = await me(token, 'student');
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe('session_expired');
  });

  it('keeps a session bound to its app even when the app header is left out', async () => {
    const token = await tokenFor('aud-sec', 'college');
    expect((await me(token, null)).status).toBe(200);
    expect((await me(token, 'college')).status).toBe(200);
    expect((await me(token, 'student')).body.error.code).toBe('wrong_app');
  });

  it('keeps older app builds (no app header) working, but not inside the wrong new app', async () => {
    const studentLegacy = await tokenFor('aud-stu2', null);
    expect((await me(studentLegacy, null)).status).toBe(200);
    const staffLegacy = await tokenFor('aud-adm', null);
    expect((await me(staffLegacy, null)).status).toBe(200);
    // A staff member whose old app updates into CampusCare Student is signed out and pointed to College.
    const upgraded = await me(staffLegacy, 'student');
    expect(upgraded.status).toBe(401);
    expect(upgraded.body.error.code).toBe('wrong_app');
    expect(upgraded.body.error.details?.app).toBe('college');
  });

  it('offers no sign-up in the College app', async () => {
    const r = await request(app).post(`${API}/auth/register`).set(headers('college')).send({
      fullName: 'New Student', email: 'aud-new@srmap.edu.in', studentId: 'AP999', department: 'CSE', academicYear: 1,
      password: PASSWORD, confirmPassword: PASSWORD, acceptPolicy: true,
    });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('registration_student_only');
    expect(await M.User.exists({ email: 'aud-new@srmap.edu.in' })).toBeNull();
  });

  it('moves a push token to the account now signed in on that phone', async () => {
    const pushToken = 'fcm-token-shared-by-one-phone-0123456789';
    const register = (token: string) => request(app).post(`${API}/mobile/devices`).set(headers('student')).set('Authorization', `Bearer ${token}`)
      .send({ platform: 'android', pushToken, appVersion: '1.1.0', appVersionCode: 2, deviceName: 'Test phone' });
    const first = await tokenFor('aud-stu', 'student');
    expect((await register(first)).status).toBe(200);
    // Same installation, different account, without a clean sign-out in between.
    const second = await tokenFor('aud-stu2', 'student');
    expect((await register(second)).status).toBe(200);
    const rows = await M.DeviceRegistration.find({ pushToken }).lean();
    expect(rows).toHaveLength(1);
    const stu2 = await M.User.findOne({ email: 'aud-stu2@srmap.edu.in' });
    expect(String(rows[0]!.userId)).toBe(String(stu2!._id));
    expect(rows[0]!.app).toBe('student');
  });
});
