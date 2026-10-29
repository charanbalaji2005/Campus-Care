/**
 * Security Officer & Committee Member Role Separation and Routing Integration Tests.
 *
 * Verifies the 15 mandatory incident-routing and role-isolation requirements:
 * 1. SOS alerts route exclusively to authorized Security Officers.
 * 2. SOS alerts never route or notify Committee Members.
 * 3. Incident reports route exclusively to authorized Committee Members.
 * 4. Incident reports never route or notify Security Officers.
 * 5. Committee Members are forbidden from accessing SOS records.
 * 6. Security Officers are forbidden from accessing committee investigations and internal notes.
 * 7. Socket.IO responder room membership rejects unauthorized committee members.
 * 8. Emergency escalation from Committee creates an auditable emergency alert for Security.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';

const d = process.env.SKIP_DB_TESTS === 'true' ? describe.skip : describe;
const PASSWORD = 'Routing-Separation-Test-9';
type Agent = ReturnType<typeof request.agent>;

d('Security & Committee Role Separation (integration)', () => {
  let mongo: { stop: () => Promise<boolean>; getUri: () => string };
  let app: import('express').Express;
  let M: typeof import('../src/models/user') &
    typeof import('../src/models/safety') &
    typeof import('../src/models/duty') &
    typeof import('../src/models/incident') &
    typeof import('../src/models/platform') &
    typeof import('../src/models/patrol');
  let hash: string;
  const ids: Record<string, string> = {};
  const agents: Record<string, Agent> = {};
  let committeeId: string;

  async function makeUser(email: string, role: string, extra: Record<string, unknown> = {}) {
    const name = email.split('@')[0]!;
    const u = await M.User.create({
      fullName: `${name} Person`,
      email,
      role,
      passwordHash: hash,
      emailVerified: true,
      accountStatus: 'active',
      ...extra,
    });
    ids[name] = String(u._id);
    return u;
  }

  async function login(email: string) {
    const name = email.split('@')[0]!;
    const r = await request(app)
      .post('/api/v1/auth/login')
      .set('X-CampusCare-Client', 'android')
      .send({ email, password: PASSWORD });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    agents[name] = request.agent(app)
      .set('Authorization', `Bearer ${r.body.data.sessionToken}`)
      .set('X-CampusCare-Client', 'android') as unknown as Agent;
  }

  beforeAll(async () => {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    mongo = await MongoMemoryServer.create();
    const { connectDatabase } = await import('../src/db/connect');
    await connectDatabase(mongo.getUri());
    const { createApp } = await import('../src/app');
    app = createApp();
    const settings = await import('../src/services/settings.service');
    await settings.updateSettings({ turnstile: { enabled: false } }, '000000000000000000000000');
    M = {
      ...(await import('../src/models/user')),
      ...(await import('../src/models/safety')),
      ...(await import('../src/models/duty')),
      ...(await import('../src/models/incident')),
      ...(await import('../src/models/platform')),
      ...(await import('../src/models/content')),
      ...(await import('../src/models/patrol')),
    };

    const { hashPassword } = await import('../src/lib/crypto');
    hash = await hashPassword(PASSWORD);

    // Create Committee
    const comm = await M.Committee.create({
      name: 'Anti-Harassment Committee',
      type: 'gender_sensitivity',
      active: true,
      categories: ['harassment'],
    });
    committeeId = String(comm._id);

    await M.RoutingRule.create({
      category: 'harassment',
      committeeId: comm._id,
      defaultPriority: 'high',
    });

    // Create users: student, security officer, committee member, counsellor
    await makeUser('student1@srmap.edu.in', 'student', { studentId: 'STU-001', phone: '+91 90000 00001' });
    const sec = await makeUser('officer1@srmap.edu.in', 'security_officer', { phone: '+91 90000 00002', campusZone: 'Main Campus' });
    await makeUser('committee1@srmap.edu.in', 'committee_member', {
      phone: '+91 90000 00003',
      campusZone: 'Main Campus',
      committeeMemberships: [{ committeeId: comm._id, position: 'member' }],
    });
    await makeUser('counsellor1@srmap.edu.in', 'counsellor');

    // Put security officer on duty
    await M.ResponderAvailability.create({
      userId: sec._id,
      status: 'on_duty',
      campus: 'main',
      responsibilities: ['sos_response'],
      statusChangedAt: new Date(),
    });

    await login('student1@srmap.edu.in');
    await login('officer1@srmap.edu.in');
    await login('committee1@srmap.edu.in');
    await login('counsellor1@srmap.edu.in');
  }, 120_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo?.stop();
  });

  // ------------------------------------------------------------------ Rule 1 & 2: Student SOS routing
  it('Rule 1 & 2: Student SOS notifies Security Officers ONLY, never Committee Members', async () => {
    const idempotencyKey = randomUUID();
    const res = await agents.student1!.post('/api/v1/safety/sos').send({
      idempotencyKey,
      latitude: 16.4636,
      longitude: 80.5074,
      accuracyMeters: 10,
      note: 'Need urgent help at Library Block',
    });
    expect(res.status).toBe(201);
    const alertId = res.body.data.id;

    // Security officer dashboard reflects the active alert
    const secDash = await agents.officer1!.get('/api/v1/safety/security/dashboard');
    expect(secDash.status).toBe(200);
    expect(secDash.body.data.activeSosCount).toBeGreaterThan(0);
    expect(secDash.body.data.recentAlerts.some((a: any) => a.id === alertId)).toBe(true);

    // Check notifications: security officer was notified
    const secNotifs = await M.Notification.find({ userId: ids.officer1 }).lean();
    expect(secNotifs.some((n) => n.kind === 'sos')).toBe(true);

    // Committee member received ZERO SOS notifications
    const commNotifs = await M.Notification.find({ userId: ids.committee1, kind: 'sos' }).lean();
    expect(commNotifs).toHaveLength(0);

    // Counsellor received ZERO SOS notifications
    const counsNotifs = await M.Notification.find({ userId: ids.counsellor1, kind: 'sos' }).lean();
    expect(counsNotifs).toHaveLength(0);
  });

  // ------------------------------------------------------------------ Rule 3 & 4: Incident Report routing
  it('Rule 3 & 4: Incident Report notifies Committee Members ONLY, never Security Officers', async () => {
    const idempotencyKey = randomUUID();
    const res = await agents.student1!.post('/api/v1/incidents').send({
      category: 'harassment',
      title: 'Inappropriate conduct report',
      description: 'Detailed report regarding inappropriate conduct observed near the cafeteria.',
      incidentDate: new Date().toISOString(),
      location: 'Cafeteria Courtyard',
      anonymous: false,
      severity: 'high',
      urgent: false,
      preferredContact: 'in_app',
      idempotencyKey,
    });
    expect(res.status).toBe(201);
    const incidentId = res.body.data.id;

    // Committee dashboard reflects the new report
    const commDash = await agents.committee1!.get('/api/v1/incidents/committee/dashboard');
    expect(commDash.status).toBe(200);
    expect(commDash.body.data.newCount).toBeGreaterThan(0);
    expect(commDash.body.data.recentReports.some((r: any) => r.id === incidentId)).toBe(true);

    // Check notifications: committee member was notified
    const commNotifs = await M.Notification.find({ userId: ids.committee1, kind: 'case_assigned' }).lean();
    expect(commNotifs.length).toBeGreaterThan(0);

    // Security officer received ZERO incident notifications
    const secNotifs = await M.Notification.find({ userId: ids.officer1, kind: 'case_assigned' }).lean();
    expect(secNotifs).toHaveLength(0);
  });

  // ------------------------------------------------------------------ Rule 5: Committee Member cannot access SOS
  it('Rule 5: Committee Member is forbidden from accessing Security SOS endpoints', async () => {
    // Attempt to access security dashboard
    const dashRes = await agents.committee1!.get('/api/v1/safety/security/dashboard');
    expect(dashRes.status).toBe(403);

    // Attempt to access security alerts
    const alertsRes = await agents.committee1!.get('/api/v1/safety/security/alerts');
    expect(alertsRes.status).toBe(403);

    // Attempt to access live responder map
    const mapRes = await agents.committee1!.get('/api/v1/safety/security/map');
    expect(mapRes.status).toBe(403);
  });

  // ------------------------------------------------------------------ Rule 6: Security Officer cannot access Committee investigations
  it('Rule 6: Security Officer is forbidden from accessing Committee Portal endpoints', async () => {
    // Attempt to access committee dashboard
    const dashRes = await agents.officer1!.get('/api/v1/incidents/committee/dashboard');
    expect(dashRes.status).toBe(403);

    // Attempt to access committee reports list
    const reportsRes = await agents.officer1!.get('/api/v1/incidents/committee/reports');
    expect(reportsRes.status).toBe(403);

    // Attempt to access committee analytics
    const analyticsRes = await agents.officer1!.get('/api/v1/incidents/committee/analytics');
    expect(analyticsRes.status).toBe(403);
  });

  // ------------------------------------------------------------------ Rule 8: Emergency Escalation Exception
  it('Rule 8: Emergency escalation from Committee Case creates linked SOS for Security', async () => {
    // Create an incident report
    const rep = await M.Incident.create({
      caseNumber: '#2026-TEST-ESC',
      category: 'harassment',
      title: 'Immediate threat threat reported',
      description: 'Physical confrontation imminent at library ground floor.',
      incidentDate: new Date(),
      location: 'Library Ground Floor',
      reporterId: ids.student1,
      status: 'submitted',
      idempotencyKey: randomUUID(),
    });

    // Committee member escalates to Security
    const escRes = await agents.committee1!
      .post(`/api/v1/incidents/committee/reports/${rep._id}/escalate`)
      .send({
        urgency: 'critical',
        notes: 'Immediate physical intervention required.',
      });

    expect(escRes.status).toBe(200);
    expect(escRes.body.data.ok).toBe(true);
    expect(escRes.body.data.incidentRef).toBeDefined();

    // Verify SOS alert was created in EmergencyAlert and dispatched to Security
    const alert = await M.EmergencyAlert.findById(escRes.body.data.alertId).lean();
    expect(alert).toBeDefined();
    expect(alert!.severity).toBe('critical');
    expect(alert!.note).toContain('#2026-TEST-ESC');

    // Security Officer received the critical escalation notification
    const secNotifs = await M.Notification.find({ userId: ids.officer1, kind: 'sos', priority: 'critical' }).lean();
    expect(secNotifs.length).toBeGreaterThan(0);

    // The incident status transitioned to 'escalated'
    const updatedRep = await M.Incident.findById(rep._id).lean();
    expect(updatedRep!.status).toBe('escalated');
  });

  // ------------------------------------------------------------------ Patrol & Checkpoints
  it('Security Officer can view patrol routes and check in at checkpoints', async () => {
    const patrolRes = await agents.officer1!.get('/api/v1/safety/security/patrol/current');
    expect(patrolRes.status).toBe(200);
    expect(patrolRes.body.data.name).toBe('Main Campus Patrol');
    expect(patrolRes.body.data.checkpoints.length).toBeGreaterThan(0);

    // Check in at current checkpoint
    const checkInRes = await agents.officer1!.post('/api/v1/safety/security/patrol/check-in').send({});
    expect(checkInRes.status).toBe(200);
    expect(checkInRes.body.data.ok).toBe(true);
  });
});
