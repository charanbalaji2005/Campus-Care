import { z } from 'zod';
import { Router } from 'express';
import { Types } from 'mongoose';
import {
  announcementSchema, assignableRoles, campusAlertSchema, committeeMemberSchema, committeeSchema, contactSchema, trainingModuleSchema,
  userInviteSchema, userStatusSchema, type Role,
} from '@campuscare/shared';
import { AppError, asyncHandler, escapeRegex, notFound, ok, pageParams, parse } from '../lib/http';
import { randomToken, sha256 } from '../lib/crypto';
import { InviteToken, Session, User, VerificationEvidence, publicUser } from '../models/user';
import { Committee, Incident } from '../models/incident';
import { Appointment } from '../models/counselling';
import { Announcement, Contact, TrainingModule, TrainingProgress } from '../models/content';
import { CampusAlert, EmergencyAlert, SafetyCheckIn } from '../models/safety';
import { AuditLog } from '../models/platform';
import { requireAuth, requireMfaPolicy, requirePermission } from '../middleware/auth';
import { campusScopeOf, inCampusScope, userCampusFilter } from '../services/campus-scope.service';
import { standDownAccount } from '../services/account-lifecycle.service';
import { emailProofActivates } from '../services/auth.service';
import { canTransitionVerification, type StudentVerificationStatus } from '@campuscare/shared';
import type { UserDoc } from '../models/user';
import { audit, verifyAuditChain, getAuditMetrics, getRecordHistory } from '../services/audit.service';
import { getDbWatcherHealth } from '../services/db-watcher.service';
import { appLink, sendEmail } from '../services/email/email.service';
import { isDomainAllowed, revokeAllSessions } from '../services/auth.service';
import { notify } from '../services/notification.service';
import { disconnectUser } from '../realtime/socket';

export const adminRouter = Router();
adminRouter.use(requireAuth, requirePermission('admin:access'), requireMfaPolicy);

// ------------------------------------------------------------------ overview & analytics (aggregate only)
adminRouter.get(
  '/overview',
  requirePermission('analytics:read'),
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const day = new Date(now.getTime() - 86400_000);
    const week = new Date(now.getTime() - 7 * 86400_000);
    const month = new Date(now.getTime() - 30 * 86400_000);
    const [students, staff, today, thisWeek, thisMonth, byStatus, overdue, activeSos, pendingStaff] = await Promise.all([
      User.countDocuments({ role: 'student', accountStatus: 'active' }),
      User.countDocuments({ role: { $ne: 'student' }, accountStatus: 'active' }),
      Incident.countDocuments({ createdAt: { $gte: day } }),
      Incident.countDocuments({ createdAt: { $gte: week } }),
      Incident.countDocuments({ createdAt: { $gte: month } }),
      Incident.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Incident.countDocuments({ status: { $nin: ['resolved', 'closed', 'rejected'] }, dueResolveAt: { $lt: now } }),
      EmergencyAlert.countDocuments({ status: { $in: ['queued', 'sending', 'sent', 'failed'] } }),
      User.countDocuments({ accountStatus: 'invited' }),
    ]);
    const statusMap = Object.fromEntries(byStatus.map((s) => [s._id, s.count]));
    const unacknowledged = await Incident.countDocuments({ acknowledgedAt: null, status: { $in: ['submitted', 'triage'] }, dueAcknowledgeAt: { $lt: now } });
    const recent = await AuditLog.find({ action: { $in: ['incident.assigned', 'incident.reassigned', 'incident.status_changed', 'user.invited', 'user.suspended', 'committee.created', 'settings.updated'] } }).sort({ at: -1 }).limit(10).lean();
    ok(res, {
      users: { students, staff, pendingStaff },
      incidents: {
        today, thisWeek, thisMonth,
        pending: (statusMap.submitted ?? 0) + (statusMap.triage ?? 0),
        assigned: statusMap.assigned ?? 0,
        inProgress: (statusMap.in_progress ?? 0) + (statusMap.awaiting_information ?? 0) + (statusMap.escalated ?? 0),
        resolved: (statusMap.resolved ?? 0) + (statusMap.closed ?? 0),
        total: Object.values(statusMap).reduce((a: number, b) => a + Number(b), 0),
        overdue, unacknowledged,
      },
      alerts: { activeSos },
      recentActivity: recent.map((r) => ({ id: String(r._id), action: r.action, at: r.at, targetType: r.targetType })),
    });
  }),
);

