/**
 * SOS quick trigger (server countdown) integration tests: trigger source, trusted-contact choice,
 * countdown-only cancel, offline cancellations, idempotent retries and the Super Admin settings.
 * Always runs against a private in-memory MongoDB. Set SKIP_DB_TESTS=true to skip.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';

const d = process.env.SKIP_DB_TESTS === 'true' ? describe.skip : describe;
const PASSWORD = 'Quick-Trigger-7';
type Agent = ReturnType<typeof request.agent>;

d('SOS quick trigger (integration)', () => {
  let mongo: { stop: () => Promise<boolean>; getUri: () => string };
  let app: import('express').Express;
  let M: typeof import('../src/models/user') & typeof import('../src/models/safety') & typeof import('../src/models/platform');
  let safety: typeof import('../src/services/safety.service');
  let settings: typeof import('../src/services/settings.service');
  let student: Agent;

  const raise = (body: Record<string, unknown>) => student.post('/api/v1/safety/sos').send({ latitude: 16.4636, longitude: 80.5074, accuracyMeters: 12, ...body });

  beforeAll(async () => {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    mongo = await MongoMemoryServer.create();
    const { connectDatabase } = await import('../src/db/connect');
    await connectDatabase(mongo.getUri());
    const { createApp } = await import('../src/app');
    app = createApp();
    M = { ...(await import('../src/models/user')), ...(await import('../src/models/safety')), ...(await import('../src/models/platform')) };
    safety = await import('../src/services/safety.service');
    settings = await import('../src/services/settings.service');
    for (const name of mongoose.modelNames()) await mongoose.model(name).syncIndexes();
    await settings.updateSettings({ turnstile: { enabled: false }, sos: { countdownSeconds: 10 } }, '000000000000000000000000');
    const { hashPassword } = await import('../src/lib/crypto');
    await M.User.create({ fullName: 'Quick', email: 'quick@srmap.edu.in', role: 'student', passwordHash: await hashPassword(PASSWORD), emailVerified: true, accountStatus: 'active', studentId: 'QT-1' });
    const r = await request(app).post('/api/v1/auth/login').set('X-CampusCare-Client', 'android').send({ email: 'quick@srmap.edu.in', password: PASSWORD });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    student = request.agent(app).set('Authorization', `Bearer ${r.body.data.sessionToken}`).set('X-CampusCare-Client', 'android') as unknown as Agent;
  }, 120_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo?.stop();
  });

  it('a quick trigger is held server-side for the configured countdown, never a client-chosen one', async () => {
    const before = Date.now();
    const r = await raise({ idempotencyKey: randomUUID(), countdownMode: 'server', triggerSource: 'quick_tile', countdownSeconds: 1 });
    expect(r.status).toBe(201);
    expect(r.body.data.status).toBe('pending');
    expect(r.body.data.triggerSource).toBe('quick_tile');
    const dueIn = new Date(r.body.data.dispatchAt).getTime() - before;
    expect(dueIn).toBeGreaterThanOrEqual(9_000); // 10 s from settings; the extra client field is ignored
    expect(dueIn).toBeLessThan(15_000);
    await student.post(`/api/v1/safety/sos/${r.body.data.id}/cancel`).send({ onlyIfPending: true });
  });

  it('keeps the student’s “do not notify trusted contacts” choice when the server countdown dispatches', async () => {
    const r = await raise({ idempotencyKey: randomUUID(), countdownMode: 'server', notifyTrustedContacts: false });
    const id = r.body.data.id as string;
    await safety.dispatchSos(id, { force: true });
    expect(await M.Job.countDocuments({ type: 'sos.trusted_contacts', 'payload.alertId': id })).toBe(0);
    expect(await M.Job.countDocuments({ type: 'sos.deliver', 'payload.alertId': id })).toBe(1);
    await M.EmergencyAlert.updateOne({ _id: id }, { $set: { status: 'resolved', resolvedAt: new Date() } });
  });

  it('the countdown Cancel never retracts an alert that was already dispatched', async () => {
    const r = await raise({ idempotencyKey: randomUUID(), countdownMode: 'server' });
    const id = r.body.data.id as string;
    await student.post(`/api/v1/safety/sos/${id}/dispatch-now`).send({});
    const c = await student.post(`/api/v1/safety/sos/${id}/cancel`).send({ onlyIfPending: true });
    expect(c.status).toBe(409);
    expect(c.body.error.code).toBe('already_dispatched');
    const a = await M.EmergencyAlert.findById(id).lean();
    expect(a!.status).not.toBe('cancelled');
    expect(a!.events.map((e) => e.type)).not.toContain('cancelled_after_dispatch');
    await M.EmergencyAlert.updateOne({ _id: id }, { $set: { status: 'resolved', resolvedAt: new Date() } });
  });

  it('records a countdown cancelled offline, and cancels its alert if that request did reach the server', async () => {
    const offline = randomUUID();
    const r1 = await student.post('/api/v1/safety/sos/countdown-cancelled').send({ eventId: offline, triggerSource: 'shortcut', triggeredAt: new Date().toISOString() });
    expect(r1.body.data).toEqual({ recorded: true, alertCancelled: false });
    expect(await M.AuditLog.countDocuments({ action: 'sos.countdown_cancelled' })).toBe(1);

    const reached = randomUUID();
    const created = await raise({ idempotencyKey: reached, countdownMode: 'server' });
    const r2 = await student.post('/api/v1/safety/sos/countdown-cancelled').send({ eventId: reached });
    expect(r2.body.data).toEqual({ recorded: true, alertCancelled: true });
    expect((await M.EmergencyAlert.findById(created.body.data.id).lean())!.status).toBe('cancelled');
  });

  it('an offline retry of the same event never creates a second alert', async () => {
    const key = randomUUID();
    const first = await raise({ idempotencyKey: key, countdownMode: 'server' });
    const retry = await raise({ idempotencyKey: key, countdownMode: 'client' });
    expect(retry.body.data.id).toBe(first.body.data.id);
    expect(await M.EmergencyAlert.countDocuments({ idempotencyKey: key })).toBe(1);
    await student.post(`/api/v1/safety/sos/${first.body.data.id}/cancel`).send({ onlyIfPending: true });
  });

  it('validates the Super Admin quick-trigger settings and publishes them to the app', async () => {
    await expect(settings.updateSettings({ sos: { countdownSeconds: 2 } }, '000000000000000000000000')).rejects.toThrow();
    await expect(settings.updateSettings({ sos: { countdownSeconds: 31 } }, '000000000000000000000000')).rejects.toThrow();
    await expect(settings.updateSettings({ sos: { quickTriggerMessage: '   ' } }, '000000000000000000000000')).rejects.toThrow();
    await expect(settings.updateSettings({ sos: { quickTriggerMessage: 'x'.repeat(161) } }, '000000000000000000000000')).rejects.toThrow();
    await settings.updateSettings({ sos: { countdownSeconds: 15, quickTriggerEnabled: false, quickTriggerMessage: 'Help is on the way unless you cancel.' } }, '000000000000000000000000');
    const pub = await request(app).get('/api/v1/auth/public-settings');
    expect(pub.body.data.sos).toMatchObject({ countdownSeconds: 15, quickTriggerEnabled: false, quickTriggerMessage: 'Help is on the way unless you cancel.' });
  });
});
