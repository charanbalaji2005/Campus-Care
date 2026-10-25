// Domain enums shared by the API and the web app.

export const ROLES = [
  'student',
  'counsellor',
  'committee_member',
  'security_officer',
  'moderator',
  'admin',
  'super_admin',
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  student: 'Student',
  counsellor: 'Counsellor',
  committee_member: 'Committee member',
  security_officer: 'Security officer',
  moderator: 'Community moderator',
  admin: 'Administrator',
  super_admin: 'Super Admin',
};

/** Roles that can never be created through public registration or Google sign-up. */
export const PRIVILEGED_ROLES: Role[] = ['counsellor', 'committee_member', 'moderator', 'security_officer', 'admin', 'super_admin'];

export const ACCOUNT_STATUSES = ['pending_verification', 'active', 'invited', 'suspended'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const COMMITTEE_TYPES = [
  'anti_ragging',
  'gender_sensitivity',
  'grievance',
  'security',
  'academic',
  'hostel_transport',
  'other',
] as const;
export type CommitteeType = (typeof COMMITTEE_TYPES)[number];

export const COMMITTEE_TYPE_LABELS: Record<CommitteeType, string> = {
  anti_ragging: 'Anti-Ragging Committee',
  gender_sensitivity: 'Gender Sensitivity Committee / ICC',
  grievance: 'Student Grievance Committee',
  security: 'Campus Security',
  academic: 'Academic Grievance Team',
  hostel_transport: 'Hostel & Transport Support',
  other: 'Other approved committee',
};

export const INCIDENT_CATEGORIES = [
  'ragging',
  'harassment',
  'discrimination',
  'academic',
  'hostel',
  'transport',
  'cyber_abuse',
  'security',
  'infrastructure',
  'other',
] as const;
export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number];

export const CATEGORY_INFO: Record<IncidentCategory, { label: string; description: string; defaultCommittee: CommitteeType; sensitive: boolean }> = {
  ragging: { label: 'Ragging', description: 'Teasing, intimidation or forced acts by other students', defaultCommittee: 'anti_ragging', sensitive: true },
  harassment: { label: 'Harassment', description: 'Sexual or gender-based harassment', defaultCommittee: 'gender_sensitivity', sensitive: true },
  discrimination: { label: 'Discrimination', description: 'Unfair treatment based on identity', defaultCommittee: 'grievance', sensitive: true },
  academic: { label: 'Academic', description: 'Teaching, evaluation or examination concerns', defaultCommittee: 'academic', sensitive: false },
  hostel: { label: 'Hostel', description: 'Hostel safety, facilities or conduct', defaultCommittee: 'hostel_transport', sensitive: false },
  transport: { label: 'Transport', description: 'Campus transport safety or service', defaultCommittee: 'hostel_transport', sensitive: false },
  cyber_abuse: { label: 'Cyber abuse', description: 'Online harassment, impersonation or threats', defaultCommittee: 'grievance', sensitive: true },
  security: { label: 'Security', description: 'Theft, assault, trespass or threats on campus', defaultCommittee: 'security', sensitive: true },
  infrastructure: { label: 'Infrastructure', description: 'Unsafe buildings, lighting or facilities', defaultCommittee: 'grievance', sensitive: false },
  other: { label: 'Other', description: 'Anything else affecting your safety or wellbeing', defaultCommittee: 'grievance', sensitive: false },
};

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const INCIDENT_STATUSES = [
  'submitted',
  'triage',
  'assigned',
  'under_review',
  'in_progress',
  'awaiting_information',
  'escalated',
  'resolved',
  'reopened',
  'closed',
  'rejected',
  'withdrawn',
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const STATUS_LABELS: Record<IncidentStatus, string> = {
  submitted: 'Submitted',
  triage: 'Under triage',
  assigned: 'Assigned',
  under_review: 'Under review',
  in_progress: 'Action in progress',
  awaiting_information: 'Needs information',
  escalated: 'Escalated',
  resolved: 'Resolved',
  reopened: 'Reopened',
  closed: 'Closed',
  rejected: 'Not eligible',
  withdrawn: 'Withdrawn',
};

/** Allowed workflow transitions for case handlers. The server rejects anything else. */
export const STATUS_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  submitted: ['triage', 'assigned', 'rejected'],
  triage: ['assigned', 'rejected', 'escalated'],
  assigned: ['under_review', 'in_progress', 'awaiting_information', 'escalated'],
  under_review: ['in_progress', 'awaiting_information', 'escalated', 'resolved'],
  in_progress: ['awaiting_information', 'escalated', 'resolved'],
  awaiting_information: ['under_review', 'in_progress', 'escalated', 'resolved'],
  escalated: ['under_review', 'in_progress', 'resolved'],
  resolved: ['closed', 'in_progress'],
  reopened: ['under_review', 'in_progress', 'escalated'],
  closed: [],
  rejected: [],
  withdrawn: [],
};

/** Actions the reporting student may take on their own case (where university policy allows). */
export const STUDENT_WITHDRAWABLE: IncidentStatus[] = ['submitted', 'triage', 'assigned', 'under_review', 'awaiting_information'];
/** A resolved case can be reopened by the reporter within this many days. */
export const REOPEN_WINDOW_DAYS = 14;

