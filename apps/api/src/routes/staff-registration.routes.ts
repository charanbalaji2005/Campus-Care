import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  COUNSELLING_TYPES, SECURITY_SHIFT_LABELS, SECURITY_SHIFT_PREFERENCES, STAFF_REGISTRATION_ROLE_INFO,
  googleIdTokenSchema, passwordSchema, staffApplicationUpdateSchema, staffRegistrationSchema,
  type StaffRegistrationInput,
} from '@campuscare/shared';
import { AppError, asyncHandler, ok, parse } from '../lib/http';
import { hashPassword } from '../lib/crypto';
import { ExternalIdentity, User, publicUser } from '../models/user';
import { StaffApplication } from '../models/staff-application';
import { requireAuth } from '../middleware/auth';
import { authLimiter, requireTurnstile } from '../middleware/security';
import { createSession, isDomainAllowed, issueEmailVerification, issueVerificationTicket, isPendingApplicant } from '../services/auth.service';
import { emailReadiness, maskEmail } from '../services/email/email.service';
import { getGoogleConfig, verifyGoogleIdToken } from '../services/google.service';
import { getSettings } from '../services/settings.service';
import { audit } from '../services/audit.service';
import {
  applicantView, campusRecords, eligibleCommittee, evidenceSummary, issueGoogleRegistrationTicket, openCommittees,
  permittedRoles, readGoogleRegistrationTicket, resolveCampus,
} from '../services/staff-registration.service';

/**
 * CampusCare College staff registration: an application for one of four roles. Creating it never grants
 * the role. The account stays inactive until its email is verified AND a Super Admin approves it
 * (routes/staff-applications.routes.ts); until then the applicant can only check and complete it.
 */
export const staffRegistrationRouter = Router();

const COUNSELLING_LABELS: Record<(typeof COUNSELLING_TYPES)[number], string> = {
  academic_stress: 'Academic stress', anxiety_mental_health: 'Anxiety & mental health', career: 'Career guidance',
  relationships: 'Relationships', grief_loss: 'Grief & loss', general: 'General wellbeing',
};

function refuseStudentApp(req: Request) {
  if (req.clientApp === 'student') {
    throw new AppError(403, 'registration_staff_college_only', 'Staff apply in the CampusCare College app. Students register in CampusCare Student.');
  }
}

/** What the form needs: permitted roles, campus records, open committees and choice lists. Public, no personal data. */
staffRegistrationRouter.get(
  '/staff-registration/options',
  asyncHandler(async (_req, res) => {
    const s = await getSettings();
    const roles = permittedRoles(s);
    ok(res, {
      open: roles.length > 0,
      roles: roles.map((id) => ({ id, ...STAFF_REGISTRATION_ROLE_INFO[id] })),
      campuses: campusRecords(s),
      committees: roles.includes('committee_member') ? await openCommittees() : [],
      specializations: COUNSELLING_TYPES.map((id) => ({ id, label: COUNSELLING_LABELS[id] })),
      sessionModes: [{ id: 'in_person', label: 'In person' }, { id: 'online', label: 'Online' }],
      shiftPreferences: SECURITY_SHIFT_PREFERENCES.map((id) => ({ id, label: SECURITY_SHIFT_LABELS[id] })),
      requireAdminAuthorizationReference: s.registration.requireAdminAuthorizationReference !== false,
      passwordMinLength: s.security.passwordMinLength,
      verificationMethods: ['otp', 'link'],
    });
  }),
);

/**
 * Verifies a Google ID token from the College app's native sign-in for someone who has no account yet,
 * and returns a sealed 30-minute ticket for the application form. It creates nothing.
 */
