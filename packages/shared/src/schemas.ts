import { z } from 'zod';
import {
  ALERT_SEVERITIES, APPOINTMENT_MODES, APPOINTMENT_STATUSES, COMMITTEE_TYPES, CONTACT_CATEGORIES,
  INCIDENT_CATEGORIES, INCIDENT_STATUSES, PRIORITIES, ROLES, SEVERITIES, MAIL_SERVICES,
  HAZARD_CATEGORIES, HAZARD_STATUSES, PLACE_KINDS, LOST_FOUND_CATEGORIES, SUGGESTION_CATEGORIES, SUGGESTION_STATUSES,
  NOTIFICATION_CATEGORIES, DATA_REQUEST_TYPES, type NotificationCategory, DUTY_STATUSES, RESPONDER_SKILLS, RESPONDER_RESPONSIBILITIES,
  CHAT_REVIEW_SCOPES, CHAT_REVIEW_BASES, STUDENT_VERIFICATION_STATUSES, SUPPORT_CATEGORIES, SUPPORT_STATUSES, SUPPORT_PRIORITIES, FAQ_STATUSES, COUNSELLING_TYPES,
} from './enums';

const trimmed = (max: number) => z.string().trim().max(max);
export const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
export const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);

/** Every CampusCare account (student or staff) must use an official SRM University-AP address. */
export const ACCOUNT_EMAIL_DOMAIN = 'srmap.edu.in';
export const ALLOWED_EMAIL_DOMAINS = ['srmap.edu.in'];
export function isAllowedAccountEmail(address: string): boolean {
  const at = address.trim().toLowerCase().lastIndexOf('@');
  return at > 0 && address.trim().toLowerCase().slice(at + 1) === ACCOUNT_EMAIL_DOMAIN;
}
export const universityEmail = email.refine(isAllowedAccountEmail, `Use your @${ACCOUNT_EMAIL_DOMAIN} email address`);
export const turnstileToken = z.string().max(4096).nullish();

export const passwordSchema = (min = 10) =>
  z
    .string()
    .min(min, `Use at least ${min} characters`)
    .max(128)
    .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), 'Include upper and lower case letters and a number');

// ---------------------------------------------------------------- auth
/**
 * Email verification and password recovery can each use a one-time code (OTP) typed into the app or a
 * single-use link. Super Admin accounts never get a code: they keep the link-only recovery process.
 */
export const EMAIL_CHALLENGE_METHODS = ['otp', 'link'] as const;
export type EmailChallengeMethod = (typeof EMAIL_CHALLENGE_METHODS)[number];
/** Older clients send no method and keep getting links. */
export const emailChallengeMethod = z.enum(EMAIL_CHALLENGE_METHODS).default('link');
export const OTP_LENGTH = 6;
export const otpCode = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code');
/** Signed handle given to the person who just registered (or signed in with an unverified email). */
export const verificationTicket = z.string().min(20).max(400);

export const registerSchema = z
  .object({
    fullName: trimmed(120).min(2, 'Enter your full name'),
    email: universityEmail,
    studentId: trimmed(40).min(2, 'Enter your student ID').regex(/^[A-Za-z0-9\-/]+$/, 'Letters, numbers, - and / only'),
    department: trimmed(120).min(2, 'Select your department'),
    academicYear: z.coerce.number().int().min(1).max(6),
    phone: trimmed(20).regex(/^\+?[0-9 ]{7,20}$/, 'Enter a valid phone number').nullish().or(z.literal('')),
    password: passwordSchema(),
    confirmPassword: z.string(),
    acceptPolicy: z.literal(true, { errorMap: () => ({ message: 'You must accept the privacy policy' }) }),
    verificationMethod: emailChallengeMethod,
    turnstileToken,
  })
  .refine((d) => d.password === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' });

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password').max(128),
  rememberMe: z.boolean().nullish(),
  mfaCode: z.string().regex(/^\d{6}$/).nullish(),
  turnstileToken,
});

