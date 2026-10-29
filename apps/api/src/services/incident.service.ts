import type { Request } from 'express';
import { Types } from 'mongoose';
import {
  CATEGORY_INFO, REOPEN_WINDOW_DAYS, STATUS_LABELS, STUDENT_WITHDRAWABLE, TERMINAL_STATUSES, canTransition, formatCaseNumber,
  type IncidentCategory, type IncidentStatus, type Role,
} from '@campuscare/shared';
import { anonymousReporterTag } from '../lib/crypto';
import { AppError, notFound, forbidden } from '../lib/http';
import { CaseActivity, CaseMessage, CaseReadState, Committee, Evidence, Incident, RoutingRule, nextSequence, type IncidentDoc } from '../models/incident';
import { User, type UserDoc } from '../models/user';
import { knownCampus } from './campus-scope.service';
import { audit } from './audit.service';
import { notify, notifyMany } from './notification.service';
import { appLink } from './email/email.service';
import { getSettings } from './settings.service';
import { attachmentView } from './files.service';
import { emitToRoom, evictFromRoom, registerRoomAuthoriser } from '../realtime/socket';
import { incidentAccess, type AccessLevel, type Viewer } from './incident.policy';

export function viewerOf(user: UserDoc): Viewer {
  return {
    id: String(user._id),
    role: user.role as Role,
    permissions: user.permissions ?? [],
    committeeIds: (user.committeeMemberships ?? []).map((m) => String(m.committeeId)),
    reporterTag: anonymousReporterTag(String(user._id)),
  };
}

/** Loads a case and the caller's access level. Unknown or unauthorised ids both produce 404. */
export async function loadIncidentFor(user: UserDoc, incidentId: string): Promise<{ incident: IncidentDoc; level: AccessLevel; viewer: Viewer }> {
  if (!Types.ObjectId.isValid(incidentId)) throw notFound();
  const incident = await Incident.findById(incidentId).select('+reporterTag');
  if (!incident) throw notFound();
  const viewer = viewerOf(user);
  const level = incidentAccess(viewer, incident);
  if (level === 'none') {
    void audit({ action: 'incident.access_denied', actorId: viewer.id, actorRole: viewer.role, targetType: 'incident', targetId: incidentId, outcome: 'denied' });
    throw notFound();
  }
  return { incident, level, viewer };
}

registerRoomAuthoriser('case', async (user, caseId) => {
  try {
    const { level } = await loadIncidentFor(user, caseId);
    return level === 'reporter' || level === 'handler';
  } catch {
    return false;
  }
});

// ------------------------------------------------------------------ routing
export async function routeCategory(category: IncidentCategory) {
  const rule = await RoutingRule.findOne({ category }).lean();
  if (rule) {
    const committee = await Committee.findOne({ _id: rule.committeeId, active: true }).lean();
    if (committee) return { committee, priority: rule.defaultPriority };
  }
  const byCategory = await Committee.findOne({ categories: category, active: true }).lean();
  if (byCategory) return { committee: byCategory, priority: 'normal' as const };
  const byType = await Committee.findOne({ type: CATEGORY_INFO[category].defaultCommittee, active: true }).lean();
  return { committee: byType, priority: 'normal' as const };
}

async function committeeMemberIds(committeeId: unknown): Promise<string[]> {
  if (!committeeId) return [];
  const members = await User.find({ 'committeeMemberships.committeeId': committeeId, accountStatus: 'active' }, { _id: 1 }).lean();
  return members.map((m) => String(m._id));
}

// ------------------------------------------------------------------ create
export interface CreateIncidentInput {
  category: IncidentCategory;
  title: string;
  description: string;
  incidentDate: Date;
  location: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  urgent: boolean;
  anonymous: boolean;
  involvedParties?: string;
  preferredContact: 'in_app' | 'email' | 'phone';
  idempotencyKey: string;
  evidenceIds?: string[];
  latitude?: number;
  longitude?: number;
  suggestedCategory?: IncidentCategory;
}

