import { Router, type Request } from 'express';
import mongoose, { Types } from 'mongoose';
import {
  ANNOUNCEMENT_CATEGORIES, DUTY_STATUS_LABELS, STATUS_LABELS, hasPermission, type DutyStatus, type IncidentStatus, type Permission, type Role,
} from '@campuscare/shared';
import { AppError, asyncHandler, escapeRegex, notFound, ok, pageParams } from '../lib/http';
import { requireAuth, requireMfaPolicy, requirePermission } from '../middleware/auth';
import { User, VerificationEvidence, type UserDoc } from '../models/user';
import { Committee, Incident } from '../models/incident';
import { Appointment, Availability, CounsellingCase } from '../models/counselling';
import { Announcement, Notification } from '../models/content';
import { EmergencyAlert } from '../models/safety';
import { ResponderAvailability } from '../models/duty';
import { PatrolRoute } from '../models/patrol';
import { DEFAULT_CAMPUS, campusScopeOf, inCampusScope, userCampusFilter } from '../services/campus-scope.service';
import { announcementAudienceFilter, categoriesFor, listConversations, serializeAnnouncement, settleAnnouncementSchedule } from '../services/chats.service';
import { getSettings } from '../services/settings.service';
import { audit } from '../services/audit.service';

/**
 * CampusCare College — Campus Admin portal. Read-mostly oversight of the four staff workflows
 * (Security / SOS, Committee / formal reports, Counselling, student & staff management) for the
 * administrator's own campuses. Everything is aggregate or metadata unless an explicit permission says
 * otherwise; actions reuse the existing endpoints (user status, case assignment, duty override,
 * announcements), which authorise again. Nothing here notifies anyone or joins realtime rooms: SOS
 * alerts still go to Security and formal reports to their Committee.
 */
export const campusAdminPortalRouter = Router();
campusAdminPortalRouter.use(requireAuth, requirePermission('admin:access'), requireMfaPolicy);

const can = (u: UserDoc, p: Permission) => hasPermission({ role: u.role as Role, permissions: u.permissions ?? [] }, p);
const scopeOf = (req: Request) => campusScopeOf(req.user!);

/** Filter on a document's own `campus` field (missing = the default campus). */
function campusFieldFilter(scope: string[] | null): Record<string, unknown> {
  if (scope === null) return {};
  return scope.includes(DEFAULT_CAMPUS) ? { $or: [{ campus: { $in: scope } }, { campus: null }, { campus: '' }] } : { campus: { $in: scope } };
}
const and = (...parts: Record<string, unknown>[]) => {
  const p = parts.filter((x) => Object.keys(x).length);
  return p.length ? { $and: p } : {};
};
const oid = (id: string) => {
  if (!Types.ObjectId.isValid(id)) throw notFound();
  return new Types.ObjectId(id);
};

export const SOS_ACTIVE = ['queued', 'sending', 'sent', 'failed', 'acknowledged', 'en_route'];
const SOS_UNACKED = ['queued', 'sending', 'sent', 'failed'];
/** Formal-report groupings used by every Campus Admin screen, so the numbers always agree. */
export const REPORT_GROUPS: Record<string, IncidentStatus[]> = {
  new: ['submitted', 'triage', 'reopened'],
  under_review: ['assigned', 'under_review'],
  in_progress: ['in_progress', 'escalated'],
  awaiting_information: ['awaiting_information'],
  resolved: ['resolved'],
  closed: ['closed', 'rejected', 'withdrawn'],
};
export const REPORT_OPEN: IncidentStatus[] = [...REPORT_GROUPS.new, ...REPORT_GROUPS.under_review, ...REPORT_GROUPS.in_progress, ...REPORT_GROUPS.awaiting_information];
const groupOf = (s: string) => Object.entries(REPORT_GROUPS).find(([, v]) => (v as string[]).includes(s))?.[0] ?? 'new';
/** Aggregates below this size are reported as "fewer than N" so small groups cannot be re-identified. */
export const SMALL_AGGREGATE = 5;
const suppress = (n: number) => (n > 0 && n < SMALL_AGGREGATE ? null : n);

/** What the signed-in administrator may do here, straight from server-side permissions. */
export function moduleAccess(u: UserDoc) {
  return {
    sosOversight: can(u, 'admin:access'),
    sosDispatch: can(u, 'sos:dispatch'),
    liveLocations: can(u, 'location:view_live'),
    reportsOversight: can(u, 'incidents:triage'),
    reportsSensitive: can(u, 'incidents:read_sensitive'),
    reportAssignment: can(u, 'incidents:triage'),
    counsellingAggregate: can(u, 'appointments:read_aggregate'),
    counsellingNotes: can(u, 'counselling_notes:read_all'),
    studentManagement: can(u, 'users:manage'),
    dutyView: can(u, 'duty:view'),
    dutyManage: can(u, 'duty:manage'),
    committeeManagement: can(u, 'committees:manage'),
    analytics: can(u, 'analytics:read'),
    announcements: can(u, 'announcements:manage'),
    superAdmin: u.role === 'super_admin',
  };
}

async function campusNames(scope: string[] | null) {
  const s = await getSettings();
  const all = ((s.registration as { campuses?: { id: string; name: string }[] }).campuses ?? [{ id: DEFAULT_CAMPUS, name: 'Main Campus' }]);
  const list = scope === null ? all : scope.map((id) => all.find((c) => c.id === id) ?? { id, name: id });
  return list.map((c) => ({ id: c.id, name: c.name }));
}

/** Ids of active staff of a role inside the scope (counsellors for appointments, officers for duty). */
async function scopedStaffIds(scope: string[] | null, role: Role) {
  const rows = await User.find({ role, accountStatus: 'active', ...userCampusFilter(scope) }, { _id: 1 }).lean();
  return rows.map((r) => r._id);
}