adminRouter.get(
  '/analytics',
  requirePermission('analytics:read'),
  asyncHandler(async (req, res) => {
    const months = Math.min(24, Math.max(1, Number(req.query.months) || 6));
    const from = new Date(); from.setMonth(from.getMonth() - months + 1); from.setDate(1); from.setHours(0, 0, 0, 0);
    const match: Record<string, unknown> = { createdAt: { $gte: from } };
    if (req.query.category) match.category = String(req.query.category);
    if (req.query.committeeId && Types.ObjectId.isValid(String(req.query.committeeId))) match.committeeId = new Types.ObjectId(String(req.query.committeeId));

    const [monthly, byCategory, byCommittee, resolution, ageing, byDepartment, training, counselling] = await Promise.all([
      Incident.aggregate([{ $match: match }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
      Incident.aggregate([{ $match: match }, { $group: { _id: '$category', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
      Incident.aggregate([
        { $match: match },
        { $group: { _id: '$committeeId', total: { $sum: 1 }, open: { $sum: { $cond: [{ $in: ['$status', ['resolved', 'closed', 'rejected']] }, 0, 1] } } } },
      ]),
      Incident.aggregate([
        { $match: { ...match, resolvedAt: { $ne: null } } },
        { $project: { days: { $divide: [{ $subtract: ['$resolvedAt', '$createdAt'] }, 86400000] } } },
        { $bucket: { groupBy: '$days', boundaries: [0, 1, 3, 7, 14, 30, 10000], default: 'other', output: { count: { $sum: 1 } } } },
      ]),
      Incident.aggregate([
        { $match: { status: { $nin: ['resolved', 'closed', 'rejected'] } } },
        { $project: { days: { $divide: [{ $subtract: [new Date(), '$createdAt'] }, 86400000] } } },
        { $bucket: { groupBy: '$days', boundaries: [0, 2, 7, 14, 30, 100000], default: 'other', output: { count: { $sum: 1 } } } },
      ]),
      // Department breakdown excludes anonymous reports and buckets under 5 to avoid re-identification.
      Incident.aggregate([
        { $match: { ...match, anonymous: false, reporterId: { $ne: null } } },
        { $lookup: { from: 'users', localField: 'reporterId', foreignField: '_id', as: 'r', pipeline: [{ $project: { department: 1 } }] } },
        { $group: { _id: { $ifNull: [{ $first: '$r.department' }, 'Unknown'] }, count: { $sum: 1 } } },
        { $match: { count: { $gte: 5 } } },
        { $sort: { count: -1 } },
      ]),
      TrainingProgress.aggregate([{ $group: { _id: '$moduleId', completed: { $sum: { $cond: [{ $ne: ['$completedAt', null] }, 1, 0] } }, started: { $sum: 1 } } }]),
      Appointment.aggregate([{ $match: { startAt: { $gte: from } } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    ]);
    const committees = await Committee.find({}, { name: 1 }).lean();
    const cName = new Map(committees.map((c) => [String(c._id), c.name]));
    const modules = await TrainingModule.find({}, { title: 1 }).lean();
    const mName = new Map(modules.map((m) => [String(m._id), m.title]));
    const label = (b: unknown, labels: Record<string, string>) => labels[String(b)] ?? String(b);
    ok(res, {
      monthly: monthly.map((m) => ({ month: m._id, count: m.count })),
      byCategory: byCategory.map((c) => ({ category: c._id, count: c.count })),
      byCommittee: byCommittee.map((c) => ({ committee: c._id ? cName.get(String(c._id)) ?? 'Unknown' : 'Unrouted', total: c.total, open: c.open })),
      resolutionDays: resolution.map((r) => ({ bucket: label(r._id, { 0: '< 1 day', 1: '1–3 days', 3: '3–7 days', 7: '1–2 weeks', 14: '2–4 weeks', 30: '30+ days' }), count: r.count })),
      ageing: ageing.map((a) => ({ bucket: label(a._id, { 0: '< 2 days', 2: '2–7 days', 7: '1–2 weeks', 14: '2–4 weeks', 30: '30+ days' }), count: a.count })),
      byDepartment: byDepartment.map((d) => ({ department: d._id, count: d.count })),
      training: training.map((t) => ({ module: mName.get(String(t._id)) ?? 'Module', completed: t.completed, started: t.started })),
      counselling: counselling.map((c) => ({ status: c._id, count: c.count })),
    });
  }),
);

// ------------------------------------------------------------------ users
adminRouter.get(
  '/users',
  requirePermission('users:manage'),
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = pageParams(req.query);
    const filter: Record<string, unknown> = {};
    if (req.query.role) filter.role = String(req.query.role);
    if (req.query.status) filter.accountStatus = String(req.query.status);
    if (req.query.q) {
      const q = escapeRegex(String(req.query.q).slice(0, 60));
      filter.$or = [{ fullName: { $regex: q, $options: 'i' } }, { email: { $regex: q, $options: 'i' } }, { studentId: { $regex: q, $options: 'i' } }];
    }
    // Ordinary admins cannot see or manage super admin accounts, and see only their own campuses.
    if (req.user!.role !== 'super_admin') {
      filter.role = filter.role && filter.role !== 'super_admin' ? filter.role : { $ne: 'super_admin' };
      filter.$and = [userCampusFilter(campusScopeOf(req.user!))]; // $and: the search's own $or stays intact
    }
    const [items, total] = await Promise.all([User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit), User.countDocuments(filter)]);
    ok(res, { items: items.map((u) => ({ ...publicUser(u), createdAt: u.createdAt, lastLoginAt: u.lastLoginAt, suspendedReason: u.suspendedReason })), total, page, limit });
  }),
);

adminRouter.post(
  '/users/invite',
  requirePermission('users:manage'),
  asyncHandler(async (req, res) => {
    const input = parse(userInviteSchema, req.body);
    if (!assignableRoles(req.user!.role as Role).includes(input.role)) throw new AppError(403, 'forbidden', 'You cannot invite accounts with that role.');
    if (!(await isDomainAllowed(input.email, 'staff'))) throw new AppError(422, 'validation_failed', 'That email domain is not approved for staff.', { fields: { email: 'Use an approved staff domain' } });
    if (await User.exists({ email: input.email })) throw new AppError(409, 'account_exists', 'An account with this email already exists.');
    const committees = input.committeeIds.length ? await Committee.find({ _id: { $in: input.committeeIds } }, { _id: 1 }).lean() : [];
    const user = await User.create({
      fullName: input.fullName, email: input.email, role: input.role, department: input.department ?? null, accountStatus: 'invited',
      invitedBy: req.user!._id, committeeMemberships: committees.map((c) => ({ committeeId: c._id, position: 'member' })),
    });
    const token = randomToken(32);
    await InviteToken.create({ userId: user._id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 7 * 86400_000) });
    await sendEmail('staff_invite', user.email, { name: user.fullName, role: input.role.replace('_', ' '), link: appLink(`/accept-invite?token=${encodeURIComponent(token)}`) });
    await audit({ action: 'user.invited', req, targetType: 'user', targetId: String(user._id), meta: { role: input.role } });
    ok(res, publicUser(user), 201);
  }),
);

async function loadManageableUser(actor: UserDoc, id: string) {
  if (!Types.ObjectId.isValid(id)) throw notFound();
  const target = await User.findById(id);
  if (!target) throw notFound();
  const actorRole = actor.role as Role;
  if (target.role === 'super_admin' && actorRole !== 'super_admin') throw notFound();
  if (actorRole === 'admin' && target.role === 'admin') throw new AppError(403, 'forbidden', 'Administrators cannot manage other administrators.');
  // Another campus's accounts do not exist as far as a Campus Admin is concerned.
  if (!inCampusScope(campusScopeOf(actor), target.campusZone)) throw notFound();
  return target;
}

adminRouter.post(
  '/users/:id/status',
  requirePermission('users:manage'),
  asyncHandler(async (req, res) => {
    const input = parse(userStatusSchema, req.body);
    const target = await loadManageableUser(req.user!, req.params.id);
    if (String(target._id) === String(req.user!._id)) throw new AppError(422, 'self', 'You cannot change your own account status.');
    if (input.action === 'suspend') {
      target.accountStatus = 'suspended';
      target.suspendedReason = input.reason;
      await target.save();
      // Sessions end now; a responder's open SOS alerts are handed to another eligible responder.
      await standDownAccount(target, { actorId: String(req.user!._id), reason: `suspended by campus admin: ${input.reason ?? 'no reason given'}`, req });
    } else {
      target.accountStatus = target.emailVerified && emailProofActivates(target) ? 'active' : 'pending_verification';
      target.suspendedReason = null;
      await target.save();
    }
    await audit({ action: input.action === 'suspend' ? 'user.suspended' : 'user.reactivated', req, targetType: 'user', targetId: String(target._id), meta: { reasonProvided: true } });
    ok(res, publicUser(target));
  }),
);

adminRouter.post(
  '/users/:id/resend-invite',
  requirePermission('users:manage'),
  asyncHandler(async (req, res) => {
    const target = await loadManageableUser(req.user!, req.params.id);
    if (target.accountStatus !== 'invited') throw new AppError(409, 'not_invited', 'This account is already active.');
    await InviteToken.updateMany({ userId: target._id, consumedAt: null }, { $set: { consumedAt: new Date() } });
    const token = randomToken(32);
    await InviteToken.create({ userId: target._id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 7 * 86400_000) });
    await sendEmail('staff_invite', target.email, { name: target.fullName, role: target.role.replace('_', ' '), link: appLink(`/accept-invite?token=${encodeURIComponent(token)}`) });
    await audit({ action: 'user.invite_resent', req, targetType: 'user', targetId: String(target._id) });
    ok(res, { ok: true });
  }),
);

adminRouter.post(
  '/users/:id/recovery',
  requirePermission('users:manage'),
  asyncHandler(async (req, res) => {
    const target = await loadManageableUser(req.user!, req.params.id);
    const { requestPasswordReset } = await import('../services/auth.service');
    await requestPasswordReset(target.email);
    await revokeAllSessions(String(target._id));
    await audit({ action: 'user.recovery_triggered', req, targetType: 'user', targetId: String(target._id) });
    ok(res, { ok: true, message: 'A password reset link was sent to the account email and all sessions were signed out.' });
  }),
);

adminRouter.get(
  '/users/export',
  requirePermission('users:manage'),
  asyncHandler(async (req, res) => {
    const scope = campusScopeOf(req.user!);
    const users = await User.find({ role: req.user!.role === 'super_admin' ? { $exists: true } : { $ne: 'super_admin' }, ...userCampusFilter(scope) }).limit(10000).lean();
    await audit({ action: 'user.exported', req, meta: { count: users.length, campuses: scope ?? 'all' } });
    const rows = [['name', 'email', 'role', 'status', 'studentId', 'department', 'createdAt']].concat(
      users.map((u) => [u.fullName, u.email, u.role, u.accountStatus, u.studentId ?? '', u.department ?? '', u.createdAt.toISOString()]),
    );
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""').replace(/^[=+\-@]/, "'$&")}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="campuscare-users.csv"');
    res.send(csv);
  }),
);

// ------------------------------------------------------------------ committees
adminRouter.get(
  '/committees',
  requirePermission('committees:manage'),
  asyncHandler(async (_req, res) => {
    const list = await Committee.find({}).sort({ name: 1 }).lean();
    const members = await User.find({ 'committeeMemberships.0': { $exists: true } }, { fullName: 1, email: 1, role: 1, committeeMemberships: 1, accountStatus: 1 }).lean();
    const workload = await Incident.aggregate([{ $match: { status: { $nin: ['resolved', 'closed', 'rejected'] } } }, { $group: { _id: '$committeeId', open: { $sum: 1 } } }]);
    const wl = new Map(workload.map((w) => [String(w._id), w.open]));
    ok(res, list.map((c) => ({
      ...c, id: String(c._id), openCases: wl.get(String(c._id)) ?? 0,
      members: members.filter((m) => m.committeeMemberships.some((cm) => String(cm.committeeId) === String(c._id))).map((m) => ({
        id: String(m._id), name: m.fullName, email: m.email, role: m.role, status: m.accountStatus,
        position: m.committeeMemberships.find((cm) => String(cm.committeeId) === String(c._id))?.position ?? 'member',
      })),
    })));
  }),
);

adminRouter.post(
  '/committees',
  requirePermission('committees:manage'),
  asyncHandler(async (req, res) => {
    const input = parse(committeeSchema, req.body);
    const c = await Committee.create({ ...input, contactEmail: input.contactEmail || null, contactPhone: input.contactPhone || null });
    await audit({ action: 'committee.created', req, targetType: 'committee', targetId: String(c._id) });
    ok(res, c, 201);
  }),
);

adminRouter.patch(
  '/committees/:id',
  requirePermission('committees:manage'),
  asyncHandler(async (req, res) => {
    const input = parse(committeeSchema.partial(), req.body);
    const c = await Committee.findByIdAndUpdate(req.params.id, { $set: input }, { new: true });
    if (!c) throw notFound();
    await audit({ action: 'committee.updated', req, targetType: 'committee', targetId: String(c._id), meta: { fields: Object.keys(input) } });
    ok(res, c);
  }),
);

adminRouter.post(
  '/committees/:id/members',
  requirePermission('committees:manage'),
  asyncHandler(async (req, res) => {
    const input = parse(committeeMemberSchema, req.body);
    const c = await Committee.findById(req.params.id);
    if (!c) throw notFound();
    const user = await User.findById(input.userId);
    if (!user || user.role === 'student' || user.role === 'super_admin') throw new AppError(422, 'invalid_member', 'Only staff accounts can be committee members.');
    user.committeeMemberships = user.committeeMemberships.filter((m) => String(m.committeeId) !== String(c._id)) as typeof user.committeeMemberships;
    user.committeeMemberships.push({ committeeId: c._id, position: input.position, since: new Date() });
    await user.save();
    await audit({ action: 'committee.member_added', req, targetType: 'committee', targetId: String(c._id), meta: { userId: String(user._id), position: input.position } });
    await notify({ userId: String(user._id), kind: 'committee', priority: 'high', title: `Added to ${c.name}`, body: `You are now a ${input.position} of ${c.name}.`, link: '/committee/cases' });
    ok(res, { ok: true });
  }),
);

adminRouter.delete(
  '/committees/:id/members/:userId',
  requirePermission('committees:manage'),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.userId);
    if (!user) throw notFound();
    user.committeeMemberships = user.committeeMemberships.filter((m) => String(m.committeeId) !== req.params.id) as typeof user.committeeMemberships;
    await user.save();
    // Cases owned by the removed member go back to the committee queue.
    await Incident.updateMany({ committeeId: req.params.id, assignedTo: user._id, status: { $nin: ['closed', 'rejected'] } }, { $set: { assignedTo: null } });
    await disconnectUser(String(user._id));
    await audit({ action: 'committee.member_removed', req, targetType: 'committee', targetId: req.params.id, meta: { userId: String(user._id) } });
    ok(res, { ok: true });
  }),
);

// ------------------------------------------------------------------ staff directory for assignment pickers
adminRouter.get(
  '/staff',
  asyncHandler(async (req, res) => {
    const filter: Record<string, unknown> = { role: { $in: ['committee_member', 'security_officer', 'counsellor', 'admin'] }, accountStatus: 'active' };
    if (req.query.committeeId && Types.ObjectId.isValid(String(req.query.committeeId))) filter['committeeMemberships.committeeId'] = new Types.ObjectId(String(req.query.committeeId));
    const staff = await User.find(filter, { fullName: 1, role: 1, email: 1 }).sort({ fullName: 1 }).lean();
    ok(res, staff.map((s) => ({ id: String(s._id), name: s.fullName, role: s.role, email: s.email })));
  }),
);

// ------------------------------------------------------------------ announcements, campus alerts, training, contacts
/** Campus Admins may change only announcements for campuses they manage (not "all campuses" ones). */
async function assertAnnouncementInScope(model: unknown, user: UserDoc, id: string) {
  if (model !== Announcement) return;
  const scope = campusScopeOf(user);
  if (scope === null || !Types.ObjectId.isValid(id)) return;
  const a = await Announcement.findById(id, { campus: 1 }).lean();
  if (a && (a.campus === 'all' || !inCampusScope(scope, a.campus))) throw new AppError(403, 'campus_out_of_scope', 'This announcement belongs to another campus or to every campus.');
}
function crud<T extends { create: Function }>(path: string, permission: Parameters<typeof requirePermission>[0], model: any, schema: any, label: string) {
  adminRouter.get(`/${path}`, requirePermission(permission), asyncHandler(async (_req, res) => {
    const list = await model.find({}).sort({ createdAt: -1 }).limit(500).lean();
    ok(res, list.map((x: any) => ({ ...x, id: String(x._id) })));
  }));
  adminRouter.post(`/${path}`, requirePermission(permission), asyncHandler(async (req, res) => {
    const input = parse(schema, req.body);
    // A Campus Admin's announcement is for their own campus, never every campus.
    const scope = campusScopeOf(req.user!);
    const campusOnly = model === Announcement && scope !== null ? { campus: scope[0] } : {};
    const doc = await model.create({ ...input, ...campusOnly, ...(model === Announcement || model === TrainingModule ? { authorId: req.user!._id } : {}) });
    await audit({ action: `${label}.created`, req, targetType: label, targetId: String(doc._id) });
    ok(res, doc, 201);
  }));
  adminRouter.patch(`/${path}/:id`, requirePermission(permission), asyncHandler(async (req, res) => {
    const input = parse(schema.partial ? schema.partial() : schema, req.body);
    await assertAnnouncementInScope(model, req.user!, req.params.id);
    const doc = await model.findByIdAndUpdate(req.params.id, { $set: input }, { new: true });
    if (!doc) throw notFound();
    await audit({ action: `${label}.updated`, req, targetType: label, targetId: String(doc._id) });
    ok(res, doc);
  }));
  adminRouter.delete(`/${path}/:id`, requirePermission(permission), asyncHandler(async (req, res) => {
    await assertAnnouncementInScope(model, req.user!, req.params.id);
    const doc = await model.findByIdAndDelete(req.params.id);
    if (!doc) throw notFound();
    await audit({ action: `${label}.deleted`, req, targetType: label, targetId: req.params.id });
    ok(res, { ok: true });
  }));
  return undefined as unknown as T;
}

crud('announcements', 'announcements:manage', Announcement, announcementSchema, 'announcement');
crud('training', 'training:manage', TrainingModule, trainingModuleSchema, 'training_module');
crud('contacts', 'contacts:manage', Contact, contactSchema, 'contact');

adminRouter.get(
  '/campus-alerts',
  requirePermission('campus_alerts:manage'),
  asyncHandler(async (_req, res) => {
    const alerts = await CampusAlert.find({}).sort({ createdAt: -1 }).limit(100).lean();
    const counts = await SafetyCheckIn.aggregate([{ $match: { alertId: { $in: alerts.map((a) => a._id) } } }, { $group: { _id: { a: '$alertId', s: '$status' }, n: { $sum: 1 } } }]);
    const map = new Map<string, { safe: number; need_help: number }>();
    for (const c of counts) {
      const k = String(c._id.a);
      const v = map.get(k) ?? { safe: 0, need_help: 0 };
      v[c._id.s as 'safe' | 'need_help'] = c.n;
      map.set(k, v);
    }
    ok(res, alerts.map((a) => ({ ...a, id: String(a._id), checkIns: map.get(String(a._id)) ?? { safe: 0, need_help: 0 } })));
  }),
);

adminRouter.post(
  '/campus-alerts',
  requirePermission('campus_alerts:manage'),
  asyncHandler(async (req, res) => {
    const input = parse(campusAlertSchema, req.body);
    const alert = await CampusAlert.create({ ...input, publishedBy: req.user!._id });
    const filter: Record<string, unknown> = { role: 'student', accountStatus: 'active' };
    if (!input.audience.all) {
      filter.$or = [
        ...(input.audience.hostels.length ? [{ hostel: { $in: input.audience.hostels } }] : []),
        ...(input.audience.departments.length ? [{ department: { $in: input.audience.departments } }] : []),
      ];
      if (!(filter.$or as unknown[]).length) throw new AppError(422, 'validation_failed', 'Choose who should receive this alert.');
    }
    const recipients = await User.find(filter, { _id: 1 }).limit(50000).lean();
    for (const r of recipients) {
      await notify({ userId: String(r._id), kind: 'campus_alert', priority: input.severity === 'emergency' ? 'critical' : input.severity === 'warning' ? 'high' : 'normal', title: input.title, body: input.body.slice(0, 300), link: '/student/dashboard' });
    }
    await audit({ action: 'campus_alert.published', req, targetType: 'campus_alert', targetId: String(alert._id), meta: { severity: input.severity, recipients: recipients.length } });
    ok(res, { ...alert.toObject(), id: String(alert._id), recipients: recipients.length }, 201);
  }),
);

adminRouter.delete(
  '/campus-alerts/:id',
  requirePermission('campus_alerts:manage'),
  asyncHandler(async (req, res) => {
    await CampusAlert.updateOne({ _id: req.params.id }, { $set: { expiresAt: new Date() } });
    await audit({ action: 'campus_alert.expired', req, targetType: 'campus_alert', targetId: req.params.id });
    ok(res, { ok: true });
  }),
);

// ------------------------------------------------------------------ audit logs & database activity tracking

function buildAuditFilter(query: Record<string, unknown>): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (query.action) filter.action = { $regex: '^' + escapeRegex(String(query.action)), $options: 'i' };
  if (query.collection) filter.collectionName = String(query.collection);
  if (query.operation) filter.operation = String(query.operation);
  if (query.severity) filter.severity = String(query.severity);
  if (query.source) filter.source = String(query.source);
  if (query.outcome) filter.outcome = String(query.outcome);
  if (query.actorId && Types.ObjectId.isValid(String(query.actorId))) filter.actorId = new Types.ObjectId(String(query.actorId));
  if (query.targetId) filter.targetId = String(query.targetId).slice(0, 64);
  if (query.correlationId) filter.correlationId = String(query.correlationId).slice(0, 64);

  if (query.from || query.to) {
    const atFilter: Record<string, Date> = {};
    if (query.from) atFilter.$gte = new Date(String(query.from));
    if (query.to) atFilter.$lte = new Date(String(query.to));
    filter.at = atFilter;
  }

  if (query.q) {
    const rx = { $regex: escapeRegex(String(query.q)), $options: 'i' };
    filter.$or = [
      { action: rx },
      { actorName: rx },
      { targetId: String(query.q) },
      { correlationId: String(query.q) },
      { reason: rx },
      { changedFields: String(query.q) },
    ];
  }

  return filter;
}

