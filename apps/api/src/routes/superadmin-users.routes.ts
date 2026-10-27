import { Router, type Request } from 'express';
import { Types } from 'mongoose';
import {
  ACCOUNT_STATUSES, ROLES, assignableRoles, userBulkActionSchema, userCommunityMuteSchema,
  userCounsellorApprovalSchema, userDutyAssignmentSchema, userInviteSchema, userProfileUpdateSchema,
  userRoleSchema, userStatusUpdateSchema, studentVerificationDecisionSchema, campusScopeAssignmentSchema, STUDENT_VERIFICATION_STATUSES, type AccountStatus, type Role, type StudentVerificationStatus,
} from '@campuscare/shared';
import { AppError, asyncHandler, escapeRegex, notFound, ok, pageParams, parse } from '../lib/http';
import { randomToken, sha256 } from '../lib/crypto';
import { InviteToken, Session, User, publicUser, type UserDoc } from '../models/user';
import { Committee, Incident } from '../models/incident';
import { ResponderAvailability, DutyStatusEvent, ResponseZone } from '../models/duty';
import { ChannelPublisher } from '../models/feed';
import { DataRequest } from '../models/community';
import { AuditLog } from '../models/platform';
import { requireAuth, requireMfaPolicy, requirePermission, requireRecentAuth } from '../middleware/auth';
import { audit } from '../services/audit.service';
import { appLink, sendEmail } from '../services/email/email.service';
import { isDomainAllowed, issueEmailVerification, requestPasswordReset, revokeAllSessions } from '../services/auth.service';
import { mfaStatus, removeTotp } from '../services/mfa.service';
import { ensureCounsellingChannel } from '../services/feed.service';
import { disconnectUser } from '../realtime/socket';

export const superAdminUsersRouter = Router();

// Guard all super admin user management routes:
superAdminUsersRouter.use(requireAuth, requirePermission('super_admin:access'), requireMfaPolicy);

/** Helper to validate MongoDB ObjectId or return 404 */
function checkObjectId(id: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) throw notFound('User not found.');
  return new Types.ObjectId(id);
}

/** Sanitize strings for CSV to prevent CSV Formula Injection (=, +, -, @, \t, \r) */
function sanitizeCsvValue(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val).replace(/"/g, '""');
  if (/^[=+\-@\t\r]/.test(str)) {
    return `"'${str}"`;
  }
  return `"${str}"`;
}

// ------------------------------------------------------------------ 1. Dashboard Metrics
superAdminUsersRouter.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400_000);

    const [
      total,
      active,
      suspended,
      deactivated,
      archived,
      invited,
      pendingVerification,
      recentlyRegistered,
      byRole,
      byDepartment,
      lockedAccounts,
      mfaCount,
      activeSessions,
      counsellorsPending,
      pendingStudentVerifications,
      verifiedStudents,
      unverifiedEmails,
      mustChangePasswordCount,
    ] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ accountStatus: 'active' }),
      User.countDocuments({ accountStatus: 'suspended' }),
      User.countDocuments({ accountStatus: 'deactivated' }),
      User.countDocuments({ accountStatus: 'archived' }),
      User.countDocuments({ accountStatus: 'invited' }),
      User.countDocuments({ accountStatus: 'pending_verification' }),
      User.countDocuments({ createdAt: { $gte: weekAgo } }),
      User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
      User.aggregate([
        { $match: { department: { $ne: null } } },
        { $group: { _id: '$department', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      User.countDocuments({ lockedUntil: { $gt: now } }),
      User.countDocuments({ mfaEnabled: true }),
      Session.countDocuments({ revokedAt: null, expiresAt: { $gt: now } }),
      User.countDocuments({ role: 'counsellor', counsellorApproved: false }),
      User.countDocuments({ role: 'student', verificationStatus: { $in: ['pending', 'under_review', 'needs_info'] } }),
      User.countDocuments({ role: 'student', verificationStatus: 'approved' }),
      User.countDocuments({ emailVerified: false }),
      User.countDocuments({ mustChangePassword: true }),
    ]);

    const roleMap: Record<string, number> = Object.fromEntries(byRole.map((r) => [r._id, r.count]));
    const deptMap: Record<string, number> = Object.fromEntries(byDepartment.map((d) => [d._id, d.count]));

    ok(res, {
      total,
      active,
      suspended,
      deactivated,
      archived,
      invited,
      pendingVerification,
      recentlyRegistered,
      lockedAccounts,
      mfaCount,
      activeSessions,
      counsellorsPending,
      pendingStudentVerifications,
      verifiedStudents,
      unverifiedEmails,
      mustChangePasswordCount,
      byRole: roleMap,
      topDepartments: deptMap,
    });
  }),
);