export const tokenSchema = z.object({ token: z.string().min(20).max(200) });
export const forgotPasswordSchema = z.object({ email, turnstileToken, method: emailChallengeMethod });
export const resendVerificationSchema = z.object({ email, turnstileToken, method: emailChallengeMethod });
export const verifyEmailOtpSchema = z.object({ email, code: otpCode, ticket: verificationTicket.nullish() });
export const verificationTicketSchema = z.object({ ticket: verificationTicket });
export const sendVerificationSchema = z.object({ ticket: verificationTicket, method: z.enum(EMAIL_CHALLENGE_METHODS) });
export const resetOtpSchema = z.object({ email, code: otpCode });
export const resetPasswordSchema = z
  .object({ token: z.string().min(20).max(200), password: passwordSchema(), confirmPassword: z.string(), turnstileToken })
  .refine((d) => d.password === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' });
export const reauthSchema = z.object({ password: z.string().max(128).optional(), mfaCode: z.string().regex(/^\d{6}$/).optional() });
export const mfaVerifySchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });
export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1), password: passwordSchema(), confirmPassword: z.string() })
  .refine((d) => d.password === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' });
/**
 * Self-service profile edits. Verified identifiers (email, student/staff ID, role, assigned campus
 * for staff) are deliberately absent: they change only through verification or administrator workflows.
 * The route also ignores fields that do not apply to the caller's role.
 */
export const profileUpdateSchema = z.object({
  fullName: trimmed(120).min(2).optional(),
  phone: trimmed(20).regex(/^\+?[0-9 ]{7,20}$/).optional().or(z.literal('')),
  // students
  department: trimmed(120).optional(),
  program: trimmed(120).optional().or(z.literal('')),
  academicYear: z.coerce.number().int().min(1).max(6).optional(),
  section: trimmed(20).optional().or(z.literal('')),
  hostel: trimmed(80).optional().or(z.literal('')),
  // staff
  designation: trimmed(80).optional().or(z.literal('')),
  // counsellors
  qualifications: trimmed(300).optional().or(z.literal('')),
  experienceYears: z.coerce.number().int().min(0).max(60).optional(),
});

// ---------------------------------------------------------------- incidents
export const incidentCreateSchema = z.object({
  category: z.enum(INCIDENT_CATEGORIES),
  title: trimmed(140).min(5, 'Add a short title'),
  description: trimmed(5000).min(30, 'Please describe what happened (at least 30 characters)'),
  incidentDate: z.coerce.date().refine((d) => d.getTime() <= Date.now() + 60_000, 'The date cannot be in the future'),
  location: trimmed(200).min(2, 'Enter where it happened'),
  severity: z.enum(SEVERITIES).default('medium'),
  urgent: z.boolean().default(false),
  anonymous: z.boolean().default(false),
  involvedParties: trimmed(1000).optional(),
  preferredContact: z.enum(['in_app', 'email', 'phone']).default('in_app'),
  /** Optional map pin. Never shown publicly; used only in k-anonymous aggregate heatmaps. */
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  /** Category the automated helper suggested, recorded so its accuracy can be reviewed. */
  suggestedCategory: z.enum(INCIDENT_CATEGORIES).optional(),
  idempotencyKey: z.string().uuid(),
  turnstileToken,
});

export const incidentStatusSchema = z.object({
  status: z.enum(INCIDENT_STATUSES),
  studentVisibleNote: trimmed(1000).optional(),
  reason: trimmed(500).optional(),
});
export const incidentAssignSchema = z.object({
  committeeId: objectId,
  assigneeId: objectId.optional().nullable(),
  priority: z.enum(PRIORITIES).optional(),
  reason: trimmed(500).optional(),
});
export const internalNoteSchema = z.object({ body: trimmed(4000).min(1) });
export const caseMessageSchema = z.object({
  body: trimmed(4000).default(''),
  attachmentIds: z.array(objectId).max(5).default([]),
  clientMessageId: z.string().uuid(),
});
export const readReceiptSchema = z.object({ upToMessageId: objectId });

// ---------------------------------------------------------------- committees
export const committeeSchema = z.object({
  name: trimmed(120).min(3),
  type: z.enum(COMMITTEE_TYPES),
  mandate: trimmed(2000).default(''),
  contactEmail: email.optional().or(z.literal('')),
  contactPhone: trimmed(30).optional().or(z.literal('')),
  categories: z.array(z.enum(INCIDENT_CATEGORIES)).default([]),
  confidential: z.boolean().default(false),
  slaAcknowledgeHours: z.coerce.number().int().min(1).max(720).default(24),
  slaResolveDays: z.coerce.number().int().min(1).max(365).default(30),
  active: z.boolean().default(true),
});
export const committeeMemberSchema = z.object({ userId: objectId, position: z.enum(['chair', 'member']).default('member') });

// ---------------------------------------------------------------- counselling
export const appointmentRequestSchema = z.object({
  counsellorId: z.union([objectId, z.literal('auto')]).optional(),
  startAt: z.coerce.date().optional(),
  mode: z.enum(APPOINTMENT_MODES).default('in_person'),
  reason: trimmed(500).optional(),
  idempotencyKey: z.string().uuid(),
  /** Consent to move the request to another counsellor if the chosen one declines or does not respond within an hour. */
  allowReassignment: z.boolean().optional(),
});
export const appointmentReassignSchema = z.object({
  counsellorId: objectId,
  reason: trimmed(500),
});
export const appointmentUpdateSchema = z.object({
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  startAt: z.coerce.date().optional(),
  reason: trimmed(500).optional(),
  meetingLink: z.string().url().max(500).optional().or(z.literal('')),
});
export const availabilitySchema = z.object({
  weekly: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        start: z.string().regex(/^\d{2}:\d{2}$/),
        end: z.string().regex(/^\d{2}:\d{2}$/),
      }),
    )
    .max(50),
  slotMinutes: z.coerce.number().int().min(15).max(180).default(50),
  timezone: z.string().max(64).default('Asia/Kolkata'),
  blockedDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(366).default([]),
  acceptingRequests: z.boolean().default(true),
  /** Most appointments bookable on one day (default 10). 0, sent by older app builds, is saved as 10. */
  maxDailySessions: z.coerce.number().int().min(0).max(24).optional(),
  specializations: z.array(z.enum(COUNSELLING_TYPES)).max(COUNSELLING_TYPES.length).optional(),
  languages: z.array(trimmed(40).min(2)).max(12).optional(),
});
export const counsellingNoteSchema = z.object({
  body: trimmed(10000).min(1),
  followUpAt: z.coerce.date().optional().nullable(),
  supportPlan: trimmed(2000).optional(),
});

