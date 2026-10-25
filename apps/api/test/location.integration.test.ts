/**
 * Location integration tests: live SOS location, server-side quality, ordering and duplicates,
 * auditable history access, live-share lifecycle and the no-location escalation note.
 * Runs against a private in-memory MongoDB (never the database in .env). SKIP_DB_TESTS=true skips.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { classifyLocationQuality, coordinateDecimals, formatCoordinate } from '@campuscare/shared';

const d = process.env.SKIP_DB_TESTS === 'true' ? describe.skip : describe;
const PASSWORD = 'Location-Test-9';
type Agent = ReturnType<typeof request.agent>;
const API = '/api/v1';
const SAFETY = `${API}/safety`;

describe('location quality (shared)', () => {
  it('classifies by reported accuracy and freshness, never inventing precision', () => {
    const q = (accuracyMeters: number | null, ageSeconds = 0) => classifyLocationQuality({ accuracyMeters, ageSeconds }, { staleSeconds: 60 });
    expect(q(8)).toBe('high');
    expect(q(15)).toBe('high');
    expect(q(15.5)).toBe('usable');
    expect(q(40)).toBe('usable');
    expect(q(70)).toBe('low');
    expect(q(250)).toBe('poor');
    expect(q(null)).toBe('unknown');
    expect(q(5, 61)).toBe('stale'); // an old fix is stale however accurate it was
    expect(coordinateDecimals(3)).toBe(5);
    expect(coordinateDecimals(30)).toBe(4);
    expect(coordinateDecimals(500)).toBe(3);
    expect(formatCoordinate(16.4636123, 80.5074123, 250)).toBe('16.464, 80.507');
  });
});

d('Live SOS location, history and shares (integration)', () => {
  let mongo: { stop: () => Promise<boolean>; getUri: () => string };
  let app: import('express').Express;
  let Safety: typeof import('../src/models/safety');
  let hash: string;
  let stuA: Agent; let stuB: Agent; let officer: Agent; let mod: Agent;
  const ids: Record<string, string> = {};

  async function appLogin(email: string) {
    const r = await request(app).post(`${API}/auth/login`).set('X-CampusCare-Client', 'android').send({ email, password: PASSWORD });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return request.agent(app).set('Authorization', `Bearer ${r.body.data.sessionToken}`).set('X-CampusCare-Client', 'android') as unknown as Agent;
  }
  async function raise(agent: Agent, body: Record<string, unknown> = {}) {
    const r = await agent.post(`${SAFETY}/sos`).send({ idempotencyKey: randomUUID(), notifyTrustedContacts: false, ...body });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.data as { id: string; [k: string]: unknown };
  }
  const fix = (o: Record<string, unknown> = {}) => ({ latitude: 16.4636, longitude: 80.5074, accuracyMeters: 9, locationAgeSeconds: 1, source: 'fused', ...o });

  beforeAll(async () => {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    mongo = await MongoMemoryServer.create();
    const { connectDatabase } = await import('../src/db/connect');
    await connectDatabase(mongo.getUri());
    app = (await import('../src/app')).createApp();
    Safety = await import('../src/models/safety');
    const { User } = await import('../src/models/user');
    for (const name of mongoose.modelNames()) await mongoose.model(name).syncIndexes();
    const settings = await import('../src/services/settings.service');
    await settings.updateSettings({ turnstile: { enabled: false } }, '000000000000000000000000');
    hash = await (await import('../src/lib/crypto')).hashPassword(PASSWORD);
    for (const [email, role] of [['loc-a@srmap.edu.in', 'student'], ['loc-b@srmap.edu.in', 'student'], ['loc-sec@srmap.edu.in', 'security_officer'], ['loc-mod@srmap.edu.in', 'moderator']] as const) {
      const u = await User.create({ fullName: email.split('@')[0], email, role, passwordHash: hash, emailVerified: true, accountStatus: 'active' });
      ids[email.split('@')[0]!] = String(u._id);
    }
    [stuA, stuB, officer, mod] = await Promise.all(['loc-a', 'loc-b', 'loc-sec', 'loc-mod'].map((n) => appLogin(`${n}@srmap.edu.in`)));
  }, 180_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo?.stop();
  });

  it('records the fix an SOS was raised with as the first history point, once', async () => {
    const key = randomUUID();
    const a = await raise(stuA, { idempotencyKey: key, ...fix({ accuracyMeters: 12 }) });
    expect(a.locationQuality).toBe('high');
    // A retry after a dropped connection returns the same alert and adds no second point.
    const again = await stuA.post(`${SAFETY}/sos`).send({ idempotencyKey: key, notifyTrustedContacts: false, ...fix({ accuracyMeters: 12 }) });
    expect(again.body.data.id).toBe(a.id);
    expect(await Safety.LocationPoint.countDocuments({ subjectType: 'sos', subjectId: a.id })).toBe(1);
    await stuA.post(`${SAFETY}/sos/${a.id}/cancel`).send({});
  });

  it('accepts live updates from the owner only, computes quality itself and keeps points ordered', async () => {
    const a = await raise(stuA, { locationUnavailableReason: 'no_fix' });
    expect(a.locationAvailable).toBe(false);

    // The client claims "high" for a 150 m fix: the server labels it poor.
    const first = await stuA.post(`${SAFETY}/sos/${a.id}/location`).send(fix({ accuracyMeters: 150, clientQuality: 'high', clientSeq: 1 }));
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.data).toMatchObject({ accepted: true, quality: 'poor' });
    let doc = await Safety.EmergencyAlert.findById(a.id).lean();
    expect(doc!.locationQuality).toBe('poor');
    expect(doc!.events.some((e) => e.type === 'location_received')).toBe(true);

    // A better fix replaces it.
    const better = await stuA.post(`${SAFETY}/sos/${a.id}/location`).send(fix({ latitude: 16.4637, accuracyMeters: 8, clientSeq: 2 }));
    expect(better.body.data).toMatchObject({ accepted: true, quality: 'high' });

    // Retrying the same sequence number is a no-op.
    const dup = await stuA.post(`${SAFETY}/sos/${a.id}/location`).send(fix({ latitude: 16.4637, accuracyMeters: 8, clientSeq: 2 }));
    expect(dup.body.data.duplicate).toBe(true);

    // A queued point captured earlier than the current one arrives late: kept in history, not used as current.
    const late = await stuA.post(`${SAFETY}/sos/${a.id}/location`).send(fix({ latitude: 16.5, accuracyMeters: 5, locationAgeSeconds: 120, clientSeq: 3 }));
    expect(late.body.data).toMatchObject({ accepted: false, outOfOrder: true });
    doc = await Safety.EmergencyAlert.findById(a.id).lean();
    expect(doc!.latitude).toBe(16.4637);
    expect(await Safety.LocationPoint.countDocuments({ subjectType: 'sos', subjectId: a.id })).toBe(3);

    // Invalid coordinates are rejected.
    expect((await stuA.post(`${SAFETY}/sos/${a.id}/location`).send(fix({ latitude: 91 }))).status).toBe(422);
    expect((await stuA.post(`${SAFETY}/sos/${a.id}/location`).send(fix({ longitude: 'abc' }))).status).toBe(422);
    expect((await stuA.post(`${SAFETY}/sos/${a.id}/location`).send(fix({ accuracyMeters: -1 }))).status).toBe(422);

    // Nobody else can write the student's location.
    expect((await stuB.post(`${SAFETY}/sos/${a.id}/location`).send(fix({ clientSeq: 9 }))).status).toBe(404);
    expect((await officer.post(`${SAFETY}/sos/${a.id}/location`).send(fix({ clientSeq: 9 }))).status).toBe(403);
    // Unauthenticated: refused (CSRF check or auth, depending on the client headers).
    expect([401, 403]).toContain((await request(app).post(`${SAFETY}/sos/${a.id}/location`).send(fix())).status);
    expect((await request(app).post(`${SAFETY}/sos/${a.id}/location`).set('X-CampusCare-Client', 'android').send(fix())).status).toBe(401);
    ids.liveAlert = a.id;
  });

  it('gives the time-ordered track only to responders, auditing every read', async () => {
    const id = ids.liveAlert!;
    const track = await officer.get(`${SAFETY}/responder/alerts/${id}/track`);
    expect(track.status, JSON.stringify(track.body)).toBe(200);
    const pts = track.body.data as { capturedAt: string; outOfOrder: boolean; measured: boolean; quality: string }[];
    expect(pts).toHaveLength(3);
    const times = pts.map((p) => new Date(p.capturedAt).getTime());
    expect([...times].sort((x, y) => x - y)).toEqual(times);
    expect(pts.some((p) => p.outOfOrder)).toBe(true);
    expect(pts.every((p) => p.measured)).toBe(true);
    expect(await Safety.LocationAccessAudit.countDocuments({ subjectId: id, viewerId: ids['loc-sec'] })).toBeGreaterThan(0);
    // The student, other students and moderators cannot read the history.
    for (const agent of [stuA, stuB, mod]) expect((await agent.get(`${SAFETY}/responder/alerts/${id}/track`)).status).toBe(404);
  });

  it('stops accepting location once the SOS is closed', async () => {
    const id = ids.liveAlert!;
    expect((await stuA.post(`${SAFETY}/sos/${id}/cancel`).send({})).status).toBe(200);
    const after = await stuA.post(`${SAFETY}/sos/${id}/location`).send(fix({ clientSeq: 10 }));
    expect(after.status).toBe(410);
  });

  it('notes an SOS that has no location 90 s after dispatch, once, for responders only', async () => {
    const a = await raise(stuB, { locationUnavailableReason: 'permission_denied' });
    await Safety.EmergencyAlert.updateOne({ _id: a.id }, { $set: { dispatchedAt: new Date(Date.now() - 120_000), status: 'sent' } });
    const { flagSosWithoutLocation } = await import('../src/services/location.service');
    await flagSosWithoutLocation();
    await flagSosWithoutLocation();
    const doc = await Safety.EmergencyAlert.findById(a.id).lean();
    const notes = doc!.events.filter((e) => e.type === 'location_unavailable');
    expect(notes).toHaveLength(1);
    expect(notes[0]!.studentVisible).toBe(false);
    await stuB.post(`${SAFETY}/sos/${a.id}/cancel`).send({});
  });

  it('runs a live share with quality, ordering, owner-only updates and a hard stop', async () => {
    const start = await stuA.post(`${SAFETY}/location-share`).send({ durationMinutes: 30, audience: 'security', ...fix({ accuracyMeters: 30 }) });
    expect(start.status, JSON.stringify(start.body)).toBe(201);
    const id = start.body.data.id as string;
    let share = await Safety.LocationShare.findById(id).lean();
    expect(share!.locationQuality).toBe('usable');

    // Another user cannot push into it.
    expect((await stuB.patch(`${SAFETY}/location-share/${id}`).send(fix({ clientSeq: 1 }))).status).toBe(410);

    // A late (older) point after a newer one does not replace the current position.
    await Safety.LocationShare.updateOne({ _id: id }, { $set: { updatedAt: new Date(Date.now() - 10_000) } }, { timestamps: false });
    expect((await stuA.patch(`${SAFETY}/location-share/${id}`).send(fix({ latitude: 16.47, accuracyMeters: 6, clientSeq: 2 }))).status).toBe(200);
    await Safety.LocationShare.updateOne({ _id: id }, { $set: { updatedAt: new Date(Date.now() - 10_000) } }, { timestamps: false });
    expect((await stuA.patch(`${SAFETY}/location-share/${id}`).send(fix({ latitude: 16.9, accuracyMeters: 6, locationAgeSeconds: 300, clientSeq: 3 }))).status).toBe(200);
    share = await Safety.LocationShare.findById(id).lean();
    expect(share!.latitude).toBe(16.47);
    expect(share!.locationQuality).toBe('high');
    const points = await Safety.LocationPoint.find({ subjectType: 'share', subjectId: id }).lean();
    expect(points.length).toBe(3);
    expect(points.every((p) => p.purgeAt.getTime() === share!.purgeAt.getTime())).toBe(true);

    // Stopping ends the session: further updates are refused and responders no longer get it.
    expect((await stuA.post(`${SAFETY}/location-share/${id}/stop`).send({})).status).toBe(200);
    expect((await stuA.patch(`${SAFETY}/location-share/${id}`).send(fix({ clientSeq: 4 }))).status).toBe(410);
    const visible = await officer.get(`${SAFETY}/responder/locations`);
    expect((visible.body.data as { id: string }[]).map((x) => x.id)).not.toContain(id);
  });
});
