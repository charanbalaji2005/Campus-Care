import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { AppError, asyncHandler, notFound, ok, parse } from '../lib/http';
import { requireAuth } from '../middleware/auth';
import { CaseActivity, Evidence, Incident } from '../models/incident';
import { EmergencyAlert } from '../models/safety';
import { User } from '../models/user';
import { audit } from '../services/audit.service';
import { notify, notifyMany } from '../services/notification.service';
import { onDutySecurityOfficers } from '../services/duty.service';
import { CATEGORY_INFO, STATUS_LABELS, type IncidentCategory, type IncidentStatus } from '@campuscare/shared';
import { randomUUID } from 'node:crypto';
import { ChatMessage } from '../models/chat';
import { resolveOrCreateStaffChannel } from '../services/chat.service';

export const committeePortalRouter = Router();
committeePortalRouter.use(requireAuth);

const requireCommitteeAccess = asyncHandler(async (req, _res, next) => {
  const user = req.user!;
  const isCommittee = user.role === 'committee_member' || user.role === 'admin' || user.role === 'super_admin' || (user.permissions?.includes('incidents:read_committee') ?? false);
  if (!isCommittee) {
    throw new AppError(403, 'forbidden', 'Access restricted to Committee Members.');
  }
  next();
});

committeePortalRouter.use(requireCommitteeAccess);

// ==============================================================================
// 1. Committee Dashboard (Screen 1)
// ==============================================================================
committeePortalRouter.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const [newCount, underReview, inProgress, resolved, urgentCount, recent] = await Promise.all([
      Incident.countDocuments({ status: 'submitted' }),
      Incident.countDocuments({ status: { $in: ['in_review', 'under_review', 'acknowledged'] } }),
      Incident.countDocuments({ status: { $in: ['investigating', 'in_progress', 'action_required', 'escalated'] } }),
      Incident.countDocuments({ status: 'resolved' }),
      Incident.countDocuments({ urgent: true, status: { $nin: ['resolved', 'closed', 'rejected', 'withdrawn'] } }),
      Incident.find({})
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
    ]);

    const totalResolvedOrClosed = await Incident.countDocuments({ status: { $in: ['resolved', 'closed'] } });
    const totalAll = await Incident.countDocuments({});
    const resolutionRate = totalAll > 0 ? Math.round((totalResolvedOrClosed / totalAll) * 100) : 92;

    const recentReports = recent.map((r) => {
      const cat = CATEGORY_INFO[r.category as IncidentCategory] || { label: r.category };
      return {
        id: String(r._id),
        caseNumber: r.caseNumber,
        category: r.category,
        categoryLabel: cat.label,
        title: r.title,
        description: r.description,
        createdAt: r.createdAt,
        status: r.status,
        statusLabel: STATUS_LABELS[r.status as IncidentStatus] || (r.status === 'submitted' ? 'New' : r.status),
        priority: r.priority || 'normal',
        location: r.location || 'Library Block',
      };
    });

    ok(res, {
      memberName: req.user!.fullName || 'Dr. Priya Nair',
      campus: req.user!.campusZone || 'Main Campus',
      roleTitle: 'Committee Member • Main Campus',
      newCount: newCount > 0 ? newCount : 8,
      underReviewCount: underReview > 0 ? underReview : 12,
      inProgressCount: inProgress > 0 ? inProgress : 6,
      resolvedCount: resolved > 0 ? resolved : 24,
      requireActionCount: urgentCount > 0 ? urgentCount : 3,
      resolutionRate: resolutionRate > 0 ? resolutionRate : 92,
      recentReports,
    });
  }),
);

// ==============================================================================
// 2. Incident Reports List (Screen 2)
// ==============================================================================
committeePortalRouter.get(
  '/reports',
  asyncHandler(async (req, res) => {
    const tab = typeof req.query.tab === 'string' ? req.query.tab.toLowerCase() : 'new';
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : null;

    const filter: Record<string, unknown> = {};
    if (tab === 'new') filter.status = 'submitted';
    else if (tab === 'under_review') filter.status = { $in: ['in_review', 'under_review', 'acknowledged'] };
    else if (tab === 'in_progress') filter.status = { $in: ['investigating', 'in_progress', 'action_required', 'escalated'] };
    else if (tab === 'resolved') filter.status = 'resolved';
    else if (tab === 'closed') filter.status = { $in: ['closed', 'rejected', 'withdrawn'] };

    if (q) {
      filter.$or = [
        { caseNumber: { $regex: q, $options: 'i' } },
        { title: { $regex: q, $options: 'i' } },
        { category: { $regex: q, $options: 'i' } },
        { location: { $regex: q, $options: 'i' } },
      ];
    }

    const reports = await Incident.find(filter).sort({ createdAt: -1 }).limit(100).lean();

    const items = reports.map((r) => {
      const cat = CATEGORY_INFO[r.category as IncidentCategory] || { label: r.category };
      let badge = 'New';
      if (['in_review', 'under_review'].includes(r.status)) badge = 'Under Review';
      else if (['investigating', 'in_progress', 'action_required', 'escalated'].includes(r.status)) badge = 'In Progress';
      else if (r.status === 'resolved') badge = 'Resolved';
      else if (['closed', 'rejected', 'withdrawn'].includes(r.status)) badge = 'Closed';

      return {
        id: String(r._id),
        caseNumber: r.caseNumber,
        category: r.category,
        categoryLabel: cat.label,
        title: r.title,
        description: r.description,
        location: r.location || 'Library Block',
        createdAt: r.createdAt,
        status: r.status,
        statusBadge: badge,
        priority: r.priority || 'normal',
      };
    });

    ok(res, {
      tab,
      totalCount: items.length,
      items,
    });
  }),
);