// ---------------------------------------------------------------- chat
export const chatChannelSchema = z.object({
  kind: z.enum(['community', 'support_service']),
  name: trimmed(80).min(2),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,60}$/),
  description: trimmed(300).default(''),
  published: z.boolean().default(false),
  order: z.coerce.number().int().min(0).max(1000).default(0),
  serviceRole: z.enum(['counsellor', 'security_officer', 'committee_member']).optional(),
  committeeId: objectId.optional().nullable(),
  readOnly: z.boolean().default(false),
});
export const chatMessageSchema = z.object({
  body: trimmed(4000).default(''),
  attachmentIds: z.array(objectId).max(4).default([]),
  clientMessageId: z.string().uuid(),
  turnstileToken,
});
export const chatReportSchema = z.object({ reason: trimmed(500).min(3) });

// ---------------------------------------------------------------- safety
export const SOS_TRIGGER_SOURCES = ['in_app', 'quick_tile', 'shortcut', 'notification', 'recovery'] as const;
export const sosCreateSchema = z.object({
  idempotencyKey: z.string().uuid(),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  accuracyMeters: z.number().min(0).max(100000).nullish(),
  locationUnavailableReason: trimmed(120).nullish(),
  note: trimmed(300).nullish(),
  /** Email verified trusted contacts as well as Campus Security. */
  notifyTrustedContacts: z.boolean().default(true),
  /**
   * "server": the alert is stored as pending and dispatched by the server when the countdown ends,
   * so a cancel before then is an atomic, recorded cancellation. "client" (older app versions): the
   * app already counted down, so the alert is dispatched immediately.
   */
  countdownMode: z.enum(['client', 'server']).default('client'),
  /** How old the device's location fix was when the alert was raised. Informational only. */
  locationAgeSeconds: z.number().min(0).max(86400).nullish(),
  /** What started it. Recorded for review only: an SOS is never refused because of its trigger. */
  triggerSource: z.enum(SOS_TRIGGER_SOURCES).nullish(),
  batteryLevel: z.number().nullish(),
  deviceInfo: z.record(z.string()).nullish(),
  isCachedFix: z.boolean().nullish(),
});
export const sosCancelSchema = z.object({
  reason: trimmed(300).optional(),
  /**
   * Cancel only a countdown that has not been dispatched yet (the app's countdown "Cancel" button).
   * Telling responders you are safe after dispatch is a separate, confirmed false-alarm action.
   */
  onlyIfPending: z.boolean().optional(),
});
/** A countdown cancelled on the phone before any alert reached the server (e.g. while offline). */
export const sosCountdownCancelledSchema = z.object({
  eventId: z.string().uuid(),
  triggerSource: z.enum(SOS_TRIGGER_SOURCES).optional(),
  triggeredAt: z.coerce.date().optional(),
  cancelledAt: z.coerce.date().optional(),
});
export const trustedContactSchema = z.object({
  name: trimmed(80).min(2),
  email,
  phone: trimmed(20).optional().or(z.literal('')),
  relationship: trimmed(40).optional(),
  shareLocation: z.boolean().default(false),
});
export const safeWalkStartSchema = z.object({
  destination: trimmed(120).min(2),
  expectedArrivalAt: z.coerce.date(),
  trustedContactIds: z.array(objectId).max(5).default([]),
  shareLocation: z.boolean().default(false),
});
export const locationShareSchema = z.object({
  durationMinutes: z.coerce.number().int().min(5).max(480),
  audience: z.enum(['security', 'trusted_contacts']),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().min(0).max(100000).optional(),
  locationAgeSeconds: z.number().min(0).max(86400).optional(),
});
export const locationUpdateSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracyMeters: z.number().finite().min(0).max(100000).optional(),
  /** Age of the fix on the device when it was sent. The server records its own receive time. */
  locationAgeSeconds: z.number().finite().min(0).max(86400).optional(),
  /** Increasing per session on the device; used to drop duplicates and keep points time-ordered. */
  clientSeq: z.number().int().min(0).max(1_000_000_000).optional(),
  speedMps: z.number().finite().min(0).max(150).optional(),
  headingDeg: z.number().finite().min(0).max(360).optional(),
  altitudeMeters: z.number().finite().min(-1000).max(10000).optional(),
  /** Where the fix came from. The server computes its own quality label and never trusts the client's. */
  source: z.enum(['gps', 'fused', 'network', 'unknown']).default('unknown'),
  clientQuality: z.string().max(20).optional(),
});
/** Live location while an SOS is active (same shape as a share update). */
export const sosLocationUpdateSchema = locationUpdateSchema;
export const campusAlertSchema = z.object({
  title: trimmed(140).min(3),
  body: trimmed(2000).min(3),
  severity: z.enum(ALERT_SEVERITIES),
  audience: z.object({ all: z.boolean().default(true), hostels: z.array(trimmed(80)).default([]), departments: z.array(trimmed(120)).default([]) }),
  requestCheckIn: z.boolean().default(false),
  expiresAt: z.coerce.date().optional().nullable(),
});
export const checkInSchema = z.object({ status: z.enum(['safe', 'need_help']), note: trimmed(300).optional() });

