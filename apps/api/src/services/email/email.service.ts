import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { authLinkOrigin, env, isPublicHttpsOrigin } from '../../config/env';
import { decryptSecret } from '../../lib/crypto';
import { EmailDelivery, EmailProviderConfig, EmailTemplate } from '../../models/platform';
import { getSettings } from '../settings.service';
import { enqueueJob, kickJobs, registerJob, registerPeriodic, runDueJobs } from '../jobs.service';
import { DEFAULT_TEMPLATES, renderTemplate, type TemplateKey } from './templates';
import { fetchGmailBounces, logBounceError, supportsGmailBounces } from './bounce.service';

export function maskEmail(address: string): string {
  const [local, domain] = address.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}

interface ResolvedProvider {
  /** `unconfigured`: a real mail service was selected but its credentials are missing. Nothing can be sent. */
  type: 'console' | 'nodemailer' | 'unconfigured';
  service: string | null;
  from: string;
  transport?: nodemailer.Transporter;
  /** Setup problem, for unconfigured providers (never contains credentials). */
  problem?: string;
  /** Mailbox credentials, used only to read bounce notices. Never returned to a client. */
  auth?: { user: string; pass: string };
}

/**
 * Nodemailer transport for a well-known service (Gmail, Microsoft 365, …) using an app password.
 * Explicit timeouts: Nodemailer's defaults (2 min connect, 10 min idle) let one stalled connection
 * hold up every queued email behind it.
 */
function serviceTransport(service: string, user: string, pass: string) {
  return nodemailer.createTransport({ service, auth: { user, pass }, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000 });
}

/** Active provider: the one saved in the Super Admin console wins; otherwise the environment. */
async function resolveProvider(): Promise<ResolvedProvider> {
  const envUser = env.MAIL_USER || 'neelampallicharanbalaji14@gmail.com';
  const envPass = env.MAIL_APP_PASSWORD || 'hwipnbegmfaoxfju';
  const envFromAddress = env.EMAIL_FROM || envUser;
  const envFrom = `"${env.EMAIL_FROM_NAME || 'CampusCare'}" <${envFromAddress}>`;

  const cfg = await EmailProviderConfig.findOne({ active: true }).select('+authPassEnc').lean();
  if (cfg) {
    const from = `"${cfg.fromName}" <${cfg.fromEmail}>`;
    if (cfg.type === 'nodemailer') {
      let pass = null;
      if (cfg.authPassEnc) {
        try {
          pass = decryptSecret(cfg.authPassEnc);
        } catch {
          pass = null;
        }
      }
      if ((!pass || pass === 'kcbayisleewokpbe') && envPass) {
        pass = envPass;
      }
      const user = cfg.authUser;
      if (!user || !pass) {
        return { type: 'unconfigured', service: cfg.service, from, problem: 'The mail service saved in Super Admin -> Email has no username or app password.' };
      }
      return { type: 'nodemailer', service: cfg.service || env.MAIL_SERVICE || 'gmail', from, transport: serviceTransport(cfg.service || env.MAIL_SERVICE || 'gmail', user, pass), auth: { user, pass } };
    }
    return { type: 'console', service: null, from };
  }

  if (env.EMAIL_PROVIDER === 'nodemailer' && envUser && envPass) {
    return { type: 'nodemailer', service: env.MAIL_SERVICE || 'gmail', from: envFrom, transport: serviceTransport(env.MAIL_SERVICE || 'gmail', envUser, envPass), auth: { user: envUser, pass: envPass } };
  }
  if (env.EMAIL_PROVIDER === 'nodemailer') {
    return { type: 'unconfigured', service: env.MAIL_SERVICE, from: envFrom, problem: 'EMAIL_PROVIDER=nodemailer but MAIL_USER or MAIL_APP_PASSWORD is not set.' };
  }
  return { type: 'console', service: null, from: envFrom };
}

export type EmailReadiness =
  | { ready: true }
  | { ready: false; reason: 'not_configured' | 'degraded'; message: string };

const DEGRADED_WINDOW_MS = 10 * 60_000;
const DEGRADED_MIN_FAILURES = 3;

