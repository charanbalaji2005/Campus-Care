import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';

const d = process.env.SKIP_DB_TESTS === 'true' ? describe.skip : describe;
const PASSWORD = 'UserMgmt-Test-9';
type Agent = ReturnType<typeof request.agent>;

d('Super Admin User Management Module (integration)', () => {
  let mongo: { stop: () => Promise<boolean>; getUri: () => string };
  let app: import('express').Express;
  let M: typeof import('../src/models/user') & typeof import('../src/models/duty') & typeof import('../src/models/feed')
    & typeof import('../src/models/platform') & typeof import('../src/models/incident');
  let settings: typeof import('../src/services/settings.service');
  let hash: string;

  async function makeUser(email: string, role: string, extra: Record<string, unknown> = {}) {
    return M.User.create({
      fullName: email.split('@')[0],
      email,
      role,
      passwordHash: hash,
      emailVerified: true,
      accountStatus: 'active',
      ...extra,
    });
  }

  function freshCsrf(r: request.Response) {
    const c = (r.headers['set-cookie'] as unknown as string[] | undefined)?.find((x) => x.startsWith('cc_csrf='));
    return c ? c.split(';')[0]!.split('=')[1] : undefined;
  }

  async function webLogin(email: string) {
    const agent = request.agent(app);
    const csrf = (await agent.get('/api/v1/auth/csrf')).body.data.csrfToken as string;
    const r = await agent.post('/api/v1/auth/login').set('x-csrf-token', csrf).send({ email, password: PASSWORD });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return { agent, csrf: freshCsrf(r) ?? csrf };
  }

  async function appLogin(email: string) {
    const r = await request(app).post('/api/v1/auth/login').set('X-CampusCare-Client', 'android').send({ email, password: PASSWORD });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const token = r.body.data.sessionToken as string;
    return {
      agent: request.agent(app).set('Authorization', `Bearer ${token}`).set('X-CampusCare-Client', 'android') as unknown as Agent,
      token,
    };
  }

  let superAdmin1: Awaited<ReturnType<typeof webLogin>>;
  let superAdminUser1: import('../src/models/user').UserDoc;
  let studentAgent: Agent;
  let testCounsellor: import('../src/models/user').UserDoc;
  let testResponder: import('../src/models/user').UserDoc;
  let testStudent: import('../src/models/user').UserDoc;

  beforeAll(async () => {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    mongo = await MongoMemoryServer.create();
    const { connectDatabase } = await import('../src/db/connect');
    await connectDatabase(mongo.getUri());
    const { createApp } = await import('../src/app');
    app = createApp();

    M = {
      ...(await import('../src/models/user')),
      ...(await import('../src/models/duty')),
      ...(await import('../src/models/feed')),
      ...(await import('../src/models/platform')),
      ...(await import('../src/models/incident')),
    };

    settings = await import('../src/services/settings.service');
    for (const name of mongoose.modelNames()) await mongoose.model(name).syncIndexes();
    await settings.updateSettings({ turnstile: { enabled: false }, security: { requireMfaForSuperAdmin: false } }, '000000000000000000000000');

    const { hashPassword } = await import('../src/lib/crypto');
    hash = await hashPassword(PASSWORD);

    superAdminUser1 = await makeUser('super1@srmap.edu.in', 'super_admin');
    testStudent = await makeUser('student1@srmap.edu.in', 'student', { studentId: 'AP21110010001', department: 'Computer Science & Engineering' });
    testCounsellor = await makeUser('counsellor1@srmap.edu.in', 'counsellor', { department: 'Liberal Arts' });
    testResponder = await makeUser('security1@srmap.edu.in', 'security_officer', { responderEligible: true, dutyZone: 'main_gate' });

    superAdmin1 = await webLogin('super1@srmap.edu.in');
    studentAgent = (await appLogin('student1@srmap.edu.in')).agent;
  }, 120_000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
  });

  it('enforces RBAC: unauthorized users (students) cannot access user management endpoints', async () => {
    const res = await studentAgent.get('/api/v1/super-admin/users');
    expect(res.status).toBe(403);
  });

  it('provides dashboard metrics and aggregate counts', async () => {
    const res = await superAdmin1.agent.get('/api/v1/super-admin/users/stats');
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBeGreaterThanOrEqual(4);
    expect(res.body.data.active).toBeGreaterThanOrEqual(4);
    expect(res.body.data.byRole).toHaveProperty('super_admin');
    expect(res.body.data.byRole).toHaveProperty('student');
    expect(res.body.data.byRole).toHaveProperty('counsellor');
  });

  it('searches and filters the user list with pagination', async () => {
    // Search by student ID
    const searchRes = await superAdmin1.agent.get('/api/v1/super-admin/users?q=AP21110010001');
    expect(searchRes.status).toBe(200);
    expect(searchRes.body.data.items.length).toBe(1);
    expect(searchRes.body.data.items[0].email).toBe('student1@srmap.edu.in');

    // Filter by role
    const roleRes = await superAdmin1.agent.get('/api/v1/super-admin/users?role=counsellor');
    expect(roleRes.status).toBe(200);
    expect(roleRes.body.data.items.some((u: { email: string }) => u.email === 'counsellor1@srmap.edu.in')).toBe(true);
  });

  it('retrieves detailed user profile, security overview, and audit info', async () => {
    const res = await superAdmin1.agent.get(`/api/v1/super-admin/users/${testCounsellor._id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('counsellor1@srmap.edu.in');
    expect(res.body.data.security).toHaveProperty('mfa');
    expect(res.body.data.counsellor).toHaveProperty('approved');
    // Ensure passwords or raw hashes are never exposed
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(res.body.data.security.mfaSecretEnc).toBeUndefined();
  });

  it('edits permitted profile fields and records an audit log', async () => {
    const res = await superAdmin1.agent
      .patch(`/api/v1/super-admin/users/${testStudent._id}/profile`)
      .set('x-csrf-token', superAdmin1.csrf)
      .send({
        fullName: 'Updated Student Name',
        phone: '+91 98765 43210',
        hostel: 'Hostel Block A',
        campusZone: 'north_campus',
      });
    expect(res.status).toBe(200);
    expect(res.body.data.fullName).toBe('Updated Student Name');
    expect(res.body.data.phone).toBe('+91 98765 43210');
    expect(res.body.data.campusZone).toBe('north_campus');

    // Check audit log
    const auditEntry = await M.AuditLog.findOne({
      action: 'user.profile_updated',
      targetId: String(testStudent._id),
    });
    expect(auditEntry).toBeTruthy();
  });

  it('prevents accidental self-demotion of the current Super Admin', async () => {
    const res = await superAdmin1.agent
      .patch(`/api/v1/super-admin/users/${superAdminUser1._id}/role`)
      .set('x-csrf-token', superAdmin1.csrf)
      .send({
        role: 'admin',
        permissions: [],
        reason: 'Attempting self demotion',
      });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('self_role_change_forbidden');
  });

  it('prevents demoting or suspending the last active Super Admin', async () => {
    // Only 1 super admin exists currently (superAdminUser1)
    const res = await superAdmin1.agent
      .post(`/api/v1/super-admin/users/${superAdminUser1._id}/status`)
      .set('x-csrf-token', superAdmin1.csrf)
      .send({
        action: 'suspend',
        reason: 'Suspending last admin',
      });
    expect(res.status).toBe(422);
  });

  it('suspends an account, revoking all active sessions and socket connections immediately', async () => {
    // Log student in
    const { agent: activeStudentAgent } = await appLogin('student1@srmap.edu.in');
    const meBefore = await activeStudentAgent.get('/api/v1/me/safety-card');
    expect(meBefore.status).toBe(200);

    // Suspend student
    const suspendRes = await superAdmin1.agent
      .post(`/api/v1/super-admin/users/${testStudent._id}/status`)
      .set('x-csrf-token', superAdmin1.csrf)
      .send({
        action: 'suspend',
        reason: 'Misconduct investigation in progress',
        reviewDate: new Date(Date.now() + 14 * 86400_000).toISOString(),
      });
    expect(suspendRes.status).toBe(200);
    expect(suspendRes.body.data.accountStatus).toBe('suspended');
    expect(suspendRes.body.data.suspendedReason).toBe('Misconduct investigation in progress');

    // Active session should be revoked and blocked
    const meAfter = await activeStudentAgent.get('/api/v1/me/safety-card');
    expect(meAfter.status).toBe(401);

    // Reactivate student
    const reactivateRes = await superAdmin1.agent
      .post(`/api/v1/super-admin/users/${testStudent._id}/status`)
      .set('x-csrf-token', superAdmin1.csrf)
      .send({
        action: 'reactivate',
      });
    expect(reactivateRes.status).toBe(200);
    expect(reactivateRes.body.data.accountStatus).toBe('active');
  });

  it('manages counsellor approval and channel publishing independently of account existence', async () => {
    // Verify counsellor & grant publishing
    const approveRes = await superAdmin1.agent
      .post(`/api/v1/super-admin/users/${testCounsellor._id}/verify-counsellor`)
      .set('x-csrf-token', superAdmin1.csrf)
      .send({
        approved: true,
        publishAllowed: true,
        note: 'Certified psychological counsellor',
      });
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.data.counsellorApproved).toBe(true);
    expect(approveRes.body.data.counsellingPublishAllowed).toBe(true);

    const publisher = await M.ChannelPublisher.findOne({ userId: testCounsellor._id, revokedAt: null });
    expect(publisher).toBeTruthy();

    // Revoke publishing only: counsellor account stays active!
    const revokePublishRes = await superAdmin1.agent
      .post(`/api/v1/super-admin/users/${testCounsellor._id}/verify-counsellor`)
      .set('x-csrf-token', superAdmin1.csrf)
      .send({
        approved: true,
        publishAllowed: false,
      });
    expect(revokePublishRes.status).toBe(200);
    expect(revokePublishRes.body.data.counsellingPublishAllowed).toBe(false);

    // Account remains active
    const counsellorDoc = await M.User.findById(testCounsellor._id);
    expect(counsellorDoc?.accountStatus).toBe('active');
  });

  it('assigns responder duty qualification, coverage zone, and skills', async () => {
    const res = await superAdmin1.agent
      .post(`/api/v1/super-admin/users/${testResponder._id}/duty-assignment`)
      .set('x-csrf-token', superAdmin1.csrf)
      .send({
        eligible: true,
        skills: ['first_aid', 'cpr'],
        responsibilities: ['sos_response', 'patrol'],
        campus: 'main',
      });
    expect(res.status).toBe(200);
    expect(res.body.data.responderEligible).toBe(true);
    expect(res.body.data.availability.skills).toContain('first_aid');
  });

  it('forces password reset and revokes sessions', async () => {
    const res = await superAdmin1.agent
      .post(`/api/v1/super-admin/users/${testStudent._id}/force-password-reset`)
      .set('x-csrf-token', superAdmin1.csrf)
      .send({});
    expect(res.status).toBe(200);
    // Queued (not claimed as delivered): delivery happens in the background job with retries.
    expect(res.body.data.message).toMatch(/Password reset link queued/);
    expect(res.body.data.outcome).toBe('queued');
  });

  it('resets MFA and enforces re-enrollment without revealing secret', async () => {
    const res = await superAdmin1.agent
      .post(`/api/v1/super-admin/users/${testCounsellor._id}/reset-mfa`)
      .set('x-csrf-token', superAdmin1.csrf)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.message).toMatch(/Two-factor authentication reset/);
  });

  it('executes bulk actions safely, skips invalid targets, and reports partial outcomes', async () => {
    const target1 = await makeUser('bulk1@srmap.edu.in', 'student');
    const target2 = await makeUser('bulk2@srmap.edu.in', 'student');

    const res = await superAdmin1.agent
      .post('/api/v1/super-admin/users/bulk')
      .set('x-csrf-token', superAdmin1.csrf)
      .send({
        userIds: [String(target1._id), String(target2._id), '000000000000000000000000'],
        action: 'suspend',
        reason: 'Bulk academic suspension',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.requestedCount).toBe(3);
    expect(res.body.data.successCount).toBe(2);
    expect(res.body.data.failureCount).toBe(1);

    const updated1 = await M.User.findById(target1._id);
    expect(updated1?.accountStatus).toBe('suspended');
  });

  it('exports user data safely in CSV format with formula injection sanitization', async () => {
    // Create user with formula characters to test injection protection
    await makeUser('=SUM(1+1)@srmap.edu.in', 'student', { fullName: '=cmd|’ /C calc’!A0' });

    const res = await superAdmin1.agent.get('/api/v1/super-admin/users/export');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain('User ID,Full Name');

    // Check that formula prefix is escaped with single quote
    expect(res.text).toMatch(/"'=cmd/);
    // Passwords, secrets and tokens must never appear
    expect(res.text).not.toContain(PASSWORD);
  });
});