// ---------------------------------------------------------------- content
export const announcementSchema = z.object({
  title: trimmed(140).min(3),
  body: trimmed(5000).min(3),
  pinned: z.boolean().default(false),
  published: z.boolean().default(true),
  kind: z.enum(['notice', 'event']).default('notice'),
  eventAt: z.coerce.date().optional().nullable(),
  venue: trimmed(200).optional().or(z.literal('')),
  safetyContact: trimmed(120).optional().or(z.literal('')),
});
export const trainingModuleSchema = z.object({
  title: trimmed(140).min(3),
  category: trimmed(60).min(2),
  summary: trimmed(500).default(''),
  durationMinutes: z.coerce.number().int().min(1).max(600).default(10),
  sections: z.array(z.object({ heading: trimmed(140), body: trimmed(5000) })).max(30).default([]),
  quiz: z
    .array(z.object({ question: trimmed(300), options: z.array(trimmed(200)).min(2).max(6), correctIndex: z.number().int().min(0) }))
    .max(30)
    .default([]),
  passPercent: z.coerce.number().int().min(0).max(100).default(70),
  published: z.boolean().default(false),
});
export const trainingAttemptSchema = z.object({ answers: z.array(z.number().int().min(0)).max(30) });
export const contactSchema = z.object({
  name: trimmed(120).min(2),
  purpose: trimmed(300).default(''),
  category: z.enum(CONTACT_CATEGORIES),
  phone: trimmed(30).optional().or(z.literal('')),
  email: email.optional().or(z.literal('')),
  location: trimmed(200).optional().or(z.literal('')),
  hours: trimmed(120).optional().or(z.literal('')),
  verified: z.boolean().default(false),
  emergency: z.boolean().default(false),
  order: z.coerce.number().int().min(0).max(1000).default(100),
});