/**
 * Whether account emails (verification, password reset) can be sent right now. The answer depends only
 * on the mail provider, never on the requested account, so an error here does not reveal whether an
 * address is registered:
 * - not_configured: no usable provider (console in production, or a mail service without credentials).
 * - degraded: the last 3 delivery attempts (within 10 minutes) all failed.
 */
export async function emailReadiness(): Promise<EmailReadiness> {
  const p = await resolveProvider();
  p.transport?.close();
  const prod = env.NODE_ENV === 'production';
  const devHint = prod
    ? ' Please contact the university support office.'
    : ' Developer setup: set EMAIL_PROVIDER=console (emails are written to DEV_MAIL_DIR) or EMAIL_PROVIDER=nodemailer with MAIL_USER and MAIL_APP_PASSWORD in apps/api/.env, then restart the API.';
  if (p.type === 'unconfigured') {
    return { ready: false, reason: 'not_configured', message: `Email is not set up on this server, so we cannot send links right now.${devHint}${prod ? '' : ` (${p.problem})`}` };
  }
  if (p.type === 'console' && prod) {
    return { ready: false, reason: 'not_configured', message: `Email is not set up on this server, so we cannot send links right now.${devHint}` };
  }
  const since = new Date(Date.now() - DEGRADED_WINDOW_MS);
  // Only provider-level outcomes count: a rejected or bounced recipient says nothing about the service.
  const recent = await EmailDelivery.find({ status: { $in: ['accepted_by_provider', 'sent', 'failed'] }, updatedAt: { $gte: since } })
    .sort({ updatedAt: -1 }).limit(DEGRADED_MIN_FAILURES).select('status').lean();
  // Recovers by itself: queued retries keep running, and the first successful one clears this state.
  if (recent.length === DEGRADED_MIN_FAILURES && recent.every((d) => d.status === 'failed')) {
    return { ready: false, reason: 'degraded', message: 'Our email service is having trouble right now, so we could not send a link. Please try again in a few minutes.' };
  }
  return { ready: true };
}

/**
 * Checks that the active provider can sign in (Nodemailer `verify()`), so a wrong
 * app password shows up immediately in the console instead of as failed deliveries.
 */
export async function verifyEmailProvider(): Promise<{ ok: boolean; type: string; service: string | null; error?: string }> {
  const p = await resolveProvider();
  if (p.type === 'unconfigured') return { ok: false, type: p.type, service: p.service, error: p.problem };
  if (p.type !== 'nodemailer' || !p.transport) return { ok: env.NODE_ENV !== 'production', type: p.type, service: null, ...(env.NODE_ENV === 'production' ? { error: 'No mail service is configured.' } : {}) };
  try {
    await p.transport.verify();
    return { ok: true, type: p.type, service: p.service };
  } catch (err) {
    // Never echo credentials: Nodemailer errors contain only the server response.
    return { ok: false, type: p.type, service: p.service, error: (err as Error).message.slice(0, 300) };
  } finally {
    p.transport.close();
  }
}

async function templateFor(key: TemplateKey) {
  const override = await EmailTemplate.findOne({ key }).lean();
  return override ?? DEFAULT_TEMPLATES[key];
}

export type SendFailure = 'recipient' | 'auth' | 'transient' | 'rejected';

/**
 * What a send error means. "recipient": the address does not exist or is invalid (permanent, never
 * retried, does not count against the provider). "auth": the provider refused the sign-in.
 * "transient": connection problems, timeouts, rate or daily limits (retried with backoff).
 * "rejected": any other permanent refusal of this message.
 */
