import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';

const d = process.env.SKIP_DB_TESTS === 'true' ? describe.skip : describe;
const PASSWORD = 'Campus-Map-Pass-1';
type Agent = ReturnType<typeof request.agent>;

const API = '/api/v1';

d('Campus Map, Routing Engine, and Admin Route Management', () => {
  let app: import('express').Express;
  let M: typeof import('../src/models/user') & typeof import('../src/models/campus-map');
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
    const c = (r.headers['set-cookie'] as unknown as string[] | undefined)?.find((x) =>
      x.startsWith('cc_csrf='),
    );
    return c ? c.split(';')[0]!.split('=')[1] : undefined;
  }

  async function webLogin(email: string) {
    const agent = request.agent(app);
    const csrf = (await agent.get(`${API}/auth/csrf`)).body.data.csrfToken as string;
    const r = await agent
      .post(`${API}/auth/login`)
      .set('x-csrf-token', csrf)
      .send({ email, password: PASSWORD });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return { agent, csrf: freshCsrf(r) ?? csrf };
  }

  async function appLogin(email: string) {
    const r = await request(app)
      .post(`${API}/auth/login`)
      .set('X-CampusCare-Client', 'android')
      .send({ email, password: PASSWORD });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const token = r.body.data.sessionToken as string;
    return request(app)
      .post(`${API}/auth/login`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-CampusCare-Client', 'android') as unknown as Agent;
  }

  let root: { agent: Agent; csrf: string };
  const rootPost = (url: string) => root.agent.post(url).set('x-csrf-token', root.csrf);
  const rootPut = (url: string) => root.agent.put(url).set('x-csrf-token', root.csrf);
  const rootDelete = (url: string) => root.agent.delete(url).set('x-csrf-token', root.csrf);
  const rootPatch = (url: string) => root.agent.patch(url).set('x-csrf-token', root.csrf);

  let studentAgent: Agent;
  let studentBearerToken: string;

  let mongo: any;
  beforeAll(async () => {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    mongo = await MongoMemoryServer.create();
    const { connectDatabase } = await import('../src/db/connect');
    await connectDatabase(mongo.getUri());

    const { hashPassword } = await import('../src/lib/crypto');
    hash = await hashPassword(PASSWORD);

    const [userM, mapM] = await Promise.all([
      import('../src/models/user'),
      import('../src/models/campus-map'),
    ]);
    M = { ...userM, ...mapM };

    const { SystemSetting } = await import('../src/models/platform');
    const { invalidateSettingsCache } = await import('../src/services/settings.service');
    await SystemSetting.findOneAndUpdate(
      { key: 'platform' },
      { $set: { 'value.turnstile.enabled': false } },
      { upsert: true }
    );
    invalidateSettingsCache();

    const { createApp } = await import('../src/app');
    app = createApp();

    await makeUser('superadmin-map@university.edu', 'super_admin');
    await makeUser('student-map@university.edu', 'student');

    root = await webLogin('superadmin-map@university.edu');

    // Student Android login
    const sLogin = await request(app)
      .post(`${API}/auth/login`)
      .set('X-CampusCare-Client', 'android')
      .send({ email: 'student-map@university.edu', password: PASSWORD });
    studentBearerToken = sLogin.body.data.sessionToken;
  });

  afterAll(async () => {
    const { disconnectDatabase } = await import('../src/db/connect');
    await disconnectDatabase();
    if (mongo) await mongo.stop();
  });

  it('1. Admin creates campus buildings and student fetches campus map data', async () => {
    // Super admin creates Library with standard and wheelchair-accessible entrances
    const libRes = await rootPost(`${API}/campus-map/admin/buildings`).send({
      name: 'Central Library',
      code: 'LIB-01',
      category: 'library',
      campus: 'main',
      latitude: 16.565,
      longitude: 80.525,
      description: 'Main university library and study halls',
      entrances: [
        {
          id: 'lib-main',
          name: 'Main Front Entrance',
          latitude: 16.5651,
          longitude: 80.5251,
          isAccessible: false,
          isMain: true,
          status: 'open',
        },
        {
          id: 'lib-ramp',
          name: 'South Accessible Entrance (Ramp)',
          latitude: 16.5649,
          longitude: 80.5249,
          isAccessible: true,
          isMain: false,
          status: 'open',
        },
      ],
      operatingHours: '08:00 - 22:00',
      contactPhone: '+91 866 245 1100',
      isEmergencyLocation: false,
    });
    expect(libRes.status).toBe(201);
    expect(libRes.body.data.id).toBeDefined();

    // Super admin creates Security Headquarters (emergency location)
    const secRes = await rootPost(`${API}/campus-map/admin/buildings`).send({
      name: 'Campus Security Office',
      code: 'SEC-HQ',
      category: 'security_office',
      campus: 'main',
      latitude: 16.568,
      longitude: 80.522,
      description: '24/7 Central security control and emergency dispatch',
      entrances: [
        {
          id: 'sec-entrance',
          name: 'Dispatch Counter',
          latitude: 16.568,
          longitude: 80.522,
          isAccessible: true,
          isMain: true,
          status: 'open',
        },
      ],
      isEmergencyLocation: true,
      contactPhone: '+91 866 245 9999',
    });
    expect(secRes.status).toBe(201);

    // Student fetches map overview
    const mapOverview = await request(app)
      .get(`${API}/campus-map/data`)
      .set('Authorization', `Bearer ${studentBearerToken}`);

    expect(mapOverview.status).toBe(200);
    expect(mapOverview.body.data.buildings.length).toBeGreaterThanOrEqual(2);
    expect(mapOverview.body.data.emergencyLocations.some((b: any) => b.code === 'SEC-HQ')).toBe(true);

    // Student searches directory for library
    const searchRes = await request(app)
      .get(`${API}/campus-map/buildings?q=library`)
      .set('Authorization', `Bearer ${studentBearerToken}`);
    expect(searchRes.status).toBe(200);
    expect(searchRes.body.data.items[0].code).toBe('LIB-01');
  });

  it('2. Admin defines pathway segments and student calculates graph-based route', async () => {
    // Segment A: Main Gate (16.561, 80.520) to Central Plaza (16.563, 80.523)
    const segA = await rootPost(`${API}/campus-map/admin/pathways`).send({
      name: 'Main Gate Boulevard',
      campus: 'main',
      startNode: { id: 'node-gate', label: 'Main Entrance Gate', latitude: 16.561, longitude: 80.52 },
      endNode: { id: 'node-plaza', label: 'Central Plaza', latitude: 16.563, longitude: 80.523 },
      coordinates: [
        [80.52, 16.561],
        [80.523, 16.563],
      ],
      pathType: 'pedestrian',
      isOneWay: false,
      distanceMeters: 380,
      surfaceType: 'paved',
      status: 'open',
    });
    expect(segA.status).toBe(201);

    // Segment B: Central Plaza to Library Entrance (16.5651, 80.5251)
    const segB = await rootPost(`${API}/campus-map/admin/pathways`).send({
      name: 'Library Walkway',
      campus: 'main',
      startNode: { id: 'node-plaza', label: 'Central Plaza', latitude: 16.563, longitude: 80.523 },
      endNode: { id: 'lib-main', label: 'Library Front Entrance', latitude: 16.5651, longitude: 80.5251 },
      coordinates: [
        [80.523, 16.563],
        [80.5251, 16.5651],
      ],
      pathType: 'pedestrian',
      isOneWay: false,
      distanceMeters: 310,
      surfaceType: 'paved',
      status: 'open',
    });
    expect(segB.status).toBe(201);

    // Student calculates route from Main Gate to Central Library
    const routeRes = await request(app)
      .post(`${API}/campus-map/route`)
      .set('Authorization', `Bearer ${studentBearerToken}`)
      .send({
        origin: { latitude: 16.561, longitude: 80.52 },
        destination: { latitude: 16.5651, longitude: 80.5251 },
        mode: 'walking',
      });

    expect(routeRes.status).toBe(200);
    expect(routeRes.body.data.found).toBe(true);
    expect(routeRes.body.data.isApproximate).toBe(false);
    expect(routeRes.body.data.steps.length).toBeGreaterThanOrEqual(2);
    expect(routeRes.body.data.geometry.length).toBeGreaterThanOrEqual(3);
    expect(routeRes.body.data.distanceMeters).toBeGreaterThanOrEqual(690);
  });

  it('3. Accessible route selection prioritizes ramps and accessible entrances', async () => {
    // Add an accessible ramp pathway from plaza to accessible south entrance
    await rootPost(`${API}/campus-map/admin/pathways`).send({
      name: 'South Accessible Library Ramp',
      campus: 'main',
      startNode: { id: 'node-plaza', label: 'Central Plaza', latitude: 16.563, longitude: 80.523 },
      endNode: { id: 'lib-ramp', label: 'South Accessible Entrance', latitude: 16.5649, longitude: 80.5249 },
      coordinates: [
        [80.523, 16.563],
        [80.5249, 16.5649],
      ],
      pathType: 'accessible',
      surfaceType: 'ramp',
      distanceMeters: 330,
      status: 'open',
    });

    const buildings = await M.CampusBuilding.find({ code: 'LIB-01' }).lean();
    const libId = String(buildings[0]._id);

    // Calculate accessible route to Library by buildingId
    const accRoute = await request(app)
      .post(`${API}/campus-map/route`)
      .set('Authorization', `Bearer ${studentBearerToken}`)
      .send({
        origin: { latitude: 16.561, longitude: 80.52 },
        destination: { buildingId: libId },
        mode: 'accessible',
      });

    expect(accRoute.status).toBe(200);
    expect(accRoute.body.data.found).toBe(true);
    expect(accRoute.body.data.mode).toBe('accessible');
    expect(accRoute.body.data.destinationEntrance?.isAccessible).toBe(true);
  });

  it('4. Temporary pathway closure reroutes or alerts students', async () => {
    // Find segB (Library Walkway) and apply temporary maintenance closure
    const seg = await M.CampusPathwaySegment.findOne({ name: 'Library Walkway' }).lean();
    expect(seg).toBeDefined();

    const closeRes = await rootPost(`${API}/campus-map/admin/pathways/${seg!._id}/closure`).send({
      status: 'closed',
      reason: 'Paver stones replacement under maintenance',
      alternativeNotes: 'Please use the South Accessible Ramp',
      broadcastNotice: true,
    });
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.data.status).toBe('closed');

    // Route calculation should now route through the open Accessible Ramp instead of Library Walkway
    const routeAfterClose = await request(app)
      .post(`${API}/campus-map/route`)
      .set('Authorization', `Bearer ${studentBearerToken}`)
      .send({
        origin: { latitude: 16.561, longitude: 80.52 },
        destination: { latitude: 16.5651, longitude: 80.5251 },
        mode: 'walking',
      });

    expect(routeAfterClose.status).toBe(200);
    expect(routeAfterClose.body.data.found).toBe(true);
    // Route uses open alternate pathway
    const usedPathwayNames = routeAfterClose.body.data.steps.map((s: any) => s.pathwayName);
    expect(usedPathwayNames).toContain('South Accessible Library Ramp');
    expect(usedPathwayNames).not.toContain('Library Walkway');
  });

  it('5. Student submits map issue report, and admin resolves it', async () => {
    const reportRes = await request(app)
      .post(`${API}/campus-map/reports`)
      .set('Authorization', `Bearer ${studentBearerToken}`)
      .send({
        reportType: 'blocked_entrance',
        locationLabel: 'North Engineering Gate',
        latitude: 16.566,
        longitude: 80.524,
        targetEntityType: 'entrance',
        description: 'Construction scaffolding is blocking the entrance turnstile.',
      });

    expect(reportRes.status).toBe(201);
    const reportId = reportRes.body.data.id;
    expect(reportId).toBeDefined();

    // Student views their own reports
    const myReports = await request(app)
      .get(`${API}/campus-map/reports/mine`)
      .set('Authorization', `Bearer ${studentBearerToken}`);
    expect(myReports.status).toBe(200);
    expect(myReports.body.data.items.length).toBeGreaterThanOrEqual(1);

    // Admin lists pending reports
    const adminReports = await root.agent
      .get(`${API}/campus-map/admin/reports?status=pending`)
      .set('x-csrf-token', root.csrf);
    expect(adminReports.status).toBe(200);
    expect(adminReports.body.data.items.some((r: any) => r.id === reportId)).toBe(true);

    // Admin resolves report
    const patchRes = await rootPatch(`${API}/campus-map/admin/reports/${reportId}`).send({
      status: 'resolved',
      resolutionNote: 'Scaffolding cleared and pathway reopened for safe access.',
    });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.status).toBe('resolved');
  });

  it('6. Security: Non-admin student cannot access administrative endpoints', async () => {
    const denied = await request(app)
      .post(`${API}/campus-map/admin/buildings`)
      .set('Authorization', `Bearer ${studentBearerToken}`)
      .send({
        name: 'Unauthorized Building',
        code: 'UNAUTH-01',
        category: 'academic',
        latitude: 16.5,
        longitude: 80.5,
      });

    expect(denied.status).toBe(403);
  });
});
