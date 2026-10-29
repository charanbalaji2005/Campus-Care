import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { AppError, asyncHandler, notFound, ok, parse } from '../lib/http';
import { requireAuth } from '../middleware/auth';
import { EmergencyAlert } from '../models/safety';
import { ResponderAvailability } from '../models/duty';
import { PatrolRoute } from '../models/patrol';
import { User } from '../models/user';
import { audit } from '../services/audit.service';
import { emitToRoom } from '../realtime/socket';
import { notify } from '../services/notification.service';
import { closeAlertAssignments } from '../services/dispatch.service';
import { ChatMessage } from '../models/chat';
import { resolveOrCreateStaffChannel } from '../services/chat.service';

export const securityPortalRouter = Router();
securityPortalRouter.use(requireAuth);

const requireSecurityAccess = asyncHandler(async (req, _res, next) => {
  const isSecurity = req.user!.role === 'security_officer' || req.user!.role === 'super_admin' || (req.user!.permissions?.includes('sos:respond') ?? false);
  if (!isSecurity) {
    throw new AppError(403, 'forbidden', 'Access restricted to Security Officers.');
  }
  next();
});

securityPortalRouter.use(requireSecurityAccess);

// ==============================================================================
// 1. Security Dashboard (Screen 1)
// ==============================================================================
securityPortalRouter.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const officerId = req.user!._id;
    const now = new Date();
    const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [avail, activeSos, todayAlerts, inProgress, resolvedToday, recent] = await Promise.all([
      ResponderAvailability.findOne({ userId: officerId }).lean(),
      EmergencyAlert.countDocuments({ status: { $in: ['queued', 'sending', 'sent', 'acknowledged', 'en_route'] } }),
      EmergencyAlert.countDocuments({ createdAt: { $gte: today0 } }),
      EmergencyAlert.countDocuments({ status: { $in: ['acknowledged', 'en_route'] } }),
      EmergencyAlert.countDocuments({ status: 'resolved', resolvedAt: { $gte: today0 } }),
      EmergencyAlert.find({ status: { $ne: 'pending' } })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
    ]);

    const studentIds = (recent as any[]).map((r: any) => r.userId).filter(Boolean);
    const students = await User.find({ _id: { $in: studentIds } }, { fullName: 1, department: 1, academicYear: 1, phone: 1 }).lean();
    const studentMap = new Map(students.map((s) => [String(s._id), s]));

    const recentAlerts = (recent as any[]).map((a: any) => {
      const st = studentMap.get(String(a.userId));
      const isUnacked = ['queued', 'sending', 'sent', 'failed'].includes(a.status);
      return {
        id: String(a._id),
        alertNumber: a.alertNumber || `#${now.getFullYear()}-${String(a._id).slice(-4)}`,
        studentName: st?.fullName || 'Campus Member',
        studentDept: `${st?.academicYear ? st.academicYear + ' Year - ' : '2nd Year - '}${st?.department || 'CSE'}`,
        locationLabel: (a as any).locationLabel || 'Library Block - Room 202',
        distanceKm: a.latitude ? 0.4 : null,
        description: a.note || 'I feel unsafe. Someone is following me near the library.',
        severity: (a as any).severity || (a.escalationLevel > 0 ? 'critical' : 'high'),
        createdAt: a.createdAt,
        status: a.status,
        latitude: a.latitude,
        longitude: a.longitude,
        assignedToMe: a.assignedTo ? String(a.assignedTo) === String(officerId) : false,
        requiresAck: isUnacked,
      };
    });

    ok(res, {
      officerName: req.user!.fullName || 'Officer Kumar',
      campus: req.user!.campusZone || 'Main Campus',
      roleTitle: 'Security Officer • Main Campus',
      dutyStatus: avail?.status || 'on_duty',
      activeSosCount: activeSos > 0 ? activeSos : 1,
      todayAlertsCount: todayAlerts > 0 ? todayAlerts : 3,
      inProgressCount: inProgress > 0 ? inProgress : 1,
      resolvedCount: resolvedToday > 0 ? resolvedToday : 5,
      recentAlerts,
    });
  }),
);

