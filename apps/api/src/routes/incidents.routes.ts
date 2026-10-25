import { Router } from 'express';
import { Types } from 'mongoose';
import {
  INCIDENT_STATUSES, caseMessageSchema, categorySuggestSchema, hasPermission, incidentReopenSchema, incidentWithdrawSchema, suggestIncidentCategory, incidentAssignSchema, incidentCreateSchema, incidentStatusSchema, internalNoteSchema,
  readReceiptSchema, type IncidentStatus, type Role,
} from '@campuscare/shared';
import { AppError, asyncHandler, escapeRegex, notFound, ok, pageParams, parse } from '../lib/http';
import { anonymousReporterTag } from '../lib/crypto';
import { CaseActivity, CaseMessage, CaseReadState, Evidence, Incident } from '../models/incident';
import { User } from '../models/user';
import { requireAuth, requirePermission } from '../middleware/auth';
import { requireTurnstile, upload } from '../middleware/security';
import {
  addInternalNote, assignIncident, changeStatus, createIncident, ensureCanAccessEvidence, listSummary, loadIncidentFor, participantKey,
  postCaseMessage, reporterAction, serializeCaseMessage, serializeIncident, timelineFor, viewerOf,
} from '../services/incident.service';
import { canChat, canUpdateStatus } from '../services/incident.policy';
import { attachmentView, storeUpload, streamFile } from '../services/files.service';
import { audit } from '../services/audit.service';

export const incidentsRouter = Router();
incidentsRouter.use(requireAuth);

// ------------------------------------------------------------------ evidence upload (before submission)
incidentsRouter.post(
  '/evidence',
  requirePermission('incidents:create'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const anonymous = req.body?.anonymous === 'true';
    const doc = await storeUpload(req.file, {
      purpose: 'evidence',
      uploaderId: anonymous ? null : String(req.user!._id),
      uploaderTag: anonymous ? anonymousReporterTag(String(req.user!._id)) : null,
    });
    ok(res, attachmentView(doc), 201);
  }),
);

// ------------------------------------------------------------------ assistive category suggestion
incidentsRouter.post(
  '/suggest-category',
  requirePermission('incidents:create'),
  asyncHandler(async (req, res) => {
    const { text } = parse(categorySuggestSchema, req.body);
    // Computed on the fly; the text is not stored by this endpoint.
    ok(res, suggestIncidentCategory(text));
  }),
);

// ------------------------------------------------------------------ submit
incidentsRouter.post(
  '/',
  requirePermission('incidents:create'),
  requireTurnstile('incidentSubmit'),
  asyncHandler(async (req, res) => {
    const input = parse(incidentCreateSchema, req.body);
    const evidenceIds = Array.isArray(req.body?.evidenceIds) ? (req.body.evidenceIds as unknown[]).filter((x): x is string => typeof x === 'string' && Types.ObjectId.isValid(x)) : [];
    const incident = await createIncident(req.user!, { ...input, evidenceIds }, req);
    ok(res, { id: String(incident._id), caseNumber: incident.caseNumber, status: incident.status }, 201);
  }),
);

