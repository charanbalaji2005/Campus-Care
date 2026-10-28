/**
 * Unified Chats center: categories per role, direct conversations, preferences, counselling privacy,
 * official announcements and the Reports inbox (existing incident records, sorted and filtered).
 * Runs against a private in-memory MongoDB; email goes to the console and push is unconfigured.
 * Set SKIP_DB_TESTS=true to skip.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';

const d = process.env.SKIP_DB_TESTS === 'true' ? describe.skip : describe;
const PASSWORD = 'Chats-Center-Test-9';
const API = '/api/v1';
type Agent = ReturnType<typeof request.agent>;

d('Chats center (integration)', () => {
  let mongo: { stop: () => Promise<boolean>; getUri: () => string };
  let app: import('express').Express;
  let M: typeof import('../src/models/user') & typeof import('../src/models/chat') & typeof import('../src/models/incident')
    & typeof import('../src/models/content') & typeof import('../src/models/counselling') & typeof import('../src/models/support');
  let hash: string;
  const ids: Record<string, string> = {};

  async function makeUser(name: string, role: string, extra: Record<string, unknown> = {}) {
    const u = await M.User.create({ fullName: `${name} Person`, email: `${name}@srmap.edu.in`, role, passwordHash: hash, emailVerified: true, accountStatus: 'active', ...extra });
    ids[name] = String(u._id);
    return u;
  }
  function freshCsrf(r: request.Response) {
    const c = (r.headers['set-cookie'] as unknown as string[] | undefined)?.find((x) => x.startsWith('cc_csrf='));
    return c ? c.split(';')[0]!.split('=')[1] : undefined;
  }
  async function webLogin(name: string) {
    const agent = request.agent(app);
    const csrf = (await agent.get(`${API}/auth/csrf`)).body.data.csrfToken as string;
    const r = await agent.post(`${API}/auth/login`).set('x-csrf-token', csrf).send({ email: `${name}@srmap.edu.in`, password: PASSWORD });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const token = freshCsrf(r) ?? csrf;
    // Wrap so tests can call root.get/post/patch like the bearer agents.
    return {
      get: (u: string) => agent.get(u),
      post: (u: string) => agent.post(u).set('x-csrf-token', token),
      patch: (u: string) => agent.patch(u).set('x-csrf-token', token),
    };
  }
  async function appLogin(name: string) {
    const r = await request(app).post(`${API}/auth/login`).set('X-CampusCare-Client', 'android').send({ email: `${name}@srmap.edu.in`, password: PASSWORD });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return request.agent(app).set('Authorization', `Bearer ${r.body.data.sessionToken}`).set('X-CampusCare-Client', 'android') as unknown as Agent;
  }

  let root: Awaited<ReturnType<typeof webLogin>>;
  let adm: Agent; let adm2: Agent; let couA: Agent; let couB: Agent; let stuA: Agent; let stuB: Agent; let handler: Agent;
  let committeeId: string;

  const list = async (agent: Agent | typeof root, category: string, extra = '') => {
    const r = await agent.get(`${API}/chats/conversations?category=${category}${extra}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.data.items as { id: string; type: string; title: string; subtitle: string | null; preview: string | null; unread: number; locked: boolean; archived: boolean; pinned: boolean; markedUnread: boolean; needsResponse: boolean }[];
  };
  const categories = async (agent: Agent | typeof root) => ((await agent.get(`${API}/chats/categories`)).body.data.categories as { key: string }[]).map((c) => c.key);

  beforeAll(async () => {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    mongo = await MongoMemoryServer.create();
    const { connectDatabase } = await import('../src/db/connect');
    await connectDatabase(mongo.getUri());
    const { createApp } = await import('../src/app');
    app = createApp();
    M = {
      ...(await import('../src/models/user')), ...(await import('../src/models/chat')), ...(await import('../src/models/incident')),
      ...(await import('../src/models/content')), ...(await import('../src/models/counselling')), ...(await import('../src/models/support')),
    };
    for (const name of mongoose.modelNames()) await mongoose.model(name).syncIndexes();
    const settings = await import('../src/services/settings.service');
    await settings.updateSettings({ turnstile: { enabled: false }, security: { requireMfaForSuperAdmin: false, requireMfaForAdmins: false } } as never, '000000000000000000000000');
    const { hashPassword } = await import('../src/lib/crypto');
    hash = await hashPassword(PASSWORD);

    const committee = await M.Committee.create({ name: 'Anti-Ragging Committee', type: 'anti_ragging', categories: ['ragging'] });
    committeeId = String(committee._id);
    await M.RoutingRule.create({ category: 'ragging', committeeId: committee._id });

    await makeUser('root', 'super_admin');
    await makeUser('adm', 'admin');
    await makeUser('adm2', 'admin');
    await makeUser('coua', 'counsellor');
    await makeUser('coub', 'counsellor');
    await makeUser('stua', 'student', { studentId: 'AP001' });
    await makeUser('stub', 'student', { studentId: 'AP002' });
    await makeUser('handler', 'committee_member', { committeeMemberships: [{ committeeId: committee._id, position: 'member' }] });
    root = await webLogin('root');
    [adm, adm2, couA, couB, stuA, stuB, handler] = await Promise.all(['adm', 'adm2', 'coua', 'coub', 'stua', 'stub', 'handler'].map(appLogin));
  }, 180_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo?.stop();
  });

  it('requires authentication on every Chats endpoint', async () => {
    const fake = '0123456789abcdef01234567';
    for (const [m, u] of [['get', '/chats/categories'], ['get', '/chats/overview'], ['get', '/chats/conversations'], ['get', '/chats/contacts'], ['post', '/chats/direct'],
      ['patch', '/chats/preferences'], ['post', '/chats/read'], ['get', '/chats/announcements'], ['post', '/chats/announcements'], ['patch', `/chats/announcements/${fake}`],
      ['get', `/chats/channels/${fake}/participants`]] as const) {
      const r = await (request(app) as unknown as Record<string, (u: string) => request.Test>)[m]!(`${API}${u}`).set('X-CampusCare-Client', 'android').send({});
      expect(r.status, `${m} ${u}`).toBe(401);
    }
  });

  it('shows each role only the categories it is authorised for', async () => {
    const rootCats = await categories(root);
    expect(rootCats).toEqual(expect.arrayContaining(['all', 'announcements', 'counselling', 'student_counsellor', 'student_admin', 'admin_super_admin', 'counsellor_admin', 'support', 'reports', 'unread', 'archived']));
    const studentCats = await categories(stuA);
    expect(studentCats).toEqual(expect.arrayContaining(['announcements', 'student_counsellor', 'student_admin', 'reports']));
    expect(studentCats).not.toContain('admin_super_admin');
    expect(studentCats).not.toContain('counsellor_admin');
    expect(studentCats).not.toContain('counselling');
    const counsellorCats = await categories(couA);
    expect(counsellorCats).toEqual(expect.arrayContaining(['counselling', 'student_counsellor', 'counsellor_admin']));
    expect(counsellorCats).not.toContain('admin_super_admin');
    expect(counsellorCats).not.toContain('student_admin');
    expect(counsellorCats).not.toContain('reports');
    // A category outside the caller's set is refused, not silently emptied.
    expect((await stuA.get(`${API}/chats/conversations?category=admin_super_admin`)).status).toBe(403);
  });

  let directId = '';
  it('opens one direct conversation per pair, only between permitted roles', async () => {
    const first = await root.post(`${API}/chats/direct`).send({ userId: ids.adm });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.data.purpose).toBe('admin_super_admin');
    directId = first.body.data.id;
    const again = await adm.post(`${API}/chats/direct`).send({ userId: ids.root });
    expect(again.status).toBe(200);
    expect(again.body.data.id).toBe(directId);

    expect((await stuA.post(`${API}/chats/direct`).send({ userId: ids.adm })).status).toBe(403); // students never initiate
    expect((await adm.post(`${API}/chats/direct`).send({ userId: ids.adm2 })).status).toBe(403); // admin ↔ admin is not a defined channel
    expect((await couA.post(`${API}/chats/direct`).send({ userId: ids.stua })).status).toBe(403); // counsellors use counselling threads
    expect((await couA.post(`${API}/chats/direct`).send({ userId: ids.adm })).body.data.purpose).toBe('counsellor_admin');
    expect((await adm.post(`${API}/chats/direct`).send({ userId: ids.stua })).body.data.purpose).toBe('student_admin');

    // Contacts list only offers people the caller may contact.
    const contacts = (await stuA.get(`${API}/chats/contacts`)).body.data as unknown[];
    expect(contacts).toHaveLength(0);
    const rootContacts = ((await root.get(`${API}/chats/contacts?q=Person`)).body.data as { role: string }[]).map((c) => c.role);
    expect(rootContacts).not.toContain('committee_member');
  });

  it('keeps direct messages private, counts unread once and ignores duplicate retries', async () => {
    const clientMessageId = randomUUID();
    const sent = await adm.post(`${API}/chat/channels/${directId}/messages`).send({ body: 'Budget review at 4pm?', clientMessageId });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    const retry = await adm.post(`${API}/chat/channels/${directId}/messages`).send({ body: 'Budget review at 4pm?', clientMessageId });
    expect(retry.status).toBe(200);
    expect(retry.body.data.duplicate).toBe(true);

    const item = (await list(root, 'admin_super_admin')).find((i) => i.id === directId)!;
    expect(item.unread).toBe(1);
    expect(item.preview).toContain('Budget review');
    expect(item.title).toBe('adm Person');
    expect(item.needsResponse).toBe(true);

    // A third administrator cannot list, read, post to or inspect the conversation.
    expect((await list(adm2, 'all')).some((i) => i.id === directId)).toBe(false);
    expect((await adm2.get(`${API}/chat/channels/${directId}/messages`)).status).toBe(404);
    expect((await adm2.post(`${API}/chat/channels/${directId}/messages`).send({ body: 'hi', clientMessageId: randomUUID() })).status).toBe(404);
    expect((await adm2.get(`${API}/chats/channels/${directId}/participants`)).status).toBe(404);

    const people = (await root.get(`${API}/chats/channels/${directId}/participants`)).body.data.people as { name: string }[];
    expect(people.map((p) => p.name).sort()).toEqual(['adm Person', 'root Person']);

    // Opening the thread marks it read.
    await root.get(`${API}/chat/channels/${directId}/messages`);
    expect((await list(root, 'admin_super_admin')).find((i) => i.id === directId)!.unread).toBe(0);
  });

  it('pins, archives and marks unread per user, without granting access', async () => {
    expect((await root.patch(`${API}/chats/preferences`).send({ itemType: 'channel', itemId: directId, pinned: true })).status).toBe(200);
    expect((await list(root, 'all'))[0]!.id).toBe(directId);

    await root.patch(`${API}/chats/preferences`).send({ itemType: 'channel', itemId: directId, archived: true });
    expect((await list(root, 'all')).some((i) => i.id === directId)).toBe(false);
    expect((await list(root, 'archived')).some((i) => i.id === directId)).toBe(true);
    await root.patch(`${API}/chats/preferences`).send({ itemType: 'channel', itemId: directId, archived: false, markedUnread: true });
    expect((await list(root, 'unread')).some((i) => i.id === directId)).toBe(true);
    expect((await root.post(`${API}/chats/read`).send({ itemType: 'channel', itemId: directId })).status).toBe(200);
    expect((await list(root, 'unread')).some((i) => i.id === directId)).toBe(false);

    // Another user's preferences on the same conversation are untouched, and outsiders are refused.
    expect((await list(adm, 'all')).find((i) => i.id === directId)!.pinned).toBe(false);
    expect((await adm2.patch(`${API}/chats/preferences`).send({ itemType: 'channel', itemId: directId, pinned: true })).status).toBe(404);
  });

  let counsellingThread = '';
  it('lists counselling conversations to administrators as locked metadata only', async () => {
    const opened = await stuA.post(`${API}/counselling/conversations`).send({ counsellorId: ids.coua });
    expect(opened.status, JSON.stringify(opened.body)).toBe(201);
    counsellingThread = opened.body.data.id;
    await stuA.post(`${API}/counselling/conversations/${counsellingThread}/messages`).send({ body: 'I have been feeling very anxious', clientMessageId: randomUUID() });

    const counsellorView = (await list(couA, 'student_counsellor')).find((i) => i.id === counsellingThread)!;
    expect(counsellorView.locked).toBe(false);
    expect(counsellorView.preview).toContain('anxious');

    const adminView = (await list(root, 'student_counsellor')).find((i) => i.id === counsellingThread)!;
    expect(adminView.locked).toBe(true);
    expect(adminView.preview).toBeNull();
    expect(JSON.stringify(adminView)).not.toContain('stua');
    expect(JSON.stringify(adminView)).not.toContain('anxious');
    // The oversight row never unlocks content through any endpoint.
    expect((await root.get(`${API}/chat/channels/${counsellingThread}/messages`)).status).toBe(404);
    expect((await root.get(`${API}/chats/channels/${counsellingThread}/participants`)).status).toBe(404);
    expect((await root.post(`${API}/chats/read`).send({ itemType: 'channel', itemId: counsellingThread })).status).toBe(200); // read marker only
    // Counselling threads are not in the "all" list of a non-member.
    expect((await list(root, 'all')).some((i) => i.id === counsellingThread)).toBe(false);
    // Another counsellor cannot see it at all.
    expect((await list(couB, 'student_counsellor')).some((i) => i.id === counsellingThread)).toBe(false);
  });

  it('revokes the previous counsellor when an appointment is reassigned', async () => {
    // An accepted request with an open private chat (chatActivatedAt) being moved to another counsellor.
    const appt = await M.Appointment.create({ studentId: ids.stub, counsellorId: ids.coua, status: 'requested', idempotencyKey: randomUUID(), reason: 'Exam stress', chatActivatedAt: new Date() });
    const thread = await M.ChatChannel.create({ kind: 'counselling_thread', name: 'Counselling', studentId: ids.stub, appointmentId: appt._id, published: true });
    await M.ChatMembership.insertMany([{ channelId: thread._id, userId: ids.stub, role: 'student' }, { channelId: thread._id, userId: ids.coua, role: 'staff' }]);
    appt.threadId = thread._id;
    await appt.save();
    expect((await couA.get(`${API}/chat/channels/${thread._id}/messages`)).status).toBe(200);

    // The counselling request appears under Counselling: the counsellor sees the reason, administrators do not.
    const own = (await list(couA, 'counselling')).find((i) => i.id === String(appt._id))!;
    expect(own.preview).toBe('Exam stress');
    const oversight = (await list(root, 'counselling')).find((i) => i.id === String(appt._id))!;
    expect(oversight.locked).toBe(true);
    expect(oversight.preview).toBeNull();

    const r = await root.post(`${API}/counselling/appointments/${appt._id}/reassign`).send({ counsellorId: ids.coub, reason: 'Caseload balancing' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await couA.get(`${API}/chat/channels/${thread._id}/messages`)).status).toBe(404);
    expect((await couB.get(`${API}/chat/channels/${thread._id}/messages`)).status).toBe(200);
    expect((await list(couA, 'student_counsellor')).some((i) => i.id === String(thread._id))).toBe(false);
  });

  it('publishes official announcements to the targeted audience only; students cannot post', async () => {
    expect((await stuA.post(`${API}/chats/announcements`).send({ title: 'Hello all', body: 'Students cannot publish this.' })).status).toBe(403);
    expect((await couA.post(`${API}/chats/announcements`).send({ title: 'Hello all', body: 'Counsellors need an explicit grant.' })).status).toBe(403);

    const pub = await root.post(`${API}/chats/announcements`).send({ title: 'Exam timetable released', body: 'See the academic portal.', category: 'academic', priority: 'important', targetRoles: ['student'] });
    expect(pub.status, JSON.stringify(pub.body)).toBe(201);
    const annId = pub.body.data.id as string;
    const draft = await root.post(`${API}/chats/announcements`).send({ title: 'Draft notice', body: 'Not yet ready.', status: 'draft' });
    expect(draft.status).toBe(201);

    const feed = async (a: Agent) => (await a.get(`${API}/chats/announcements`)).body.data.items as { id: string; read: boolean; title: string }[];
    const studentFeed = await feed(stuA);
    expect(studentFeed.map((x) => x.id)).toContain(annId);
    expect(studentFeed.map((x) => x.id)).not.toContain(draft.body.data.id);
    expect((await feed(couA)).map((x) => x.id)).not.toContain(annId); // not in the audience

    // Reading is idempotent.
    await stuA.post(`${API}/chats/read`).send({ itemType: 'announcement', itemId: annId });
    await stuA.post(`${API}/chats/read`).send({ itemType: 'announcement', itemId: annId });
    expect((await feed(stuA)).find((x) => x.id === annId)!.read).toBe(true);
    const managed = (await root.get(`${API}/chats/announcements?view=manage`)).body.data.items as { id: string; readCount: number; history: { action: string }[] }[];
    expect(managed.find((x) => x.id === annId)!.readCount).toBe(1);
    expect((await stuA.get(`${API}/chats/announcements?view=manage`)).status).toBe(403);
    // Students cannot even mark an announcement that is not addressed to them.
    expect((await couA.post(`${API}/chats/read`).send({ itemType: 'announcement', itemId: annId })).status).toBe(404);

    // Schedules publish lazily and exactly once; archiving removes it from the feed.
    const sched = await root.post(`${API}/chats/announcements`).send({ title: 'Library hours', body: 'Extended hours this week.', status: 'scheduled', scheduledAt: new Date(Date.now() + 3600_000).toISOString() });
    expect(sched.status, JSON.stringify(sched.body)).toBe(201);
    expect((await feed(stuA)).map((x) => x.id)).not.toContain(sched.body.data.id);
    await M.Announcement.updateOne({ _id: sched.body.data.id }, { $set: { scheduledAt: new Date(Date.now() - 1000) } });
    expect((await feed(stuA)).map((x) => x.id)).toContain(sched.body.data.id);
    const arch = await root.patch(`${API}/chats/announcements/${annId}`).send({ status: 'archived' });
    expect(arch.status).toBe(200);
    expect(arch.body.data.history.map((h: { action: string }) => h.action)).toContain('archived');
    expect((await feed(stuA)).map((x) => x.id)).not.toContain(annId);
  });

  const reportIds: string[] = [];
  const submit = async (agent: Agent, body: Record<string, unknown>) => {
    const r = await agent.post(`${API}/incidents`).send({
      title: 'Report title here', description: 'A detailed description of what happened near the hostel block.', incidentDate: new Date().toISOString(),
      location: 'Hostel B', idempotencyKey: randomUUID(), ...body,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.data.id as string;
  };

  it('shows existing student reports in the Reports inbox with sorting, filters and triage-only metadata', async () => {
    reportIds.push(await submit(stuA, { category: 'ragging', title: 'Seniors ragging juniors', severity: 'low' }));
    reportIds.push(await submit(stuB, { category: 'infrastructure', title: 'Broken lights', anonymous: true }));
    reportIds.push(await submit(stuA, { category: 'infrastructure', title: 'Flooded corridor', urgent: true }));
    expect(await M.Incident.countDocuments()).toBe(3); // no copies were made

    const triage = async (q: string) => {
      const r = await root.get(`${API}/incidents?scope=triage${q}`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return r.body.data as { items: { id: string; title: string; priority: string; caseNumber: string }[]; total: number };
    };
    const newest = await triage('&sort=newest');
    expect(newest.items.map((i) => i.id)).toEqual([...reportIds].reverse());
    expect((await triage('&sort=oldest')).items.map((i) => i.id)).toEqual(reportIds);
    expect((await triage('&sort=priority')).items[0]!.id).toBe(reportIds[2]);
    // Triage administrators see a generic title, never the student's text.
    expect(newest.items.map((i) => i.title)).not.toContain('Broken lights');
    expect((await triage('&category=infrastructure')).total).toBe(2);
    expect((await triage('&urgent=true')).total).toBe(1);
    expect((await triage('&assignedTo=unassigned')).total).toBe(3);
    expect((await triage(`&committeeId=${committeeId}`)).total).toBe(1);
    expect((await triage(`&from=${new Date(Date.now() + 86400_000).toISOString().slice(0, 10)}`)).total).toBe(0);
    expect((await triage(`&q=${newest.items[0]!.caseNumber}`)).total).toBe(1);
    expect((await triage('&q=Broken')).total).toBe(0); // title search is not available at triage level
    expect((await triage('&limit=2&page=2')).items).toHaveLength(1);

    const detail = await root.get(`${API}/incidents/${reportIds[1]}`);
    expect(detail.body.data.incident.accessLevel).toBe('triage');
    expect(JSON.stringify(detail.body.data)).not.toContain('Broken lights');
    expect(detail.body.data.incident.reporter ?? null).toBeNull();
    expect((await root.get(`${API}/incidents/${reportIds[1]}/messages`)).status).toBe(404);

    const overview = (await root.get(`${API}/chats/overview`)).body.data;
    expect(overview.reports).toMatchObject({ new: 3, open: 3, urgent: 1 });
    // Students still see their own reports through the existing workflow, and nothing else.
    const mine = (await stuA.get(`${API}/incidents?scope=mine`)).body.data.items as { id: string }[];
    expect(mine.map((i) => i.id).sort()).toEqual([reportIds[0], reportIds[2]].sort());
    expect((await stuA.get(`${API}/incidents?scope=triage`)).status).toBe(403);
    expect((await stuA.get(`${API}/chats/overview`)).body.data.reports).toMatchObject({ new: 2 });
  });

  it('keeps internal notes out of the reporter’s view while user-visible messages reach them', async () => {
    const id = reportIds[0]!;
    expect((await handler.post(`${API}/incidents/${id}/notes`).send({ body: 'Internal: cross-check CCTV' })).status).toBe(201);
    const msg = await handler.post(`${API}/incidents/${id}/messages`).send({ body: 'Could you share the time it happened?', clientMessageId: randomUUID() });
    expect(msg.status, JSON.stringify(msg.body)).toBe(201);
    const studentDetail = JSON.stringify((await stuA.get(`${API}/incidents/${id}`)).body.data);
    expect(studentDetail).not.toContain('CCTV');
    const studentMsgs = JSON.stringify((await stuA.get(`${API}/incidents/${id}/messages`)).body.data);
    expect(studentMsgs).toContain('share the time');
    expect(studentMsgs).not.toContain('CCTV');
    expect((await stuA.get(`${API}/incidents/${id}/notes`)).status).toBe(404);
    expect((await root.get(`${API}/incidents/${id}/notes`)).status).toBe(404); // triage admin is not a handler
  });

  it('lists support tickets to support managers only, with internal notes marked as such', async () => {
    const t = await M.SupportTicket.create({
      ticketNumber: 'SUP-2026-000001', studentId: ids.stua, subject: 'Wi-Fi not working', category: (await import('@campuscare/shared')).SUPPORT_CATEGORIES[0],
      description: 'The hostel Wi-Fi drops every evening.', messages: [],
    });
    const item = (await list(root, 'support')).find((i) => i.id === String(t._id))!;
    expect(item.type).toBe('ticket');
    expect(item.needsResponse).toBe(true);
    expect((await list(stuA, 'support')).some((i) => i.id === String(t._id))).toBe(false);
    expect((await stuA.patch(`${API}/chats/preferences`).send({ itemType: 'ticket', itemId: String(t._id), pinned: true })).status).toBe(404);
  });
});
