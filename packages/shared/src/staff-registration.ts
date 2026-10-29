import { z } from 'zod';
import { APPOINTMENT_MODES, COUNSELLING_TYPES } from './enums';

/**
 * Staff self-registration in CampusCare College. An application is a request for a role, never the
 * role itself: nothing is granted until a Super Admin approves it on the server. Super Admin (and any
 * role not listed here) can never be requested, whatever a modified client sends.
 */
export const STAFF_REGISTRATION_ROLES = ['counsellor', 'admin', 'committee_member', 'security_officer'] as const;
export type StaffRegistrationRole = (typeof STAFF_REGISTRATION_ROLES)[number];

export function isStaffRegistrationRole(role: unknown): role is StaffRegistrationRole {
  return typeof role === 'string' && (STAFF_REGISTRATION_ROLES as readonly string[]).includes(role);
}

export const STAFF_REGISTRATION_ROLE_INFO: Record<StaffRegistrationRole, { title: string; description: string }> = {
  counsellor: { title: 'Counsellor', description: 'Provide student counselling, manage appointments, and support student wellbeing.' },
  admin: { title: 'Campus Admin', description: 'Manage authorized campus operations, support requests, reports, and announcements.' },
  committee_member: { title: 'Committee Member', description: 'Participate in authorized committees, review assigned work, and coordinate campus activities.' },
  security_officer: { title: 'Security Officer', description: 'Respond to campus safety incidents, manage assigned alerts, and perform authorized security duties.' },
};

/**
 * Where a staff application stands (the role approval). Kept apart from the other states on the account:
 * email verification (User.emailVerified), institutional identity verification (User.verificationStatus)
 * and activation (User.accountStatus).
 */
export const STAFF_APPLICATION_STATUSES = ['pending_email_verification', 'pending_review', 'needs_info', 'approved', 'rejected'] as const;
export type StaffApplicationStatus = (typeof STAFF_APPLICATION_STATUSES)[number];

