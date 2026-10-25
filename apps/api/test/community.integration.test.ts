/**
 * Community integration tests: community feed, Official Counselling Support channel, moderation and
 * private student <-> counsellor conversations.
 * Always runs against a private in-memory MongoDB (never the database in .env). Email goes to the
 * console provider and push is unconfigured (see setup-env.ts), so no real person is ever contacted.
 * Set SKIP_DB_TESTS=true to skip (e.g. where the mongod binary cannot be downloaded).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';

const d = process.env.SKIP_DB_TESTS === 'true' ? describe.skip : describe;
const PASSWORD = 'Community-Test-9';
type Agent = ReturnType<typeof request.agent>;

const API = '/api/v1';
const FEED = `${API}/community`;
const CHANNEL = `${API}/community/channels/counselling`;
const CONV = `${API}/counselling/conversations`;

d('Community feed, counselling channel and private conversations (integration)', () => {
  let mongo: { stop: () => Promise<boolean>; getUri: () => string };
  let app: import('express').Express;
  let M: typeof import('../src/models/user') & typeof import('../src/models/feed') & typeof import('../src/models/platform')
    & typeof import('../src/models/chat') & typeof import('../src/models/content');
  let FEED_LIMITS: typeof import('@campuscare/shared').FEED_LIMITS;
  let hash: string;
  const ids: Record<string, string> = {};

  async function makeUser(email: string, role: string, extra: Record<string, unknown> = {}) {
    const u = await M.User.create({ fullName: email.split('@')[0], email, role, passwordHash: hash, emailVerified: true, accountStatus: 'active', ...extra });
    ids[email.split('@')[0]!] = String(u._id);
    return u;
  }
  function freshCsrf(r: request.Response) {
    const c = (r.headers['set-cookie'] as unknown as string[] | undefined)?.find((x) => x.startsWith('cc_csrf='));
    return c ? c.split(';')[0]!.split('=')[1] : undefined;
  }
  /** Super Admins sign in on the website (cookie + CSRF). */
  async function webLogin(email: string) {
    const agent = request.agent(app);
    const csrf = (await agent.get(`${API}/auth/csrf`)).body.data.csrfToken as string;
    const r = await agent.post(`${API}/auth/login`).set('x-csrf-token', csrf).send({ email, password: PASSWORD });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return { agent, csrf: freshCsrf(r) ?? csrf };
  }
  /** Everyone else signs in from the Android app (bearer token, no CSRF). */
  async function appLogin(email: string) {
    const r = await request(app).post(`${API}/auth/login`).set('X-CampusCare-Client', 'android').send({ email, password: PASSWORD });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const token = r.body.data.sessionToken as string;
    return request.agent(app).set('Authorization', `Bearer ${token}`).set('X-CampusCare-Client', 'android') as unknown as Agent;
  }

  let root: { agent: Agent; csrf: string };
  const rootPost = (url: string) => root.agent.post(url).set('x-csrf-token', root.csrf);
  const rootDelete = (url: string) => root.agent.delete(url).set('x-csrf-token', root.csrf);
  let stuA: Agent; let stuB: Agent; let stuC: Agent; let stuD: Agent; let stuE: Agent;
  let counA: Agent; let counB: Agent; let counC: Agent;
  let mod: Agent; let mod2: Agent; let admin: Agent;

  async function createPost(agent: Agent, body: Record<string, unknown>) {
    const r = await agent.post(`${FEED}/posts`).send({ category: 'academic', clientId: randomUUID(), ...body });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.data.post as { id: string; status: string; [k: string]: unknown };
  }
  async function channelPost(agent: Agent, body: Record<string, unknown>) {
    return agent.post(`${CHANNEL}/posts`).send({ topic: 'exam_anxiety', clientId: randomUUID(), ...body });
  }
  const feedIds = async (agent: Agent, query = '') => {
    const r = await agent.get(`${FEED}/posts${query}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return (r.body.data.items as { id: string }[]).map((p) => p.id);
  };

  beforeAll(async () => {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    mongo = await MongoMemoryServer.create();
    const { connectDatabase } = await import('../src/db/connect');
    await connectDatabase(mongo.getUri());
    const { createApp } = await import('../src/app');
    app = createApp();
    M = {
      ...(await import('../src/models/user')), ...(await import('../src/models/feed')), ...(await import('../src/models/platform')),
      ...(await import('../src/models/chat')), ...(await import('../src/models/content')),
    };
    FEED_LIMITS = (await import('@campuscare/shared')).FEED_LIMITS;
    (await import('../src/services/feed.service')).resetChannelCache();
    for (const name of mongoose.modelNames()) await mongoose.model(name).syncIndexes();
    const settings = await import('../src/services/settings.service');
    await settings.updateSettings({ turnstile: { enabled: false }, security: { requireMfaForSuperAdmin: false } }, '000000000000000000000000');
    const { hashPassword } = await import('../src/lib/crypto');
    hash = await hashPassword(PASSWORD);
    await makeUser('root@srmap.edu.in', 'super_admin');
    for (const s of ['stua', 'stub', 'stuc', 'stud', 'stue']) await makeUser(`${s}@srmap.edu.in`, 'student', { studentId: s.toUpperCase(), department: 'CSE' });
    for (const c of ['couna', 'counb', 'counc', 'counoff']) await makeUser(`${c}@srmap.edu.in`, 'counsellor');
    await makeUser('mod@srmap.edu.in', 'moderator');
    await makeUser('mod2@srmap.edu.in', 'moderator');
    await makeUser('adm@srmap.edu.in', 'admin');
    root = await webLogin('root@srmap.edu.in');
    [stuA, stuB, stuC, stuD, stuE] = await Promise.all(['stua', 'stub', 'stuc', 'stud', 'stue'].map((s) => appLogin(`${s}@srmap.edu.in`)));
    [counA, counB, counC] = await Promise.all(['couna', 'counb', 'counc'].map((s) => appLogin(`${s}@srmap.edu.in`)));
    mod = await appLogin('mod@srmap.edu.in');
    mod2 = await appLogin('mod2@srmap.edu.in');
    admin = await appLogin('adm@srmap.edu.in');
    // An inactive counsellor: students cannot open conversations with them.
    await M.User.updateOne({ _id: ids.counoff }, { $set: { accountStatus: 'suspended' } });
  }, 180_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo?.stop();
  });

  // ---------------------------------------------------------------- unauthenticated
  it('rejects unauthenticated requests to community, channel and counselling endpoints with 401', async () => {
    const fake = '0123456789abcdef01234567';
    const anon = () => request(app);
    const checks: [string, string][] = [
      ['get', `${FEED}/posts`], ['post', `${FEED}/posts`], ['get', `${FEED}/featured`], ['get', `${FEED}/posts/${fake}`],
      ['put', `${FEED}/posts/${fake}/reaction`], ['put', `${FEED}/posts/${fake}/bookmark`], ['get', `${FEED}/posts/${fake}/comments`],
      ['post', `${FEED}/posts/${fake}/comments`], ['post', `${FEED}/reports`], ['get', `${FEED}/blocks`], ['get', `${FEED}/moderation/queue`],
      ['get', CHANNEL], ['get', `${CHANNEL}/posts`], ['post', `${CHANNEL}/posts`], ['get', `${CHANNEL}/dashboard`],
      ['get', `${CHANNEL}/publishers`], ['post', `${CHANNEL}/publishers`], ['delete', `${CHANNEL}/publishers/${fake}`],
      ['get', CONV], ['post', CONV], ['get', `${CONV}/${fake}`], ['get', `${CONV}/${fake}/messages`], ['post', `${CONV}/${fake}/messages`],
      ['get', `${FEED}/events`],
    ];
    for (const [method, url] of checks) {
      const r = await (anon() as unknown as Record<string, (u: string) => request.Test>)[method]!(url).set('X-CampusCare-Client', 'android').send({});
      expect(r.status, `${method.toUpperCase()} ${url} -> ${JSON.stringify(r.body)}`).toBe(401);
    }
  });

  // ---------------------------------------------------------------- channel publishing permissions
  it('only Super-Admin-verified counsellors can publish in the counselling channel', async () => {
    // Students cannot publish; the denial is audited.
    const s = await channelPost(stuA, { body: 'Student trying to publish officially' });
    expect(s.status).toBe(403);
    expect(s.body.error.code).toBe('not_publisher');
    expect(await M.AuditLog.countDocuments({ action: 'counselling_channel.publish_denied', actorId: ids.stua })).toBe(1);

    // A counsellor role alone is not enough.
    expect((await counA.get(CHANNEL)).body.data.canPublish).toBe(false);
    const c = await channelPost(counA, { body: 'Counsellor without verification' });
    expect(c.status).toBe(403);
    expect(await M.AuditLog.countDocuments({ action: 'counselling_channel.publish_denied', actorId: ids.couna })).toBe(1);

    // Nobody but the Super Admin (community_channels:manage) can verify publishers.
    for (const [who, agent] of [['student', stuA], ['moderator', mod], ['counsellor', counA], ['admin', admin]] as const) {
      const r = await agent.post(`${CHANNEL}/publishers`).send({ userId: ids.couna });
      expect(r.status, `${who}: ${JSON.stringify(r.body)}`).toBe(403);
      expect((await agent.get(`${CHANNEL}/publishers`)).status, who).toBe(403);
      expect((await agent.delete(`${CHANNEL}/publishers/${ids.couna}`)).status, who).toBe(403);
    }
    expect(await M.ChannelPublisher.countDocuments({})).toBe(0);

    // Only counsellor-role accounts can be verified.
    expect((await rootPost(`${CHANNEL}/publishers`).send({ userId: ids.stua })).body.error.code).toBe('not_counsellor');
    expect((await rootPost(`${CHANNEL}/publishers`).send({ userId: ids.counoff })).body.error.code).toBe('inactive');

    for (const who of ['couna', 'counb', 'counc']) {
      const v = await rootPost(`${CHANNEL}/publishers`).send({ userId: ids[who], note: 'Verified by test' });
      expect(v.status, JSON.stringify(v.body)).toBe(201);
    }
    const list = await root.agent.get(`${CHANNEL}/publishers`);
    expect(list.status).toBe(200);
    expect((list.body.data as { userId: string; publisher: boolean }[]).find((p) => p.userId === ids.couna)!.publisher).toBe(true);
    expect(await M.AuditLog.countDocuments({ action: 'counselling_channel.publisher_verified' })).toBe(3);

    const info = await counA.get(CHANNEL);
    expect(info.body.data.canPublish).toBe(true);
    expect((info.body.data.counsellors as { counsellorId: string }[]).map((x) => x.counsellorId)).toContain(ids.couna);
    expect((await stuA.get(CHANNEL)).body.data.canPublish).toBe(false);
    expect((await root.agent.get(CHANNEL)).body.data.canPublish).toBe(false); // Super Admin verifies, does not publish

    const ok = await channelPost(counA, { body: 'Exam stress is normal; here is how to manage it calmly.', tags: ['exam-tips'] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.data.post.official).toBe(true);
    expect(ok.body.data.post.author.verified).toBe(true);
    ids.chanA1 = ok.body.data.post.id;

    // Revocation removes the right immediately.
    const before = await channelPost(counC, { body: 'Counsellor C publishing before revocation.' });
    expect(before.status).toBe(201);
    expect((await rootDelete(`${CHANNEL}/publishers/${ids.counc}`).send({ reason: 'Left the team' })).status).toBe(200);
    expect((await rootDelete(`${CHANNEL}/publishers/${ids.counc}`)).status).toBe(404); // already revoked
    const after = await channelPost(counC, { body: 'Counsellor C publishing after revocation.' });
    expect(after.status).toBe(403);
    expect((await counC.get(CHANNEL)).body.data.canPublish).toBe(false);
    expect((await counC.get(`${CHANNEL}/dashboard`)).status).toBe(403);
    expect(await M.AuditLog.countDocuments({ action: 'counselling_channel.publisher_revoked', targetId: ids.counc })).toBe(1);

    // Students read the channel.
    const posts = await stuA.get(`${CHANNEL}/posts`);
    expect(posts.status).toBe(200);
    expect((posts.body.data.items as { id: string }[]).map((p) => p.id)).toContain(ids.chanA1);
    // Channel posts never appear in the main feed.
    expect(await feedIds(stuA)).not.toContain(ids.chanA1);
  });

  // ---------------------------------------------------------------- counsellors manage only their own posts
  it('counsellors edit and delete only their own channel posts; drafts and scheduled posts stay private', async () => {
    // B cannot change A's content or delete it.
    const edit = await counB.patch(`${CHANNEL}/posts/${ids.chanA1}`).send({ body: 'Hijacked by counsellor B' });
    expect(edit.status).toBe(403);
    const del = await counB.delete(`${CHANNEL}/posts/${ids.chanA1}`);
    expect(del.status).toBe(403);
    expect((await M.FeedPost.findById(ids.chanA1).lean())!.body).not.toMatch(/Hijacked/);
    // A student cannot touch channel posts at all.
    expect((await stuA.patch(`${CHANNEL}/posts/${ids.chanA1}`).send({ pinned: true })).status).toBe(403);
    expect((await stuA.delete(`${CHANNEL}/posts/${ids.chanA1}`)).status).toBe(403);
    // ...nor via the generic feed endpoints.
    expect((await counB.patch(`${FEED}/posts/${ids.chanA1}`).send({ body: 'Through the feed route' })).status).toBe(409);
    expect((await counB.delete(`${FEED}/posts/${ids.chanA1}`)).status).toBe(404);

    // A edits their own post.
    const own = await counA.patch(`${CHANNEL}/posts/${ids.chanA1}`).send({ body: 'Exam stress is normal; here is how to manage it calmly (updated).' });
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    expect(own.body.data.editedAt).toBeTruthy();

    // Pin rules: any verified publisher may pin/unpin a published post; at most FEED_LIMITS.maxPinnedPerChannel pinned.
    const pinByB = await counB.patch(`${CHANNEL}/posts/${ids.chanA1}`).send({ pinned: true });
    expect(pinByB.status, JSON.stringify(pinByB.body)).toBe(200);
    expect(pinByB.body.data.pinned).toBe(true);
    const extra: string[] = [];
    for (let i = 0; i < FEED_LIMITS.maxPinnedPerChannel; i++) {
      const r = await channelPost(counB, { body: `Counsellor B resource number ${i} for wellbeing.`, topic: 'support_resources' });
      expect(r.status).toBe(201);
      extra.push(r.body.data.post.id);
    }
    for (let i = 0; i < FEED_LIMITS.maxPinnedPerChannel - 1; i++) {
      expect((await counB.patch(`${CHANNEL}/posts/${extra[i]}`).send({ pinned: true })).status).toBe(200);
    }
    const tooMany = await counB.patch(`${CHANNEL}/posts/${extra[FEED_LIMITS.maxPinnedPerChannel - 1]}`).send({ pinned: true });
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.error.code).toBe('too_many_pinned');
    const pinnedList = await stuA.get(`${CHANNEL}/posts`);
    expect((pinnedList.body.data.pinned as unknown[]).length).toBe(FEED_LIMITS.maxPinnedPerChannel);
    for (let i = 0; i < FEED_LIMITS.maxPinnedPerChannel - 1; i++) await counB.patch(`${CHANNEL}/posts/${extra[i]}`).send({ pinned: false });

    // Drafts and scheduled posts.
    const draft = await channelPost(counA, { body: 'Draft about relationships, not ready yet zanzibarword.', topic: 'relationships', status: 'draft' });
    expect(draft.status).toBe(201);
    ids.chanDraft = draft.body.data.post.id;
    const sched = await channelPost(counA, { body: 'Scheduled post about exam anxiety quokkaword.', status: 'scheduled', scheduledAt: new Date(Date.now() + 3600_000).toISOString() });
    expect(sched.status, JSON.stringify(sched.body)).toBe(201);
    ids.chanSched = sched.body.data.post.id;
    const tooSoon = await channelPost(counA, { body: 'Scheduled too soon.', status: 'scheduled', scheduledAt: new Date(Date.now() + 5_000).toISOString() });
    expect(tooSoon.status).toBe(422);

    for (const agent of [stuA, stuB, mod, counB]) {
      const list = await agent.get(`${CHANNEL}/posts`);
      const seen = [...(list.body.data.items as { id: string }[]), ...(list.body.data.pinned as { id: string }[])].map((p) => p.id);
      expect(seen).not.toContain(ids.chanDraft);
      expect(seen).not.toContain(ids.chanSched);
      expect((await agent.get(`${FEED}/posts/${ids.chanDraft}`)).status).toBe(404);
      expect((await agent.get(`${FEED}/posts/${ids.chanSched}`)).status).toBe(404);
      expect((await agent.get(`${FEED}/posts/${ids.chanDraft}/comments`)).status).toBe(404);
    }
    // B cannot edit or delete A's draft.
    expect((await counB.patch(`${CHANNEL}/posts/${ids.chanDraft}`).send({ body: 'B rewriting A draft' })).status).toBe(404);
    expect((await counB.delete(`${CHANNEL}/posts/${ids.chanDraft}`)).status).toBe(403);
    // Moderators cannot act on drafts/scheduled posts.
    expect((await mod.post(`${FEED}/moderation/posts/${ids.chanDraft}`).send({ action: 'hide', reason: 'x' })).status).toBe(404);
    // The author sees them on their own dashboard and post page.
    expect((await counA.get(`${FEED}/posts/${ids.chanDraft}`)).status).toBe(200);
    const dash = await counA.get(`${CHANNEL}/dashboard`);
    expect(dash.status).toBe(200);
    expect(dash.body.data.totals.drafts).toBe(1);
    expect(dash.body.data.totals.scheduled).toBe(1);
    const dashB = await counB.get(`${CHANNEL}/dashboard`);
    expect((dashB.body.data.posts as { id: string }[]).map((p) => p.id)).not.toContain(ids.chanDraft);
    // Search does not surface drafts either.
    const search = await stuA.get(`${CHANNEL}/posts?q=zanzibarword`);
    expect(search.body.data.items).toEqual([]);

    // Publishing the draft makes it visible; A deletes their own post.
    const pub = await counA.patch(`${CHANNEL}/posts/${ids.chanDraft}`).send({ status: 'published' });
    expect(pub.status).toBe(200);
    expect((await stuA.get(`${FEED}/posts/${ids.chanDraft}`)).status).toBe(200);
    expect((await counA.patch(`${CHANNEL}/posts/${ids.chanDraft}`).send({ status: 'draft' })).status).toBe(409); // no going back
    expect((await counA.delete(`${CHANNEL}/posts/${ids.chanDraft}`)).status).toBe(200);
    expect((await stuA.get(`${FEED}/posts/${ids.chanDraft}`)).status).toBe(404);
  });

  it("never reveals another counsellor's draft through pinning, and moderated posts cannot be pinned", async () => {
    const draft = await channelPost(counA, { body: 'Private draft text only A should see wombatword.', status: 'draft' });
    expect(draft.status).toBe(201);
    const r = await counB.patch(`${CHANNEL}/posts/${draft.body.data.post.id}`).send({ pinned: true });
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.body)).not.toMatch(/wombatword/);
    await counA.delete(`${CHANNEL}/posts/${draft.body.data.post.id}`);

    const live = await channelPost(counA, { body: 'Published tip that a moderator will hide numbatword.' });
    expect(live.status).toBe(201);
    const id = live.body.data.post.id;
    expect((await mod.post(`${FEED}/moderation/posts/${id}`).send({ action: 'hide', reason: 'Testing moderated pin' })).status).toBe(200);
    expect((await counB.patch(`${CHANNEL}/posts/${id}`).send({ pinned: true })).status).toBe(409);
    expect((await counA.patch(`${CHANNEL}/posts/${id}`).send({ pinned: true })).status).toBe(409);
    await counA.delete(`${CHANNEL}/posts/${id}`);
  });

  it('lets verified publishers attach PDF documents while students may upload images only', async () => {
    const pdf = Buffer.from(['%PDF-1.4', '1 0 obj << /Type /Catalog >> endobj', 'trailer << /Root 1 0 R >>', '%%EOF', ''].join(String.fromCharCode(10)));
    const denied = await stuA.post(`${FEED}/uploads`).attach('file', pdf, 'notes.pdf');
    expect(denied.status).toBe(415);
    const up = await counA.post(`${FEED}/uploads`).attach('file', pdf, 'exam-stress-guide.pdf');
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    const post = await channelPost(counA, { body: 'A one-page guide to handling exam stress.', attachmentIds: [up.body.data.id] });
    expect(post.status, JSON.stringify(post.body)).toBe(201);
    expect(post.body.data.post.attachments[0].mimeType).toBe('application/pdf');
    const file = await stuA.get(`${FEED}/files/${up.body.data.id}`);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toContain('application/pdf');
    await counA.delete(`${CHANNEL}/posts/${post.body.data.post.id}`);
  });

  // ---------------------------------------------------------------- student feed
  it('lets students post, filter, search, react, bookmark and comment', async () => {
    const p1 = await createPost(stuA, { body: 'Study group for algorithms this weekend, zebrafinch room.', category: 'academic', tags: ['#Exam Prep'] });
    expect(p1.status).toBe('published');
    expect(p1.tags).toEqual(['exam-prep']);
    ids.p1 = p1.id;
    const p2 = await createPost(stuA, { body: 'Broken street light near the hostel gate.', category: 'campus_safety', locationLabel: 'Hostel gate' });
    ids.p2 = p2.id;

    // Duplicate clientId is idempotent.
    const clientId = randomUUID();
    const first = await stuA.post(`${FEED}/posts`).send({ body: 'Idempotent post about library hours.', category: 'academic', clientId });
    expect(first.status).toBe(201);
    const again = await stuA.post(`${FEED}/posts`).send({ body: 'Idempotent post about library hours.', category: 'academic', clientId });
    expect(again.status).toBe(200);
    expect(again.body.data.duplicate).toBe(true);
    expect(again.body.data.post.id).toBe(first.body.data.post.id);
    // Same text with a new clientId within 24 h is refused.
    const dup = await stuA.post(`${FEED}/posts`).send({ body: 'Idempotent   post about LIBRARY hours.', category: 'academic', clientId: randomUUID() });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('duplicate_post');

    // Students cannot publish announcements or official posts.
    const ann = await stuA.post(`${FEED}/posts`).send({ body: 'Fake announcement from a student.', category: 'announcements', clientId: randomUUID() });
    expect(ann.status).toBe(403);
    expect(ann.body.error.code).toBe('not_official');
    const off = await stuA.post(`${FEED}/posts`).send({ body: 'Fake official post from a student.', category: 'academic', official: true, clientId: randomUUID() });
    expect(off.status).toBe(403);
    expect(await M.AuditLog.countDocuments({ action: 'community.official_post_denied', actorId: ids.stua })).toBe(2);

    // Category filter.
    const academic = await feedIds(stuB, '?category=academic');
    expect(academic).toContain(ids.p1);
    expect(academic).not.toContain(ids.p2);
    expect(await feedIds(stuB, '?category=campus_safety')).toEqual([ids.p2]);
    // Text and #tag search.
    expect(await feedIds(stuB, '?q=zebrafinch')).toEqual([ids.p1]);
    expect(await feedIds(stuB, `?q=${encodeURIComponent('#exam-prep')}`)).toEqual([ids.p1]);
    expect(await feedIds(stuB, '?tag=exam-prep')).toEqual([ids.p1]);
    expect(await feedIds(stuB, '?q=nonexistentwordxyz')).toEqual([]);

    // Reactions: repeated PUT never double-counts; changing kind keeps the count.
    for (let i = 0; i < 3; i++) {
      const r = await stuB.put(`${FEED}/posts/${ids.p1}/reaction`).send({ kind: 'like' });
      expect(r.status).toBe(200);
      expect(r.body.data.reactionCount).toBe(1);
    }
    expect((await stuC.put(`${FEED}/posts/${ids.p1}/reaction`).send({ kind: 'helpful' })).body.data.reactionCount).toBe(2);
    const change = await stuB.put(`${FEED}/posts/${ids.p1}/reaction`).send({ kind: 'support' });
    expect(change.body.data).toMatchObject({ reactionCount: 2, myReaction: 'support' });
    expect(await M.FeedReaction.countDocuments({ postId: ids.p1 })).toBe(2);
    expect((await stuB.delete(`${FEED}/posts/${ids.p1}/reaction`)).body.data.reactionCount).toBe(1);
    expect((await stuB.delete(`${FEED}/posts/${ids.p1}/reaction`)).body.data.reactionCount).toBe(1); // second delete is a no-op
    const viewC = await stuC.get(`${FEED}/posts/${ids.p1}`);
    expect(viewC.body.data.myReaction).toBe('helpful');
    expect(viewC.body.data.reactionCount).toBe(1);
    expect(viewC.body.data.viewCount).toBeNull(); // engagement detail for the author only

    // Bookmarks.
    expect((await stuB.put(`${FEED}/posts/${ids.p1}/bookmark`)).status).toBe(200);
    expect((await stuB.put(`${FEED}/posts/${ids.p1}/bookmark`)).status).toBe(200);
    const marks = await stuB.get(`${FEED}/posts?scope=bookmarks`);
    expect((marks.body.data.items as { id: string; bookmarked: boolean }[]).map((p) => p.id)).toEqual([ids.p1]);
    expect(marks.body.data.items[0].bookmarked).toBe(true);
    expect((await stuA.get(`${FEED}/posts/${ids.p1}`)).body.data.bookmarkCount).toBe(1);
    expect((await stuB.delete(`${FEED}/posts/${ids.p1}/bookmark`)).body.data.bookmarked).toBe(false);
    expect((await stuB.get(`${FEED}/posts?scope=bookmarks`)).body.data.items).toEqual([]);
    expect((await stuA.get(`${FEED}/posts/${ids.p1}`)).body.data.bookmarkCount).toBe(0);

    // Comments and replies (one level deep).
    const c1 = await stuB.post(`${FEED}/posts/${ids.p1}/comments`).send({ body: 'Count me in!', clientId: randomUUID() });
    expect(c1.status, JSON.stringify(c1.body)).toBe(201);
    expect(c1.body.data.commentCount).toBe(1);
    ids.c1 = c1.body.data.comment.id;
    const r1 = await stuA.post(`${FEED}/posts/${ids.p1}/comments`).send({ body: 'Great, see you there.', parentId: ids.c1, clientId: randomUUID() });
    expect(r1.status).toBe(201);
    expect(r1.body.data.comment.parentId).toBe(ids.c1);
    expect(r1.body.data.comment.isPostAuthor).toBe(true);
    const r2 = await stuC.post(`${FEED}/posts/${ids.p1}/comments`).send({ body: 'Replying to the reply.', parentId: r1.body.data.comment.id, clientId: randomUUID() });
    expect(r2.status).toBe(201);
    expect(r2.body.data.comment.parentId).toBe(ids.c1); // flattened
    expect(r2.body.data.commentCount).toBe(3);
    const dupCid = randomUUID();
    await stuC.post(`${FEED}/posts/${ids.p1}/comments`).send({ body: 'Top-level from C.', clientId: dupCid });
    const dupC = await stuC.post(`${FEED}/posts/${ids.p1}/comments`).send({ body: 'Top-level from C.', clientId: dupCid });
    expect(dupC.status).toBe(200);
    expect(dupC.body.data.duplicate).toBe(true);
    const comments = await stuD.get(`${FEED}/posts/${ids.p1}/comments`);
    expect(comments.status).toBe(200);
    expect(comments.body.data.commentCount).toBe(4);
    expect(comments.body.data.items).toHaveLength(2);
    expect(comments.body.data.items[0].replies).toHaveLength(2);
    expect((await stuD.get(`${FEED}/posts/${ids.p1}`)).body.data.commentCount).toBe(4);
    // Comment author notified without the comment text.
    const n = await M.Notification.find({ userId: ids.stua, kind: 'community_comment' }).lean();
    expect(n.length).toBeGreaterThan(0);
    for (const x of n) expect(`${x.title} ${x.body}`).not.toMatch(/Count me in/);

    // Comments: edit/delete own only.
    expect((await stuC.patch(`${FEED}/comments/${ids.c1}`).send({ body: 'Edited by someone else' })).status).toBe(404);
    expect((await stuC.delete(`${FEED}/comments/${ids.c1}`)).status).toBe(404);
    const ec = await stuB.patch(`${FEED}/comments/${ids.c1}`).send({ body: 'Count me in (edited)!' });
    expect(ec.status).toBe(200);
    expect(ec.body.data.editedAt).toBeTruthy();
    const dc = await stuC.delete(`${FEED}/comments/${r2.body.data.comment.id}`);
    expect(dc.body.data.commentCount).toBe(3);

    // Posts: edit/delete own only.
    const foreignEdit = await stuB.patch(`${FEED}/posts/${ids.p2}`).send({ body: 'Changed by another student' });
    expect(foreignEdit.status).toBe(403);
    expect((await stuB.delete(`${FEED}/posts/${ids.p2}`)).status).toBe(404);
    expect((await stuB.patch(`${FEED}/posts/${ids.p2}`).send({ pinned: true })).status).toBe(403);
    const ownEdit = await stuA.patch(`${FEED}/posts/${ids.p2}`).send({ body: 'Broken street light near the hostel gate (still broken).' });
    expect(ownEdit.status).toBe(200);
    expect(ownEdit.body.data.editedAt).toBeTruthy();
    expect((await stuA.patch(`${FEED}/posts/${ids.p2}`).send({ category: 'announcements' })).status).toBe(422);
    expect((await stuA.delete(`${FEED}/posts/${ids.p2}`)).status).toBe(200);
    expect((await stuB.get(`${FEED}/posts/${ids.p2}`)).status).toBe(404);
    expect(await feedIds(stuB)).not.toContain(ids.p2);
    const mine = await stuA.get(`${FEED}/posts?scope=mine`);
    expect((mine.body.data.items as { id: string }[]).map((p) => p.id)).not.toContain(ids.p2);
  });

  // ---------------------------------------------------------------- blocking
  it('hides a blocked author\'s posts and comments from the blocker', async () => {
    const pb = await createPost(stuB, { body: 'Lost a blue water bottle near block C.', category: 'lost_found' });
    ids.pb = pb.id;
    expect(await feedIds(stuD)).toContain(ids.pb);
    const beforeComments = await stuD.get(`${FEED}/posts/${ids.p1}/comments`);
    expect((beforeComments.body.data.items as { id: string }[]).map((c) => c.id)).toContain(ids.c1);

    const block = await stuD.post(`${FEED}/posts/${ids.pb}/block-author`).send({});
    expect(block.status, JSON.stringify(block.body)).toBe(200);
    expect((await stuD.post(`${FEED}/posts/${ids.p1}/block-author`).send({})).status).toBe(200); // blocks stuA too
    expect((await stuA.post(`${FEED}/posts/${ids.p1}/block-author`).send({})).status).toBe(422); // cannot block yourself

    const feed = await feedIds(stuD);
    expect(feed).not.toContain(ids.pb);
    expect(feed).not.toContain(ids.p1);
    expect((await stuD.get(`${FEED}/posts/${ids.pb}`)).status).toBe(404);
    // Unblock stuA so the post itself is visible again, then check that stuB's comments stay hidden.
    const blocks = await stuD.get(`${FEED}/blocks`);
    expect(blocks.status).toBe(200);
    expect(blocks.body.data).toHaveLength(2);
    const blockA = (await M.ChatBlock.findOne({ userId: ids.stud, blockedUserId: ids.stua }).lean())!;
    expect((await stuD.delete(`${FEED}/blocks/${blockA._id}`)).status).toBe(200);
    const after = await stuD.get(`${FEED}/posts/${ids.p1}/comments`);
    expect(after.status).toBe(200);
    expect((after.body.data.items as { id: string }[]).map((c) => c.id)).not.toContain(ids.c1);
    expect(JSON.stringify(after.body.data)).not.toMatch(/Count me in/);
    // Others still see everything.
    expect(await feedIds(stuC)).toContain(ids.pb);
    // The blocked author cannot comment on the blocker's posts? (stuB is blocked by stuD; stuD has no posts) — check the reverse rule:
    const pd = await createPost(stuD, { body: 'Anyone up for a night walk group?', category: 'campus_safety' });
    const blockedComment = await stuB.post(`${FEED}/posts/${pd.id}/comments`).send({ body: 'Me!', clientId: randomUUID() });
    expect(blockedComment.status).toBe(403);
    expect(blockedComment.body.error.code).toBe('cannot_comment');
  });

  // ---------------------------------------------------------------- reports and moderation
  it('auto-holds reported content, lets moderators decide with reasons and authors appeal', async () => {
    const pc = await createPost(stuC, { body: 'Selling old textbooks, cheap, ask me.', category: 'academic' });
    ids.pc = pc.id;
    expect(FEED_LIMITS.reportsToAutoHide).toBe(3);
    // Authors cannot report themselves; reporting is idempotent per reporter.
    expect((await stuC.post(`${FEED}/reports`).send({ targetType: 'post', targetId: ids.pc, reason: 'spam' })).status).toBe(422);
    const reporters = [stuA, stuB, stuE];
    for (let i = 0; i < reporters.length; i++) {
      const r = await reporters[i]!.post(`${FEED}/reports`).send({ targetType: 'post', targetId: ids.pc, reason: 'spam', details: 'Looks like spam' });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.data.held).toBe(i === reporters.length - 1);
      if (i === 0) {
        const dupReport = await stuA.post(`${FEED}/reports`).send({ targetType: 'post', targetId: ids.pc, reason: 'spam' });
        expect(dupReport.status).toBe(200);
        expect(dupReport.body.data.duplicate).toBe(true);
      }
    }
    expect((await M.FeedPost.findById(ids.pc).lean())!.status).toBe('pending_review');
    expect(await feedIds(stuD)).not.toContain(ids.pc);
    expect((await stuD.get(`${FEED}/posts/${ids.pc}`)).status).toBe(404);
    const authorView = await stuC.get(`${FEED}/posts/${ids.pc}`);
    expect(authorView.status).toBe(200);
    expect(authorView.body.data.moderationNote).toMatch(/review/i);
    expect(await M.Notification.countDocuments({ userId: ids.mod, kind: 'community_report' })).toBeGreaterThan(0);

    // Students cannot use moderation endpoints.
    expect((await stuA.get(`${FEED}/moderation/queue`)).status).toBe(403);
    expect((await stuA.post(`${FEED}/moderation/posts/${ids.pc}`).send({ action: 'dismiss' })).status).toBe(403);
    expect((await counA.post(`${FEED}/moderation/posts/${ids.pc}`).send({ action: 'dismiss' })).status).toBe(403);

    const queue = await mod.get(`${FEED}/moderation/queue`);
    expect(queue.status).toBe(200);
    const queued = (queue.body.data.posts as { id: string; reasons: { reason: string; count: number }[] }[]).find((p) => p.id === ids.pc)!;
    expect(queued.reasons).toEqual([{ reason: 'spam', count: 3 }]);
    // Moderators see held content.
    expect((await mod.get(`${FEED}/posts/${ids.pc}`)).status).toBe(200);

    // Dismissing reports brings it back.
    const dismiss = await mod.post(`${FEED}/moderation/posts/${ids.pc}`).send({ action: 'dismiss' });
    expect(dismiss.body.data.status).toBe('published');
    expect(await feedIds(stuD)).toContain(ids.pc);

    // Hiding requires a reason; the author then sees it.
    const noReason = await mod.post(`${FEED}/moderation/posts/${ids.pc}`).send({ action: 'hide' });
    expect(noReason.status).toBe(422);
    expect(noReason.body.error.code).toBe('reason_required');
    const hide = await mod.post(`${FEED}/moderation/posts/${ids.pc}`).send({ action: 'hide', reason: 'Commercial selling is not allowed' });
    expect(hide.status).toBe(200);
    expect(hide.body.data.status).toBe('hidden');
    expect((await stuD.get(`${FEED}/posts/${ids.pc}`)).status).toBe(404);
    const hidden = await stuC.get(`${FEED}/posts/${ids.pc}`);
    expect(hidden.body.data.moderationNote).toMatch(/Commercial selling is not allowed/);
    expect(hidden.body.data.canAppeal).toBe(true);
    expect((await stuC.patch(`${FEED}/posts/${ids.pc}`).send({ body: 'Trying to edit a hidden post' })).status).toBe(403);
    const modNote = await M.Notification.findOne({ userId: ids.stuc, kind: 'community_moderation' }).sort({ createdAt: -1 }).lean();
    expect(modNote!.body).toMatch(/Commercial selling/);
    expect(modNote!.body).not.toMatch(/textbooks/);

    // Appeals: only the author, once, decided by a different moderator.
    expect((await stuA.post(`${FEED}/posts/${ids.pc}/appeal`).send({ reason: 'I think this was unfair to them.' })).status).toBe(404);
    expect((await stuC.post(`${FEED}/posts/${ids.pc}/appeal`).send({ reason: 'short' })).status).toBe(422);
    const appeal = await stuC.post(`${FEED}/posts/${ids.pc}/appeal`).send({ reason: 'I was giving books away for almost nothing to juniors.' });
    expect(appeal.status).toBe(201);
    expect((await stuC.post(`${FEED}/posts/${ids.pc}/appeal`).send({ reason: 'Appealing a second time for this.' })).status).toBe(409);
    const appeals = await mod.get(`${FEED}/moderation/appeals`);
    const a = (appeals.body.data as { id: string; targetId: string; canDecide: boolean }[]).find((x) => x.targetId === ids.pc)!;
    expect(a.canDecide).toBe(false);
    const selfDecide = await mod.post(`${FEED}/moderation/appeals/${a.id}`).send({ decision: 'reversed' });
    expect(selfDecide.status).toBe(409);
    expect(selfDecide.body.error.code).toBe('conflict_of_interest');
    const decide = await mod2.post(`${FEED}/moderation/appeals/${a.id}`).send({ decision: 'reversed', note: 'Fair point' });
    expect(decide.status).toBe(200);
    expect(decide.body.data.status).toBe('reversed');
    expect((await stuD.get(`${FEED}/posts/${ids.pc}`)).status).toBe(200);

    // Moderators cannot moderate their own content.
    const mp = await createPost(mod, { body: 'Moderator reminder: be kind in comments.', category: 'awareness' });
    const own = await mod.post(`${FEED}/moderation/posts/${mp.id}`).send({ action: 'hide', reason: 'Testing self moderation' });
    expect(own.status).toBe(409);
    expect(own.body.error.code).toBe('own_content');
    expect((await mod2.post(`${FEED}/moderation/posts/${mp.id}`).send({ action: 'hide', reason: 'Another moderator can' })).status).toBe(200);

    // Comment reports and moderation.
    const cm = await stuE.post(`${FEED}/posts/${ids.pc}/comments`).send({ body: 'This comment will be removed.', clientId: randomUUID() });
    const cmId = cm.body.data.comment.id as string;
    expect((await stuA.post(`${FEED}/reports`).send({ targetType: 'comment', targetId: cmId, reason: 'harassment' })).status).toBe(201);
    expect((await mod.post(`${FEED}/moderation/comments/${cmId}`).send({ action: 'remove' })).status).toBe(422);
    expect((await mod.post(`${FEED}/moderation/comments/${cmId}`).send({ action: 'remove', reason: 'Harassment' })).body.data.status).toBe('removed');
    const pcComments = await stuA.get(`${FEED}/posts/${ids.pc}/comments`);
    expect((pcComments.body.data.items as { id: string }[]).map((c) => c.id)).not.toContain(cmId);

    // User report goes to the moderators' queue.
    const ur = await stuA.post(`${FEED}/reports`).send({ targetType: 'user', targetId: ids.pb, via: 'post', reason: 'harassment' });
    expect(ur.status).toBe(201);
    expect(((await mod.get(`${FEED}/moderation/queue`)).body.data.users as unknown[]).length).toBe(1);
  });

  // ---------------------------------------------------------------- private counselling conversations
  it('keeps student <-> counsellor conversations private to the two participants', async () => {
    const SECRET = 'pineapplesecret exam panic attacks every night';
    // Counsellors and moderators cannot start conversations; inactive/non-counsellors are not reachable.
    expect((await counA.post(CONV).send({ counsellorId: ids.counb })).status).toBe(403);
    expect((await mod.post(CONV).send({ counsellorId: ids.couna })).status).toBe(403);
    expect((await stuA.post(CONV).send({ counsellorId: ids.counoff })).status).toBe(404);
    expect((await stuA.post(CONV).send({ counsellorId: ids.stub })).status).toBe(404);

    const open = await stuA.post(CONV).send({ counsellorId: ids.couna });
    expect(open.status, JSON.stringify(open.body)).toBe(201);
    const convId = open.body.data.id as string;
    ids.conv = convId;
    expect(open.body.data.counsellor.id).toBe(ids.couna);
    const reopen = await stuA.post(CONV).send({ counsellorId: ids.couna });
    expect(reopen.status).toBe(200);
    expect(reopen.body.data.id).toBe(convId);
    expect(await M.ChatChannel.countDocuments({ kind: 'counselling_thread', studentId: ids.stua })).toBe(1);

    const sent = await stuA.post(`${CONV}/${convId}/messages`).send({ body: SECRET, clientMessageId: randomUUID() });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    expect(sent.body.data.message.mine).toBe(true);
    const cmid = randomUUID();
    const reply = await counA.post(`${CONV}/${convId}/messages`).send({ body: 'Thank you for reaching out. Let us talk.', clientMessageId: cmid });
    expect(reply.status).toBe(201);
    const replyAgain = await counA.post(`${CONV}/${convId}/messages`).send({ body: 'Thank you for reaching out. Let us talk.', clientMessageId: cmid });
    expect(replyAgain.status).toBe(200);
    expect(replyAgain.body.data.duplicate).toBe(true);

    // Both participants list and read.
    const listA = await stuA.get(CONV);
    expect((listA.body.data as { id: string }[]).map((c) => c.id)).toEqual([convId]);
    const listC = await counA.get(CONV);
    expect((listC.body.data as { id: string; student: { id: string } }[]).find((c) => c.id === convId)!.student.id).toBe(ids.stua);
    for (const agent of [stuA, counA]) {
      expect((await agent.get(`${CONV}/${convId}`)).status).toBe(200);
      const msgs = await agent.get(`${CONV}/${convId}/messages`);
      expect(msgs.status).toBe(200);
      expect((msgs.body.data.items as { body: string }[]).map((m) => m.body)).toEqual([SECRET, 'Thank you for reaching out. Let us talk.']);
    }

    // Everyone else gets 404 (not 403) — they cannot even learn the conversation exists.
    for (const [who, agent] of [['other student', stuB], ['other counsellor', counB], ['revoked counsellor', counC], ['moderator', mod], ['admin', admin]] as const) {
      expect((await agent.get(`${CONV}/${convId}`)).status, who).toBe(404);
      expect((await agent.get(`${CONV}/${convId}/messages`)).status, who).toBe(404);
      const post = await agent.post(`${CONV}/${convId}/messages`).send({ body: 'intrusion', clientMessageId: randomUUID() });
      expect(post.status, `${who}: ${JSON.stringify(post.body)}`).toBe(404);
      const list = await agent.get(CONV);
      expect((list.body.data as { id: string }[]).map((c) => c.id), who).not.toContain(convId);
    }
    expect(await M.ChatMessage.countDocuments({ channelId: convId, body: 'intrusion' })).toBe(0);
    // Generic chat endpoints do not open it to moderators either.
    expect((await mod.get(`${API}/chat/channels/${convId}/messages`)).status).toBe(404);

    // Never copied to the feed or the channel.
    for (const agent of [stuA, stuB, counA, mod]) {
      expect(await feedIds(agent, '?q=pineapplesecret')).toEqual([]);
      const ch = await agent.get(`${CHANNEL}/posts?q=pineapplesecret`);
      expect(ch.body.data.items).toEqual([]);
      const all = await agent.get(`${FEED}/posts`);
      expect(JSON.stringify(all.body)).not.toMatch(/pineapplesecret/);
      const chAll = await agent.get(`${CHANNEL}/posts`);
      expect(JSON.stringify(chAll.body)).not.toMatch(/pineapplesecret/);
    }
    expect(await M.FeedPost.countDocuments({ body: /pineapplesecret/ })).toBe(0);
    expect(await M.FeedComment.countDocuments({ body: /pineapplesecret/ })).toBe(0);
    const modQueue = await mod.get(`${FEED}/moderation/queue`);
    expect(JSON.stringify(modQueue.body)).not.toMatch(/pineapplesecret/);

    // Notifications never carry the message body or the student's name.
    const notes = await M.Notification.find({ userId: ids.couna }).lean();
    expect(notes.some((n) => n.kind === 'support_thread')).toBe(true);
    expect(notes.some((n) => n.kind === 'chat_message')).toBe(true);
    for (const n of notes) {
      expect(`${n.title} ${n.body}`).not.toMatch(/pineapple|panic/);
      expect(`${n.title} ${n.body}`).not.toMatch(/stua/);
    }
    const studentNotes = await M.Notification.find({ userId: ids.stua, kind: 'chat_message' }).lean();
    expect(studentNotes.length).toBeGreaterThan(0);
    for (const n of studentNotes) expect(`${n.title} ${n.body}`).not.toMatch(/reaching out/);
  });

  it('records what a Super Admin can reach in counselling conversations', async () => {
    const r = {
      list: await root.agent.get(CONV),
      get: await root.agent.get(`${CONV}/${ids.conv}`),
      messages: await root.agent.get(`${CONV}/${ids.conv}/messages`),
      send: await rootPost(`${CONV}/${ids.conv}/messages`).send({ body: 'super admin probe', clientMessageId: randomUUID() }),
      start: await rootPost(CONV).send({ counsellorId: ids.couna }),
    };
    const summary = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { status: v.status, leaked: /pineapplesecret/.test(JSON.stringify(v.body)), n: Array.isArray(v.body?.data) ? v.body.data.length : undefined }]));
    // Not asserted as a policy (another change intentionally widened Super Admin access); logged for the report.
    console.log('SUPER_ADMIN_COUNSELLING_ACCESS', JSON.stringify(summary));
    expect(r.list.status).toBe(200);
  });

  // ---------------------------------------------------------------- events
  it('lets authorised organisers publish events and students RSVP', async () => {
    const event = {
      title: 'Exam stress workshop', description: 'A practical session on managing exam stress.', kind: 'workshop',
      startsAt: new Date(Date.now() + 2 * 86400_000).toISOString(), endsAt: new Date(Date.now() + 2 * 86400_000 + 3600_000).toISOString(),
      venue: 'Seminar Hall 2', organizer: 'Counselling Cell', capacity: 1,
    };
    const denied = await stuA.post(`${FEED}/events`).send(event);
    expect(denied.status).toBe(403);
    expect((await counA.post(`${FEED}/events`).send(event)).status).toBe(403); // campus-wide events need announcements rights
    const own = await counA.post(`${FEED}/events`).send({ ...event, kind: 'counselling_session', channel: 'counselling' });
    expect(own.status, JSON.stringify(own.body)).toBe(201);
    expect(own.body.data.channel).toBe('counselling');
    expect((await counC.post(`${FEED}/events`).send({ ...event, channel: 'counselling' })).status).toBe(403); // revoked publisher
    const created = await rootPost(`${FEED}/events`).send(event);
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    const list = await stuA.get(`${FEED}/events`);
    expect((list.body.data.items as { id: string }[]).map((e) => e.id)).toContain(id);
    expect((await stuA.post(`${FEED}/events/${id}/rsvp`).send({ status: 'going' })).body.data.going).toBe(1);
    const full = await stuB.post(`${FEED}/events/${id}/rsvp`).send({ status: 'going' });
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('full');
    expect((await stuB.patch(`${FEED}/events/${id}`).send({ venue: 'Elsewhere' })).status).toBe(403);
    const featured = await stuA.get(`${FEED}/featured`);
    expect(featured.status).toBe(200);
    expect(featured.body.data.channel.slug).toBe('counselling');
  });
});