// ------------------------------------------------------------------ 2. Paginated User List with Filters
superAdminUsersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = pageParams(req.query);
    const filter: Record<string, unknown> = {};

    // Search query: fullName, email, studentId, or exact _id
    if (req.query.q) {
      const q = String(req.query.q).trim().slice(0, 80);
      if (Types.ObjectId.isValid(q)) {
        filter._id = new Types.ObjectId(q);
      } else {
        const regex = escapeRegex(q);
        filter.$or = [
          { fullName: { $regex: regex, $options: 'i' } },
          { email: { $regex: regex, $options: 'i' } },
          { studentId: { $regex: regex, $options: 'i' } },
          { department: { $regex: regex, $options: 'i' } },
        ];
      }
    }

    // Role filter
    if (req.query.role && ROLES.includes(req.query.role as Role)) {
      filter.role = req.query.role;
    }

    // Account status filter
    if (req.query.status && (ACCOUNT_STATUSES as readonly string[]).includes(String(req.query.status))) {
      filter.accountStatus = req.query.status;
    }

    // Verification status filter
    if (req.query.verification) {
      if (req.query.verification === 'email_verified') filter.emailVerified = true;
      else if (req.query.verification === 'email_unverified') filter.emailVerified = false;
      else if (req.query.verification === 'counsellor_approved') filter.counsellorApproved = true;
      else if (req.query.verification === 'counsellor_pending') {
        filter.role = 'counsellor';
        filter.counsellorApproved = false;
      }
    }

    if (req.query.verificationStatus && STUDENT_VERIFICATION_STATUSES.includes(req.query.verificationStatus as StudentVerificationStatus)) {
      filter.verificationStatus = req.query.verificationStatus;
    }

    if (req.query.campusZone) {
      filter.campusZone = String(req.query.campusZone);
    }

    // Department filter
    if (req.query.department) {
      filter.department = String(req.query.department);
    }

    // Committee filter
    if (req.query.committeeId && Types.ObjectId.isValid(String(req.query.committeeId))) {
      filter['committeeMemberships.committeeId'] = new Types.ObjectId(String(req.query.committeeId));
    }

    // Registration date filters
    if (req.query.dateFrom || req.query.dateTo) {
      const dateFilter: Record<string, Date> = {};
      if (req.query.dateFrom) dateFilter.$gte = new Date(String(req.query.dateFrom));
      if (req.query.dateTo) dateFilter.$lte = new Date(String(req.query.dateTo));
      filter.createdAt = dateFilter;
    }

    // Last activity filter
    if (req.query.lastActivity) {
      const now = Date.now();
      if (req.query.lastActivity === 'today') filter.lastLoginAt = { $gte: new Date(now - 86400_000) };
      else if (req.query.lastActivity === 'week') filter.lastLoginAt = { $gte: new Date(now - 7 * 86400_000) };
      else if (req.query.lastActivity === 'month') filter.lastLoginAt = { $gte: new Date(now - 30 * 86400_000) };
      else if (req.query.lastActivity === 'never') filter.lastLoginAt = null;
    }

    // Sorting
    const sortField = typeof req.query.sort === 'string' ? req.query.sort : 'createdAt';
    const sortOrder = req.query.order === 'asc' ? 1 : -1;
    const allowedSortFields = ['createdAt', 'lastLoginAt', 'fullName', 'email', 'role', 'accountStatus', 'department'];
    const sort: Record<string, 1 | -1> = allowedSortFields.includes(sortField) ? { [sortField]: sortOrder } : { createdAt: -1 };

    const [items, total] = await Promise.all([
      User.find(filter).sort(sort).skip(skip).limit(limit),
      User.countDocuments(filter),
    ]);

    ok(res, {
      items: items.map((u) => publicUser(u)),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit) || 1,
    });
  }),
);

// ------------------------------------------------------------------ Export User Data with Privacy Safeguards
superAdminUsersRouter.get(
  '/export',
  asyncHandler(async (req, res) => {
    const filter: Record<string, unknown> = {};
    if (req.query.role && ROLES.includes(req.query.role as Role)) filter.role = req.query.role;
    if (req.query.status && (ACCOUNT_STATUSES as readonly string[]).includes(String(req.query.status))) filter.accountStatus = req.query.status;
    if (req.query.department) filter.department = String(req.query.department);

    const users = await User.find(filter).sort({ createdAt: -1 }).limit(10000).lean();

    await audit({
      action: 'user.exported',
      req,
      meta: { count: users.length, filter },
    });

    const headers = [
      'User ID', 'Full Name', 'Institutional Email', 'Role', 'Account Status',
      'Email Verified', 'MFA Active', 'Student/Staff ID', 'Department',
      'Academic Year', 'Phone', 'Hostel', 'Campus Zone', 'Counsellor Verified',
      'Created At', 'Last Login At',
    ];

    const rows = [headers.join(',')].concat(
      users.map((u) =>
        [
          sanitizeCsvValue(String(u._id)),
          sanitizeCsvValue(u.fullName),
          sanitizeCsvValue(u.email),
          sanitizeCsvValue(u.role),
          sanitizeCsvValue(u.accountStatus),
          sanitizeCsvValue(u.emailVerified ? 'Yes' : 'No'),
          sanitizeCsvValue(u.mfaEnabled ? 'Yes' : 'No'),
          sanitizeCsvValue(u.studentId ?? ''),
          sanitizeCsvValue(u.department ?? ''),
          sanitizeCsvValue(u.academicYear ?? ''),
          sanitizeCsvValue(u.phone ?? ''),
          sanitizeCsvValue(u.hostel ?? ''),
          sanitizeCsvValue(u.campusZone ?? ''),
          sanitizeCsvValue(u.counsellorApproved ? 'Yes' : 'No'),
          sanitizeCsvValue(u.createdAt ? new Date(u.createdAt).toISOString() : ''),
          sanitizeCsvValue(u.lastLoginAt ? new Date(u.lastLoginAt).toISOString() : 'Never'),
        ].join(','),
      ),
    );

    const csvContent = rows.join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="campuscare-users-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csvContent);
  }),
);

