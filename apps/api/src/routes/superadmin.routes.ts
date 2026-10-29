import { ResponseZone } from '../models/duty';
import { Router } from 'express';
import { Types } from 'mongoose';
import dns from 'node:dns/promises';
import {
  DEFAULT_SETTINGS, SOS_ACTIVE_STATUSES, dataRequestDecisionSchema, EXPLICIT_ONLY_PERMISSIONS, PERMISSIONS, ROLE_PERMISSIONS, MAIN_ROLES, ROLE_LABELS, MAIN_ROLE_DEFINITIONS, type MainRole, chatChannelSchema, domainSchema, domainUpdateSchema,
  emailProviderSchema, emailTemplateSchema, emergencyRecipientSchema, identityProviderSchema, routingRuleSchema, userRoleSchema, type Role,
} from '@campuscare/shared';
import { z } from 'zod';
import { AppError, asyncHandler, notFound, ok, pageParams, parse } from '../lib/http';
import { encryptSecret, maskSecret, randomToken } from '../lib/crypto';
import { requireAuth, requireMfaPolicy, requirePermission, requireRecentAuth } from '../middleware/auth';
import { EmailDelivery, EmailDomain, EmailProviderConfig, EmailTemplate, IdentityProviderConfig, InboundEmailEvent, Job, AuditLog } from '../models/platform';
import { Committee, RoutingRule } from '../models/incident';
import { ChatChannel, ChatMessage } from '../models/chat';
import { EmergencyAlert, EmergencyRecipient, LocationShare, SafeWalkSession, TrustedContact } from '../models/safety';
import { DeviceRegistration } from '../models/mobile';
import { DataRequest } from '../models/community';
import { pushConfigured } from '../services/push.service';
import { Notification } from '../models/content';
import { ExternalIdentity, Session, User, publicUser } from '../models/user';
import { getSettings, updateSettings } from '../services/settings.service';
import { audit } from '../services/audit.service';
import { DEFAULT_TEMPLATES, TEMPLATE_KEYS, renderTemplate, type TemplateKey } from '../services/email/templates';
import { bounceCheck, checkBounces, emailReadiness, maskEmail, providerSummary, sendEmail, sendTestEmail, verifyEmailProvider } from '../services/email/email.service';
import { workerStatus } from '../services/jobs.service';
import { revokeAllSessions } from '../services/auth.service';
import { removeTotp } from '../services/mfa.service';
import { googleRedirectUri } from '../services/google.service';
import { databaseReady } from '../db/connect';
import { disconnectUser, emitBroadcast } from '../realtime/socket';
import { env, turnstileKeys } from '../config/env';
import { superAdminUsersRouter } from './superadmin-users.routes';
import { staffApplicationsRouter } from './staff-applications.routes';

export const superAdminRouter = Router();
superAdminRouter.use(requireAuth, requirePermission('super_admin:access'), requireMfaPolicy);
superAdminRouter.use('/users', superAdminUsersRouter);
superAdminRouter.use('/staff-applications', staffApplicationsRouter);

/** Diff of changed setting paths only, for audit (values of secrets are never stored). */
function changedPaths(before: unknown, after: unknown, prefix = ''): string[] {
  if (typeof before !== 'object' || before === null || typeof after !== 'object' || after === null) return before === after ? [] : [prefix];
  const keys = new Set([...Object.keys(before as object), ...Object.keys(after as object)]);
  return [...keys].flatMap((k) => changedPaths((before as Record<string, unknown>)[k], (after as Record<string, unknown>)[k], prefix ? `${prefix}.${k}` : k));
}

// ------------------------------------------------------------------ dashboard / health
superAdminRouter.get(
  '/dashboard',
  asyncHandler(async (_req, res) => {
    const [users, byRole, domains, failedEmails, pendingJobs, failedJobs, activeSessions, inboundQuarantine, google, provider] = await Promise.all([
      User.countDocuments({}),
      User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
      EmailDomain.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      EmailDelivery.countDocuments({ status: 'failed', createdAt: { $gt: new Date(Date.now() - 86400_000) } }),
      Job.countDocuments({ status: 'pending' }),
      Job.countDocuments({ status: 'failed' }),
      Session.countDocuments({ revokedAt: null, expiresAt: { $gt: new Date() } }),
      InboundEmailEvent.countDocuments({ outcome: 'quarantined', createdAt: { $gt: new Date(Date.now() - 7 * 86400_000) } }),
      IdentityProviderConfig.findOne({ provider: 'google' }).lean(),
      EmailProviderConfig.findOne({ active: true }).lean(),
    ]);
    const settings = await getSettings();
    ok(res, {
      users: { total: users, byRole: Object.fromEntries(byRole.map((r) => [r._id, r.count])), activeSessions },
      domains: Object.fromEntries(domains.map((d) => [d._id, d.count])),
      health: {
        database: databaseReady() ? 'ok' : 'down',
        emailProvider: provider ? (provider.type === 'nodemailer' ? `Nodemailer · ${provider.service}` : 'console') : env.EMAIL_PROVIDER === 'nodemailer' ? `Nodemailer · ${env.MAIL_SERVICE}` : 'console',
        emailFailures24h: failedEmails,
        jobsPending: pendingJobs,
        jobsFailed: failedJobs,
        turnstile: turnstileKeys.secret ? (env.TURNSTILE_SECRET ? 'configured' : 'test keys (development)') : 'not configured',
        googleOAuth: google?.enabled ? 'enabled' : 'disabled',
        inboundQuarantined7d: inboundQuarantine,
        storage: 'local private disk',
      },
      features: {
        sos: settings.sos.enabled, safeWalk: settings.safeWalk.enabled, community: settings.chat.communityEnabled,
        chatMedia: settings.chat.media, maintenanceMode: settings.platform.maintenanceMode,
      },
    });
  }),
);

// ------------------------------------------------------------------ settings (incl. chat media switches)
superAdminRouter.get('/settings', requirePermission('settings:manage'), asyncHandler(async (_req, res) => ok(res, { settings: await getSettings(), defaults: DEFAULT_SETTINGS })));

