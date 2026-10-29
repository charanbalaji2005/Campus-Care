/**
 * CampusCare College staff registration: role-specific applications (Counsellor, Campus Admin, Committee
 * Member, Security Officer), email verification, Google registration, Super Admin review and what an
 * approval grants. Google ID tokens are signed with a test key (only Google's certificate download is
 * stubbed). Private in-memory MongoDB; console email. SKIP_DB_TESTS=true skips.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';

process.env.AUTH_GENERIC_RESPONSE_MS = '20';

const d = process.env.SKIP_DB_TESTS === 'true' ? describe.skip : describe;
const PASSWORD = 'Staff-Register-Test-9';
const API = '/api/v1';
const COLLEGE = { 'X-CampusCare-Client': 'android', 'X-CampusCare-App': 'college' };
const STUDENT = { 'X-CampusCare-Client': 'android', 'X-CampusCare-App': 'student' };
const WEB_CLIENT = '1234567890-web.apps.googleusercontent.com';
const KID = 'test-key-sr';
const signer = generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
function idToken(claims: Record<string, unknown>) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', kid: KID, typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iss: 'https://accounts.google.com', aud: WEB_CLIENT, iat: now, exp: now + 3600, email_verified: true, ...claims }));
  return `${header}.${payload}.${b64url(createSign('RSA-SHA256').update(`${header}.${payload}`).sign(signer.privateKey))}`;
}
type Agent = ReturnType<typeof request.agent>;
let seq = 0;

d('Staff registration and approval (integration)', () => {
  let mongo: { stop: () => Promise<boolean>; getUri: () => string };
  let app: import('express').Express;
  let M: typeof import('../src/models/user') & typeof import('../src/models/platform') & typeof import('../src/models/duty');
  let StaffApplication: typeof import('../src/models/staff-application').StaffApplication;
  let Committee: typeof import('../src/models/incident').Committee;
  let hash: string;
  let root: { agent: Agent; csrf: string };
  const committees: Record<string, string> = {};

  function body(role: string, extra: Record<string, unknown> = {}) {
    seq++;
    const details: Record<string, Record<string, unknown>> = {
      counsellor: { counsellor: { specializations: ['academic_stress', 'general'], languages: ['English', 'Telugu'], qualifications: 'M.Phil Clinical Psychology', experienceYears: 6, sessionModes: ['in_person'] } },
      admin: { admin: { authorizationReference: 'REG/OO/2026/041' } },
      committee_member: { committee: { committeeId: committees.open, position: 'chair', reason: 'Served on the hostel committee' } },
      security_officer: { security: { serviceProvider: 'SRM Campus Security', shiftPreference: 'night' } },
    };
    return {
      fullName: `Applicant ${role} ${seq}`, email: `sr-${role.replace('_', '')}-${seq}@srmap.edu.in`, password: PASSWORD, confirmPassword: PASSWORD,
      requestedRole: role, staffId: `EMP-SR-${seq}`, department: 'Student Affairs', designation: 'Senior Officer', campus: 'main',
      verificationMethod: 'otp', acceptPolicy: true, ...details[role], ...extra,
    };
  }
  const register = (b: Record<string, unknown>, headers = COLLEGE) => request(app).post(`${API}/auth/register-staff`).set(headers).send(b);
  function freshCsrf(r: request.Response) {
    const c = (r.headers['set-cookie'] as unknown as string[] | undefined)?.find((x) => x.startsWith('cc_csrf='));
    return c ? c.split(';')[0]!.split('=')[1] : undefined;
  }
  async function webLogin(email: string) {
    const agent = request.agent(app);
    const csrf = (await agent.get(`${API}/auth/csrf`)).body.data.csrfToken as string;
    const r = await agent.post(`${API}/auth/login`).set('x-csrf-token', csrf).send({ email, password: PASSWORD });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return { agent, csrf: freshCsrf(r) ?? csrf };
  }
  async function appLogin(email: string) {
    const r = await request(app).post(`${API}/auth/login`).set(COLLEGE).send({ email, password: PASSWORD });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return { token: r.body.data.sessionToken as string, body: r.body.data };
  }
  const as = (token: string) => ({
    get: (p: string) => request(app).get(`${API}${p}`).set(COLLEGE).set('Authorization', `Bearer ${token}`),
    post: (p: string, b: Record<string, unknown> = {}) => request(app).post(`${API}${p}`).set(COLLEGE).set('Authorization', `Bearer ${token}`).send(b),
    patch: (p: string, b: Record<string, unknown> = {}) => request(app).patch(`${API}${p}`).set(COLLEGE).set('Authorization', `Bearer ${token}`).send(b),
  });
  const review = {
    list: (q = '') => root.agent.get(`${API}/super-admin/staff-applications${q}`),
    get: (id: string) => root.agent.get(`${API}/super-admin/staff-applications/${id}`),
    identity: (id: string, b: Record<string, unknown>) => root.agent.post(`${API}/super-admin/staff-applications/${id}/identity`).set('x-csrf-token', root.csrf).send(b),
    decide: (id: string, b: Record<string, unknown>) => root.agent.post(`${API}/super-admin/staff-applications/${id}/decision`).set('x-csrf-token', root.csrf).send(b),
  };
  async function codeFor(to: string) {
    const delivery = await M.EmailDelivery.findOne({ to, template: 'verify_email_code' }).sort({ createdAt: -1, _id: -1 }).lean();
    const job = await M.Job.findOne({ type: 'email.send', 'payload.deliveryId': String(delivery!._id) }).lean();
    return (job!.payload as { vars: { code: string } }).vars.code;
  }
  /** Registers, verifies the email by code, and returns the stored application. */
  async function applied(role: string, extra: Record<string, unknown> = {}) {
    const b = body(role, extra);
    const r = await register(b);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const v = await request(app).post(`${API}/auth/verify-email/otp`).set(COLLEGE).send({ email: b.email, code: await codeFor(b.email as string), ticket: r.body.data.verificationTicket });
    expect(v.body.data?.result, JSON.stringify(v.body)).toBe('verified');
    const user = (await M.User.findOne({ email: b.email }))!;
    const application = (await StaffApplication.findOne({ userId: user._id }))!;
    return { b, user, application, id: String(application._id) };
  }
  async function approve(id: string, extra: Record<string, unknown> = {}) {
    expect((await review.identity(id, { status: 'approved', reason: 'Checked against HR records' })).status).toBe(200);
    const r = await review.decide(id, { decision: 'approve', ...extra });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.data;
  }

  beforeAll(async () => {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    mongo = await MongoMemoryServer.create();
    await (await import('../src/db/connect')).connectDatabase(mongo.getUri());
    app = (await import('../src/app')).createApp();
    M = { ...(await import('../src/models/user')), ...(await import('../src/models/platform')), ...(await import('../src/models/duty')) };
    StaffApplication = (await import('../src/models/staff-application')).StaffApplication;
    Committee = (await import('../src/models/incident')).Committee;
    for (const name of mongoose.modelNames()) await mongoose.model(name).syncIndexes();
    await (await import('../src/services/settings.service')).updateSettings({
      turnstile: { enabled: false },
      registration: { requireEmailVerification: true, campuses: [{ id: 'main', name: 'Main Campus' }, { id: 'north', name: 'North Campus' }] },
      security: { requireMfaForSuperAdmin: false, requireMfaForAdmins: false },
    } as never, '000000000000000000000000');
    const { hashPassword, encryptSecret } = await import('../src/lib/crypto');
    hash = await hashPassword(PASSWORD);
    await M.IdentityProviderConfig.create({ provider: 'google', enabled: true, clientId: WEB_CLIENT, clientSecretEnc: encryptSecret('test-secret'), allowedDomains: [] });
    vi.spyOn(OAuth2Client.prototype, 'getFederatedSignonCertsAsync').mockResolvedValue({ certs: { [KID]: signer.publicKey.export({ type: 'spki', format: 'pem' }).toString() }, format: 'PEM' } as never);
    const mk = (email: string, role: string, extra: Record<string, unknown> = {}) =>
      M.User.create({ fullName: email.split('@')[0], email, role, passwordHash: hash, emailVerified: true, accountStatus: 'active', ...extra });
    await mk('sr-root@srmap.edu.in', 'super_admin');
    await mk('sr-delegate@srmap.edu.in', 'admin', { campusZone: 'main', permissions: ['super_admin:access'] });
    await mk('sr-stu-north@srmap.edu.in', 'student', { studentId: 'AP-SR-N', campusZone: 'north' });
    await mk('sr-stu-main@srmap.edu.in', 'student', { studentId: 'AP-SR-M', campusZone: 'main' });
    committees.open = String((await Committee.create({ name: 'Anti-Ragging Committee', type: 'anti_ragging' }))._id);
    committees.students = String((await Committee.create({ name: 'Grievance Committee', type: 'grievance', memberEligibility: 'staff_and_students' }))._id);
    committees.invite = String((await Committee.create({ name: 'Internal Complaints Committee', type: 'gender_sensitivity', joinPolicy: 'invitation_only', confidential: true }))._id);
    committees.inactive = String((await Committee.create({ name: 'Old Committee', type: 'other', active: false }))._id);
    root = await webLogin('sr-root@srmap.edu.in');
  }, 180_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await mongoose.disconnect();
    await mongo?.stop();
  });

  it('lists only the permitted roles, campus records and open committees', async () => {
    const r = await request(app).get(`${API}/auth/staff-registration/options`).set(COLLEGE);
    expect(r.status).toBe(200);
    expect(r.body.data.roles.map((x: { id: string }) => x.id)).toEqual(['counsellor', 'admin', 'committee_member', 'security_officer']);
    expect(r.body.data.campuses.map((c: { id: string }) => c.id)).toEqual(['main', 'north']);
    expect(r.body.data.committees.map((c: { name: string }) => c.name).sort()).toEqual(['Anti-Ragging Committee', 'Grievance Committee']);
  });

  it('creates a pending application for each of the four roles, with no access granted', async () => {
    for (const role of ['counsellor', 'admin', 'committee_member', 'security_officer']) {
      const b = body(role);
      const r = await register(b);
      expect(r.status, `${role}: ${JSON.stringify(r.body)}`).toBe(201);
      expect(r.body.data).toMatchObject({ status: 'pending_email_verification', requiresVerification: true, verificationMethod: 'otp', emailDelivery: { status: 'queued' } });
      const u = (await M.User.findOne({ email: b.email }).lean())!;
      expect(u).toMatchObject({ approvalRequired: true, requestedRole: role, accountStatus: 'pending_verification', emailVerified: false, permissions: [], managedCampuses: [], responderEligible: false, counsellorApproved: false });
      const a = (await StaffApplication.findOne({ userId: u._id }).lean())!;
      expect(a.requestedRole).toBe(role);
      if (role === 'counsellor') expect(a.counsellor).toMatchObject({ specializations: ['academic_stress', 'general'], languages: ['English', 'Telugu'], experienceYears: 6 });
      if (role === 'committee_member') expect(a.committee).toMatchObject({ committeeName: 'Anti-Ragging Committee', position: 'chair' });
      if (role === 'security_officer') expect(a.security).toMatchObject({ serviceProvider: 'SRM Campus Security', shiftPreference: 'night' });
      if (role === 'admin') expect(a.admin).toMatchObject({ authorizationReference: 'REG/OO/2026/041' });
    }
    // Email proof moves the application to review and still activates nothing.
    const { user, application } = await applied('counsellor');
    expect(application.status).toBe('pending_review');
    expect(user.accountStatus).toBe('pending_verification');
  });

  it('validates every role’s own fields on the server', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ ...body('counsellor'), counsellor: { specializations: [], languages: ['English'], qualifications: 'MA' } }, 'counsellor.specializations'],
      [{ ...body('counsellor'), counsellor: { specializations: ['general'], languages: [] , qualifications: 'M.A. Psychology' } }, 'counsellor.languages'],
      [{ ...body('admin'), admin: {} }, 'admin.authorizationReference'],
      [{ ...body('security_officer'), security: { serviceProvider: 'X Security', shiftPreference: 'always' } }, 'security.shiftPreference'],
      [{ ...body('committee_member'), committee: { committeeId: 'nope' } }, 'committee.committeeId'],
      [{ ...body('committee_member'), committee: { committeeId: committees.inactive } }, 'committee.committeeId'],
      [{ ...body('admin'), campus: 'atlantis' }, 'campus'],
      [{ ...body('admin'), confirmPassword: 'Different-Pass-1' }, 'confirmPassword'],
      [{ ...body('admin'), password: 'short', confirmPassword: 'short' }, 'password'],
      [{ ...body('admin'), email: 'someone@gmail.com' }, 'email'],
      [{ ...body('admin'), staffId: 'bad id!' }, 'staffId'],
      [{ ...body('admin'), acceptPolicy: false }, 'acceptPolicy'],
    ];
    for (const [b, field] of cases) {
      const r = await register(b);
      expect(r.status, `${field}: ${JSON.stringify(r.body)}`).toBe(422);
      expect(Object.keys(r.body.error.details?.fields ?? {}), field).toContain(field);
    }
    expect(await M.User.countDocuments({ email: { $in: cases.map(([b]) => b.email) } })).toBe(0);
  });

  it('refuses restricted roles, invitation-only committees, closed roles and the Student app', async () => {
    for (const role of ['super_admin', 'moderator', 'student']) {
      const r = await register({ ...body('admin'), requestedRole: role });
      expect(r.status, role).toBe(422);
    }
    const invite = await register({ ...body('committee_member'), committee: { committeeId: committees.invite } });
    expect(invite.status).toBe(403);
    expect(invite.body.error.code).toBe('committee_invitation_only');
    const studentIdOnStaffCommittee = await register({ ...body('committee_member'), committee: { committeeId: committees.open, identifierType: 'student' } });
    expect(studentIdOnStaffCommittee.body.error.code).toBe('committee_not_eligible');
    expect((await register(body('admin'), STUDENT)).body.error.code).toBe('registration_staff_college_only');

    const settings = await import('../src/services/settings.service');
    await settings.updateSettings({ registration: { staffRegistrationRoles: ['counsellor', 'security_officer'] } } as never, '000000000000000000000000');
    try {
      const closed = await register(body('admin'));
      expect(closed.status).toBe(403);
      expect(closed.body.error.code).toBe('role_not_permitted');
      const opts = await request(app).get(`${API}/auth/staff-registration/options`).set(COLLEGE);
      expect(opts.body.data.roles.map((x: { id: string }) => x.id)).toEqual(['counsellor', 'security_officer']);
      expect(opts.body.data.committees).toEqual([]);
    } finally {
      await settings.updateSettings({ registration: { staffRegistrationRoles: ['counsellor', 'admin', 'committee_member', 'security_officer'] } } as never, '000000000000000000000000');
    }
  });

  it('ignores any role, permission, scope or status the client adds', async () => {
    const b = body('security_officer', { role: 'super_admin', permissions: ['super_admin:access', 'users:manage'], approvalRequired: false, accountStatus: 'active', emailVerified: true, managedCampuses: ['north'], responderEligible: true, counsellorApproved: true });
    expect((await register(b)).status).toBe(201);
    const u = (await M.User.findOne({ email: b.email }).lean())!;
    expect(u).toMatchObject({ role: 'security_officer', permissions: [], approvalRequired: true, accountStatus: 'pending_verification', emailVerified: false, managedCampuses: [], responderEligible: false, counsellorApproved: false });
  });

  it('refuses duplicate emails and staff IDs (including open applications)', async () => {
    const b = body('counsellor');
    expect((await register(b)).status).toBe(201);
    const sameEmail = await register({ ...body('admin'), email: b.email });
    expect(sameEmail.status).toBe(409);
    expect(sameEmail.body.error.details.fields).toHaveProperty('email');
    const sameStaff = await register({ ...body('admin'), staffId: (b.staffId as string).toLowerCase() });
    expect(sameStaff.status).toBe(409);
    expect(sameStaff.body.error.details.fields).toHaveProperty('staffId');
  });

  it('keeps the application and reports the failure when the verification email cannot be sent', async () => {
    const cfg = await M.EmailProviderConfig.create({ type: 'nodemailer', service: 'gmail', fromName: 'CampusCare', fromEmail: 'noreply@example.invalid', authUser: null, active: true });
    let b: Record<string, unknown>;
    let r: request.Response;
    try {
      b = body('admin');
      r = await register(b);
    } finally {
      await cfg.deleteOne();
    }
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.emailDelivery.status).toBe('failed');
    expect(r.body.data.verificationTicket).toBeTruthy();
    const u = (await M.User.findOne({ email: b.email }).lean())!;
    expect(u.emailVerified).toBe(false); // never verified because something was (or was not) queued
    expect(await StaffApplication.exists({ userId: u._id })).toBeTruthy();
    // Once email works again the person resends with the ticket and verifies with a fresh code.
    const resend = await request(app).post(`${API}/auth/verification/send`).set(COLLEGE).send({ ticket: r.body.data.verificationTicket, method: 'otp' });
    expect(resend.status, JSON.stringify(resend.body)).toBe(200);
    const v = await request(app).post(`${API}/auth/verify-email/otp`).set(COLLEGE).send({ email: b.email, code: await codeFor(b.email as string), ticket: r.body.data.verificationTicket });
    expect(v.body.data.result).toBe('verified');
    expect((await StaffApplication.findOne({ userId: u._id }).lean())!.status).toBe('pending_review');
  });

  it('verifies by link as well, with single-use links', async () => {
    const b = body('counsellor', { verificationMethod: 'link' });
    const r = await register(b);
    expect(r.body.data.verificationMethod).toBe('link');
    const delivery = await M.EmailDelivery.findOne({ to: b.email, template: 'verify_email' }).sort({ createdAt: -1 }).lean();
    const job = await M.Job.findOne({ type: 'email.send', 'payload.deliveryId': String(delivery!._id) }).lean();
    const link = (job!.payload as { vars: { link: string } }).vars.link;
    expect(link).not.toContain('localhost:4000');
    const token = new URL(link).searchParams.get('token') ?? link.split('/').pop()!;
    expect((await request(app).post(`${API}/auth/verify-email`).set(COLLEGE).send({ token })).body.data.result).toBe('verified');
    expect((await request(app).post(`${API}/auth/verify-email`).set(COLLEGE).send({ token })).body.data.result).toBe('already_verified'); // single use: nothing happens twice
    const u = (await M.User.findOne({ email: b.email }).lean())!;
    expect(u.accountStatus).toBe('pending_verification');
    expect((await StaffApplication.findOne({ userId: u._id }).lean())!.status).toBe('pending_review');
  });

  it('gives an unapproved applicant only a restricted session', async () => {
    const { b } = await applied('security_officer');
    const { token, body: login } = await appLogin(b.email as string);
    expect(login.applicationPending).toBe(true);
    const s = as(token);
    const mine = await s.get('/auth/staff-registration/me');
    expect(mine.status).toBe(200);
    expect(mine.body.data.application.statuses).toMatchObject({ registration: 'pending_review', emailVerification: 'verified', identityVerification: 'pending', roleApproval: 'pending', accountActivation: 'pending_verification' });
    for (const p of ['/admin/users', '/responders/me/duty', '/safety/responder/alerts', '/counselling/appointments', '/chats', '/super-admin/staff-applications']) {
      expect((await s.get(p)).status, p).toBe(403);
    }
    // Cannot put itself on duty or change its own application while it is under review.
    expect((await s.patch('/responders/me/duty-status', { status: 'available' })).status).toBe(403);
    expect((await s.patch('/auth/staff-registration/me', { department: 'Elsewhere' })).status).toBe(409);
  });

  it('approves only after email and identity verification, and only by a Super Admin who is not the applicant', async () => {
    const { id, user } = await applied('admin', { campus: 'north' });
    expect((await review.decide(id, { decision: 'approve' })).body.error.code).toBe('identity_not_verified');
    // A Campus Admin holding a delegated Super Admin permission still cannot decide.
    const delegate = await appLogin('sr-delegate@srmap.edu.in');
    const byDelegate = await as(delegate.token).post(`/super-admin/staff-applications/${id}/decision`, { decision: 'approve' });
    expect(byDelegate.status, JSON.stringify(byDelegate.body)).toBe(403);
    expect((await StaffApplication.findById(id).lean())!.status).toBe('pending_review');
    // Nobody approves their own application.
    const rootUser = (await M.User.findOne({ email: 'sr-root@srmap.edu.in' }))!;
    const own = await StaffApplication.create({ userId: rootUser._id, requestedRole: 'admin', status: 'pending_review', fullName: 'Root', email: rootUser.email, staffId: 'ROOT-1', department: 'IT', campus: 'main', designation: 'Owner' });
    expect((await review.decide(String(own._id), { decision: 'approve' })).body.error.code).toBe('self_approval');
    await own.deleteOne();

    const granted = await approve(id);
    expect(granted.granted).toMatchObject({ role: 'admin', campus: 'north' });
    const u = (await M.User.findById(user._id).lean())!;
    expect(u).toMatchObject({ role: 'admin', accountStatus: 'active', approvalRequired: false, campusZone: 'north', managedCampuses: ['north'], permissions: [] });
    // Campus scope is enforced: the new Campus Admin sees only North campus accounts.
    const { token } = await appLogin(u.email);
    const list = await as(token).get('/admin/users?limit=100');
    expect(list.status).toBe(200);
    const emails = list.body.data.items.map((i: { email: string }) => i.email);
    expect(emails).toContain('sr-stu-north@srmap.edu.in');
    expect(emails).not.toContain('sr-stu-main@srmap.edu.in');
    // Decided applications cannot be decided again; the history and audit trail are recorded.
    expect((await review.decide(id, { decision: 'reject', reason: 'Changed my mind' })).status).toBe(409);
    const detail = await review.get(id);
    expect(detail.body.data.history.map((h: { action: string }) => h.action)).toEqual(['submitted', 'email_verified', 'identity_approved', 'approve']);
    expect(detail.body.data.audit.map((a: { action: string }) => a.action)).toContain('staff_application.approved');
    expect(await M.AuditLog.countDocuments({ action: 'staff_application.approved', targetId: id })).toBe(1);
  });

  it('asks for more information, lets the applicant answer, and records rejections with a reason', async () => {
    const { id, b } = await applied('counsellor');
    expect((await review.decide(id, { decision: 'needs_info' })).body.error.code).toBe('reason_required');
    expect((await review.decide(id, { decision: 'needs_info', reason: 'Add your RCI registration number' })).status).toBe(200);
    const { token } = await appLogin(b.email as string);
    const before = await as(token).get('/auth/staff-registration/me');
    expect(before.body.data.application).toMatchObject({ infoRequest: 'Add your RCI registration number', statuses: { registration: 'needs_info', roleApproval: 'needs_info' } });
    const upd = await as(token).patch('/auth/staff-registration/me', { requestedRole: 'admin', counsellor: { qualifications: 'M.Phil, RCI A12345' }, note: 'Added RCI number' });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    const a = (await StaffApplication.findById(id).lean())!;
    expect(a).toMatchObject({ status: 'pending_review', requestedRole: 'counsellor', applicantNote: 'Added RCI number' });
    expect(a.counsellor!.qualifications).toBe('M.Phil, RCI A12345');

    expect((await review.decide(id, { decision: 'reject', reason: 'Not employed by the university' })).status).toBe(200);
    const after = await as(token).get('/auth/staff-registration/me');
    expect(after.body.data.application).toMatchObject({ decisionReason: 'Not employed by the university', statuses: { registration: 'rejected', roleApproval: 'rejected', accountActivation: 'pending_verification' } });
    expect((await as(token).get('/admin/users')).status).toBe(403);
  });

  it('makes an approved counsellor bookable only after approval', async () => {
    const { isStudentVisible } = await import('../src/services/counsellor-directory.service');
    const { id, user } = await applied('counsellor');
    expect(await isStudentVisible(user._id)).toBe(false);
    await approve(id);
    expect(await isStudentVisible(user._id)).toBe(true);
    const { Availability } = await import('../src/models/counselling');
    const av = (await Availability.findOne({ counsellorId: user._id }).lean())!;
    expect(av).toMatchObject({ specializations: ['academic_stress', 'general'], languages: ['English', 'Telugu'], supportedModes: ['in_person'], listed: true });
    // Credentials wait for the usual credential review before students see them.
    expect(av.qualifications).toEqual([]);
    expect(av.pendingCredentials?.qualifications).toEqual(['M.Phil Clinical Psychology']);
  });

  it('adds an approved Security Officer to SOS dispatch only after approval, and Off duty', async () => {
    const { loadCandidates } = await import('../src/services/dispatch.service');
    const { id, user } = await applied('security_officer');
    const before = (await loadCandidates()).find((c) => c.userId === String(user._id));
    expect(before?.accountActive ?? false).toBe(false);
    await approve(id);
    const after = (await loadCandidates()).find((c) => c.userId === String(user._id))!;
    expect(after).toMatchObject({ accountActive: true, status: 'off_duty' });
    expect((await M.User.findById(user._id).lean())!.responderEligible).toBe(true);
  });

  it('grants only the approved committee, as a member unless the reviewer decides otherwise', async () => {
    const { id, user, application } = await applied('committee_member');
    expect(application.committee!.position).toBe('chair'); // requested
    await approve(id);
    const u = (await M.User.findById(user._id).lean())!;
    expect(u.role).toBe('committee_member');
    expect(u.committeeMemberships.map((m) => [String(m.committeeId), m.position])).toEqual([[committees.open, 'member']]);
    const { token } = await appLogin(u.email);
    expect((await as(token).get('/admin/committees')).status).toBe(403); // no committee management
  });

  it('registers with Google: the native token yields a ticket, never a role', async () => {
    const noAccount = await request(app).post(`${API}/auth/google/mobile`).set(COLLEGE).send({ idToken: idToken({ sub: 'g-new-1', email: 'sr-google1@srmap.edu.in', nonce: 'n' }), nonce: 'n' });
    expect(noAccount.status).toBe(403);
    expect(noAccount.body.error.code).toBe('no_staff_account');
    const ticket = noAccount.body.error.details.staffRegistrationTicket as string;
    expect(ticket).toMatch(/^gr1\./);

    const tampered = await register({ ...body('counsellor'), password: undefined, confirmPassword: undefined, googleTicket: `${ticket}x` });
    expect(tampered.body.error.code).toBe('google_ticket_expired');

    const r = await register({ ...body('counsellor'), email: 'someone-else@srmap.edu.in', password: undefined, confirmPassword: undefined, googleTicket: ticket });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data).toMatchObject({ applicationPending: true, requiresVerification: false, email: 'sr-google1@srmap.edu.in' });
    const u = (await M.User.findOne({ email: 'sr-google1@srmap.edu.in' }).select('+passwordHash').lean())!;
    expect(u).toMatchObject({ emailVerified: true, approvalRequired: true, accountStatus: 'pending_verification', passwordHash: null });
    expect((await StaffApplication.findOne({ userId: u._id }).lean())).toMatchObject({ status: 'pending_review', registrationMethod: 'google' });
    const s = as(r.body.data.sessionToken);
    expect((await s.get('/auth/staff-registration/me')).status).toBe(200);
    expect((await s.get('/admin/users')).status).toBe(403);
    // Signing in with Google again gives the same restricted session; registering again is refused.
    const again = await request(app).post(`${API}/auth/google/mobile`).set(COLLEGE).send({ idToken: idToken({ sub: 'g-new-1', email: 'sr-google1@srmap.edu.in' }) });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body.data.applicationPending).toBe(true);
    const start = await request(app).post(`${API}/auth/staff-registration/google`).set(COLLEGE).send({ idToken: idToken({ sub: 'g-new-1', email: 'sr-google1@srmap.edu.in' }) });
    expect(start.body.error.code).toBe('account_exists');
    const fresh = await request(app).post(`${API}/auth/staff-registration/google`).set(COLLEGE).send({ idToken: idToken({ sub: 'g-new-2', email: 'sr-google2@srmap.edu.in' }) });
    expect(fresh.body.data).toMatchObject({ email: 'sr-google2@srmap.edu.in' });
  });

  it('lists requests with filters for role, campus, department, date and verification states', async () => {
    const all = await review.list('?status=all&limit=100');
    expect(all.status).toBe(200);
    expect(all.body.data.total).toBeGreaterThan(5);
    const north = await review.list('?status=all&campus=north&limit=100');
    expect(north.body.data.items.every((i: { campus: string }) => i.campus === 'north')).toBe(true);
    const sec = await review.list('?status=all&role=security_officer&limit=100');
    expect(sec.body.data.items.every((i: { requestedRole: string }) => i.requestedRole === 'security_officer')).toBe(true);
    const unverified = await review.list('?status=all&emailVerified=false&limit=100');
    expect(unverified.body.data.items.length).toBeGreaterThan(0);
    expect(unverified.body.data.items.every((i: { statuses: { emailVerification: string } }) => i.statuses.emailVerification === 'pending')).toBe(true);
    const identityApproved = await review.list('?status=all&identity=approved&limit=100');
    expect(identityApproved.body.data.items.every((i: { statuses: { identityVerification: string } }) => i.statuses.identityVerification === 'approved')).toBe(true);
    const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
    expect((await review.list(`?status=all&from=${tomorrow}`)).body.data.total).toBe(0);
    expect((await review.list('?status=all&department=student%20aff')).body.data.total).toBeGreaterThan(0);
    // Applicants and Campus Admins cannot see the queue.
    const { token } = await appLogin((await M.User.findOne({ role: 'admin', approvedBy: { $ne: null } }).lean())!.email);
    expect((await as(token).get('/super-admin/staff-applications')).status).toBe(403);
  });

  it('returns legacy self-registered staff (no application) to review', async () => {
    const { audit } = await import('../src/services/audit.service');
    const { reconcileLegacyStaffApplications } = await import('../src/services/staff-registration.service');
    const legacy = await M.User.create({ fullName: 'Legacy Guard', email: 'sr-legacy@srmap.edu.in', role: 'security_officer', passwordHash: hash, emailVerified: true, accountStatus: 'active', staffId: 'LEG-1', campusZone: 'main' });
    await audit({ action: 'auth.staff_registered', actorId: String(legacy._id), targetType: 'user', targetId: String(legacy._id) });
    expect(await reconcileLegacyStaffApplications()).toBe(1);
    expect(await reconcileLegacyStaffApplications()).toBe(0); // idempotent
    expect((await M.User.findById(legacy._id).lean())).toMatchObject({ accountStatus: 'pending_verification', approvalRequired: true, requestedRole: 'security_officer' });
    expect((await StaffApplication.findOne({ userId: legacy._id }).lean())!.status).toBe('pending_review');
  });

  it('leaves student registration and staff password sign-in unchanged', async () => {
    const r = await request(app).post(`${API}/auth/register`).set(STUDENT).send({
      fullName: 'New Student', email: 'sr-newstudent@srmap.edu.in', studentId: 'AP-SR-NEW', department: 'CSE', academicYear: 2,
      password: PASSWORD, confirmPassword: PASSWORD, acceptPolicy: true, verificationMethod: 'otp',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect((await M.User.findOne({ email: 'sr-newstudent@srmap.edu.in' }).lean())).toMatchObject({ role: 'student', approvalRequired: false });
    const fromCollege = await request(app).post(`${API}/auth/register`).set(COLLEGE).send({
      fullName: 'Another Student', email: 'sr-newstudent2@srmap.edu.in', studentId: 'AP-SR-NEW2', department: 'CSE', academicYear: 2,
      password: PASSWORD, confirmPassword: PASSWORD, acceptPolicy: true,
    });
    expect(fromCollege.body.error.code).toBe('registration_student_only');
    const { body: login } = await appLogin('sr-delegate@srmap.edu.in');
    expect(login.applicationPending).toBe(false);
  });
});
