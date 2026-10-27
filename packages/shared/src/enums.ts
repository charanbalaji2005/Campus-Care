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

/**
 * The five canonical main roles in the CampusCare ecosystem.
 * Formally structured to eliminate duplicate or ambiguous administrative roles.
 */
export const MAIN_ROLES = [
  'super_admin',
  'admin',
  'student',
  'counsellor',
  'security_officer',
] as const;
export type MainRole = (typeof MAIN_ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  admin: 'Campus Admin',
  student: 'Student',
  counsellor: 'Counsellor',
  security_officer: 'Safety Officer / Duty Officer',
  committee_member: 'Committee Member',
  moderator: 'Community Moderator',
};

export interface RoleDetail {
  id: Role;
  title: string;
  badge: string;
  subtitle: string;
  description: string;
  scope: string;
  responsibilities: string[];
  keyCapabilities: string[];
  securityNote: string;
}

export const MAIN_ROLE_DEFINITIONS: Record<MainRole, RoleDetail> = {
  super_admin: {
    id: 'super_admin',
    title: 'Super Admin',
    badge: 'Full System Control',
    subtitle: 'Full System Governance & Platform Control',
    description: 'Manage all modules, users, campus admins, permissions, security settings, reports, audit logs, and application configuration. Access sensitive data only when explicitly authorized.',
    scope: 'Ecosystem-wide (All Campuses, Databases & Infrastructure)',
    responsibilities: [
      'Manage all modules, users, campus admins, and system roles',
      'Oversee platform security, MFA policies, domain controls, and audit trails',
      'Configure notification templates, campus operational policies, and integrations',
      'Review system health, API analytics, database status, and background queues',
    ],
    keyCapabilities: [
      'Full administrative access across all campus portals and consoles',
      'Configure email providers, identity providers, and Turnstile settings',
      'Inspect immutable security audit logs and session revocation',
      'Sensitive data access restricted by default: requires explicit, audited break-glass authorization',
    ],
    securityNote: 'Sensitive student case files and private counselling notes are sealed by default. Access requires explicit permission grant with mandatory justification.',
  },
  admin: {
    id: 'admin',
    title: 'Campus Admin',
    badge: 'Campus Operations',
    subtitle: 'Campus Operations & Escalations',
    description: 'Manage campus operations, students, officers, announcements, incidents, reports, and duty assignments within their authorized campus scope.',
    scope: 'Campus-wide Operational Scope',
    responsibilities: [
      'Manage campus operations, students, and duty security officers',
      'Oversee campus announcements, emergency alerts, and community posts',
      'Triage and route incoming incidents to appropriate committees',
      'Assign duty shifts and manage campus roster availability',
    ],
    keyCapabilities: [
      'Incident case triage and routing across campus committees',
      'Roster oversight, duty assignment, and responder availability monitoring',
      'Student account management and role provisioning within campus scope',
      'Publishing official campus alerts, training materials, and contact registries',
    ],
    securityNote: 'Restricted from platform configuration, database credentials, and system-wide security settings. Cannot access confidential counselling notes.',
  },
  student: {
    id: 'student',
    title: 'Student',
    badge: 'Campus Resident / Scholar',
    subtitle: 'Campus Resident Safety & Community',
    description: 'Access SOS, GPS-based safety features, incident reporting, Safe Walk, counselling requests, community features, notifications, and personal account settings.',
    scope: 'Personal Account, Peer Community & Emergency Safety',
    responsibilities: [
      'Raise emergency SOS alerts when in danger or distress',
      'Report safety hazards, ragging, harassment, or infrastructure issues',
      'Request Safe Walk companion escorts across campus',
      'Book counselling appointments and communicate securely with assigned counsellors',
    ],
    keyCapabilities: [
      'Instant one-tap SOS with automated GPS location sharing and emergency contacts dispatch',
      'Incident submission with evidence attachments and anonymous reporting option',
      'Safe Walk live companion tracker with peer or security officer assignment',
      'Confidential counselling booking and student wellbeing support requests',
    ],
    securityNote: 'Client identity and location data are encrypted and strictly protected. Location is only shared with active responders during an open SOS or Safe Walk.',
  },
  counsellor: {
    id: 'counsellor',
    title: 'Counsellor',
    badge: 'Psychological Support',
    subtitle: 'Confidential Wellbeing & Psychological Support',
    description: 'Manage availability, appointments, counselling requests, and authorized private student conversations. Confidential counselling records must remain restricted.',
    scope: 'Assigned Appointments & Confidential Clinical Records',
    responsibilities: [
      'Manage counsellor availability schedule and slot allocations',
      'Review and accept incoming student counselling requests',
      'Conduct private, confidential consultations and therapy sessions',
      'Publish verified mental health resources and guidance in official channels',
    ],
    keyCapabilities: [
      'Confidential appointment workflow (pending, confirmed, completed, rescheduled)',
      'Private clinical notes storage accessible ONLY by the assigned counsellor',
      'Encrypted one-on-one student wellbeing messaging',
      'Aggregate anonymized reporting for campus wellbeing trends',
    ],
    securityNote: 'Clinical and therapy notes are strictly sealed. Even Super Admins cannot read private counselling session notes without explicit legal/safeguarding authorization and audit logging.',
  },
  security_officer: {
    id: 'security_officer',
    title: 'Safety Officer / Duty Officer',
    badge: 'Emergency Response & Patrol',
    subtitle: 'Emergency Ground Response & Campus Patrol',
    description: 'Receive and respond to assigned SOS alerts, view necessary location data, manage assigned incidents, update response status, and escalate emergencies.',
    scope: 'Active Shift Ground Operations & Emergency Dispatch',
    responsibilities: [
      'Receive instant SOS push alerts and emergency dispatch notifications',
      'View consenting student GPS coordinates and location breadcrumbs during active alerts',
      'Manage assigned incidents, update real-time response status, and record arrival timestamps',
      'Conduct Safe Walk escorts and coordinate emergency medical or police escalation',
    ],
    keyCapabilities: [
      'SOS response dashboard with live distance and directional navigation',
      'Duty status toggle (On duty, Off duty, On break, Busy, Responding)',
      'Real-time incident updates, evidence logging, and escalation workflows',
      'Direct secure coordination channel with campus control room during emergencies',
    ],
    securityNote: 'GPS location tracking of students is strictly restricted to active emergency response duration and automatically ceases once the alert is resolved.',
  },
};