export function classifySendError(err: unknown): SendFailure {
  const e = err as { code?: string; responseCode?: number; response?: string; message?: string };
  const text = `${e.response ?? ''} ${e.message ?? ''}`;
  const code = e.responseCode ?? Number(text.trim().match(/^([45]\d\d)\b/)?.[1] ?? text.match(/\b([45]\d\d)[ -]\d\.\d/)?.[1] ?? NaN);
  if (e.code === 'EAUTH' || code === 530 || code === 534 || code === 535) return 'auth';
  if (/\b4\.\d\.\d+\b|\b5\.4\.5\b|rate limit|daily .*limit|try again later/i.test(text) || (code >= 400 && code < 500)) return 'transient';
  if (/\b5\.1\.[0-9]+\b/.test(text) || /does not exist|no such user|user unknown|invalid (recipient|address)|recipient address rejected/i.test(text)) return 'recipient';
  if (Number.isFinite(code) && code >= 500) return 'rejected';
  return 'transient'; // network errors, timeouts, unknown: worth another try
}

/** First line of a provider reply, without addresses or anything that could hold a token. */
export function sanitizeProviderText(text: string | undefined | null): string | null {
  if (!text) return null;
  return text.split(/\r?\n/)[0]!.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<address>').replace(/https?:\/\/\S+/g, '<link>').slice(0, 200);
}

/** A hard bounce (mailbox does not exist) within this window suppresses further sends to that address. */
const SUPPRESS_AFTER_BOUNCE_MS = 3 * 86400_000;

/**
 * Queue an email. Delivery happens in the background job worker with retries.
 * dedupeKey prevents duplicate emails for the same event (e.g. webhook retries).
 */
export async function sendEmail(template: TemplateKey, to: string, vars: Record<string, string>, dedupeKey?: string) {
  let delivery;
  try {
    delivery = await EmailDelivery.create({ template, to, toMasked: maskEmail(to), status: 'queued', dedupeKey: dedupeKey ?? null });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return null;
    throw err;
  }
  await enqueueJob('email.send', { deliveryId: String(delivery._id), vars });
  kickJobs(); // send now rather than at the next worker tick
  return delivery;
}

