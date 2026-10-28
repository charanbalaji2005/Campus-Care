/**
 * Counselling wellness workflow: directory, schedule/duty, concurrent booking, one-hour response
 * deadline with reassignment, chat activation on acceptance, anonymous feedback, reminders, analytics.
 * Private in-memory MongoDB; console email; no push. SKIP_DB_TESTS=true skips.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';

const d = process.env.SKIP_DB_TESTS === 'true' ? describe.skip : describe;
const PASSWORD = 'Wellness-Test-9';
const API = '/api/v1/counselling';
type Agent = ReturnType<typeof request.agent>;

d('Counselling wellness (integration)', () => {
  let mongo: { stop: () => Promise<boolean>; getUri: () => string };
  let app: import('express').Express;
  let M: typeof import('../src/models/user') & typeof import('../src/models/counselling') & typeof import('../src/models/chat')
    & typeof import('../src/models/wellness') & typeof import('../src/models/platform') & typeof import('../src/models/content');
  let jobs: typeof import('../src/services/jobs.service');
  let workflow: typeof import('../src/services/counselling-workflow.service');
  let hash: string;
  const ids: Record<string, string> = {};
  const agents: Record<string, Agent> = {};

  async function makeUser(name: string, role: string) {
    const u = await M.User.create({ fullName: `${name} Person`, email: `${name}@srmap.edu.in`, role, passwordHash: hash, emailVerified: true, accountStatus: 'active' });
    ids[name] = String(u._id);
  }
  async function login(name: string) {
    const r = await request(app).post('/api/v1/auth/login').set('X-CampusCare-Client', 'android').send({ email: `${name}@srmap.edu.in`, password: PASSWORD });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    agents[name] = request.agent(app).set('Authorization', `Bearer ${r.body.data.sessionToken}`).set('X-CampusCare-Client', 'android') as unknown as Agent;
  }
  const weekly = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '08:00', end: '20:00' }));
  async function setSchedule(name: string, extra: Record<string, unknown> = {}) {
    const r = await agents[name]!.put(`${API}/schedule`).send({ weekly, slotMinutes: 60, ...extra });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    await M.Availability.updateOne({ counsellorId: ids[name] }, { $set: { acceptingRequests: true } });
  }
  const slots = async (counsellor: string) => ((await agents.stu1!.get(`${API}/counsellors/${ids[counsellor]}/slots`)).body.data.days as { date: string; slots: string[] }[]).filter((x) => x.slots.length);
  const book = (student: string, counsellor: string, startAt: string, extra: Record<string, unknown> = {}) =>
    agents[student]!.post(`${API}/appointments`).send({ counsellorId: ids[counsellor], startAt, mode: 'online', idempotencyKey: randomUUID(), ...extra });
  async function expireJobs() {
    await M.Job.updateMany({ status: 'pending', type: /^counselling\./ }, { $set: { runAt: new Date(Date.now() - 1000) } });
    await jobs.runDueJobs(50);
  }

  beforeAll(async () => {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    mongo = await MongoMemoryServer.create();
    await (await import('../src/db/connect')).connectDatabase(mongo.getUri());
    app = (await import('../src/app')).createApp();
    M = {
      ...(await import('../src/models/user')), ...(await import('../src/models/counselling')), ...(await import('../src/models/chat')),
      ...(await import('../src/models/wellness')), ...(await import('../src/models/platform')), ...(await import('../src/models/content')),
    };
    jobs = await import('../src/services/jobs.service');
    workflow = await import('../src/services/counselling-workflow.service');
    for (const name of mongoose.modelNames()) await mongoose.model(name).syncIndexes();
    await (await import('../src/services/settings.service')).updateSettings({ turnstile: { enabled: false }, security: { requireMfaForSuperAdmin: false } } as never, '000000000000000000000000');
    hash = await (await import('../src/lib/crypto')).hashPassword(PASSWORD);
    for (const s of ['stu1', 'stu2', 'stu3', 'stu4', 'stu5', 'stu6']) await makeUser(s, 'student');
    for (const c of ['couA', 'couB', 'couC']) await makeUser(c, 'counsellor');
    await makeUser('adm', 'admin');
    for (const n of Object.keys(ids)) await login(n);
    await setSchedule('couA');
    await setSchedule('couB');
    await setSchedule('couC');
  }, 180_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo?.stop();
  });

  it('builds the directory from real schedules and hides off-duty counsellors from students', async () => {
    const dir = (await agents.stu1!.get(`${API}/counsellors`)).body.data as { id: string; nextAvailableAt: string | null; specializations: string[]; languages: string[] }[];
    expect(dir.map((c) => c.id).sort()).toEqual([ids.couA, ids.couB, ids.couC].sort());
    expect(dir.every((c) => c.nextAvailableAt)).toBe(true);
    expect(JSON.stringify(dir)).not.toMatch(/caseload|workload|studentId/i);

    const off = await agents.couC!.put(`${API}/duty`).send({ onDuty: false, reason: 'Training day' });
    expect(off.status).toBe(200);
    expect(off.body.data.onDuty).toBe(false);
    expect((await agents.stu1!.get(`${API}/counsellors`)).body.data.map((c: { id: string }) => c.id)).not.toContain(ids.couC);
    expect((await agents.stu1!.get(`${API}/counsellors/${ids.couC}/slots`)).body.data.slots).toEqual([]);
    expect((await agents.adm!.get(`${API}/counsellors`)).body.data.map((c: { id: string }) => c.id)).toContain(ids.couC); // staff still see them
    const audit = await M.AuditLog.findOne({ action: 'counsellor.off_duty' }).lean();
    expect(audit).toBeTruthy();

    // Language filter uses real profile data.
    await M.Availability.updateOne({ counsellorId: ids.couA }, { $set: { languages: ['Tamil'] } });
    expect((await agents.stu1!.get(`${API}/counsellors?language=tamil`)).body.data.map((c: { id: string }) => c.id)).toEqual([ids.couA]);
  });

  it('shows the default capacity of 10 and lets the counsellor set another permitted value', async () => {
    const sched = (await agents.couA!.get(`${API}/schedule`)).body.data;
    expect(sched.maxDailySessions).toBe(10);
    expect(sched.days[1].capacity).toBe(10);
    expect((await agents.couA!.put(`${API}/schedule`).send({ weekly, slotMinutes: 60, maxDailySessions: 30 })).status).toBe(422);
    expect((await agents.couA!.put(`${API}/schedule`).send({ weekly: [{ weekday: 1, start: '12:00', end: '10:00' }] })).status).toBe(422);
    expect((await agents.stu1!.put(`${API}/schedule`).send({ weekly })).status).toBe(403);
  });

  it('never double-books a slot or a full day, even with simultaneous requests', async () => {
    const day = (await slots('couB'))[1]!;
    // The loser gets 409 when the requests truly overlap, or 422 ("pick an available slot") if it arrives
    // just after the winner committed. Either way exactly one booking exists for the slot.
    const [a, b] = await Promise.all([book('stu1', 'couB', day.slots[0]!), book('stu2', 'couB', day.slots[0]!)]);
    expect([a.status, b.status].filter((x) => x === 201)).toHaveLength(1);
    expect([409, 422]).toContain(a.status === 201 ? b.status : a.status);
    expect(await M.Appointment.countDocuments({ counsellorId: ids.couB, startAt: new Date(day.slots[0]!) })).toBe(1);

    await M.Availability.updateOne({ counsellorId: ids.couB }, { $set: { maxDailySessions: 2 } });
    const other = (await slots('couB')).find((x) => x.date === day.date)!;
    const [c, e] = await Promise.all([book('stu3', 'couB', other.slots[0]!), book('stu4', 'couB', other.slots[1]!)]);
    expect([c.status, e.status].filter((x) => x === 201)).toHaveLength(1);
    const loser = c.status === 201 ? e : c;
    expect(['day_full', 'slot_taken', 'invalid_slot']).toContain(loser.body.error.code);
    expect(await M.Appointment.countDocuments({ counsellorId: ids.couB, status: 'requested' })).toBe(2);
    expect((await slots('couB')).some((x) => x.date === day.date)).toBe(false); // day is now full
    await M.Availability.updateOne({ counsellorId: ids.couB }, { $set: { maxDailySessions: 10 } });
  });

  it('opens the private chat only when the assigned counsellor accepts', async () => {
    const slot = (await slots('couA'))[2]!.slots[0]!;
    const r = await book('stu5', 'couA', slot);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const id = r.body.data.id as string;
    expect(new Date(r.body.data.responseDueAt).getTime() - Date.now()).toBeGreaterThan(59 * 60_000);
    let appt = await M.Appointment.findById(id).lean();
    expect(appt!.threadId).toBeNull();
    expect(await M.Job.countDocuments({ type: /^counselling\.response/, 'payload.appointmentId': id })).toBe(2);

    // Only the assigned counsellor can accept; an administrator cannot accept on their behalf.
    expect((await agents.adm!.patch(`${API}/appointments/${id}`).send({ status: 'confirmed' })).status).toBe(403);
    expect((await agents.couB!.patch(`${API}/appointments/${id}`).send({ status: 'confirmed' })).status).toBe(404);
    const accepted = await agents.couA!.patch(`${API}/appointments/${id}`).send({ status: 'confirmed' });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(accepted.body.data.chatOpen).toBe(true);
    appt = await M.Appointment.findById(id).lean();
    const thread = String(appt!.threadId);
    const members = (await M.ChatMembership.find({ channelId: thread }).lean()).map((m) => String(m.userId)).sort();
    expect(members).toEqual([ids.stu5, ids.couA].sort());
    expect((await agents.stu5!.post(`/api/v1/chat/channels/${thread}/messages`).send({ body: 'Hello', clientMessageId: randomUUID() })).status).toBe(201);
    expect((await agents.couB!.get(`/api/v1/chat/channels/${thread}/messages`)).status).toBe(404);
    const note = await M.Notification.findOne({ userId: ids.stu5, kind: 'counselling_accepted' }).lean();
    expect(note!.link).toBe(`/student/support/${thread}`);
    expect(await M.ChatChannel.countDocuments({ appointmentId: id })).toBe(1);

    // Accepting cancels the deadline: the jobs run and change nothing.
    await expireJobs();
    expect((await M.Appointment.findById(id).lean())!.counsellorId!.toString()).toBe(ids.couA);
    expect((await M.Appointment.findById(id).lean())!.timedOutBy).toHaveLength(0);
    // Upcoming reminders were scheduled for both people.
    expect(await M.CounsellingReminder.countDocuments({ appointmentId: id, kind: 'upcoming', status: 'pending' })).toBe(2);
  });

  it('reassigns an unanswered request after an hour when the student agreed, with a fresh deadline', async () => {
    const slot = (await slots('couA'))[3]!.slots[0]!;
    const r = await book('stu6', 'couA', slot, { allowReassignment: true });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const id = r.body.data.id as string;
    await expireJobs();
    const appt = await M.Appointment.findById(id).lean();
    expect(appt!.status).toBe('requested');
    expect(String(appt!.counsellorId)).not.toBe(ids.couA);
    expect(appt!.timedOutBy.map(String)).toContain(ids.couA);
    expect(appt!.responseDueAt!.getTime()).toBeGreaterThan(Date.now() + 59 * 60_000);
    expect(String(appt!.startAt)).toBe(String(new Date(slot))); // the student's time is kept when the new counsellor is free
    expect((await agents.couA!.patch(`${API}/appointments/${id}`).send({ status: 'confirmed' })).status).toBe(404); // previous counsellor lost it
    expect(await M.Notification.exists({ userId: ids.couA, kind: 'counselling_response_overdue' })).toBeTruthy();
    expect(await M.AuditLog.exists({ action: 'counselling.request_reassigned', targetId: id })).toBeTruthy();
  });

  it('does not silently replace a counsellor the student chose without consent', async () => {
    const slot = (await slots('couB'))[4]!.slots[0]!;
    const r = await book('stu1', 'couB', slot);
    const id = r.body.data.id as string;
    await expireJobs();
    const appt = await M.Appointment.findById(id).lean();
    expect(String(appt!.counsellorId)).toBe(ids.couB);
    expect(appt!.responseOverdueAt).toBeTruthy();
    const told = await M.Notification.findOne({ userId: ids.stu1, title: 'Update on your request' }).sort({ createdAt: -1 }).lean();
    expect(told!.body).toMatch(/choose another counsellor/);
    expect(await M.Notification.exists({ userId: ids.adm, kind: 'counselling_overdue' })).toBeTruthy();
  });

  it('reassigns immediately on decline when allowed, otherwise closes the request', async () => {
    const s1 = (await slots('couA'))[5]!.slots[0]!;
    const consent = await book('stu2', 'couA', s1, { allowReassignment: true });
    const declined = await agents.couA!.patch(`${API}/appointments/${consent.body.data.id}`).send({ status: 'rejected', reason: 'Conflict of interest' });
    expect(declined.status).toBe(200);
    expect(declined.body.data.reassigned).toBe(true);
    expect(declined.body.data.status).toBe("rejected"); // from the declining counsellor's point of view
    const moved = await M.Appointment.findById(consent.body.data.id).lean();
    expect(String(moved!.counsellorId)).not.toBe(ids.couA);
    expect(moved!.declinedBy.map(String)).toContain(ids.couA);

    const s2 = (await slots('couA'))[6]!.slots[0]!;
    const noConsent = await book('stu3', 'couA', s2);
    const closed = await agents.couA!.patch(`${API}/appointments/${noConsent.body.data.id}`).send({ status: 'rejected', reason: 'Unavailable' });
    expect(closed.body.data.status).toBe('rejected');
  });

  it('keeps feedback anonymous, single-use and away from the counsellor until there is enough of it', async () => {
    const completed: string[] = [];
    for (const s of ['stu1', 'stu2', 'stu3', 'stu4']) {
      const a = await M.Appointment.create({ studentId: ids[s], counsellorId: ids.couA, status: 'completed', startAt: new Date(Date.now() - 86400_000), idempotencyKey: randomUUID() });
      completed.push(String(a._id));
    }
    const pending = await M.Appointment.create({ studentId: ids.stu5, counsellorId: ids.couA, status: 'confirmed', startAt: new Date(Date.now() + 86400_000), idempotencyKey: randomUUID() });
    expect((await agents.stu5!.post(`${API}/appointments/${pending._id}/feedback`).send({ rating: 5 })).status).toBe(422);
    expect((await agents.stu2!.post(`${API}/appointments/${completed[0]}/feedback`).send({ rating: 5 })).status).toBe(404); // not their appointment

    const first = await agents.stu1!.post(`${API}/appointments/${completed[0]}/feedback`).send({ rating: 4, categories: ['listened'], comment: 'Kind and patient' });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.data.notice).toMatch(/Anonymous feedback/);
    expect((await agents.stu1!.post(`${API}/appointments/${completed[0]}/feedback`).send({ rating: 1 })).status).toBe(409);
    const stored = await M.CounsellingFeedback.findOne({}).lean();
    expect(stored!.studentId).toBeNull();
    expect(JSON.stringify(stored)).not.toContain(ids.stu1);
    expect(JSON.stringify(stored)).not.toContain(completed[0]);

    let summary = (await agents.couA!.get(`${API}/feedback/summary`)).body.data;
    expect(summary.count).toBe(1);
    expect(summary.comments).toEqual([]); // below the group threshold
    expect(summary.averageRating).toBeNull();

    await agents.stu2!.post(`${API}/appointments/${completed[1]}/feedback`).send({ rating: 5, comment: 'Very helpful' });
    await agents.stu3!.post(`${API}/appointments/${completed[2]}/feedback`).send({ rating: 3 });
    await agents.stu4!.post(`${API}/appointments/${completed[3]}/feedback`).send({ rating: 1, comment: 'Made me uncomfortable', concern: true, anonymous: false });
    summary = (await agents.couA!.get(`${API}/feedback/summary`)).body.data;
    expect(summary.count).toBe(3); // the concern is routed to staff, not the counsellor
    expect(summary.averageRating).toBe(4);
    expect(summary.comments.sort()).toEqual(['Kind and patient', 'Very helpful']);
    expect(JSON.stringify(summary)).not.toContain('uncomfortable');

    expect((await agents.couA!.get(`${API}/feedback`)).status).toBe(403);
    expect((await agents.stu1!.get(`${API}/feedback`)).status).toBe(403);
    const mod = (await agents.adm!.get(`${API}/feedback?concern=true`)).body.data.items as { id: string; student: string | null; anonymous: boolean }[];
    expect(mod).toHaveLength(1);
    expect(mod[0]!.student).toBe('stu4 Person'); // this student chose to be named
    const all = (await agents.adm!.get(`${API}/feedback`)).body.data.items as { anonymous: boolean; student: string | null }[];
    expect(all.filter((x) => x.anonymous).every((x) => x.student === null)).toBe(true);
    expect((await agents.adm!.patch(`${API}/feedback/${mod[0]!.id}`).send({ status: 'escalated', note: 'Referred to the committee' })).status).toBe(200);
    expect(await M.AuditLog.exists({ action: 'counselling.feedback_escalated' })).toBeTruthy();
    expect(await M.Notification.exists({ userId: ids.adm, kind: 'counselling_feedback_concern' })).toBeTruthy();
  });

  it('sends lock-screen safe reminders, keeps task notes private, and cancels with the appointment', async () => {
    const appt = await M.Appointment.create({ studentId: ids.stu6, counsellorId: ids.couB, status: 'confirmed', startAt: new Date(Date.now() + 3 * 3600_000), endAt: new Date(Date.now() + 4 * 3600_000), idempotencyKey: randomUUID() });
    const due = new Date(Date.now() + 5 * 60_000).toISOString();
    expect((await agents.couB!.post(`${API}/appointments/${appt._id}/reminders`).send({ dueAt: due, note: 'Ask about exam anxiety plan', audience: 'self' })).status).toBe(201);
    expect((await agents.couB!.post(`${API}/appointments/${appt._id}/reminders`).send({ dueAt: due, audience: 'student' })).status).toBe(201);
    expect((await agents.stu6!.post(`${API}/appointments/${appt._id}/reminders`).send({ dueAt: due, audience: 'student' })).status).toBe(403);
    expect((await agents.stu6!.post(`${API}/appointments/${appt._id}/reminders`).send({ dueAt: due })).status).toBe(201);
    expect((await agents.stu1!.get(`${API}/appointments/${appt._id}/reminders`)).status).toBe(404);
    const studentView = JSON.stringify((await agents.stu6!.get(`${API}/appointments/${appt._id}/reminders`)).body.data);
    expect(studentView).not.toContain('exam anxiety');

    await M.CounsellingReminder.updateMany({ appointmentId: appt._id }, { $set: { dueAt: new Date(Date.now() - 1000) } });
    expect(await workflow.sendDueReminders()).toBe(3);
    const sent = await M.Notification.find({ kind: 'appointment_reminder', userId: { $in: [ids.stu6, ids.couB] } }).lean();
    expect(sent.length).toBeGreaterThanOrEqual(3);
    for (const n of sent) expect(`${n.title} ${n.body}`).not.toMatch(/counsell|anxiety/i);

    // Cancelling the appointment cancels what is still pending.
    await agents.couB!.post(`${API}/appointments/${appt._id}/reminders`).send({ dueAt: new Date(Date.now() + 3600_000).toISOString() });
    expect((await agents.stu6!.patch(`${API}/appointments/${appt._id}`).send({ status: 'cancelled' })).status).toBe(200);
    expect(await M.CounsellingReminder.countDocuments({ appointmentId: appt._id, status: 'pending' })).toBe(0);
  });

  it('reports aggregate analytics to authorised staff only, without student identity', async () => {
    expect((await agents.couA!.get(`${API}/analytics`)).status).toBe(403);
    expect((await agents.stu1!.get(`${API}/analytics`)).status).toBe(403);
    const r = await agents.adm!.get(`${API}/analytics`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const a = r.body.data;
    expect(a.volume.total).toBeGreaterThan(5);
    expect(a.capacity.openSlotsNext14Days).toBeGreaterThan(0);
    expect(a.responseTime.measured).toBeGreaterThan(0);
    expect(a.responseTime.compliance).toBeGreaterThan(0);
    expect(a.responseTime.compliance).toBeLessThan(1); // one request timed out above
    expect(a.feedback.count).toBe(4);
    expect(a.feedback.concerns).toBe(1);
    const json = JSON.stringify(a);
    for (const s of ['stu1', 'stu2', 'stu3', 'stu4', 'stu5', 'stu6']) expect(json).not.toContain(ids[s]!);
    expect(json).not.toContain('uncomfortable');
  });
});
