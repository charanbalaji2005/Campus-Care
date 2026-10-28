/**
 * Public counsellor directory: field allowlist, eligibility, search/sort, privacy-thresholded ratings
 * and feedback, comment consent/moderation/reporting, booking from a profile, counsellor profile
 * editing and Super Admin controls. Private in-memory MongoDB; console email; no push.
 * SKIP_DB_TESTS=true skips.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { sanitizeFeedbackText } from '@campuscare/shared';

const d = process.env.SKIP_DB_TESTS === 'true' ? describe.skip : describe;
const PASSWORD = 'Directory-Test-9';
const API = '/api/v1/counselling';
type Agent = ReturnType<typeof request.agent>;

d('Counsellor directory (integration)', () => {
  let mongo: { stop: () => Promise<boolean>; getUri: () => string };
  let app: import('express').Express;
  let M: typeof import('../src/models/user') & typeof import('../src/models/counselling') & typeof import('../src/models/wellness')
    & typeof import('../src/models/platform') & typeof import('../src/models/content');
  let settings: typeof import('../src/services/settings.service');
  let hash: string;
  const ids: Record<string, string> = {};
  const agents: Record<string, Agent> = {};
  let root: { agent: Agent; csrf: string };

  async function makeUser(name: string, role: string, extra: Record<string, unknown> = {}) {
    const u = await M.User.create({
      fullName: `${name} Person`, email: `${name}@srmap.edu.in`, role, passwordHash: hash, emailVerified: true, accountStatus: 'active',
      phone: '+91 90000 11111', employeeId: `EMP-${name}`, ...extra,
    });
    ids[name] = String(u._id);
  }
  async function login(name: string) {
    const r = await request(app).post('/api/v1/auth/login').set('X-CampusCare-Client', 'android').send({ email: `${name}@srmap.edu.in`, password: PASSWORD });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    agents[name] = request.agent(app).set('Authorization', `Bearer ${r.body.data.sessionToken}`).set('X-CampusCare-Client', 'android') as unknown as Agent;
  }
  async function webLogin(email: string) {
    const agent = request.agent(app);
    const csrf = (await agent.get('/api/v1/auth/csrf')).body.data.csrfToken as string;
    const r = await agent.post('/api/v1/auth/login').set('x-csrf-token', csrf).send({ email, password: PASSWORD });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const c = (r.headers['set-cookie'] as unknown as string[] | undefined)?.find((x) => x.startsWith('cc_csrf='));
    return { agent: agent as unknown as Agent, csrf: c ? c.split(';')[0]!.split('=')[1]! : csrf };
  }
  const weekly = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '08:00', end: '20:00' }));
  async function setSchedule(name: string) {
    const r = await agents[name]!.put(`${API}/schedule`).send({ weekly, slotMinutes: 60 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    await M.Availability.updateOne({ counsellorId: ids[name] }, { $set: { acceptingRequests: true } });
  }
  /** A completed session (the only thing that opens feedback). */
  async function completed(student: string, counsellor: string) {
    const a = await M.Appointment.create({
      studentId: ids[student], counsellorId: ids[counsellor], startAt: new Date(Date.now() - 86400_000), endAt: new Date(Date.now() - 82800_000),
      status: 'completed', idempotencyKey: randomUUID(),
    });
    return String(a._id);
  }
  const feedback = (student: string, apptId: string, body: Record<string, unknown>) => agents[student]!.post(`${API}/appointments/${apptId}/feedback`).send(body);
  const profile = async (viewer: string, counsellor: string) => (await agents[viewer]!.get(`${API}/counsellors/${ids[counsellor]}`)).body.data;
  const admin = (path: string) => root.agent.patch(`${API}${path}`).set('x-csrf-token', root.csrf);

  beforeAll(async () => {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    mongo = await MongoMemoryServer.create();
    await (await import('../src/db/connect')).connectDatabase(mongo.getUri());
    app = (await import('../src/app')).createApp();
    M = {
      ...(await import('../src/models/user')), ...(await import('../src/models/counselling')), ...(await import('../src/models/wellness')),
      ...(await import('../src/models/platform')), ...(await import('../src/models/content')),
    };
    settings = await import('../src/services/settings.service');
    for (const name of mongoose.modelNames()) await mongoose.model(name).syncIndexes();
    await settings.updateSettings({ turnstile: { enabled: false }, security: { requireMfaForSuperAdmin: false } } as never, '000000000000000000000000');
    hash = await (await import('../src/lib/crypto')).hashPassword(PASSWORD);
    for (const s of ['s1', 's2', 's3', 's4', 's5']) await makeUser(s, 'student', { studentId: `AP2211001${s.slice(1)}` });
    await makeUser('maya', 'counsellor', { department: 'Student Wellness' });
    await makeUser('ravi', 'counsellor', { department: 'Career Services' });
    await makeUser('pending', 'counsellor', { accountStatus: 'pending_verification' });
    await makeUser('gone', 'counsellor', { accountStatus: 'suspended' });
    await makeUser('campusadm', 'admin');
    await makeUser('root', 'super_admin');
    for (const n of ['s1', 's2', 's3', 's4', 's5', 'maya', 'ravi', 'campusadm']) await login(n);
    root = await webLogin('root@srmap.edu.in');
    await setSchedule('maya');
    await setSchedule('ravi');
    await M.Availability.updateOne({ counsellorId: ids.maya }, { $set: { bio: 'Supports anxiety and exam stress.', languages: ['English', 'Telugu'], specializations: ['anxiety_mental_health', 'academic_stress'] } });
    await M.Availability.updateOne({ counsellorId: ids.ravi }, { $set: { languages: ['English', 'Hindi'], specializations: ['career'] } });
    // Counsellors that must never appear, even with a schedule.
    for (const n of ['pending', 'gone']) await M.Availability.create({ counsellorId: ids[n], weekly, slotMinutes: 60, acceptingRequests: true });
  }, 180_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo?.stop();
  });

  it('lists only verified, active, listed counsellors and returns an explicit allowlist of public fields', async () => {
    const r = await agents.s1!.get(`${API}/counsellors`);
    expect(r.status).toBe(200);
    expect(r.headers['x-total-count']).toBe('2');
    const list = r.body.data as Record<string, unknown>[];
    expect(list.map((c) => c.id).sort()).toEqual([ids.maya, ids.ravi].sort());
    const maya = list.find((c) => c.id === ids.maya)!;
    expect(Object.keys(maya).sort()).toEqual([
      'acceptingRequests', 'availability', 'avatarUrl', 'bio', 'campus', 'department', 'id', 'languages', 'name', 'nextAvailableAt', 'onDuty', 'photoUrl',
      'qualifications', 'rating', 'slotMinutes', 'slotsToday', 'specializations', 'supportedModes', 'timezone', 'title', 'yearsExperience',
    ]);
    expect(maya.department).toBe('Student Wellness');
    const raw = JSON.stringify(r.body);
    expect(raw).not.toMatch(/@srmap\.edu\.in|90000|EMP-|permissions|passwordHash|listed|caseload/);
    // Direct profile access is refused for ineligible accounts.
    expect((await agents.s1!.get(`${API}/counsellors/${ids.pending}`)).status).toBe(404);
    expect((await agents.s1!.get(`${API}/counsellors/${ids.gone}`)).status).toBe(404);
  });

  it('searches by name, specialisation, language and department, and sorts', async () => {
    const q = async (qs: string) => ((await agents.s1!.get(`${API}/counsellors?${qs}`)).body.data as { id: string }[]).map((c) => c.id);
    expect(await q('q=maya')).toEqual([ids.maya]);
    expect(await q('q=anxiety')).toEqual([ids.maya]);
    expect(await q('q=career%20services')).toEqual([ids.ravi]);
    expect(await q('q=hindi')).toEqual([ids.ravi]);
    expect(await q('department=student%20wellness')).toEqual([ids.maya]);
    expect(await q('specialization=career')).toEqual([ids.ravi]);
    expect(await q('q=nobody-like-this')).toEqual([]);
    expect(await q('sort=name')).toEqual([ids.maya, ids.ravi]);
    expect((await q('sort=availability')).sort()).toEqual([ids.maya, ids.ravi].sort());
    const paged = await agents.s1!.get(`${API}/counsellors?page=2&limit=1`);
    expect(paged.body.data).toHaveLength(1);
    expect(paged.headers['x-total-count']).toBe('2');
  });

  it('accepts feedback only for the student’s own completed appointments, once each', async () => {
    const upcoming = await M.Appointment.create({ studentId: ids.s1, counsellorId: ids.maya, startAt: new Date(Date.now() + 86400_000), status: 'confirmed', idempotencyKey: randomUUID() });
    expect((await feedback('s1', String(upcoming._id), { rating: 5 })).body.error.code).toBe('not_completed');
    const appt = await completed('s1', 'maya');
    expect((await feedback('s2', appt, { rating: 1 })).status).toBe(404); // someone else's appointment
    expect((await agents.maya!.post(`${API}/appointments/${appt}/feedback`).send({ rating: 5 })).status).toBe(403); // no self-review
    expect((await request(app).post(`${API}/appointments/${appt}/feedback`).set('X-CampusCare-Client', 'android').send({ rating: 5 })).status).toBe(401);
    expect((await feedback('s1', appt, { rating: 5, comment: 'Calm and kind. Call me on 98765 43210', sharePublicly: true })).status).toBe(201);
    expect((await feedback('s1', appt, { rating: 1 })).body.error.code).toBe('already_submitted');
    const stored = await M.CounsellingFeedback.findOne({ counsellorId: ids.maya }).lean();
    expect(stored!.raterKey).toMatch(/^[0-9a-f]{64}$/);
    expect(stored!.studentId).toBeNull(); // anonymous by default
    expect(stored!.publicComment).toBe('pending');
    expect(stored!.publicText).toBe('Calm and kind. Call me on [number removed]');
  });

  it('keeps ratings, distribution, themes and comments private until enough distinct students have given feedback', async () => {
    // The same student's further sessions never unlock the threshold.
    for (let i = 0; i < 3; i++) expect((await feedback('s1', await completed('s1', 'maya'), { rating: 5, categories: ['listened'] })).status).toBe(201);
    let p = await profile('s2', 'maya');
    expect(p.rating).toEqual({ status: 'insufficient', minimum: 3 });
    expect(p.comments).toEqual([]);
    expect(JSON.stringify((await agents.s2!.get(`${API}/counsellors`)).body.data)).not.toMatch(/"average"/);

    // A concern never counts publicly; a second student still leaves it below three.
    expect((await feedback('s2', await completed('s2', 'maya'), { rating: 1, concern: true, comment: 'Worried about conduct' })).status).toBe(201);
    expect((await feedback('s3', await completed('s3', 'maya'), { categories: ['felt_safe'] })).status).toBe(201);
    p = await profile('s4', 'maya');
    expect(p.rating.status).toBe('insufficient');

    // Three distinct students, but only one of them gave stars: themes are public, the average is not.
    expect((await feedback('s4', await completed('s4', 'maya'), { categories: ['listened'] })).status).toBe(201);
    p = await profile('s5', 'maya');
    expect(p.rating.status).toBe('available');
    expect(p.rating.average).toBeNull();
    expect(p.rating.distribution).toBeNull();
    expect(p.rating.themes[0]).toEqual({ category: 'listened', count: 4 });

    // Stars from three distinct students: the average and distribution appear, computed on the server.
    expect((await feedback('s5', await completed('s5', 'maya'), { rating: 3 })).status).toBe(201);
    expect((await feedback('s3', await completed('s3', 'maya'), { rating: 4 })).status).toBe(201);
    p = await profile('s2', 'maya');
    expect(p.rating.ratingCount).toBe(6); // 4×5 from s1, 3 from s5, 4 from s3 (the concern is excluded)
    expect(p.rating.average).toBe(4.5);
    expect(p.rating.distribution).toEqual({ 1: 0, 2: 0, 3: 1, 4: 1, 5: 4 });
    // The pending comment is not public yet.
    expect(p.comments).toEqual([]);

    // Raising the threshold applies everywhere, including the list.
    await settings.updateSettings({ counsellorDirectory: { feedbackMinimum: 5 } }, ids.root!);
    expect((await profile('s2', 'maya')).rating.status).toBe('insufficient');
    const listed = (await agents.s2!.get(`${API}/counsellors?sort=rating`)).body.data.find((c: { id: string }) => c.id === ids.maya);
    expect(listed.rating).toEqual({ status: 'insufficient', minimum: 5 });
    await expect(settings.updateSettings({ counsellorDirectory: { feedbackMinimum: 2 } }, ids.root!)).rejects.toThrow(/3–50/);
    await settings.updateSettings({ counsellorDirectory: { feedbackMinimum: 3 } }, ids.root!);
  });

  it('publishes a comment only after moderation, masks moderator edits, and withdraws it when reported', async () => {
    const pending = await M.CounsellingFeedback.findOne({ counsellorId: ids.maya, publicComment: 'pending' }).lean();
    expect((await agents.maya!.patch(`${API}/feedback/${pending!._id}`).send({ status: 'reviewed', publicComment: 'approved' })).status).toBe(403);
    const concern = await M.CounsellingFeedback.findOne({ counsellorId: ids.maya, concern: true }).lean();
    expect((await admin(`/feedback/${concern!._id}`).send({ status: 'reviewed', publicComment: 'approved' })).body.error.code).toBe('no_consent');

    const ok = await admin(`/feedback/${pending!._id}`).send({ status: 'reviewed', publicComment: 'approved', publicText: 'Calm and kind. Email x@y.com' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.publicText).toBe('Calm and kind. Email [email removed]');
    expect(await M.AuditLog.countDocuments({ action: 'counselling.feedback_public_moderated', targetId: String(pending!._id) })).toBe(1);

    const p = await profile('s2', 'maya');
    expect(p.comments).toEqual([{ ref: expect.stringMatching(/^[0-9a-f]{24}$/), text: 'Calm and kind. Email [email removed]' }]);
    expect(JSON.stringify(p)).not.toMatch(new RegExp(String(pending!._id))); // no linkable id or date

    const ref = p.comments[0].ref;
    const rep = await agents.s3!.post(`${API}/counsellors/${ids.maya}/comments/${ref}/report`).send({ reason: 'identifying' });
    expect(rep.status, JSON.stringify(rep.body)).toBe(201);
    expect((await profile('s2', 'maya')).comments).toEqual([]);
    expect((await agents.s3!.post(`${API}/counsellors/${ids.maya}/comments/${ref}/report`).send({ reason: 'identifying' })).status).toBe(404); // already withdrawn
    const after = await M.CounsellingFeedback.findById(pending!._id).lean();
    expect([after!.publicComment, after!.reportCount]).toEqual(['pending', 1]);
    expect(await M.AuditLog.countDocuments({ action: 'counselling.feedback_reported' })).toBe(1);

    // Hiding an item removes it from every public figure.
    await admin(`/feedback/${pending!._id}`).send({ status: 'reviewed', hiddenFromPublic: true });
    expect((await profile('s2', 'maya')).rating.ratingCount).toBe(5);
  });

  it('books from a profile: re-validated on the server, one winner per slot, both sides notified', async () => {
    const p = await profile('s1', 'ravi');
    const slot = (p.days as { slots: string[] }[]).find((x) => x.slots.length)!.slots[0]!;
    const book = (s: string) => agents[s]!.post(`${API}/appointments`).send({ counsellorId: ids.ravi, startAt: slot, mode: 'online', idempotencyKey: randomUUID() });
    const [a, b] = await Promise.all([book('s4'), book('s5')]);
    expect([a.status, b.status].filter((x) => x === 201)).toHaveLength(1);
    expect(await M.Appointment.countDocuments({ counsellorId: ids.ravi, startAt: new Date(slot) })).toBe(1);
    const winner = a.status === 201 ? 's4' : 's5';
    expect(await M.Notification.countDocuments({ userId: ids.ravi, kind: 'appointment' })).toBeGreaterThan(0);
    expect(await M.Notification.countDocuments({ userId: ids[winner], kind: 'appointment' })).toBeGreaterThan(0);
    const mine = (await agents[winner]!.get(`${API}/appointments`)).body.data as { id: string; status: string }[];
    expect(mine.some((x) => x.status === 'requested')).toBe(true);
    // The student can cancel; the slot opens again.
    const cancel = await agents[winner]!.patch(`${API}/appointments/${mine.find((x) => x.status === 'requested')!.id}`).send({ status: 'cancelled', reason: 'Exam moved' });
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    expect((await book('s1')).status).toBe(201);
  });

  it('lets a counsellor edit public fields while credentials wait for approval and protected fields stay untouched', async () => {
    const r = await agents.ravi!.put(`${API}/profile/public`).send({
      title: 'Career Counsellor', bio: 'Helps with placements.', languages: ['English', 'Hindi', 'Telugu'],
      qualifications: ['M.A. Psychology'], yearsExperience: 7, listed: false, rating: 5, role: 'super_admin', permissions: ['super_admin:access'],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.credentialsPending).toBe(true);
    const u = await M.User.findById(ids.ravi).lean();
    expect([u!.role, u!.permissions ?? []]).toEqual(['counsellor', []]);
    let p = await profile('s1', 'ravi');
    expect([p.title, p.bio]).toEqual(['Career Counsellor', 'Helps with placements.']);
    expect([p.qualifications, p.yearsExperience]).toEqual([[], null]); // not approved yet
    expect((await agents.ravi!.put(`${API}/profile/public`).send({ specializations: ['astrology'] })).status).toBe(422);
    expect((await agents.s1!.put(`${API}/profile/public`).send({ bio: 'x' })).status).toBe(403);
    expect(await M.Notification.countDocuments({ userId: ids.root, kind: 'counsellor_credentials' })).toBe(1);

    expect((await admin(`/admin/counsellors/${ids.ravi}/directory`).send({ credentials: 'approve', reason: 'Verified with HR records' })).status).toBe(200);
    p = await profile('s1', 'ravi');
    expect([p.qualifications, p.yearsExperience]).toEqual([['M.A. Psychology'], 7]);
    expect(await M.AuditLog.countDocuments({ action: 'counsellor.directory_updated', targetId: ids.ravi })).toBe(1);
  });

  it('restricts directory administration to Super Admins and makes unlisting take effect everywhere', async () => {
    expect((await agents.campusadm!.get(`${API}/admin/directory`)).status).toBe(403);
    expect((await agents.campusadm!.patch(`${API}/admin/counsellors/${ids.ravi}/directory`).send({ listed: false, reason: 'Testing access' })).status).toBe(403);
    expect((await agents.maya!.patch(`${API}/admin/counsellors/${ids.maya}/directory`).send({ listed: true, reason: 'Self-approval' })).status).toBe(403);
    expect((await admin(`/admin/counsellors/${ids.ravi}/directory`).send({ listed: false })).status).toBe(422); // reason required

    const overview = (await root.agent.get(`${API}/admin/directory`)).body.data;
    expect(overview.items.map((x: { id: string }) => x.id)).toEqual(expect.arrayContaining([ids.maya, ids.ravi, ids.pending, ids.gone]));
    expect(overview.settings.feedbackMinimum).toBe(3);
    expect(JSON.stringify(overview)).not.toMatch(/s[1-5]@srmap|AP22110/); // no student identity

    const slot = ((await profile('s2', 'ravi')).days as { slots: string[] }[]).find((x) => x.slots.length)!.slots[1]!;
    expect((await admin(`/admin/counsellors/${ids.ravi}/directory`).send({ listed: false, reason: 'Profile under review' })).status).toBe(200);
    expect((await agents.s2!.get(`${API}/counsellors`)).body.data.map((c: { id: string }) => c.id)).toEqual([ids.maya]);
    expect((await agents.s2!.get(`${API}/counsellors/${ids.ravi}`)).status).toBe(404);
    const refused = await agents.s2!.post(`${API}/appointments`).send({ counsellorId: ids.ravi, startAt: slot, mode: 'online', idempotencyKey: randomUUID() });
    expect(refused.body.error.code).toBe('not_bookable');
    expect((await agents.campusadm!.get(`${API}/counsellors`)).body.data.map((c: { id: string }) => c.id)).toContain(ids.ravi); // staff still see them
    expect(await M.Notification.countDocuments({ userId: ids.ravi, kind: 'counsellor_profile' })).toBe(2);
  });
});

describe('sanitizeFeedbackText', () => {
  it('strips markup and masks obvious identifiers, without claiming to anonymise', () => {
    expect(sanitizeFeedbackText('<script>alert(1)</script>Great <b>session</b>')).toBe('alert(1) Great session');
    expect(sanitizeFeedbackText('I am AP22110010123, mail a.b@srmap.edu.in, call +91 98765 43210')).toBe('I am [id removed], mail [email removed], call [number removed]');
    expect(sanitizeFeedbackText('see https://insta.com/me or @priya_k')).toBe('see [link removed] or [handle removed]');
    expect(sanitizeFeedbackText('Session on 12 March helped a lot')).toBe('Session on 12 March helped a lot');
    expect(sanitizeFeedbackText('x'.repeat(500))).toHaveLength(400);
  });
});