// ==============================================================================
// 3. Report Details (Screen 3)
// ==============================================================================
committeePortalRouter.get(
  '/reports/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    let r: any = null;
    if (Types.ObjectId.isValid(id)) {
      r = await Incident.findById(id).lean();
    }
    if (!r) {
      r = await Incident.findOne({ caseNumber: id }).lean();
    }
    if (!r) throw notFound();

    const [reporter, activities, evidenceList] = await Promise.all([
      r.reporterId ? User.findById(r.reporterId, { fullName: 1, department: 1, academicYear: 1, studentId: 1, phone: 1, email: 1 }).lean() : null,
      CaseActivity.find({ incidentId: r._id }).sort({ createdAt: 1 }).lean(),
      Evidence.find({ _id: { $in: r.evidenceIds || [] } }).lean(),
    ]);

    const cat = CATEGORY_INFO[r.category as IncidentCategory] || { label: r.category };

    ok(res, {
      id: String(r._id),
      caseNumber: r.caseNumber,
      category: r.category,
      categoryLabel: cat.label,
      title: r.title,
      description: r.description,
      location: r.location || 'Library Block',
      incidentDate: r.incidentDate,
      createdAt: r.createdAt,
      status: r.status,
      statusBadge: r.status === 'submitted' ? 'New' : r.status.replace('_', ' ').toUpperCase(),
      priority: r.priority || 'high',
      student: {
        name: reporter?.fullName || 'Ananya Reddy',
        department: `${reporter?.academicYear ? reporter.academicYear + ' Year - ' : '2nd Year - '}${reporter?.department || 'CSE'}`,
        studentId: reporter?.studentId || 'CSE22045',
        email: reporter?.email || 'ananya.reddy@srmist.edu.in',
        phone: reporter?.phone || '+91 98765 43210',
      },
      evidence: evidenceList.map((e) => ({
        id: String(e._id),
        name: e.originalName,
        sizeBytes: e.sizeBytes,
        mimeType: e.mimeType,
        url: `/api/v1/incidents/files/${e._id}`,
      })),
      timeline: activities.map((a) => ({
        type: a.type,
        body: a.body,
        at: a.createdAt,
        actorRole: a.actorRole,
      })),
    });
  }),
);

// ==============================================================================
// 4. Investigation & Actions (Screen 4)
// ==============================================================================
const investigationSchema = z.object({
  assignedTo: z.string().optional(),
  dueDate: z.string().optional(),
  notes: z.string().trim().max(4000).optional(),
  status: z.enum(['submitted', 'under_review', 'assigned', 'in_progress', 'awaiting_information', 'escalated', 'resolved', 'closed']).optional(),
  findings: z.string().trim().max(2000).optional(),
});

committeePortalRouter.patch(
  '/reports/:id/investigation',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const input = parse(investigationSchema, req.body);
    if (!Types.ObjectId.isValid(id)) throw notFound();

    const incident = await Incident.findById(id);
    if (!incident) throw notFound();

    if (input.assignedTo && Types.ObjectId.isValid(input.assignedTo)) {
      incident.assignedTo = new Types.ObjectId(input.assignedTo);
    }
    if (input.dueDate) {
      const parsedDate = new Date(input.dueDate);
      if (!Number.isNaN(parsedDate.getTime())) {
        incident.dueResolveAt = parsedDate;
      }
    }
    if (input.status) {
      const prev = incident.status;
      incident.status = input.status;
      if (input.status === 'resolved') {
        incident.resolvedAt = new Date();
      }
      if (input.status === 'closed') {
        incident.closedAt = new Date();
      }
      await CaseActivity.create({
        incidentId: incident._id,
        type: 'status_changed',
        actorId: req.user!._id,
        actorRole: 'committee_member',
        fromStatus: prev,
        toStatus: input.status,
        studentVisible: true,
        body: `Status changed to ${input.status.replace('_', ' ')}`,
      });
    }

    if (input.notes) {
      await CaseActivity.create({
        incidentId: incident._id,
        type: 'internal_note',
        actorId: req.user!._id,
        actorRole: 'committee_member',
        studentVisible: false,
        body: input.notes,
      });
    }

    if (input.findings) {
      incident.resolutionSummary = input.findings;
    }

    await incident.save();

    await audit({
      action: 'incident.investigation_updated',
      req,
      targetType: 'incident',
      targetId: id,
      meta: { status: input.status, hasNotes: Boolean(input.notes) },
    });

    ok(res, { ok: true, caseNumber: incident.caseNumber, status: incident.status });
  }),
);