staffRegistrationRouter.post(
  '/staff-registration/google',
  authLimiter,
  asyncHandler(async (req, res) => {
    refuseStudentApp(req);
    const input = parse(googleIdTokenSchema, req.body);
    const cfg = await getGoogleConfig();
    if (!cfg) throw new AppError(503, 'google_unavailable', 'Google sign-in is not configured.');
    let identity;
    try {
      identity = await verifyGoogleIdToken(cfg, input.idToken, input.nonce);
    } catch {
      await audit({ action: 'auth.google_failed', req, outcome: 'failure', meta: { client: 'android', purpose: 'staff_registration' } });
      throw new AppError(401, 'oauth_failed', 'We could not verify your Google account. Please try again.');
    }
    if (!identity.emailVerified) throw new AppError(403, 'google_email_unverified', 'Your Google email address is not verified.');
    if (!(await isDomainAllowed(identity.email, 'staff')) && !(await isDomainAllowed(identity.email, 'students'))) {
      throw new AppError(403, 'domain_not_allowed', 'Use your official university Google account.');
    }
    if ((await User.exists({ email: identity.email })) || (await ExternalIdentity.exists({ provider: 'google', subject: identity.subject }))) {
      throw new AppError(409, 'account_exists', 'An account already uses this Google address. Sign in instead.');
    }
    ok(res, { googleTicket: issueGoogleRegistrationTicket(identity), email: identity.email, fullName: identity.name });
  }),
);

/** Role-specific checks the schema cannot do: settings policy, campus records, committees, duplicates. */
async function validateApplication(input: StaffRegistrationInput) {
  const s = await getSettings();
  if (!permittedRoles(s).includes(input.requestedRole)) {
    throw new AppError(403, 'role_not_permitted', 'Applications for this role are not open. Contact your campus administrator.', { fields: { requestedRole: 'Not open for applications' } });
  }
  const campus = resolveCampus(s, input.campus);
  let committee: Awaited<ReturnType<typeof eligibleCommittee>> | null = null;
  if (input.requestedRole === 'admin' && s.registration.requireAdminAuthorizationReference !== false && !input.admin.authorizationReference) {
    throw new AppError(422, 'validation_failed', 'Enter the institutional authorization reference for this request.', { fields: { 'admin.authorizationReference': 'Required for Campus Admin requests' } });
  }
  if (input.requestedRole === 'committee_member') committee = await eligibleCommittee(input.committee.committeeId, input.committee.identifierType);
  const studentIdentifier = input.requestedRole === 'committee_member' && input.committee.identifierType === 'student';
  if (!(await isDomainAllowed(input.email, studentIdentifier ? 'students' : 'staff'))) {
    throw new AppError(422, 'validation_failed', 'Use your official university email address.', { fields: { email: 'Use your official institutional email' } });
  }
  return { s, campus, committee, studentIdentifier };
}

async function assertNotDuplicate(req: Request, email: string, staffId: string) {
  const [dupEmail, dupStaff, dupApplication] = await Promise.all([
    User.exists({ email }),
    User.exists({ $or: [{ staffId }, { studentId: staffId }] }),
    StaffApplication.exists({ staffId, status: { $ne: 'rejected' } }),
  ]);
  if (dupEmail || dupStaff || dupApplication) {
    await audit({ action: 'auth.register_staff_duplicate', req, outcome: 'denied' });
    throw new AppError(409, 'account_exists', 'An account or application with these details already exists. Try signing in or resetting your password.', {
      fields: { ...(dupEmail ? { email: 'Already registered' } : {}), ...(dupStaff || dupApplication ? { staffId: 'Already registered' } : {}) },
    });
  }
}

function roleDetails(input: StaffRegistrationInput, committee: { _id: unknown; name: string } | null) {
  switch (input.requestedRole) {
    case 'counsellor':
      return { counsellor: { ...input.counsellor, languages: [...new Set(input.counsellor.languages.map((l) => l.trim()))], experienceYears: input.counsellor.experienceYears ?? null } };
    case 'admin':
      return { admin: { authorizationReference: input.admin.authorizationReference ?? null } };
    case 'committee_member':
      return { committee: { ...input.committee, committeeId: committee!._id, committeeName: committee!.name } };
    case 'security_officer':
      return { security: input.security };
  }
}

