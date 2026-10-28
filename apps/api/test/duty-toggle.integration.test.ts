/**
 * The officer's On duty / Off duty switch, end to end on the server: PATCH /responders/me/duty-status
 * and the shift start it falls back to, what is persisted (ResponderAvailability, DutyStatusEvent,
 * audit log) and what SOS dispatch does with the result.
 * Runs against a private in-memory MongoDB (never the database in .env). Set SKIP_DB_TESTS=true to skip.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';

const d = process.env.SKIP_DB_TESTS === 'true' ? describe.skip : describe;
const PASSWORD = 'Duty-Toggle-Test-9';
type Agent = ReturnType<typeof request.agent>;

d('Responder duty toggle (integration)', () => {
  let mongo: { stop: () => Promise<boolean>; getUri: () => string };
  let app: import('express').Express;
  let M: typeof import('../src/models/user') & typeof import('../src/models/safety') & typeof import('../src/models/duty') & typeof import('../src/models/platform');
  let settings: typeof import('../src/services/settings.service');
  let hash: string;
  const ids: Record<string, string> = {};
  let officer: Agent;
  let student: Agent;
  let rootId: string;

  async function makeUser(email: string, role: string, extra: Record<string, unknown> = {}) {
    const u = await M.User.create({ fullName: email.split('@')[0], email, role, passwordHash: hash, emailVerified: true, accountStatus: 'active', ...extra });
    ids[email.split('@')[0]!] = String(u._id);
    return u;
  }
  async function appLogin(email: string) {
    const r = await request(app).post('/api/v1/auth/login').set('X-CampusCare-Client', 'android').send({ email, password: PASSWORD });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return request.agent(app).set('Authorization', `Bearer ${r.body.data.sessionToken}`).set('X-CampusCare-Client', 'android') as unknown as Agent;
  }
  const setDuty = (agent: Agent, status: string, extra: Record<string, unknown> = {}) => agent.patch('/api/v1/responders/me/duty-status').send({ status, ...extra });
  const avail = () => M.ResponderAvailability.findOne({ userId: ids.guard }).lean();
  const events = () => M.DutyStatusEvent.find({ userId: ids.guard }).sort({ createdAt: 1 }).lean();
  async function raise() {
    const r = await student.post('/api/v1/safety/sos').send({ idempotencyKey: randomUUID(), latitude: 16.4636, longitude: 80.5074, accuracyMeters: 15 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.data.id as string;
  }
  async function closeAll() {
    await M.AlertAssignment.updateMany({ open: true }, { $set: { open: false, status: 'completed' } });
    await M.EmergencyAlert.updateMany({ status: { $nin: ['resolved', 'cancelled'] } }, { $set: { status: 'resolved', resolvedAt: new Date() } });
    await M.ResponderAvailability.updateMany({}, { $set: { activeAssignmentCount: 0 } });
  }

  beforeAll(async () => {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    mongo = await MongoMemoryServer.create();
    const { connectDatabase } = await import('../src/db/connect');
    await connectDatabase(mongo.getUri());
    const { createApp } = await import('../src/app');
    app = createApp();
    M = { ...(await import('../src/models/user')), ...(await import('../src/models/safety')), ...(await import('../src/models/duty')), ...(await import('../src/models/platform')) };
    settings = await import('../src/services/settings.service');
    for (const name of mongoose.modelNames()) await mongoose.model(name).syncIndexes();
    rootId = '000000000000000000000000';
    await settings.updateSettings({ turnstile: { enabled: false }, sos: { countdownSeconds: 3 }, duty: { allowDutyWithoutShift: false } }, rootId);
    const { hashPassword } = await import('../src/lib/crypto');
    hash = await hashPassword(PASSWORD);
    await makeUser('guard@srmap.edu.in', 'security_officer');
    await makeUser('learner@srmap.edu.in', 'student', { studentId: 'DUTY-1', phone: '+91 90000 00009' });
    officer = await appLogin('guard@srmap.edu.in');
    student = await appLogin('learner@srmap.edu.in');
  }, 120_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo?.stop();
  });

  it('refuses status changes without a session or without the responder permission', async () => {
    expect((await request(app).patch('/api/v1/responders/me/duty-status').set('X-CampusCare-Client', 'android').send({ status: 'on_duty' })).status).toBe(401);
    expect((await setDuty(student, 'on_duty')).status).toBe(403);
    expect((await student.get('/api/v1/responders/me/duty')).status).toBe(403);
    expect((await setDuty(officer, 'responding')).status).toBe(422); // system-only state
  });

  it('refuses On duty without a shift when policy requires one, and persists nothing', async () => {
    const r = await setDuty(officer, 'on_duty');
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('shift_required');
    expect((await officer.get('/api/v1/responders/me/duty')).body.data.availability.status).toBe('off_duty');
    expect(await events()).toHaveLength(0);
    expect((await officer.post('/api/v1/responders/me/heartbeat').send({})).body.error.code).toBe('not_on_duty');
  });

  it('goes on duty by starting an accepted shift; the status, event and audit are persisted and dispatch offers SOS to the officer', async () => {
    const shift = await M.DutyShift.create({
      responderId: ids.guard, campus: 'main', startAt: new Date(Date.now() - 5 * 60_000), endAt: new Date(Date.now() + 3 * 3600_000),
      status: 'accepted', createdBy: rootId, acceptedAt: new Date(),
    });
    ids.shift = String(shift._id);
    const overview = (await officer.get('/api/v1/responders/me/duty')).body.data;
    expect(overview.policy.allowDutyWithoutShift).toBe(false);
    expect(overview.shifts.map((s: { id: string; status: string }) => [s.id, s.status])).toContainEqual([ids.shift, 'accepted']);

    const started = await officer.post(`/api/v1/responders/me/shifts/${ids.shift}/start`);
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    const a = await avail();
    expect(a!.status).toBe('on_duty');
    expect(String(a!.currentShiftId)).toBe(ids.shift);
    expect(a!.lastHeartbeatAt).not.toBeNull(); // the request itself proves the phone is reachable
    expect((await events()).map((e) => [e.from, e.to, e.actor])).toEqual([['off_duty', 'on_duty', 'self']]);
    expect(await M.AuditLog.countDocuments({ action: 'duty.status_changed', targetId: ids.guard })).toBe(1);
    expect((await officer.post('/api/v1/responders/me/heartbeat').send({})).body.data.status).toBe('on_duty');

    const alertId = await raise();
    const open = await M.AlertAssignment.find({ alertId, open: true }).lean();
    expect(open.map((x) => String(x.responderId))).toEqual([ids.guard]);
    await closeAll();
  });

  it('goes off duty: persisted with an event and audit, heartbeats stop being accepted, and new SOS skip the officer', async () => {
    const r = await setDuty(officer, 'off_duty', { reason: 'End of patrol' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.status).toBe('off_duty');
    const a = await avail();
    expect(a!.status).toBe('off_duty');
    expect(a!.currentShiftId).toBeNull();
    const last = (await events()).at(-1)!;
    expect([last.from, last.to, last.reason]).toEqual(['on_duty', 'off_duty', 'End of patrol']);
    expect(await M.AuditLog.countDocuments({ action: 'duty.status_changed', targetId: ids.guard })).toBe(2);
    expect((await officer.post('/api/v1/responders/me/heartbeat').send({})).body.error.code).toBe('not_on_duty');

    const alertId = await raise();
    expect(await M.AlertAssignment.countDocuments({ alertId, responderId: ids.guard })).toBe(0);
    expect((await M.EmergencyAlert.findById(alertId).lean())!.assignmentState).toBe('unassigned');
    await closeAll();
  });

  it('goes back on duty with the switch inside the running shift (no shiftId needed) and repeated taps change nothing twice', async () => {
    const before = (await events()).length;
    const [x, y] = await Promise.all([setDuty(officer, 'on_duty'), setDuty(officer, 'on_duty')]);
    expect([x.status, y.status]).toEqual([200, 200]);
    expect(x.body.data.status).toBe('on_duty');
    expect(y.body.data.status).toBe('on_duty');
    expect((await events()).length).toBe(before + 1); // compare-and-set: exactly one transition recorded
    expect(String((await avail())!.currentShiftId)).toBe(ids.shift);
    expect((await setDuty(officer, 'on_duty')).status).toBe(200); // already on duty: no-op
    expect((await events()).length).toBe(before + 1);
  });

  it('keeps an officer with an active SOS on duty and the assignment intact when they try to go off duty', async () => {
    const alertId = await raise();
    expect(await M.AlertAssignment.countDocuments({ alertId, responderId: ids.guard, open: true })).toBe(1);
    const r = await setDuty(officer, 'off_duty');
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('open_assignments');
    expect((await avail())!.status).toBe('on_duty');
    expect((await avail())!.activeAssignmentCount).toBe(1);
    expect(await M.AlertAssignment.countDocuments({ alertId, responderId: ids.guard, open: true })).toBe(1);
    await closeAll();
    expect((await setDuty(officer, 'off_duty')).status).toBe(200);
  });

  it('lets the switch go on duty directly when the policy allows duty without a shift', async () => {
    await M.DutyShift.updateMany({ responderId: ids.guard }, { $set: { status: 'completed', endedAt: new Date() } });
    expect((await setDuty(officer, 'on_duty')).body.error.code).toBe('shift_required');
    await settings.updateSettings({ duty: { allowDutyWithoutShift: true } }, rootId);
    try {
      const r = await setDuty(officer, 'on_duty');
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect((await avail())!.status).toBe('on_duty');
      expect((await avail())!.currentShiftId).toBeNull();
      expect((await setDuty(officer, 'off_duty')).status).toBe(200);
    } finally {
      await settings.updateSettings({ duty: { allowDutyWithoutShift: false } }, rootId);
    }
  });
});