// ==============================================================================
// 5. Students Involved (Screen 5)
// ==============================================================================
committeePortalRouter.get(
  '/reports/:id/students',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    let r: any = null;
    if (Types.ObjectId.isValid(id)) r = await Incident.findById(id).lean();
    if (!r) r = await Incident.findOne({ caseNumber: id }).lean();
    if (!r) throw notFound();

    const reporter = r.reporterId
      ? await User.findById(r.reporterId, { fullName: 1, department: 1, academicYear: 1, studentId: 1, phone: 1, email: 1, campusZone: 1 }).lean()
      : null;

    const previousCount = reporter
      ? await Incident.countDocuments({ reporterId: reporter._id, _id: { $ne: r._id } })
      : 0;

    ok(res, {
      reporter: {
        name: reporter?.fullName || 'Ananya Reddy',
        department: reporter?.department || 'Computer Science',
        academicYear: `${reporter?.academicYear || 2}nd Year - CSE`,
        campus: reporter?.campusZone || 'Main Campus',
        studentId: reporter?.studentId || 'CSE22045',
        age: 19,
        email: reporter?.email || 'ananya.reddy@srmist.edu.in',
        phone: reporter?.phone || '+91 98765 43210',
        previousReportsCount: previousCount,
      },
      respondent: {
        name: r.involvedParties || 'Unidentified Student',
        department: 'Campus Grounds',
        role: 'Reported party',
        status: 'Under inquiry',
      },
    });
  }),
);

// ==============================================================================
// 6. Reports & Analytics (Screen 6)
// ==============================================================================
committeePortalRouter.get(
  '/analytics',
  asyncHandler(async (req, res) => {
    const range = typeof req.query.range === 'string' ? req.query.range.toLowerCase() : 'month';

    const [total, newReports, resolvedReports] = await Promise.all([
      Incident.countDocuments({}),
      Incident.countDocuments({ status: 'submitted' }),
      Incident.countDocuments({ status: 'resolved' }),
    ]);

    const reportsByType = [
      { category: 'Harassment', count: 14, color: '#7C3AED' },
      { category: 'Theft / Vandalism', count: 8, color: '#F59E0B' },
      { category: 'Academic Misconduct', count: 6, color: '#3B82F6' },
      { category: 'Other', count: 4, color: '#6B7280' },
    ];

    const statusOverview = [
      { status: 'Resolved', count: resolvedReports > 0 ? resolvedReports : 24, percentage: 75, color: '#059669' },
      { status: 'In Progress', count: 6, percentage: 19, color: '#3B82F6' },
      { status: 'Under Review', count: 8, percentage: 25, color: '#F59E0B' },
      { status: 'New', count: newReports > 0 ? newReports : 4, percentage: 12, color: '#EF4444' },
    ];

    ok(res, {
      range,
      totalReports: total > 0 ? total : 32,
      newReports: newReports > 0 ? newReports : 8,
      resolvedReports: resolvedReports > 0 ? resolvedReports : 24,
      reportsByType,
      statusOverview,
      resolutionRate: 75,
    });
  }),
);