// ------------------------------------------------------------------ 3. Detailed Profile Inspector
superAdminUsersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const uid = checkObjectId(req.params.id);
    const target = await User.findById(uid);
    if (!target) throw notFound('User not found.');

    const now = new Date();
    const [
      mfa,
      sessions,
      committeeDocs,
      availability,
      channelPublisher,
      reportedIncidentsCount,
      dataRequests,
    ] = await Promise.all([
      mfaStatus(String(target._id)),
      Session.find({ userId: target._id, revokedAt: null, expiresAt: { $gt: now } })
        .sort({ lastSeenAt: -1 })
        .limit(20)
        .lean(),
      Committee.find({ _id: { $in: target.committeeMemberships.map((m) => m.committeeId) } }, { name: 1, type: 1 }).lean(),
      ResponderAvailability.findOne({ userId: target._id }).lean(),
      ChannelPublisher.findOne({ userId: target._id, revokedAt: null }).lean(),
      Incident.countDocuments({ reporterId: target._id }),
      DataRequest.find({ userId: target._id }).sort({ createdAt: -1 }).limit(10).lean(),
    ]);

    const cMap = new Map(committeeDocs.map((c) => [String(c._id), c]));
    const committeesWithDetails = target.committeeMemberships.map((m) => ({
      committeeId: String(m.committeeId),
      position: m.position,
      since: m.since,
      name: cMap.get(String(m.committeeId))?.name ?? 'Unknown Committee',
      type: cMap.get(String(m.committeeId))?.type ?? 'other',
    }));

    ok(res, {
      user: publicUser(target),
      security: {
        mfa,
        failedLoginCount: target.failedLoginCount,
        lockedUntil: target.lockedUntil,
        passwordChangedAt: target.passwordChangedAt,
        lastLoginAt: target.lastLoginAt,
        activeSessionsCount: sessions.length,
        sessions: sessions.map((s) => ({
          id: String(s._id),
          client: s.client,
          deviceName: s.deviceName,
          userAgent: s.userAgent,
          ipHash: s.ipHash,
          mfaVerified: s.mfaVerified,
          createdAt: s.createdAt,
          lastSeenAt: s.lastSeenAt,
          expiresAt: s.expiresAt,
        })),
      },
      counsellor: {
        approved: target.counsellorApproved,
        approvedAt: target.counsellorApprovedAt,
        approvedBy: target.counsellorApprovedBy ? String(target.counsellorApprovedBy) : null,
        publishAllowed: target.counsellingPublishAllowed,
        isChannelPublisher: Boolean(channelPublisher),
        channelVerifiedAt: channelPublisher?.verifiedAt ?? null,
      },
      responder: availability
        ? {
            status: availability.status,
            statusBeforeStale: availability.statusBeforeStale,
            campus: availability.campus,
            zoneId: availability.zoneId ? String(availability.zoneId) : null,
            skills: availability.skills ?? [],
            responsibilities: availability.responsibilities ?? [],
            activeAssignmentCount: availability.activeAssignmentCount,
            lastHeartbeatAt: availability.lastHeartbeatAt,
            staleSince: availability.staleSince,
            isStale: Boolean(availability.staleSince),
          }
        : null,
      committees: committeesWithDetails,
      activity: {
        reportedIncidentsCount,
        dataRequests: dataRequests.map((d) => ({
          id: String(d._id),
          type: d.type,
          status: d.status,
          reason: d.reason,
          createdAt: d.createdAt,
          decidedAt: d.decidedAt,
        })),
      },
    });
  }),
);

// ------------------------------------------------------------------ 4. Edit Permitted Profile Fields
superAdminUsersRouter.patch(
  '/:id/profile',
  asyncHandler(async (req, res) => {
    const uid = checkObjectId(req.params.id);
    const target = await User.findById(uid);
    if (!target) throw notFound('User not found.');

    const input = parse(userProfileUpdateSchema, req.body);
    const before = {
      fullName: target.fullName,
      phone: target.phone,
      department: target.department,
      academicYear: target.academicYear,
      studentId: target.studentId,
      hostel: target.hostel,
      campusZone: target.campusZone,
      committeeMemberships: target.committeeMemberships,
    };

    if (input.fullName !== undefined) target.fullName = input.fullName;
    if (input.phone !== undefined) target.phone = input.phone;
    if (input.department !== undefined) target.department = input.department;
    if (input.academicYear !== undefined) target.academicYear = input.academicYear;
    if (input.studentId !== undefined) target.studentId = input.studentId;
    if (input.hostel !== undefined) target.hostel = input.hostel;
    if (input.campusZone !== undefined) target.campusZone = input.campusZone;
    if (input.committeeMemberships !== undefined) {
      target.set(
        'committeeMemberships',
        input.committeeMemberships.map((m) => ({
          committeeId: new Types.ObjectId(m.committeeId),
          position: m.position,
          since: new Date(),
        })),
      );
    }

    await target.save();

    await audit({
      action: 'user.profile_updated',
      req,
      targetType: 'user',
      targetId: String(target._id),
      meta: { before, after: input },
    });

    ok(res, publicUser(target));
  }),
);