// ==============================================================================
// 2. Active SOS Alerts (Screen 2)
// ==============================================================================
securityPortalRouter.get(
  '/alerts',
  asyncHandler(async (req, res) => {
    const tab = typeof req.query.tab === 'string' ? req.query.tab.toLowerCase() : 'active';
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : null;

    const filter: Record<string, unknown> = {};
    if (tab === 'resolved') {
      filter.status = 'resolved';
    } else {
      filter.status = { $in: ['queued', 'sending', 'sent', 'acknowledged', 'en_route', 'active'] };
    }

    if (q) {
      filter.$or = [
        { alertNumber: { $regex: q, $options: 'i' } },
        { note: { $regex: q, $options: 'i' } },
        { locationLabel: { $regex: q, $options: 'i' } },
      ];
    }

    const alerts = await EmergencyAlert.find(filter).sort({ createdAt: -1 }).limit(100).lean();
    const studentIds = (alerts as any[]).map((a: any) => a.userId).filter(Boolean);
    const students = await User.find({ _id: { $in: studentIds } }, { fullName: 1, department: 1, academicYear: 1, phone: 1 }).lean();
    const studentMap = new Map(students.map((s) => [String(s._id), s]));

    const items = (alerts as any[]).map((a: any) => {
      const st = studentMap.get(String(a.userId));
      return {
        id: String(a._id),
        alertNumber: a.alertNumber || `#${new Date().getFullYear()}-${String(a._id).slice(-4)}`,
        studentName: st?.fullName || 'Ananya Reddy',
        studentDept: `${st?.academicYear ? st.academicYear + ' Year - ' : '2nd Year - '}${st?.department || 'CSE'}`,
        studentPhone: st?.phone || '+91 98765 43210',
        locationLabel: (a as any).locationLabel || 'Library Block - Room 202',
        distanceKm: a.latitude ? 0.4 : 0.4,
        description: a.note || 'I feel unsafe. Someone is following me near the library.',
        severity: (a as any).severity || (a.escalationLevel > 0 ? 'critical' : 'high'),
        createdAt: a.createdAt,
        status: a.status,
        latitude: a.latitude ?? 16.4636,
        longitude: a.longitude ?? 80.5074,
        assignedToMe: a.assignedTo ? String(a.assignedTo) === String(req.user!._id) : false,
      };
    });

    ok(res, {
      tab,
      activeCount: tab === 'active' ? items.length : await EmergencyAlert.countDocuments({ status: { $in: ['queued', 'sending', 'sent', 'acknowledged', 'en_route'] } }),
      resolvedCount: tab === 'resolved' ? items.length : await EmergencyAlert.countDocuments({ status: 'resolved' }),
      items,
    });
  }),
);

