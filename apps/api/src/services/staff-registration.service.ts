import { Types } from 'mongoose';
import {
  STAFF_APPLICATION_STATUS_LABELS, permittedStaffRegistrationRoles, type PlatformSettings,
  type StaffApplicationStatus, type StaffRegistrationRole,
} from '@campuscare/shared';
import { env } from '../config/env';
import { hmac, safeEqual } from '../lib/crypto';
import { AppError } from '../lib/http';
import { logger } from '../lib/logger';
import { Committee } from '../models/incident';
import { AuditLog } from '../models/platform';
import { StaffApplication, type StaffApplicationDoc } from '../models/staff-application';
import { User, VerificationEvidence, type UserDoc } from '../models/user';
import { audit } from './audit.service';
import { getSettings } from './settings.service';

// ------------------------------------------------------------------ authoritative records
export function campusRecords(s: PlatformSettings): { id: string; name: string }[] {
  const list = (s.registration.campuses ?? []).filter((c) => c && typeof c.id === 'string' && c.id.trim());
  return list.length ? list : [{ id: 'main', name: 'Main Campus' }];
}

/** The campus must be one of the configured campus records; the client's value is never trusted as-is. */
export function resolveCampus(s: PlatformSettings, campus: string, field = 'campus'): { id: string; name: string } {
  const record = campusRecords(s).find((c) => c.id === campus.trim());
  if (!record) throw new AppError(422, 'validation_failed', 'Choose a campus from the list.', { fields: { [field]: 'Unknown campus' } });
  return record;
}

export function permittedRoles(s: PlatformSettings): StaffRegistrationRole[] {
  return s.registration.staffRegistrationOpen === false ? [] : permittedStaffRegistrationRoles(s.registration.staffRegistrationRoles);
}

/** An active committee that accepts applications from this kind of applicant (staff or student ID). */
export async function eligibleCommittee(committeeId: string, identifierType: 'staff' | 'student') {
  const c = Types.ObjectId.isValid(committeeId) ? await Committee.findById(committeeId).lean() : null;
  if (!c || !c.active) throw new AppError(422, 'validation_failed', 'Choose a committee from the list.', { fields: { 'committee.committeeId': 'Unknown or inactive committee' } });
  if (c.joinPolicy === 'invitation_only') {
    throw new AppError(403, 'committee_invitation_only', `${c.name} accepts members by nomination only. Ask the committee chair or your campus administrator to add you.`, { fields: { 'committee.committeeId': 'Membership is by invitation only' } });
  }
  if (identifierType === 'student' && c.memberEligibility !== 'staff_and_students') {
    throw new AppError(422, 'committee_not_eligible', `${c.name} is open to staff members only. Apply with your employee ID.`, { fields: { 'committee.identifierType': 'Staff only' } });
  }
  return c;
}

/** Committees shown on the application form: active, open to applications. */
export async function openCommittees() {
  const rows = await Committee.find({ active: true, joinPolicy: { $ne: 'invitation_only' } }, { name: 1, type: 1, memberEligibility: 1, confidential: 1 }).sort({ name: 1 }).lean();
  return rows.map((c) => ({ id: String(c._id), name: c.name, type: c.type, eligibility: c.memberEligibility ?? 'staff', confidential: Boolean(c.confidential) }));
}

// ------------------------------------------------------------------ Google registration ticket
const GOOGLE_TICKET_TTL_MS = 30 * 60_000;
export interface GoogleRegistration { subject: string; email: string; name: string }

/**
 * After the server verified a Google ID token for someone without an account, it hands back this sealed,
 * short-lived ticket so the person can fill in the application form without signing in to Google again.
 * It proves the Google identity only; it never grants a role or eligibility.
 */
export function issueGoogleRegistrationTicket(g: GoogleRegistration): string {
  const body = Buffer.from(JSON.stringify({ s: g.subject, e: g.email, n: g.name.slice(0, 120), x: Date.now() + GOOGLE_TICKET_TTL_MS })).toString('base64url');
  return `gr1.${body}.${hmac(env.SESSION_SECRET, `google-registration:${body}`)}`;
}

export function readGoogleRegistrationTicket(ticket: string | null | undefined): GoogleRegistration | null {
  const parts = (ticket ?? '').split('.');
  if (parts.length !== 3 || parts[0] !== 'gr1') return null;
  if (!safeEqual(parts[2]!, hmac(env.SESSION_SECRET, `google-registration:${parts[1]}`))) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString()) as { s: string; e: string; n: string; x: number };
    if (!(p.x > Date.now()) || !p.s || !p.e) return null;
    return { subject: p.s, email: p.e, name: p.n };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ status views