// ------------------------------------------------------------------ list (scoped to the caller)
incidentsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const viewer = viewerOf(user);
    const subject = { role: user.role as Role, permissions: user.permissions };
    const { page, limit, skip } = pageParams(req.query);
    const scope = String(req.query.scope ?? (user.role === 'student' ? 'mine' : 'assigned'));
    const filter: Record<string, unknown> = {};
    let level: 'reporter' | 'handler' | 'triage' = 'handler';

    if (scope === 'mine') {
      filter.$or = [{ reporterId: user._id }, { reporterTag: viewer.reporterTag }];
      level = 'reporter';
    } else if (scope === 'assigned') {
      if (!hasPermission(subject, 'incidents:read_committee') && !hasPermission(subject, 'incidents:read_sensitive')) throw new AppError(403, 'forbidden', 'No case access.');
      if (!hasPermission(subject, 'incidents:read_sensitive')) {
        filter.$or = [{ assignedTo: user._id }, { committeeId: { $in: viewer.committeeIds.map((c) => new Types.ObjectId(c)) } }];
      }
      if (req.query.committeeId && Types.ObjectId.isValid(String(req.query.committeeId))) filter.committeeId = new Types.ObjectId(String(req.query.committeeId));
      if (req.query.mine === 'true') filter.assignedTo = user._id;
    } else if (scope === 'triage') {
      if (!hasPermission(subject, 'incidents:triage')) throw new AppError(403, 'forbidden', 'No triage access.');
      level = hasPermission(subject, 'incidents:read_sensitive') ? 'handler' : 'triage';
      if (req.query.committeeId && Types.ObjectId.isValid(String(req.query.committeeId))) filter.committeeId = new Types.ObjectId(String(req.query.committeeId));
      if (req.query.unassigned === 'true') filter.committeeId = null;
    } else {
      throw new AppError(400, 'bad_scope', 'Unknown scope.');
    }
    if (req.query.status && INCIDENT_STATUSES.includes(String(req.query.status) as IncidentStatus)) filter.status = String(req.query.status);
    if (req.query.category) filter.category = String(req.query.category);
    if (req.query.priority) filter.priority = String(req.query.priority);
    if (req.query.overdue === 'true') filter.dueResolveAt = { $lt: new Date() };
    if (req.query.q) {
      const q = escapeRegex(String(req.query.q).slice(0, 60));
      // Triage admins can only search by case number; handlers can search titles too.
      const or = [{ caseNumber: { $regex: q, $options: 'i' } }, ...(level !== 'triage' ? [{ title: { $regex: q, $options: 'i' } }] : [])];
      filter.$and = [...((filter.$and as unknown[]) ?? []), { $or: or }];
    }
    const [items, total] = await Promise.all([
      Incident.find(filter).sort({ urgent: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
      Incident.countDocuments(filter),
    ]);
    ok(res, { items: items.map((i) => listSummary(i as never, level)), total, page, limit });
  }),
);

// ------------------------------------------------------------------ detail
incidentsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { incident, level, viewer } = await loadIncidentFor(req.user!, req.params.id);
    if (level === 'handler') await audit({ action: 'incident.viewed', req, targetType: 'incident', targetId: String(incident._id) });
    ok(res, { incident: await serializeIncident(incident, level, viewer), timeline: await timelineFor(String(incident._id), level), permissions: {
      canChat: canChat(level),
      canUpdateStatus: level === 'handler' || level === 'triage',
      canAssign: hasPermission({ role: req.user!.role as Role, permissions: req.user!.permissions }, 'incidents:triage') || (level === 'handler' && (req.user!.committeeMemberships ?? []).some((m) => m.position === 'chair' && String(m.committeeId) === String(incident.committeeId))),
      canAddNotes: level === 'handler',
    } });
  }),
);

incidentsRouter.patch(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const input = parse(incidentStatusSchema, req.body);
    const { incident, level, viewer } = await loadIncidentFor(req.user!, req.params.id);
    if (!canUpdateStatus(viewer, level, input.status)) throw new AppError(403, 'forbidden', 'You cannot make this change on this case.');
    await changeStatus(req.user!, incident, input.status, input, req);
    ok(res, { incident: await serializeIncident(incident, level, viewer) });
  }),
);

incidentsRouter.post(
  '/:id/assign',
  asyncHandler(async (req, res) => {
    const input = parse(incidentAssignSchema, req.body);
    const { incident, level, viewer } = await loadIncidentFor(req.user!, req.params.id);
    const isTriage = hasPermission({ role: req.user!.role as Role, permissions: req.user!.permissions }, 'incidents:triage');
    const isChair = level === 'handler' && (req.user!.committeeMemberships ?? []).some((m) => m.position === 'chair' && String(m.committeeId) === String(incident.committeeId));
    if (!isTriage && !isChair) throw new AppError(403, 'forbidden', 'Only triage administrators or the committee chair can assign cases.');
    // A chair can pick an owner inside their committee but cannot move the case to another committee.
    if (!isTriage && String(input.committeeId) !== String(incident.committeeId)) throw new AppError(403, 'forbidden', 'Ask an administrator to move the case to another committee.');
    await assignIncident(req.user!, incident, input, req);
    const fresh = await loadIncidentFor(req.user!, req.params.id).catch(() => null);
    ok(res, { incident: fresh ? await serializeIncident(fresh.incident, fresh.level, fresh.viewer) : { id: String(incident._id), reassignedAway: true } });
    void viewer;
  }),
);