// ------------------------------------------------------------------ 5. Role and Permissions Update (Guard: Last Super Admin & Self Demotion)
superAdminUsersRouter.patch(
  '/:id/role',
  requireRecentAuth,
  asyncHandler(async (req, res) => {
    const uid = checkObjectId(req.params.id);
    const target = await User.findById(uid);
    if (!target) throw notFound('User not found.');

    const input = parse(userRoleSchema, req.body);
    const isSelf = String(target._id) === String(req.user!._id);

    // Enforce separation of duties: administrators cannot change their own role or grant permissions to themselves
    if (isSelf) {
      throw new AppError(422, 'self_role_change_forbidden', 'Administrators cannot change their own role or grant permissions to themselves.');
    }

    // Prevent demoting the last active Super Admin
    if (target.role === 'super_admin' && input.role !== 'super_admin') {
      const activeSuperAdmins = await User.countDocuments({
        role: 'super_admin',
        accountStatus: 'active',
        _id: { $ne: target._id },
      });
      if (activeSuperAdmins < 1) {
        throw new AppError(422, 'last_super_admin_protected', 'Cannot remove or demote the last active Super Admin.');
      }
    }

    const beforeRole = target.role;
    const beforePerms = target.permissions ?? [];

    target.role = input.role;
    target.permissions = input.permissions;
    await target.save();

    // Revoke sessions & disconnect so the role change takes effect immediately on all clients
    await revokeAllSessions(String(target._id));
    await disconnectUser(String(target._id));

    await audit({
      action: 'user.role_changed',
      req,
      targetType: 'user',
      targetId: String(target._id),
      reason: input.reason,
      meta: {
        before: { role: beforeRole, permissions: beforePerms },
        after: { role: input.role, permissions: input.permissions },
      },
    });

    ok(res, publicUser(target));
  }),
);

// ------------------------------------------------------------------ 6. Account Status Lifecycle (Suspend, Reactivate, Deactivate, Archive, Verify Email)
superAdminUsersRouter.post(
  '/:id/status',
  requireRecentAuth,
  asyncHandler(async (req, res) => {
    const uid = checkObjectId(req.params.id);
    const target = await User.findById(uid);
    if (!target) throw notFound('User not found.');

    const input = parse(userStatusUpdateSchema, req.body);
    const isSelf = String(target._id) === String(req.user!._id);

    // Prevent self-suspension or deactivation
    if (isSelf && ['suspend', 'deactivate', 'archive'].includes(input.action)) {
      throw new AppError(422, 'self_action_forbidden', 'You cannot suspend, deactivate, or archive your own account.');
    }

    // Prevent suspension or deactivation of the last active Super Admin
    if (target.role === 'super_admin' && ['suspend', 'deactivate', 'archive'].includes(input.action)) {
      const activeSuperAdmins = await User.countDocuments({
        role: 'super_admin',
        accountStatus: 'active',
        _id: { $ne: target._id },
      });
      if (activeSuperAdmins < 1) {
        throw new AppError(422, 'last_super_admin_protected', 'Cannot suspend, deactivate, or archive the last active Super Admin.');
      }
    }

    const beforeStatus = target.accountStatus;
    const now = new Date();

    if (input.action === 'suspend') {
      if (!input.reason || input.reason.trim().length < 3) {
        throw new AppError(422, 'reason_required', 'A valid reason is required for account suspension.');
      }
      target.accountStatus = 'suspended';
      target.suspendedReason = input.reason;
      target.suspendedAt = now;
      target.suspendedBy = req.user!._id;
      target.suspendedUntil = input.reviewDate ?? null;

      // Revoke sessions and real-time connections
      await revokeAllSessions(String(target._id));
      await disconnectUser(String(target._id));

      // Handover emergency duties if responder
      if (target.role === 'security_officer' || target.responderEligible) {
        const avail = await ResponderAvailability.findOne({ userId: target._id });
        if (avail && avail.status !== 'off_duty') {
          const fromStatus = avail.status;
          avail.status = 'off_duty';
          avail.statusBeforeStale = null;
          avail.staleSince = null;
          await avail.save();
          await DutyStatusEvent.create({
            userId: target._id,
            from: fromStatus,
            to: 'off_duty',
            actor: 'supervisor',
            actorId: req.user!._id,
            reason: `Account suspended: ${input.reason}`,
          });
        }
      }
    } else if (input.action === 'deactivate') {
      if (!input.reason || input.reason.trim().length < 3) {
        throw new AppError(422, 'reason_required', 'A reason is required to deactivate an account.');
      }
      target.accountStatus = 'deactivated';
      target.deactivatedAt = now;
      target.deactivatedBy = req.user!._id;
      target.suspendedReason = input.reason;

      await revokeAllSessions(String(target._id));
      await disconnectUser(String(target._id));
    } else if (input.action === 'archive') {
      if (!input.reason || input.reason.trim().length < 3) {
        throw new AppError(422, 'reason_required', 'A reason is required to archive an account.');
      }
      target.accountStatus = 'archived';
      target.archivedAt = now;
      target.archivedBy = req.user!._id;
      target.suspendedReason = input.reason;

      await revokeAllSessions(String(target._id));
      await disconnectUser(String(target._id));
    } else if (input.action === 'reactivate') {
      target.accountStatus = target.emailVerified ? 'active' : 'pending_verification';
      target.suspendedReason = null;
      target.suspendedAt = null;
      target.suspendedBy = null;
      target.suspendedUntil = null;
      target.deactivatedAt = null;
      target.deactivatedBy = null;
      target.archivedAt = null;
      target.archivedBy = null;
    } else if (input.action === 'verify_email') {
      target.emailVerified = true;
      target.emailVerifiedAt = now;
      if (target.accountStatus === 'pending_verification') {
        target.accountStatus = 'active';
      }
    }

    await target.save();

    await audit({
      action: `user.${input.action}`,
      req,
      targetType: 'user',
      targetId: String(target._id),
      reason: input.reason ?? null,
      meta: { before: beforeStatus, after: target.accountStatus, reviewDate: input.reviewDate ?? null },
    });

    ok(res, publicUser(target));
  }),
);

