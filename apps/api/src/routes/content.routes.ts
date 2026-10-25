import { Router } from 'express';
import { Types } from 'mongoose';
import { trainingAttemptSchema } from '@campuscare/shared';
import { asyncHandler, notFound, ok, parse } from '../lib/http';
import { Announcement, Contact, Notification, TrainingModule, TrainingProgress } from '../models/content';
import { Committee, Incident } from '../models/incident';
import { Appointment } from '../models/counselling';
import { CampusAlert } from '../models/safety';
import { requireAuth } from '../middleware/auth';
import { anonymousReporterTag, randomToken } from '../lib/crypto';
import { User } from '../models/user';

export const contentRouter = Router();
contentRouter.use(requireAuth);

// ------------------------------------------------------------------ notifications
contentRouter.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    const filter: Record<string, unknown> = { userId: req.user!._id };
    if (req.query.unread === 'true') filter.readAt = null;
    const [items, unread] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).limit(Math.min(100, Number(req.query.limit) || 50)).lean(),
      Notification.countDocuments({ userId: req.user!._id, readAt: null }),
    ]);
    ok(res, { items: items.map((n) => ({ id: String(n._id), kind: n.kind, title: n.title, body: n.body, link: n.link, priority: n.priority ?? 'normal', readAt: n.readAt, createdAt: n.createdAt })), unread });
  }),
);

contentRouter.post(
  '/notifications/:id/read',
  asyncHandler(async (req, res) => {
    await Notification.updateOne({ _id: req.params.id, userId: req.user!._id, readAt: null }, { $set: { readAt: new Date() } });
    ok(res, { ok: true });
  }),
);

contentRouter.post(
  '/notifications/read-all',
  asyncHandler(async (req, res) => {
    await Notification.updateMany({ userId: req.user!._id, readAt: null }, { $set: { readAt: new Date() } });
    ok(res, { ok: true });
  }),
);

// ------------------------------------------------------------------ announcements, contacts, committees
contentRouter.get(
  '/announcements',
  asyncHandler(async (_req, res) => {
    const items = await Announcement.find({ published: true }).sort({ pinned: -1, createdAt: -1 }).limit(30).lean();
    ok(res, items.map((a) => ({ id: String(a._id), title: a.title, body: a.body, pinned: a.pinned, kind: a.kind ?? 'notice', eventAt: a.eventAt ?? null, venue: a.venue ?? null, safetyContact: a.safetyContact ?? null, createdAt: a.createdAt })));
  }),
);

contentRouter.get(
  '/contacts',
  asyncHandler(async (_req, res) => {
    const items = await Contact.find({}).sort({ emergency: -1, order: 1, name: 1 }).lean();
    // Unverified contacts are listed without numbers so students never dial an unconfirmed number.
    ok(res, items.map((c) => ({
      id: String(c._id), name: c.name, purpose: c.purpose, category: c.category, verified: c.verified, emergency: c.emergency,
      phone: c.verified ? c.phone : null, email: c.verified ? c.email : null, location: c.location, hours: c.hours,
    })));
  }),
);

contentRouter.get(
  '/committees',
  asyncHandler(async (_req, res) => {
    const items = await Committee.find({ active: true }).sort({ name: 1 }).lean();
    ok(res, items.map((c) => ({ id: String(c._id), name: c.name, type: c.type, mandate: c.mandate, contactEmail: c.contactEmail, contactPhone: c.contactPhone, categories: c.categories })));
  }),
);

// ------------------------------------------------------------------ training
contentRouter.get(
  '/training',
  asyncHandler(async (req, res) => {
    const modules = await TrainingModule.find({ published: true }).sort({ createdAt: 1 }).lean();
    const progress = await TrainingProgress.find({ userId: req.user!._id }).lean();
    const map = new Map(progress.map((p) => [String(p.moduleId), p]));
    ok(res, modules.map((m) => ({
      id: String(m._id), title: m.title, category: m.category, summary: m.summary, durationMinutes: m.durationMinutes, questionCount: m.quiz.length,
      completed: Boolean(map.get(String(m._id))?.completedAt), bestScore: map.get(String(m._id))?.bestScore ?? null,
      certificateId: map.get(String(m._id))?.certificateId ?? null,
    })));
  }),
);

contentRouter.get(
  '/training/:id',
  asyncHandler(async (req, res) => {
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const m = await TrainingModule.findOne({ _id: req.params.id, published: true }).lean();
    if (!m) throw notFound();
    const p = await TrainingProgress.findOne({ userId: req.user!._id, moduleId: m._id }).lean();
    // Correct answers are never sent to the browser.
    ok(res, {
      id: String(m._id), title: m.title, category: m.category, summary: m.summary, durationMinutes: m.durationMinutes, passPercent: m.passPercent,
      sections: m.sections, quiz: m.quiz.map((q) => ({ question: q.question, options: q.options })), completed: Boolean(p?.completedAt), bestScore: p?.bestScore ?? null,
    });
  }),
);