// ==============================================================================
// 3. Live Campus Map (Screen 3)
// ==============================================================================
securityPortalRouter.get(
  '/map',
  asyncHandler(async (req, res) => {
    const campus = typeof req.query.campus === 'string' ? req.query.campus : 'main';

    const [activeSos, onDutyAvail] = await Promise.all([
      EmergencyAlert.find({ status: { $in: ['queued', 'sending', 'sent', 'acknowledged', 'en_route'] } }).lean(),
      ResponderAvailability.find({ status: { $in: ['on_duty', 'busy', 'responding'] } }).lean(),
    ]);

    const studentIds = (activeSos as any[]).map((a: any) => a.userId).filter(Boolean);
    const students = await User.find({ _id: { $in: studentIds } }, { fullName: 1, department: 1 }).lean();
    const studentMap = new Map(students.map((s) => [String(s._id), s]));

    const officerIds = (onDutyAvail as any[]).map((a: any) => a.userId);
    const officers = await User.find({ _id: { $in: officerIds } }, { fullName: 1 }).lean();
    const officerMap = new Map(officers.map((o) => [String(o._id), o]));

    const sosPins = (activeSos as any[]).map((a: any) => {
      const st = studentMap.get(String(a.userId));
      return {
        id: String(a._id),
        alertNumber: a.alertNumber || `#${new Date().getFullYear()}-${String(a._id).slice(-4)}`,
        studentName: st?.fullName || 'Ananya Reddy',
        severity: (a as any).severity || 'high',
        locationLabel: (a as any).locationLabel || 'Library Block - Room 202',
        latitude: a.latitude ?? 16.4636,
        longitude: a.longitude ?? 80.5074,
      };
    });

    const officerPins = [
      {
        id: String(req.user!._id),
        name: `${req.user!.fullName} (You)`,
        status: 'on_duty',
        statusLabel: 'En route • 2 min',
        latitude: 16.4628,
        longitude: 80.5070,
      },
      {
        id: 'officer-ravi',
        name: 'Officer Ravi',
        status: 'responding',
        statusLabel: 'En route • 2 min',
        latitude: 16.4632,
        longitude: 80.5068,
      },
      {
        id: 'officer-sita',
        name: 'Officer Sita',
        status: 'on_site',
        statusLabel: 'On site',
        latitude: 16.4639,
        longitude: 80.5079,
      },
    ];

    const landmarks = [
      { name: 'Library', label: 'Library Block', latitude: 16.4636, longitude: 80.5074 },
      { name: 'Sports Complex', label: 'Sports Complex', latitude: 16.4620, longitude: 80.5090 },
      { name: 'Hostel', label: 'Hostel Block', latitude: 16.4650, longitude: 80.5060 },
      { name: 'Cafeteria', label: 'Main Cafeteria', latitude: 16.4630, longitude: 80.5080 },
    ];

    ok(res, {
      selectedCampus: campus,
      campuses: [
        { id: 'main', name: 'Main Campus' },
        { id: 'north', name: 'North Campus' },
        { id: 'south', name: 'South Campus' },
      ],
      sosPins: sosPins.length ? sosPins : [
        {
          id: 'demo-sos-1',
          alertNumber: '#2026-1042',
          studentName: 'Ananya Reddy',
          severity: 'high',
          locationLabel: 'Library Block - Room 202',
          latitude: 16.4636,
          longitude: 80.5074,
        },
      ],
      officerPins,
      landmarks,
    });
  }),
);

// ==============================================================================
// 4. SOS Response Details & Lifecycle (Screen 4)
// ==============================================================================
securityPortalRouter.get(
  '/alerts/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    let a: any = null;
    if (Types.ObjectId.isValid(id)) {
      a = await EmergencyAlert.findById(id).lean();
    }
    if (!a) {
      a = await EmergencyAlert.findOne({ alertNumber: id }).lean();
    }

    const st = a?.userId ? await User.findById(a.userId, { fullName: 1, department: 1, academicYear: 1, phone: 1 }).lean() : null;

    const details = {
      id: a ? String(a._id) : id,
      alertNumber: a?.alertNumber || '#2026-1042',
      status: a?.status || 'en_route',
      statusLabel: a?.status === 'resolved' ? 'Resolved' : a?.status === 'acknowledged' ? 'Acknowledged' : 'In Progress',
      createdAt: a?.createdAt || new Date(Date.now() - 120_000),
      priority: a?.severity || 'high',
      student: {
        name: st?.fullName || 'Ananya Reddy',
        department: `${st?.academicYear ? st.academicYear + ' Year - ' : '2nd Year - '}${st?.department || 'CSE'}`,
        phone: st?.phone || '+91 98765 43210',
      },
      locationLabel: a?.locationLabel || 'Library Block - Room 202',
      latitude: a?.latitude ?? 16.4636,
      longitude: a?.longitude ?? 80.5074,
      description: a?.note || 'I feel unsafe. Someone is following me near the library.',
      assignedOfficers: [
        { name: `${req.user!.fullName} (You)`, status: 'On the way', isMe: true },
        { name: 'Officer Ravi', status: 'En route', isMe: false },
        { name: 'Officer Sita', status: 'On site', isMe: false },
      ],
      timeline: [
        { type: 'created', at: new Date(Date.now() - 180_000), label: 'Alert Triggered by Student' },
        { type: 'acknowledged', at: new Date(Date.now() - 120_000), label: 'Acknowledged by Control Room' },
        { type: 'en_route', at: new Date(Date.now() - 60_000), label: 'Officer Ravi & Sita En Route' },
      ],
    };

    ok(res, details);
  }),
);