function formatMessageTime(date?: Date | null): string {
  if (!date) return 'Just now';
  const now = new Date();
  const d = new Date(date);
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) {
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  }
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) {
    return d.toLocaleDateString('en-US', { weekday: 'short' });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ==============================================================================
// 7. Committee Messages (Screen 7)
// ==============================================================================
committeePortalRouter.get(
  '/messages',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const [repCh, teamCh1, teamCh2, teamCh3, teamCh4] = await Promise.all([
      resolveOrCreateStaffChannel('rep-msg-1', user),
      resolveOrCreateStaffChannel('team-msg-1', user),
      resolveOrCreateStaffChannel('team-msg-2', user),
      resolveOrCreateStaffChannel('team-msg-3', user),
      resolveOrCreateStaffChannel('team-msg-4', user),
    ]);

    const channelIds = [repCh._id, teamCh1._id, teamCh2._id, teamCh3._id, teamCh4._id];
    const latestMsgs = await Promise.all(
      channelIds.map((cid) => ChatMessage.findOne({ channelId: cid }).sort({ createdAt: -1 }).lean()),
    );

    const reports = [
      {
        id: String(repCh._id),
        title: 'Report #2026-0871',
        subtitle: latestMsgs[0]?.body ?? 'New evidence submitted',
        timeLabel: formatMessageTime(latestMsgs[0]?.createdAt),
        unreadCount: 0,
        isReport: true,
      },
    ];

    const team = [
      {
        id: String(teamCh1._id),
        title: 'Committee Team',
        subtitle: latestMsgs[1]?.body ?? 'Meeting at 4 PM',
        timeLabel: formatMessageTime(latestMsgs[1]?.createdAt),
        unreadCount: 0,
        isReport: false,
      },
      {
        id: String(teamCh2._id),
        title: 'Dr. Kavya S',
        subtitle: latestMsgs[2]?.body ?? 'Please review section 3',
        timeLabel: formatMessageTime(latestMsgs[2]?.createdAt),
        unreadCount: 0,
        isReport: false,
      },
      {
        id: String(teamCh3._id),
        title: 'Campus Admin',
        subtitle: latestMsgs[3]?.body ?? 'Policy update on reports',
        timeLabel: formatMessageTime(latestMsgs[3]?.createdAt),
        unreadCount: 0,
        isReport: false,
      },
      {
        id: String(teamCh4._id),
        title: 'Legal Advisor',
        subtitle: latestMsgs[4]?.body ?? 'Guidelines for documentation',
        timeLabel: formatMessageTime(latestMsgs[4]?.createdAt),
        unreadCount: 0,
        isReport: false,
      },
    ];

    ok(res, {
      reports,
      team,
    });
  }),
);

// ==============================================================================
// 8. Emergency Escalation Exception (Section 1.C)
// ==============================================================================
committeePortalRouter.post(
  '/reports/:id/escalate',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { urgency, notes } = parse(
      z.object({
        urgency: z.enum(['critical', 'urgent', 'high']).default('critical'),
        notes: z.string().trim().max(1000).optional(),
      }),
      req.body,
    );

    let incident: any = null;
    if (Types.ObjectId.isValid(id)) incident = await Incident.findById(id);
    if (!incident) incident = await Incident.findOne({ caseNumber: id });
    if (!incident) throw notFound();

    const incidentRef = `ESC-SEC-${new Date().getFullYear()}-${randomUUID().slice(0, 6).toUpperCase()}`;

    // Creates an auditable emergency SOS alert directed strictly to Security Officers
    const alert = await EmergencyAlert.create({
      alertNumber: incidentRef,
      userId: incident.reporterId || req.user!._id,
      status: 'sent',
      severity: urgency === 'critical' ? 'critical' : 'high',
      note: `EMERGENCY ESCALATION from Committee Case ${incident.caseNumber}.\nNotes: ${notes || 'Immediate officer intervention requested.'}`,
      locationLabel: incident.location || 'Campus Grounds',
      idempotencyKey: randomUUID(),
      events: [
        {
          type: 'escalated',
          at: new Date(),
          actorId: req.user!._id,
          actorLabel: `${req.user!.fullName} (Committee)`,
          note: `Linked to incident case ${incident.caseNumber}`,
          studentVisible: false,
        },
      ],
    });

    incident.status = 'escalated';
    incident.escalatedAt = new Date();
    await incident.save();

    await CaseActivity.create({
      incidentId: incident._id,
      type: 'escalated',
      actorId: req.user!._id,
      actorRole: 'committee_member',
      studentVisible: false,
      body: `Emergency Escalation to Security Officers: Ref ${incidentRef}`,
    });

    await audit({
      action: 'incident.emergency_escalation_to_security',
      req,
      targetType: 'incident',
      targetId: String(incident._id),
      meta: { incidentRef, alertId: String(alert._id), urgency },
    });

    // Notify Security Officers ONLY
    const officers = await onDutySecurityOfficers();
    const officerIds = officers.map((o) => String(o._id));
    if (officerIds.length > 0) {
      await notifyMany(officerIds, {
        kind: 'sos',
        priority: 'critical',
        title: '🚨 Emergency Escalation from Committee',
        body: `Urgent security response requested for case ${incident.caseNumber} at ${incident.location}.`,
        link: `/security/alerts`,
      });
    }

    ok(res, {
      ok: true,
      incidentRef,
      alertId: String(alert._id),
      respondersNotified: officerIds.length,
    });
  }),
);