superAdminRouter.patch(
  '/settings',
  requirePermission('settings:manage'),
  requireRecentAuth,
  asyncHandler(async (req, res) => {
    const patch = req.body?.settings;
    if (!patch || typeof patch !== 'object') throw new AppError(422, 'validation_failed', 'Provide settings to change.');
    // Turning off SOS is an essential-safety change: require explicit confirmation text.
    if (patch.sos?.enabled === false && req.body?.confirm !== 'DISABLE SOS') {
      throw new AppError(422, 'confirmation_required', 'Type DISABLE SOS to confirm turning off emergency alerts.');
    }
    const { before, after } = await updateSettings(patch, String(req.user!._id));
    const paths = changedPaths(before, after);
    await audit({ action: 'settings.updated', req, targetType: 'settings', targetId: 'platform', meta: { paths } });
    emitBroadcast('config:updated', { paths, at: new Date() });
    ok(res, { settings: after, changed: paths });
  }),
);

// ------------------------------------------------------------------ approved domains
superAdminRouter.get(
  '/domains',
  requirePermission('domains:manage'),
  asyncHandler(async (_req, res) => {
    const list = await EmailDomain.find({}).sort({ domain: 1 }).lean();
    const counts = await User.aggregate([{ $project: { d: { $arrayElemAt: [{ $split: ['$email', '@'] }, 1] } } }, { $group: { _id: '$d', n: { $sum: 1 } } }]);
    const map = new Map(counts.map((c) => [c._id, c.n]));
    ok(res, list.map((d) => ({ id: String(d._id), domain: d.domain, purpose: d.purpose, status: d.status, verifiedAt: d.verifiedAt, lastCheckedAt: d.lastCheckedAt, note: d.note, txtRecord: `campuscare-verification=${d.verificationToken}`, users: map.get(d.domain) ?? 0 })));
  }),
);

superAdminRouter.post(
  '/domains',
  requirePermission('domains:manage'),
  requireRecentAuth,
  asyncHandler(async (req, res) => {
    const input = parse(domainSchema, req.body);
    const d = await EmailDomain.create({ ...input, verificationToken: randomToken(18), createdBy: req.user!._id });
    await audit({ action: 'domain.added', req, targetType: 'domain', targetId: d.domain, meta: { purpose: input.purpose } });
    ok(res, { id: String(d._id), domain: d.domain, status: d.status, txtRecord: `campuscare-verification=${d.verificationToken}` }, 201);
  }),
);

/** Ownership check: looks up the DNS TXT record. Optional manual approval is also supported (audited). */
superAdminRouter.post(
  '/domains/:id/verify',
  requirePermission('domains:manage'),
  requireRecentAuth,
  asyncHandler(async (req, res) => {
    const d = await EmailDomain.findById(req.params.id);
    if (!d) throw notFound();
    const manual = req.body?.manual === true;
    let found = false;
    if (!manual) {
      try {
        const records = await dns.resolveTxt(d.domain);
        found = records.some((r) => r.join('') === `campuscare-verification=${d.verificationToken}`);
      } catch {
        found = false;
      }
    }
    d.lastCheckedAt = new Date();
    if (found || manual) {
      d.status = 'active';
      d.verifiedAt = new Date();
    }
    await d.save();
    await audit({ action: manual ? 'domain.approved_manually' : 'domain.verify_attempt', req, targetType: 'domain', targetId: d.domain, outcome: found || manual ? 'success' : 'failure' });
    if (!found && !manual) throw new AppError(422, 'not_verified', `TXT record not found yet. Add "campuscare-verification=${d.verificationToken}" to ${d.domain} and try again (DNS can take time).`);
    ok(res, { status: d.status });
  }),
);

superAdminRouter.patch(
  '/domains/:id',
  requirePermission('domains:manage'),
  requireRecentAuth,
  asyncHandler(async (req, res) => {
    const input = parse(domainUpdateSchema, req.body);
    const d = await EmailDomain.findById(req.params.id);
    if (!d) throw notFound();
    if (input.status === 'active' && !d.verifiedAt) throw new AppError(422, 'not_verified', 'Verify the domain before activating it.');
    Object.assign(d, input);
    await d.save();
    await audit({ action: 'domain.updated', req, targetType: 'domain', targetId: d.domain, meta: input });
    ok(res, { ok: true });
  }),
);

superAdminRouter.delete(
  '/domains/:id',
  requirePermission('domains:manage'),
  requireRecentAuth,
  asyncHandler(async (req, res) => {
    const d = await EmailDomain.findByIdAndDelete(req.params.id);
    if (!d) throw notFound();
    await audit({ action: 'domain.removed', req, targetType: 'domain', targetId: d.domain });
    ok(res, { ok: true });
  }),
);

// ------------------------------------------------------------------ identity providers (Google OAuth)
superAdminRouter.get(
  '/identity-providers',
  requirePermission('identity_providers:manage'),
  asyncHandler(async (_req, res) => {
    const g = await IdentityProviderConfig.findOne({ provider: 'google' }).select('+clientSecretEnc').lean();
    ok(res, [{
      provider: 'google', enabled: g?.enabled ?? false, clientId: g?.clientId ?? env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: g?.clientSecretEnc ? 'â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢(stored)' : env.GOOGLE_CLIENT_SECRET ? 'â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢(from environment)' : null,
      allowedDomains: g?.allowedDomains ?? [], redirectUri: googleRedirectUri(), authorizedOrigin: env.WEB_ORIGIN,
    }]);
  }),
);

superAdminRouter.patch(
  '/identity-providers/google',
  requirePermission('identity_providers:manage'),
  requireRecentAuth,
  asyncHandler(async (req, res) => {
    const input = parse(identityProviderSchema, req.body);
    const update: Record<string, unknown> = { enabled: input.enabled, allowedDomains: input.allowedDomains, updatedBy: req.user!._id };
    if (input.clientId !== undefined) update.clientId = input.clientId || null;
    if (input.clientSecret) update.clientSecretEnc = encryptSecret(input.clientSecret); // write-only
    await IdentityProviderConfig.findOneAndUpdate({ provider: 'google' }, { $set: update }, { upsert: true });
    await audit({ action: 'identity_provider.updated', req, targetType: 'identity_provider', targetId: 'google', meta: { enabled: input.enabled, secretChanged: Boolean(input.clientSecret), allowedDomains: input.allowedDomains } });
    ok(res, { ok: true });
  }),
);

