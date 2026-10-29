import { Router, type Request } from 'express';
import { Types } from 'mongoose';
import {
  STAFF_APPLICATION_STATUSES, STAFF_APPLICATION_STATUS_LABELS, STAFF_REGISTRATION_ROLES, STAFF_REGISTRATION_ROLE_INFO,
  STUDENT_VERIFICATION_STATUSES, canDecideStaffApplication, canTransitionVerification, staffApplicationDecisionSchema,
  staffIdentityDecisionSchema, type StaffApplicationStatus, type StudentVerificationStatus,
} from '@campuscare/shared';
import { AppError, asyncHandler, escapeRegex, notFound, ok, pageParams, parse } from '../lib/http';
import { requireRecentAuth } from '../middleware/auth';
import { StaffApplication, type StaffApplicationDoc } from '../models/staff-application';
import { User, VerificationEvidence, type UserDoc } from '../models/user';
import { Availability } from '../models/counselling';
import { ResponderAvailability } from '../models/duty';
import { AuditLog } from '../models/platform';
import { audit } from '../services/audit.service';
import { sendEmail } from '../services/email/email.service';
import { notify } from '../services/notification.service';
import { getSettings } from '../services/settings.service';
import { applicationStatuses, eligibleCommittee, resolveCampus } from '../services/staff-registration.service';

/**
 * Super Admin → Staff Registration Requests. Mounted under /super-admin (requireAuth + super_admin:access
 * + MFA policy). Every decision is made here, on the server, from the stored application: the client
 * never supplies the role, permissions, campus scope or committee that an approval grants.
 */
export const staffApplicationsRouter = Router();

/** Only a real Super Admin decides, and never on their own application (a delegated permission is not enough). */
function assertReviewer(req: Request, app: StaffApplicationDoc) {
  if (req.user!.role !== 'super_admin') throw new AppError(403, 'forbidden', 'Only a Super Admin can decide staff applications.');
  if (String(app.userId) === String(req.user!._id)) throw new AppError(403, 'self_approval', 'You cannot review your own application.');
}

async function loadApplication(id: string) {
  if (!Types.ObjectId.isValid(id)) throw notFound('Application not found.');
  const app = await StaffApplication.findById(id);
  if (!app) throw notFound('Application not found.');
  const user = await User.findById(app.userId);
  if (!user) throw notFound('Applicant account not found.');
  return { app, user };
}

function summary(app: StaffApplicationDoc, user: UserDoc, evidenceCount: number) {
  return {
    id: String(app._id),
    userId: String(user._id),
    fullName: app.fullName,
    email: app.email,
    staffId: app.staffId,
    requestedRole: app.requestedRole,
    requestedRoleLabel: STAFF_REGISTRATION_ROLE_INFO[app.requestedRole as keyof typeof STAFF_REGISTRATION_ROLE_INFO]?.title ?? app.requestedRole,
    campus: app.campus,
    department: app.department,
    designation: app.designation,
    committeeName: app.committee?.committeeName ?? null,
    registrationMethod: app.registrationMethod,
    statuses: applicationStatuses(app, user),
    evidenceCount,
    submittedAt: (app as unknown as { createdAt: Date }).createdAt,
    decidedAt: app.decidedAt,
  };
}

staffApplicationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = pageParams(req.query);
    const q = req.query as Record<string, string | undefined>;
    const filter: Record<string, unknown> = {};
    if (q.role && (STAFF_REGISTRATION_ROLES as readonly string[]).includes(q.role)) filter.requestedRole = q.role;
    if (q.status && (STAFF_APPLICATION_STATUSES as readonly string[]).includes(q.status)) filter.status = q.status;
    else if (q.status !== 'all') filter.status = { $in: ['pending_email_verification', 'pending_review', 'needs_info'] };
    if (q.campus && q.campus !== 'all') filter.campus = String(q.campus).slice(0, 50);
    if (q.department) filter.department = { $regex: escapeRegex(String(q.department).slice(0, 60)), $options: 'i' };
    const created: Record<string, Date> = {};
    if (q.from && !Number.isNaN(Date.parse(q.from))) created.$gte = new Date(q.from);
    if (q.to && !Number.isNaN(Date.parse(q.to))) created.$lte = new Date(new Date(q.to).getTime() + (q.to.length <= 10 ? 86400_000 - 1 : 0));
    if (Object.keys(created).length) filter.createdAt = created;
    if (q.q) {
      const rx = escapeRegex(String(q.q).trim().slice(0, 80));
      filter.$or = [{ fullName: { $regex: rx, $options: 'i' } }, { email: { $regex: rx, $options: 'i' } }, { staffId: { $regex: rx, $options: 'i' } }];
    }
    // Email and identity verification live on the account: narrow by the matching applicants.
    const userFilter: Record<string, unknown> = {};
    if (q.emailVerified === 'true' || q.emailVerified === 'false') userFilter.emailVerified = q.emailVerified === 'true';
    if (q.identity && (STUDENT_VERIFICATION_STATUSES as readonly string[]).includes(q.identity)) userFilter.verificationStatus = q.identity;
    if (Object.keys(userFilter).length) {
      const candidates = await StaffApplication.find(filter, { userId: 1 }).limit(5000).lean();
      const matching = await User.find({ _id: { $in: candidates.map((c) => c.userId) }, ...userFilter }, { _id: 1 }).lean();
      filter.userId = { $in: matching.map((u) => u._id) };
    }
    const [apps, total, counts] = await Promise.all([
      StaffApplication.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      StaffApplication.countDocuments(filter),
      StaffApplication.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    ]);
    const users = new Map((await User.find({ _id: { $in: apps.map((a) => a.userId) } })).map((u) => [String(u._id), u]));
    const evidence = new Map((await VerificationEvidence.aggregate([
      { $match: { userId: { $in: apps.map((a) => a.userId) } } }, { $group: { _id: '$userId', n: { $sum: 1 } } },
    ])).map((e) => [String(e._id), e.n as number]));
    const s = await getSettings();
    ok(res, {
      items: apps.filter((a) => users.has(String(a.userId))).map((a) => summary(a, users.get(String(a.userId))!, evidence.get(String(a.userId)) ?? 0)),
      total, page, limit, pages: Math.ceil(total / limit) || 1,
      counts: Object.fromEntries(STAFF_APPLICATION_STATUSES.map((st) => [st, counts.find((c) => c._id === st)?.n ?? 0])),
      campuses: s.registration.campuses ?? [],
      statusLabels: STAFF_APPLICATION_STATUS_LABELS,
    });
  }),
);

staffApplicationsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { app, user } = await loadApplication(req.params.id);
    const evidence = await VerificationEvidence.find({ userId: user._id }).sort({ createdAt: -1 }).lean();
    const auditRows = await AuditLog.find({ targetId: { $in: [String(app._id), String(user._id)] } }, { action: 1, at: 1, actorRole: 1, actorName: 1, outcome: 1, reason: 1 })
      .sort({ at: -1 }).limit(100).lean();
    await audit({ action: 'staff_application.viewed', req, targetType: 'staff_application', targetId: String(app._id) });
    const reviewers = new Map((await User.find({ _id: { $in: app.history.map((h) => h.actorId).filter(Boolean) } }, { fullName: 1 }).lean()).map((u) => [String(u._id), u.fullName]));
    ok(res, {
      ...summary(app, user, evidence.length),
      phone: app.phone,
      counsellor: app.counsellor ?? null,
      admin: app.admin ?? null,
      committee: app.committee ? { ...app.committee, committeeId: String(app.committee.committeeId) } : null,
      security: app.security ?? null,
      infoRequest: app.infoRequest,
      applicantNote: app.applicantNote,
      decisionReason: app.decisionReason,
      granted: app.granted ?? null,
      account: { accountStatus: user.accountStatus, emailVerified: user.emailVerified, verificationStatus: user.verificationStatus, verificationNotes: user.verificationNotes, approvalRequired: user.approvalRequired, role: user.role },
      evidence: evidence.map((e) => ({
        id: String(e._id), evidenceType: e.evidenceType, mime: e.mime, size: e.fileSize, status: e.status, createdAt: e.createdAt,
        initialRecommendation: e.initialRecommendation ?? null, initialReviewNotes: e.initialReviewNotes ?? null,
        fileUrl: `/api/v1/super-admin/users/verifications/evidence/${e._id}/file`,
      })),
      history: app.history.map((h) => ({ at: h.at, action: h.action, from: h.from, to: h.to, reason: h.reason, actorRole: h.actorRole, actorName: h.actorId ? reviewers.get(String(h.actorId)) ?? null : null })),
      audit: auditRows.map((r) => ({ action: r.action, at: r.at, actorRole: r.actorRole ?? null, actorName: r.actorName ?? null, outcome: r.outcome ?? null, reason: r.reason ?? null })),
    });
  }),
);