const auditListHandler = asyncHandler(async (req, res) => {
  const { page, limit, skip } = pageParams(req.query, 100);
  const filter = buildAuditFilter(req.query as Record<string, unknown>);

  const [items, total, metrics] = await Promise.all([
    AuditLog.find(filter).sort({ seq: -1 }).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(filter),
    getAuditMetrics(),
  ]);

  const actors = await User.find(
    { _id: { $in: items.map((i) => i.actorId).filter(Boolean) } },
    { fullName: 1, email: 1 },
  ).lean();
  const names = new Map(actors.map((a) => [String(a._id), a.fullName]));
  const emails = new Map(actors.map((a) => [String(a._id), a.email]));

  // Log viewing of audit logs (throttled to page 1)
  if (page === 1 && !req.query.q) {
    void audit({ action: 'audit.viewed', req, meta: { filterCount: Object.keys(filter).length } });
  }

  ok(res, {
    items: items.map((i) => ({
      id: String(i._id),
      seq: i.seq,
      at: i.at,
      action: i.action,
      collectionName: (i as any).collectionName || i.targetType || 'system',
      operation: (i as any).operation || 'update',
      severity: (i as any).severity || 'info',
      source: (i as any).source || 'app',
      correlated: (i as any).correlated ?? true,
      actor: i.actorId ? names.get(String(i.actorId)) ?? (i as any).actorName ?? 'User' : (i as any).actorName || 'System',
      actorEmail: i.actorId ? emails.get(String(i.actorId)) : null,
      actorRole: i.actorRole,
      actorType: (i as any).actorType || 'user',
      targetType: i.targetType,
      targetId: i.targetId,
      changedFields: (i as any).changedFields || [],
      diff: (i as any).diff || [],
      before: (i as any).before || null,
      after: (i as any).after || null,
      outcome: i.outcome,
      ipHash: i.ipHash,
      reason: i.reason ?? null,
      correlationId: i.correlationId ?? null,
      hash: i.hash,
      prevHash: i.prevHash,
    })),
    total,
    page,
    limit,
    metrics,
  });
});