contentRouter.post(
  '/training/:id/attempt',
  asyncHandler(async (req, res) => {
    const { answers } = parse(trainingAttemptSchema, req.body);
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const m = await TrainingModule.findOne({ _id: req.params.id, published: true }).lean();
    if (!m) throw notFound();
    const correct = m.quiz.filter((q, i) => answers[i] === q.correctIndex).length;
    const score = m.quiz.length ? Math.round((correct * 100) / m.quiz.length) : 100;
    const passed = score >= m.passPercent;
    const p = await TrainingProgress.findOneAndUpdate(
      { userId: req.user!._id, moduleId: m._id },
      { $inc: { attempts: 1 }, $max: { bestScore: score } },
      { upsert: true, new: true },
    );
    if (passed && !p.completedAt) {
      p.completedAt = new Date();
      // Certificate number: random and unguessable; anyone shown it can check it at /training/certificates/:id.
      p.certificateId = `CC-CERT-${randomToken(6).replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase()}`;
      await p.save();
    }
    ok(res, { score, passed, correct, total: m.quiz.length, completed: Boolean(p.completedAt), certificateId: p.certificateId ?? null, results: m.quiz.map((q, i) => ({ correct: answers[i] === q.correctIndex })) });
  }),
);

contentRouter.get(
  '/training/certificates/:certificateId',
  asyncHandler(async (req, res) => {
    const p = await TrainingProgress.findOne({ certificateId: String(req.params.certificateId).slice(0, 40) }).lean();
    if (!p?.completedAt) throw notFound();
    const [m, u] = await Promise.all([TrainingModule.findById(p.moduleId, { title: 1, category: 1 }).lean(), User.findById(p.userId, { fullName: 1 }).lean()]);
    ok(res, { certificateId: p.certificateId, holder: u?.fullName ?? 'CampusCare user', module: m?.title ?? 'Training module', category: m?.category ?? null, completedAt: p.completedAt, score: p.bestScore });
  }),
);

// ------------------------------------------------------------------ student dashboard summary
contentRouter.get(
  '/dashboard/student',
  asyncHandler(async (req, res) => {
    const tag = anonymousReporterTag(String(req.user!._id));
    const reportFilter = { $or: [{ reporterId: req.user!._id }, { reporterTag: tag }] };
    const [total, active, resolved, recent, upcoming, alerts, announcements, unread, modules, done] = await Promise.all([
      Incident.countDocuments(reportFilter),
      Incident.countDocuments({ ...reportFilter, status: { $nin: ['resolved', 'closed', 'rejected', 'withdrawn'] } }),
      Incident.countDocuments({ ...reportFilter, status: { $in: ['resolved', 'closed'] } }),
      Incident.find(reportFilter).sort({ updatedAt: -1 }).limit(3).lean(),
      Appointment.findOne({ studentId: req.user!._id, status: { $in: ['requested', 'confirmed', 'rescheduled'] }, startAt: { $gte: new Date() } }).sort({ startAt: 1 }).lean(),
      CampusAlert.find({ $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] }).sort({ createdAt: -1 }).limit(3).lean(),
      Announcement.find({ published: true }).sort({ pinned: -1, createdAt: -1 }).limit(3).lean(),
      Notification.countDocuments({ userId: req.user!._id, readAt: null }),
      TrainingModule.countDocuments({ published: true }),
      TrainingProgress.countDocuments({ userId: req.user!._id, completedAt: { $ne: null } }),
    ]);
    ok(res, {
      stats: { total, active, resolved },
      recentReports: recent.map((r) => ({ id: String(r._id), caseNumber: r.caseNumber, title: r.title, status: r.status, category: r.category, updatedAt: r.updatedAt })),
      nextAppointment: upcoming ? { id: String(upcoming._id), startAt: upcoming.startAt, status: upcoming.status, mode: upcoming.mode } : null,
      campusAlerts: alerts.map((a) => ({ id: String(a._id), title: a.title, severity: a.severity, createdAt: a.createdAt, requestCheckIn: a.requestCheckIn })),
      announcements: announcements.map((a) => ({ id: String(a._id), title: a.title, body: a.body, pinned: a.pinned, kind: a.kind ?? 'notice', eventAt: a.eventAt ?? null, venue: a.venue ?? null, createdAt: a.createdAt })),
      unreadNotifications: unread,
      training: { total: modules, completed: done },
    });
  }),
);