export function canTransition(from: IncidentStatus, to: IncidentStatus): boolean {
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export const TERMINAL_STATUSES: IncidentStatus[] = ['closed', 'rejected', 'withdrawn'];
export const STUDENT_TIMELINE: IncidentStatus[] = ['submitted', 'assigned', 'under_review', 'in_progress', 'resolved', 'closed'];

export const APPOINTMENT_STATUSES = ['requested', 'confirmed', 'rescheduled', 'rejected', 'cancelled', 'completed', 'missed'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
export const ACTIVE_APPOINTMENT_STATUSES: AppointmentStatus[] = ['requested', 'confirmed', 'rescheduled'];

export const APPOINTMENT_MODES = ['in_person', 'online'] as const;
export type AppointmentMode = (typeof APPOINTMENT_MODES)[number];

/**
 * Chat channel kinds. Each kind has its own permission model:
 * - community: moderated discussion visible to verified university users
 * - support_service: a configured service students can open a private thread with
 * - support_thread: private thread between one student and the staff pool of a service
 * - counselling_thread: private thread for one appointment (student + counsellor)
 * Complaint chat uses the separate CaseMessage collection.
 */
export const CHAT_KINDS = ['community', 'support_service', 'support_thread', 'counselling_thread'] as const;
export type ChatKind = (typeof CHAT_KINDS)[number];

/** Media policy groups configurable by the Super Admin. */
export const MEDIA_SCOPES = ['support', 'community', 'case', 'counselling'] as const;
export type MediaScope = (typeof MEDIA_SCOPES)[number];
export const MEDIA_SCOPE_LABELS: Record<MediaScope, string> = {
  support: 'Private support chats',
  community: 'Community chat',
  case: 'Complaint (case) chat',
  counselling: 'Counselling chats',
};

/**
 * SOS lifecycle. "sent" means our delivery channels accepted the alert — it is NOT a human
 * acknowledgement. "acknowledged" and "en_route" are only set by an authorised responder.
 */
export const SOS_STATUSES = ['queued', 'sending', 'sent', 'acknowledged', 'en_route', 'resolved', 'failed', 'cancelled'] as const;
export const SOS_ACTIVE_STATUSES = ['queued', 'sending', 'sent', 'acknowledged', 'en_route', 'failed'] as const;
export const SOS_STATUS_LABELS: Record<(typeof SOS_STATUSES)[number], string> = {
  queued: 'Alert queued',
  sending: 'Sending to responders',
  sent: 'Delivered — waiting for a responder',
  acknowledged: 'Acknowledged by Campus Security',
  en_route: 'Responder on the way',
  resolved: 'Resolved',
  failed: 'Delivery failed — call for help',
  cancelled: 'Cancelled',
};
export type SosStatus = (typeof SOS_STATUSES)[number];

export const SAFE_WALK_STATUSES = ['active', 'arrived', 'overdue', 'escalated', 'cancelled'] as const;
export type SafeWalkStatus = (typeof SAFE_WALK_STATUSES)[number];

export const ALERT_SEVERITIES = ['info', 'advisory', 'warning', 'emergency'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const CONTACT_CATEGORIES = ['emergency', 'security', 'medical', 'committee', 'counselling', 'hostel', 'academic', 'helpline', 'other'] as const;
export type ContactCategory = (typeof CONTACT_CATEGORIES)[number];

export const DEPARTMENTS = [
  'Computer Science & Engineering',
  'Electronics & Communication Engineering',
  'Electrical & Electronics Engineering',
  'Mechanical Engineering',
  'Civil Engineering',
  'Biotechnology',
  'Physics',
  'Chemistry',
  'Mathematics',
  'Management',
  'Liberal Arts',
  'Commerce',
  'Law',
  'Other',
] as const;

/** Nodemailer well-known services offered in the Super Admin console (sign-in with email + app password). */
export const MAIL_SERVICES = ['gmail', 'outlook365', 'hotmail', 'yahoo', 'zoho'] as const;
export type MailService = (typeof MAIL_SERVICES)[number];
export const MAIL_SERVICE_LABELS: Record<MailService, string> = {
  gmail: 'Gmail / Google Workspace',
  outlook365: 'Microsoft 365 (Outlook)',
  hotmail: 'Outlook.com / Hotmail',
  yahoo: 'Yahoo Mail',
  zoho: 'Zoho Mail',
};

export const HAZARD_CATEGORIES = ['poor_lighting', 'unsafe_area', 'infrastructure', 'harassment_hotspot', 'traffic', 'fire_electrical', 'other'] as const;
export type HazardCategory = (typeof HAZARD_CATEGORIES)[number];
export const HAZARD_STATUSES = ['open', 'verified', 'in_progress', 'resolved', 'rejected'] as const;

export const PLACE_KINDS = ['security_post', 'medical', 'safe_zone', 'help_point', 'gate', 'hostel', 'academic', 'restricted'] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

export const LOST_FOUND_CATEGORIES = ['id_card', 'electronics', 'keys', 'wallet', 'bag', 'books', 'clothing', 'other'] as const;
export const LOST_FOUND_STATUSES = ['open', 'claimed', 'returned', 'closed', 'removed'] as const;

export const SUGGESTION_CATEGORIES = ['lighting', 'security', 'infrastructure', 'transport', 'hostel', 'wellbeing', 'other'] as const;
export const SUGGESTION_STATUSES = ['new', 'reviewed', 'planned', 'done', 'declined'] as const;

export const NOTIFICATION_PRIORITIES = ['critical', 'high', 'normal', 'low'] as const;
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];
/** User-controllable notification categories. Critical safety alerts cannot be switched off. */
export const NOTIFICATION_CATEGORIES = ['case_updates', 'chat_messages', 'appointments', 'announcements', 'training', 'community'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const DATA_REQUEST_TYPES = ['export', 'deletion'] as const;
export const DATA_REQUEST_STATUSES = ['pending', 'completed', 'rejected'] as const;