// ------------------------------------------------------------------ outbound email
superAdminRouter.get(
  '/email/providers',
  requirePermission('email:manage'),
  asyncHandler(async (_req, res) => {
    const list = await EmailProviderConfig.find({}).select('+authPassEnc').lean();
    ok(res, {
      providers: list.map((p) => ({ id: String(p._id), type: p.type, service: p.service, fromName: p.fromName, fromEmail: p.fromEmail, user: p.authUser, appPassword: p.authPassEnc ? maskSecret('stored') : null, active: p.active, updatedAt: p.updatedAt })),
      environmentFallback: { type: env.EMAIL_PROVIDER, service: env.EMAIL_PROVIDER === 'nodemailer' ? env.MAIL_SERVICE : null, from: env.EMAIL_FROM || env.MAIL_USER || null },
    });
  }),
);

async function saveProvider(id: string | null, body: unknown, actorId: string) {
  const input = parse(emailProviderSchema, body);
  if (input.type === 'console' && env.NODE_ENV === 'production') throw new AppError(422, 'validation_failed', 'The console provider cannot be used in production.');
  const existing = id ? await EmailProviderConfig.findById(id).select('+authPassEnc').lean() : null;
  if (id && !existing) throw notFound();
  if (input.type === 'nodemailer') {
    if (!input.user) throw new AppError(422, 'validation_failed', 'Enter the mailbox address to sign in with.', { fields: { user: 'Required' } });
    if (!input.appPassword && !existing?.authPassEnc) throw new AppError(422, 'validation_failed', 'Enter the app password for this mailbox.', { fields: { appPassword: 'Required' } });
  }
  const fromEmail = input.fromEmail || input.user;
  if (!fromEmail) throw new AppError(422, 'validation_failed', 'Enter a From address.', { fields: { fromEmail: 'Required' } });
  const set: Record<string, unknown> = { type: input.type, service: input.service, fromName: input.fromName, fromEmail, authUser: input.user || null, active: input.active, updatedBy: actorId };
  if (input.appPassword) set.authPassEnc = encryptSecret(input.appPassword); // write-only
  if (input.active) await EmailProviderConfig.updateMany(id ? { _id: { $ne: id } } : {}, { $set: { active: false } });
  return id ? EmailProviderConfig.findByIdAndUpdate(id, { $set: set }, { new: true }) : EmailProviderConfig.create(set);
}

superAdminRouter.post('/email/providers', requirePermission('email:manage'), requireRecentAuth, asyncHandler(async (req, res) => {
  const p = await saveProvider(null, req.body, String(req.user!._id));
  await audit({ action: 'email_provider.created', req, targetType: 'email_provider', targetId: String(p!._id), meta: { type: p!.type, service: p!.service } });
  ok(res, { id: String(p!._id) }, 201);
}));

superAdminRouter.patch('/email/providers/:id', requirePermission('email:manage'), requireRecentAuth, asyncHandler(async (req, res) => {
  if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
  const p = await saveProvider(req.params.id, req.body, String(req.user!._id));
  if (!p) throw notFound();
  await audit({ action: 'email_provider.updated', req, targetType: 'email_provider', targetId: req.params.id, meta: { type: p.type, service: p.service, secretChanged: Boolean(req.body?.appPassword) } });
  ok(res, { ok: true });
}));

/**
 * Sends a test email right now (not via the queue) to the signed-in administrator's own address and
 * returns the provider's actual reply. Accepted by the provider is not the same as delivered.
 */
superAdminRouter.post('/email/test', requirePermission('email:manage'), asyncHandler(async (req, res) => {
  const check = await verifyEmailProvider();
  if (!check.ok) {
    await audit({ action: 'email.test_failed', req, outcome: 'failure', meta: { type: check.type, service: check.service, stage: 'login' } });
    throw new AppError(422, 'email_login_failed', `Could not sign in to the mail service: ${check.error ?? 'unknown error'}. Check the address and app password.`);
  }
  if (check.type !== 'nodemailer') {
    await sendEmail('security_alert', req.user!.email, { name: req.user!.fullName, message: 'This is a test email from the CampusCare Super Admin console.' });
    return ok(res, { ok: true, message: 'Development mode: the test email was written to the dev mail folder.' });
  }
  const r = await sendTestEmail(req.user!.email, req.user!.fullName);
  await audit({ action: r.ok ? 'email.test_sent' : 'email.test_failed', req, outcome: r.ok ? 'success' : 'failure', meta: { type: check.type, service: check.service, stage: r.stage } });
  if (!r.ok) throw new AppError(422, 'email_test_failed', `The mail service did not accept the test email (${r.stage}): ${r.error ?? 'unknown error'}`);
  ok(res, {
    ok: true,
    providerResponse: 'response' in r ? r.response : null,
    message: `${check.service} accepted the test email for ${req.user!.email} (reply: ${'response' in r ? r.response ?? 'none' : 'none'}). Accepted is not delivered: check the inbox and spam folder. If the mailbox does not exist, a bounce appears in the delivery log within about 10 minutes.`,
  });
}));

