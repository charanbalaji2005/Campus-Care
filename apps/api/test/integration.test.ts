/**
 * End-to-end API checks against a real MongoDB.
 * Run with: MONGODB_URI=mongodb://127.0.0.1:27017/campuscare_test npm test
 * (Skipped automatically when MONGODB_URI is not set.)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';

const RUN = Boolean(process.env.MONGODB_URI);
const d = RUN ? describe : describe.skip;

type Agent = ReturnType<typeof request.agent>;
const PASSWORD = 'Integration-Test-9';

d('CampusCare API (integration)', () => {
  let app: import('express').Express;
  let models: typeof import('../src/models/user') & typeof import('../src/models/incident') & typeof import('../src/models/platform') & typeof import('../src/models/counselling');
  let hash: string;

  async function agentWithCsrf(): Promise<{ agent: Agent; csrf: string }> {
    const agent = request.agent(app);
    const r = await agent.get('/api/v1/auth/csrf');
    return { agent, csrf: r.body.data.csrfToken };
  }

  /** Super Admins sign in on the website (cookie + CSRF); everyone else signs in from the Android app (bearer token). */
  async function login(email: string) {
    const user = await models.User.findOne({ email }).lean();
    if (user?.role === 'super_admin') return webLogin(email);
    return appLogin(email);
  }

  async function webLogin(email: string) {
    const { agent, csrf } = await agentWithCsrf();
    const r = await agent.post('/api/v1/auth/login').set('x-csrf-token', csrf).send({ email, password: PASSWORD });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const csrf2 = (r.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('cc_csrf='))!.split(';')[0].split('=')[1];
    return { agent, csrf: csrf2 };
  }

  async function appLogin(email: string) {
    const r = await request(app).post('/api/v1/auth/login').set('X-CampusCare-Client', 'android').send({ email, password: PASSWORD });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.headers['set-cookie']).toBeUndefined(); // the app never receives cookies
    const token = r.body.data.sessionToken as string;
    expect(token).toBeTruthy();
    const agent = request.agent(app).set('Authorization', `Bearer ${token}`).set('X-CampusCare-Client', 'android') as unknown as Agent;
    return { agent, csrf: '', token };
  }

  async function makeUser(email: string, role: string, extra: Record<string, unknown> = {}) {
    return models.User.create({ fullName: email.split('@')[0], email, role, passwordHash: hash, emailVerified: true, accountStatus: 'active', ...extra });
  }

  async function lastEmailLink(to: string): Promise<string> {
    const delivery = await models.EmailDelivery.findOne({ to }).sort({ createdAt: -1 }).lean();
    const job = await models.Job.findOne({ 'payload.deliveryId': String(delivery!._id) }).lean();
    return (job!.payload as { vars: { link: string } }).vars.link;
  }

  beforeAll(async () => {
    const { connectDatabase } = await import('../src/db/connect');
    await connectDatabase(process.env.MONGODB_URI);
    await mongoose.connection.dropDatabase();
    const { createApp } = await import('../src/app');
    app = createApp();
    models = { ...(await import('../src/models/user')), ...(await import('../src/models/incident')), ...(await import('../src/models/platform')), ...(await import('../src/models/counselling')) };
    for (const name of mongoose.modelNames()) await mongoose.model(name).syncIndexes();
    const { updateSettings } = await import('../src/services/settings.service');
    await updateSettings({ turnstile: { enabled: false }, security: { requireMfaForSuperAdmin: false } }, '000000000000000000000000');
    await models.EmailDomain.create({ domain: 'srmap.edu.in', purpose: 'both', status: 'active', verifiedAt: new Date(), verificationToken: 'x' });
    const { hashPassword } = await import('../src/lib/crypto');
    hash = await hashPassword(PASSWORD);
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  it('1–4: registration, email verification, duplicates and privileged-role protection', async () => {
    const { agent, csrf } = await agentWithCsrf();
    const body = { fullName: 'New Student', email: 'new@srmap.edu.in', studentId: 'NS-1', department: 'Physics', academicYear: 1, password: PASSWORD, confirmPassword: PASSWORD, acceptPolicy: true, role: 'super_admin' };
    const r = await agent.post('/api/v1/auth/register').set('x-csrf-token', csrf).send(body);
    expect(r.status).toBe(201);
    const user = await models.User.findOne({ email: 'new@srmap.edu.in' });
    expect(user!.role).toBe('student'); // role in the body is ignored

    const dup = await agent.post('/api/v1/auth/register').set('x-csrf-token', csrf).send(body);
    expect(dup.status).toBe(409);

    const wrongDomain = await agent.post('/api/v1/auth/register').set('x-csrf-token', csrf).send({ ...body, email: 'x@gmail.com', studentId: 'NS-2' });
    expect(wrongDomain.status).toBe(422);

    const early = await agent.post('/api/v1/auth/login').set('x-csrf-token', csrf).send({ email: 'new@srmap.edu.in', password: PASSWORD });
    expect(early.body.error.code).toBe('email_not_verified');

    const token = new URL(await lastEmailLink('new@srmap.edu.in')).searchParams.get('token')!;
    expect((await agent.post('/api/v1/auth/verify-email').set('x-csrf-token', csrf).send({ token })).status).toBe(200);
    expect((await agent.post('/api/v1/auth/verify-email').set('x-csrf-token', csrf).send({ token })).status).toBe(400); // single use
    await login('new@srmap.edu.in');
  });

  it('3: password recovery is generic, single-use and revokes sessions', async () => {
    await makeUser('reset@srmap.edu.in', 'student', { studentId: 'RS-1' });
    const session = await login('reset@srmap.edu.in');
    const { agent, csrf } = await agentWithCsrf();
    const a = await agent.post('/api/v1/auth/forgot-password').set('x-csrf-token', csrf).send({ email: 'reset@srmap.edu.in' });
    const b = await agent.post('/api/v1/auth/forgot-password').set('x-csrf-token', csrf).send({ email: 'nobody@srmap.edu.in' });
    expect(a.body).toEqual(b.body);
    const token = new URL(await lastEmailLink('reset@srmap.edu.in')).searchParams.get('token')!;
    const newPw = 'Brand-New-Pass-7';
    expect((await agent.post('/api/v1/auth/reset-password').set('x-csrf-token', csrf).send({ token, password: newPw, confirmPassword: newPw })).status).toBe(200);
    expect((await agent.post('/api/v1/auth/reset-password').set('x-csrf-token', csrf).send({ token, password: newPw, confirmPassword: newPw })).status).toBe(400);
    expect((await session.agent.get('/api/v1/auth/me')).status).toBe(401); // old session revoked
    await models.User.updateOne({ email: 'reset@srmap.edu.in' }, { $set: { passwordHash: hash } });
  });

  it('5, 6, 9, 11: case privacy, committee scope, admin redaction, evidence permission, unauthenticated', async () => {
    const ragging = await models.Committee.create({ name: 'ARC', type: 'anti_ragging', categories: ['ragging'] });
    const other = await models.Committee.create({ name: 'Grievance', type: 'grievance', categories: ['academic'] });
    await makeUser('a@srmap.edu.in', 'student', { studentId: 'A-1' });
    await makeUser('b@srmap.edu.in', 'student', { studentId: 'B-1' });
    await makeUser('arc@srmap.edu.in', 'committee_member', { committeeMemberships: [{ committeeId: ragging._id, position: 'chair' }] });
    await makeUser('grc@srmap.edu.in', 'committee_member', { committeeMemberships: [{ committeeId: other._id, position: 'member' }] });
    await makeUser('admin@srmap.edu.in', 'admin');

    const a = await login('a@srmap.edu.in');
    const png = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d', 'hex'), Buffer.alloc(64)]);
    const up = await a.agent.post('/api/v1/incidents/evidence').set('x-csrf-token', a.csrf).attach('file', png, 'photo.png');
    expect(up.status).toBe(201);
    const created = await a.agent.post('/api/v1/incidents').set('x-csrf-token', a.csrf).send({
      category: 'ragging', title: 'Forced to perform', description: 'Seniors forced us to perform in the corridor late at night.', incidentDate: new Date(Date.now() - 3600_000),
      location: 'Hostel B', idempotencyKey: randomUUID(), evidenceIds: [up.body.data.id],
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    expect(created.body.data.caseNumber).toMatch(/^CC-\d{4}-\d{6}$/);

    const b = await login('b@srmap.edu.in');
    expect((await b.agent.get(`/api/v1/incidents/${id}`)).status).toBe(404);
    expect((await b.agent.get(`/api/v1/incidents/files/${up.body.data.id}`)).status).toBe(404);

    const grc = await login('grc@srmap.edu.in');
    expect((await grc.agent.get(`/api/v1/incidents/${id}`)).status).toBe(404);

    const arc = await login('arc@srmap.edu.in');
    const asHandler = await arc.agent.get(`/api/v1/incidents/${id}`);
    expect(asHandler.status).toBe(200);
    expect(asHandler.body.data.incident.description).toContain('corridor');

    const admin = await login('admin@srmap.edu.in');
    const asAdmin = await admin.agent.get(`/api/v1/incidents/${id}`);
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.data.incident.redacted).toBe(true);
    expect(asAdmin.body.data.incident.description).toBeUndefined();
    expect((await admin.agent.get(`/api/v1/incidents/${id}/messages`)).status).toBe(404);

    expect((await request(app).get(`/api/v1/incidents/${id}`)).status).toBe(401);

    // 10: invalid transition rejected; valid one audited
    expect((await arc.agent.patch(`/api/v1/incidents/${id}/status`).set('x-csrf-token', arc.csrf).send({ status: 'closed', reason: 'x' })).status).toBe(422);
    expect((await arc.agent.patch(`/api/v1/incidents/${id}/status`).set('x-csrf-token', arc.csrf).send({ status: 'triage' })).status).toBe(200);
    expect(await models.AuditLog.exists({ action: 'incident.status_changed', targetId: id })).toBeTruthy();

    // complaint chat: reporter <-> committee; other students cannot read it
    const msg = await a.agent.post(`/api/v1/incidents/${id}/messages`).set('x-csrf-token', a.csrf).send({ body: 'More details here', clientMessageId: randomUUID() });
    expect(msg.status).toBe(201);
    const thread = await arc.agent.get(`/api/v1/incidents/${id}/messages`);
    expect(thread.body.data.items.map((m: { body: string }) => m.body)).toContain('More details here');
    expect((await b.agent.post(`/api/v1/incidents/${id}/messages`).set('x-csrf-token', b.csrf).send({ body: 'x', clientMessageId: randomUUID() })).status).toBe(404);

    // 14: analytics are aggregate only
    const analytics = await admin.agent.get('/api/v1/admin/analytics');
    expect(analytics.status).toBe(200);
    expect(JSON.stringify(analytics.body)).not.toContain('a@srmap.edu.in');
    expect(JSON.stringify(analytics.body)).not.toContain('corridor');
  });

  it('7, 8, 12: counselling confidentiality and slot conflicts', async () => {
    const c1 = await makeUser('c1@srmap.edu.in', 'counsellor');
    await makeUser('c2@srmap.edu.in', 'counsellor');
    await models.Availability.create({ counsellorId: c1._id, weekly: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '00:00', end: '23:50' })), slotMinutes: 50, timezone: 'UTC', acceptingRequests: true });
    await makeUser('s1@srmap.edu.in', 'student', { studentId: 'S-1' });
    await makeUser('s2@srmap.edu.in', 'student', { studentId: 'S-2' });
    const s1 = await login('s1@srmap.edu.in');
    const s2 = await login('s2@srmap.edu.in');
    const slots = await s1.agent.get(`/api/v1/counselling/counsellors/${c1._id}/slots`);
    const slot = slots.body.data.slots[0];
    const first = await s1.agent.post('/api/v1/counselling/appointments').set('x-csrf-token', s1.csrf).send({ counsellorId: String(c1._id), startAt: slot, mode: 'in_person', idempotencyKey: randomUUID() });
    expect(first.status).toBe(201);
    const clash = await s2.agent.post('/api/v1/counselling/appointments').set('x-csrf-token', s2.csrf).send({ counsellorId: String(c1._id), startAt: slot, mode: 'in_person', idempotencyKey: randomUUID() });
    expect([409, 422]).toContain(clash.status);

    const counsellor = await login('c1@srmap.edu.in');
    const apptId = first.body.data.id;
    expect((await counsellor.agent.post(`/api/v1/counselling/appointments/${apptId}/notes`).set('x-csrf-token', counsellor.csrf).send({ body: 'Private session note' })).status).toBe(201);
    const other = await login('c2@srmap.edu.in');
    expect((await other.agent.get(`/api/v1/counselling/appointments/${apptId}/notes`)).status).toBe(404);
    const admin = await login('admin@srmap.edu.in');
    expect((await admin.agent.get(`/api/v1/counselling/appointments/${apptId}/notes`)).status).toBe(404);
    expect((await s1.agent.get(`/api/v1/counselling/appointments/${apptId}/notes`)).status).toBe(404);
  });

  it('support chat media is off by default and the Super Admin can switch it on', async () => {
    await makeUser('root@srmap.edu.in', 'super_admin');
    await makeUser('chat@srmap.edu.in', 'student', { studentId: 'CH-1' });
    const root = await login('root@srmap.edu.in');
    const svc = await root.agent.post('/api/v1/super-admin/chat/channels').set('x-csrf-token', root.csrf).send({ kind: 'support_service', name: 'Counsellor chat', slug: 'counsellor-chat', published: true, serviceRole: 'counsellor' });
    expect(svc.status).toBe(201);
    const student = await login('chat@srmap.edu.in');
    const thread = await student.agent.post(`/api/v1/chat/services/${svc.body.data.id}/open`).set('x-csrf-token', student.csrf);
    const png = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d', 'hex'), Buffer.alloc(64)]);
    const denied = await student.agent.post(`/api/v1/chat/channels/${thread.body.data.id}/attachments`).set('x-csrf-token', student.csrf).attach('file', png, 'a.png');
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('media_disabled');

    const patch = await root.agent.patch('/api/v1/super-admin/settings').set('x-csrf-token', root.csrf).send({ settings: { chat: { media: { support: { images: true, videos: true } } } } });
    expect(patch.status).toBe(200);
    const { invalidateSettingsCache } = await import('../src/services/settings.service');
    invalidateSettingsCache();
    const allowed = await student.agent.post(`/api/v1/chat/channels/${thread.body.data.id}/attachments`).set('x-csrf-token', student.csrf).attach('file', png, 'a.png');
    expect(allowed.status).toBe(201);
    const sent = await student.agent.post(`/api/v1/chat/channels/${thread.body.data.id}/messages`).set('x-csrf-token', student.csrf).send({ body: '', attachmentIds: [allowed.body.data.id], clientMessageId: randomUUID() });
    expect(sent.status).toBe(201);
    // Configuring chat does not give the Super Admin access to the private thread.
    expect((await root.agent.get(`/api/v1/chat/channels/${thread.body.data.id}/messages`)).status).toBe(404);
  });

  it('website is Super Admin only; the app refuses Super Admins', async () => {
    await makeUser('webstudent@srmap.edu.in', 'student', { studentId: 'WS-1' });
    await makeUser('webadmin@srmap.edu.in', 'admin');
    await makeUser('webroot@srmap.edu.in', 'super_admin');
    const { agent, csrf } = await agentWithCsrf();
    for (const email of ['webstudent@srmap.edu.in', 'webadmin@srmap.edu.in']) {
      const r = await agent.post('/api/v1/auth/login').set('x-csrf-token', csrf).send({ email, password: PASSWORD });
      expect(r.status).toBe(401);
      expect(r.body.error.code).toBe('use_app');
    }
    await webLogin('webroot@srmap.edu.in');
    const fromApp = await request(app).post('/api/v1/auth/login').set('X-CampusCare-Client', 'android').send({ email: 'webroot@srmap.edu.in', password: PASSWORD });
    expect(fromApp.status).toBe(401);
    expect(fromApp.body.error.code).toBe('use_website');
  });

  it('app sessions: bearer token works without CSRF, wrong token is rejected, logout revokes it', async () => {
    await makeUser('bearer@srmap.edu.in', 'student', { studentId: 'BR-1' });
    const s = await appLogin('bearer@srmap.edu.in');
    const me = await s.agent.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe('bearer@srmap.edu.in');
    // State-changing request without any CSRF token is accepted for a cookie-less app request.
    const contact = await s.agent.post('/api/v1/safety/trusted-contacts').send({ name: 'Parent', email: 'parent@example.com', shareLocation: false });
    expect(contact.status).toBeLessThan(300);
    expect((await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer not-a-real-token')).status).toBe(401);
    expect((await s.agent.post('/api/v1/auth/logout')).status).toBe(200);
    expect((await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${s.token}`)).status).toBe(401);
  });

  it('remote config for installed apps is public and carries the account domain', async () => {
    const r = await request(app).get('/api/v1/mobile/config');
    expect(r.status).toBe(200);
    expect(r.body.data.settings.accountEmailDomain).toBe('srmap.edu.in');
    expect(r.body.data.update).toBeDefined();
    expect(JSON.stringify(r.body)).not.toMatch(/passwordHash|secret|smtp/i);
  });

  it('accounts are limited to @srmap.edu.in even if another domain is approved', async () => {
    await models.EmailDomain.create({ domain: 'other-university.edu', purpose: 'both', status: 'active', verifiedAt: new Date(), verificationToken: 'y' });
    const r = await request(app).post('/api/v1/auth/register').set('X-CampusCare-Client', 'android').send({
      fullName: 'Outsider', email: 'someone@other-university.edu', studentId: 'OU-1', department: 'Physics', academicYear: 1, password: PASSWORD, confirmPassword: PASSWORD, acceptPolicy: true,
    });
    expect(r.status).toBe(422);
    const ok = await request(app).post('/api/v1/auth/register').set('X-CampusCare-Client', 'android').send({
      fullName: 'Insider', email: 'insider@srmap.edu.in', studentId: 'IN-1', department: 'Physics', academicYear: 1, password: PASSWORD, confirmPassword: PASSWORD, acceptPolicy: true,
    });
    expect(ok.status).toBe(201);
    await makeUser('inviter@srmap.edu.in', 'admin');
    const admin = await appLogin('inviter@srmap.edu.in');
    const invite = await admin.agent.post('/api/v1/admin/users/invite').send({ fullName: 'Staff Outside', email: 'staff@other-university.edu', role: 'counsellor', committeeIds: [] });
    expect(invite.status).toBe(422);
  });

  it('SOS escalates when nobody acknowledges, and acknowledgement stops it', async () => {
    await makeUser('esc@srmap.edu.in', 'student', { studentId: 'ESC-1' });
    await makeUser('guard@srmap.edu.in', 'security_officer');
    const s = await appLogin('esc@srmap.edu.in');
    const raised = await s.agent.post('/api/v1/safety/sos').send({ idempotencyKey: randomUUID(), latitude: 16.46, longitude: 80.5, accuracyMeters: 20 });
    expect(raised.status).toBe(201);
    const id = raised.body.data.id;
    const { runSosEscalation } = await import('../src/services/safety.service');
    const { EmergencyAlert } = await import('../src/models/safety');
    // Not old enough yet.
    expect(await runSosEscalation()).toBe(0);
    // 3 minutes later: level 1 (backup + primary re-alert).
    await EmergencyAlert.updateOne({ _id: id }, { $set: { createdAt: new Date(Date.now() - 180_000), status: 'sent' } });
    expect(await runSosEscalation()).toBe(1);
    expect((await EmergencyAlert.findById(id).lean())!.escalationLevel).toBe(1);
    expect(await runSosEscalation()).toBe(0); // never notifies twice for the same level
    // A responder acknowledges: no further escalation even when level 2 would be due.
    const guard = await appLogin('guard@srmap.edu.in');
    expect((await guard.agent.post(`/api/v1/safety/responder/alerts/${id}/acknowledge`)).status).toBe(200);
    await EmergencyAlert.updateOne({ _id: id }, { $set: { createdAt: new Date(Date.now() - 600_000) } });
    expect(await runSosEscalation()).toBe(0);
    const status = await s.agent.get(`/api/v1/safety/sos/${id}`);
    expect(status.body.data.status).toBe('acknowledged');
    expect(status.body.data.timeline.map((t: { type: string }) => t.type)).toEqual(expect.arrayContaining(['escalated_backup']));
    // The Super Admin's live-ops view never shows the student's identity or location.
    await makeUser('ops@srmap.edu.in', 'super_admin');
    const root = await webLogin('ops@srmap.edu.in');
    const ops = await root.agent.get('/api/v1/super-admin/live-ops');
    expect(ops.status).toBe(200);
    expect(JSON.stringify(ops.body)).not.toMatch(/esc@srmap|ESC-1|16\.46/);
  });

  it('SOS alerts are idempotent', async () => {
    await makeUser('sos@srmap.edu.in', 'student', { studentId: 'SOS-1' });
    const s = await login('sos@srmap.edu.in');
    const key = randomUUID();
    const a = await s.agent.post('/api/v1/safety/sos').set('x-csrf-token', s.csrf).send({ idempotencyKey: key, locationUnavailableReason: 'Permission denied' });
    const b = await s.agent.post('/api/v1/safety/sos').set('x-csrf-token', s.csrf).send({ idempotencyKey: key });
    expect(a.status).toBe(201);
    expect(b.body.data.id).toBe(a.body.data.id);
    expect(a.body.data.status).toBe('queued'); // never reported as delivered before delivery happens
  });
});