adminRouter.get('/audit-logs', requirePermission('audit:read'), auditListHandler);
adminRouter.get('/audit/events', requirePermission('audit:read'), auditListHandler);

/**
 * Retrieve chronological before/after history for any specific database record ID.
 */
adminRouter.get(
  '/audit/records/:recordId/history',
  requirePermission('audit:read'),
  asyncHandler(async (req, res) => {
    const history = await getRecordHistory(req.params.recordId);
    ok(res, history);
  }),
);

/**
 * Health and diagnostics for audit logging and MongoDB change streams.
 */
adminRouter.get(
  '/audit/health',
  requirePermission('audit:read'),
  asyncHandler(async (_req, res) => {
    const watcher = getDbWatcherHealth();
    const integrity = await verifyAuditChain(200);
    const total = await AuditLog.countDocuments();
    ok(res, {
      status: watcher.status === 'error' ? 'degraded' : 'healthy',
      changeStream: watcher,
      integrity: { ok: integrity.ok, checked: integrity.checked, brokenAtSeq: integrity.brokenAtSeq },
      totalRecordedEvents: total,
    });
  }),
);

/**
 * Validates cryptographic chain integrity of the append-only audit log.
 */
adminRouter.get(
  '/audit-logs/verify',
  requirePermission('audit:read'),
  asyncHandler(async (_req, res) => ok(res, await verifyAuditChain())),
);