/** Everything needed to see why an account email did not arrive. No secrets, no tokens, masked addresses. */
superAdminRouter.get('/email/diagnostics', requirePermission('email:manage'), asyncHandler(async (req, res) => {
  if (req.query.checkBounces === '1') await checkBounces();
  const day = new Date(Date.now() - 86400_000);
  const week = new Date(Date.now() - 7 * 86400_000);
  const [provider, login, readiness, pendingEmailJobs, oldestPending, failedJobs24h, byStatus, recent, lastAccepted] = await Promise.all([
    providerSummary(),
    verifyEmailProvider(),
    emailReadiness(),
    Job.countDocuments({ type: 'email.send', status: { $in: ['pending', 'running'] } }),
    Job.findOne({ type: 'email.send', status: 'pending' }).sort({ createdAt: 1 }).select('createdAt runAt attempts lastError').lean(),
    Job.countDocuments({ type: 'email.send', status: 'failed', updatedAt: { $gte: day } }),
    EmailDelivery.aggregate([{ $match: { createdAt: { $gte: week } } }, { $group: { _id: { t: '$template', s: '$status' }, n: { $sum: 1 } } }]),
    EmailDelivery.find({ template: { $in: ['verify_email', 'verify_email_code', 'password_reset', 'password_reset_code'] } }).sort({ createdAt: -1 }).limit(20).lean(),
    EmailDelivery.findOne({ status: { $in: ['accepted_by_provider', 'sent'] } }).sort({ sentAt: -1 }).select('sentAt').lean(),
  ]);
  ok(res, {
    provider: { ...provider, login: { ok: login.ok, error: login.error ?? null } },
    readiness,
    worker: workerStatus(),
    queue: {
      pendingEmailJobs,
      oldestPendingSeconds: oldestPending ? Math.round((Date.now() - new Date(oldestPending.createdAt as Date).getTime()) / 1000) : null,
      oldestPendingLastError: oldestPending?.lastError ?? null,
      failedEmailJobs24h: failedJobs24h,
    },
    lastAcceptedAt: lastAccepted?.sentAt ?? null,
    counts7d: byStatus.map((b) => ({ template: b._id.t, status: b._id.s, count: b.n })),
    recentAccountEmails: recent.map((d) => ({
      id: String(d._id), template: d.template, to: d.toMasked, status: d.status, attempts: d.attempts,
      providerResponse: d.providerResponse ?? null, lastError: d.lastError, bounceReason: d.bounceReason ?? null, createdAt: d.createdAt, sentAt: d.sentAt,
    })),
    bounces: { ...bounceCheck, enabled: env.EMAIL_BOUNCE_TRACKING !== 'false' },
    // Names and non-secret values only; secrets are reported as set / not set.
    deployment: {
      NODE_ENV: env.NODE_ENV,
      EMAIL_PROVIDER: env.EMAIL_PROVIDER,
      MAIL_SERVICE: env.MAIL_SERVICE,
      MAIL_USER: env.MAIL_USER ? maskEmail(env.MAIL_USER) : null,
      MAIL_APP_PASSWORD: env.MAIL_APP_PASSWORD ? 'set' : 'not set',
      WEB_ORIGIN: env.WEB_ORIGIN,
      API_PUBLIC_URL: env.API_PUBLIC_URL,
      RUN_WORKER: env.RUN_WORKER,
      EMAIL_BOUNCE_TRACKING: env.EMAIL_BOUNCE_TRACKING,
    },
  });
}));

superAdminRouter.get('/email/templates', requirePermission('email:manage'), asyncHandler(async (_req, res) => {
  const overrides = await EmailTemplate.find({}).lean();
  const map = new Map(overrides.map((o) => [o.key, o]));
  ok(res, TEMPLATE_KEYS.map((key) => ({ key, customised: map.has(key), ...(map.get(key) ?? DEFAULT_TEMPLATES[key]) })));
}));

superAdminRouter.put('/email/templates/:key', requirePermission('email:manage'), requireRecentAuth, asyncHandler(async (req, res) => {
  const key = req.params.key as TemplateKey;
  if (!TEMPLATE_KEYS.includes(key)) throw notFound();
  const input = parse(emailTemplateSchema, req.body);
  if (['verify_email', 'password_reset', 'staff_invite', 'trusted_contact_consent'].includes(key) && !input.html.includes('{{link}}')) {
    throw new AppError(422, 'validation_failed', 'This template must include {{link}}.');
  }
  if (['verify_email_code', 'password_reset_code'].includes(key) && !(input.html.includes('{{code}}') && input.text.includes('{{code}}'))) {
    throw new AppError(422, 'validation_failed', 'This template must include {{code}} in both the HTML and the text version.');
  }
  await EmailTemplate.findOneAndUpdate({ key }, { $set: { ...input, updatedBy: req.user!._id } }, { upsert: true });
  await audit({ action: 'email_template.updated', req, targetType: 'email_template', targetId: key });
  ok(res, { ok: true });
}));

superAdminRouter.delete('/email/templates/:key', requirePermission('email:manage'), requireRecentAuth, asyncHandler(async (req, res) => {
  await EmailTemplate.deleteOne({ key: req.params.key });
  await audit({ action: 'email_template.reset', req, targetType: 'email_template', targetId: req.params.key });
  ok(res, { ok: true });
}));

superAdminRouter.post('/email/templates/:key/preview', requirePermission('email:manage'), asyncHandler(async (req, res) => {
  const input = parse(emailTemplateSchema, req.body);
  const s = await getSettings();
  ok(res, renderTemplate(input, { platformName: s.platform.name, universityName: s.platform.universityName, supportEmail: s.platform.supportEmail, name: 'Sample Student', link: `${env.WEB_ORIGIN}/example`, caseNumber: 'CC-2026-000001', status: 'In progress', when: '24 Oct 2026, 11:30', title: 'Sample alert', message: 'Sample message', severity: 'advisory', alertNumber: 'SOS-2026-00001', time: 'now', studentName: 'Sample Student', locationText: 'Unavailable', destination: 'Library', expected: '9:30 PM', role: 'counsellor' }));
}));

superAdminRouter.get('/email/logs', requirePermission('email:manage'), asyncHandler(async (req, res) => {
  const { page, limit, skip } = pageParams(req.query, 100);
  const filter: Record<string, unknown> = {};
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.template) filter.template = String(req.query.template);
  const [items, total] = await Promise.all([EmailDelivery.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), EmailDelivery.countDocuments(filter)]);
  ok(res, { items: items.map((d) => ({ id: String(d._id), template: d.template, to: d.toMasked, status: d.status, provider: d.provider, attempts: d.attempts, lastError: d.lastError, bounceReason: d.bounceReason ?? null, providerResponse: d.providerResponse ?? null, sentAt: d.sentAt, createdAt: d.createdAt })), total, page, limit });
}));

superAdminRouter.get('/email/inbound', requirePermission('email:manage'), asyncHandler(async (req, res) => {
  const { page, limit, skip } = pageParams(req.query, 100);
  const [items, total] = await Promise.all([InboundEmailEvent.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), InboundEmailEvent.countDocuments({})]);
  const s = await getSettings();
  ok(res, {
    config: { ...s.inboundEmail, webhookUrl: `${env.API_PUBLIC_URL}/api/v1/webhooks/inbound-email`, secretConfigured: Boolean(env.INBOUND_EMAIL_WEBHOOK_SECRET), mailbox: env.INBOUND_EMAIL_ADDRESS ?? null },
    items: items.map((e) => ({ id: String(e._id), provider: e.provider, from: e.from.replace(/^(.).*@/, '$1***@'), to: e.to, subject: e.subject, outcome: e.outcome, reason: e.reason, incidentId: e.incidentId ? String(e.incidentId) : null, createdAt: e.createdAt })),
    total, page, limit,
  });
}));