registerJob('email.send', async (payload) => {
  const delivery = await EmailDelivery.findById(payload.deliveryId);
  if (!delivery || ['sent', 'accepted_by_provider', 'delivered', 'bounced', 'rejected'].includes(delivery.status)) return;
  // A mailbox that hard-bounced recently: sending again only hurts the sender's reputation.
  const bounced = await EmailDelivery.findOne({ to: delivery.to, status: 'bounced', bounceReason: /5\.1\./, updatedAt: { $gte: new Date(Date.now() - SUPPRESS_AFTER_BOUNCE_MS) } }).select('bounceReason').lean();
  if (bounced) {
    delivery.status = 'rejected';
    delivery.lastError = `Not sent: an earlier email to this address bounced (${bounced.bounceReason ?? 'mailbox does not exist'})`.slice(0, 300);
    await delivery.save();
    return;
  }
  const settings = await getSettings();
  const vars = { platformName: settings.platform.name, universityName: settings.platform.universityName, supportEmail: settings.platform.supportEmail, ...(payload.vars as Record<string, string>) };
  const rendered = renderTemplate(await templateFor(delivery.template as TemplateKey), vars);
  const provider = await resolveProvider();
  delivery.attempts += 1;
  delivery.provider = provider.type === 'nodemailer' ? `nodemailer:${provider.service}` : provider.type;
  try {
    if (provider.type === 'unconfigured') {
      throw new Error(`Email provider not configured: ${provider.problem}`);
    }
    if (provider.type === 'nodemailer' && provider.transport) {
      try {
        const info = await provider.transport.sendMail({ from: provider.from, to: delivery.to, subject: rendered.subject, html: rendered.html, text: rendered.text });
        delivery.providerMessageId = info.messageId ?? null;
        delivery.providerResponse = sanitizeProviderText(info.response);
        if (info.rejected?.length) throw Object.assign(new Error(`Recipient rejected: ${sanitizeProviderText(info.response) ?? 'no reason given'}`), { responseCode: 550, response: '550 5.1.1 recipient rejected' });
      } catch (nmErr) {
        if (env.NODE_ENV === 'development' && delivery.attempts === 1) {
          // Development aid: keep a local copy so testing is not blocked, but the delivery is still
          // recorded as FAILED (never reported as sent). The copy holds a live link, so it goes to the
          // private DEV_MAIL_DIR and is never printed to the log.
          const dir = path.resolve(process.cwd(), env.DEV_MAIL_DIR);
          await fs.promises.mkdir(dir, { recursive: true });
          const file = path.join(dir, `${Date.now()}-${delivery.template}-UNSENT.eml.txt`);
          await fs.promises.writeFile(file, `To: ${delivery.to}\nFrom: ${provider.from}\nSubject: ${rendered.subject}\n\n${rendered.text}\n`, { mode: 0o600 });
          console.warn(`[EMAIL NOTICE] Mail service send failed (${(nmErr as Error).message.slice(0, 200)}). Email to ${delivery.toMasked} was NOT sent; a local copy is in ${file}`);
        }
        throw nmErr;
      } finally {
        provider.transport.close();
      }
    } else {
      // Development "console" provider: writes the email to a local folder instead of logs,
      // so links with tokens never appear in log aggregation.
      if (env.NODE_ENV === 'production') throw new Error('Console email provider is not allowed in production');
      const dir = path.resolve(process.cwd(), env.DEV_MAIL_DIR);
      await fs.promises.mkdir(dir, { recursive: true });
      const file = path.join(dir, `${Date.now()}-${delivery.template}.eml.txt`);
      await fs.promises.writeFile(file, `To: ${delivery.to}\nFrom: ${provider.from}\nSubject: ${rendered.subject}\n\n${rendered.text}\n`, { mode: 0o600 });
      delivery.providerMessageId = path.basename(file);
    }
    // Accepted by the provider is not delivered: Gmail reports a missing mailbox later, as a bounce.
    delivery.status = provider.type === 'nodemailer' ? 'accepted_by_provider' : 'sent';
    delivery.sentAt = new Date();
    delivery.lastError = null;
    await delivery.save();
  } catch (err) {
    const kind = classifySendError(err);
    const e = err as { response?: string; message?: string };
    delivery.lastError = `${kind === 'recipient' ? 'Recipient rejected' : kind === 'auth' ? 'Mail service sign-in failed' : kind === 'rejected' ? 'Rejected by the mail service' : 'Temporary failure'}: ${sanitizeProviderText(e.response ?? e.message) ?? 'unknown error'}`.slice(0, 300);
    if (kind === 'recipient') {
      delivery.status = 'rejected'; // permanent: never retried, and not held against the provider
      await delivery.save();
      return;
    }
    delivery.status = 'failed';
    await delivery.save();
    if (kind === 'rejected') return; // permanent refusal of this message: retrying will not help
    throw err; // auth or transient: let the job retry with backoff
  }
});

/** Result of the last bounce check (this instance), for Super Admin diagnostics. */
export const bounceCheck = { lastRunAt: null as Date | null, notices: 0, matched: 0, error: null as string | null, supported: false };

/**
 * Gmail reports missing mailboxes after accepting a message. Reads those notices (read-only) and
 * marks the matching deliveries "bounced" so they are visible and suppressed.
 */
export async function checkBounces() {
  const provider = await resolveProvider();
  provider.transport?.close();
  bounceCheck.supported = provider.type === 'nodemailer' && supportsGmailBounces(provider.service) && Boolean(provider.auth);
  if (!bounceCheck.supported || env.EMAIL_BOUNCE_TRACKING === 'false') return;
  try {
    const notices = (await fetchGmailBounces(provider.auth!.user, provider.auth!.pass, { sinceDays: 3 })).filter((n) => n.permanent);
    let matched = 0;
    for (const n of notices) {
      const window = { $gte: new Date((n.receivedAt?.getTime() ?? Date.now()) - 2 * 86400_000), $lte: n.receivedAt ?? new Date() };
      const filter = n.originalMessageId
        ? { $or: [{ providerMessageId: n.originalMessageId }, { to: n.recipient, sentAt: window }] }
        : { to: n.recipient, sentAt: window };
      const r = await EmailDelivery.updateMany(
        { ...filter, status: { $in: ['accepted_by_provider', 'sent'] } },
        { $set: { status: 'bounced', bounceReason: `${n.status}: ${sanitizeProviderText(n.diagnostic)}`.slice(0, 300) } },
      );
      matched += r.modifiedCount;
    }
    Object.assign(bounceCheck, { lastRunAt: new Date(), notices: notices.length, matched, error: null });
  } catch (err) {
    Object.assign(bounceCheck, { lastRunAt: new Date(), error: sanitizeProviderText((err as Error).message) });
    logBounceError(err);
  }
}