adminRouter.get(
  '/audit/integrity',
  requirePermission('audit:read'),
  asyncHandler(async (_req, res) => ok(res, await verifyAuditChain())),
);

/**
 * High-level audit metrics and distribution statistics.
 */
adminRouter.get(
  '/audit/metrics',
  requirePermission('audit:read'),
  asyncHandler(async (_req, res) => ok(res, await getAuditMetrics())),
);

/**
 * Export audit logs in CSV or JSON format with mandatory reason.
 */
adminRouter.post(
  '/audit/exports',
  requirePermission('audit:read'),
  asyncHandler(async (req, res) => {
    const { format = 'csv', reason, filters = {} } = req.body;
    if (!reason || String(reason).trim().length < 4) {
      throw new AppError(400, 'reason_required', 'A valid administrative justification (reason) is required for audit log exports.');
    }

    const filter = buildAuditFilter(filters);
    const items = await AuditLog.find(filter).sort({ seq: -1 }).limit(5000).lean();

    const actors = await User.find({ _id: { $in: items.map((i) => i.actorId).filter(Boolean) } }, { fullName: 1 }).lean();
    const names = new Map(actors.map((a) => [String(a._id), a.fullName]));

    const mapped = items.map((i) => ({
      seq: i.seq,
      at: i.at.toISOString(),
      action: i.action,
      collection: (i as any).collectionName || i.targetType || 'system',
      operation: (i as any).operation || 'update',
      actor: i.actorId ? names.get(String(i.actorId)) ?? (i as any).actorName ?? 'User' : (i as any).actorName || 'System',
      actorRole: i.actorRole || 'none',
      targetType: i.targetType || 'none',
      targetId: i.targetId || 'none',
      changedFields: ((i as any).changedFields || []).join('; '),
      outcome: i.outcome,
      severity: (i as any).severity || 'info',
      reason: i.reason || '',
      correlationId: i.correlationId || '',
      hash: i.hash,
    }));

    await audit({
      action: 'audit.exported',
      req,
      reason,
      severity: 'critical',
      meta: { format, recordCount: mapped.length, filters },
    });

    if (format === 'json') {
      ok(res, {
        filename: `campuscare-audit-${new Date().toISOString().slice(0, 10)}.json`,
        format: 'json',
        count: mapped.length,
        data: mapped,
      });
      return;
    }

    const headers = ['Seq', 'Timestamp', 'Action', 'Collection', 'Operation', 'Actor', 'ActorRole', 'TargetType', 'TargetId', 'ChangedFields', 'Outcome', 'Severity', 'Reason', 'CorrelationId', 'Hash'];
    const rows = mapped.map((m) => [
      m.seq,
      `"${m.at}"`,
      `"${m.action.replace(/"/g, '""')}"`,
      `"${m.collection.replace(/"/g, '""')}"`,
      `"${m.operation.replace(/"/g, '""')}"`,
      `"${m.actor.replace(/"/g, '""')}"`,
      `"${m.actorRole.replace(/"/g, '""')}"`,
      `"${m.targetType.replace(/"/g, '""')}"`,
      `"${m.targetId.replace(/"/g, '""')}"`,
      `"${m.changedFields.replace(/"/g, '""')}"`,
      `"${m.outcome.replace(/"/g, '""')}"`,
      `"${m.severity.replace(/"/g, '""')}"`,
      `"${m.reason.replace(/"/g, '""')}"`,
      `"${m.correlationId.replace(/"/g, '""')}"`,
      `"${m.hash.replace(/"/g, '""')}"`,
    ].join(','));

    const csvData = [headers.join(','), ...rows].join('\n');

    ok(res, {
      filename: `campuscare-audit-${new Date().toISOString().slice(0, 10)}.csv`,
      format: 'csv',
      count: mapped.length,
      data: csvData,
    });
  }),
);