// ------------------------------------------------------------------ users and roles
superAdminRouter.get('/roles', requirePermission('roles:manage'), asyncHandler(async (_req, res) => {
  const byRole = await User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]);
  const userCounts: Record<string, number> = Object.fromEntries(byRole.map((r) => [r._id, r.count]));
  ok(res, {
    roles: ROLE_PERMISSIONS,
    permissions: PERMISSIONS,
    explicitOnly: EXPLICIT_ONLY_PERMISSIONS,
    mainRoles: MAIN_ROLES,
    roleLabels: ROLE_LABELS,
    roleDefinitions: MAIN_ROLE_DEFINITIONS,
    userCounts,
  });
}));

superAdminRouter.patch(
  '/users/:id/role',
  requirePermission('roles:manage'),
  requireRecentAuth,
  asyncHandler(async (req, res) => {
    const input = parse(userRoleSchema, req.body);
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const target = await User.findById(req.params.id);
    if (!target) throw notFound();
    if (String(target._id) === String(req.user!._id)) throw new AppError(422, 'self', 'You cannot change your own role or permissions.');
    if (input.role === 'student' && target.role !== 'student') throw new AppError(422, 'validation_failed', 'Staff accounts cannot be converted to student accounts.');
    if (target.role === 'student' && input.role !== 'student') throw new AppError(422, 'validation_failed', 'Student accounts cannot be promoted. Invite a separate staff account.');
    if (target.role === 'super_admin' && input.role !== 'super_admin') {
      const others = await User.countDocuments({ role: 'super_admin', accountStatus: 'active', _id: { $ne: target._id } });
      if (others < 1) throw new AppError(422, 'last_super_admin', 'There must always be at least one active Super Admin.');
    }
    const unknown = input.permissions.filter((p) => !(PERMISSIONS as readonly string[]).includes(p));
    if (unknown.length) throw new AppError(422, 'validation_failed', `Unknown permissions: ${unknown.join(', ')}`);
    const before = { role: target.role, permissions: [...(target.permissions ?? [])] };
    target.role = input.role;
    target.permissions = input.permissions;
    await target.save();
    await revokeAllSessions(String(target._id)); // permissions take effect on next sign-in
    await disconnectUser(String(target._id));
    await audit({ action: 'user.role_changed', req, targetType: 'user', targetId: String(target._id), meta: { before, after: { role: input.role, permissions: input.permissions }, reasonProvided: true } });
    ok(res, publicUser(target));
  }),
);

superAdminRouter.post('/users/:id/revoke-sessions', requirePermission('security:manage'), requireRecentAuth, asyncHandler(async (req, res) => {
  await revokeAllSessions(req.params.id);
  await audit({ action: 'user.sessions_revoked', req, targetType: 'user', targetId: req.params.id });
  ok(res, { ok: true });
}));

/**
 * Administrator recovery for someone who lost their authenticator AND all recovery codes. This is not a
 * bypass: it removes the second factor, signs the person out everywhere, forces re-enrolment at next
 * sign-in (where policy requires MFA), notifies them, and records how their identity was verified.
 */
superAdminRouter.post('/users/:id/reset-mfa', requirePermission('security:manage'), requireRecentAuth, asyncHandler(async (req, res) => {
  if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
  const input = parse(z.object({ verification: z.string().trim().min(10, 'Describe how you verified this personâ€™s identity (e.g. ID card checked in person, ticket reference)').max(500) }), req.body ?? {});
  if (String(req.params.id) === String(req.user!._id)) throw new AppError(422, 'self', 'Another administrator must reset your two-step verification.');
  const target = await User.findById(req.params.id, { email: 1, fullName: 1 });
  if (!target) throw notFound();
  await removeTotp(req.params.id);
  await revokeAllSessions(req.params.id);
  await sendEmail('security_alert', target.email, { name: target.fullName, message: 'An administrator reset two-step verification on your account after verifying your identity. You will be asked to set up your authenticator app again. If you did not request this, contact the university IT office immediately.' });
  await audit({ action: 'user.mfa_reset', req, targetType: 'user', targetId: req.params.id, reason: input.verification });
  ok(res, { ok: true });
}));

// ------------------------------------------------------------------ case routing
superAdminRouter.get('/case-routing', requirePermission('routing:manage'), asyncHandler(async (_req, res) => {
  const rules = await RoutingRule.find({}).lean();
  const committees = await Committee.find({ active: true }, { name: 1, type: 1 }).lean();
  ok(res, { rules: rules.map((r) => ({ ...r, id: String(r._id), committeeId: String(r.committeeId), escalateToCommitteeId: r.escalateToCommitteeId ? String(r.escalateToCommitteeId) : null })), committees: committees.map((c) => ({ id: String(c._id), name: c.name, type: c.type })) });
}));

superAdminRouter.put('/case-routing', requirePermission('routing:manage'), requireRecentAuth, asyncHandler(async (req, res) => {
  const input = parse(routingRuleSchema, req.body);
  const committee = await Committee.exists({ _id: input.committeeId, active: true });
  if (!committee) throw new AppError(422, 'invalid_committee', 'Choose an active committee.');
  await RoutingRule.findOneAndUpdate({ category: input.category }, { $set: input }, { upsert: true });
  await audit({ action: 'routing.updated', req, targetType: 'routing_rule', targetId: input.category, meta: { committeeId: input.committeeId } });
  ok(res, { ok: true });
}));