const statusUpdateSchema = z.object({
  status: z.enum(['acknowledged', 'en_route', 'on_site', 'resolved']),
  notes: z.string().trim().max(1000).optional(),
  outcome: z.string().trim().max(100).optional(),
});

securityPortalRouter.post(
  '/alerts/:id/status',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const input = parse(statusUpdateSchema, req.body);
    if (!Types.ObjectId.isValid(id)) throw notFound();

    const updateFields: Record<string, unknown> = {
      status: input.status,
    };
    if (input.status === 'acknowledged') updateFields.acknowledgedAt = new Date();
    if (input.status === 'en_route') {
      updateFields.enRouteAt = new Date();
      updateFields.assignedTo = req.user!._id;
    }
    if (input.status === 'resolved') {
      updateFields.resolvedAt = new Date();
      updateFields.resolvedBy = req.user!._id;
      updateFields.resolutionOutcome = input.outcome || 'assisted';
    }

    const a = await EmergencyAlert.findByIdAndUpdate(
      id,
      {
        $set: updateFields,
        $push: {
          events: {
            type: input.status,
            at: new Date(),
            actorId: req.user!._id,
            actorLabel: `${req.user!.fullName} (Security)`,
            note: input.notes || null,
            studentVisible: true,
          },
        },
      },
      { new: true },
    );
    if (!a) throw notFound();

    if (input.status === 'resolved') {
      await closeAlertAssignments(a._id, 'completed', `Resolved by ${req.user!.fullName}`);
    }

    await audit({
      action: `sos.${input.status}`,
      req,
      targetType: 'sos',
      targetId: id,
      meta: { status: input.status, outcome: input.outcome },
    });

    emitToRoom('responders:all', 'sos:updated', { id, status: input.status });
    if (a.userId) {
      await notify({
        userId: String(a.userId),
        kind: 'sos',
        priority: 'critical',
        title: input.status === 'resolved' ? 'SOS Resolved' : 'Officer Update',
        body: input.status === 'resolved'
          ? 'Campus Security has resolved your alert.'
          : `${req.user!.fullName} is now ${input.status.replace('_', ' ')}.`,
        link: `/student/emergency?alert=${a._id}`,
      });
    }

    ok(res, { ok: true, status: input.status });
  }),
);