/** Members of a committee who can own the case (for triage admins and committee chairs). */
incidentsRouter.get(
  '/:id/assignable-staff',
  asyncHandler(async (req, res) => {
    const { incident, level } = await loadIncidentFor(req.user!, req.params.id);
    const isTriage = hasPermission({ role: req.user!.role as Role, permissions: req.user!.permissions }, 'incidents:triage');
    const isChair = level === 'handler' && (req.user!.committeeMemberships ?? []).some((m) => m.position === 'chair' && String(m.committeeId) === String(incident.committeeId));
    if (!isTriage && !isChair) throw notFound();
    const committeeId = isTriage && Types.ObjectId.isValid(String(req.query.committeeId)) ? String(req.query.committeeId) : String(incident.committeeId);
    const staff = await User.find({ 'committeeMemberships.committeeId': committeeId, accountStatus: 'active' }, { fullName: 1, role: 1 }).sort({ fullName: 1 }).lean();
    ok(res, staff.map((s) => ({ id: String(s._id), name: s.fullName, role: s.role })));
  }),
);

incidentsRouter.get(
  '/:id/notes',
  asyncHandler(async (req, res) => {
    const { incident, level } = await loadIncidentFor(req.user!, req.params.id);
    if (level !== 'handler') throw notFound();
    const notes = await CaseActivity.find({ incidentId: incident._id, type: 'internal_note' }).sort({ createdAt: 1 }).populate('actorId', 'fullName').lean();
    ok(res, notes.map((n) => ({ id: String(n._id), body: n.body, author: (n.actorId as unknown as { fullName?: string })?.fullName ?? 'Staff', createdAt: n.createdAt })));
  }),
);

incidentsRouter.post(
  '/:id/notes',
  asyncHandler(async (req, res) => {
    const { body } = parse(internalNoteSchema, req.body);
    const { incident, level } = await loadIncidentFor(req.user!, req.params.id);
    if (level !== 'handler') throw notFound();
    const note = await addInternalNote(req.user!, incident, body, req);
    ok(res, { id: String(note._id), body: note.body, author: req.user!.fullName, createdAt: note.createdAt }, 201);
  }),
);

// ------------------------------------------------------------------ case chat
incidentsRouter.get(
  '/:id/messages',
  asyncHandler(async (req, res) => {
    const { incident, level, viewer } = await loadIncidentFor(req.user!, req.params.id);
    if (!canChat(level)) throw notFound();
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 30));
    const filter: Record<string, unknown> = { caseId: incident._id };
    if (req.query.before && Types.ObjectId.isValid(String(req.query.before))) {
      const pivot = await CaseMessage.findOne({ _id: req.query.before, caseId: incident._id }, { createdAt: 1 }).lean();
      if (pivot) filter.createdAt = { $lt: pivot.createdAt };
    }
    const docs = await CaseMessage.find(filter).sort({ createdAt: -1 }).limit(limit + 1).lean();
    const hasMore = docs.length > limit;
    const page = docs.slice(0, limit).reverse();
    const files = await Evidence.find({ _id: { $in: page.flatMap((m) => m.attachmentIds) } }, { originalName: 1, mimeType: 1, sizeBytes: 1, sha256: 1 }).lean();
    const fileMap = new Map(files.map((f) => [String(f._id), attachmentView(f)]));
    const state = await CaseReadState.findOne({ caseId: incident._id, userKey: participantKey(level, viewer) }).lean();
    ok(res, {
      items: page.map((m) => serializeCaseMessage(m as never, viewer, level, fileMap)),
      hasMore,
      nextCursor: hasMore ? String(page[0]?._id) : null,
      lastReadAt: state?.lastReadAt ?? null,
      readOnly: ['closed', 'rejected'].includes(incident.status),
    });
  }),
);

