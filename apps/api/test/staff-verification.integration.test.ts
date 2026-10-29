/**
 * Staff applications, identity evidence, Campus Admin scope, suspensions and session administration.
 * Private in-memory MongoDB; email goes to the console provider and push is unconfigured.
 * Set SKIP_DB_TESTS=true to skip.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';

process.env.AUTH_GENERIC_RESPONSE_MS = '20';

const d = process.env.SKIP_DB_TESTS === 'true' ? describe.skip : describe;
const PASSWORD = 'Staff-Verify-Test-9';
const API = '/api/v1';
const COLLEGE = { 'X-CampusCare-Client': 'android', 'X-CampusCare-App': 'college' };
const STUDENT = { 'X-CampusCare-Client': 'android', 'X-CampusCare-App': 'student' };
const JPEG = Buffer.concat([Buffer.from('ffd8ffe000104a464946000101', 'hex'), Buffer.alloc(400, 7)]);
const NOT_AN_IMAGE = Buffer.from('<html><script>alert(1)</script></html>'.repeat(4));
type Agent = ReturnType<typeof request.agent>;

d('Staff verification, admin scope and account lifecycle (integration)', () => {
  let mongo: { stop: () => Promise<boolean>; getUri: () => string };
  let app: import('express').Express;
  let M: typeof import('../src/models/user') & typeof import('../src/models/duty') & typeof import('../src/models/safety') & typeof import('../src/models/platform');
  let lifecycle: typeof import('../src/services/account-lifecycle.service');
  let hash: string;
  let root: { agent: Agent; csrf: string };

  async function makeUser(email: string, role: string, extra: Record<string, unknown> = {}) {
    return M.User.create({ fullName: email.split('@')[0], email, role, passwordHash: hash, emailVerified: true, accountStatus: 'active', ...extra });
  }
  function freshCsrf(r: request.Response) {
    const c = (r.headers['set-cookie'] as unknown as string[] | undefined)?.find((x) => x.startsWith('cc_csrf='));
    return c ? c.split(';')[0]!.split('=')[1] : undefined;
  }
  async function webLogin(email: string) {
    const agent = request.agent(app);
    const csrf = (await agent.get(`${API}/auth/csrf`)).body.data.csrfToken as string;
    const r = await agent.post(`${API}/auth/login`).set('x-csrf-token', csrf).send({ email, password: PASSWORD });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return { agent, csrf: freshCsrf(r) ?? csrf };
  }
  async function appLogin(email: string, headers = COLLEGE, password = PASSWORD) {
    const r = await request(app).post(`${API}/auth/login`).set(headers).send({ email, password });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return { token: r.body.data.sessionToken as string, body: r.body.data };
  }
  const as = (token: string, headers = COLLEGE) => ({
    get: (p: string) => request(app).get(`${API}${p}`).set(headers).set('Authorization', `Bearer ${token}`),
    post: (p: string) => request(app).post(`${API}${p}`).set(headers).set('Authorization', `Bearer ${token}`),
  });
  const sa = {
    get: (p: string) => root.agent.get(`${API}/super-admin/users${p}`),
    post: (p: string, body: Record<string, unknown> = {}) => root.agent.post(`${API}/super-admin/users${p}`).set('x-csrf-token', root.csrf).send(body),
    del: (p: string, body: Record<string, unknown> = {}) => root.agent.delete(`${API}/super-admin/users${p}`).set('x-csrf-token', root.csrf).send(body),
  };
  async function codeFor(to: string) {
    const delivery = await M.EmailDelivery.findOne({ to, template: 'verify_email_code' }).sort({ createdAt: -1, _id: -1 }).lean();
    const job = await M.Job.findOne({ type: 'email.send', 'payload.deliveryId': String(delivery!._id) }).lean();
    return (job!.payload as { vars: { code: string } }).vars.code;
  }
  /** Registers a staff applicant and verifies their email with a code. */
  async function applicant(email: string, role: string, campus = 'main') {
    const details: Record<string, unknown> = {
      counsellor: { counsellor: { specializations: ['general'], languages: ['English'], qualifications: 'M.A. Psychology' } },
      admin: { admin: { authorizationReference: 'OO/2026/17' } },
      security_officer: { security: { serviceProvider: 'Campus Security', shiftPreference: 'day' } },
    }[role] ?? {};
    const r = await request(app).post(`${API}/auth/register-staff`).set(COLLEGE).send({
      fullName: `Applicant ${email.split('@')[0]}`, email, password: PASSWORD, confirmPassword: PASSWORD, requestedRole: role, staffId: `EMP-${randomUUID().slice(0, 6)}`,
      department: 'Student Welfare', designation: 'Officer', campus, verificationMethod: 'otp', acceptPolicy: true, ...details,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const v = await request(app).post(`${API}/auth/verify-email/otp`).set(COLLEGE).send({ email, code: await codeFor(email), ticket: r.body.data.verificationTicket });
    expect(v.body.data?.result, JSON.stringify(v.body)).toBe('verified');
    return M.User.findOne({ email });
  }
  function upload(token: string, opts: { file?: Buffer; consent?: boolean; extra?: Record<string, string> } = {}) {
    let q = as(token).post('/auth/verification-evidence').field('evidenceType', 'id_card');
    if (opts.consent !== false) q = q.field('consent', 'true');
    for (const [k, v] of Object.entries(opts.extra ?? {})) q = q.field(k, v);
    return q.attach('file', opts.file ?? JPEG, { filename: 'id.jpg', contentType: 'image/jpeg' });
  }

  beforeAll(async () => {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    mongo = await MongoMemoryServer.create();
    const { connectDatabase } = await import('../src/db/connect');
    await connectDatabase(mongo.getUri());
    const { createApp } = await import('../src/app');
    app = createApp();
    M = { ...(await import('../src/models/user')), ...(await import('../src/models/duty')), ...(await import('../src/models/safety')), ...(await import('../src/models/platform')) };
    lifecycle = await import('../src/services/account-lifecycle.service');
    for (const name of mongoose.modelNames()) await mongoose.model(name).syncIndexes();
    const settings = await import('../src/services/settings.service');
    await settings.updateSettings({
      turnstile: { enabled: false },
      registration: { studentRegistrationOpen: true, requireEmailVerification: true, campuses: [{ id: 'main', name: 'Main' }, { id: 'north', name: 'North' }] },
      security: { requireMfaForSuperAdmin: false, requireMfaForAdmins: false },
    } as never, '000000000000000000000000');
    const { hashPassword } = await import('../src/lib/crypto');
    hash = await hashPassword(PASSWORD);
    await makeUser('sv-root@srmap.edu.in', 'super_admin');
    await makeUser('sv-ca-main@srmap.edu.in', 'admin', { campusZone: 'main' });
    await makeUser('sv-ca-north@srmap.edu.in', 'admin', { campusZone: 'north', managedCampuses: ['north'] });
    await makeUser('sv-stu-main@srmap.edu.in', 'student', { studentId: 'AP900', campusZone: 'main' });
    await makeUser('sv-stu-north@srmap.edu.in', 'student', { studentId: 'AP901', campusZone: 'north' });
    root = await webLogin('sv-root@srmap.edu.in');
  }, 180_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo?.stop();
  });

  it('keeps a self-registered staff applicant inactive after email verification, with a restricted session', async () => {
    const refused = await request(app).post(`${API}/auth/register-staff`).set(STUDENT).send({});
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('registration_staff_college_only');

    const u = await applicant('sv-app1@srmap.edu.in', 'admin');
    expect(u!.approvalRequired).toBe(true);
    expect(u!.emailVerified).toBe(true);
    expect(u!.accountStatus).toBe('pending_verification'); // email proof is not institutional approval

    const { token, body } = await appLogin('sv-app1@srmap.edu.in');
    expect(body.applicationPending).toBe(true);
    const s = as(token);
    expect((await s.get('/auth/me')).status).toBe(200);
    expect((await s.get('/auth/verification-evidence/status')).status).toBe(200);
    // Everything else is refused, including the admin role's permissions and paths that merely contain "/me".
    for (const p of ['/admin/users', '/me/privacy', '/me/safety-card', '/chats', '/notifications']) {
      const r = await s.get(p);
      expect(r.status, p).toBe(403);
      expect(r.body.error.code, p).toBe('approval_pending');
    }
    expect((await s.post('/auth/realtime-ticket').send({})).status).toBe(403);

    // Neither a "reactivate" nor a manual email verification by an administrator activates the applicant.
    expect((await sa.post(`/${u!._id}/status`, { action: 'reactivate' })).status).toBe(200);
    expect((await sa.post(`/${u!._id}/status`, { action: 'verify_email' })).status).toBe(200);
    expect((await M.User.findById(u!._id).lean())!.accountStatus).toBe('pending_verification');
  });

  it('accepts identity evidence only as a real image with consent, and takes identity details from the account', async () => {
    const { token } = await appLogin('sv-app1@srmap.edu.in');
    const fake = await upload(token, { file: NOT_AN_IMAGE });
    expect(fake.status).toBe(415);
    const noConsent = await upload(token, { consent: false });
    expect(noConsent.status).toBe(422);
    expect(noConsent.body.error.code).toBe('consent_required');

    const ok = await upload(token, { extra: { requestedRole: 'super_admin', campus: 'north', applicantName: 'Someone Else', identifier: 'FAKE-1' } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const ev = await M.VerificationEvidence.findById(ok.body.data.id).lean();
    const u = await M.User.findOne({ email: 'sv-app1@srmap.edu.in' }).lean();
    expect(ev).toMatchObject({ requestedRole: 'admin', campus: 'main', applicantName: u!.fullName, identifier: u!.staffId, mime: 'image/jpeg', consentGiven: true });
    expect(u!.verificationStatus).toBe('submitted');
    // The evidence never appears on the account's own profile, and is not the avatar.
    const me = await as(token).get('/auth/me');
    expect(JSON.stringify(me.body)).not.toContain(ok.body.data.id);
    expect(me.body.data.user.avatarUrl ?? null).toBeNull();
    // The applicant cannot read the file back through the reviewer endpoints.
    expect((await as(token).get(`/super-admin/users/verifications/evidence/${ok.body.data.id}/file`)).status).toBe(403);
    expect((await as(token).get(`/admin/verifications/evidence/${ok.body.data.id}/file`)).status).toBe(403);
  });

  it('lets a Campus Admin give only an in-scope initial recommendation; the Super Admin decides', async () => {
    const ev = await M.VerificationEvidence.findOne({ applicantName: /sv-app1/ }).lean();
    const north = await appLogin('sv-ca-north@srmap.edu.in');
    const main = await appLogin('sv-ca-main@srmap.edu.in');
    const review = { recommendation: 'recommend_approval', notes: 'ID card matches HR record' };

    expect((await as(north.token).post(`/admin/verifications/evidence/${ev!._id}/initial-review`).send(review)).status).toBe(403);
    expect((await as(north.token).get(`/admin/verifications/evidence/${ev!._id}/file`)).status).toBe(403);
    const queueNorth = await as(north.token).get('/admin/verifications/queue');
    expect(queueNorth.body.data.items.map((i: { email: string }) => i.email)).not.toContain('sv-app1@srmap.edu.in');

    const queueMain = await as(main.token).get('/admin/verifications/queue');
    expect(queueMain.body.data.items.map((i: { email: string }) => i.email)).toContain('sv-app1@srmap.edu.in');
    const file = await as(main.token).get(`/admin/verifications/evidence/${ev!._id}/file`);
    expect(file.status).toBe(200);
    expect(file.headers['cache-control']).toContain('no-store');
    expect(await M.AuditLog.countDocuments({ action: 'verification.evidence_viewed', targetId: String(ev!._id) })).toBe(1);
    expect((await as(main.token).post(`/admin/verifications/evidence/${ev!._id}/initial-review`).send(review)).status).toBe(200);
    expect((await M.User.findOne({ email: 'sv-app1@srmap.edu.in' }).lean())!.accountStatus).toBe('pending_verification');
    // Campus Admins cannot make the final decision.
    expect((await as(main.token).post(`/super-admin/users/verifications/evidence/${ev!._id}/decision`).send({ status: 'approved' })).status).toBe(403);

    const approved = await sa.post(`/verifications/evidence/${ev!._id}/decision`, { status: 'approved', notes: 'Checked against HR' });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    // Identity verified is not role approval: the account stays inactive until the application is approved.
    let u = await M.User.findOne({ email: 'sv-app1@srmap.edu.in' }).lean();
    expect(u).toMatchObject({ accountStatus: 'pending_verification', approvalRequired: true, verificationStatus: 'approved' });
    expect(await M.AuditLog.countDocuments({ action: 'user.verification_decided', targetId: String(u!._id) })).toBe(1);
    const application = await mongoose.model('StaffApplication').findOne({ userId: u!._id }).lean() as { _id: unknown } | null;
    const decided = await root.agent.post(`${API}/super-admin/staff-applications/${application!._id}/decision`).set('x-csrf-token', root.csrf).send({ decision: 'approve' });
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);
    u = await M.User.findOne({ email: 'sv-app1@srmap.edu.in' }).lean();
    expect(u).toMatchObject({ accountStatus: 'active', approvalRequired: false, verificationStatus: 'approved', role: 'admin', managedCampuses: ['main'] });
    expect(String(u!.approvedBy)).toBeTruthy();
    // No impossible transitions: approving twice is refused.
    expect((await sa.post(`/verifications/evidence/${ev!._id}/decision`, { status: 'approved' })).status).toBe(409);
    expect((await sa.post(`/verifications/evidence/${ev!._id}/decision`, { status: 'submitted' })).status).toBe(422);
    // Now the account works with its full role.
    const now = await appLogin('sv-app1@srmap.edu.in');
    expect(now.body.applicationPending).toBe(false);
    expect((await as(now.token).get('/admin/users')).status).toBe(200);
  });

  it('records a rejection as its own state (not a suspension) and lets the applicant resubmit', async () => {
    await applicant('sv-app2@srmap.edu.in', 'counsellor');
    const { token } = await appLogin('sv-app2@srmap.edu.in');
    const up = await upload(token);
    expect(up.status).toBe(201);
    expect((await sa.post(`/verifications/evidence/${up.body.data.id}/decision`, { status: 'rejected' })).status).toBe(422); // reason required
    expect((await sa.post(`/verifications/evidence/${up.body.data.id}/decision`, { status: 'rejected', reason: 'ID photo unreadable' })).status).toBe(200);
    const u = await M.User.findOne({ email: 'sv-app2@srmap.edu.in' }).lean();
    expect(u).toMatchObject({ accountStatus: 'pending_verification', verificationStatus: 'rejected', approvalRequired: true });
    expect((await as(token).get('/admin/users')).status).toBe(403);
    const again = await upload(token);
    expect(again.status).toBe(201);
    expect((await M.User.findById(u!._id).lean())!.verificationStatus).toBe('submitted');
  });

  it('expires temporary suspensions on the server and refuses suspended accounts', async () => {
    const stu = await M.User.findOne({ email: 'sv-stu-main@srmap.edu.in' });
    const { token } = await appLogin('sv-stu-main@srmap.edu.in', STUDENT);
    expect((await sa.post(`/${stu!._id}/status`, { action: 'suspend', reason: 'Investigation', reviewDate: new Date(Date.now() - 3600_000).toISOString() })).status).toBe(422);
    const until = new Date(Date.now() + 3600_000);
    expect((await sa.post(`/${stu!._id}/status`, { action: 'suspend', reason: 'Investigation', reviewDate: until.toISOString() })).status).toBe(200);
    expect((await as(token, STUDENT).get('/auth/me')).status).toBe(401); // sessions revoked by the backend
    const login = await request(app).post(`${API}/auth/login`).set(STUDENT).send({ email: 'sv-stu-main@srmap.edu.in', password: PASSWORD });
    expect(login.body.error.code).toBe('account_suspended');

    await M.User.updateOne({ _id: stu!._id }, { $set: { suspendedUntil: new Date(Date.now() - 1000) } });
    expect(await lifecycle.expireTemporarySuspensions()).toBe(1);
    expect((await M.User.findById(stu!._id).lean())!.accountStatus).toBe('active');
    expect(await M.AuditLog.countDocuments({ action: 'user.suspension_expired', targetId: String(stu!._id) })).toBe(1);
    expect((await request(app).post(`${API}/auth/login`).set(STUDENT).send({ email: 'sv-stu-main@srmap.edu.in', password: PASSWORD })).status).toBe(200);
  });

  it('hands a suspended officer’s acknowledged SOS to another eligible responder', async () => {
    const r1 = await makeUser('sv-resp1@srmap.edu.in', 'security_officer');
    const r2 = await makeUser('sv-resp2@srmap.edu.in', 'security_officer');
    for (const r of [r1, r2]) {
      await M.ResponderAvailability.findOneAndUpdate({ userId: r._id }, { $set: { status: 'on_duty', lastHeartbeatAt: new Date(), statusChangedAt: new Date(), activeAssignmentCount: 0, campus: 'main', responsibilities: ['sos_response'] } }, { upsert: true });
    }
    const student = await appLogin('sv-stu-main@srmap.edu.in', STUDENT);
    const sos = await as(student.token, STUDENT).post('/safety/sos').send({ idempotencyKey: randomUUID(), latitude: 16.4636, longitude: 80.5074, accuracyMeters: 15 });
    expect(sos.status, JSON.stringify(sos.body)).toBe(201);
    const alertId = sos.body.data.id as string;
    const offer = await M.AlertAssignment.findOne({ alertId, open: true }).lean();
    expect(offer).toBeTruthy();
    const firstId = String(offer!.responderId);
    const first = firstId === String(r1._id) ? 'sv-resp1@srmap.edu.in' : 'sv-resp2@srmap.edu.in';
    const firstApp = await appLogin(first);
    expect((await as(firstApp.token).post(`/emergency-alerts/${alertId}/acknowledge`).send({})).status).toBe(200);

    expect((await sa.post(`/${firstId}/status`, { action: 'suspend', reason: 'Off-duty misconduct investigation' })).status).toBe(200);
    const alert = await M.EmergencyAlert.findById(alertId).lean();
    expect(String(alert!.assignedTo ?? '')).not.toBe(firstId);
    const open = await M.AlertAssignment.find({ alertId, open: true }).lean();
    expect(open.map((a) => String(a.responderId))).not.toContain(firstId);
    expect(open.length).toBe(1); // offered to the other on-duty officer, not abandoned
    expect((await M.ResponderAvailability.findOne({ userId: firstId }).lean())!.status).toBe('off_duty');
    expect(await M.AuditLog.countDocuments({ action: 'sos.assignment_handed_off', targetId: alertId })).toBeGreaterThan(0);
  });

  it('confines Campus Admins to their campus for listing, managing and exporting users', async () => {
    const north = await appLogin('sv-ca-north@srmap.edu.in');
    const list = await as(north.token).get('/admin/users?limit=100');
    const emails = list.body.data.items.map((i: { email: string }) => i.email);
    expect(emails).toContain('sv-stu-north@srmap.edu.in');
    expect(emails).not.toContain('sv-stu-main@srmap.edu.in');
    const mainStudent = await M.User.findOne({ email: 'sv-stu-main@srmap.edu.in' }).lean();
    expect((await as(north.token).post(`/admin/users/${mainStudent!._id}/status`).send({ action: 'suspend', reason: 'Cross-campus attempt' })).status).toBe(404);
    expect((await as(north.token).post(`/admin/users/${mainStudent!._id}/recovery`).send({})).status).toBe(404);
    const csv = await as(north.token).get('/admin/users/export');
    expect(csv.text).toContain('sv-stu-north@srmap.edu.in');
    expect(csv.text).not.toContain('sv-stu-main@srmap.edu.in');
    // Campus Admins have no Super Admin console at all.
    expect((await as(north.token).get('/super-admin/users/sessions/active')).status).toBe(403);
  });

  it('lists sessions without any secret and revokes one so the backend rejects it', async () => {
    const student = await appLogin('sv-stu-north@srmap.edu.in', STUDENT);
    const list = await sa.get('/sessions/active?limit=100');
    expect(list.status).toBe(200);
    const raw = JSON.stringify(list.body);
    expect(raw).not.toContain(student.token);
    expect(raw).not.toMatch(/tokenHash/);
    const session = await M.Session.findOne({ tokenHash: (await import('../src/lib/crypto')).sha256(student.token) }).lean();
    const item = list.body.data.items.find((i: { id: string }) => i.id === String(session!._id));
    expect(item).toMatchObject({ client: 'android', app: 'student' });
    expect((await sa.del(`/sessions/${session!._id}`, { reason: 'Lost phone' })).status).toBe(200);
    expect((await as(student.token, STUDENT).get('/auth/me')).status).toBe(401);
    expect((await sa.del(`/sessions/${session!._id}`)).status).toBe(409);
  });
});