/** Roles that can never be created through public registration or Google sign-up. */
export const PRIVILEGED_ROLES: Role[] = ['counsellor', 'committee_member', 'moderator', 'security_officer', 'admin', 'super_admin'];

export const ACCOUNT_STATUSES = ['pending_verification', 'active', 'invited', 'suspended', 'deactivated', 'archived'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  pending_verification: 'Pending Verification',
  active: 'Active',
  invited: 'Invited',
  suspended: 'Suspended',
  deactivated: 'Deactivated',
  archived: 'Archived',
};

/**
 * Institutional enrollment verification lifecycle for students.
 * Separate from email verification: email verified != institutional enrolled.
 */
export const STUDENT_VERIFICATION_STATUSES = [
  'pending',
  'under_review',
  'approved',
  'rejected',
  'needs_info',
  'expired',
  'revoked',
] as const;
export type StudentVerificationStatus = (typeof STUDENT_VERIFICATION_STATUSES)[number];

export const STUDENT_VERIFICATION_LABELS: Record<StudentVerificationStatus, string> = {
  pending: 'Pending Verification',
  under_review: 'Under Review',
  approved: 'Verified & Approved',
  rejected: 'Rejected',
  needs_info: 'More Info Required',
  expired: 'Enrollment Expired',
  revoked: 'Verification Revoked',
};

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
export const SOS_STATUSES = ['pending', 'queued', 'sending', 'sent', 'acknowledged', 'en_route', 'resolved', 'failed', 'cancelled'] as const;
/**
 * Alerts that responders must act on. "pending" (the cancellable countdown before dispatch) is
 * deliberately excluded: nobody is notified until the countdown ends.
 */