async function tellApplicant(user: UserDoc, title: string, message: string) {
  await notify({ userId: String(user._id), kind: 'staff_application', title, body: message, link: '/application-status' }).catch(() => undefined);
  // notify() emails active accounts only; an applicant is not active yet, so the decision email goes directly.
  await sendEmail('security_alert', user.email, { name: user.fullName, message }).catch(() => undefined);
}

/** Institutional identity verification (documents or staff records). Separate from role approval. */
staffApplicationsRouter.post(
  '/:id/identity',
  requireRecentAuth,
  asyncHandler(async (req, res) => {
    const { app, user } = await loadApplication(req.params.id);
    assertReviewer(req, app);
    const input = parse(staffIdentityDecisionSchema, req.body);
    const from = (user.verificationStatus ?? 'pending') as StudentVerificationStatus;
    if (!canTransitionVerification(from, input.status)) {
      throw new AppError(409, 'invalid_transition', `Identity verification is "${from.replace('_', ' ')}" and cannot become "${input.status.replace('_', ' ')}".`);
    }
    user.verificationStatus = input.status;
    user.verificationReviewedAt = new Date();
    user.verificationReviewedBy = req.user!._id;
    user.verificationReason = input.reason;
    await user.save();
    const latest = await VerificationEvidence.findOne({ userId: user._id }).sort({ createdAt: -1 });
    if (latest) {
      latest.status = input.status === 'approved' ? 'verified' : input.status === 'needs_info' ? 'more_info_required' : input.status;
      latest.reviewedBy = req.user!._id;
      latest.reviewedAt = new Date();
      latest.reviewNotes = input.reason;
      await latest.save();
    }
    app.history.push({ at: new Date(), actorId: req.user!._id, actorRole: req.user!.role, action: `identity_${input.status}`, from, to: input.status, reason: input.reason });
    await app.save();
    await audit({ action: 'staff_application.identity_decided', req, targetType: 'staff_application', targetId: String(app._id), reason: input.reason, meta: { userId: String(user._id), before: from, after: input.status, evidence: latest ? String(latest._id) : null } });
    if (input.status === 'needs_info' || input.status === 'rejected') {
      await tellApplicant(user, 'Identity verification update', input.status === 'needs_info'
        ? `Please upload clearer identity documents for your staff application. Reviewer note: ${input.reason}`
        : `Your identity documents could not be verified. Reason: ${input.reason}`);
    }
    ok(res, { statuses: applicationStatuses(app, user) });
  }),
);

/** Grants exactly what the stored application asked for, after re-checking it against current records. */
async function grantRole(req: Request, app: StaffApplicationDoc, user: UserDoc, opts: { committeePosition?: 'member' | 'chair'; listCounsellor?: boolean }) {
  const s = await getSettings();
  const campus = resolveCampus(s, app.campus).id;
  const now = new Date();
  user.role = app.requestedRole;
  user.permissions = [];
  user.campusZone = campus;
  user.managedCampuses = app.requestedRole === 'admin' ? [campus] : [];
  user.approvalRequired = false;
  user.approvedBy = req.user!._id;
  user.approvedAt = now;
  user.accountStatus = 'active';
  const granted: Record<string, unknown> = { role: app.requestedRole, campus };
  if (app.requestedRole === 'committee_member') {
    const committee = await eligibleCommittee(String(app.committee!.committeeId), app.committee!.identifierType as 'staff' | 'student');
    const position = opts.committeePosition ?? 'member';
    user.committeeMemberships = [
      ...user.committeeMemberships.filter((m) => String(m.committeeId) !== String(committee._id)),
      { committeeId: committee._id, position, since: now },
    ] as typeof user.committeeMemberships;
    Object.assign(granted, { committeeId: committee._id, committeePosition: position });
  }
  if (app.requestedRole === 'counsellor') {
    user.counsellorApproved = true;
    user.counsellorApprovedAt = now;
    user.counsellorApprovedBy = req.user!._id;
    const c = app.counsellor;
    const listed = opts.listCounsellor ?? true;
    // Directory details come from the application; credentials stay pending until the usual credential review.
    await Availability.updateOne({ counsellorId: user._id }, {
      $setOnInsert: { counsellorId: user._id },
      $set: {
        campus, listed, title: app.designation, profileUpdatedAt: now,
        ...(c?.specializations?.length ? { specializations: c.specializations } : {}),
        ...(c?.languages?.length ? { languages: c.languages } : {}),
        ...(c?.sessionModes?.length ? { supportedModes: c.sessionModes } : {}),
        ...(c?.bio ? { bio: c.bio } : {}),
        ...(c?.qualifications ? { pendingCredentials: { qualifications: [c.qualifications], yearsExperience: c.experienceYears ?? null, submittedAt: now } } : {}),
      },
    }, { upsert: true });
    granted.counsellorListed = listed;
  }
  if (app.requestedRole === 'security_officer') {
    // Responder eligibility comes with approval, but the officer starts Off duty: going on duty is their own later action.
    user.responderEligible = true;
    await ResponderAvailability.updateOne({ userId: user._id }, { $setOnInsert: { userId: user._id, status: 'off_duty', campus } }, { upsert: true });
  }
  return granted;
}