export async function createIncident(user: UserDoc, input: CreateIncidentInput, req?: Request) {
  const existing = await Incident.findOne({ idempotencyKey: input.idempotencyKey }).select('+reporterTag');
  if (existing) {
    const viewer = viewerOf(user);
    if (incidentAccess(viewer, existing) !== 'reporter') throw new AppError(409, 'conflict', 'Duplicate submission key.');
    return existing; // retried submission — return the original instead of creating a duplicate
  }

  const settings = await getSettings();
  if (input.anonymous) {
    if (!settings.incidents.anonymousReportingEnabled || !settings.incidents.anonymousCategories.includes(input.category)) {
      throw new AppError(422, 'anonymous_not_allowed', 'Anonymous reporting is not available for this category under university policy.');
    }
  }
  const tag = anonymousReporterTag(String(user._id));
  const evidence = input.evidenceIds?.length
    ? await Evidence.find({ _id: { $in: input.evidenceIds }, purpose: 'evidence', bound: false }).select('+uploaderTag')
    : [];
  if (evidence.length !== (input.evidenceIds?.length ?? 0) || evidence.some((e) => String(e.uploaderId) !== String(user._id) && e.uploaderTag !== tag)) {
    throw new AppError(400, 'bad_evidence', 'One or more evidence files are invalid.');
  }
  if (evidence.length > settings.incidents.evidenceMaxFiles) throw new AppError(400, 'too_many_files', `Attach at most ${settings.incidents.evidenceMaxFiles} files.`);

  const { committee, priority } = await routeCategory(input.category);
  const year = new Date().getFullYear();
  const seq = await nextSequence(`case:${year}`);
  const now = Date.now();
  const ackHours = committee?.slaAcknowledgeHours ?? settings.incidents.acknowledgeWithinHours;
  const resolveDays = committee?.slaResolveDays ?? settings.incidents.resolveWithinDays;

  const incident = await Incident.create({
    caseNumber: formatCaseNumber(year, seq),
    category: input.category,
    title: input.title,
    description: input.description,
    incidentDate: input.incidentDate,
    location: input.location,
    involvedParties: input.involvedParties || null,
    severity: input.severity,
    priority: input.urgent || input.severity === 'critical' ? 'urgent' : priority,
    urgent: input.urgent,
    preferredContact: input.anonymous ? 'in_app' : input.preferredContact,
    reporterId: input.anonymous ? null : user._id,
    reporterTag: input.anonymous ? tag : null,
    anonymous: input.anonymous,
    committeeId: committee?._id ?? null,
    status: 'submitted',
    evidenceIds: evidence.map((e) => e._id),
    dueAcknowledgeAt: new Date(now + ackHours * 3600_000),
    dueResolveAt: new Date(now + resolveDays * 86400_000),
    idempotencyKey: input.idempotencyKey,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    suggestedCategory: input.suggestedCategory ?? null,
    campus: knownCampus(user.campusZone, ((await getSettings()).registration as { campuses?: { id: string }[] }).campuses?.map((c) => c.id) ?? []),
  });
  if (evidence.length) {
    await Evidence.updateMany({ _id: { $in: evidence.map((e) => e._id) } }, { $set: { bound: true, incidentId: incident._id } });
  }
  await CaseActivity.create({ incidentId: incident._id, type: 'created', actorId: null, actorRole: 'reporter', toStatus: 'submitted', studentVisible: true, body: 'Report submitted' });
  await audit({ action: 'incident.created', actorId: input.anonymous ? null : String(user._id), actorRole: 'student', targetType: 'incident', targetId: String(incident._id), meta: { category: input.category, anonymous: input.anonymous, committeeId: committee ? String(committee._id) : null }, req: input.anonymous ? undefined : req });

  if (!input.anonymous) {
    await notify({
      userId: String(user._id),
      kind: 'case',
      category: 'case_updates',
      title: `Report ${incident.caseNumber} received`,
      body: 'Your report was received and routed to the responsible team.',
      link: `/student/my-reports/${incident._id}`,
      email: { template: 'case_acknowledged', vars: { caseNumber: incident.caseNumber, link: appLink(`/student/my-reports/${incident._id}`) }, dedupeKey: `case-ack:${incident._id}` },
    });
  }
  // Anonymous reports: no notification or email record ties the account to the case.
  // The student follows it from My Reports, which is resolved through the pseudonymous tag.
  const members = await committeeMemberIds(committee?._id);
  await notifyMany(members, {
    kind: 'case_assigned',
    category: 'case_updates',
    priority: input.urgent ? 'high' : 'normal',
    title: `New ${CATEGORY_INFO[input.category].label.toLowerCase()} case ${incident.caseNumber}`,
    body: input.urgent ? 'Marked urgent by the reporter. Please triage now.' : 'A new case is waiting for triage.',
    link: `/committee/cases/${incident._id}`,
  });
  return incident;
}