export const SOS_ACTIVE_STATUSES = ['queued', 'sending', 'sent', 'acknowledged', 'en_route', 'failed'] as const;
/** Statuses in which a responder may still acknowledge the alert. */
export const SOS_ACKNOWLEDGEABLE_STATUSES = ['queued', 'sending', 'sent', 'failed'] as const;
export const SOS_STATUS_LABELS: Record<(typeof SOS_STATUSES)[number], string> = {
  pending: 'Countdown — not sent yet',
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

// ------------------------------------------------------------------ duty roster
/**
 * Responder duty states. "stale" is set only by the server when an active responder's heartbeat
 * stops arriving: it means "unreachable", never "off duty".
 */
export const DUTY_STATUSES = ['on_duty', 'off_duty', 'on_break', 'busy', 'responding', 'unavailable', 'stale'] as const;
export type DutyStatus = (typeof DUTY_STATUSES)[number];
export const DUTY_STATUS_LABELS: Record<DutyStatus, string> = {
  on_duty: 'On duty',
  off_duty: 'Off duty',
  on_break: 'On break',
  busy: 'Busy',
  responding: 'Responding',
  unavailable: 'Unavailable',
  stale: 'Unreachable (stale heartbeat)',
};
/** States in which the responder is expected to send heartbeats. */
export const DUTY_ACTIVE_STATUSES: DutyStatus[] = ['on_duty', 'on_break', 'busy', 'responding'];

/** Who caused a duty change. Self changes are limited; "system" covers heartbeats, shift ends and dispatch. */
export const DUTY_ACTORS = ['self', 'supervisor', 'system'] as const;
export type DutyActor = (typeof DUTY_ACTORS)[number];

/** Allowed duty transitions. The server rejects anything else, whoever asks. */
export const DUTY_TRANSITIONS: Record<DutyStatus, DutyStatus[]> = {
  off_duty: ['on_duty', 'unavailable'],
  on_duty: ['on_break', 'busy', 'responding', 'unavailable', 'off_duty', 'stale'],
  on_break: ['on_duty', 'off_duty', 'unavailable', 'stale'],
  busy: ['on_duty', 'responding', 'on_break', 'unavailable', 'off_duty', 'stale'],
  responding: ['on_duty', 'busy', 'off_duty', 'stale'],
  unavailable: ['on_duty', 'off_duty'],
  stale: ['on_duty', 'on_break', 'busy', 'responding', 'off_duty', 'unavailable'],
};
/** Transitions only the server itself may make (never requested by a person). */
const SYSTEM_ONLY_TARGETS: DutyStatus[] = ['responding', 'stale'];
/** Targets a responder may choose for themselves. */
const SELF_TARGETS: DutyStatus[] = ['on_duty', 'on_break', 'busy', 'unavailable', 'off_duty'];

export function canTransitionDuty(from: DutyStatus, to: DutyStatus, actor: DutyActor): boolean {
  if (from === to) return false;
  if (!DUTY_TRANSITIONS[from]?.includes(to)) return false;
  if (actor === 'system') return true;
  if (SYSTEM_ONLY_TARGETS.includes(to)) return false;
  // Leaving "stale" by hand is a supervisor decision; a fresh heartbeat restores it automatically.
  if (actor === 'self') return SELF_TARGETS.includes(to) && from !== 'stale' && from !== 'responding';
  return true;
}

export const DUTY_SHIFT_STATUSES = ['offered', 'accepted', 'active', 'completed', 'cancelled', 'declined', 'missed'] as const;
export type DutyShiftStatus = (typeof DUTY_SHIFT_STATUSES)[number];

/** Responder qualifications used by the dispatch algorithm. */
export const RESPONDER_SKILLS = ['first_aid', 'cpr', 'fire_safety', 'women_safety', 'crowd_control', 'driving', 'counselling_support', 'language_telugu', 'language_hindi'] as const;
export type ResponderSkill = (typeof RESPONDER_SKILLS)[number];
export const RESPONDER_SKILL_LABELS: Record<ResponderSkill, string> = {
  first_aid: 'First aid',
  cpr: 'CPR',
  fire_safety: 'Fire safety',
  women_safety: 'Women’s safety trained',
  crowd_control: 'Crowd control',
  driving: 'Licensed driver',
  counselling_support: 'Psychological first aid',
  language_telugu: 'Speaks Telugu',
  language_hindi: 'Speaks Hindi',
};
/** Operational responsibilities a responder is permitted to take. Only "sos_response" holders receive SOS assignments. */
export const RESPONDER_RESPONSIBILITIES = ['sos_response', 'patrol', 'escort', 'gate', 'control_room', 'supervisor'] as const;
export type ResponderResponsibility = (typeof RESPONDER_RESPONSIBILITIES)[number];

// ------------------------------------------------------------------ SOS assignment
export const ASSIGNMENT_STATUSES = ['offered', 'acknowledged', 'declined', 'expired', 'superseded', 'cancelled', 'completed', 'released'] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];
export const OPEN_ASSIGNMENT_STATUSES: AssignmentStatus[] = ['offered', 'acknowledged'];
export const DISPATCH_POLICIES = ['single', 'group'] as const;
export type DispatchPolicy = (typeof DISPATCH_POLICIES)[number];
/** Overall assignment state shown on an alert. */
export const ALERT_ASSIGNMENT_STATES = ['none', 'offered', 'acknowledged', 'unassigned', 'closed'] as const;
export type AlertAssignmentState = (typeof ALERT_ASSIGNMENT_STATES)[number];