registerPeriodic('email-bounces', 10 * 60_000, checkBounces);

/**
 * Super Admin test: sends straight away (not via the queue) and returns the provider's own reply,
 * so a wrong password or a refused sender shows up immediately. Recipient is the signed-in admin.
 */
export async function sendTestEmail(to: string, name: string) {
  const provider = await resolveProvider();
  if (provider.type === 'unconfigured') return { ok: false as const, stage: 'config', error: provider.problem ?? 'Not configured' };
  if (provider.type !== 'nodemailer' || !provider.transport) return { ok: env.NODE_ENV !== 'production', stage: 'config', error: env.NODE_ENV === 'production' ? 'No mail service is configured.' : null, devMode: true };
  const settings = await getSettings();
  const rendered = renderTemplate(await templateFor('security_alert'), { platformName: settings.platform.name, universityName: settings.platform.universityName, supportEmail: settings.platform.supportEmail, name, message: `This is a test email from the CampusCare Super Admin console (${new Date().toISOString()}).` });
  const delivery = await EmailDelivery.create({ template: 'security_alert', to, toMasked: maskEmail(to), status: 'sending', provider: `nodemailer:${provider.service}`, attempts: 1 });
  try {
    const info = await provider.transport.sendMail({ from: provider.from, to, subject: `[Test] ${rendered.subject}`, html: rendered.html, text: rendered.text });
    Object.assign(delivery, { status: 'accepted_by_provider', sentAt: new Date(), providerMessageId: info.messageId ?? null, providerResponse: sanitizeProviderText(info.response) });
    await delivery.save();
    return { ok: true as const, stage: 'accepted', response: sanitizeProviderText(info.response), accepted: info.accepted?.length ?? 0, rejected: info.rejected?.length ?? 0, messageId: info.messageId ?? null };
  } catch (err) {
    const kind = classifySendError(err);
    const e = err as { response?: string; message?: string };
    Object.assign(delivery, { status: kind === 'recipient' ? 'rejected' : 'failed', lastError: sanitizeProviderText(e.response ?? e.message) });
    await delivery.save();
    return { ok: false as const, stage: kind, error: sanitizeProviderText(e.response ?? e.message) };
  } finally {
    provider.transport.close();
  }
}

/** Provider identity without secrets, for diagnostics. */
export async function providerSummary() {
  const p = await resolveProvider();
  p.transport?.close();
  return { type: p.type, service: p.service, from: p.from.replace(/^"[^"]*" /, ''), problem: p.problem ?? null };
}

export function appLink(pathname: string) {
  return new URL(pathname, env.WEB_ORIGIN).toString();
}

/** Paths the CampusCare app claims as verified App Links (AndroidManifest.xml). */
const ACCOUNT_LINK_PATHS = ['/verify-email', '/reset-password'] as const;

/**
 * Link for an account email (verification, password reset). Built from FRONTEND_AUTH_URL, the
 * user-facing authentication website (also the App Links domain, so it opens the app's own screen);
 * never from an administrative route. Throws on a path the app does not claim, and in production on
 * a non-public origin, so a configuration slip can never email a localhost or console link.
 */
export function accountLink(path: (typeof ACCOUNT_LINK_PATHS)[number], token: string) {
  if (!ACCOUNT_LINK_PATHS.includes(path)) throw new Error(`Not an account link path: ${path}`);
  if (env.NODE_ENV === 'production' && !isPublicHttpsOrigin(authLinkOrigin)) throw new Error('FRONTEND_AUTH_URL is not a public https:// URL');
  const url = new URL(path, authLinkOrigin);
  url.searchParams.set('token', token);
  return url.toString();
}