// ------------------------------------------------------------------ views
export async function serializeIncident(incident: IncidentDoc, level: AccessLevel, viewer: Viewer) {
  const committee = incident.committeeId ? await Committee.findById(incident.committeeId, { name: 1, type: 1, confidential: 1 }).lean() : null;
  const assignee = incident.assignedTo && level !== 'reporter' ? await User.findById(incident.assignedTo, { fullName: 1 }).lean() : null;
  const base = {
    id: String(incident._id),
    caseNumber: incident.caseNumber,
    category: incident.category,
    status: incident.status,
    statusLabel: STATUS_LABELS[incident.status as IncidentStatus],
    severity: incident.severity,
    priority: incident.priority,
    urgent: incident.urgent,
    anonymous: incident.anonymous,
    committee: committee ? { id: String(committee._id), name: committee.name, type: committee.type } : null,
    createdAt: incident.createdAt,
    updatedAt: incident.updatedAt,
    incidentDate: incident.incidentDate,
    dueAcknowledgeAt: incident.dueAcknowledgeAt,
    dueResolveAt: incident.dueResolveAt,
    acknowledgedAt: incident.acknowledgedAt,
    resolvedAt: incident.resolvedAt,
    closedAt: incident.closedAt,
    accessLevel: level,
  };
  if (level === 'triage') {
    // Routing metadata only: no description, location detail, parties, evidence, chat or reporter identity.
    return { ...base, title: CATEGORY_INFO[incident.category as IncidentCategory].label + ' report', assignee: assignee ? { id: String(assignee._id), name: assignee.fullName } : null, redacted: true };
  }
  const evidence = await Evidence.find({ _id: { $in: incident.evidenceIds } }, { originalName: 1, mimeType: 1, sizeBytes: 1, sha256: 1 }).lean();
  const reporter = level === 'handler' && incident.reporterId && !incident.anonymous
    ? await User.findById(incident.reporterId, { fullName: 1, email: 1, studentId: 1, department: 1, phone: 1 }).lean()
    : null;
  const unread = await unreadCount(String(incident._id), level === 'reporter' ? `reporter:${viewer.reporterTag}` : viewer.id, incident.lastMessageAt);
  return {
    ...base,
    title: incident.title,
    description: incident.description,
    location: incident.location,
    involvedParties: incident.involvedParties,
    preferredContact: incident.preferredContact,
    evidence: evidence.map(attachmentView),
    assignee: assignee ? { id: String(assignee._id), name: assignee.fullName } : null,
    reporter: reporter
      ? { id: String(reporter._id), name: reporter.fullName, email: reporter.email, studentId: reporter.studentId, department: reporter.department, phone: incident.preferredContact === 'phone' ? reporter.phone : null }
      : null,
    resolutionSummary: incident.resolutionSummary,
    unreadMessages: unread,
    redacted: false,
  };
}

export function listSummary(i: IncidentDoc | (Record<string, unknown> & { _id: unknown }), level: AccessLevel) {
  const inc = i as unknown as IncidentDoc;
  return {
    id: String(inc._id),
    caseNumber: inc.caseNumber,
    title: level === 'triage' ? CATEGORY_INFO[inc.category as IncidentCategory].label + ' report' : inc.title,
    category: inc.category,
    status: inc.status,
    statusLabel: STATUS_LABELS[inc.status as IncidentStatus],
    severity: inc.severity,
    priority: inc.priority,
    urgent: inc.urgent,
    anonymous: inc.anonymous,
    committeeId: inc.committeeId ? String(inc.committeeId) : null,
    assignedTo: inc.assignedTo ? String(inc.assignedTo) : null,
    createdAt: inc.createdAt,
    updatedAt: inc.updatedAt,
    dueAcknowledgeAt: inc.dueAcknowledgeAt,
    dueResolveAt: inc.dueResolveAt,
    lastMessageAt: inc.lastMessageAt,
    overdue: Boolean(
      (!inc.acknowledgedAt && inc.dueAcknowledgeAt && inc.dueAcknowledgeAt < new Date() && !TERMINAL_STATUSES.includes(inc.status as IncidentStatus)) ||
        (inc.dueResolveAt && inc.dueResolveAt < new Date() && !['resolved', 'closed', 'rejected'].includes(inc.status)),
    ),
  };
}