// ------------------------------------------------------------------ chat channels (configuration only â€” no message access)
superAdminRouter.get('/chat/channels', requirePermission('chat:configure'), asyncHandler(async (_req, res) => {
  const list = await ChatChannel.find({ kind: { $in: ['community', 'support_service'] } }).sort({ kind: 1, order: 1 }).lean();
  const counts = await ChatChannel.aggregate([{ $match: { kind: 'support_thread' } }, { $group: { _id: '$serviceId', threads: { $sum: 1 } } }]);
  const tmap = new Map(counts.map((c) => [String(c._id), c.threads]));
  const msgCounts = await ChatMessage.aggregate([{ $match: { channelId: { $in: list.filter((c) => c.kind === 'community').map((c) => c._id) } } }, { $group: { _id: '$channelId', n: { $sum: 1 } } }]);
  const mmap = new Map(msgCounts.map((c) => [String(c._id), c.n]));
  ok(res, list.map((c) => ({ id: String(c._id), kind: c.kind, name: c.name, slug: c.slug, description: c.description, published: c.published, order: c.order, readOnly: c.readOnly, serviceRole: c.serviceRole, committeeId: c.committeeId ? String(c.committeeId) : null, threads: tmap.get(String(c._id)) ?? 0, messages: mmap.get(String(c._id)) ?? 0 })));
}));

superAdminRouter.post('/chat/channels', requirePermission('chat:configure'), asyncHandler(async (req, res) => {
  const input = parse(chatChannelSchema, req.body);
  if (input.kind === 'support_service' && !input.serviceRole) throw new AppError(422, 'validation_failed', 'Choose which staff role answers this service.', { fields: { serviceRole: 'Required' } });
  const c = await ChatChannel.create({ ...input, createdBy: req.user!._id });
  await audit({ action: 'chat_channel.created', req, targetType: 'chat_channel', targetId: String(c._id), meta: { kind: input.kind } });
  ok(res, { id: String(c._id) }, 201);
}));

superAdminRouter.patch('/chat/channels/:id', requirePermission('chat:configure'), asyncHandler(async (req, res) => {
  const input = parse(chatChannelSchema.partial(), req.body);
  const c = await ChatChannel.findOneAndUpdate({ _id: req.params.id, kind: { $in: ['community', 'support_service'] } }, { $set: input }, { new: true });
  if (!c) throw notFound();
  await audit({ action: 'chat_channel.updated', req, targetType: 'chat_channel', targetId: String(c._id), meta: { fields: Object.keys(input) } });
  ok(res, { ok: true });
}));

superAdminRouter.post('/chat/channels/reorder', requirePermission('chat:configure'), asyncHandler(async (req, res) => {
  const ids = parse(z.array(z.string().regex(/^[a-f0-9]{24}$/i)).max(200), req.body?.ids);
  await Promise.all(ids.map((id, i) => ChatChannel.updateOne({ _id: id }, { $set: { order: i } })));
  await audit({ action: 'chat_channel.reordered', req });
  ok(res, { ok: true });
}));

superAdminRouter.delete('/chat/channels/:id', requirePermission('chat:configure'), requireRecentAuth, asyncHandler(async (req, res) => {
  // Disable rather than delete so conversation history stays intact.
  const c = await ChatChannel.findOneAndUpdate({ _id: req.params.id, kind: { $in: ['community', 'support_service'] } }, { $set: { published: false } }, { new: true });
  if (!c) throw notFound();
  await audit({ action: 'chat_channel.disabled', req, targetType: 'chat_channel', targetId: String(c._id) });
  ok(res, { ok: true });
}));

// ------------------------------------------------------------------ emergency recipients
superAdminRouter.get('/emergency-recipients', requirePermission('sos:configure'), asyncHandler(async (_req, res) => {
  const list = await EmergencyRecipient.find({}).lean();
  const officers = await User.find({ role: 'security_officer', accountStatus: 'active' }, { fullName: 1, email: 1 }).lean();
  ok(res, { recipients: list.map((r) => ({ id: String(r._id), name: r.name, type: r.type, tier: r.tier ?? 'primary', userId: r.userId ? String(r.userId) : null, email: r.email, active: r.active })), automaticSecurityOfficers: officers.map((o) => ({ id: String(o._id), name: o.fullName, email: o.email })) });
}));

superAdminRouter.post('/emergency-recipients', requirePermission('sos:configure'), requireRecentAuth, asyncHandler(async (req, res) => {
  const input = parse(emergencyRecipientSchema, req.body);
  if (input.type === 'user') {
    const u = input.userId ? await User.findOne({ _id: input.userId, accountStatus: 'active', role: { $ne: 'student' } }).lean() : null;
    if (!u) throw new AppError(422, 'validation_failed', 'Choose an active staff account.');
  } else if (!input.email) throw new AppError(422, 'validation_failed', 'Email is required.', { fields: { email: 'Required' } });
  const r = await EmergencyRecipient.create({ ...input, email: input.email || null, userId: input.userId ?? null });
  await audit({ action: 'emergency_recipient.added', req, targetType: 'emergency_recipient', targetId: String(r._id) });
  ok(res, { id: String(r._id) }, 201);
}));

superAdminRouter.delete('/emergency-recipients/:id', requirePermission('sos:configure'), requireRecentAuth, asyncHandler(async (req, res) => {
  await EmergencyRecipient.deleteOne({ _id: req.params.id });
  await audit({ action: 'emergency_recipient.removed', req, targetType: 'emergency_recipient', targetId: req.params.id });
  ok(res, { ok: true });
}));

// ------------------------------------------------------------------ security overview
superAdminRouter.get('/security/events', requirePermission('security:manage'), asyncHandler(async (_req, res) => {
  const since = new Date(Date.now() - 7 * 86400_000);
  const events = await AuditLog.aggregate([
    { $match: { at: { $gte: since }, action: { $in: ['auth.login_failed', 'turnstile.failed', 'access.denied', 'incident.access_denied', 'auth.reauth_failed', 'counselling_notes.access_denied', 'auth.google_link_required'] } } },
    { $group: { _id: '$action', count: { $sum: 1 } } },
  ]);
  const locked = await User.find({ lockedUntil: { $gt: new Date() } }, { fullName: 1, email: 1, lockedUntil: 1 }).lean();
  const privileged = await User.find({ role: { $in: ['admin', 'super_admin'] } }, { fullName: 1, email: 1, role: 1, mfaEnabled: 1, lastLoginAt: 1, accountStatus: 1 }).lean();
  ok(res, {
    events7d: Object.fromEntries(events.map((e) => [e._id, e.count])),
    lockedAccounts: locked.map((l) => ({ id: String(l._id), name: l.fullName, email: l.email, lockedUntil: l.lockedUntil })),
    privilegedAccounts: privileged.map((p) => ({ id: String(p._id), name: p.fullName, email: p.email, role: p.role, mfaEnabled: p.mfaEnabled, lastLoginAt: p.lastLoginAt, status: p.accountStatus })),
  });
}));

