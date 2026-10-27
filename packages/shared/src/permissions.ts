import type { Role } from './enums';

/**
 * Fine-grained permissions. Roles grant a baseline; Super Admins can grant extra
 * permissions to individual staff. Resource checks (is this my case? am I on this
 * committee?) are applied on top of these on the server.
 */
export const PERMISSIONS = [
  // student
  'incidents:create',
  'incidents:read_own',
  'appointments:request',
  'chat:community',
  'chat:support',
  'sos:raise',
  'safety:self',
  // committee / security
  'incidents:read_committee',
  'incidents:update_committee',
  'sos:respond',
  'safety:responder_view',
  'duty:self', // own duty status, shift acceptance and heartbeats
  // counselling
  'appointments:manage_own',
  'counselling_notes:own',
  'counselling_notes:read_all', // never granted by default; explicit lawful access only
  // admin
  'admin:access',
  'incidents:triage', // see metadata of all cases, assign/route them
  'incidents:read_sensitive', // read full content of every case — explicit grant only
  'users:manage',
  'committees:manage',
  'appointments:read_aggregate',
  'announcements:manage',
  'campus_alerts:manage',
  'training:manage',
  'contacts:manage',
  'analytics:read',
  'audit:read',
  'chat:moderate',
  'community_safety:manage', // review hazard reports, safety suggestions, lost & found moderation
  'safety_intel:manage', // campus places, safety map, response metrics
  // super admin
  'super_admin:access',
  'domains:manage',
  'identity_providers:manage',
  'email:manage',
  'roles:manage',
  'routing:manage',
  'security:manage',
  'settings:manage',
  'retention:manage',
  'chat:configure',
  'sos:configure',
  // operations
  'duty:view', // see the duty roster and responder availability
  'duty:manage', // supervisors: create shifts, assign them and override duty status (always with a reason)
  'sos:dispatch', // emergency operations: view alert detail and assign / reassign responders
  'location:view_live', // live map of consented location shares (every view is audited)
  'notifications:manage',
  'chat:read_private', // exceptional, audited review of a private support or complaint conversation — explicit grant only
  // community feed
  'community:moderate', // review reported/held feed posts and comments, decide appeals — never grants private chat access
  'community:organize_events', // publish official campus events (individual grant for organisers)
  'community_channels:manage', // verify which counsellors may publish in the Official Counselling Support channel
  'support:manage', // manage help knowledge base and student support requests
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const STUDENT: Permission[] = ['incidents:create', 'incidents:read_own', 'appointments:request', 'chat:community', 'chat:support', 'sos:raise', 'safety:self'];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  student: STUDENT,
  counsellor: ['appointments:manage_own', 'counselling_notes:own', 'chat:community', 'chat:support'],
  committee_member: ['incidents:read_committee', 'incidents:update_committee', 'chat:community', 'chat:support'],
  moderator: ['chat:moderate', 'chat:community', 'community_safety:manage', 'community:moderate'],
  security_officer: ['incidents:read_committee', 'incidents:update_committee', 'sos:respond', 'safety:responder_view', 'duty:self', 'chat:community', 'chat:support'],
  admin: [
    'admin:access', 'incidents:triage', 'users:manage', 'committees:manage', 'appointments:read_aggregate',
    'announcements:manage', 'campus_alerts:manage', 'training:manage', 'contacts:manage', 'analytics:read',
    'audit:read', 'chat:moderate', 'chat:community', 'community_safety:manage', 'safety_intel:manage', 'duty:view',
    'community:moderate', 'support:manage',
  ],
  super_admin: [
    'admin:access', 'super_admin:access', 'incidents:triage', 'users:manage', 'committees:manage',
    'appointments:read_aggregate', 'announcements:manage', 'campus_alerts:manage', 'training:manage',
    'contacts:manage', 'analytics:read', 'audit:read', 'chat:moderate', 'chat:community', 'domains:manage',
    'identity_providers:manage', 'email:manage', 'roles:manage', 'routing:manage', 'security:manage',
    'settings:manage', 'retention:manage', 'chat:configure', 'sos:configure', 'community_safety:manage', 'safety_intel:manage',
    'duty:view', 'duty:manage', 'sos:dispatch', 'location:view_live', 'notifications:manage',
    'community:moderate', 'community_channels:manage', 'support:manage',
  ],
};

/** Permissions that can only be granted individually and never come with a role. */
export const EXPLICIT_ONLY_PERMISSIONS: Permission[] = ['incidents:read_sensitive', 'counselling_notes:read_all', 'chat:read_private'];

export interface PermissionSubject {
  role: Role;
  permissions?: string[];
}

export function permissionsFor(subject: PermissionSubject): Set<Permission> {
  const set = new Set<Permission>(ROLE_PERMISSIONS[subject.role] ?? []);
  for (const p of subject.permissions ?? []) {
    if ((PERMISSIONS as readonly string[]).includes(p)) set.add(p as Permission);
  }
  return set;
}

export function hasPermission(subject: PermissionSubject, permission: Permission): boolean {
  return permissionsFor(subject).has(permission);
}

/** Where to send a user after sign-in, decided from server-side role data. */
export function homePathFor(role: Role): string {
  switch (role) {
    case 'student':
      return '/student/dashboard';
    case 'counsellor':
      return '/consultancy/dashboard';
    case 'committee_member':
      return '/committee/cases';
    case 'security_officer':
      return '/security/alerts';
    case 'moderator':
      return '/moderator/queue';
    case 'admin':
      return '/admin/dashboard';
    case 'super_admin':
      return '/super-admin/dashboard';
  }
}

/** Which roles a given actor may assign. Nobody may assign a role equal to or above their own except Super Admin. */
export function assignableRoles(actor: Role): Role[] {
  if (actor === 'super_admin') return ['student', 'counsellor', 'committee_member', 'security_officer', 'moderator', 'admin', 'super_admin'];
  if (actor === 'admin') return ['student', 'counsellor', 'committee_member', 'security_officer', 'moderator'];
  return [];
}