export async function timelineFor(incidentId: string, level: AccessLevel) {
  const filter: Record<string, unknown> = { incidentId };
  if (level === 'reporter') filter.studentVisible = true;
  if (level === 'triage') filter.type = { $in: ['created', 'status_changed', 'assigned', 'escalated', 'priority_changed'] };
  const items = await CaseActivity.find(filter).sort({ createdAt: 1 }).lean();
  const actorIds = [...new Set(items.map((a) => a.actorId).filter(Boolean).map(String))];
  const actors = level === 'reporter' ? [] : await User.find({ _id: { $in: actorIds } }, { fullName: 1 }).lean();
  const names = new Map(actors.map((a) => [String(a._id), a.fullName]));
  return items.map((a) => ({
    id: String(a._id),
    type: a.type,
    fromStatus: a.fromStatus,
    toStatus: a.toStatus,
    studentVisible: a.studentVisible,
    body: level === 'triage' && a.type !== 'status_changed' ? null : a.body,
    actor: level === 'reporter' ? (a.actorRole === 'reporter' ? 'You' : 'Case team') : a.actorId ? names.get(String(a.actorId)) ?? 'Staff' : a.actorRole === 'reporter' ? 'Reporter' : 'System',
    createdAt: a.createdAt,
  }));
}

// ------------------------------------------------------------------ workflow
async function reporterUserId(incident: IncidentDoc): Promise<string | null> {
  if (incident.reporterId) return String(incident.reporterId);
  return null; // anonymous reporters get in-app updates through their tagged view only
}

export async function changeStatus(actor: UserDoc, incident: IncidentDoc, to: IncidentStatus, opts: { studentVisibleNote?: string; reason?: string }, req?: Request) {
  const from = incident.status as IncidentStatus;
  if (!canTransition(from, to)) throw new AppError(422, 'invalid_transition', `A case cannot move from "${STATUS_LABELS[from]}" to "${STATUS_LABELS[to]}".`);
  if ((to === 'rejected' || to === 'closed') && !opts.reason) throw new AppError(422, 'reason_required', 'A reason is required to close or reject a case.');
  if (to === 'resolved' && !opts.studentVisibleNote) throw new AppError(422, 'summary_required', 'Add a resolution summary that the student can see.');

  incident.status = to;
  const now = new Date();
  if (!incident.acknowledgedAt && !['submitted'].includes(to)) incident.acknowledgedAt = now;
  if (to === 'escalated') incident.escalatedAt = now;
  if (to === 'resolved') { incident.resolvedAt = now; incident.resolutionSummary = opts.studentVisibleNote ?? null; }
  if (to === 'closed') { incident.closedAt = now; incident.closureReason = opts.reason ?? null; }
  if (to === 'rejected') incident.closureReason = opts.reason ?? null;
  incident.lastStudentVisibleUpdateAt = now;
  await incident.save();

  await CaseActivity.create({
    incidentId: incident._id, type: 'status_changed', actorId: actor._id, actorRole: actor.role, fromStatus: from, toStatus: to,
    studentVisible: true, body: opts.studentVisibleNote ?? null, meta: { reason: opts.reason ? 'provided' : null },
  });
  if (opts.reason) {
    await CaseActivity.create({ incidentId: incident._id, type: 'internal_note', actorId: actor._id, actorRole: actor.role, studentVisible: false, body: `Reason (${STATUS_LABELS[to]}): ${opts.reason}` });
  }
  await audit({ action: 'incident.status_changed', req, targetType: 'incident', targetId: String(incident._id), meta: { from, to } });
  emitToRoom(`case:${incident._id}`, 'case:updated', { id: String(incident._id), status: to });

  const settings = await getSettings();
  const reporter = await reporterUserId(incident);
  if (reporter) {
    await notify({
      userId: reporter, kind: 'case', category: 'case_updates', priority: 'high', title: `Case ${incident.caseNumber}: ${STATUS_LABELS[to]}`, body: 'There is an update on your report.',
      link: `/student/my-reports/${incident._id}`,
      email: settings.notifications.emailOnCaseUpdate ? { template: 'case_updated', vars: { caseNumber: incident.caseNumber, status: STATUS_LABELS[to], link: appLink(`/student/my-reports/${incident._id}`) } } : undefined,
    });
  }
  return incident;
}