staffApplicationsRouter.post(
  '/:id/decision',
  requireRecentAuth,
  asyncHandler(async (req, res) => {
    const { app, user } = await loadApplication(req.params.id);
    assertReviewer(req, app);
    const input = parse(staffApplicationDecisionSchema, req.body);
    const from = app.status as StaffApplicationStatus;
    if (!canDecideStaffApplication(from, input.decision)) {
      throw new AppError(409, 'invalid_transition', `This application is "${STAFF_APPLICATION_STATUS_LABELS[from]}" and cannot be ${input.decision === 'approve' ? 'approved' : input.decision === 'reject' ? 'rejected' : 'sent back for information'}.`);
    }
    const reason = input.reason?.trim() || null;
    if (input.decision !== 'approve' && (!reason || reason.length < 3)) throw new AppError(422, 'reason_required', 'Record a reason for this decision.', { fields: { reason: 'Required' } });
    let granted: Record<string, unknown> | null = null;
    if (input.decision === 'approve') {
      if (!user.emailVerified) throw new AppError(409, 'email_not_verified', 'The applicant has not verified their email yet.');
      if (user.verificationStatus !== 'approved') throw new AppError(409, 'identity_not_verified', 'Verify the applicant’s institutional identity before approving the role.');
      if (user.accountStatus !== 'pending_verification') throw new AppError(409, 'account_not_pending', `This account is ${user.accountStatus.replace('_', ' ')}; resolve that first.`);
      granted = await grantRole(req, app, user, input);
      await user.save();
    }
    const to: StaffApplicationStatus = input.decision === 'approve' ? 'approved' : input.decision === 'reject' ? 'rejected' : 'needs_info';
    app.status = to;
    app.decidedBy = req.user!._id;
    app.decidedAt = new Date();
    app.decisionReason = reason;
    if (to === 'needs_info') app.infoRequest = reason;
    if (granted) app.granted = granted as typeof app.granted;
    app.history.push({ at: new Date(), actorId: req.user!._id, actorRole: req.user!.role, action: input.decision, from, to, reason });
    await app.save();
    await audit({
      action: `staff_application.${to}`, req, targetType: 'staff_application', targetId: String(app._id), reason,
      meta: { userId: String(user._id), requestedRole: app.requestedRole, campus: app.campus, before: from, after: to, granted },
    });
    const roleTitle = STAFF_REGISTRATION_ROLE_INFO[app.requestedRole as keyof typeof STAFF_REGISTRATION_ROLE_INFO]?.title ?? app.requestedRole;
    if (to === 'approved') await tellApplicant(user, 'Staff application approved', `Your ${roleTitle} application has been approved. Sign in to CampusCare College to get started.`);
    else if (to === 'rejected') await tellApplicant(user, 'Staff application decision', `Your ${roleTitle} application was not approved. Reason: ${reason}`);
    else await tellApplicant(user, 'More information needed', `A reviewer needs more information for your ${roleTitle} application: ${reason}. Open CampusCare College to update it.`);
    ok(res, { id: String(app._id), status: app.status, statuses: applicationStatuses(app, user), granted });
  }),
);