// ---------------------------------------------------------------- administration
export const userInviteSchema = z.object({
  fullName: trimmed(120).min(2),
  email: universityEmail,
  role: z.enum(ROLES).refine((r) => r !== 'student', 'Students register themselves'),
  department: trimmed(120).optional(),
  committeeIds: z.array(objectId).default([]),
});
export const userStatusSchema = z.object({ action: z.enum(['suspend', 'reactivate', 'deactivate', 'archive', 'verify_email']), reason: trimmed(500).min(3).optional() });
export const userRoleSchema = z.object({ role: z.enum(ROLES), permissions: z.array(z.string().max(60)).max(60).default([]), reason: trimmed(500).min(3) });

export const userProfileUpdateSchema = z.object({
  fullName: trimmed(120).min(2).optional(),
  phone: trimmed(30).optional().nullable(),
  department: trimmed(120).optional().nullable(),
  academicYear: z.coerce.number().int().min(1).max(10).optional().nullable(),
  studentId: trimmed(60).optional().nullable(),
  hostel: trimmed(120).optional().nullable(),
  campusZone: trimmed(120).optional().nullable(),
  committeeMemberships: z
    .array(
      z.object({
        committeeId: objectId,
        position: z.enum(['chair', 'member']).default('member'),
      }),
    )
    .optional(),
});

export const userStatusUpdateSchema = z.object({
  action: z.enum(['suspend', 'reactivate', 'deactivate', 'archive', 'verify_email', 'approve_counsellor', 'reject_counsellor']),
  reason: trimmed(500).optional(),
  reviewDate: z.coerce.date().optional().nullable(),
});

export const userCounsellorApprovalSchema = z.object({
  approved: z.boolean(),
  note: trimmed(500).optional().nullable(),
  publishAllowed: z.boolean().optional(),
});

export const studentVerificationDecisionSchema = z.object({
  status: z.enum(STUDENT_VERIFICATION_STATUSES),
  reason: trimmed(500).optional().nullable(),
  notes: trimmed(1000).optional().nullable(),
});

export const campusScopeAssignmentSchema = z.object({
  managedCampuses: z.array(trimmed(80)).default([]),
  delegatedPermissions: z.array(trimmed(80)).default([]),
  campusZone: trimmed(80).optional().nullable(),
});

export const userCommunityMuteSchema = z.object({
  muted: z.boolean(),
  reason: trimmed(500).optional().nullable(),
  until: z.coerce.date().optional().nullable(),
});

export const userDutyAssignmentSchema = z.object({
  skills: z.array(z.enum(RESPONDER_SKILLS)).optional(),
  responsibilities: z.array(z.enum(RESPONDER_RESPONSIBILITIES)).optional(),
  zoneId: objectId.optional().nullable(),
  campus: trimmed(60).default('main'),
  eligible: z.boolean().optional(),
});