export async function assignIncident(actor: UserDoc, incident: IncidentDoc, input: { committeeId: string; assigneeId?: string | null; priority?: string; reason?: string }, req?: Request) {
  const committee = await Committee.findOne({ _id: input.committeeId, active: true });
  if (!committee) throw new AppError(422, 'invalid_committee', 'Choose an active committee.');
  let assignee: UserDoc | null = null;
  if (input.assigneeId) {
    assignee = await User.findOne({ _id: input.assigneeId, accountStatus: 'active', 'committeeMemberships.committeeId': committee._id });
    if (!assignee) throw new AppError(422, 'invalid_assignee', 'The case owner must be an active member of that committee.');
  }
  const previousAssignee = incident.assignedTo ? String(incident.assignedTo) : null;
  const previousCommittee = incident.committeeId ? String(incident.committeeId) : null;
  incident.committeeId = committee._id;
  incident.assignedTo = assignee?._id ?? null;
  if (input.priority) incident.priority = input.priority as typeof incident.priority;
  if (incident.status === 'submitted' || incident.status === 'triage') {
    incident.status = 'assigned';
    incident.acknowledgedAt = incident.acknowledgedAt ?? new Date();
    await CaseActivity.create({ incidentId: incident._id, type: 'status_changed', actorId: actor._id, actorRole: actor.role, fromStatus: 'submitted', toStatus: 'assigned', studentVisible: true, body: 'Your case has been assigned to an authorised case handler.' });
  }
  await incident.save();
  await CaseActivity.create({
    incidentId: incident._id, type: 'assigned', actorId: actor._id, actorRole: actor.role, studentVisible: false,
    body: input.reason ?? null, meta: { committeeId: String(committee._id), assigneeId: assignee ? String(assignee._id) : null, previousAssignee, previousCommittee },
  });
  await audit({ action: previousAssignee || previousCommittee !== String(committee._id) ? 'incident.reassigned' : 'incident.assigned', req, targetType: 'incident', targetId: String(incident._id), meta: { committeeId: String(committee._id), assigneeId: assignee ? String(assignee._id) : null, previousAssignee } });

  // Revoke live access for anyone who lost it.
  if (previousAssignee && previousAssignee !== String(assignee?._id ?? '')) await evictFromRoom(previousAssignee, `case:${incident._id}`);
  if (assignee) {
    await notify({ userId: String(assignee._id), kind: 'case_assigned', category: 'case_updates', priority: 'high', title: `You own case ${incident.caseNumber}`, body: 'A case has been assigned to you.', link: `/committee/cases/${incident._id}` });
  }
  emitToRoom(`case:${incident._id}`, 'case:updated', { id: String(incident._id), status: incident.status });
  return incident;
}

export async function addInternalNote(actor: UserDoc, incident: IncidentDoc, body: string, req?: Request) {
  const note = await CaseActivity.create({ incidentId: incident._id, type: 'internal_note', actorId: actor._id, actorRole: actor.role, studentVisible: false, body });
  await audit({ action: 'incident.internal_note', req, targetType: 'incident', targetId: String(incident._id) });
  return note;
}

// ------------------------------------------------------------------ case chat
export async function unreadCount(caseId: string, userKey: string, lastMessageAt?: Date | null) {
  if (!lastMessageAt) return 0;
  const state = await CaseReadState.findOne({ caseId, userKey }).lean();
  const since = state?.lastReadAt ?? new Date(0);
  if (lastMessageAt <= since) return 0;
  return CaseMessage.countDocuments({ caseId, createdAt: { $gt: since }, deletedAt: null });
}

export function participantKey(level: AccessLevel, viewer: Viewer) {
  return level === 'reporter' ? `reporter:${viewer.reporterTag}` : viewer.id;
}

export function serializeCaseMessage(m: Record<string, unknown> & { _id: unknown }, viewer: Viewer, level: AccessLevel, attachments: Map<string, ReturnType<typeof attachmentView>>) {
  const msg = m as unknown as { _id: unknown; senderId: unknown; senderKind: string; senderLabel: string; body: string; attachmentIds: unknown[]; clientMessageId: string; createdAt: Date; deletedAt: Date | null; messageType: string };
  const mine = msg.senderKind === 'reporter' ? level === 'reporter' : String(msg.senderId) === viewer.id;
  return {
    id: String(msg._id),
    senderKind: msg.senderKind,
    // Students see role labels ("Anti-Ragging Committee"), not staff personal details.
    senderLabel: mine ? 'You' : msg.senderLabel,
    mine,
    body: msg.deletedAt ? '' : msg.body,
    deleted: Boolean(msg.deletedAt),
    messageType: msg.messageType,
    attachments: (msg.attachmentIds ?? []).map((a) => attachments.get(String(a))).filter(Boolean),
    clientMessageId: msg.clientMessageId,
    createdAt: msg.createdAt,
  };
}

