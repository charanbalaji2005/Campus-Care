import { z } from 'zod';
import {
  ALERT_SEVERITIES, APPOINTMENT_MODES, APPOINTMENT_STATUSES, COMMITTEE_TYPES, CONTACT_CATEGORIES,
  INCIDENT_CATEGORIES, INCIDENT_STATUSES, PRIORITIES, ROLES, SEVERITIES, MAIL_SERVICES,
  HAZARD_CATEGORIES, HAZARD_STATUSES, PLACE_KINDS, LOST_FOUND_CATEGORIES, SUGGESTION_CATEGORIES, SUGGESTION_STATUSES,
  NOTIFICATION_CATEGORIES, DATA_REQUEST_TYPES, type NotificationCategory,
} from './enums';

const trimmed = (max: number) => z.string().trim().max(max);
export const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
export const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);

/** Every CampusCare account (student or staff) must use an official SRM University-AP address. */
export const ACCOUNT_EMAIL_DOMAIN = 'srmap.edu.in';
export function isAllowedAccountEmail(address: string): boolean {
  const at = address.trim().toLowerCase().lastIndexOf('@');
  return at > 0 && address.trim().toLowerCase().slice(at + 1) === ACCOUNT_EMAIL_DOMAIN;
}
export const universityEmail = email.refine(isAllowedAccountEmail, `Use your @${ACCOUNT_EMAIL_DOMAIN} email address`);
export const turnstileToken = z.string().max(4096).optional();

export const passwordSchema = (min = 10) =>
  z
    .string()
    .min(min, `Use at least ${min} characters`)
    .max(128)
    .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), 'Include upper and lower case letters and a number');

// ---------------------------------------------------------------- auth
export const registerSchema = z
  .object({
    fullName: trimmed(120).min(2, 'Enter your full name'),
    email: universityEmail,
    studentId: trimmed(40).min(2, 'Enter your student ID').regex(/^[A-Za-z0-9\-/]+$/, 'Letters, numbers, - and / only'),
    department: trimmed(120).min(2, 'Select your department'),
    academicYear: z.coerce.number().int().min(1).max(6),
    phone: trimmed(20).regex(/^\+?[0-9 ]{7,20}$/, 'Enter a valid phone number').optional().or(z.literal('')),
    password: passwordSchema(),
    confirmPassword: z.string(),
    acceptPolicy: z.literal(true, { errorMap: () => ({ message: 'You must accept the privacy policy' }) }),
    turnstileToken,
  })
  .refine((d) => d.password === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' });

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password').max(128),
  rememberMe: z.boolean().optional(),
  mfaCode: z.string().regex(/^\d{6}$/).optional(),
  turnstileToken,
});

export const tokenSchema = z.object({ token: z.string().min(20).max(200) });
export const forgotPasswordSchema = z.object({ email, turnstileToken });
export const resendVerificationSchema = z.object({ email, turnstileToken });
export const resetPasswordSchema = z
  .object({ token: z.string().min(20).max(200), password: passwordSchema(), confirmPassword: z.string(), turnstileToken })
  .refine((d) => d.password === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' });
export const reauthSchema = z.object({ password: z.string().max(128).optional(), mfaCode: z.string().regex(/^\d{6}$/).optional() });
export const mfaVerifySchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });
export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1), password: passwordSchema(), confirmPassword: z.string() })
  .refine((d) => d.password === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' });
export const profileUpdateSchema = z.object({
  fullName: trimmed(120).min(2).optional(),
  phone: trimmed(20).regex(/^\+?[0-9 ]{7,20}$/).optional().or(z.literal('')),
  department: trimmed(120).optional(),
  academicYear: z.coerce.number().int().min(1).max(6).optional(),
  hostel: trimmed(80).optional().or(z.literal('')),
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
  counsellorId: objectId,
  startAt: z.coerce.date(),
  mode: z.enum(APPOINTMENT_MODES),
  reason: trimmed(500).optional(),
  idempotencyKey: z.string().uuid(),
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
export const sosCreateSchema = z.object({
  idempotencyKey: z.string().uuid(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  accuracyMeters: z.number().min(0).max(100000).optional(),
  locationUnavailableReason: trimmed(120).optional(),
  note: trimmed(300).optional(),
  /** Email verified trusted contacts as well as Campus Security. */
  notifyTrustedContacts: z.boolean().default(true),
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
});
export const locationUpdateSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().min(0).max(100000).optional(),
});
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
export const userStatusSchema = z.object({ action: z.enum(['suspend', 'reactivate']), reason: trimmed(500).min(3) });
export const userRoleSchema = z.object({ role: z.enum(ROLES), permissions: z.array(z.string().max(60)).max(60).default([]), reason: trimmed(500).min(3) });
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
export const googleIdTokenSchema = z.object({ idToken: z.string().min(100).max(5000), nonce: z.string().max(200).optional() });
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
