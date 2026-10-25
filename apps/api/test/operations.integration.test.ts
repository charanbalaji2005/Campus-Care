/**
 * Operations integration tests: duty roster, SOS dispatch, live map, MFA and chat governance.
 * Always runs against a private in-memory MongoDB (never the database in .env). Email goes to the
 * console provider and push is unconfigured (see setup-env.ts), so no real person is ever contacted.
 * Set SKIP_DB_TESTS=true to skip (e.g. where the mongod binary cannot be downloaded).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { authenticator } from 'otplib';

const d = process.env.SKIP_DB_TESTS === 'true' ? describe.skip : describe;
const PASSWORD = 'Operations-Test-9';
type Agent = ReturnType<typeof request.agent>;

d('Operations (integration)', () => {
  let mongo: { stop: () => Promise<boolean>; getUri: () => string };
  let app: import('express').Express;
  let M: typeof import('../src/models/user') & typeof import('../src/models/safety') & typeof import('../src/models/duty') & typeof import('../src/models/mfa')
    & typeof import('../src/models/platform') & typeof import('../src/models/chat') & typeof import('../src/models/incident') & typeof import('../src/models/content');
  let dispatch: typeof import('../src/services/dispatch.service');
  let duty: typeof import('../src/services/duty.service');
  let safety: typeof import('../src/services/safety.service');
  let jobs: typeof import('../src/services/jobs.service');
  let settings: typeof import('../src/services/settings.service');
  let hash: string;
  const ids: Record<string, string> = {};

  async function makeUser(email: string, role: string, extra: Record<string, unknown> = {}) {
    const u = await M.User.create({ fullName: email.split('@')[0], email, role, passwordHash: hash, emailVerified: true, accountStatus: 'active', ...extra });
    ids[email.split('@')[0]!] = String(u._id);
    return u;
  }
  async function webLogin(email: string, mfa?: () => Promise<{ code?: string; recoveryCode?: string }>) {
    const agent = request.agent(app);
    const csrf = (await agent.get('/api/v1/auth/csrf')).body.data.csrfToken as string;
    const r = await agent.post('/api/v1/auth/login').set('x-csrf-token', csrf).send({ email, password: PASSWORD });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    if (r.body.data.mfaRequired) {
      expect(r.body.data.challengeToken).toBeTruthy();
      expect(r.headers['set-cookie']?.toString() ?? '').not.toMatch(/cc_session=/); // no session before the second factor
      const f = await mfa!();
      const path = f.code ? '/api/v1/auth/mfa/challenge' : '/api/v1/auth/mfa/recovery';
      const v = await agent.post(path).set('x-csrf-token', csrf).send({ challengeToken: r.body.data.challengeToken, ...f });
      return { agent, csrf: freshCsrf(v) ?? csrf, res: v };
    }
    return { agent, csrf: freshCsrf(r) ?? csrf, res: r };
  }
  function freshCsrf(r: request.Response) {
    const c = (r.headers['set-cookie'] as unknown as string[] | undefined)?.find((x) => x.startsWith('cc_csrf='));
    return c ? c.split(';')[0]!.split('=')[1] : undefined;
  }
  async function appLogin(email: string) {
    const r = await request(app).post('/api/v1/auth/login').set('X-CampusCare-Client', 'android').send({ email, password: PASSWORD });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const token = r.body.data.sessionToken as string;
    return { agent: request.agent(app).set('Authorization', `Bearer ${token}`).set('X-CampusCare-Client', 'android') as unknown as Agent, token };
  }
  async function onDuty(userId: string, extra: Record<string, unknown> = {}) {
    await M.ResponderAvailability.findOneAndUpdate(
      { userId },
      { $set: { status: 'on_duty', lastHeartbeatAt: new Date(), statusChangedAt: new Date(), activeAssignmentCount: 0, campus: 'main', responsibilities: ['sos_response'], ...extra } },
      { upsert: true },
    );
  }
  const avail = (userId: string) => M.ResponderAvailability.findOne({ userId }).lean();
  const openFor = (alertId: string) => M.AlertAssignment.find({ alertId, open: true }).lean();
  async function raise(agent: Agent, body: Record<string, unknown> = {}) {
    const r = await agent.post('/api/v1/safety/sos').send({ idempotencyKey: randomUUID(), latitude: 16.4636, longitude: 80.5074, accuracyMeters: 15, ...body });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.data.id as string;
  }

  let root: Awaited<ReturnType<typeof webLogin>>;
  let student: Agent;
  let student2: Agent;
  let r1: Agent;
  let r2: Agent;

  beforeAll(async () => {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    mongo = await MongoMemoryServer.create();
    const { connectDatabase } = await import('../src/db/connect');
    await connectDatabase(mongo.getUri());
    const { createApp } = await import('../src/app');
    app = createApp();
    M = {
      ...(await import('../src/models/user')), ...(await import('../src/models/safety')), ...(await import('../src/models/duty')), ...(await import('../src/models/mfa')),
      ...(await import('../src/models/platform')), ...(await import('../src/models/chat')), ...(await import('../src/models/incident')), ...(await import('../src/models/content')),
    };
    dispatch = await import('../src/services/dispatch.service');
    duty = await import('../src/services/duty.service');
    safety = await import('../src/services/safety.service');
    jobs = await import('../src/services/jobs.service');
    settings = await import('../src/services/settings.service');
    for (const name of mongoose.modelNames()) await mongoose.model(name).syncIndexes();
    await settings.updateSettings({ turnstile: { enabled: false }, security: { requireMfaForSuperAdmin: false }, sos: { countdownSeconds: 3 } }, '000000000000000000000000');
    const { hashPassword } = await import('../src/lib/crypto');
    hash = await hashPassword(PASSWORD);
    await makeUser('root@srmap.edu.in', 'super_admin');
    await makeUser('stu@srmap.edu.in', 'student', { studentId: 'OPS-1', phone: '+91 90000 00001' });
    await makeUser('stu2@srmap.edu.in', 'student', { studentId: 'OPS-2' });
    await makeUser('triage@srmap.edu.in', 'admin');
    root = await webLogin('root@srmap.edu.in');
    student = (await appLogin('stu@srmap.edu.in')).agent;
    student2 = (await appLogin('stu2@srmap.edu.in')).agent;
  }, 120_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo?.stop();
  });

  // ---------------------------------------------------------------- delivery retries (runs before any responder exists)
  it('retries SOS delivery durably when nobody can be reached, then delivers', async () => {
    await settings.updateSettings({ dispatch: { autoAssign: false } }, ids.root!);
    const id = await raise(student, { countdownMode: 'client' });
    await jobs.runDueJobs();
    let alert = await M.EmergencyAlert.findById(id).lean();
    expect(alert!.status).toBe('failed'); // never reported as delivered
    const job = await M.Job.findOne({ type: 'sos.deliver', 'payload.alertId': id }).lean();
    expect(job!.status).toBe('pending'); // queued for retry with backoff
    expect(job!.attempts).toBe(1);
    expect(job!.runAt.getTime()).toBeGreaterThan(Date.now());
    // An officer becomes available; the retry delivers.
    await makeUser('guard0@srmap.edu.in', 'security_officer');
    await M.Job.updateOne({ _id: job!._id }, { $set: { runAt: new Date() } });
    await jobs.runDueJobs();
    alert = await M.EmergencyAlert.findById(id).lean();
    expect(alert!.status).toBe('sent');
    expect(await M.AlertDeliveryEvent.countDocuments({ alertId: id, channel: 'in_app', outcome: 'delivered' })).toBeGreaterThan(0);
    await M.EmergencyAlert.updateOne({ _id: id }, { $set: { status: 'resolved', resolvedAt: new Date() } });
    await settings.updateSettings({ dispatch: { autoAssign: true } }, ids.root!);
  });

  // ---------------------------------------------------------------- duty roster
  it('runs the shift workflow: offer, accept, start inside the window, overlap protection', async () => {
    await makeUser('resp1@srmap.edu.in', 'security_officer');
    await makeUser('resp2@srmap.edu.in', 'security_officer');
    r1 = (await appLogin('resp1@srmap.edu.in')).agent;
    r2 = (await appLogin('resp2@srmap.edu.in')).agent;
    // Going on duty without a shift is refused by policy.
    const noShift = await r1.patch('/api/v1/responders/me/duty-status').send({ status: 'on_duty' });
    expect(noShift.body.error.code).toBe('shift_required');

    const startAt = new Date(Date.now() - 5 * 60_000);
    const endAt = new Date(Date.now() + 2 * 3600_000);
    const created = await root.agent.post('/api/v1/admin/duty-shifts').set('x-csrf-token', root.csrf).send({ responderId: ids.resp1, startAt, endAt, campus: 'main' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data.status).toBe('offered');
    const overlap = await root.agent.post('/api/v1/admin/duty-shifts').set('x-csrf-token', root.csrf).send({ responderId: ids.resp1, startAt, endAt, campus: 'main' });
    expect(overlap.status).toBe(409);
    const shiftId = created.body.data.id;
    expect((await r1.post(`/api/v1/responders/me/shifts/${shiftId}/start`)).body.error.code).toBe('invalid_state'); // accept first
    expect((await r2.post(`/api/v1/responders/me/shifts/${shiftId}/decision`).send({ decision: 'accept' })).status).toBe(404); // not theirs
    expect((await r1.post(`/api/v1/responders/me/shifts/${shiftId}/decision`).send({ decision: 'accept' })).status).toBe(200);
    const started = await r1.post(`/api/v1/responders/me/shifts/${shiftId}/start`);
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    const me = await r1.get('/api/v1/responders/me/duty');
    expect(me.body.data.availability.status).toBe('on_duty');
    expect(me.body.data.availability.heartbeatFresh).toBe(true);
    expect(me.body.data.policy.heartbeatIntervalSeconds).toBe(45);
    // A second responder goes on duty with a directly assigned shift.
    const s2 = await root.agent.post('/api/v1/admin/duty-shifts').set('x-csrf-token', root.csrf).send({ responderId: ids.resp2, startAt, endAt, campus: 'main', assignDirectly: true });
    expect(s2.body.data.status).toBe('accepted');
    expect((await r2.post(`/api/v1/responders/me/shifts/${s2.body.data.id}/start`)).status).toBe(200);
    ids.shift1 = shiftId;
  });

  it('accepts heartbeats on server time, rejects self-set system states, and refuses heartbeats off duty', async () => {
    const hb = await r1.post('/api/v1/responders/me/heartbeat').send({ latitude: 16.4637, longitude: 80.5075, accuracyMeters: 12 });
    expect(hb.status).toBe(200);
    expect(hb.body.data.locationAccepted).toBe(false); // no consent yet → position not stored
    expect((await avail(ids.resp1!))!.location).toBeNull();
    await r1.patch('/api/v1/responders/me/location-consent').send({ shareLocation: true });
    expect((await r1.post('/api/v1/responders/me/heartbeat').send({ latitude: 16.4637, longitude: 80.5075, accuracyMeters: 12, locationAgeSeconds: 4 })).body.data.locationAccepted).toBe(true);
    const loc = (await avail(ids.resp1!))!.location!;
    expect(Date.now() - loc.at.getTime()).toBeGreaterThanOrEqual(3_000); // age from the device, clock from the server
    expect((await r1.patch('/api/v1/responders/me/duty-status').send({ status: 'responding' })).status).toBe(422);
    expect((await r1.patch('/api/v1/responders/me/duty-status').send({ status: 'stale' })).status).toBe(422);
    const outsider = (await appLogin('guard0@srmap.edu.in')).agent;
    expect((await outsider.post('/api/v1/responders/me/heartbeat').send({})).body.error.code).toBe('not_on_duty');
  });

  it('marks silent responders stale (not off duty), alerts supervisors, and restores them on the next heartbeat', async () => {
    const old = new Date(Date.now() - 10 * 60_000);
    await M.ResponderAvailability.updateOne({ userId: ids.resp1 }, { $set: { lastHeartbeatAt: old, statusChangedAt: old } });
    expect(await duty.sweepStaleResponders()).toBe(1);
    const a = await avail(ids.resp1!);
    expect(a!.status).toBe('stale');
    expect(a!.statusBeforeStale).toBe('on_duty');
    expect(await M.DutyStatusEvent.countDocuments({ userId: ids.resp1, to: 'stale', actor: 'system' })).toBe(1);
    const roster = await root.agent.get('/api/v1/admin/duty-roster');
    expect(roster.body.data.rows.find((r: { userId: string }) => r.userId === ids.resp1).status).toBe('stale');
    expect(roster.body.data.counts.stale).toBe(1);
    // The responder cannot clear "stale" by hand; a heartbeat restores the previous state.
    expect((await r1.patch('/api/v1/responders/me/duty-status').send({ status: 'on_duty' })).status).toBe(409);
    expect((await r1.post('/api/v1/responders/me/heartbeat').send({})).body.data.status).toBe('on_duty');
  });

  it('requires duty:manage and a reason for supervisor overrides, and audits them', async () => {
    const triage = (await appLogin('triage@srmap.edu.in')).agent;
    expect((await triage.post(`/api/v1/admin/responders/${ids.resp2}/duty-status`).send({ status: 'on_break', reason: 'Lunch cover' })).status).toBe(403);
    expect((await triage.get('/api/v1/admin/duty-roster')).status).toBe(200); // admins may view
    expect((await student.get('/api/v1/admin/duty-roster')).status).toBe(403);
    const noReason = await root.agent.post(`/api/v1/admin/responders/${ids.resp2}/duty-status`).set('x-csrf-token', root.csrf).send({ status: 'on_break' });
    expect(noReason.status).toBe(422);
    const okR = await root.agent.post(`/api/v1/admin/responders/${ids.resp2}/duty-status`).set('x-csrf-token', root.csrf).send({ status: 'on_break', reason: 'Lunch cover' });
    expect(okR.status, JSON.stringify(okR.body)).toBe(200);
    const entry = await M.AuditLog.findOne({ action: 'duty.manual_override', targetId: ids.resp2 }).lean();
    expect(entry!.reason).toBe('Lunch cover');
    expect(entry!.correlationId).toBeTruthy();
    expect((await M.DutyStatusEvent.findOne({ userId: ids.resp2, actor: 'supervisor' }).lean())!.actorId).toBeTruthy();
    await root.agent.post(`/api/v1/admin/responders/${ids.resp2}/duty-status`).set('x-csrf-token', root.csrf).send({ status: 'on_duty', reason: 'Back from lunch' });
    await onDuty(ids.resp2!);
  });

  // ---------------------------------------------------------------- SOS countdown and cancellation
  it('server countdown: a pending alert is invisible to responders and cancels atomically before dispatch', async () => {
    const id = await raise(student, { countdownMode: 'server' });
    expect((await M.EmergencyAlert.findById(id).lean())!.status).toBe('pending');
    const list = await r1.get('/api/v1/safety/responder/alerts?all=true');
    expect(list.body.data.some((a: { id: string }) => a.id === id)).toBe(false);
    expect((await r1.get(`/api/v1/safety/responder/alerts/${id}`)).status).toBe(404);
    const c = await student.post(`/api/v1/safety/sos/${id}/cancel`).send({ reason: 'Pressed by mistake' });
    expect(c.body.data.status).toBe('cancelled');
    expect(await safety.dispatchSos(id, { force: true })).toBeNull(); // can never be sent after a pre-dispatch cancel
    const a = await M.EmergencyAlert.findById(id).lean();
    expect(a!.dispatchedAt).toBeNull();
    expect(a!.events.map((e) => e.type)).toContain('cancelled_before_dispatch');
    expect(await M.AlertAssignment.countDocuments({ alertId: id })).toBe(0);
    expect(await M.AlertDeliveryEvent.countDocuments({ alertId: id })).toBe(0);
  });

  it('cancel racing dispatch always ends in exactly one consistent outcome', async () => {
    for (let i = 0; i < 5; i++) {
      const id = await raise(student2, { countdownMode: 'server' });
      await Promise.all([student2.post(`/api/v1/safety/sos/${id}/cancel`).send({}), safety.dispatchSos(id, { force: true })]);
      const a = await M.EmergencyAlert.findById(id).lean();
      const types = a!.events.map((e) => e.type);
      expect(a!.status).toBe('cancelled');
      if (types.includes('cancelled_before_dispatch')) {
        expect(a!.dispatchedAt).toBeNull();
        expect(types).not.toContain('dispatched');
        expect(await M.AlertAssignment.countDocuments({ alertId: id })).toBe(0);
      } else {
        expect(types).toContain('cancelled_after_dispatch');
        expect(a!.dispatchedAt).not.toBeNull();
        expect(await M.AlertAssignment.countDocuments({ alertId: id, open: true })).toBe(0);
      }
    }
    for (const r of [ids.resp1!, ids.resp2!]) expect((await avail(r))!.activeAssignmentCount).toBe(0);
  });

  // ---------------------------------------------------------------- assignment algorithm
  it('assigns the best eligible responder, moves on after a decline and a missed deadline, then falls back', async () => {
    await onDuty(ids.resp1!);
    await onDuty(ids.resp2!, { skills: ['first_aid'] });
    const id = await raise(student);
    let open = await openFor(id);
    expect(open).toHaveLength(1);
    expect(String(open[0]!.responderId)).toBe(ids.resp2); // preferred skill ranks first
    expect((await avail(ids.resp2!))!.activeAssignmentCount).toBe(1);
    expect((await M.EmergencyAlert.findById(id).lean())!.assignmentState).toBe('offered');

    expect((await r1.post(`/api/v1/emergency-alerts/${id}/decline`).send({ reason: 'Not mine' })).status).toBe(409); // no offer for r1
    expect((await r2.post(`/api/v1/emergency-alerts/${id}/decline`).send({ reason: 'Handling a fall at gate 2' })).status).toBe(200);
    open = await openFor(id);
    expect(String(open[0]!.responderId)).toBe(ids.resp1);
    expect((await avail(ids.resp2!))!.activeAssignmentCount).toBe(0);

    await M.AlertAssignment.updateOne({ _id: open[0]!._id }, { $set: { ackDeadlineAt: new Date(Date.now() - 1000) } });
    const sweep = await dispatch.sweepAssignments();
    expect(sweep.expired).toBe(1);
    const a = await M.EmergencyAlert.findById(id).lean();
    expect(a!.assignmentState).toBe('unassigned'); // both tried → explicit warning, never silent
    expect(a!.unassignedSince).not.toBeNull();
    expect(a!.events.map((e) => e.type)).toEqual(expect.arrayContaining(['assigned', 'assignment_declined', 'assignment_expired', 'no_eligible_responder']));
    expect(await M.AuditLog.countDocuments({ action: 'sos.unassigned', targetId: id })).toBe(1);
    expect(await M.Notification.countDocuments({ title: `UNASSIGNED SOS ${a!.alertNumber}` })).toBeGreaterThan(0);
    // The alert is still open and waiting — nothing closed it.
    expect(['sent', 'queued', 'sending', 'failed']).toContain(a!.status);

    // A dispatcher assigns manually; the responder acknowledges and is marked responding.
    const man = await root.agent.post(`/api/v1/emergency-alerts/${id}/assign`).set('x-csrf-token', root.csrf).send({ responderId: ids.resp1, reason: 'Radio confirmed nearest' });
    expect(man.status, JSON.stringify(man.body)).toBe(200);
    expect((await r2.post(`/api/v1/emergency-alerts/${id}/assign`).send({ reason: 'Trying to dispatch' })).status).toBe(403); // responders cannot dispatch
    const ack = await r1.post(`/api/v1/emergency-alerts/${id}/acknowledge`);
    expect(ack.status, JSON.stringify(ack.body)).toBe(200);
    expect((await avail(ids.resp1!))!.status).toBe('responding');
    const resolved = await r1.post(`/api/v1/safety/responder/alerts/${id}/resolve`).send({ outcome: 'assisted' });
    expect(resolved.status).toBe(200);
    expect((await avail(ids.resp1!))!.activeAssignmentCount).toBe(0);
    expect((await avail(ids.resp1!))!.status).toBe('on_duty');
    expect(await M.AlertAssignment.countDocuments({ alertId: id, open: true })).toBe(0);
  });

  it('flags an alert as unassigned immediately when nobody eligible is on duty', async () => {
    await M.ResponderAvailability.updateMany({}, { $set: { status: 'off_duty' } });
    const id = await raise(student2, { latitude: undefined, longitude: undefined, accuracyMeters: undefined, locationUnavailableReason: 'permission_denied' });
    const a = await M.EmergencyAlert.findById(id).lean();
    expect(a!.assignmentState).toBe('unassigned');
    expect(a!.latitude).toBeNull(); // GPS denied: no invented coordinates
    expect(a!.locationUnavailableReason).toBe('permission_denied');
    const ops = await root.agent.get('/api/v1/admin/emergency-alerts?status=active');
    const row = ops.body.data.items.find((x: { id: string }) => x.id === id);
    expect(row.assignmentState).toBe('unassigned');
    expect(row.locationAvailable).toBe(false);
    expect(row.reporterRef).toMatch(/^R-[0-9A-F]{8}$/);
    expect(JSON.stringify(ops.body)).not.toMatch(/stu2@srmap|OPS-2/); // lists never show the reporter
    await M.EmergencyAlert.updateOne({ _id: id }, { $set: { status: 'resolved', resolvedAt: new Date() } });
  });

  it('never gives one responder more alerts than their capacity, even under concurrent dispatch', async () => {
    await onDuty(ids.resp1!);
    const [a, b] = await Promise.all([raise(student), raise(student2)]);
    const all = await M.AlertAssignment.find({ responderId: ids.resp1, open: true }).lean();
    expect(all).toHaveLength(1);
    expect((await avail(ids.resp1!))!.activeAssignmentCount).toBe(1);
    const states = (await M.EmergencyAlert.find({ _id: { $in: [a, b] } }).lean()).map((x) => x.assignmentState).sort();
    expect(states).toEqual(['offered', 'unassigned']);

    // Free the responder; many concurrent assignment runs for the waiting alert create exactly one offer.
    const holder = String(all[0]!.alertId);
    const waiting = holder === a ? b : a;
    await dispatch.closeAlertAssignments(holder, 'completed', 'test');
    await M.EmergencyAlert.updateOne({ _id: holder }, { $set: { status: 'resolved', resolvedAt: new Date() } });
    await Promise.all(Array.from({ length: 6 }, () => dispatch.runAssignment(waiting, { reason: 'race' })));
    expect(await openFor(waiting)).toHaveLength(1);
    expect((await avail(ids.resp1!))!.activeAssignmentCount).toBe(1);
    await dispatch.closeAlertAssignments(waiting, 'completed', 'test');
    await M.EmergencyAlert.updateOne({ _id: waiting }, { $set: { status: 'resolved', resolvedAt: new Date() } });
    expect((await avail(ids.resp1!))!.activeAssignmentCount).toBe(0);
  });

  it('group dispatch: two responders acknowledge at once and exactly one owns the alert', async () => {
    await settings.updateSettings({ dispatch: { policy: 'group', groupSize: 2 } }, ids.root!);
    await onDuty(ids.resp1!);
    await onDuty(ids.resp2!);
    const id = await raise(student);
    expect(await openFor(id)).toHaveLength(2);
    const [x, y] = await Promise.all([r1.post(`/api/v1/emergency-alerts/${id}/acknowledge`), r2.post(`/api/v1/emergency-alerts/${id}/acknowledge`)]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const open = await openFor(id);
    expect(open).toHaveLength(1);
    expect(open[0]!.status).toBe('acknowledged');
    expect(await M.AlertAssignment.countDocuments({ alertId: id, status: 'superseded' })).toBe(1);
    const counts = [(await avail(ids.resp1!))!.activeAssignmentCount, (await avail(ids.resp2!))!.activeAssignmentCount].sort();
    expect(counts).toEqual([0, 1]);
    // Student cancels after dispatch: recorded, holder released and told.
    const c = await student.post(`/api/v1/safety/sos/${id}/cancel`).send({ reason: 'I am safe now' });
    expect(c.body.data.status).toBe('cancelled');
    const a = await M.EmergencyAlert.findById(id).lean();
    expect(a!.events.map((e) => e.type)).toContain('cancelled_after_dispatch');
    expect(await M.AlertAssignment.countDocuments({ alertId: id, status: 'cancelled' })).toBe(1);
    expect((await avail(ids.resp1!))!.activeAssignmentCount + (await avail(ids.resp2!))!.activeAssignmentCount).toBe(0);
    await settings.updateSettings({ dispatch: { policy: 'single' } }, ids.root!);
  });

  it('moves an offer on immediately when the assigned responder goes stale', async () => {
    await onDuty(ids.resp1!, { skills: ['first_aid'] });
    await onDuty(ids.resp2!);
    const id = await raise(student);
    expect(String((await openFor(id))[0]!.responderId)).toBe(ids.resp1);
    const old = new Date(Date.now() - 10 * 60_000);
    await M.ResponderAvailability.updateOne({ userId: ids.resp1 }, { $set: { lastHeartbeatAt: old, statusChangedAt: old } });
    await duty.sweepStaleResponders();
    const open = await openFor(id);
    expect(open).toHaveLength(1);
    expect(String(open[0]!.responderId)).toBe(ids.resp2);
    await dispatch.closeAlertAssignments(id, 'completed', 'test');
    await M.EmergencyAlert.updateOne({ _id: id }, { $set: { status: 'resolved', resolvedAt: new Date() } });
  });

  // ---------------------------------------------------------------- live map
  it('live map: layers follow permissions, markers carry no identity, and every view is audited', async () => {
    const share = await student.post('/api/v1/location-shares').send({ durationMinutes: 30, audience: 'security', latitude: 16.465, longitude: 80.506, accuracyMeters: 25 });
    expect(share.status, JSON.stringify(share.body)).toBe(201);
    const map = await root.agent.get('/api/v1/admin/live-locations');
    expect(map.status).toBe(200);
    expect(map.body.data.layers).toEqual({ alerts: true, responders: true, shares: true });
    const marker = map.body.data.shares.find((s: { id: string }) => s.id === share.body.data.id);
    expect(marker.accuracyMeters).toBe(25);
    expect(marker.stale).toBe(false);
    expect(JSON.stringify(map.body.data.shares)).not.toMatch(/stu@srmap|OPS-1|stu"/);
    expect(await M.LocationAccessAudit.countDocuments({ subjectId: share.body.data.id, access: 'live_map' })).toBe(1);
    await root.agent.get('/api/v1/admin/live-locations');
    expect(await M.LocationAccessAudit.countDocuments({ subjectId: share.body.data.id, access: 'live_map' })).toBe(1); // polling is de-duplicated
    const detail = await root.agent.get(`/api/v1/admin/live-locations/share/${share.body.data.id}`);
    expect(detail.body.data.person.studentId).toBe('OPS-1');
    expect(await M.LocationAccessAudit.countDocuments({ subjectId: share.body.data.id, access: 'detail' })).toBe(1);
    const privacy = await student.get('/api/v1/me/privacy');
    expect(privacy.body.data.locationAccess.length).toBeGreaterThanOrEqual(2);

    const triage = (await appLogin('triage@srmap.edu.in')).agent;
    const limited = await triage.get('/api/v1/admin/live-locations');
    expect(limited.body.data.layers).toEqual({ alerts: false, responders: true, shares: false });
    expect(limited.body.data.shares).toEqual([]);
    expect((await triage.get(`/api/v1/admin/live-locations/share/${share.body.data.id}`)).status).toBe(404);
    expect((await student.get('/api/v1/admin/live-locations')).status).toBe(403);

    // Withdrawing consent stops it everywhere, at once.
    expect((await student.delete(`/api/v1/location-shares/${share.body.data.id}`)).body.data.stopped).toBe(true);
    expect((await student.patch(`/api/v1/location-shares/${share.body.data.id}`).send({ latitude: 16.4, longitude: 80.5 })).status).toBe(410);
    const after = await root.agent.get('/api/v1/admin/live-locations');
    expect(after.body.data.shares.some((s: { id: string }) => s.id === share.body.data.id)).toBe(false);
  });

  // ---------------------------------------------------------------- MFA
  it('TOTP: activates only after a valid code, issues exactly 8 hashed recovery codes, and requires a challenge to sign in', async () => {
    await makeUser('mfa@srmap.edu.in', 'super_admin');
    const s = await webLogin('mfa@srmap.edu.in');
    const setup = await s.agent.post('/api/v1/auth/mfa/totp/setup').set('x-csrf-token', s.csrf).send({});
    expect(setup.status).toBe(200);
    expect(setup.body.data.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    const secret = setup.body.data.secret as string;
    expect((await M.User.findById(ids.mfa).lean())!.mfaEnabled).toBe(false); // showing the QR changes nothing
    expect((await s.agent.post('/api/v1/auth/mfa/totp/verify').set('x-csrf-token', s.csrf).send({ code: '000000' })).status).toBe(422);
    const v = await s.agent.post('/api/v1/auth/mfa/totp/verify').set('x-csrf-token', s.csrf).send({ code: authenticator.generate(secret) });
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    expect(v.headers['cache-control']).toBe('no-store');
    const codes = v.body.data.recoveryCodes as string[];
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    const stored = await M.RecoveryCode.find({ userId: ids.mfa }).lean();
    expect(stored).toHaveLength(8);
    expect(JSON.stringify(stored)).not.toContain(codes[0]!.replace('-', ''));
    const auditText = JSON.stringify(await M.AuditLog.find({ actorId: ids.mfa }).lean());
    for (const c of codes) expect(auditText).not.toContain(c);
    expect(auditText).not.toContain(secret);
    ids.secret = secret;
    ids.codes = JSON.stringify(codes);

    // Next sign-in: a challenge, then a code from the following time step (each step works once).
    const nextStep = authenticator.clone({ epoch: Date.now() + 30_000 }).generate(secret);
    const login = await webLogin('mfa@srmap.edu.in', async () => ({ code: nextStep }));
    expect(login.res.status, JSON.stringify(login.res.body)).toBe(200);
    expect((await login.agent.get('/api/v1/auth/me')).body.data.session.mfaVerified).toBe(true);
    // Replaying the same code on a new challenge is refused.
    const replay = await webLogin('mfa@srmap.edu.in', async () => ({ code: nextStep }));
    expect(replay.res.status).toBe(401);
    expect(await M.AuditLog.countDocuments({ action: 'auth.mfa_replay_blocked', actorId: ids.mfa })).toBeGreaterThan(0);
  });

  it('recovery codes are single-use, regenerate atomically after re-authentication, and challenges are single-use', async () => {
    const codes = JSON.parse(ids.codes!) as string[];
    const used = await webLogin('mfa@srmap.edu.in', async () => ({ recoveryCode: codes[0] }));
    expect(used.res.status, JSON.stringify(used.res.body)).toBe(200);
    expect(used.res.body.data.recoveryCodesRemaining).toBe(7);
    const reuse = await webLogin('mfa@srmap.edu.in', async () => ({ recoveryCode: codes[0] }));
    expect(reuse.res.status).toBe(401);
    expect(reuse.res.body.error.code).toBe('invalid_recovery_code');

    // A challenge token works only once.
    const agent = request.agent(app);
    const csrf = (await agent.get('/api/v1/auth/csrf')).body.data.csrfToken;
    const first = await agent.post('/api/v1/auth/login').set('x-csrf-token', csrf).send({ email: 'mfa@srmap.edu.in', password: PASSWORD });
    const token = first.body.data.challengeToken;
    const won = await agent.post('/api/v1/auth/mfa/recovery').set('x-csrf-token', csrf).send({ challengeToken: token, recoveryCode: codes[1] });
    expect(won.status).toBe(200);
    const csrf2 = freshCsrf(won) ?? csrf; // signing in rotates the CSRF token
    expect((await agent.post('/api/v1/auth/mfa/recovery').set('x-csrf-token', csrf2).send({ challengeToken: token, recoveryCode: codes[2] })).body.error.code).toBe('mfa_challenge_expired');

    // Regeneration needs a recent password confirmation and invalidates the old set.
    const sess = used;
    await M.Session.updateMany({ userId: ids.mfa }, { $set: { reauthAt: new Date(0) } });
    expect((await sess.agent.post('/api/v1/auth/mfa/recovery-codes/regenerate').set('x-csrf-token', sess.csrf).send({})).body.error.code).toBe('reauth_required');
    await M.TotpConfiguration.updateOne({ userId: ids.mfa }, { $set: { lastUsedStep: 0 } }); // allow a fresh code in this test step
    const re = await sess.agent.post('/api/v1/auth/reauth').set('x-csrf-token', sess.csrf).send({ password: PASSWORD, mfaCode: authenticator.generate(ids.secret!) });
    expect(re.status, JSON.stringify(re.body)).toBe(200);
    const regen = await sess.agent.post('/api/v1/auth/mfa/recovery-codes/regenerate').set('x-csrf-token', sess.csrf).send({});
    expect(regen.body.data.recoveryCodes).toHaveLength(8);
    const stale = await webLogin('mfa@srmap.edu.in', async () => ({ recoveryCode: codes[3] }));
    expect(stale.res.status).toBe(401); // old set no longer valid
    const fresh = await webLogin('mfa@srmap.edu.in', async () => ({ recoveryCode: regen.body.data.recoveryCodes[0] }));
    expect(fresh.res.status).toBe(200);
    expect(await M.RecoveryCode.countDocuments({ userId: ids.mfa })).toBe(8);
    const status = await fresh.agent.get('/api/v1/auth/mfa/status');
    expect(status.body.data.recoveryCodesRemaining).toBe(7);
  });

  it('locks the second factor after repeated failures', async () => {
    await M.TotpConfiguration.updateOne({ userId: ids.mfa }, { $set: { failedAttempts: 0, lockedUntil: null } });
    for (let i = 0; i < 5; i++) await webLogin('mfa@srmap.edu.in', async () => ({ code: '123456' })).catch(() => undefined);
    const locked = await webLogin('mfa@srmap.edu.in', async () => ({ code: authenticator.generate(ids.secret!) }));
    expect(locked.res.status).toBe(429);
    expect(locked.res.body.error.code).toBe('mfa_locked');
    await M.TotpConfiguration.updateOne({ userId: ids.mfa }, { $set: { failedAttempts: 0, lockedUntil: null } });
  });

  it('revoking sessions signs the user out everywhere immediately', async () => {
    const victim = await appLogin('resp2@srmap.edu.in');
    expect((await victim.agent.get('/api/v1/auth/me')).status).toBe(200);
    expect((await root.agent.post(`/api/v1/super-admin/users/${ids.resp2}/revoke-sessions`).set('x-csrf-token', root.csrf).send({})).status).toBe(200);
    expect((await victim.agent.get('/api/v1/auth/me')).status).toBe(401);
    expect((await victim.agent.post('/api/v1/responders/me/heartbeat').send({})).status).toBe(401);
  });

  // ---------------------------------------------------------------- chat governance
  it('private chat review needs an explicit grant, a reason, an allowed target, and stays scoped and audited', async () => {
    const svc = await M.ChatChannel.create({ kind: 'support_service', name: 'Security desk', slug: 'desk-ops', serviceRole: 'security_officer', published: true });
    const thread = await M.ChatChannel.create({ kind: 'support_thread', name: 'Security desk', serviceId: svc._id, studentId: ids.stu, published: true });
    await M.ChatMessage.create({ channelId: thread._id, senderId: ids.stu, senderLabel: 'stu', body: 'Someone keeps following me after class', clientMessageId: randomUUID() });
    const other = await M.ChatChannel.create({ kind: 'support_thread', name: 'Security desk', serviceId: svc._id, studentId: ids.stu2, published: true });
    await M.ChatMessage.create({ channelId: other._id, senderId: ids.stu2, senderLabel: 'stu2', body: 'Unrelated private message', clientMessageId: randomUUID() });
    const counselling = await M.ChatChannel.create({ kind: 'counselling_thread', name: 'Session chat', studentId: ids.stu, published: true });

    const body = { scope: 'support_thread', targetId: String(thread._id), basis: 'safeguarding_concern', reason: 'Student reported stalking; verifying the reported timeline', caseReference: 'SG-2026-14', durationMinutes: 15 };
    // Super Admin role alone (configuration) does not include private reading.
    expect((await root.agent.post('/api/v1/admin/chat-reviews').set('x-csrf-token', root.csrf).send(body)).status).toBe(403);
    // Another Super Admin grants the explicit permission (nobody can grant it to themselves).
    await makeUser('investigator@srmap.edu.in', 'super_admin');
    const self = await root.agent.patch(`/api/v1/super-admin/users/${ids.root}/role`).set('x-csrf-token', root.csrf).send({ role: 'super_admin', permissions: ['chat:read_private'], reason: 'self' });
    expect(self.status).toBe(422);
    const grantPerm = await root.agent.patch(`/api/v1/super-admin/users/${ids.investigator}/role`).set('x-csrf-token', root.csrf).send({ role: 'super_admin', permissions: ['chat:read_private'], reason: 'Safeguarding lead' });
    expect(grantPerm.status, JSON.stringify(grantPerm.body)).toBe(200);
    const inv = await webLogin('investigator@srmap.edu.in');

    expect((await inv.agent.post('/api/v1/admin/chat-reviews').set('x-csrf-token', inv.csrf).send({ ...body, reason: 'too short' })).status).toBe(422);
    expect((await inv.agent.post('/api/v1/admin/chat-reviews').set('x-csrf-token', inv.csrf).send({ ...body, caseReference: '' })).status).toBe(422);
    const counsellingTry = await inv.agent.post('/api/v1/admin/chat-reviews').set('x-csrf-token', inv.csrf).send({ ...body, targetId: String(counselling._id) });
    expect(counsellingTry.body.error.code).toBe('counselling_restricted');
    await M.Session.updateMany({ userId: ids.investigator }, { $set: { reauthAt: new Date(0) } });
    expect((await inv.agent.post('/api/v1/admin/chat-reviews').set('x-csrf-token', inv.csrf).send(body)).body.error.code).toBe('reauth_required');
    await M.Session.updateMany({ userId: ids.investigator }, { $set: { reauthAt: new Date() } });
    const g = await inv.agent.post('/api/v1/admin/chat-reviews').set('x-csrf-token', inv.csrf).send(body);
    expect(g.status, JSON.stringify(g.body)).toBe(201);
    const grantId = g.body.data.id;

    const msgs = await inv.agent.get(`/api/v1/admin/chat-reviews/${grantId}/messages`);
    expect(msgs.status).toBe(200);
    expect(msgs.body.data.items.map((m: { body: string }) => m.body)).toEqual(['Someone keeps following me after class']);
    expect(JSON.stringify(msgs.body)).not.toContain('Unrelated private message');
    const accessed = await M.AuditLog.findOne({ action: 'chat_review.accessed' }).lean();
    expect(JSON.stringify(accessed)).not.toContain('following me'); // content never enters the audit log
    expect((await M.AuditLog.findOne({ action: 'chat_review.granted' }).lean())!.reason).toBe(body.reason);
    // Nobody else can use the grant, and there is no "all messages" endpoint.
    expect((await root.agent.get(`/api/v1/admin/chat-reviews/${grantId}/messages`)).status).toBe(403);
    expect((await root.agent.get('/api/v1/admin/chat-reviews')).body.data[0].targetLabel).toMatch(/Security desk/); // oversight sees metadata
    expect(JSON.stringify((await root.agent.get('/api/v1/admin/chat-reviews')).body)).not.toContain('following me');
    // Expiry is enforced in application logic, not only by a background sweep.
    await M.ChatReviewGrant.updateOne({ _id: grantId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await inv.agent.get(`/api/v1/admin/chat-reviews/${grantId}/messages`)).status).toBe(410);
    // Export is off by default.
    const g2 = await inv.agent.post('/api/v1/admin/chat-reviews').set('x-csrf-token', inv.csrf).send(body);
    expect((await inv.agent.post(`/api/v1/admin/chat-reviews/${g2.body.data.id}/export`).set('x-csrf-token', inv.csrf).send({})).body.error.code).toBe('export_disabled');
    // Revocation by a governance admin ends access at once.
    expect((await root.agent.post(`/api/v1/admin/chat-reviews/${g2.body.data.id}/revoke`).set('x-csrf-token', root.csrf).send({ note: 'Investigation closed' })).status).toBe(200);
    expect((await inv.agent.get(`/api/v1/admin/chat-reviews/${g2.body.data.id}/messages`)).status).toBe(410);
  });

  // ---------------------------------------------------------------- search, dashboard, audit chain
  it('console search respects permissions and never searches complaint text', async () => {
    await M.Incident.create({ caseNumber: 'CC-2026-777777', category: 'harassment', title: 'Secret title words', description: 'x'.repeat(40), incidentDate: new Date(), location: 'Lab', idempotencyKey: randomUUID() });
    const byText = await root.agent.get('/api/v1/admin/search?q=Secret title');
    expect(JSON.stringify(byText.body)).not.toContain('CC-2026-777777');
    const byNumber = await root.agent.get('/api/v1/admin/search?q=CC-2026-7777');
    expect(byNumber.body.data.incidents[0].title).toBe('CC-2026-777777');
    expect(JSON.stringify(byNumber.body)).not.toContain('Secret title');
    const triage = (await appLogin('triage@srmap.edu.in')).agent;
    const limited = await triage.get('/api/v1/admin/search?q=resp');
    expect(limited.body.data.alerts).toBeUndefined(); // admin role has no sos:dispatch
    expect((await student.get('/api/v1/admin/search?q=resp')).status).toBe(403);
    expect(JSON.stringify(await M.AuditLog.find({ action: 'console.search' }).lean())).not.toContain('Secret');
  });

  it('dashboard metrics come from the database and the audit chain still verifies', async () => {
    const r = await root.agent.get('/api/v1/admin/ops-overview');
    expect(r.status).toBe(200);
    expect(r.body.data.environment).toBe('test');
    expect(r.body.data.duty.staleThresholdSeconds).toBe(120);
    expect(typeof r.body.data.duty.stale).toBe('number');
    expect(r.body.data.security.replayBlocked7d).toBeGreaterThan(0);
    const { verifyAuditChain } = await import('../src/services/audit.service');
    const chain = await verifyAuditChain();
    const around = chain.brokenAtSeq ? await M.AuditLog.find({ seq: { $gte: chain.brokenAtSeq - 2, $lte: chain.brokenAtSeq + 1 } }).sort({ seq: 1 }).lean() : [];
    const seqs = (await M.AuditLog.find({}, { seq: 1 }).sort({ seq: 1 }).lean()).map((x) => x.seq);
    expect(chain.ok, JSON.stringify({ chain, around, missing: seqs.filter((x, i) => i > 0 && x !== seqs[i - 1]! + 1) })).toBe(true);
    expect(chain.checked).toBeGreaterThan(50);
    const entry = await M.AuditLog.findOne({ hv: 2 });
    await expect(M.AuditLog.updateOne({ _id: entry!._id }, { $set: { action: 'tampered' } })).rejects.toThrow(/append-only/);
    entry!.action = 'tampered';
    await expect(entry!.save()).rejects.toThrow(/append-only/);
  });

  it('validates duty and dispatch settings within limits', async () => {
    const bad = await root.agent.patch('/api/v1/super-admin/settings').set('x-csrf-token', root.csrf).send({ settings: { duty: { heartbeatIntervalSeconds: 90, staleThresholdSeconds: 120 } } });
    expect(bad.status).toBe(422);
    expect(bad.body.error.message).toMatch(/twice the heartbeat interval/);
    const good = await root.agent.patch('/api/v1/super-admin/settings').set('x-csrf-token', root.csrf).send({ settings: { duty: { heartbeatIntervalSeconds: 30, staleThresholdSeconds: 90 } } });
    expect(good.status, JSON.stringify(good.body)).toBe(200);
  });
});