/**
 * Creates a staff application (password or Google). The role is recorded as *requested*: the account is
 * inactive (approvalRequired) and the role's permissions apply only after a Super Admin approves it.
 * Any role, permission, campus scope or status the client adds is ignored (the schema strips it).
 */
staffRegistrationRouter.post(
  '/register-staff',
  authLimiter,
  requireTurnstile('register'),
  asyncHandler(async (req, res) => {
    refuseStudentApp(req);
    const input = parse(staffRegistrationSchema, req.body);
    const google = input.googleTicket ? readGoogleRegistrationTicket(input.googleTicket) : null;
    if (input.googleTicket && !google) throw new AppError(401, 'google_ticket_expired', 'Your Google sign-in has expired. Continue with Google again.');
    const email = google ? google.email : input.email;
    const { s, campus, committee, studentIdentifier } = await validateApplication({ ...input, email });
    let passwordHash: string | null = null;
    if (!google) {
      const password = parse(z.object({ password: passwordSchema(s.security.passwordMinLength), confirmPassword: z.string() })
        .refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' }), input);
      passwordHash = await hashPassword(password.password);
    }
    await assertNotDuplicate(req, email, input.staffId);
    if (google && (await ExternalIdentity.exists({ provider: 'google', subject: google.subject }))) {
      throw new AppError(409, 'account_exists', 'An account already uses this Google address. Sign in instead.');
    }

    const user = await User.create({
      fullName: input.fullName,
      email,
      passwordHash,
      // The requested role is stored, but nothing it allows works: the account is not active and
      // approvalRequired keeps it so (email proof, reactivation and password resets never activate it).
      role: input.requestedRole,
      requestedRole: input.requestedRole,
      permissions: [],
      approvalRequired: true,
      accountStatus: 'pending_verification',
      // Google already proved control of this address; the role still waits for review.
      emailVerified: Boolean(google),
      emailVerifiedAt: google ? new Date() : null,
      ...(studentIdentifier ? { studentId: input.staffId } : { staffId: input.staffId }),
      department: input.department,
      designation: input.designation,
      campusZone: campus.id,
      phone: input.phone,
      verificationStatus: 'pending',
    });
    let application;
    try {
      application = await StaffApplication.create({
        userId: user._id,
        requestedRole: input.requestedRole,
        status: google ? 'pending_review' : 'pending_email_verification',
        registrationMethod: google ? 'google' : 'password',
        fullName: input.fullName, email, staffId: input.staffId, department: input.department, campus: campus.id,
        designation: input.designation, phone: input.phone,
        ...roleDetails(input, committee),
        history: [{ at: new Date(), actorId: user._id, actorRole: 'applicant', action: 'submitted', to: google ? 'pending_review' : 'pending_email_verification' }],
      });
      if (google) await ExternalIdentity.create({ userId: user._id, provider: 'google', subject: google.subject, email });
    } catch (err) {
      // Never leave an account without its application (or a Google link that failed on a race).
      await StaffApplication.deleteOne({ userId: user._id }).catch(() => undefined);
      await User.deleteOne({ _id: user._id }).catch(() => undefined);
      if ((err as { code?: number }).code === 11000) throw new AppError(409, 'account_exists', 'An account with these details already exists. Try signing in.');
      throw err;
    }
    await audit({
      action: 'auth.staff_registered', actorId: String(user._id), actorRole: 'applicant', targetType: 'staff_application', targetId: String(application._id), req,
      meta: { userId: String(user._id), requestedRole: input.requestedRole, campus: campus.id, method: google ? 'google' : 'password', committeeId: committee ? String(committee._id) : null },
    });

    if (google) {
      // Restricted session: only the application status, evidence upload and sign-out work (middleware/auth.ts).
      const session = await createSession(req, res, user, { method: 'google', mfaVerified: false });
      return ok(res, {
        applicationId: String(application._id),
        status: application.status,
        requiresVerification: false,
        email,
        user: publicUser(user),
        applicationPending: true,
        ...(session.plainToken ? { sessionToken: session.plainToken, expiresAt: session.expiresAt } : {}),
      }, 201);
    }

    // The application is kept even if the email cannot be sent now; the person can resend from the next screen.
    let verificationMethod: string | null = null;
    let emailDelivery: { status: 'queued' | 'failed'; message?: string } = { status: 'queued' };
    const readiness = await emailReadiness().catch(() => ({ ready: false, message: 'Email is unavailable right now.' }));
    if (!readiness.ready) {
      emailDelivery = { status: 'failed', message: 'We could not send the verification email right now. Your application is saved; try sending it again in a few minutes.' };
    } else {
      try {
        verificationMethod = await issueEmailVerification(user, input.verificationMethod);
      } catch {
        emailDelivery = { status: 'failed', message: 'We could not send the verification email right now. Your application is saved; try sending it again in a few minutes.' };
      }
    }
    ok(res, {
      applicationId: String(application._id),
      status: application.status,
      requiresVerification: true,
      email,
      maskedEmail: maskEmail(email),
      verificationMethod,
      emailDelivery,
      verificationTicket: issueVerificationTicket(String(user._id)),
    }, 201);
  }),
);

/** The applicant's own application and its separate states. Allowed for a pending applicant's restricted session. */
staffRegistrationRouter.get(
  '/staff-registration/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const app = await StaffApplication.findOne({ userId: user._id });
    if (!app) throw new AppError(404, 'no_application', 'There is no staff application for this account.');
    ok(res, { application: applicantView(app, user, await evidenceSummary(user._id)), user: publicUser(user), applicationPending: isPendingApplicant(user) });
  }),
);