// ------------------------------------------------------------------ retention
superAdminRouter.get('/retention/preview', requirePermission('retention:manage'), asyncHandler(async (_req, res) => {
  const s = await getSettings();
  const cutoff = (days: number) => new Date(Date.now() - days * 86400_000);
  const community = await ChatChannel.find({ kind: 'community' }, { _id: 1 }).lean();
  ok(res, {
    notifications: await Notification.countDocuments({ createdAt: { $lt: cutoff(s.retention.notificationsDays) } }),
    communityMessages: await ChatMessage.countDocuments({ channelId: { $in: community.map((c) => c._id) }, createdAt: { $lt: cutoff(s.retention.communityMessagesDays) } }),
    auditLogs: await AuditLog.countDocuments({ at: { $lt: cutoff(s.retention.auditLogDays) } }),
    note: 'Closed cases are never deleted automatically. Review them against university policy; evidence and counselling records require a documented decision.',
  });
}));

superAdminRouter.post('/retention/run', requirePermission('retention:manage'), requireRecentAuth, asyncHandler(async (req, res) => {
  if (req.body?.confirm !== 'APPLY RETENTION') throw new AppError(422, 'confirmation_required', 'Type APPLY RETENTION to confirm.');
  const s = await getSettings();
  const cutoff = (days: number) => new Date(Date.now() - days * 86400_000);
  const community = await ChatChannel.find({ kind: 'community' }, { _id: 1 }).lean();
  const n = await Notification.deleteMany({ createdAt: { $lt: cutoff(s.retention.notificationsDays) } });
  const m = await ChatMessage.deleteMany({ channelId: { $in: community.map((c) => c._id) }, createdAt: { $lt: cutoff(s.retention.communityMessagesDays) } });
  // Audit entries are removed only from the start of the chain, preserving verifiability of the rest.
  const a = await AuditLog.deleteMany({ at: { $lt: cutoff(s.retention.auditLogDays) } }).setOptions({ allowAuditRetention: true });
  await audit({ action: 'retention.applied', req, meta: { notifications: n.deletedCount, communityMessages: m.deletedCount, auditLogs: a.deletedCount } });
  ok(res, { notifications: n.deletedCount, communityMessages: m.deletedCount, auditLogs: a.deletedCount });
}));

superAdminRouter.get('/integrations', requirePermission('settings:manage'), asyncHandler(async (_req, res) => {
  const provider = await EmailProviderConfig.findOne({ active: true }).lean();
  const google = await IdentityProviderConfig.findOne({ provider: 'google' }).lean();
  const s = await getSettings();
  ok(res, [
    { key: 'mongodb', name: 'MongoDB Atlas', status: databaseReady() ? 'connected' : 'disconnected' },
    { key: 'email', name: 'Outbound email (Nodemailer)', status: provider ? (provider.type === 'nodemailer' ? `Nodemailer · ${provider.service} · ${provider.authUser} (console)` : 'console (development)') : env.EMAIL_PROVIDER === 'nodemailer' ? `Nodemailer · ${env.MAIL_SERVICE} (environment)` : 'console (development)', needsCredentials: (provider?.type ?? env.EMAIL_PROVIDER) === 'console' },
    { key: 'turnstile', name: 'Cloudflare Turnstile', status: env.TURNSTILE_SECRET ? 'configured' : 'test keys â€” set TURNSTILE_SITE_KEY / TURNSTILE_SECRET', needsCredentials: !env.TURNSTILE_SECRET, enabled: s.turnstile.enabled },
    { key: 'google', name: 'Google OAuth 2.0', status: google?.enabled ? 'enabled' : 'disabled', needsCredentials: !(google?.clientId || env.GOOGLE_CLIENT_ID) },
    { key: 'inbound', name: 'Inbound email webhook', status: s.inboundEmail.enabled ? 'enabled' : 'disabled', needsCredentials: !env.INBOUND_EMAIL_WEBHOOK_SECRET },
    { key: 'storage', name: 'Private file storage', status: 'local disk (replace with private object storage in production)' },
    { key: 'sms', name: 'SMS gateway (SOS)', status: 'not configured', needsCredentials: true },
  ]);
}));


// ------------------------------------------------------------------ live operations (no student identities or locations)
superAdminRouter.get(
  '/live-ops',
  asyncHandler(async (_req, res) => {
    const since = new Date(Date.now() - 30 * 86400_000);
    const [active, recent, overdueWalks, devices, jobsFailed] = await Promise.all([
      EmergencyAlert.find({ status: { $in: [...SOS_ACTIVE_STATUSES] } }).sort({ createdAt: -1 }).limit(50).lean(),
      EmergencyAlert.find({ createdAt: { $gte: since } }, { createdAt: 1, acknowledgedAt: 1, resolvedAt: 1, status: 1, resolutionOutcome: 1, escalationLevel: 1 }).lean(),
      SafeWalkSession.countDocuments({ status: { $in: ['overdue', 'escalated'] } }),
      DeviceRegistration.aggregate([{ $group: { _id: '$appVersion', count: { $sum: 1 }, push: { $sum: { $cond: [{ $ne: ['$pushToken', null] }, 1, 0] } } } }, { $sort: { _id: -1 } }]),
      Job.countDocuments({ status: 'failed' }),
    ]);
    const ackSeconds = recent.filter((a) => a.acknowledgedAt).map((a) => (a.acknowledgedAt!.getTime() - a.createdAt.getTime()) / 1000).sort((x, y) => x - y);
    const median = (xs: number[]) => (xs.length ? Math.round(xs[Math.floor(xs.length / 2)]!) : null);
    const ackBy = await User.find({ _id: { $in: active.map((a) => a.acknowledgedBy).filter(Boolean) } }, { fullName: 1 }).lean();
    const ackName = new Map(ackBy.map((u) => [String(u._id), u.fullName]));
    ok(res, {
      activeAlerts: active.map((a) => ({
        id: String(a._id), alertNumber: a.alertNumber, status: a.status, createdAt: a.createdAt, acknowledgedAt: a.acknowledgedAt,
        acknowledgedBy: a.acknowledgedBy ? ackName.get(String(a.acknowledgedBy)) ?? 'Responder' : null, escalationLevel: a.escalationLevel ?? 0,
        locationShared: a.latitude != null, lastDeliveryError: a.lastDeliveryError,
      })),
      metrics30d: {
        alerts: recent.length,
        acknowledged: ackSeconds.length,
        medianSecondsToAcknowledge: median(ackSeconds),
        p90SecondsToAcknowledge: ackSeconds.length ? Math.round(ackSeconds[Math.floor(ackSeconds.length * 0.9)]!) : null,
        escalated: recent.filter((a) => (a.escalationLevel ?? 0) > 0).length,
        falseAlarms: recent.filter((a) => a.resolutionOutcome === 'false_alarm').length,
        cancelled: recent.filter((a) => a.status === 'cancelled').length,
      },
      safeWalksNeedingAttention: overdueWalks,
      app: { installsByVersion: devices.map((d) => ({ version: d._id, devices: d.count, pushEnabled: d.push })), pushConfigured: pushConfigured() },
      jobsFailed,
    });
  }),
);