export const userBulkActionSchema = z.object({
  userIds: z.array(objectId).min(1).max(100),
  action: z.enum([
    'suspend',
    'reactivate',
    'deactivate',
    'archive',
    'verify_email',
    'revoke_sessions',
    'assign_role',
    'assign_department',
  ]),
  role: z.enum(ROLES).optional(),
  department: trimmed(120).optional(),
  reason: trimmed(500).optional(),
  confirm: z.string().optional(),
});
export const domainSchema = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/, 'Enter a domain like university.edu.in'),
  purpose: z.enum(['students', 'staff', 'both']).default('both'),
  note: trimmed(300).optional(),
});
export const domainUpdateSchema = z.object({ status: z.enum(['active', 'disabled']).optional(), purpose: z.enum(['students', 'staff', 'both']).optional() });
export const routingRuleSchema = z.object({
  category: z.enum(INCIDENT_CATEGORIES),
  committeeId: objectId,
  defaultPriority: z.enum(PRIORITIES).default('normal'),
  escalateAfterHours: z.coerce.number().int().min(1).max(720).default(48),
  escalateToCommitteeId: objectId.optional().nullable(),
});
export const emailProviderSchema = z.object({
  /** "nodemailer" sends through a mail service account; "console" is development only. */
  type: z.enum(['console', 'nodemailer']),
  service: z.enum(MAIL_SERVICES).default('gmail'),
  fromName: trimmed(80).min(2),
  /** Defaults to the account address. Gmail only allows the account itself or a verified "Send mail as" alias. */
  fromEmail: email.optional().or(z.literal('')),
  user: email.optional().or(z.literal('')),
  /** Write-only app password. Leave empty to keep the stored secret. Spaces are ignored. */
  appPassword: z.string().max(200).transform((v) => v.replace(/\s+/g, '')).optional().or(z.literal('')),
  active: z.boolean().default(true),
});
export const emailTemplateSchema = z.object({ subject: trimmed(200).min(2), html: z.string().max(50000), text: z.string().max(20000) });
export const identityProviderSchema = z.object({
  enabled: z.boolean(),
  clientId: trimmed(300).optional().or(z.literal('')),
  /** Write-only. */
  clientSecret: z.string().max(500).optional().or(z.literal('')),
  allowedDomains: z.array(z.string().trim().toLowerCase()).max(20).default([]),
});
export const emergencyRecipientSchema = z.object({
  name: trimmed(120).min(2),
  type: z.enum(['user', 'email']),
  userId: objectId.optional().nullable(),
  email: email.optional().or(z.literal('')),
  tier: z.enum(['primary', 'backup']).default('primary'),
  active: z.boolean().default(true),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type IncidentCreateInput = z.infer<typeof incidentCreateSchema>;

// ------------------------------------------------------------------ mobile app
export const googleIdTokenSchema = z.object({ idToken: z.string().min(100).max(5000), nonce: z.string().max(200).optional(), rememberMe: z.boolean().nullish() });
export const deviceRegistrationSchema = z.object({
  platform: z.enum(['android']),
  pushToken: z.string().min(20).max(4096).optional().nullable(),
  appVersion: trimmed(40),
  appVersionCode: z.coerce.number().int().min(1),
  deviceName: trimmed(120).optional(),
});

// ------------------------------------------------------------------ SOS responder actions
export const sosNoteSchema = z.object({ note: trimmed(1000).min(2) });
export const sosResolveSchema = z.object({ outcome: z.enum(['assisted', 'false_alarm', 'referred', 'unable_to_locate', 'other']), note: trimmed(1000).optional() });

// ------------------------------------------------------------------ incidents (student actions + AI helper)
export const incidentWithdrawSchema = z.object({ reason: trimmed(500).min(3, 'Tell us briefly why') });
export const incidentReopenSchema = z.object({ reason: trimmed(1000).min(10, 'Explain why the case should be reopened') });
export const categorySuggestSchema = z.object({ text: trimmed(5000).min(10) });

// ------------------------------------------------------------------ safety map, hazards, places
export const hazardCreateSchema = z.object({
  category: z.enum(HAZARD_CATEGORIES),
  description: trimmed(1000).min(10, 'Describe the hazard'),
  locationLabel: trimmed(200).min(2, 'Where is it?'),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  anonymous: z.boolean().default(false),
});
export const hazardReviewSchema = z.object({ status: z.enum(HAZARD_STATUSES), publicNote: trimmed(300).optional() });
export const placeSchema = z.object({
  name: trimmed(120).min(2),
  kind: z.enum(PLACE_KINDS),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  description: trimmed(300).default(''),
  phone: trimmed(30).optional().or(z.literal('')),
  hours: trimmed(120).optional().or(z.literal('')),
  verified: z.boolean().default(false),
  active: z.boolean().default(true),
});

// ------------------------------------------------------------------ lost & found, suggestions
export const lostFoundCreateSchema = z.object({
  type: z.enum(['lost', 'found']),
  title: trimmed(120).min(3),
  description: trimmed(1000).min(5),
  category: z.enum(LOST_FOUND_CATEGORIES),
  location: trimmed(200).min(2),
  occurredAt: z.coerce.date(),
  photoIds: z.array(objectId).max(3).default([]),
});
export const lostFoundClaimSchema = z.object({ message: trimmed(500).min(10, 'Describe something only the owner would know') });
export const lostFoundClaimDecisionSchema = z.object({ decision: z.enum(['approve', 'reject']) });
export const suggestionCreateSchema = z.object({ category: z.enum(SUGGESTION_CATEGORIES), text: trimmed(2000).min(10), anonymous: z.boolean().default(true) });
export const suggestionReviewSchema = z.object({ status: z.enum(SUGGESTION_STATUSES), response: trimmed(1000).optional() });

// ------------------------------------------------------------------ profile: safety card, notification preferences, privacy requests
export const safetyCardSchema = z.object({
  bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown']).default('unknown'),
  allergies: trimmed(300).default(''),
  medicalConditions: trimmed(500).default(''),
  medications: trimmed(300).default(''),
  accessibilityNeeds: trimmed(300).default(''),
  emergencyNote: trimmed(300).default(''),
  /** Explicit consent: responders see this card only during an active SOS raised by this student. */
  shareWithResponders: z.boolean().default(false),
});
export const notificationPrefsSchema = z.object(
  Object.fromEntries(NOTIFICATION_CATEGORIES.map((c) => [c, z.object({ inApp: z.boolean(), email: z.boolean(), push: z.boolean() }).partial().optional()])) as Record<
    NotificationCategory,
    z.ZodOptional<z.ZodObject<{ inApp: z.ZodOptional<z.ZodBoolean>; email: z.ZodOptional<z.ZodBoolean>; push: z.ZodOptional<z.ZodBoolean> }>>
  >,
);
export const dataRequestSchema = z.object({ type: z.enum(DATA_REQUEST_TYPES), reason: trimmed(500).optional() });
export const dataRequestDecisionSchema = z.object({ decision: z.enum(['complete', 'reject']), note: trimmed(500).optional(), confirm: z.string().optional() });

// ------------------------------------------------------------------ duty roster
const coordinatePair = {
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  accuracyMeters: z.number().min(0).max(100000).optional(),
  locationAgeSeconds: z.number().min(0).max(86400).optional(),
};
const bothOrNeither = (d: { latitude?: number; longitude?: number }) => (d.latitude == null) === (d.longitude == null);

/** Heartbeat from an on-duty responder's phone. The server ignores any client timestamp. */
export const heartbeatSchema = z
  .object({
    ...coordinatePair,
    batteryPercent: z.number().int().min(0).max(100).optional(),
    appVersion: trimmed(40).optional(),
  })
  .refine(bothOrNeither, { message: 'Send both latitude and longitude, or neither', path: ['latitude'] });

/** What a responder may set for themselves. "responding" and "stale" are set only by the server. */
export const dutySelfStatusSchema = z.object({
  status: z.enum(['on_duty', 'on_break', 'busy', 'unavailable', 'off_duty']),
  reason: trimmed(300).optional(),
  shiftId: objectId.optional(),
});
export const dutyOverrideSchema = z.object({
  status: z.enum(DUTY_STATUSES).refine((s) => s !== 'stale' && s !== 'responding', 'This status is set automatically'),
  reason: trimmed(500).min(5, 'Record why you are overriding the duty status'),
  /** Required to take a responder with open assignments off duty; their assignments are moved to other responders. */
  force: z.boolean().default(false),
});
export const dutyShiftSchema = z
  .object({
    responderId: objectId,
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
    campus: trimmed(60).min(1).default('main'),
    zoneId: objectId.optional().nullable(),
    notes: trimmed(500).optional(),
    /** A supervisor assigning the shift directly (accepted on the responder's behalf) instead of offering it. */
    assignDirectly: z.boolean().default(false),
  })
  .refine((d) => d.endAt.getTime() > d.startAt.getTime(), { path: ['endAt'], message: 'The shift must end after it starts' })
  .refine((d) => d.endAt.getTime() - d.startAt.getTime() <= 16 * 3600_000, { path: ['endAt'], message: 'Shifts can be at most 16 hours' });
export const dutyShiftUpdateSchema = z.object({
  action: z.enum(['cancel', 'reassign', 'end']),
  responderId: objectId.optional(),
  reason: trimmed(500).min(5, 'Record a reason'),
});
export const shiftDecisionSchema = z.object({ decision: z.enum(['accept', 'decline']), reason: trimmed(300).optional() });
export const responderProfileSchema = z.object({
  campus: trimmed(60).min(1).optional(),
  zoneId: objectId.optional().nullable(),
  skills: z.array(z.enum(RESPONDER_SKILLS)).max(RESPONDER_SKILLS.length).optional(),
  responsibilities: z.array(z.enum(RESPONDER_RESPONSIBILITIES)).max(RESPONDER_RESPONSIBILITIES.length).optional(),
  reason: trimmed(500).min(5, 'Record a reason'),
});
export const responderLocationConsentSchema = z.object({ shareLocation: z.boolean() });
export const responseZoneSchema = z.object({
  name: trimmed(80).min(2),
  code: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,40}$/, 'Letters, numbers and dashes'),
  campus: trimmed(60).min(1).default('main'),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.coerce.number().int().min(25).max(5000),
  description: trimmed(300).default(''),
  active: z.boolean().default(true),
});