/** The five states of an application, kept separate (never inferred from one another). */
export function applicationStatuses(app: Pick<StaffApplicationDoc, 'status'> | null, user: Pick<UserDoc, 'emailVerified' | 'verificationStatus' | 'accountStatus' | 'approvalRequired'>) {
  const registration = (app?.status ?? 'pending_review') as StaffApplicationStatus;
  return {
    registration,
    registrationLabel: STAFF_APPLICATION_STATUS_LABELS[registration],
    emailVerification: user.emailVerified ? 'verified' : 'pending',
    identityVerification: user.verificationStatus ?? 'pending',
    roleApproval: registration === 'approved' ? 'approved' : registration === 'rejected' ? 'rejected' : registration === 'needs_info' ? 'needs_info' : 'pending',
    accountActivation: user.accountStatus === 'active' && !user.approvalRequired ? 'active' : user.accountStatus === 'active' ? 'pending' : user.accountStatus,
  };
}

/** What the applicant sees about their own application (no reviewer identities or internal notes). */
export function applicantView(app: StaffApplicationDoc, user: UserDoc, evidence: { count: number; latestStatus: string | null }) {
  return {
    id: String(app._id),
    requestedRole: app.requestedRole,
    campus: app.campus,
    department: app.department,
    designation: app.designation,
    staffId: app.staffId,
    registrationMethod: app.registrationMethod,
    counsellor: app.counsellor ?? null,
    admin: app.admin ?? null,
    committee: app.committee ? { committeeId: String(app.committee.committeeId), committeeName: app.committee.committeeName, position: app.committee.position, identifierType: app.committee.identifierType, reason: app.committee.reason, experience: app.committee.experience } : null,
    security: app.security ?? null,
    infoRequest: app.status === 'needs_info' ? app.infoRequest : null,
    decisionReason: app.status === 'rejected' ? app.decisionReason : null,
    statuses: applicationStatuses(app, user),
    evidence,
    submittedAt: (app as unknown as { createdAt: Date }).createdAt,
    updatedAt: (app as unknown as { updatedAt: Date }).updatedAt,
  };
}

export async function evidenceSummary(userId: unknown) {
  const [count, latest] = await Promise.all([
    VerificationEvidence.countDocuments({ userId }),
    VerificationEvidence.findOne({ userId }, { status: 1 }).sort({ createdAt: -1 }).lean(),
  ]);
  return { count, latestStatus: latest?.status ?? null };
}

// ------------------------------------------------------------------ legacy applications
/**
 * Accounts created by the first version of POST /auth/register-staff (before applications existed) were
 * given their self-chosen role and became active as soon as the email was verified. This puts every such
 * account that no reviewer has approved back into the review queue: it keeps its data, loses access until
 * a Super Admin approves it, and gets an application record (marked legacy). Idempotent.
 */
export async function reconcileLegacyStaffApplications(): Promise<number> {
  const registered = await AuditLog.find({ action: 'auth.staff_registered' }, { targetId: 1 }).limit(5000).lean();
  const ids = [...new Set(registered.map((a) => String(a.targetId ?? '')).filter((id) => Types.ObjectId.isValid(id)))];
  if (!ids.length) return 0;
  const withApplication = new Set((await StaffApplication.find({ userId: { $in: ids } }, { userId: 1 }).lean()).map((a) => String(a.userId)));
  const s = await getSettings();
  let fixed = 0;
  for (const id of ids.filter((x) => !withApplication.has(x))) {
    const u = await User.findById(id);
    if (!u || u.role === 'super_admin' || u.role === 'student' || u.approvedBy) continue;
    // A reviewer already approved this person's identity through the earlier evidence workflow: leave it.
    if (u.verificationStatus === 'approved' && u.verificationReviewedBy) continue;
    const role = u.role as StaffRegistrationRole;
    if (!(['counsellor', 'admin', 'committee_member', 'security_officer'] as string[]).includes(role)) continue;
    const wasActive = u.accountStatus === 'active';
    u.requestedRole = role;
    u.approvalRequired = true;
    if (wasActive) u.accountStatus = 'pending_verification';
    u.permissions = [];
    u.counsellorApproved = false;
    await u.save();
    await StaffApplication.create({
      userId: u._id, requestedRole: role, status: u.emailVerified ? 'pending_review' : 'pending_email_verification',
      fullName: u.fullName, email: u.email, staffId: u.staffId ?? 'UNKNOWN', department: u.department ?? 'Not provided',
      campus: campusRecords(s).some((c) => c.id === u.campusZone) ? u.campusZone! : campusRecords(s)[0]!.id,
      designation: u.designation ?? 'Not provided', phone: u.phone ?? null,
      history: [{ at: new Date(), action: 'legacy_reconciled', to: u.emailVerified ? 'pending_review' : 'pending_email_verification', reason: 'Registered before staff applications required approval' }],
    });
    if (wasActive) {
      const { standDownAccount } = await import('./account-lifecycle.service');
      await standDownAccount(u, { actorId: null, reason: 'staff application needs Super Admin approval' }).catch(() => undefined);
    }
    await audit({ action: 'staff_application.legacy_reconciled', actorType: 'system', targetType: 'user', targetId: id, meta: { role, wasActive } });
    fixed++;
  }
  if (fixed) logger.warn({ fixed }, 'staff applications: legacy self-registered staff returned to review');
  return fixed;
}