// ------------------------------------------------------------------ 7. Counsellor Approval & Official Channel Publishing
superAdminUsersRouter.post(
  '/:id/verify-counsellor',
  asyncHandler(async (req, res) => {
    const uid = checkObjectId(req.params.id);
    const target = await User.findById(uid);
    if (!target) throw notFound('User not found.');

    const input = parse(userCounsellorApprovalSchema, req.body);
    target.counsellorApproved = input.approved;
    target.counsellorApprovedAt = new Date();
    target.counsellorApprovedBy = req.user!._id;

    if (input.publishAllowed !== undefined) {
      target.counsellingPublishAllowed = input.publishAllowed;
      const channel = await ensureCounsellingChannel();
      if (input.publishAllowed) {
        await ChannelPublisher.findOneAndUpdate(
          { channelId: channel._id, userId: target._id },
          {
            $set: {
              verifiedBy: req.user!._id,
              verifiedAt: new Date(),
              note: input.note ?? null,
              revokedAt: null,
              revokedBy: null,
            },
            $setOnInsert: { channelId: channel._id, userId: target._id },
          },
          { upsert: true },
        );
      } else {
        await ChannelPublisher.updateOne(
          { channelId: channel._id, userId: target._id, revokedAt: null },
          { $set: { revokedAt: new Date(), revokedBy: req.user!._id } },
        );
      }
    }

    await target.save();

    await audit({
      action: 'user.counsellor_approval_updated',
      req,
      targetType: 'user',
      targetId: String(target._id),
      reason: input.note ?? null,
      meta: { approved: input.approved, publishAllowed: target.counsellingPublishAllowed },
    });

    ok(res, publicUser(target));
  }),
);

// ------------------------------------------------------------------ 8. Resend Email Verification or Staff Invitation
superAdminUsersRouter.post(
  '/:id/resend-verification',
  asyncHandler(async (req, res) => {
    const uid = checkObjectId(req.params.id);
    const target = await User.findById(uid);
    if (!target) throw notFound('User not found.');

    if (target.accountStatus === 'invited') {
      await InviteToken.updateMany({ userId: target._id, consumedAt: null }, { $set: { consumedAt: new Date() } });
      const token = randomToken(32);
      await InviteToken.create({
        userId: target._id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 7 * 86400_000),
      });
      await sendEmail('staff_invite', target.email, {
        name: target.fullName,
        role: target.role.replace('_', ' '),
        link: appLink(`/accept-invite?token=${encodeURIComponent(token)}`),
      });
      await audit({ action: 'user.invite_resent', req, targetType: 'user', targetId: String(target._id) });
      return ok(res, { message: 'Invitation resent successfully.' });
    }

    if (target.emailVerified) {
      throw new AppError(409, 'already_verified', 'This user email is already verified.');
    }

    await issueEmailVerification(target); // supersedes older links; same TTL and template as self-service

    await audit({ action: 'user.verification_resent', req, targetType: 'user', targetId: String(target._id) });
    ok(res, { message: 'Verification email resent successfully.' });
  }),
);

// ------------------------------------------------------------------ 9. Force Password Reset
superAdminUsersRouter.post(
  '/:id/force-password-reset',
  requireRecentAuth,
  asyncHandler(async (req, res) => {
    const uid = checkObjectId(req.params.id);
    const target = await User.findById(uid);
    if (!target) throw notFound('User not found.');

    const outcome = await requestPasswordReset(target.email, { ignoreAccountLimit: true });
    await revokeAllSessions(String(target._id));
    await disconnectUser(String(target._id));

    await audit({ action: 'user.password_reset_forced', req, targetType: 'user', targetId: String(target._id), meta: { outcome } });
    ok(res, {
      message: outcome === 'queued'
        ? 'Password reset link queued for delivery and all active sessions revoked. Check Email deliveries for the result.'
        : 'All active sessions revoked. No reset link was sent because this account cannot reset its password (suspended, invited, deactivated or archived).',
      outcome,
    });
  }),
);

// ------------------------------------------------------------------ 10. Revoke All Sessions & Sign Out Everywhere
superAdminUsersRouter.post(
  '/:id/revoke-sessions',
  requireRecentAuth,
  asyncHandler(async (req, res) => {
    const uid = checkObjectId(req.params.id);
    const target = await User.findById(uid);
    if (!target) throw notFound('User not found.');

    await revokeAllSessions(String(target._id));
    await disconnectUser(String(target._id));

    await audit({ action: 'user.sessions_revoked', req, targetType: 'user', targetId: String(target._id) });
    ok(res, { message: 'All active sessions have been revoked.' });
  }),
);

