/**
 * CampusCare College — Campus Admin portal: metric accuracy, campus scoping, least privilege for SOS,
 * reports, counselling, students, security, committees, analytics, announcements and messaging, plus
 * the routing boundaries (SOS → Security, formal reports → Committee, never automatically to admins).
 * Private in-memory MongoDB; console email. SKIP_DB_TESTS=true skips.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';

const d = process.env.SKIP_DB_TESTS === 'true' ? describe.skip : describe;
const PASSWORD = 'Campus-Admin-Portal-9';
const API = '/api/v1';
const COLLEGE = { 'X-CampusCare-Client': 'android', 'X-CampusCare-App': 'college' };
const STUDENT_APP = { 'X-CampusCare-Client': 'android', 'X-CampusCare-App': 'student' };

d('Campus Admin portal (integration)', () => {
  let mongo: { stop: () => Promise<boolean>; getUri: () => string };
  let app: import('express').Express;
  let M: typeof import('../src/models/user') & typeof import('../src/models/safety') & typeof import('../src/models/duty') & typeof import('../src/models/incident')
    & typeof import('../src/models/platform') & typeof import('../src/models/content') & typeof import('../src/models/counselling');
  let hash: string;
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  let committeeId: string;
  let alertId: string;
  let incidentId: string;

  async function mk(key: string, role: string, extra: Record<string, unknown> = {}) {
    const u = await M.User.create({ fullName: `${key} Person`, email: `${key}@srmap.edu.in`, role, passwordHash: hash, emailVerified: true, accountStatus: 'active', verificationStatus: 'approved', ...extra });
    ids[key] = String(u._id);
    return u;
  }
  async function login(key: string) {
    const headers = (await M.User.findById(ids[key]))!.role === 'student' ? STUDENT_APP : COLLEGE;
    const r = await request(app).post(`${API}/auth/login`).set(headers).send({ email: `${key}@srmap.edu.in`, password: PASSWORD });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    tokens[key] = r.body.data.sessionToken;
  }
  const as = (key: string) => {
    const h = () => ({ ...(key.startsWith('student') ? STUDENT_APP : COLLEGE), Authorization: `Bearer ${tokens[key]}` });
    return {
      get: (p: string) => request(app).get(`${API}${p}`).set(h()),
      post: (p: string, b: Record<string, unknown> = {}) => request(app).post(`${API}${p}`).set(h()).send(b),
      patch: (p: string, b: Record<string, unknown> = {}) => request(app).patch(`${API}${p}`).set(h()).send(b),
    };
  };
  const notes = (key: string, kind?: string) => M.Notification.find({ userId: ids[key], ...(kind ? { kind } : {}) }).lean();

  beforeAll(async () => {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    mongo = await MongoMemoryServer.create();
    await (await import('../src/db/connect')).connectDatabase(mongo.getUri());
    app = (await import('../src/app')).createApp();
    M = {
      ...(await import('../src/models/user')), ...(await import('../src/models/safety')), ...(await import('../src/models/duty')),
      ...(await import('../src/models/incident')), ...(await import('../src/models/platform')), ...(await import('../src/models/content')),
      ...(await import('../src/models/counselling')),
    };
    for (const name of mongoose.modelNames()) await mongoose.model(name).syncIndexes();
    await (await import('../src/services/settings.service')).updateSettings({
      turnstile: { enabled: false },
      registration: { campuses: [{ id: 'main', name: 'Main Campus' }, { id: 'north', name: 'North Campus' }] },
      security: { requireMfaForSuperAdmin: false, requireMfaForAdmins: false },
    } as never, '000000000000000000000000');
    hash = await (await import('../src/lib/crypto')).hashPassword(PASSWORD);

    const committee = await M.Committee.create({ name: 'Anti-Harassment Committee', type: 'gender_sensitivity', categories: ['harassment'] });
    committeeId = String(committee._id);
    await M.RoutingRule.create({ category: 'harassment', committeeId: committee._id, defaultPriority: 'high' });

    await mk('root', 'super_admin');
    await mk('adminMain', 'admin', { campusZone: 'main', managedCampuses: ['main'] });
    await mk('adminNorth', 'admin', { campusZone: 'north', managedCampuses: ['north'] });
    await mk('studentMain', 'student', { studentId: 'AP-M-1', campusZone: 'main', department: 'CSE' });
    await mk('studentNoCampus', 'student', { studentId: 'AP-M-2', department: 'ECE' });
    await mk('studentNorth', 'student', { studentId: 'AP-N-1', campusZone: 'north', department: 'CSE' });
    const officer = await mk('officerMain', 'security_officer', { campusZone: 'main', responderEligible: true });
    await mk('officerNorth', 'security_officer', { campusZone: 'north', responderEligible: true });
    await mk('member', 'committee_member', { campusZone: 'main', committeeMemberships: [{ committeeId: committee._id, position: 'member' }] });
    const counsellor = await mk('counsellor', 'counsellor', { campusZone: 'main', counsellorApproved: true });
    await M.ResponderAvailability.create({ userId: officer._id, status: 'on_duty', campus: 'main', responsibilities: ['sos_response'], lastHeartbeatAt: new Date(), statusChangedAt: new Date() });
    await M.ResponderAvailability.create({ userId: ids.officerNorth, status: 'off_duty', campus: 'north' });
    await M.Availability.create({ counsellorId: counsellor._id, weekly: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '09:00', end: '17:00' })), maxDailySessions: 6, campus: 'main' });
    for (const k of ['root', 'adminMain', 'adminNorth', 'studentMain', 'studentNoCampus', 'studentNorth', 'officerMain', 'member', 'counsellor']) await login(k);
  }, 180_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo?.stop();
  });

  it('routes a student SOS to Security only — not to Committee Members or Campus Admins', async () => {
    const key = randomUUID();
    const r = await as('studentMain').post('/safety/sos', { idempotencyKey: key, latitude: 16.4636, longitude: 80.5074, accuracyMeters: 10, note: 'Being followed near the library' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    alertId = r.body.data.id;
    // A retried request with the same key never creates a second alert.
    const again = await as('studentMain').post('/safety/sos', { idempotencyKey: key });
    expect(again.body.data.id).toBe(alertId);
    expect(await M.EmergencyAlert.countDocuments({ userId: ids.studentMain })).toBe(1);
    expect((await M.EmergencyAlert.findById(alertId).lean())!.campus).toBe('main');
    expect((await M.Notification.find({ userId: ids.officerMain, kind: { $in: ['sos', 'sos_assignment'] } }).lean()).length).toBeGreaterThan(0);
    expect(await notes('member', 'sos')).toHaveLength(0);
    expect(await notes('adminMain', 'sos')).toHaveLength(0);
    expect(await notes('adminNorth', 'sos')).toHaveLength(0);
  });

  it('routes a formal report to its Committee only — not to Security or Campus Admins', async () => {
    const r = await as('studentMain').post('/incidents', {
      category: 'harassment', title: 'Repeated harassment in the lab', description: 'A senior has been repeatedly harassing students in the electronics lab after hours.',
      incidentDate: new Date().toISOString(), location: 'Electronics Lab', severity: 'high', idempotencyKey: randomUUID(),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    incidentId = r.body.data.id;
    expect((await M.Incident.findById(incidentId).lean())!.campus).toBe('main');
    expect((await notes('member', 'case_assigned')).length).toBeGreaterThan(0);
    expect(await notes('officerMain', 'case_assigned')).toHaveLength(0);
    expect(await notes('adminMain', 'case_assigned')).toHaveLength(0);
    // An ordinary report is never an SOS.
    expect(await M.EmergencyAlert.countDocuments({})).toBe(1);
  });

  it('dashboard numbers match the campus data and stay inside the admin’s campus', async () => {
    const start = new Date(Date.now() + 3600_000);
    await M.Appointment.create({ studentId: ids.studentMain, counsellorId: ids.counsellor, startAt: start, endAt: new Date(start.getTime() + 50 * 60_000), status: 'confirmed', reason: 'PRIVATE-REASON-TEXT', idempotencyKey: randomUUID() });
    await M.Appointment.create({ studentId: ids.studentNoCampus, counsellorId: ids.counsellor, status: 'requested', idempotencyKey: randomUUID() });
    const main = (await as('adminMain').get('/admin/portal/dashboard')).body.data;
    expect(main.campuses).toEqual([{ id: 'main', name: 'Main Campus' }]);
    expect(main.sos).toMatchObject({ active: 1 });
    expect(main.reports).toMatchObject({ new: 1, open: 1, unassigned: 1, overdue: 0 });
    expect(main.students).toMatchObject({ total: 2, active: 2 }); // studentMain + the account with no campus (default campus)
    expect(main.security).toMatchObject({ officers: 1, onDuty: 1 });
    expect(main.counselling).toMatchObject({ counsellors: 1, pendingRequests: 1, upcoming: 1 });
    expect(main.access).toMatchObject({ sosDispatch: false, liveLocations: false, reportsSensitive: false, counsellingNotes: false, dutyManage: false, superAdmin: false });
    expect(JSON.stringify(main)).not.toContain('Being followed');

    const north = (await as('adminNorth').get('/admin/portal/dashboard')).body.data;
    expect(north.sos.active).toBe(0);
    expect(north.reports.new).toBe(0);
    expect(north.students.total).toBe(1);
    expect(north.security).toMatchObject({ officers: 1, onDuty: 0 });
  });

  it('SOS oversight shows status but not identity, notes or precise location', async () => {
    const list = await as('adminMain').get('/admin/portal/sos?status=active');
    expect(list.status).toBe(200);
    expect(list.body.data.canDispatch).toBe(false);
    const row = list.body.data.items.find((x: { id: string }) => x.id === alertId);
    expect(row).toBeTruthy();
    expect(row.latitude).toBeUndefined();
    const text = JSON.stringify(list.body);
    for (const leak of ['Being followed', 'studentMain', '16.4636']) expect(text).not.toContain(leak);

    const detail = await as('adminMain').get(`/admin/portal/sos/${alertId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.timeline.length).toBeGreaterThan(0);
    expect(detail.body.data.timeline.every((e: Record<string, unknown>) => !('note' in e))).toBe(true);
    expect(detail.body.data.latitude).toBeUndefined();
    expect(await M.AuditLog.countDocuments({ action: 'campus_admin.sos_viewed', targetId: alertId })).toBe(1);

    // Another campus's admin, students and staff without admin access get nothing.
    expect((await as('adminNorth').get(`/admin/portal/sos/${alertId}`)).status).toBe(404);
    expect((await as('adminNorth').get('/admin/portal/sos?status=all')).body.data.items).toHaveLength(0);
    expect((await as('member').get('/admin/portal/sos')).status).toBe(403);
    expect((await as('officerMain').get('/admin/portal/dashboard')).status).toBe(403);
    expect((await as('studentMain').get('/admin/portal/dashboard')).status).toBe(403);

    // The live map withholds SOS and responder positions without explicit permission.
    const map = (await as('adminMain').get('/admin/portal/map')).body.data;
    expect(map).toMatchObject({ campus: 'main', activeSos: 1, sosMarkers: null, responders: null });
    expect((await as('adminMain').get('/admin/portal/map?campus=north')).status).toBe(404);

    // An explicit dispatch grant (set by a Super Admin) reveals position and is audited.
    await M.User.updateOne({ _id: ids.adminMain }, { $set: { permissions: ['sos:dispatch'] } });
    const granted = (await as('adminMain').get(`/admin/portal/sos/${alertId}`)).body.data;
    expect(granted).toMatchObject({ canDispatch: true, latitude: 16.4636 });
    const map2 = (await as('adminMain').get('/admin/portal/map')).body.data;
    expect(map2.sosMarkers).toHaveLength(1);
    expect(await M.AuditLog.countDocuments({ action: 'campus_admin.live_map_viewed' })).toBe(1);
    await M.User.updateOne({ _id: ids.adminMain }, { $set: { permissions: [] } });
  });

  it('report oversight is metadata only and scoped to the campus', async () => {
    const r = await as('adminMain').get('/admin/portal/reports?tab=new');
    expect(r.status).toBe(200);
    const item = r.body.data.items.find((x: { id: string }) => x.id === incidentId);
    expect(item).toMatchObject({ category: 'harassment', group: 'new', assigned: false, committee: 'Anti-Harassment Committee' });
    const text = JSON.stringify(r.body);
    for (const leak of ['Repeated harassment', 'electronics lab', 'Electronics Lab']) expect(text).not.toContain(leak);
    expect(r.body.data.metrics).toMatchObject({ open: 1, new: 1 });
    expect((await as('adminNorth').get('/admin/portal/reports?tab=all')).body.data.items).toHaveLength(0);
    expect((await as('adminMain').get('/admin/portal/reports?tab=bogus')).status).toBe(400);
    expect((await as('member').get('/admin/portal/reports')).status).toBe(403);
  });

  it('counselling overview never exposes students, reasons or notes', async () => {
    const r = await as('adminMain').get('/admin/portal/counselling?range=30');
    expect(r.status).toBe(200);
    const body = r.body.data;
    expect(body.counsellors[0]).toMatchObject({ name: 'counsellor Person', accepting: true, dailyCapacity: 6, pendingRequests: 1 });
    expect(body.upcoming).toHaveLength(1);
    expect(Object.keys(body.upcoming[0]).sort()).toEqual(['counsellor', 'endAt', 'id', 'mode', 'startAt', 'status']);
    const text = JSON.stringify(body);
    for (const leak of ['PRIVATE-REASON-TEXT', 'studentMain', 'AP-M-1', ids.studentMain]) expect(text).not.toContain(leak);
    expect(body.canManageSchedules).toBe(false);
    expect((await as('counsellor').get('/admin/portal/counselling')).status).toBe(403);
  });

  it('student directory is scoped, paged, audited and excludes other campuses and staff', async () => {
    const r = await as('adminMain').get('/admin/portal/students?q=AP');
    expect(r.status).toBe(200);
    expect(r.body.data.items.map((s: { studentId: string }) => s.studentId).sort()).toEqual(['AP-M-1', 'AP-M-2']);
    expect(r.body.data.departments).toEqual(['CSE', 'ECE']);
    const audit = await M.AuditLog.findOne({ action: 'campus_admin.students_listed' }).sort({ at: -1 }).lean();
    expect(JSON.stringify(audit)).not.toContain('"AP"');
    expect((await as('adminMain').get(`/admin/portal/students/${ids.studentNorth}`)).status).toBe(404);
    expect((await as('adminMain').get(`/admin/portal/students/${ids.officerMain}`)).status).toBe(404);
    const one = await as('adminMain').get(`/admin/portal/students/${ids.studentMain}`);
    expect(one.status).toBe(200);
    expect(one.body.data).toMatchObject({ studentId: 'AP-M-1', accountStatus: 'active' });
    expect(JSON.stringify(one.body)).not.toContain('PRIVATE-REASON-TEXT');
    expect((await as('member').get('/admin/portal/students')).status).toBe(403);
  });

  it('account actions respect campus scope and repeat safely', async () => {
    expect((await as('adminNorth').post(`/admin/users/${ids.studentMain}/status`, { action: 'suspend', reason: 'Testing cross-campus' })).status).toBe(404);
    expect((await as('adminMain').post(`/admin/users/${ids.studentNoCampus}/status`, { action: 'suspend', reason: 'Policy violation' })).status).toBe(200);
    expect((await as('adminMain').post(`/admin/users/${ids.studentNoCampus}/status`, { action: 'suspend', reason: 'Policy violation' })).status).toBe(200);
    expect((await M.User.findById(ids.studentNoCampus).lean())!.accountStatus).toBe('suspended');
    expect((await as('adminMain').post(`/admin/users/${ids.studentNoCampus}/status`, { action: 'reactivate', reason: 'Resolved' })).status).toBe(200);
    expect((await as('adminMain').post(`/admin/users/${ids.studentNoCampus}/status`, { action: 'reactivate', reason: 'Resolved' })).status).toBe(200);
    expect((await M.User.findById(ids.studentNoCampus).lean())!.accountStatus).toBe('active');
    expect(await M.AuditLog.countDocuments({ action: 'user.suspended', targetId: ids.studentNoCampus })).toBe(2);
    await login('studentNoCampus');
  });

  it('cannot escalate roles or manage privileged accounts', async () => {
    expect((await as('adminMain').post('/admin/users/invite', { fullName: 'New Root', email: 'new-root@srmap.edu.in', role: 'super_admin', committeeIds: [] })).status).toBe(403);
    expect((await as('adminMain').post('/admin/users/invite', { fullName: 'Another Admin', email: 'another-admin@srmap.edu.in', role: 'admin', committeeIds: [] })).status).toBe(403);
    expect((await as('adminMain').post(`/admin/users/${ids.adminMain}/status`, { action: 'suspend', reason: 'self test' })).status).toBe(403);
    expect((await as('adminMain').post(`/admin/users/${ids.root}/status`, { action: 'suspend', reason: 'escalation' })).status).toBe(404);
    // Profile edits cannot carry role or permission fields.
    await as('adminMain').patch('/auth/me', { fullName: 'Admin Main', role: 'super_admin', permissions: ['super_admin:access'], managedCampuses: ['north'] });
    const me = (await M.User.findById(ids.adminMain).lean())!;
    expect(me.role).toBe('admin');
    expect(me.permissions).toEqual([]);
    expect(me.managedCampuses).toEqual(['main']);
    expect((await as('adminMain').get('/super-admin/staff-applications')).status).toBe(403);
  });

  it('security management is read-only without duty:manage, and duty overrides are refused', async () => {
    const r = await as('adminMain').get('/admin/portal/security');
    expect(r.status).toBe(200);
    expect(r.body.data.team.map((o: { id: string }) => o.id)).toEqual([ids.officerMain]);
    expect(r.body.data.team[0]).toMatchObject({ dutyStatus: 'on_duty', dutyLabel: 'On duty' });
    expect(r.body.data.canManageDuty).toBe(false);
    expect((await as('adminMain').post(`/admin/responders/${ids.officerMain}/duty-status`, { status: 'off_duty', reason: 'Testing override' })).status).toBe(403);
    expect((await M.ResponderAvailability.findOne({ userId: ids.officerMain }).lean())!.status).toBe('on_duty');
    expect((await as('member').get('/admin/portal/security')).status).toBe(403);
  });

  it('committee management shows workload and assignment is permission-checked and audited', async () => {
    const c = (await as('adminMain').get('/admin/portal/committees')).body.data;
    expect(c.committees.find((x: { id: string }) => x.id === committeeId)).toMatchObject({ new: 1, unassigned: 1 });
    expect(c.awaitingAssignment.map((x: { id: string }) => x.id)).toContain(incidentId);
    expect(c.canAssign).toBe(true);
    // A non-chair committee member cannot assign; the Campus Admin (triage) can, once.
    expect((await as('member').post(`/incidents/${incidentId}/assign`, { committeeId, assigneeId: ids.member })).status).toBe(403);
    const staff = await as('adminMain').get(`/incidents/${incidentId}/assignable-staff`);
    expect(staff.body.data.map((s: { id: string }) => s.id)).toEqual([ids.member]);
    const a = await as('adminMain').post(`/incidents/${incidentId}/assign`, { committeeId, assigneeId: ids.member, reason: 'Portal assignment' });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(await M.AuditLog.countDocuments({ action: { $in: ['incident.assigned', 'incident.reassigned'] }, targetId: incidentId })).toBeGreaterThan(0);
    const after = (await as('adminMain').get('/admin/portal/committees')).body.data;
    expect(after.workload).toEqual([expect.objectContaining({ id: ids.member, open: 1 })]);
    expect(after.awaitingAssignment).toHaveLength(0);
    expect((await as('member').get('/admin/portal/committees')).status).toBe(403);
    expect((await as('adminNorth').get('/admin/portal/committees')).body.data.workload).toHaveLength(0);
  });

  it('analytics are campus-scoped, separate SOS from reports and suppress small groups', async () => {
    const r = await as('adminMain').get('/admin/portal/analytics?range=30');
    expect(r.status).toBe(200);
    const x = r.body.data;
    expect(x.reports.total).toBe(1);
    expect(x.sos.raised).toBe(1);
    expect(x.byCategory).toEqual([{ category: 'harassment', count: null }]);
    expect(x.students.total).toBe(2);
    expect((await as('adminNorth').get('/admin/portal/analytics')).body.data.reports.total).toBe(0);
    expect((await as('counsellor').get('/admin/portal/analytics')).status).toBe(403);
  });

  it('announcements: a Campus Admin publishes only to their campus, and audiences are respected', async () => {
    const body = { title: 'Library hours extended', body: 'The library is open until midnight this week.', category: 'campus_updates', targetRoles: ['student'] };
    expect((await as('adminMain').post('/chats/announcements', { ...body, campus: 'all' })).status).toBe(403);
    expect((await as('adminMain').post('/chats/announcements', { ...body, campus: 'north' })).status).toBe(403);
    expect((await as('member').post('/chats/announcements', { ...body, campus: 'main' })).status).toBe(403);
    const ok = await as('adminMain').post('/chats/announcements', { ...body, campus: 'main' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const id = ok.body.data.id;
    expect(await M.AuditLog.countDocuments({ action: 'announcement.published', targetId: id })).toBe(1);
    const seen = async (key: string) => (await as(key).get('/chats/announcements')).body.data.items.some((a: { id: string }) => a.id === id);
    expect(await seen('studentMain')).toBe(true);
    expect(await seen('studentNoCampus')).toBe(true); // no campus = default campus
    expect(await seen('studentNorth')).toBe(false);
    expect(await seen('officerMain')).toBe(false); // students only
    expect((await as('adminNorth').patch(`/chats/announcements/${id}`, { title: 'Hijacked title' })).status).toBe(403);
    // Legacy admin endpoint: a Campus Admin's announcement is pinned to their campus.
    const legacy = await as('adminMain').post('/admin/announcements', { title: 'Legacy notice', body: 'From the old screen' });
    expect(legacy.status, JSON.stringify(legacy.body)).toBe(201);
    expect((await M.Announcement.findById(legacy.body.data._id ?? legacy.body.data.id).lean())!.campus).toBe('main');

    // Portal list + read state; marking read twice counts once.
    const sa = await as('root').post('/chats/announcements', { title: 'Counsellor briefing', body: 'Quarterly briefing for counsellors.', category: 'counselling', campus: 'all', targetRoles: ['admin', 'counsellor'] });
    expect(sa.status).toBe(201);
    const list = (await as('adminMain').get('/admin/portal/announcements?audience=counselling')).body.data;
    expect(list.items.map((a: { id: string }) => a.id)).toEqual([sa.body.data.id]);
    expect(list.publishCampuses).toEqual([{ id: 'main', name: 'Main Campus' }]);
    await as('adminMain').post(`/admin/portal/announcements/${sa.body.data.id}/read`);
    await as('adminMain').post(`/admin/portal/announcements/${sa.body.data.id}/read`);
    expect((await M.Announcement.findById(sa.body.data.id).lean())!.readCount).toBe(1);
    expect((await as('adminMain').get('/admin/portal/announcements?audience=committee')).body.data.items).toHaveLength(0);
  });

  it('messaging and realtime rooms never widen access to SOS or report records', async () => {
    const { canJoinRoom } = await import('../src/realtime/socket');
    const user = async (k: string) => (await M.User.findById(ids[k]))!;
    expect(await canJoinRoom(await user('adminMain'), `sos:${alertId}`)).toBe(false);
    expect(await canJoinRoom(await user('adminMain'), 'responders:all')).toBe(false);
    expect(await canJoinRoom(await user('adminMain'), `case:${incidentId}`)).toBe(false);
    expect(await canJoinRoom(await user('adminMain'), 'ops:alerts')).toBe(false);
    expect(await canJoinRoom(await user('member'), `sos:${alertId}`)).toBe(false);
    expect(await canJoinRoom(await user('officerMain'), `sos:${alertId}`)).toBe(true);
    expect(await canJoinRoom(await user('member'), `case:${incidentId}`)).toBe(true);
    expect(await canJoinRoom(await user('adminMain'), 'nonsense:1')).toBe(false);

    const m = await as('adminMain').get('/admin/portal/messages');
    expect(m.status).toBe(200);
    const keys = m.body.data.groups.map((g: { key: string }) => g.key);
    expect(keys).toEqual(expect.arrayContaining(['security', 'committee', 'counsellors', 'admins']));
    for (const g of m.body.data.groups) for (const c of g.recent) if (c.locked) expect(c.preview).toBeNull();
    const text = JSON.stringify(m.body);
    for (const leak of ['Being followed', 'studentMain', '16.4636']) expect(text).not.toContain(leak);
    // The same holds in the Chats center itself, while Security still sees the detail.
    const center = JSON.stringify((await as('adminMain').get('/chats/conversations?category=security')).body);
    for (const leak of ['Being followed', 'studentMain', '16.4636']) expect(center).not.toContain(leak);
    expect((await as('adminNorth').get('/chats/conversations?category=security')).body.data.items).toHaveLength(0);
    expect(JSON.stringify((await as('officerMain').get('/chats/conversations?category=security')).body)).toContain('studentMain');
    expect((await as('studentMain').get('/admin/portal/messages')).status).toBe(403);
  });

  it('level-2 SOS escalation notifies only Super Admins and that campus’s admins, and records it', async () => {
    const { runSosEscalation } = await import('../src/services/safety.service');
    await M.EmergencyAlert.updateOne({ _id: alertId }, { $set: { status: 'sent', acknowledgedAt: null, escalationLevel: 1 } });
    expect(await runSosEscalation(Date.now() + 3600_000)).toBe(1);
    expect((await notes('adminMain', 'sos')).length).toBe(1);
    expect((await notes('root', 'sos')).length).toBe(1);
    expect(await notes('adminNorth', 'sos')).toHaveLength(0);
    expect(await notes('member', 'sos')).toHaveLength(0);
    const a = (await M.EmergencyAlert.findById(alertId).lean())!;
    expect(a.escalationLevel).toBe(2);
    expect(a.events.some((e) => e.type === 'escalated_to_administrators')).toBe(true);
    expect(await M.AuditLog.countDocuments({ action: 'sos.escalated', targetId: alertId })).toBe(1);
    // Running again never notifies twice.
    expect(await runSosEscalation(Date.now() + 7200_000)).toBe(0);
  });

  it('existing role workflows still work: student, counsellor, committee member, security officer, Super Admin', async () => {
    expect((await as('studentMain').get('/incidents?scope=mine')).status).toBe(200);
    expect((await as('counsellor').get('/counselling/appointments')).status).toBe(200);
    expect((await as('member').get(`/incidents/${incidentId}`)).status).toBe(200);
    expect((await as('officerMain').get('/responders/me/duty')).status).toBe(200);
    expect((await as('root').get('/admin/portal/dashboard')).body.data.campuses.map((c: { id: string }) => c.id)).toEqual(['main', 'north']);
    expect((await as('root').get('/admin/portal/dashboard')).body.data.sos.active).toBe(1);
  });
});