adminRouter.get('/sessions/active-count', requirePermission('users:manage'), asyncHandler(async (_req, res) => {
  ok(res, { active: await Session.countDocuments({ revokedAt: null, expiresAt: { $gt: new Date() } }) });
}));


// ------------------------------------------------------------------ campus admin verifications
adminRouter.get(
  '/verifications/queue',
  requirePermission('users:manage'),
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = pageParams(req.query);
    const scope = campusScopeOf(req.user!);
    const campus = scope?.join(', ') ?? 'all';
    const filter: Record<string, unknown> = {
      ...userCampusFilter(scope),
      role: { $ne: 'super_admin' },
      verificationStatus: { $in: ['pending', 'submitted', 'under_review', 'needs_info'] },
    };
    if (req.query.role && req.query.role !== 'all' && req.query.role !== 'super_admin') {
      filter.role = String(req.query.role);
    }
    if (req.query.q) {
      const q = escapeRegex(String(req.query.q).slice(0, 60));
      filter.$and = [{ $or: [{ fullName: { $regex: q, $options: 'i' } }, { email: { $regex: q, $options: 'i' } }, { studentId: { $regex: q, $options: 'i' } }, { staffId: { $regex: q, $options: 'i' } }] }];
    }
    const [items, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      User.countDocuments(filter),
    ]);
    const uids = items.map((u) => u._id);
    const evidences = await VerificationEvidence.find({ userId: { $in: uids } }).sort({ createdAt: -1 }).lean();
    const evMap = new Map<string, any>();
    for (const ev of evidences) {
      const key = String(ev.userId);
      if (!evMap.has(key)) evMap.set(key, ev);
    }
    ok(res, {
      items: items.map((u) => ({
        ...publicUser(u),
        evidence: evMap.get(String(u._id)) ? {
          id: String(evMap.get(String(u._id))!._id),
          evidenceType: evMap.get(String(u._id))!.evidenceType,
          identifier: evMap.get(String(u._id))!.identifier,
          requestedRole: evMap.get(String(u._id))!.requestedRole,
          campus: evMap.get(String(u._id))!.campus,
          department: evMap.get(String(u._id))!.department,
          status: evMap.get(String(u._id))!.status,
          initialRecommendation: evMap.get(String(u._id))!.initialRecommendation ?? null,
          initialReviewNotes: evMap.get(String(u._id))!.initialReviewNotes ?? null,
          createdAt: evMap.get(String(u._id))!.createdAt,
        } : null,
      })),
      total,
      page,
      limit,
      campus,
    });
  }),
);