// ------------------------------------------------------------------ live-map response zones
superAdminRouter.get(
  '/live-map/zones',
  asyncHandler(async (_req, res) => {
    let zones = await ResponseZone.find({ active: true }).sort({ campus: 1, name: 1 }).lean();
    if (!zones.length) {
      zones = await ResponseZone.find({}).sort({ campus: 1, name: 1 }).lean();
    }
    if (!zones.length) {
      const defaults = [
        { name: 'Academic Block A & Admin', code: 'acad-a', campus: 'main', latitude: 16.464, longitude: 80.507, radiusMeters: 150 },
        { name: 'Academic Block B & C', code: 'acad-bc', campus: 'main', latitude: 16.4645, longitude: 80.508, radiusMeters: 150 },
        { name: 'Central Library & Auditorium', code: 'lib', campus: 'main', latitude: 16.463, longitude: 80.5075, radiusMeters: 120 },
        { name: 'Hostel Complex (Tier 1 & 2)', code: 'hostel', campus: 'main', latitude: 16.462, longitude: 80.506, radiusMeters: 200 },
        { name: 'University Health Centre', code: 'health', campus: 'main', latitude: 16.4635, longitude: 80.509, radiusMeters: 100 },
        { name: 'Sports Arena & Grounds', code: 'sports', campus: 'main', latitude: 16.4615, longitude: 80.5095, radiusMeters: 200 },
        { name: 'Main Campus Gate & Security', code: 'gate', campus: 'main', latitude: 16.4605, longitude: 80.507, radiusMeters: 100 },
      ];
      try {
        const created = await ResponseZone.insertMany(defaults);
        zones = created.map((c) => c.toObject());
      } catch {
        zones = defaults as any;
      }
    }
    ok(
      res,
      zones.map((z: any) => ({
        id: String(z._id ?? z.id ?? z.code),
        name: z.name,
        code: z.code,
        campus: z.campus,
        latitude: z.latitude,
        longitude: z.longitude,
        radiusMeters: z.radiusMeters,
      })),
    );
  }),
);

// ------------------------------------------------------------------ data governance: export / deletion requests
superAdminRouter.get(
  '/data-requests',
  requirePermission('retention:manage'),
  asyncHandler(async (req, res) => {
    const filter = req.query.status ? { status: String(req.query.status) } : {};
    const list = await DataRequest.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    const users = await User.find({ _id: { $in: list.map((d) => d.userId) } }, { fullName: 1, email: 1, role: 1 }).lean();
    const map = new Map(users.map((u) => [String(u._id), u]));
    ok(res, list.map((d) => ({ id: String(d._id), type: d.type, status: d.status, reason: d.reason, note: d.note, createdAt: d.createdAt, decidedAt: d.decidedAt, user: map.get(String(d.userId)) ? { id: String(d.userId), name: map.get(String(d.userId))!.fullName, email: map.get(String(d.userId))!.email, role: map.get(String(d.userId))!.role } : null })));
  }),
);

superAdminRouter.post(
  '/data-requests/:id/decision',
  requirePermission('retention:manage'),
  requireRecentAuth,
  asyncHandler(async (req, res) => {
    const input = parse(dataRequestDecisionSchema, req.body);
    const d = await DataRequest.findOne({ _id: req.params.id, status: 'pending' });
    if (!d) throw notFound();
    if (input.decision === 'complete' && d.type === 'deletion') {
      if (input.confirm !== 'DELETE ACCOUNT') throw new AppError(422, 'confirmation_required', 'Type DELETE ACCOUNT to confirm.');
      const user = await User.findById(d.userId);
      if (!user) throw notFound();
      if (user.role === 'super_admin') throw new AppError(422, 'not_allowed', 'Super Admin accounts cannot be deleted this way.');
      // Anonymise the account. Case records are kept as university policy requires, but no longer identify the person.
      const uid = user._id;
      await Promise.all([
        TrustedContact.deleteMany({ userId: uid }),
        LocationShare.deleteMany({ userId: uid }),
        ExternalIdentity.deleteMany({ userId: uid }),
        Notification.deleteMany({ userId: uid }),
      ]);
      user.fullName = 'Deleted user';
      user.email = `deleted-${uid}@deleted.invalid`;
      user.phone = null;
      user.studentId = null;
      user.hostel = null;
      user.safetyCardEnc = null;
      user.safetyCardShare = false;
      user.passwordHash = null;
      user.accountStatus = 'suspended';
      user.suspendedReason = 'Account deleted at the userâ€™s request';
      user.anonymisedAt = new Date();
      await user.save();
      await revokeAllSessions(String(uid));
    }
    d.status = input.decision === 'complete' ? 'completed' : 'rejected';
    d.note = input.note ?? null;
    d.decidedBy = req.user!._id;
    d.decidedAt = new Date();
    await d.save();
    await audit({ action: `data_request.${d.type}_${d.status}`, req, targetType: 'user', targetId: String(d.userId) });
    ok(res, { ok: true, status: d.status });
  }),
);