// ------------------------------------------------------------------ 11. Reset MFA / Require Re-enrollment
superAdminUsersRouter.post(
  '/:id/reset-mfa',
  requireRecentAuth,
  asyncHandler(async (req, res) => {
    const uid = checkObjectId(req.params.id);
    const target = await User.findById(uid);
    if (!target) throw notFound('User not found.');

    await removeTotp(String(target._id));
    await revokeAllSessions(String(target._id));
    await disconnectUser(String(target._id));

    await sendEmail('security_alert', target.email, {
      name: target.fullName,
      message: 'Your two-factor authentication (MFA) has been reset by a Super Admin. You will be prompted to re-enroll two-factor authentication on your next sign-in.',
    });

    await audit({ action: 'user.mfa_reset', req, targetType: 'user', targetId: String(target._id) });
    ok(res, { message: 'Two-factor authentication reset. The user was signed out and must re-enroll.' });
  }),
);

// ------------------------------------------------------------------ 12. Security Events for Individual User
superAdminUsersRouter.get(
  '/:id/security-events',
  asyncHandler(async (req, res) => {
    const uid = checkObjectId(req.params.id);
    const target = await User.findById(uid);
    if (!target) throw notFound('User not found.');

    const since = new Date(Date.now() - 30 * 86400_000);
    const events = await AuditLog.find({
      at: { $gte: since },
      $or: [
        { targetId: String(target._id) },
        { actorId: target._id },
        { 'meta.email': target.email },
      ],
      action: {
        $in: [
          'auth.login', 'auth.login_failed', 'auth.logout', 'auth.password_changed',
          'auth.mfa_verified', 'auth.mfa_failed', 'auth.reauth_failed', 'access.denied',
          'user.suspended', 'user.reactivated', 'user.sessions_revoked', 'user.mfa_reset',
        ],
      },
    })
      .sort({ at: -1 })
      .limit(50)
      .lean();

    ok(res, {
      events: events.map((e) => ({
        id: String(e._id),
        action: e.action,
        at: e.at,
        outcome: e.outcome,
        ipHash: e.ipHash,
        userAgent: (e.meta as Record<string, unknown>)?.userAgent ? String((e.meta as Record<string, unknown>).userAgent) : null,
        targetType: e.targetType,
      })),
    });
  }),
);

// ------------------------------------------------------------------ 13. Community Posting & Moderation Permissions
superAdminUsersRouter.post(
  '/:id/community-permissions',
  asyncHandler(async (req, res) => {
    const uid = checkObjectId(req.params.id);
    const target = await User.findById(uid);
    if (!target) throw notFound('User not found.');

    const input = parse(userCommunityMuteSchema, req.body);
    target.communityMuted = input.muted;
    target.communityMutedReason = input.reason ?? null;
    target.communityMutedUntil = input.until ?? null;
    await target.save();

    await audit({
      action: 'user.community_permissions_updated',
      req,
      targetType: 'user',
      targetId: String(target._id),
      reason: input.reason ?? null,
      meta: { muted: input.muted, until: input.until ?? null },
    });

    ok(res, publicUser(target));
  }),
);

// ------------------------------------------------------------------ 14. Emergency & Responder Duty Assignment
superAdminUsersRouter.post(
  '/:id/duty-assignment',
  asyncHandler(async (req, res) => {
    const uid = checkObjectId(req.params.id);
    const target = await User.findById(uid);
    if (!target) throw notFound('User not found.');

    const input = parse(userDutyAssignmentSchema, req.body);
    if (input.eligible !== undefined) target.responderEligible = input.eligible;
    if (input.zoneId) target.dutyZone = String(input.zoneId);
    await target.save();

    const update: Record<string, unknown> = {
      approvedBy: req.user!._id,
      campus: input.campus,
    };
    if (input.skills) update.skills = input.skills;
    if (input.responsibilities) update.responsibilities = input.responsibilities;
    if (input.zoneId !== undefined) update.zoneId = input.zoneId ? new Types.ObjectId(input.zoneId) : null;

    const avail = await ResponderAvailability.findOneAndUpdate(
      { userId: target._id },
      { $set: update, $setOnInsert: { userId: target._id, status: 'off_duty' } },
      { upsert: true, new: true },
    );

    await audit({
      action: 'user.duty_assignment_updated',
      req,
      targetType: 'user',
      targetId: String(target._id),
      meta: { skills: avail.skills, responsibilities: avail.responsibilities, campus: avail.campus, zoneId: avail.zoneId },
    });

    ok(res, {
      responderEligible: target.responderEligible,
      dutyZone: target.dutyZone,
      availability: {
        status: avail.status,
        skills: avail.skills,
        responsibilities: avail.responsibilities,
        campus: avail.campus,
        zoneId: avail.zoneId ? String(avail.zoneId) : null,
      },
    });
  }),
);

// ------------------------------------------------------------------ 15. Audit History for Specific User
superAdminUsersRouter.get(
  '/:id/audit-history',
  asyncHandler(async (req, res) => {
    const uid = checkObjectId(req.params.id);
    const { page, limit, skip } = pageParams(req.query);

    const filter = {
      $or: [
        { targetId: String(uid) },
        { actorId: uid },
      ],
    };

    const [items, total] = await Promise.all([
      AuditLog.find(filter).sort({ at: -1 }).skip(skip).limit(limit).lean(),
      AuditLog.countDocuments(filter),
    ]);

    ok(res, {
      items: items.map((a) => ({
        id: String(a._id),
        action: a.action,
        actorRole: a.actorRole,
        actorId: a.actorId ? String(a.actorId) : null,
        targetType: a.targetType,
        targetId: a.targetId,
        at: a.at,
        reason: a.reason,
        outcome: a.outcome,
        meta: a.meta,
      })),
      total,
      page,
      limit,
    });
  }),
);