adminRouter.post(
  '/verifications/evidence/:id/initial-review',
  requirePermission('users:manage'),
  asyncHandler(async (req, res) => {
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound('Verification evidence not found.');
    const ev = await VerificationEvidence.findById(req.params.id);
    if (!ev) throw notFound('Verification evidence not found.');
    if (!inCampusScope(campusScopeOf(req.user!), ev.campus)) {
      throw new AppError(403, 'forbidden', 'You can only review applications for your assigned campus.');
    }
    if (String(ev.userId) === String(req.user!._id)) throw new AppError(403, 'forbidden', 'You cannot review your own application.');
    if (!['pending', 'under_review', 'more_info_required'].includes(ev.status)) {
      throw new AppError(409, 'already_decided', 'This application already has a final decision. Only a Super Admin can reopen it.');
    }
    const input = parse(z.object({
      recommendation: z.enum(['recommend_approval', 'recommend_rejection', 'needs_info']),
      notes: z.string().trim().min(3).max(1000),
    }), req.body);
    ev.initialReviewerId = req.user!._id;
    ev.initialReviewedAt = new Date();
    ev.initialReviewNotes = input.notes;
    ev.initialRecommendation = input.recommendation;
    ev.status = 'under_review';
    await ev.save();
    // Initial review only moves the case to "under review"; the final decision stays with the Super Admin.
    const applicant = await User.findById(ev.userId, { verificationStatus: 1 }).lean();
    const from = (applicant?.verificationStatus ?? 'pending') as StudentVerificationStatus;
    await User.updateOne({ _id: ev.userId }, { $set: {
      ...(canTransitionVerification(from, 'under_review') ? { verificationStatus: 'under_review' } : {}),
      verificationNotes: `[Campus Admin Note]: ${input.notes}`,
    } });
    await audit({
      action: 'verification.campus_initial_review',
      req,
      targetType: 'verification_evidence',
      targetId: String(ev._id),
      meta: { campus: ev.campus, recommendation: input.recommendation, notes: input.notes },
    });
    ok(res, { ok: true, evidenceId: String(ev._id), recommendation: input.recommendation });
  }),
);

adminRouter.get(
  '/verifications/evidence/:id/file',
  requirePermission('users:manage'),
  asyncHandler(async (req, res) => {
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound('Verification evidence file not found.');
    const ev = await VerificationEvidence.findById(req.params.id).select('+data');
    if (!ev || !ev.data) throw notFound('Verification evidence file not found.');
    if (!inCampusScope(campusScopeOf(req.user!), ev.campus)) {
      await audit({ action: 'verification.evidence_access_denied', req, outcome: 'denied', targetType: 'verification_evidence', targetId: String(ev._id) });
      throw new AppError(403, 'forbidden', 'You can only access files for your assigned campus.');
    }
    await audit({ action: 'verification.evidence_viewed', req, targetType: 'verification_evidence', targetId: String(ev._id), meta: { userId: String(ev.userId), campus: ev.campus } });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', ev.mime || 'image/jpeg');
    res.setHeader('Content-Length', ev.data.length);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.end(ev.data);
  }),
);