// ------------------------------------------------------------------ SOS dispatch
export const alertAssignSchema = z.object({
  /** Omit to let the dispatch algorithm choose the best eligible responder. */
  responderId: objectId.optional(),
  reason: trimmed(500).min(5, 'Record why you are assigning manually'),
});
export const alertDeclineSchema = z.object({ reason: trimmed(300).min(3, 'Tell dispatch why') });

// ------------------------------------------------------------------ chat governance
export const chatReviewRequestSchema = z.object({
  scope: z.enum(CHAT_REVIEW_SCOPES),
  targetId: objectId,
  basis: z.enum(CHAT_REVIEW_BASES),
  reason: trimmed(1000).min(20, 'Describe the specific reason for this review (at least 20 characters)'),
  caseReference: trimmed(60).optional().or(z.literal('')),
  durationMinutes: z.coerce.number().int().min(5).max(240).default(30),
});
export const chatReviewEndSchema = z.object({ note: trimmed(500).optional() });

// ------------------------------------------------------------------ authenticator MFA
const sixDigits = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code');
export const totpCodeSchema = z.object({ code: sixDigits });
/** Recovery codes look like "k7d2m-9xq4p". Case, spaces and the dash are ignored. */
export const recoveryCodeInput = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .refine((v) => /^[a-z0-9]{10}$/.test(v), 'Enter a recovery code like k7d2m-9xq4p');
export const mfaChallengeSchema = z.object({ challengeToken: z.string().min(20).max(200).optional(), code: sixDigits });
export const mfaRecoverySchema = z.object({ challengeToken: z.string().min(20).max(200).optional(), recoveryCode: recoveryCodeInput });
export const mfaDisableSchema = z.object({ code: sixDigits });

