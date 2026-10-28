/**
 * Role-based Profile page: GET /me/profile shapes its summary by role and never leaks student or SOS
 * details; PATCH /auth/me ignores fields outside the caller's role and cannot change verified
 * identifiers; profile photos are type- and size-checked. In-memory MongoDB; SKIP_DB_TESTS=true skips.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';

const d = process.env.SKIP_DB_TESTS === 'true' ? describe.skip : describe;
const PASSWORD = 'Profile-Test-9';
type Agent = ReturnType<typeof request.agent>;

// Smallest valid PNG (1x1) and a PDF header, for photo type checks.
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
const PDF = Buffer.from('%PDF-1.4\n%fake pdf for tests\n', 'latin1');

d('role-based profile (integration)', () => {
  let mongo: { stop: () => Promise<boolean>; getUri: () => string };
  let app: import('express').Express;
  let M: typeof import('../src/models/user') & typeof import('../src/models/platform') & typeof import('../src/models/safety') & typeof import('../src/models/counselling');
  let hash: string;

  async function makeUser(email: string, role: string, extra: Record<string, unknown> = {}) {
    return M.User.create({ fullName: email.split('@')[0], email, role, passwordHash: hash, emailVerified: true, accountStatus: 'active', ...extra });
  }

  async function appLogin(email: string): Promise<Agent> {
    const r = await request(app).post('/api/v1/auth/login').set('X-CampusCare-Client', 'android').send({ email, password: PASSWORD });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return request.agent(app).set('Authorization', `Bearer ${r.body.data.sessionToken}`).set('X-CampusCare-Client', 'android') as unknown as Agent;
  }

  let student: Agent;
  let counsellor: Agent;
  let officer: Agent;
  let admin: Agent;
  let studentId: string;

  beforeAll(async () => {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    mongo = await MongoMemoryServer.create();
    const { connectDatabase } = await import('../src/db/connect');
    await connectDatabase(mongo.getUri());
    const { createApp } = await import('../src/app');
    app = createApp();
    M = {
      ...(await import('../src/models/user')),
      ...(await import('../src/models/platform')),
      ...(await import('../src/models/safety')),
      ...(await import('../src/models/counselling')),
    };
    const settings = await import('../src/services/settings.service');
    for (const name of mongoose.modelNames()) await mongoose.model(name).syncIndexes();
    await settings.updateSettings({ turnstile: { enabled: false }, security: { requireMfaForSuperAdmin: false } }, '000000000000000000000000');
    const { hashPassword } = await import('../src/lib/crypto');
    hash = await hashPassword(PASSWORD);

    const s = await makeUser('prof-student@srmap.edu.in', 'student', { studentId: 'AP22110010042', department: 'Physics', academicYear: 2 });
    studentId = String(s._id);
    const c = await makeUser('prof-counsellor@srmap.edu.in', 'counsellor');
    const o = await makeUser('prof-officer@srmap.edu.in', 'security_officer', { responderEligible: true, staffId: 'SEC-7' });
    await makeUser('prof-admin@srmap.edu.in', 'admin', { managedCampuses: ['main'] });

    await M.Availability.create({ counsellorId: c._id, weekly: [{ weekday: 1, start: '09:00', end: '12:00' }], acceptingRequests: true, maxDailySessions: 4 });
    await M.Appointment.create({ studentId: s._id, counsellorId: c._id, status: 'requested', reason: 'private reason text', idempotencyKey: 'profile-test-1' });
    await M.EmergencyAlert.create({ userId: s._id, assignedTo: o._id, status: 'acknowledged', alertNumber: 'SOS-2026-0042', idempotencyKey: 'profile-sos-1', note: 'private sos note' } as never);

    student = await appLogin('prof-student@srmap.edu.in');
    counsellor = await appLogin('prof-counsellor@srmap.edu.in');
    officer = await appLogin('prof-officer@srmap.edu.in');
    admin = await appLogin('prof-admin@srmap.edu.in');
  }, 120_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo?.stop();
  });

  it('returns only the caller role section, with account security facts but no secrets', async () => {
    const r = await student.get('/api/v1/me/profile');
    expect(r.status).toBe(200);
    const data = r.body.data;
    expect(data.account).toMatchObject({ emailVerified: true, mfaEnabled: false, activeSessions: 1 });
    expect(data.student).toMatchObject({ upcomingAppointments: 1, trustedContacts: 0, safetyCardSet: false });
    expect(data.counsellor).toBeUndefined();
    expect(data.officer).toBeUndefined();
    expect(data.admin).toBeUndefined();
    expect(JSON.stringify(data)).not.toMatch(/passwordHash|mfaSecret|token/i);
  });

  it('gives counsellors their availability and request counts without any student information', async () => {
    const r = await counsellor.get('/api/v1/me/profile');
    expect(r.status).toBe(200);
    expect(r.body.data.counsellor).toMatchObject({ onDuty: true, maxDailySessions: 4, pendingRequests: 1, workingDays: [1] });
    const raw = JSON.stringify(r.body.data);
    expect(raw).not.toContain('prof-student');
    expect(raw).not.toContain('private reason text');
  });

  it('lists an officer’s active SOS by reference only', async () => {
    const r = await officer.get('/api/v1/me/profile');
    expect(r.status).toBe(200);
    const o = r.body.data.officer;
    expect(o.dutyStatus).toBe('off_duty');
    expect(o.activeIncidents).toHaveLength(1);
    expect(Object.keys(o.activeIncidents[0]).sort()).toEqual(['alertNumber', 'createdAt', 'id', 'status']);
    const raw = JSON.stringify(r.body.data);
    expect(raw).not.toContain(studentId);
    expect(raw).not.toContain('private sos note');
  });

  it('shows campus admins their scope and permissions read-only', async () => {
    const r = await admin.get('/api/v1/me/profile');
    expect(r.status).toBe(200);
    expect(r.body.data.admin.scope).toBe('campus');
    expect(r.body.data.admin.managedCampuses).toEqual(['main']);
    expect(r.body.data.admin.permissions).toContain('users:manage');
    expect(r.body.data.admin.permissions).not.toContain('roles:manage');
  });

  it('updates role fields, ignores other roles’ fields and never changes verified identifiers', async () => {
    const r = await student.patch('/api/v1/auth/me').send({
      fullName: 'Asha Rao', program: 'B.Sc Physics', section: 'b2', preferredLanguage: 'Telugu', // no longer a setting: ignored
      designation: 'Should be ignored', qualifications: 'Should be ignored',
      email: 'hijack@srmap.edu.in', role: 'super_admin', studentId: 'AP00000000000', staffId: 'X',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const u = r.body.data.user;
    expect(u).toMatchObject({ fullName: 'Asha Rao', program: 'B.Sc Physics', section: 'B2', designation: null, qualifications: null });
    expect(u.preferredLanguage).toBeUndefined();
    expect(u).toMatchObject({ email: 'prof-student@srmap.edu.in', role: 'student', studentId: 'AP22110010042', staffId: null });

    // Field names (never values) are audited.
    const log = await M.AuditLog.findOne({ action: 'user.profile_updated', targetId: studentId }).sort({ at: -1 }).lean();
    expect(log?.changedFields?.sort()).toEqual(['fullName', 'program', 'section']);
    expect(JSON.stringify(log)).not.toContain('B.Sc Physics');
  });

  it('lets counsellors set professional details', async () => {
    const ok = await counsellor.patch('/api/v1/auth/me').send({ designation: 'Senior Counsellor', qualifications: 'M.Phil Clinical Psychology', experienceYears: 7, program: 'ignored' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.user).toMatchObject({ designation: 'Senior Counsellor', qualifications: 'M.Phil Clinical Psychology', experienceYears: 7, program: null });
  });

  it('stores, serves and removes a profile photo, refusing non-images', async () => {
    const rejected = await student.put('/api/v1/me/avatar').attach('file', PDF, { filename: 'x.pdf', contentType: 'application/pdf' });
    expect(rejected.status).toBe(415);

    const up = await student.put('/api/v1/me/avatar').attach('file', PNG, { filename: 'me.png', contentType: 'image/png' });
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    expect(up.body.data.user.avatarUpdatedAt).toBeTruthy();

    const got = await student.get('/api/v1/me/avatar').buffer(true);
    expect(got.status).toBe(200);
    expect(got.headers['content-type']).toBe('image/png');

    const gone = await student.delete('/api/v1/me/avatar');
    expect(gone.body.data.user.avatarUpdatedAt).toBeNull();
    expect((await student.get('/api/v1/me/avatar')).status).toBe(404);
  });
});