// ------------------------------------------------------------------ chat governance
export const CHAT_REVIEW_SCOPES = ['support_thread', 'case_chat'] as const;
export type ChatReviewScope = (typeof CHAT_REVIEW_SCOPES)[number];
export const CHAT_REVIEW_STATUSES = ['active', 'ended', 'expired', 'revoked'] as const;
/** The legal or policy basis an administrator must cite to read a private conversation. */
export const CHAT_REVIEW_BASES = ['safeguarding_concern', 'formal_complaint_investigation', 'legal_obligation', 'user_consent', 'security_incident'] as const;
export const CHAT_REVIEW_BASIS_LABELS: Record<(typeof CHAT_REVIEW_BASES)[number], string> = {
  safeguarding_concern: 'Safeguarding concern (risk of harm)',
  formal_complaint_investigation: 'Formal complaint investigation',
  legal_obligation: 'Legal obligation / lawful request',
  user_consent: 'Written consent of the participants',
  security_incident: 'Platform security incident',
};

// ------------------------------------------------------------------ Support Center & Help Knowledge Base
export const SUPPORT_CATEGORIES = [
  'account_verification',
  'login_password',
  'sos_safety',
  'gps_location',
  'incidents_complaints',
  'safe_walk',
  'counselling_appointments',
  'community',
  'notifications',
  'other',
] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const SUPPORT_CATEGORY_LABELS: Record<SupportCategory, string> = {
  account_verification: 'Account & Verification',
  login_password: 'Login & Password',
  sos_safety: 'SOS & Safety Features',
  gps_location: 'GPS & Location',
  incidents_complaints: 'Incidents & Complaints',
  safe_walk: 'Safe Walk',
  counselling_appointments: 'Counselling Appointments',
  community: 'Community Guidelines',
  notifications: 'Notifications & Permissions',
  other: 'Other Technical Help',
};

export const SUPPORT_STATUSES = [
  'new',
  'open',
  'assigned',
  'awaiting_student',
  'answered',
  'resolved',
  'reopened',
  'closed',
] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export const SUPPORT_STATUS_LABELS: Record<SupportStatus, string> = {
  new: 'New',
  open: 'Open',
  assigned: 'Assigned',
  awaiting_student: 'Awaiting Student',
  answered: 'Answered',
  resolved: 'Resolved',
  reopened: 'Reopened',
  closed: 'Closed',
};

export const SUPPORT_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];

export const FAQ_STATUSES = ['draft', 'published', 'archived'] as const;
export type FaqStatus = (typeof FAQ_STATUSES)[number];

export const BUILDING_CATEGORIES = [
  'academic',
  'administrative',
  'library',
  'hostel',
  'cafeteria',
  'medical',
  'security_office',
  'assembly_point',
  'gate',
  'parking',
  'bus_stop',
  'sports',
  'other',
] as const;
export type BuildingCategory = (typeof BUILDING_CATEGORIES)[number];

export const BUILDING_CATEGORY_LABELS: Record<BuildingCategory, string> = {
  academic: 'Academic Building',
  administrative: 'Administrative Office',
  library: 'Library',
  hostel: 'Hostel & Residence',
  cafeteria: 'Cafeteria & Dining',
  medical: 'Medical Facility',
  security_office: 'Security Office',
  assembly_point: 'Emergency Assembly Point',
  gate: 'Campus Gate & Entrance',
  parking: 'Parking Lot',
  bus_stop: 'Bus / Shuttle Stop',
  sports: 'Sports & Recreation',
  other: 'Other Facility',
};

export const PATHWAY_TYPES = [
  'pedestrian',
  'accessible',
  'vehicle',
  'emergency_access',
] as const;
export type PathwayType = (typeof PATHWAY_TYPES)[number];

export const PATHWAY_STATUSES = [
  'open',
  'restricted',
  'closed',
  'maintenance',
] as const;
export type PathwayStatus = (typeof PATHWAY_STATUSES)[number];

export const MAP_REPORT_TYPES = [
  'closed_pathway',
  'blocked_entrance',
  'incorrect_location',
  'accessibility_barrier',
  'hazard',
  'other',
] as const;
export type MapReportType = (typeof MAP_REPORT_TYPES)[number];

export const ROUTE_TRAVEL_MODES = [
  'walking',
  'accessible',
  'emergency',
] as const;
export type RouteTravelMode = (typeof ROUTE_TRAVEL_MODES)[number];