/**
 * When a reviewer asks for more information, the applicant corrects role details here and the request
 * returns to review. Role, name, email and staff ID never change through this endpoint.
 */
staffRegistrationRouter.patch(
  '/staff-registration/me',
  requireAuth,
  authLimiter,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const app = await StaffApplication.findOne({ userId: user._id });
    if (!app) throw new AppError(404, 'no_application', 'There is no staff application for this account.');
    if (app.status !== 'needs_info') throw new AppError(409, 'application_locked', 'Your application can be changed only when a reviewer asks for more information.');
    const input = parse(staffApplicationUpdateSchema, req.body);
    const s = await getSettings();
    if (input.campus) {
      app.campus = resolveCampus(s, input.campus).id;
      user.campusZone = app.campus;
    }
    if (input.department) { app.department = input.department; user.department = input.department; }
    if (input.designation) { app.designation = input.designation; user.designation = input.designation; }
    if (input.phone !== null && input.phone !== undefined) { app.phone = input.phone; user.phone = input.phone; }
    // Only the section that belongs to the requested role is accepted.
    if (app.requestedRole === 'counsellor' && input.counsellor && app.counsellor) Object.assign(app.counsellor, stripUndefined(input.counsellor));
    if (app.requestedRole === 'admin' && input.admin) app.admin = { ...(app.admin ?? {}), ...stripUndefined(input.admin) } as typeof app.admin;
    if (app.requestedRole === 'committee_member' && input.committee && app.committee) Object.assign(app.committee, stripUndefined(input.committee));
    if (app.requestedRole === 'security_officer' && input.security && app.security) Object.assign(app.security, stripUndefined(input.security));
    app.applicantNote = input.note ?? app.applicantNote;
    app.status = 'pending_review';
    app.history.push({ at: new Date(), actorId: user._id, actorRole: 'applicant', action: 'information_provided', from: 'needs_info', to: 'pending_review', reason: input.note ?? null });
    await app.save();
    await user.save();
    await audit({ action: 'staff_application.updated', req, targetType: 'staff_application', targetId: String(app._id), meta: { fields: Object.keys(input) } });
    ok(res, { application: applicantView(app, user, await evidenceSummary(user._id)) });
  }),
);

function stripUndefined<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