// ------------------------------------------------------------------ 16. Bulk User Actions with Validation & Partial Failure Reporting
superAdminUsersRouter.post(
  '/bulk',
  requireRecentAuth,
  asyncHandler(async (req, res) => {
    const input = parse(userBulkActionSchema, req.body);
    const callerId = String(req.user!._id);
    const results: { userId: string; success: boolean; message: string }[] = [];
    let successCount = 0;
    let failureCount = 0;

    for (const uidStr of input.userIds) {
      try {
        if (!Types.ObjectId.isValid(uidStr)) {
          results.push({ userId: uidStr, success: false, message: 'Invalid user ID' });
          failureCount++;
          continue;
        }

        const target = await User.findById(uidStr);
        if (!target) {
          results.push({ userId: uidStr, success: false, message: 'User not found' });
          failureCount++;
          continue;
        }

        // Prevent self-action on destructive operations
        if (String(target._id) === callerId && ['suspend', 'deactivate', 'archive'].includes(input.action)) {
          results.push({ userId: uidStr, success: false, message: 'Cannot apply action to your own account' });
          failureCount++;
          continue;
        }

        // Protect last Super Admin
        if (target.role === 'super_admin' && (['suspend', 'deactivate', 'archive'].includes(input.action) || (input.action === 'assign_role' && input.role !== 'super_admin'))) {
          const activeSuperAdmins = await User.countDocuments({
            role: 'super_admin',
            accountStatus: 'active',
            _id: { $ne: target._id },
          });
          if (activeSuperAdmins < 1) {
            results.push({ userId: uidStr, success: false, message: 'Cannot modify or suspend the last active Super Admin' });
            failureCount++;
            continue;
          }
        }

        if (input.action === 'suspend') {
          target.accountStatus = 'suspended';
          target.suspendedReason = input.reason ?? 'Bulk suspension by Super Admin';
          target.suspendedAt = new Date();
          target.suspendedBy = req.user!._id;
          await target.save();
          await revokeAllSessions(String(target._id));
          await disconnectUser(String(target._id));
        } else if (input.action === 'reactivate') {
          target.accountStatus = target.emailVerified ? 'active' : 'pending_verification';
          target.suspendedReason = null;
          target.suspendedAt = null;
          target.suspendedBy = null;
          await target.save();
        } else if (input.action === 'deactivate') {
          target.accountStatus = 'deactivated';
          target.deactivatedAt = new Date();
          target.deactivatedBy = req.user!._id;
          target.suspendedReason = input.reason ?? 'Bulk deactivation';
          await target.save();
          await revokeAllSessions(String(target._id));
          await disconnectUser(String(target._id));
        } else if (input.action === 'archive') {
          target.accountStatus = 'archived';
          target.archivedAt = new Date();
          target.archivedBy = req.user!._id;
          target.suspendedReason = input.reason ?? 'Bulk archiving';
          await target.save();
          await revokeAllSessions(String(target._id));
          await disconnectUser(String(target._id));
        } else if (input.action === 'verify_email') {
          target.emailVerified = true;
          target.emailVerifiedAt = new Date();
          if (target.accountStatus === 'pending_verification') target.accountStatus = 'active';
          await target.save();
        } else if (input.action === 'revoke_sessions') {
          await revokeAllSessions(String(target._id));
          await disconnectUser(String(target._id));
        } else if (input.action === 'assign_role') {
          if (!input.role) throw new Error('Role must be specified');
          target.role = input.role;
          await target.save();
          await revokeAllSessions(String(target._id));
          await disconnectUser(String(target._id));
        } else if (input.action === 'assign_department') {
          target.department = input.department ?? null;
          await target.save();
        }

        results.push({ userId: uidStr, success: true, message: 'Action completed successfully' });
        successCount++;
      } catch (err) {
        results.push({ userId: uidStr, success: false, message: (err as Error).message });
        failureCount++;
      }
    }

    await audit({
      action: 'user.bulk_action',
      req,
      meta: {
        action: input.action,
        requestedCount: input.userIds.length,
        successCount,
        failureCount,
        reason: input.reason ?? null,
      },
    });

    ok(res, {
      requestedCount: input.userIds.length,
      successCount,
      failureCount,
      results,
    });
  }),
);

// ------------------------------------------------------------------ 17. Student Manual Enrollment Verification Workflow
superAdminUsersRouter.post(
  '/:id/verify-enrollment',
  requireRecentAuth,
  asyncHandler(async (req, res) => {
    const uid = checkObjectId(req.params.id);
    const target = await User.findById(uid);
    if (!target) throw notFound('User not found.');

    const input = parse(studentVerificationDecisionSchema, req.body);
    const beforeStatus = target.verificationStatus ?? 'pending';

    target.verificationStatus = input.status;
    target.verificationReviewedAt = new Date();
    target.verificationReviewedBy = req.user!._id;
    target.verificationReason = input.reason ?? null;
    target.verificationNotes = input.notes ?? null;

    if (input.status === 'approved' && target.accountStatus === 'pending_verification') {
      target.accountStatus = 'active';
    }

    await target.save();

    await audit({
      action: 'user.verification_decided',
      req,
      targetType: 'user',
      targetId: String(target._id),
      reason: input.reason ?? null,
      meta: { before: beforeStatus, after: input.status, notes: input.notes ?? null },
    });

    ok(res, publicUser(target));
  }),
);