// ------------------------------------------------------------------ console search
export const adminSearchSchema = z.object({ q: z.string().trim().min(2, 'Type at least 2 characters').max(80) });


// ------------------------------------------------------------------ Support Center & Help Knowledge Base
export const supportTicketCreateSchema = z.object({
  subject: trimmed(150).min(5, 'Enter a clear subject (at least 5 characters)'),
  category: z.enum(SUPPORT_CATEGORIES),
  description: trimmed(3000).min(20, 'Please describe your question or issue in detail (at least 20 characters)'),
  attachments: z.array(z.string().url()).max(5).default([]),
  preferredChannel: z.enum(['in_app', 'email']).default('in_app'),
});

export const supportTicketReplySchema = z.object({
  message: trimmed(3000).min(2, 'Enter your message'),
  attachments: z.array(z.string().url()).max(5).default([]),
  isInternal: z.boolean().default(false),
});

export const supportTicketAssignSchema = z.object({
  assignedTo: objectId.nullable(),
  reason: trimmed(300).optional(),
});

export const supportTicketStatusSchema = z.object({
  status: z.enum(SUPPORT_STATUSES),
  reason: trimmed(500).optional(),
});

export const supportTicketFeedbackSchema = z.object({
  helpful: z.boolean(),
  comment: trimmed(500).optional(),
});

export const faqArticleCreateSchema = z.object({
  title: trimmed(200).min(5, 'Title must be at least 5 characters'),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/, 'Slug must be alphanumeric with hyphens').optional(),
  category: z.enum(SUPPORT_CATEGORIES),
  summary: trimmed(300).min(10, 'Provide a brief summary'),
  content: trimmed(10000).min(20, 'Article content must be at least 20 characters'),
  instructions: z.array(trimmed(500)).optional(),
  status: z.enum(FAQ_STATUSES).default('published'),
  sourceTicketId: objectId.optional().nullable(),
});

export const faqArticleUpdateSchema = z.object({
  title: trimmed(200).min(5).optional(),
  category: z.enum(SUPPORT_CATEGORIES).optional(),
  summary: trimmed(300).min(10).optional(),
  content: trimmed(10000).min(20).optional(),
  instructions: z.array(trimmed(500)).optional(),
  status: z.enum(FAQ_STATUSES).optional(),
});

export const faqFeedbackSchema = z.object({
  helpful: z.boolean(),
});