export async function postCaseMessage(user: UserDoc, incident: IncidentDoc, level: AccessLevel, viewer: Viewer, input: { body: string; attachmentIds: string[]; clientMessageId: string }, req?: Request) {
  if (TERMINAL_STATUSES.includes(incident.status as IncidentStatus)) throw new AppError(409, 'case_closed', 'This case is closed. The conversation is read-only.');
  if (!input.body.trim() && !input.attachmentIds.length) throw new AppError(422, 'empty', 'Write a message or attach a file.');
  const existing = await CaseMessage.findOne({ caseId: incident._id, clientMessageId: input.clientMessageId }).lean();
  if (existing) return { message: existing, duplicate: true };

  let attachments: { _id: unknown }[] = [];
  if (input.attachmentIds.length) {
    const { bindUploads } = await import('./files.service');
    attachments = await bindUploads(input.attachmentIds, {
      purpose: 'case_chat',
      incidentId: String(incident._id),
      ...(level === 'reporter' && incident.anonymous ? { uploaderTag: viewer.reporterTag } : { uploaderId: viewer.id }),
    });
    // Re-check the Super Admin media switch at send time (it may have been turned off after upload).
    const policy = (await getSettings()).chat.media.case;
    for (const a of attachments as { mimeType?: string }[]) {
      const isVideo = (a.mimeType ?? '').startsWith('video/');
      if ((isVideo && !policy.videos) || (!isVideo && !policy.images)) throw new AppError(403, 'media_disabled', `${isVideo ? 'Video' : 'Image'} sending is turned off by your administrator.`);
    }
  }
  let senderLabel = 'Reporter';
  if (level === 'handler') {
    const committee = incident.committeeId ? await Committee.findById(incident.committeeId, { name: 1 }).lean() : null;
    senderLabel = committee?.name ?? 'Case team';
  } else if (!incident.anonymous) {
    senderLabel = user.fullName;
  }
  const message = await CaseMessage.create({
    caseId: incident._id,
    senderId: level === 'reporter' && incident.anonymous ? null : user._id,
    senderKind: level === 'reporter' ? 'reporter' : 'staff',
    senderLabel,
    messageType: attachments.length ? 'attachment' : 'text',
    body: input.body,
    attachmentIds: attachments.map((a) => a._id),
    clientMessageId: input.clientMessageId,
  });
  incident.messageCount = (incident.messageCount ?? 0) + 1;
  incident.lastMessageAt = message.createdAt;
  if (level === 'handler' && !incident.acknowledgedAt) incident.acknowledgedAt = new Date();
  await incident.save();
  await CaseReadState.findOneAndUpdate({ caseId: incident._id, userKey: participantKey(level, viewer) }, { $set: { lastReadAt: message.createdAt } }, { upsert: true });
  await audit({ action: 'incident.message_sent', actorId: level === 'reporter' && incident.anonymous ? null : viewer.id, actorRole: level, targetType: 'incident', targetId: String(incident._id), meta: { attachments: attachments.length }, req: level === 'reporter' && incident.anonymous ? undefined : req });

  emitToRoom(`case:${incident._id}`, 'case:message', { caseId: String(incident._id), messageId: String(message._id) });

  // Notify the other side without including message content.
  const settings = await getSettings();
  if (level === 'handler') {
    const reporter = await reporterUserId(incident);
    if (reporter) {
      await notify({
        userId: reporter, kind: 'case_message', category: 'case_updates', title: `New message on ${incident.caseNumber}`, body: 'The case team sent you a message.', link: `/student/my-reports/${incident._id}#chat`,
        email: settings.notifications.emailOnNewCaseMessage ? { template: 'case_message', vars: { caseNumber: incident.caseNumber, link: appLink(`/student/my-reports/${incident._id}#chat`) } } : undefined,
      });
    }
  } else {
    const recipients = incident.assignedTo ? [String(incident.assignedTo)] : await committeeMemberIds(incident.committeeId);
    await notifyMany(recipients.filter((r) => r !== viewer.id), { kind: 'case_message', category: 'case_updates', title: `New message on ${incident.caseNumber}`, body: 'The reporter sent a message.', link: `/committee/cases/${incident._id}#chat` });
  }
  return { message, duplicate: false };
}