// ------------------------------------------------------------------ 18. Verification Queue with Duplicate ID Detection
superAdminUsersRouter.get(
  '/verifications/queue',
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = pageParams(req.query);
    const filter: Record<string, unknown> = { role: 'student' };

    if (req.query.status && STUDENT_VERIFICATION_STATUSES.includes(req.query.status as StudentVerificationStatus)) {
      filter.verificationStatus = req.query.status;
    } else {
      filter.verificationStatus = { $in: ['pending', 'under_review', 'needs_info'] };
    }

    if (req.query.q) {
      const q = String(req.query.q).trim().slice(0, 80);
      const regex = escapeRegex(q);
      filter.$or = [
        { fullName: { $regex: regex, $options: 'i' } },
        { email: { $regex: regex, $options: 'i' } },
        { studentId: { $regex: regex, $options: 'i' } },
        { department: { $regex: regex, $options: 'i' } },
      ];
    }

    const [items, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      User.countDocuments(filter),
    ]);

    // Check duplicate student IDs
    const studentIds = items.map((u) => u.studentId).filter((id): id is string => Boolean(id));
    const duplicates = await User.aggregate([
      { $match: { studentId: { $in: studentIds } } },
      { $group: { _id: '$studentId', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ]);
    const duplicateIds = new Set(duplicates.map((d) => d._id));

    ok(res, {
      items: items.map((u) => ({
        ...publicUser(u),
        isDuplicateStudentId: u.studentId ? duplicateIds.has(u.studentId) : false,
      })),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit) || 1,
    });
  }),
);

// ------------------------------------------------------------------ 19. Force Password Change on Next Login
superAdminUsersRouter.post(
  '/:id/force-password-change',
  requireRecentAuth,
  asyncHandler(async (req, res) => {
    const uid = checkObjectId(req.params.id);
    const target = await User.findById(uid);
    if (!target) throw notFound('User not found.');

    target.mustChangePassword = true;
    await target.save();

    await revokeAllSessions(String(target._id));
    await disconnectUser(String(target._id));

    await audit({ action: 'user.password_change_forced', req, targetType: 'user', targetId: String(target._id) });
    ok(res, { message: 'Password change forced on next login. Existing sessions revoked.' });
  }),
);

// ------------------------------------------------------------------ 20. Unlock Account Lockout
superAdminUsersRouter.post(
  '/:id/unlock',
  requireRecentAuth,
  asyncHandler(async (req, res) => {
    const uid = checkObjectId(req.params.id);
    const target = await User.findById(uid);
    if (!target) throw notFound('User not found.');

    target.failedLoginCount = 0;
    target.lockedUntil = null;
    await target.save();

    await audit({ action: 'user.unlocked', req, targetType: 'user', targetId: String(target._id) });
    ok(res, { message: 'Account unlocked successfully.' });
  }),
);

// ------------------------------------------------------------------ 21. Campus Admin Scope & Delegation
superAdminUsersRouter.post(
  '/:id/campus-scope',
  requireRecentAuth,
  asyncHandler(async (req, res) => {
    const uid = checkObjectId(req.params.id);
    const target = await User.findById(uid);
    if (!target) throw notFound('User not found.');

    const input = parse(campusScopeAssignmentSchema, req.body);
    target.managedCampuses = input.managedCampuses;
    target.campusZone = input.campusZone ?? null;
    await target.save();

    await audit({
      action: 'user.campus_scope_updated',
      req,
      targetType: 'user',
      targetId: String(target._id),
      meta: { managedCampuses: input.managedCampuses, campusZone: input.campusZone },
    });

    ok(res, publicUser(target));
  }),
);

// ------------------------------------------------------------------ 22. Active Sessions Across Ecosystem
superAdminUsersRouter.get(
  '/sessions/active',
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = pageParams(req.query);
    const now = new Date();

    const [sessions, total] = await Promise.all([
      Session.find({ revokedAt: null, expiresAt: { $gt: now } })
        .sort({ lastSeenAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Session.countDocuments({ revokedAt: null, expiresAt: { $gt: now } }),
    ]);

    const userIds = [...new Set(sessions.map((s) => s.userId))];
    const users = await User.find({ _id: { $in: userIds } }, { fullName: 1, email: 1, role: 1, accountStatus: 1 }).lean();
    const uMap = new Map(users.map((u) => [String(u._id), u]));

    ok(res, {
      items: sessions.map((s) => ({
        id: String(s._id),
        userId: String(s.userId),
        user: uMap.get(String(s.userId)) ?? null,
        client: s.client,
        deviceName: s.deviceName,
        userAgent: s.userAgent,
        ipHash: s.ipHash,
        mfaVerified: s.mfaVerified,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        expiresAt: s.expiresAt,
      })),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit) || 1,
    });
  }),
);

// ------------------------------------------------------------------ 23. Revoke Individual Session
superAdminUsersRouter.delete(
  '/sessions/:sessionId',
  requireRecentAuth,
  asyncHandler(async (req, res) => {
    const sid = checkObjectId(req.params.sessionId);
    const session = await Session.findById(sid);
    if (!session) throw notFound('Session not found.');

    session.revokedAt = new Date();
    await session.save();

    await audit({
      action: 'session.revoked',
      req,
      targetType: 'session',
      targetId: String(session._id),
      meta: { userId: String(session.userId) },
    });

    ok(res, { message: 'Session revoked successfully.' });
  }),
);