incidentsRouter.post(
  '/:id/messages',
  asyncHandler(async (req, res) => {
    const input = parse(caseMessageSchema, req.body);
    const { incident, level, viewer } = await loadIncidentFor(req.user!, req.params.id);
    if (!canChat(level)) throw notFound();
    const { message, duplicate } = await postCaseMessage(req.user!, incident, level, viewer, input, req);
    const files = await Evidence.find({ _id: { $in: message.attachmentIds } }, { originalName: 1, mimeType: 1, sizeBytes: 1, sha256: 1 }).lean();
    ok(res, { message: serializeCaseMessage(message as never, viewer, level, new Map(files.map((f) => [String(f._id), attachmentView(f)]))), duplicate }, duplicate ? 200 : 201);
  }),
);

incidentsRouter.post(
  '/:id/attachments',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const { incident, level, viewer } = await loadIncidentFor(req.user!, req.params.id);
    if (!canChat(level)) throw notFound();
    const anon = level === 'reporter' && incident.anonymous;
    const doc = await storeUpload(req.file, {
      purpose: 'case_chat', mediaScope: 'case', incidentId: String(incident._id),
      uploaderId: anon ? null : viewer.id, uploaderTag: anon ? viewer.reporterTag : null,
    });
    ok(res, attachmentView(doc), 201);
  }),
);

incidentsRouter.post(
  '/:id/read-receipts',
  asyncHandler(async (req, res) => {
    const { upToMessageId } = parse(readReceiptSchema, req.body);
    const { incident, level, viewer } = await loadIncidentFor(req.user!, req.params.id);
    if (!canChat(level)) throw notFound();
    const msg = await CaseMessage.findOne({ _id: upToMessageId, caseId: incident._id }, { createdAt: 1 }).lean();
    if (!msg) throw notFound();
    await CaseReadState.findOneAndUpdate(
      { caseId: incident._id, userKey: participantKey(level, viewer) },
      { $max: { lastReadAt: msg.createdAt } },
      { upsert: true },
    );
    ok(res, { ok: true });
  }),
);

/** Read state of the other side, so senders can see "Seen". */
incidentsRouter.get(
  '/:id/read-state',
  asyncHandler(async (req, res) => {
    const { incident, level, viewer } = await loadIncidentFor(req.user!, req.params.id);
    if (!canChat(level)) throw notFound();
    const states = await CaseReadState.find({ caseId: incident._id, userKey: { $ne: participantKey(level, viewer) } }).lean();
    const reporterSeen = states.filter((s) => s.userKey.startsWith('reporter:') || (incident.reporterId && s.userKey === String(incident.reporterId))).map((s) => s.lastReadAt);
    const staffSeen = states.filter((s) => !s.userKey.startsWith('reporter:') && s.userKey !== String(incident.reporterId ?? '')).map((s) => s.lastReadAt);
    const latest = (arr: Date[]) => (arr.length ? new Date(Math.max(...arr.map((d) => d.getTime()))) : null);
    ok(res, { otherSideLastReadAt: level === 'reporter' ? latest(staffSeen) : latest(reporterSeen) });
  }),
);

// ------------------------------------------------------------------ files (authorised streaming)
incidentsRouter.get(
  '/files/:fileId',
  asyncHandler(async (req, res) => {
    await ensureCanAccessEvidence(req.user!, req.params.fileId);
    await streamFile(res, req, req.params.fileId, req.query.download === '1' ? 'attachment' : 'inline');
  }),
);

// ------------------------------------------------------------------ reporter actions: withdraw / reopen
for (const action of ['withdraw', 'reopen'] as const) {
  incidentsRouter.post(
    `/:id/${action}`,
    asyncHandler(async (req, res) => {
      const { reason } = parse(action === 'withdraw' ? incidentWithdrawSchema : incidentReopenSchema, req.body);
      const { incident, level, viewer } = await loadIncidentFor(req.user!, req.params.id);
      if (level !== 'reporter') throw notFound();
      await reporterAction(incident, viewer, action, reason, req);
      ok(res, await serializeIncident(incident, level, viewer));
    }),
  );
}