export async function ensureCanAccessEvidence(user: UserDoc, evidenceId: string) {
  if (!Types.ObjectId.isValid(evidenceId)) throw notFound();
  const ev = await Evidence.findById(evidenceId).select('+uploaderTag');
  if (!ev || !ev.incidentId) throw notFound();
  const { incident, level } = await loadIncidentFor(user, String(ev.incidentId));
  if (level !== 'reporter' && level !== 'handler') throw forbidden();
  await CaseActivity.create({ incidentId: incident._id, type: 'evidence_accessed', actorId: level === 'reporter' && incident.anonymous ? null : user._id, actorRole: level, studentVisible: false, meta: { evidenceId } });
  await audit({ action: 'evidence.accessed', actorId: level === 'reporter' && incident.anonymous ? null : String(user._id), actorRole: level, targetType: 'evidence', targetId: evidenceId, meta: { incidentId: String(incident._id) } });
  return ev;
}

/**
 * Reporter actions (where university policy allows):
 * - withdraw: before the case is resolved; the case team is told, nothing is deleted.
 * - reopen: within REOPEN_WINDOW_DAYS of resolution, if the student is not satisfied.
 */
export async function reporterAction(incident: IncidentDoc, viewer: Viewer, action: 'withdraw' | 'reopen', reason: string, req?: Request) {
  const from = incident.status as IncidentStatus;
  const now = new Date();
  if (action === 'withdraw') {
    if (!STUDENT_WITHDRAWABLE.includes(from)) throw new AppError(409, 'cannot_withdraw', 'This case can no longer be withdrawn. Message the case team instead.');
    incident.status = 'withdrawn';
    incident.withdrawnAt = now;
    incident.closureReason = 'Withdrawn by reporter';
  } else {
    if (from !== 'resolved') throw new AppError(409, 'cannot_reopen', 'Only resolved cases can be reopened.');
    const resolvedAt = incident.resolvedAt?.getTime() ?? 0;
    if (Date.now() - resolvedAt > REOPEN_WINDOW_DAYS * 86400_000) throw new AppError(409, 'reopen_window_passed', `Cases can be reopened within ${REOPEN_WINDOW_DAYS} days of resolution. Please submit a new report.`);
    if ((incident.reopenCount ?? 0) >= 2) throw new AppError(409, 'reopen_limit', 'This case has already been reopened twice. Please contact the committee directly.');
    incident.status = 'reopened';
    incident.reopenedAt = now;
    incident.reopenCount = (incident.reopenCount ?? 0) + 1;
    incident.resolvedAt = null;
  }
  incident.lastStudentVisibleUpdateAt = now;
  await incident.save();
  await CaseActivity.create({
    incidentId: incident._id, type: 'status_changed', actorId: null, actorRole: 'reporter', fromStatus: from, toStatus: incident.status,
    studentVisible: true, body: action === 'withdraw' ? 'You withdrew this report.' : `Reopened by the reporter: ${reason}`,
  });
  if (action === 'withdraw') {
    await CaseActivity.create({ incidentId: incident._id, type: 'internal_note', actorId: null, actorRole: 'reporter', studentVisible: false, body: `Withdrawal reason: ${reason}` });
  }
  await audit({ action: `incident.${action === 'withdraw' ? 'withdrawn' : 'reopened'}`, actorId: incident.anonymous ? null : viewer.id, actorRole: 'student', targetType: 'incident', targetId: String(incident._id), req: incident.anonymous ? undefined : req });
  emitToRoom(`case:${incident._id}`, 'case:updated', { id: String(incident._id), status: incident.status });
  const recipients = incident.assignedTo ? [String(incident.assignedTo)] : await committeeMemberIds(incident.committeeId);
  await notifyMany(recipients, {
    kind: 'case', category: 'case_updates', priority: action === 'reopen' ? 'high' : 'normal',
    title: `Case ${incident.caseNumber} ${action === 'withdraw' ? 'withdrawn' : 'reopened'} by the reporter`,
    body: action === 'withdraw' ? 'The reporter withdrew this case.' : 'The reporter reopened this case. Please review it.',
    link: `/committee/cases/${incident._id}`,
  });
  return incident;
}
