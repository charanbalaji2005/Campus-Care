import { hasPermission, type Role } from '@campuscare/shared';

export interface Viewer {
  id: string;
  role: Role;
  permissions: string[];
  committeeIds: string[];
  reporterTag: string;
}

export interface IncidentAccessFacts {
  reporterId?: unknown;
  reporterTag?: string | null;
  committeeId?: unknown;
  assignedTo?: unknown;
}

/**
 * - reporter: the student who filed it (directly or through the anonymous tag)
 * - handler: assigned case owner, a member of the responsible committee, or an explicit read_sensitive grant
 * - triage: administrators who route cases — metadata only, never the description, evidence or chat
 * - none: everyone else (the API answers 404 so case ids can't be probed)
 */
export type AccessLevel = 'reporter' | 'handler' | 'triage' | 'none';

const id = (v: unknown) => (v == null ? null : String(v));

export function incidentAccess(viewer: Viewer, inc: IncidentAccessFacts): AccessLevel {
  const subject = { role: viewer.role, permissions: viewer.permissions };
  if (id(inc.reporterId) === viewer.id) return 'reporter';
  if (inc.reporterTag && inc.reporterTag === viewer.reporterTag) return 'reporter';
  if (viewer.role !== 'student') {
    if (id(inc.assignedTo) === viewer.id) return 'handler';
    const committee = id(inc.committeeId);
    if (committee && viewer.committeeIds.includes(committee) && hasPermission(subject, 'incidents:read_committee')) return 'handler';
    if (hasPermission(subject, 'incidents:read_sensitive')) return 'handler';
    if (hasPermission(subject, 'incidents:triage')) return 'triage';
  }
  return 'none';
}

export function canUpdateStatus(viewer: Viewer, level: AccessLevel, toStatus: string): boolean {
  if (level === 'handler') return hasPermission({ role: viewer.role, permissions: viewer.permissions }, 'incidents:update_committee') || hasPermission({ role: viewer.role, permissions: viewer.permissions }, 'incidents:read_sensitive');
  // Triage administrators can route, reject as ineligible, or escalate — not run the investigation.
  if (level === 'triage') return ['triage', 'assigned', 'rejected', 'escalated'].includes(toStatus);
  return false;
}

export function canChat(level: AccessLevel): boolean {
  return level === 'reporter' || level === 'handler';
}