export const STAFF_APPLICATION_STATUS_LABELS: Record<StaffApplicationStatus, string> = {
  pending_email_verification: 'Pending email verification',
  pending_review: 'Pending institutional review',
  needs_info: 'Requires additional information',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const STAFF_APPLICATION_DECISIONS = ['approve', 'reject', 'needs_info'] as const;
export type StaffApplicationDecision = (typeof STAFF_APPLICATION_DECISIONS)[number];

/** Allowed decision for each status. Only a pending review can be approved. */
export function canDecideStaffApplication(status: StaffApplicationStatus, decision: StaffApplicationDecision): boolean {
  switch (decision) {
    case 'approve': return status === 'pending_review';
    case 'needs_info': return status === 'pending_review';
    case 'reject': return status === 'pending_review' || status === 'needs_info' || status === 'pending_email_verification';
  }
}

export const SECURITY_SHIFT_PREFERENCES = ['day', 'evening', 'night', 'rotating', 'no_preference'] as const;
export type SecurityShiftPreference = (typeof SECURITY_SHIFT_PREFERENCES)[number];
export const SECURITY_SHIFT_LABELS: Record<SecurityShiftPreference, string> = {
  day: 'Day shift', evening: 'Evening shift', night: 'Night shift', rotating: 'Rotating shifts', no_preference: 'No preference',
};

/** Requested committee position. The approver decides what is granted (normally "member"). */
export const COMMITTEE_APPLICATION_POSITIONS = ['member', 'chair'] as const;
/** Committee membership open to staff only, or to staff and students (by their student ID). */
export const COMMITTEE_ELIGIBILITY = ['staff', 'staff_and_students'] as const;
export type CommitteeEligibility = (typeof COMMITTEE_ELIGIBILITY)[number];
/** Open committees accept applications; invitation-only committees are joined only when an administrator adds you. */
export const COMMITTEE_JOIN_POLICIES = ['open_application', 'invitation_only'] as const;
export type CommitteeJoinPolicy = (typeof COMMITTEE_JOIN_POLICIES)[number];

const text = (min: number, max: number) => z.string().trim().min(min, min > 1 ? `Use at least ${min} characters` : 'Required').max(max, `Use at most ${max} characters`);
const optionalText = (max: number) => z.string().trim().max(max, `Use at most ${max} characters`).optional().nullable().transform((v) => (v ? v : null));
/** Staff, employee or student identifiers: letters, digits, "-" and "/" only. */
const identifier = z.string().trim().toUpperCase().regex(/^[A-Z0-9\-/]{2,40}$/, 'Letters, numbers, - and / only');

/** Fields every staff application has. Passwords are checked on the server (absent with Google). */
const base = {
  fullName: text(2, 120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(254),
  staffId: identifier,
  department: text(2, 100),
  campus: z.string().trim().min(1, 'Choose your campus').max(50),
  designation: text(2, 100),
  phone: z.string().trim().max(30).regex(/^(\+?[0-9 ]{7,20})?$/, 'Enter a valid phone number').optional().nullable().transform((v) => (v ? v : null)),
  password: z.string().max(128).optional(),
  confirmPassword: z.string().max(128).optional(),
  /** Sealed proof of a Google identity the server already verified (registration with Google). */
  googleTicket: z.string().max(4096).optional().nullable(),
  verificationMethod: z.enum(['otp', 'link']).default('otp'),
  acceptPolicy: z.literal(true, { errorMap: () => ({ message: 'Accept the Terms of Service and Privacy Policy' }) }),
  turnstileToken: z.string().max(4096).nullish(),
};

export const counsellorApplicationFields = z.object({
  specializations: z.array(z.enum(COUNSELLING_TYPES)).min(1, 'Choose at least one specialization').max(COUNSELLING_TYPES.length),
  languages: z.array(text(2, 30)).min(1, 'Add at least one language').max(8),
  qualifications: text(3, 500),
  bio: optionalText(1000),
  experienceYears: z.coerce.number().int().min(0).max(60).optional().nullable(),
  sessionModes: z.array(z.enum(APPOINTMENT_MODES)).max(APPOINTMENT_MODES.length).optional().default([]),
});
export const adminApplicationFields = z.object({
  /** Institutional authorization / approval reference (e.g. an office order number). */
  authorizationReference: optionalText(80),
});
export const committeeApplicationFields = z.object({
  committeeId: z.string().regex(/^[a-f0-9]{24}$/i, 'Choose a committee'),
  position: z.enum(COMMITTEE_APPLICATION_POSITIONS).default('member'),
  /** Which identifier `staffId` holds: an employee ID, or a student ID where the committee allows students. */
  identifierType: z.enum(['staff', 'student']).default('staff'),
  reason: optionalText(1000),
  experience: optionalText(1000),
});
export const securityApplicationFields = z.object({
  serviceProvider: text(2, 100),
  shiftPreference: z.enum(SECURITY_SHIFT_PREFERENCES),
  qualifications: optionalText(500),
  authorizationReference: optionalText(80),
});

export const staffRegistrationSchema = z.discriminatedUnion('requestedRole', [
  z.object({ ...base, requestedRole: z.literal('counsellor'), counsellor: counsellorApplicationFields }),
  z.object({ ...base, requestedRole: z.literal('admin'), admin: adminApplicationFields.default({}) }),
  z.object({ ...base, requestedRole: z.literal('committee_member'), committee: committeeApplicationFields }),
  z.object({ ...base, requestedRole: z.literal('security_officer'), security: securityApplicationFields }),
], { errorMap: (issue, ctx) => (issue.code === 'invalid_union_discriminator' ? { message: 'Choose Counsellor, Campus Admin, Committee Member or Security Officer' } : { message: ctx.defaultError }) });
export type StaffRegistrationInput = z.infer<typeof staffRegistrationSchema>;

/** What an applicant may change while their application waits for more information (never role or identity). */
export const staffApplicationUpdateSchema = z.object({
  department: text(2, 100).optional(),
  designation: text(2, 100).optional(),
  campus: z.string().trim().min(1).max(50).optional(),
  phone: base.phone,
  counsellor: counsellorApplicationFields.partial().optional(),
  admin: adminApplicationFields.partial().optional(),
  committee: committeeApplicationFields.pick({ reason: true, experience: true }).partial().optional(),
  security: securityApplicationFields.partial().optional(),
  note: optionalText(1000),
});

export const staffApplicationDecisionSchema = z.object({
  decision: z.enum(STAFF_APPLICATION_DECISIONS),
  reason: z.string().trim().max(1000).optional().nullable(),
  /** Committee position granted on approval; the applicant's own request is only a preference. */
  committeePosition: z.enum(COMMITTEE_APPLICATION_POSITIONS).optional(),
  /** Counsellors: list in the student directory right away (bookable) or keep hidden for now. */
  listCounsellor: z.boolean().optional(),
});

export const staffIdentityDecisionSchema = z.object({
  status: z.enum(['under_review', 'approved', 'rejected', 'needs_info']),
  reason: z.string().trim().min(3, 'Record how the identity was checked').max(1000),
});

/** Roles a public application may request, given the platform policy (never super_admin). */
export function permittedStaffRegistrationRoles(allowed: readonly string[] | null | undefined): StaffRegistrationRole[] {
  const list = allowed?.length ? allowed : STAFF_REGISTRATION_ROLES;
  return STAFF_REGISTRATION_ROLES.filter((r) => list.includes(r));
}