function startOfDay(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function rangeDays(req: Request) {
  const n = Number(req.query.range);
  return [7, 30, 90, 180, 365].includes(n) ? n : 30;
}

// ------------------------------------------------------------------ shared metric builders
async function sosMetrics(scope: string[] | null, since?: Date) {
  const base = campusFieldFilter(scope);
  const today = startOfDay();
  const [active, unacknowledged, resolvedToday, raised, resolved, ackDurations] = await Promise.all([
    EmergencyAlert.countDocuments(and(base, { status: { $in: SOS_ACTIVE } })),
    EmergencyAlert.countDocuments(and(base, { status: { $in: SOS_UNACKED } })),
    EmergencyAlert.countDocuments(and(base, { status: 'resolved', resolvedAt: { $gte: today } })),
    since ? EmergencyAlert.countDocuments(and(base, { status: { $ne: 'pending' }, createdAt: { $gte: since } })) : Promise.resolve(0),
    since ? EmergencyAlert.countDocuments(and(base, { status: 'resolved', resolvedAt: { $gte: since } })) : Promise.resolve(0),
    since
      ? EmergencyAlert.aggregate([
        { $match: and(base, { acknowledgedAt: { $ne: null }, createdAt: { $gte: since } }) },
        { $project: { s: { $divide: [{ $subtract: ['$acknowledgedAt', { $ifNull: ['$dispatchedAt', '$createdAt'] }] }, 1000] } } },
        { $group: { _id: null, avg: { $avg: '$s' }, n: { $sum: 1 } } },
      ])
      : Promise.resolve([] as { avg: number; n: number }[]),
  ]);
  const ack = ackDurations[0];
  return { active, unacknowledged, resolvedToday, raised, resolved, avgAcknowledgeSeconds: ack ? Math.round(ack.avg) : null, acknowledgedCount: ack?.n ?? 0 };
}

async function reportMetrics(scope: string[] | null, since?: Date) {
  const base = campusFieldFilter(scope);
  const now = new Date();
  const [byStatus, overdue, created, resolvedInRange, resolution] = await Promise.all([
    Incident.aggregate([{ $match: base }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Incident.countDocuments(and(base, { status: { $in: REPORT_OPEN }, dueResolveAt: { $lt: now } })),
    since ? Incident.countDocuments(and(base, { createdAt: { $gte: since } })) : Promise.resolve(0),
    since ? Incident.countDocuments(and(base, { resolvedAt: { $gte: since } })) : Promise.resolve(0),
    Incident.aggregate([
      { $match: and(base, { resolvedAt: { $ne: null }, ...(since ? { createdAt: { $gte: since } } : {}) }) },
      { $project: { d: { $divide: [{ $subtract: ['$resolvedAt', '$createdAt'] }, 86400000] } } },
      { $group: { _id: null, avg: { $avg: '$d' }, n: { $sum: 1 } } },
    ]),
  ]);
  const groups = { new: 0, under_review: 0, in_progress: 0, awaiting_information: 0, resolved: 0, closed: 0 } as Record<keyof typeof REPORT_GROUPS & string, number> & { new: number; under_review: number; in_progress: number; awaiting_information: number; resolved: number; closed: number };
  let total = 0;
  for (const s of byStatus as { _id: string; count: number }[]) {
    groups[groupOf(s._id)] += s.count;
    total += s.count;
  }
  const open = groups.new + groups.under_review + groups.in_progress + groups.awaiting_information;
  return {
    total, open, overdue, ...groups, created, resolvedInRange,
    resolutionRate: total ? Math.round(((groups.resolved + groups.closed) / total) * 100) : null,
    avgResolutionDays: resolution[0] ? Math.round(resolution[0].avg * 10) / 10 : null,
  };
}

async function counsellingMetrics(scope: string[] | null, from: Date, to: Date) {
  const counsellorIds = await scopedStaffIds(scope, 'counsellor');
  const mine = { counsellorId: { $in: counsellorIds } };
  const today = startOfDay();
  const tomorrow = new Date(today.getTime() + 86400_000);
  const [byStatus, todaySessions, pendingRequests, upcoming, unassigned] = await Promise.all([
    Appointment.aggregate([{ $match: { ...mine, createdAt: { $gte: from, $lt: to } } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Appointment.countDocuments({ ...mine, status: { $in: ['confirmed', 'rescheduled', 'completed'] }, startAt: { $gte: today, $lt: tomorrow } }),
    Appointment.countDocuments({ ...mine, status: 'requested' }),
    Appointment.countDocuments({ ...mine, status: { $in: ['confirmed', 'rescheduled'] }, startAt: { $gte: new Date() } }),
    // Requests still waiting for any counsellor, scoped by the student's campus (count only).
    Appointment.aggregate([
      { $match: { counsellorId: null, status: 'requested' } },
      { $lookup: { from: 'users', localField: 'studentId', foreignField: '_id', as: 's', pipeline: [{ $project: { campusZone: 1 } }] } },
      { $match: scope === null ? {} : { $or: [{ 's.campusZone': { $in: scope } }, ...(scope.includes(DEFAULT_CAMPUS) ? [{ 's.campusZone': null }, { 's.campusZone': '' }] : [])] } },
      { $count: 'n' },
    ]),
  ]);
  const status: Record<string, number> = {};
  for (const s of byStatus as { _id: string; count: number }[]) status[s._id] = s.count;
  const finished = (status.completed ?? 0) + (status.missed ?? 0);
  return {
    counsellors: counsellorIds.length,
    todaySessions, pendingRequests: pendingRequests + (unassigned[0]?.n ?? 0), upcoming,
    requested: Object.values(status).reduce((a, b) => a + b, 0),
    completed: status.completed ?? 0,
    cancelled: (status.cancelled ?? 0) + (status.rejected ?? 0),
    missed: status.missed ?? 0,
    completionRate: finished ? Math.round(((status.completed ?? 0) / finished) * 100) : null,
    counsellorIds,
  };
}

async function securityMetrics(scope: string[] | null) {
  const officerIds = await scopedStaffIds(scope, 'security_officer');
  const avail = await ResponderAvailability.find({ userId: { $in: officerIds } }, { status: 1 }).lean();
  const onDuty = avail.filter((a) => ['on_duty', 'busy', 'responding'].includes(a.status)).length;
  return { officers: officerIds.length, onDuty, offDuty: officerIds.length - onDuty, officerIds };
}

async function studentMetrics(scope: string[] | null) {
  const base = { role: 'student', ...userCampusFilter(scope) };
  const [byStatus, verified, awaitingVerification] = await Promise.all([
    User.aggregate([{ $match: base }, { $group: { _id: '$accountStatus', count: { $sum: 1 } } }]),
    User.countDocuments({ ...base, verificationStatus: 'approved' }),
    User.countDocuments({ ...base, verificationStatus: { $in: ['pending', 'submitted', 'under_review', 'needs_info'] } }),
  ]);
  const s: Record<string, number> = {};
  for (const r of byStatus as { _id: string; count: number }[]) s[r._id] = r.count;
  return {
    total: Object.values(s).reduce((a, b) => a + b, 0),
    active: s.active ?? 0,
    pendingVerification: s.pending_verification ?? 0,
    suspended: s.suspended ?? 0,
    verified, awaitingVerification,
  };
}

// ------------------------------------------------------------------ 1. dashboard
campusAdminPortalRouter.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const u = req.user!;
    const scope = scopeOf(req);
    const now = new Date();
    const access = moduleAccess(u);
    const [campuses, sos, reports, counselling, students, security, unread, announcements, recentSos, recentReports] = await Promise.all([
      campusNames(scope),
      sosMetrics(scope),
      reportMetrics(scope),
      counsellingMetrics(scope, startOfDay(), new Date(now.getTime() + 86400_000)),
      access.studentManagement ? studentMetrics(scope) : Promise.resolve(null),
      securityMetrics(scope),
      Notification.countDocuments({ userId: u._id, readAt: null }),
      (async () => {
        await settleAnnouncementSchedule();
        const docs = await Announcement.find(announcementAudienceFilter(u), { readBy: 0 }).sort({ pinned: -1, createdAt: -1 }).limit(3).lean();
        return docs.map((d) => serializeAnnouncement(d as never, { readIds: new Set(), manage: false }));
      })(),
      EmergencyAlert.find(and(campusFieldFilter(scope), { status: { $ne: 'pending' } }), { alertNumber: 1, status: 1, severity: 1, createdAt: 1, updatedAt: 1 }).sort({ updatedAt: -1 }).limit(5).lean(),
      Incident.find(campusFieldFilter(scope), { caseNumber: 1, status: 1, category: 1, createdAt: 1, updatedAt: 1 }).sort({ updatedAt: -1 }).limit(5).lean(),
    ]);
    // Workflow activity only (reference, status, time) — no names, descriptions or locations.
    const activity = [
      ...recentSos.map((a) => ({ kind: 'sos', reference: a.alertNumber, status: a.status, label: `SOS ${a.alertNumber} · ${a.status.replace(/_/g, ' ')}`, at: a.updatedAt ?? a.createdAt })),
      ...recentReports.map((i) => ({ kind: 'report', reference: i.caseNumber, status: i.status, label: `Report ${i.caseNumber} · ${STATUS_LABELS[i.status as IncidentStatus] ?? i.status}`, at: i.updatedAt ?? i.createdAt })),
    ].sort((a, b) => new Date(b.at as Date).getTime() - new Date(a.at as Date).getTime()).slice(0, 8);
    const { counsellorIds: _c, ...counsellingOut } = counselling;
    const { officerIds: _o, ...securityOut } = security;
    const committeeWorkload = await Incident.countDocuments(and(campusFieldFilter(scope), { status: { $in: REPORT_OPEN }, assignedTo: null }));
    ok(res, {
      admin: {
        name: u.fullName, designation: u.designation ?? null, roleLabel: u.role === 'super_admin' ? 'Super Admin' : 'Campus Admin',
        verified: u.verificationStatus === 'approved' || u.role === 'super_admin', emailVerified: Boolean(u.emailVerified),
      },
      campuses, unreadNotifications: unread,
      sos: { active: sos.active, unacknowledged: sos.unacknowledged, resolvedToday: sos.resolvedToday },
      reports: { new: reports.new, underReview: reports.under_review, inProgress: reports.in_progress, awaitingInformation: reports.awaiting_information, overdue: reports.overdue, resolved: reports.resolved, open: reports.open, unassigned: committeeWorkload },
      counselling: counsellingOut,
      students,
      security: securityOut,
      announcements,
      activity,
      health: { database: mongoose.connection.readyState === 1 ? 'ok' : 'degraded', serverTime: now },
      access,
    });
  }),
);

// ------------------------------------------------------------------ 2. live campus overview (map)
campusAdminPortalRouter.get(
  '/map',
  asyncHandler(async (req, res) => {
    const u = req.user!;
    const scope = scopeOf(req);
    const campuses = await campusNames(scope);
    const campus = typeof req.query.campus === 'string' && req.query.campus ? req.query.campus : campuses[0]?.id ?? DEFAULT_CAMPUS;
    if (!inCampusScope(scope, campus)) throw notFound();
    const only = campusFieldFilter([campus]);
    const access = moduleAccess(u);
    const active = await EmergencyAlert.find(and(only, { status: { $in: SOS_ACTIVE } }), { alertNumber: 1, status: 1, severity: 1, createdAt: 1, latitude: 1, longitude: 1, locationLabel: 1 }).sort({ createdAt: -1 }).limit(50).lean();
    // Precise SOS positions only for explicit location / dispatch permissions; every disclosure is audited.
    const showSos = access.liveLocations || access.sosDispatch;
    const sosMarkers = showSos
      ? active.filter((a) => typeof (a as { latitude?: number }).latitude === 'number').map((a) => ({
        id: String(a._id), reference: a.alertNumber, status: a.status, severity: a.severity, latitude: (a as { latitude: number }).latitude, longitude: (a as { longitude: number }).longitude, at: a.createdAt,
      }))
      : null;
    let responders: { id: string; name: string; status: string; latitude: number; longitude: number; at: Date | null }[] | null = null;
    if (access.liveLocations) {
      const officerIds = await scopedStaffIds([campus], 'security_officer');
      const rows = await ResponderAvailability.find({ userId: { $in: officerIds }, status: { $in: ['on_duty', 'busy', 'responding'] }, locationConsent: true, location: { $ne: null } }).lean();
      const names = new Map((await User.find({ _id: { $in: rows.map((r) => r.userId) } }, { fullName: 1 }).lean()).map((x) => [String(x._id), x.fullName]));
      responders = rows.filter((r) => r.location?.latitude != null).map((r) => ({
        id: String(r.userId), name: names.get(String(r.userId)) ?? 'Responder', status: r.status, latitude: r.location!.latitude as number, longitude: r.location!.longitude as number, at: (r.location as { at?: Date }).at ?? r.lastHeartbeatAt ?? null,
      }));
    }
    if (sosMarkers?.length || responders?.length) {
      await audit({ action: 'campus_admin.live_map_viewed', req, targetType: 'campus', targetId: campus, meta: { sosMarkers: sosMarkers?.length ?? 0, responders: responders?.length ?? 0 } });
    }
    ok(res, {
      campus, campuses,
      activeSos: active.length,
      sosMarkers, sosMarkersReason: showSos ? null : 'Precise SOS locations are shown only to accounts with live-location or dispatch permission.',
      responders, respondersReason: access.liveLocations ? null : 'Responder locations need the live-location permission.',
      // Coarse, non-identifying summary everyone in the portal may see.
      activeByArea: Object.entries(active.reduce<Record<string, number>>((m, a) => { const k = a.locationLabel || 'Location not shared'; m[k] = (m[k] ?? 0) + 1; return m; }, {})).map(([area, count]) => ({ area, count })),
    });
  }),
);

// ------------------------------------------------------------------ 3. SOS oversight
function sosRow(a: Record<string, any>, responders: Map<string, string>, detailed: boolean) {
  return {
    id: String(a._id), reference: a.alertNumber, createdAt: a.createdAt, dispatchedAt: a.dispatchedAt ?? null,
    severity: a.severity ?? 'high', status: a.status, campus: a.campus ?? DEFAULT_CAMPUS,
    area: a.locationLabel ?? null,
    acknowledged: Boolean(a.acknowledgedAt), acknowledgedAt: a.acknowledgedAt ?? null,
    assignmentState: a.assignmentState ?? 'none', responder: a.assignedTo ? responders.get(String(a.assignedTo)) ?? 'Assigned responder' : null,
    escalationLevel: a.escalationLevel ?? 0, resolvedAt: a.resolvedAt ?? null, outcome: a.resolutionOutcome ?? null,
    ...(detailed ? { latitude: a.latitude ?? null, longitude: a.longitude ?? null } : {}),
  };
}

campusAdminPortalRouter.get(
  '/sos',
  asyncHandler(async (req, res) => {
    const u = req.user!;
    const scope = scopeOf(req);
    const tab = req.query.status === 'resolved' ? 'resolved' : req.query.status === 'all' ? 'all' : 'active';
    const { page, limit, skip } = pageParams(req.query, 50);
    const statusFilter = tab === 'active' ? { status: { $in: SOS_ACTIVE } } : tab === 'resolved' ? { status: { $in: ['resolved', 'cancelled'] } } : { status: { $ne: 'pending' } };
    const parts: Record<string, unknown>[] = [campusFieldFilter(scope), statusFilter];
    if (typeof req.query.severity === 'string' && ['critical', 'high', 'medium', 'low'].includes(req.query.severity)) parts.push({ severity: req.query.severity });
    if (typeof req.query.q === 'string' && req.query.q.trim()) {
      const rx = { $regex: escapeRegex(req.query.q.trim().slice(0, 40)), $options: 'i' };
      parts.push({ $or: [{ alertNumber: rx }, { locationLabel: rx }] });
    }
    const filter = and(...parts);
    const [rows, total, metrics] = await Promise.all([
      EmergencyAlert.find(filter, { events: 0, evidence: 0, deviceInfo: 0, note: 0 }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      EmergencyAlert.countDocuments(filter),
      sosMetrics(scope, new Date(Date.now() - 30 * 86400_000)),
    ]);
    const responders = new Map((await User.find({ _id: { $in: rows.map((r) => r.assignedTo).filter(Boolean) } }, { fullName: 1 }).lean()).map((x) => [String(x._id), x.fullName]));
    const detailed = can(u, 'sos:dispatch');
    ok(res, { items: rows.map((r) => sosRow(r, responders, detailed)), total, page, limit, metrics, canDispatch: detailed });
  }),
);

campusAdminPortalRouter.get(
  '/sos/:id',
  asyncHandler(async (req, res) => {
    const u = req.user!;
    const a = await EmergencyAlert.findById(oid(req.params.id), { evidence: 0, deviceInfo: 0 }).lean();
    if (!a || a.status === 'pending' || !inCampusScope(scopeOf(req), a.campus)) throw notFound();
    const detailed = can(u, 'sos:dispatch');
    const ids = [a.assignedTo, a.acknowledgedBy, a.resolvedBy].filter(Boolean);
    const responders = new Map((await User.find({ _id: { $in: ids } }, { fullName: 1 }).lean()).map((x) => [String(x._id), x.fullName]));
    await audit({ action: 'campus_admin.sos_viewed', req, targetType: 'sos', targetId: String(a._id), meta: { detailed } });
    ok(res, {
      ...sosRow(a, responders, detailed),
      // Timeline: what happened and when, by staff label. Responder notes stay with responders.
      timeline: (a.events ?? []).map((e) => ({ type: e.type, at: e.at, actor: e.actorLabel ?? null, ...(detailed ? { note: e.note ?? null } : {}) })),
      canDispatch: detailed,
      restricted: detailed ? null : 'Student identity, notes and precise location are visible to Security responders and dispatchers only.',
    });
  }),
);

// ------------------------------------------------------------------ 4. formal-report oversight
function reportRow(i: Record<string, any>, committees: Map<string, { name: string; confidential: boolean }>, handlers: Map<string, string>, now: Date) {
  const c = i.committeeId ? committees.get(String(i.committeeId)) : null;
  return {
    id: String(i._id), reference: i.caseNumber, category: i.category, status: i.status, group: groupOf(i.status),
    statusLabel: STATUS_LABELS[i.status as IncidentStatus] ?? i.status, severity: i.severity, priority: i.priority, urgent: Boolean(i.urgent),
    committee: c?.name ?? null, committeeId: i.committeeId ? String(i.committeeId) : null, confidential: Boolean(c?.confidential),
    assigned: Boolean(i.assignedTo), handler: i.assignedTo ? handlers.get(String(i.assignedTo)) ?? 'Committee member' : null,
    createdAt: i.createdAt, updatedAt: i.updatedAt, dueResolveAt: i.dueResolveAt ?? null, acknowledgedAt: i.acknowledgedAt ?? null, resolvedAt: i.resolvedAt ?? null,
    overdue: (REPORT_OPEN as string[]).includes(i.status) && i.dueResolveAt != null && new Date(i.dueResolveAt) < now,
  };
}

async function reportLookups(rows: Record<string, any>[]) {
  const committees = new Map((await Committee.find({ _id: { $in: rows.map((r) => r.committeeId).filter(Boolean) } }, { name: 1, confidential: 1 }).lean()).map((c) => [String(c._id), { name: c.name, confidential: Boolean(c.confidential) }]));
  const handlers = new Map((await User.find({ _id: { $in: rows.map((r) => r.assignedTo).filter(Boolean) } }, { fullName: 1 }).lean()).map((x) => [String(x._id), x.fullName]));
  return { committees, handlers };
}

campusAdminPortalRouter.get(
  '/reports',
  requirePermission('incidents:triage'),
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const now = new Date();
    const { page, limit, skip } = pageParams(req.query, 50);
    const tab = String(req.query.tab ?? 'open');
    const parts: Record<string, unknown>[] = [campusFieldFilter(scope)];
    if (tab === 'overdue') parts.push({ status: { $in: REPORT_OPEN }, dueResolveAt: { $lt: now } });
    else if (tab === 'open') parts.push({ status: { $in: REPORT_OPEN } });
    else if (REPORT_GROUPS[tab]) parts.push({ status: { $in: REPORT_GROUPS[tab] } });
    else if (tab !== 'all') throw new AppError(400, 'bad_tab', 'Unknown report filter.');
    if (typeof req.query.category === 'string' && req.query.category) parts.push({ category: req.query.category });
    if (typeof req.query.committeeId === 'string' && Types.ObjectId.isValid(req.query.committeeId)) parts.push({ committeeId: new Types.ObjectId(req.query.committeeId) });
    if (req.query.assigned === 'false') parts.push({ assignedTo: null });
    if (typeof req.query.q === 'string' && req.query.q.trim()) parts.push({ caseNumber: { $regex: escapeRegex(req.query.q.trim().slice(0, 40)), $options: 'i' } });
    const sort: Record<string, 1 | -1> = req.query.sort === 'oldest' ? { createdAt: 1 } : req.query.sort === 'due' ? { dueResolveAt: 1 } : { createdAt: -1 };
    const filter = and(...parts);
    // Metadata only: title, description, parties, evidence and notes stay in the committee workflow.
    const projection = { caseNumber: 1, category: 1, status: 1, severity: 1, priority: 1, urgent: 1, committeeId: 1, assignedTo: 1, createdAt: 1, updatedAt: 1, dueResolveAt: 1, acknowledgedAt: 1, resolvedAt: 1 };
    const [rows, total, metrics, byCategory] = await Promise.all([
      Incident.find(filter, projection).sort(sort).skip(skip).limit(limit).lean(),
      Incident.countDocuments(filter),
      reportMetrics(scope, new Date(now.getTime() - 30 * 86400_000)),
      Incident.aggregate([{ $match: campusFieldFilter(scope) }, { $group: { _id: '$category', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    ]);
    const { committees, handlers } = await reportLookups(rows);
    ok(res, {
      items: rows.map((r) => reportRow(r, committees, handlers, now)), total, page, limit, metrics,
      categories: (byCategory as { _id: string; count: number }[]).map((c) => ({ category: c._id, count: c.count })),
      canAssign: can(req.user!, 'incidents:triage'), canReadSensitive: can(req.user!, 'incidents:read_sensitive'),
    });
  }),
);

// ------------------------------------------------------------------ 5. counselling overview (aggregate, no student data)
campusAdminPortalRouter.get(
  '/counselling',
  requirePermission('appointments:read_aggregate'),
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const days = rangeDays(req);
    const now = new Date();
    const from = new Date(startOfDay().getTime() - (days - 1) * 86400_000);
    const metrics = await counsellingMetrics(scope, from, new Date(now.getTime() + 86400_000));
    const ids = metrics.counsellorIds;
    const today = startOfDay();
    const weekEnd = new Date(today.getTime() + 7 * 86400_000);
    const [people, availability, load, upcoming, cases] = await Promise.all([
      User.find({ _id: { $in: ids } }, { fullName: 1, designation: 1 }).sort({ fullName: 1 }).lean(),
      Availability.find({ counsellorId: { $in: ids } }, { counsellorId: 1, acceptingRequests: 1, maxDailySessions: 1, weekly: 1, blockedDates: 1 }).lean(),
      Appointment.aggregate([
        { $match: { counsellorId: { $in: ids }, status: { $in: ['confirmed', 'rescheduled', 'completed', 'requested'] }, $or: [{ startAt: { $gte: today, $lt: weekEnd } }, { status: 'requested' }] } },
        { $group: { _id: { c: '$counsellorId', s: '$status', today: { $and: [{ $gte: ['$startAt', today] }, { $lt: ['$startAt', new Date(today.getTime() + 86400_000)] }] } }, n: { $sum: 1 } } },
      ]),
      // Upcoming sessions: time, mode and counsellor only. Student identity and reasons are never sent.
      Appointment.find({ counsellorId: { $in: ids }, status: { $in: ['confirmed', 'rescheduled'] }, startAt: { $gte: now } }, { counsellorId: 1, startAt: 1, endAt: 1, mode: 1, status: 1 }).sort({ startAt: 1 }).limit(15).lean(),
      CounsellingCase.aggregate([{ $match: { counsellorId: { $in: ids } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    ]);
    const av = new Map(availability.map((a) => [String(a.counsellorId), a]));
    const names = new Map(people.map((p) => [String(p._id), p.fullName]));
    const workload = new Map<string, { today: number; week: number; pending: number }>();
    for (const r of load as { _id: { c: Types.ObjectId; s: string; today: boolean }; n: number }[]) {
      const k = String(r._id.c);
      const w = workload.get(k) ?? { today: 0, week: 0, pending: 0 };
      if (r._id.s === 'requested') w.pending += r.n;
      else {
        w.week += r.n;
        if (r._id.today) w.today += r.n;
      }
      workload.set(k, w);
    }
    const todayKey = today.toISOString().slice(0, 10);
    const counsellors = people.map((p) => {
      const a = av.get(String(p._id));
      const w = workload.get(String(p._id)) ?? { today: 0, week: 0, pending: 0 };
      const dailyCap = a ? (a.maxDailySessions || 10) : 0;
      const worksToday = Boolean(a && (a.weekly ?? []).some((x) => x.weekday === today.getDay()) && !(a.blockedDates ?? []).includes(todayKey));
      return {
        id: String(p._id), name: p.fullName, designation: p.designation ?? 'Counsellor',
        accepting: Boolean(a?.acceptingRequests), worksToday, dailyCapacity: dailyCap,
        today: w.today, week: w.week, pendingRequests: w.pending,
        utilisation: dailyCap && worksToday ? Math.min(100, Math.round((w.today / dailyCap) * 100)) : null,
      };
    });
    const caseCounts: Record<string, number> = {};
    for (const c of cases as { _id: string; n: number }[]) caseCounts[c._id] = c.n;
    const capacityToday = counsellors.filter((c) => c.worksToday).reduce((s, c) => s + c.dailyCapacity, 0);
    const { counsellorIds: _ids, ...m } = metrics;
    ok(res, {
      range: days, metrics: m,
      capacity: { today: capacityToday, bookedToday: metrics.todaySessions, available: Math.max(0, capacityToday - metrics.todaySessions) },
      followUps: { active: caseCounts.follow_up ?? 0, openCases: caseCounts.active ?? 0, closed: caseCounts.closed ?? 0 },
      counsellors,
      upcoming: upcoming.map((x) => ({ id: String(x._id), counsellor: names.get(String(x.counsellorId)) ?? 'Counsellor', startAt: x.startAt, endAt: x.endAt, mode: x.mode, status: x.status })),
      canManageSchedules: false,
      privacy: can(req.user!, 'counselling_notes:read_all')
        ? 'You hold explicit counselling-record access; records are opened from the counselling workflow and every access is audited.'
        : 'Session notes, disclosures and student identities are private to the counsellor and are never shown here.',
    });
  }),
);

// ------------------------------------------------------------------ 6. student management (scoped, paged, audited)
const STUDENT_FIELDS = { fullName: 1, email: 1, studentId: 1, department: 1, academicYear: 1, accountStatus: 1, verificationStatus: 1, emailVerified: 1, campusZone: 1, createdAt: 1, lastLoginAt: 1, suspendedReason: 1, phone: 1 };
const studentOut = (s: Record<string, any>, full = false) => ({
  id: String(s._id), name: s.fullName, email: s.email, studentId: s.studentId ?? null, department: s.department ?? null,
  academicYear: s.academicYear ?? null, accountStatus: s.accountStatus, verificationStatus: s.verificationStatus ?? 'pending',
  emailVerified: Boolean(s.emailVerified), campus: s.campusZone || DEFAULT_CAMPUS, createdAt: s.createdAt,
  ...(full ? { phone: s.phone ?? null, lastLoginAt: s.lastLoginAt ?? null, suspendedReason: s.suspendedReason ?? null } : {}),
});

campusAdminPortalRouter.get(
  '/students',
  requirePermission('users:manage'),
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const { page, limit, skip } = pageParams(req.query, 50);
    const parts: Record<string, unknown>[] = [{ role: 'student' }, userCampusFilter(scope)];
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : '';
    if (q) {
      const rx = { $regex: escapeRegex(q), $options: 'i' };
      parts.push({ $or: [{ fullName: rx }, { email: rx }, { studentId: rx }] });
    }
    if (typeof req.query.department === 'string' && req.query.department.trim()) parts.push({ department: { $regex: `^${escapeRegex(req.query.department.trim().slice(0, 60))}`, $options: 'i' } });
    if (typeof req.query.status === 'string' && ['active', 'pending_verification', 'suspended', 'deactivated'].includes(req.query.status)) parts.push({ accountStatus: req.query.status });
    if (typeof req.query.verification === 'string' && ['pending', 'submitted', 'under_review', 'needs_info', 'approved', 'rejected'].includes(req.query.verification)) parts.push({ verificationStatus: req.query.verification });
    const filter = and(...parts);
    const [rows, total, departments] = await Promise.all([
      User.find(filter, STUDENT_FIELDS).sort({ fullName: 1 }).skip(skip).limit(limit).lean(),
      User.countDocuments(filter),
      User.distinct('department', and({ role: 'student' }, userCampusFilter(scope))),
    ]);
    // Searches are audited without the search text (it may be a name).
    await audit({ action: 'campus_admin.students_listed', req, targetType: 'user', meta: { hasQuery: Boolean(q), filters: { department: Boolean(req.query.department), status: req.query.status ?? null, verification: req.query.verification ?? null }, page, results: rows.length } });
    ok(res, { items: rows.map((r) => studentOut(r)), total, page, limit, departments: (departments as (string | null)[]).filter(Boolean).sort() });
  }),
);

campusAdminPortalRouter.get(
  '/students/:id',
  requirePermission('users:manage'),
  asyncHandler(async (req, res) => {
    const s = await User.findOne({ _id: oid(req.params.id), role: 'student' }, STUDENT_FIELDS).lean();
    // Another campus's students (and non-student accounts) do not exist as far as this screen is concerned.
    if (!s || !inCampusScope(scopeOf(req), s.campusZone)) throw notFound();
    const evidence = await VerificationEvidence.find({ userId: s._id }, { evidenceType: 1, status: 1, createdAt: 1, initialRecommendation: 1 }).sort({ createdAt: -1 }).limit(5).lean();
    await audit({ action: 'campus_admin.student_viewed', req, targetType: 'user', targetId: String(s._id) });
    ok(res, {
      ...studentOut(s, true),
      evidence: evidence.map((e) => ({ id: String(e._id), type: e.evidenceType, status: e.status, submittedAt: e.createdAt, initialRecommendation: (e as { initialRecommendation?: string }).initialRecommendation ?? null })),
      // Counselling records and incident evidence are deliberately not part of a student profile.
      restricted: 'Counselling records and report evidence are not shown in the student directory.',
      canChangeStatus: true,
    });
  }),
);

// ------------------------------------------------------------------ 7. security management
campusAdminPortalRouter.get(
  '/security',
  requirePermission('duty:view'),
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const sec = await securityMetrics(scope);
    const since = new Date(Date.now() - 30 * 86400_000);
    const [people, avail, patrols, sos, handled] = await Promise.all([
      User.find({ _id: { $in: sec.officerIds } }, { fullName: 1, designation: 1, campusZone: 1, phone: 1 }).sort({ fullName: 1 }).lean(),
      ResponderAvailability.find({ userId: { $in: sec.officerIds } }, { userId: 1, status: 1, lastHeartbeatAt: 1, activeAssignmentCount: 1, statusChangedAt: 1, campus: 1 }).lean(),
      PatrolRoute.find(and(campusFieldFilter(scope), { $or: [{ status: 'in_progress' }, { completedAt: { $gte: startOfDay() } }] })).sort({ updatedAt: -1 }).limit(30).lean(),
      sosMetrics(scope, since),
      EmergencyAlert.aggregate([{ $match: and(campusFieldFilter(scope), { assignedTo: { $ne: null }, createdAt: { $gte: since } }) }, { $group: { _id: '$assignedTo', n: { $sum: 1 } } }]),
    ]);
    const av = new Map(avail.map((a) => [String(a.userId), a]));
    const handledBy = new Map((handled as { _id: Types.ObjectId; n: number }[]).map((h) => [String(h._id), h.n]));
    const team = people.map((p) => {
      const a = av.get(String(p._id));
      const status = (a?.status ?? 'off_duty') as DutyStatus;
      return {
        id: String(p._id), name: p.fullName, designation: p.designation ?? 'Security Officer', campus: a?.campus ?? p.campusZone ?? DEFAULT_CAMPUS,
        dutyStatus: status, dutyLabel: DUTY_STATUS_LABELS[status] ?? status, lastHeartbeatAt: a?.lastHeartbeatAt ?? null, statusChangedAt: a?.statusChangedAt ?? null,
        activeAssignments: a?.activeAssignmentCount ?? 0, sosHandled30d: handledBy.get(String(p._id)) ?? 0,
      };
    });
    const checkpoints = patrols.reduce((s, r) => ({ total: s.total + (r.checkpoints?.length ?? 0), done: s.done + (r.checkpoints ?? []).filter((c) => c.status === 'completed').length }), { total: 0, done: 0 });
    ok(res, {
      summary: { officers: sec.officers, onDuty: sec.onDuty, offDuty: sec.offDuty, responding: avail.filter((a) => a.status === 'responding' || a.status === 'busy').length },
      sos: { active: sos.active, unacknowledged: sos.unacknowledged, raised30d: sos.raised, resolved30d: sos.resolved, avgAcknowledgeSeconds: sos.avgAcknowledgeSeconds },
      patrols: patrols.map((r) => ({
        id: String(r._id), name: r.name, status: r.status, officer: r.assignedOfficerName ?? null, shift: r.shiftTime ?? null,
        checkpointsDone: (r.checkpoints ?? []).filter((c) => c.status === 'completed').length, checkpointsTotal: r.checkpoints?.length ?? 0, startedAt: r.startedAt ?? null,
      })),
      checkpointCompletion: checkpoints.total ? Math.round((checkpoints.done / checkpoints.total) * 100) : null,
      team,
      canManageDuty: can(req.user!, 'duty:manage'),
    });
  }),
);

// ------------------------------------------------------------------ 8. committee management
campusAdminPortalRouter.get(
  '/committees',
  requirePermission('incidents:triage'),
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const now = new Date();
    const base = campusFieldFilter(scope);
    const [committees, perCommittee, perHandler, waiting] = await Promise.all([
      Committee.find({ active: true }, { name: 1, type: 1, confidential: 1, slaResolveDays: 1 }).sort({ name: 1 }).lean(),
      Incident.aggregate([
        { $match: base },
        {
          $group: {
            _id: '$committeeId',
            new: { $sum: { $cond: [{ $in: ['$status', REPORT_GROUPS.new] }, 1, 0] } },
            investigating: { $sum: { $cond: [{ $in: ['$status', [...REPORT_GROUPS.under_review, ...REPORT_GROUPS.in_progress]] }, 1, 0] } },
            awaitingInformation: { $sum: { $cond: [{ $in: ['$status', REPORT_GROUPS.awaiting_information] }, 1, 0] } },
            resolved: { $sum: { $cond: [{ $in: ['$status', [...REPORT_GROUPS.resolved, ...REPORT_GROUPS.closed]] }, 1, 0] } },
            overdue: { $sum: { $cond: [{ $and: [{ $in: ['$status', REPORT_OPEN] }, { $lt: ['$dueResolveAt', now] }, { $ne: ['$dueResolveAt', null] }] }, 1, 0] } },
            unassigned: { $sum: { $cond: [{ $and: [{ $in: ['$status', REPORT_OPEN] }, { $eq: ['$assignedTo', null] }] }, 1, 0] } },
            nextDue: { $min: { $cond: [{ $in: ['$status', REPORT_OPEN] }, '$dueResolveAt', null] } },
          },
        },
      ]),
      Incident.aggregate([
        { $match: and(base, { assignedTo: { $ne: null }, status: { $in: REPORT_OPEN } }) },
        { $group: { _id: '$assignedTo', open: { $sum: 1 }, overdue: { $sum: { $cond: [{ $and: [{ $lt: ['$dueResolveAt', now] }, { $ne: ['$dueResolveAt', null] }] }, 1, 0] } }, nextDue: { $min: '$dueResolveAt' } } },
        { $sort: { open: -1 } },
      ]),
      Incident.find(and(base, { status: { $in: REPORT_OPEN }, assignedTo: null }), { caseNumber: 1, category: 1, status: 1, severity: 1, priority: 1, urgent: 1, committeeId: 1, assignedTo: 1, createdAt: 1, updatedAt: 1, dueResolveAt: 1 }).sort({ dueResolveAt: 1 }).limit(25).lean(),
    ]);
    const stats = new Map((perCommittee as Record<string, any>[]).map((c) => [String(c._id), c]));
    const handlers = await User.find({ _id: { $in: (perHandler as { _id: Types.ObjectId }[]).map((h) => h._id) } }, { fullName: 1, committeeMemberships: 1 }).lean();
    const hName = new Map(handlers.map((h) => [String(h._id), h]));
    const cName = new Map(committees.map((c) => [String(c._id), c.name]));
    const { committees: lookC, handlers: lookH } = await reportLookups(waiting);
    const unrouted = stats.get('null');
    ok(res, {
      committees: committees.map((c) => {
        const s = stats.get(String(c._id)) ?? {};
        return {
          id: String(c._id), name: c.name, type: c.type, confidential: Boolean(c.confidential),
          new: s.new ?? 0, investigating: s.investigating ?? 0, awaitingInformation: s.awaitingInformation ?? 0, resolved: s.resolved ?? 0, overdue: s.overdue ?? 0, unassigned: s.unassigned ?? 0, nextDue: s.nextDue ?? null,
        };
      }),
      unrouted: unrouted ? { new: unrouted.new, unassigned: unrouted.unassigned } : null,
      workload: (perHandler as { _id: Types.ObjectId; open: number; overdue: number; nextDue: Date | null }[]).map((h) => {
        const p = hName.get(String(h._id));
        return { id: String(h._id), name: p?.fullName ?? 'Committee member', committees: (p?.committeeMemberships ?? []).map((m) => cName.get(String(m.committeeId))).filter(Boolean), open: h.open, overdue: h.overdue, nextDue: h.nextDue };
      }),
      awaitingAssignment: waiting.map((r) => reportRow(r, lookC, lookH, now)),
      canAssign: can(req.user!, 'incidents:triage'),
    });
  }),
);

// ------------------------------------------------------------------ 9. analytics
campusAdminPortalRouter.get(
  '/analytics',
  requirePermission('analytics:read'),
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const days = rangeDays(req);
    const now = new Date();
    const from = new Date(startOfDay().getTime() - (days - 1) * 86400_000);
    const prevFrom = new Date(from.getTime() - days * 86400_000);
    const base = campusFieldFilter(scope);
    const bucket = days <= 30 ? '%Y-%m-%d' : '%Y-%m';
    const [reports, prevReports, sos, prevSos, counselling, students, security, byCategory, reportTrend, sosTrend, patrolsDone, committeeLoad] = await Promise.all([
      reportMetrics(scope, from),
      Incident.countDocuments(and(base, { createdAt: { $gte: prevFrom, $lt: from } })),
      sosMetrics(scope, from),
      EmergencyAlert.countDocuments(and(base, { status: { $ne: 'pending' }, createdAt: { $gte: prevFrom, $lt: from } })),
      counsellingMetrics(scope, from, new Date(now.getTime() + 86400_000)),
      can(req.user!, 'users:manage') ? studentMetrics(scope) : Promise.resolve(null),
      securityMetrics(scope),
      Incident.aggregate([{ $match: and(base, { createdAt: { $gte: from } }) }, { $group: { _id: '$category', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
      Incident.aggregate([{ $match: and(base, { createdAt: { $gte: from } }) }, { $group: { _id: { $dateToString: { format: bucket, date: '$createdAt' } }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
      EmergencyAlert.aggregate([{ $match: and(base, { status: { $ne: 'pending' }, createdAt: { $gte: from } }) }, { $group: { _id: { $dateToString: { format: bucket, date: '$createdAt' } }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
      PatrolRoute.countDocuments(and(base, { status: 'completed', completedAt: { $gte: from } })),
      Incident.aggregate([{ $match: and(base, { status: { $in: REPORT_OPEN } }) }, { $group: { _id: '$committeeId', open: { $sum: 1 } } }]),
    ]);
    const cNames = new Map((await Committee.find({}, { name: 1 }).lean()).map((c) => [String(c._id), c.name]));
    const { counsellorIds: _c, ...c } = counselling;
    const { officerIds: _o, ...s } = security;
    ok(res, {
      range: days, from, to: now,
      reports: { total: reports.created, previous: prevReports, resolved: reports.resolvedInRange, open: reports.open, overdue: reports.overdue, resolutionRate: reports.resolutionRate, avgResolutionDays: reports.avgResolutionDays },
      // Category counts below the threshold are withheld (null) to reduce re-identification risk.
      byCategory: (byCategory as { _id: string; count: number }[]).map((x) => ({ category: x._id, count: suppress(x.count) })),
      reportTrend: (reportTrend as { _id: string; count: number }[]).map((x) => ({ period: x._id, count: x.count })),
      sos: { raised: sos.raised, previous: prevSos, resolved: sos.resolved, avgAcknowledgeSeconds: sos.avgAcknowledgeSeconds, active: sos.active },
      sosTrend: (sosTrend as { _id: string; count: number }[]).map((x) => ({ period: x._id, count: x.count })),
      counselling: { requested: c.requested, completed: c.completed, cancelled: c.cancelled, missed: c.missed, completionRate: c.completionRate, counsellors: c.counsellors },
      security: { officers: s.officers, onDuty: s.onDuty, patrolsCompleted: patrolsDone },
      students,
      committeeWorkload: (committeeLoad as { _id: Types.ObjectId | null; open: number }[]).map((x) => ({ committee: x._id ? cNames.get(String(x._id)) ?? 'Committee' : 'Not yet routed', open: x.open })),
      smallAggregateThreshold: SMALL_AGGREGATE,
    });
  }),
);

// ------------------------------------------------------------------ 10. announcements (read side; publishing uses /chats/announcements)
const AUDIENCE_FILTERS: Record<string, Record<string, unknown>> = {
  admin: { targetRoles: { $in: ['admin'] } },
  committee: { targetRoles: { $in: ['committee_member'] } },
  campus: { $or: [{ category: { $in: ['campus_updates', 'general', 'events', 'academic'] } }, { campus: { $ne: 'all' } }] },
  security: { $or: [{ category: { $in: ['safety', 'emergency'] } }, { targetRoles: { $in: ['security_officer'] } }] },
  counselling: { $or: [{ category: 'counselling' }, { targetRoles: { $in: ['counsellor'] } }] },
};

campusAdminPortalRouter.get(
  '/announcements',
  asyncHandler(async (req, res) => {
    await settleAnnouncementSchedule();
    const u = req.user!;
    const { page, limit, skip } = pageParams(req.query, 50);
    const audience = String(req.query.audience ?? 'all');
    const parts: Record<string, unknown>[] = [announcementAudienceFilter(u)];
    if (audience !== 'all') {
      if (!AUDIENCE_FILTERS[audience]) throw new AppError(400, 'bad_audience', 'Unknown announcement category.');
      parts.push(AUDIENCE_FILTERS[audience]);
    }
    if (typeof req.query.q === 'string' && req.query.q.trim()) {
      const rx = { $regex: escapeRegex(req.query.q.trim().slice(0, 80)), $options: 'i' };
      parts.push({ $or: [{ title: rx }, { body: rx }] });
    }
    const filter = { $and: parts };
    const [docs, total] = await Promise.all([
      Announcement.find(filter, { readBy: 0, history: 0 }).sort({ pinned: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
      Announcement.countDocuments(filter),
    ]);
    const readIds = new Set((await Announcement.find({ _id: { $in: docs.map((d) => d._id) }, 'readBy.userId': u._id }, { _id: 1 }).lean()).map((d) => String(d._id)));
    const scope = scopeOf(req);
    ok(res, {
      items: docs.map((d) => serializeAnnouncement(d as never, { readIds, manage: false })), total, page, limit,
      canPublish: can(u, 'announcements:manage'),
      // Where this administrator may publish: their own campuses (Super Admins also "all").
      publishCampuses: scope === null ? [{ id: 'all', name: 'All campuses' }, ...(await campusNames(null))] : await campusNames(scope),
      categories: ANNOUNCEMENT_CATEGORIES,
    });
  }),
);

campusAdminPortalRouter.post(
  '/announcements/:id/read',
  asyncHandler(async (req, res) => {
    const u = req.user!;
    const r = await Announcement.updateOne(
      { $and: [{ _id: oid(req.params.id) }, announcementAudienceFilter(u), { 'readBy.userId': { $ne: u._id } }] },
      { $push: { readBy: { userId: u._id, readAt: new Date() } }, $inc: { readCount: 1 } },
    );
    ok(res, { read: true, changed: r.modifiedCount > 0 });
  }),
);

// ------------------------------------------------------------------ 11. messages (groups over the authorised Chats center)
const MESSAGE_GROUPS: { key: string; category: 'security' | 'reports' | 'counsellor_admin' | 'admin_super_admin' | 'direct' | 'student_admin'; label: string; description: string }[] = [
  { key: 'security', category: 'security', label: 'Security control room', description: 'SOS and security coordination you are part of' },
  { key: 'committee', category: 'reports', label: 'Committee team', description: 'Report conversations you may access' },
  { key: 'counsellors', category: 'counsellor_admin', label: 'Counsellors', description: 'Counsellor–administrator conversations' },
  { key: 'admins', category: 'admin_super_admin', label: 'Campus Admin colleagues', description: 'Administrators and Super Admin' },
  { key: 'direct', category: 'direct', label: 'Direct messages', description: 'One-to-one conversations' },
  { key: 'students', category: 'student_admin', label: 'Student support', description: 'Students who wrote to administration' },
];

campusAdminPortalRouter.get(
  '/messages',
  asyncHandler(async (req, res) => {
    const u = req.user!;
    const allowed = await categoriesFor(u);
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : undefined;
    const groups = [];
    for (const g of MESSAGE_GROUPS) {
      if (!allowed.includes(g.category)) continue;
      // listConversations applies the same per-conversation authorisation as the Chats center.
      const items = await listConversations(u, { category: g.category, q });
      groups.push({
        key: g.key, category: g.category, label: g.label, description: g.description,
        unread: items.reduce((s, i) => s + (i.unread ?? 0), 0), count: items.length,
        recent: items.slice(0, 3).map((i) => ({ id: i.id, type: i.type, title: i.title, preview: i.locked ? null : i.preview, lastActivityAt: i.lastActivityAt, unread: i.unread, locked: i.locked })),
      });
    }
    ok(res, { groups });
  }),
);

// ------------------------------------------------------------------ 12. profile & module access
campusAdminPortalRouter.get(
  '/profile',
  asyncHandler(async (req, res) => {
    const u = req.user!;
    const scope = scopeOf(req);
    const s = await getSettings();
    ok(res, {
      id: String(u._id), name: u.fullName, email: u.email, phone: u.phone ?? null, designation: u.designation ?? null, department: u.department ?? null,
      roleLabel: u.role === 'super_admin' ? 'Super Admin' : 'Campus Admin',
      verificationStatus: u.verificationStatus ?? 'pending', emailVerified: Boolean(u.emailVerified), mfaEnabled: Boolean(u.mfaEnabled),
      campuses: await campusNames(scope),
      access: moduleAccess(u),
      permissions: [...new Set([...(u.permissions ?? [])])],
      // No campus-level settings are delegated to Campus Admins; institutional settings stay with Super Admin.
      campusSettings: { delegated: false, note: 'Campus records, roles, permissions and platform settings are managed by the Super Admin portal.' },
      support: { email: s.platform.supportEmail || null },
    });
  }),
);