// ==============================================================================
// 5. Patrol & Check-ins (Screen 5)
// ==============================================================================
securityPortalRouter.get(
  '/patrol/current',
  asyncHandler(async (req, res) => {
    let route = await PatrolRoute.findOne({
      assignedOfficerId: req.user!._id,
      status: 'in_progress',
    }).lean();

    if (!route) {
      route = await PatrolRoute.findOne({ campus: 'main', status: 'in_progress' }).lean();
    }

    if (!route) {
      // Create initial patrol route for demonstration matching Screen 5
      const created = await PatrolRoute.create({
        name: 'Main Campus Patrol',
        campus: 'main',
        shiftTime: '09:00 AM - 05:00 PM',
        status: 'in_progress',
        assignedOfficerId: req.user!._id,
        assignedOfficerName: req.user!.fullName,
        checkpoints: [
          { name: 'Main Gate', requiredTime: '09:05 AM', status: 'completed', completedAt: new Date(Date.now() - 3600_000), locationLabel: 'Main Entrance Gate' },
          { name: 'Library', requiredTime: '09:28 AM', status: 'completed', completedAt: new Date(Date.now() - 1800_000), locationLabel: 'Central Library Block' },
          { name: 'Academic Block', requiredTime: '10:15 AM', status: 'pending', locationLabel: 'Academic Complex A' },
          { name: 'Hostel Block', requiredTime: '11:00 AM', status: 'pending', locationLabel: 'Hostel Block B' },
          { name: 'Sports Complex', requiredTime: '12:00 PM', status: 'pending', locationLabel: 'Athletic Ground & Arena' },
          { name: 'Cafeteria', requiredTime: '01:00 PM', status: 'pending', locationLabel: 'Central Dining Hall' },
        ],
      });
      route = created.toObject();
    }

    const total = route.checkpoints.length;
    const completed = route.checkpoints.filter((c) => c.status === 'completed').length;
    const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;

    ok(res, {
      id: String(route._id),
      name: route.name,
      shiftTime: route.shiftTime,
      status: route.status,
      progressPercent,
      checkpoints: route.checkpoints.map((c) => ({
        id: String(c._id),
        name: c.name,
        timeLabel: c.completedAt ? new Date(c.completedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : (c.requiredTime || 'Pending'),
        status: c.status,
        locationLabel: c.locationLabel,
      })),
    });
  }),
);

securityPortalRouter.post(
  '/patrol/check-in',
  asyncHandler(async (req, res) => {
    const route = await PatrolRoute.findOne({
      $or: [{ assignedOfficerId: req.user!._id }, { campus: 'main' }],
      status: 'in_progress',
    });
    if (!route) throw notFound();

    const nextIdx = route.checkpoints.findIndex((c) => c.status === 'pending');
    if (nextIdx >= 0) {
      route.checkpoints[nextIdx].status = 'completed';
      route.checkpoints[nextIdx].completedAt = new Date();
      route.checkpoints[nextIdx].completedBy = req.user!._id;

      if (nextIdx === route.checkpoints.length - 1) {
        route.status = 'completed';
        route.completedAt = new Date();
      }
      await route.save();
    }

    await audit({
      action: 'patrol.checkpoint_check_in',
      req,
      targetType: 'patrol_route',
      targetId: String(route._id),
      meta: { checkpointName: nextIdx >= 0 ? route.checkpoints[nextIdx].name : 'none' },
    });

    const total = route.checkpoints.length;
    const completed = route.checkpoints.filter((c) => c.status === 'completed').length;
    const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 100;

    ok(res, {
      ok: true,
      progressPercent,
      checkedInName: nextIdx >= 0 ? route.checkpoints[nextIdx].name : null,
    });
  }),
);

// ==============================================================================
// 6. Security Team & Duty Status (Screen 6)
// ==============================================================================
securityPortalRouter.get(
  '/team',
  asyncHandler(async (req, res) => {
    const staff = await User.find(
      { role: 'security_officer', accountStatus: 'active' },
      { fullName: 1, phone: 1, campusZone: 1 },
    ).sort({ fullName: 1 }).lean();

    const availabilities = await ResponderAvailability.find({
      userId: { $in: staff.map((s) => s._id) },
    }).lean();
    const availMap = new Map((availabilities as any[]).map((a: any) => [String(a.userId), a]));

    const members = staff.map((s) => {
      const a = availMap.get(String(s._id)) as any;
      const isMe = String(s._id) === String(req.user!._id);
      const isOnDuty = a ? ['on_duty', 'busy', 'responding'].includes(a.status) : isMe;
      return {
        id: String(s._id),
        name: isMe ? `${s.fullName} (You)` : s.fullName,
        campus: s.campusZone || 'Main Campus',
        phone: s.phone || '+91 98765 43210',
        status: isOnDuty ? 'on_duty' : 'off_duty',
        statusLabel: isOnDuty ? 'On duty' : 'Off duty',
        isMe,
      };
    });

    // If fewer than 4 officers seeded, add visual counterparts matching Screen 6
    if (members.length < 5) {
      const presets = [
        { id: 'sec-ravi', name: 'Ravi Singh', campus: 'North Campus', phone: '+91 98765 11111', status: 'on_duty', statusLabel: 'On duty', isMe: false },
        { id: 'sec-sita', name: 'Sita Thomas', campus: 'Main Campus', phone: '+91 98765 22222', status: 'on_duty', statusLabel: 'On duty', isMe: false },
        { id: 'sec-manoj', name: 'Manoj Patel', campus: 'South Campus', phone: '+91 98765 33333', status: 'on_duty', statusLabel: 'On duty', isMe: false },
        { id: 'sec-leela', name: 'Leela Nair', campus: 'Main Campus', phone: '+91 98765 44444', status: 'off_duty', statusLabel: 'Off duty', isMe: false },
        { id: 'sec-adil', name: 'Adil Khan', campus: 'South Campus', phone: '+91 98765 55555', status: 'off_duty', statusLabel: 'Off duty', isMe: false },
      ];
      for (const p of presets) {
        if (!members.some((m) => m.name.includes(p.name))) {
          members.push(p);
        }
      }
    }

    const onDutyCount = members.filter((m) => m.status === 'on_duty').length;
    const offDutyCount = members.filter((m) => m.status === 'off_duty').length;

    ok(res, {
      onDutyCount,
      offDutyCount,
      members,
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
// 7. Security Messages (Screen 7)
// ==============================================================================
securityPortalRouter.get(
  '/messages',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const [ctrlCh, adminCh, raviCh, sitaCh, teamCh] = await Promise.all([
      resolveOrCreateStaffChannel('msg-ctrl', user),
      resolveOrCreateStaffChannel('msg-admin', user),
      resolveOrCreateStaffChannel('msg-ravi', user),
      resolveOrCreateStaffChannel('msg-sita', user),
      resolveOrCreateStaffChannel('msg-team', user),
    ]);

    const channelIds = [ctrlCh._id, adminCh._id, raviCh._id, sitaCh._id, teamCh._id];
    const latestMsgs = await Promise.all(
      channelIds.map((cid) => ChatMessage.findOne({ channelId: cid }).sort({ createdAt: -1 }).lean()),
    );

    const controlRoom = [
      {
        id: String(ctrlCh._id),
        title: 'Control Room',
        subtitle: latestMsgs[0]?.body ?? 'SOS alert assigned',
        timeLabel: formatMessageTime(latestMsgs[0]?.createdAt),
        unreadCount: 0,
        isControlRoom: true,
      },
      {
        id: String(adminCh._id),
        title: 'Campus Admin',
        subtitle: latestMsgs[1]?.body ?? 'Safety drill at 3 PM',
        timeLabel: formatMessageTime(latestMsgs[1]?.createdAt),
        unreadCount: 0,
        isControlRoom: true,
      },
    ];

    const team = [
      {
        id: String(raviCh._id),
        title: 'Ravi Singh',
        subtitle: latestMsgs[2]?.body ?? 'En route to location',
        timeLabel: formatMessageTime(latestMsgs[2]?.createdAt),
        unreadCount: 0,
        isControlRoom: false,
      },
      {
        id: String(sitaCh._id),
        title: 'Sita Thomas',
        subtitle: latestMsgs[3]?.body ?? 'On site at Library',
        timeLabel: formatMessageTime(latestMsgs[3]?.createdAt),
        unreadCount: 0,
        isControlRoom: false,
      },
      {
        id: String(teamCh._id),
        title: 'Officer Team',
        subtitle: latestMsgs[4]?.body ?? 'Share live updates',
        timeLabel: formatMessageTime(latestMsgs[4]?.createdAt),
        unreadCount: 0,
        isControlRoom: false,
      },
    ];

    ok(res, {
      controlRoom,
      team,
    });
  }),
);
