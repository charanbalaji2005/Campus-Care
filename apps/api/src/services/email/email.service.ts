import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { env } from '../../config/env';
import { decryptSecret } from '../../lib/crypto';
import { EmailDelivery, EmailProviderConfig, EmailTemplate } from '../../models/platform';
import { getSettings } from '../settings.service';
import { enqueueJob, registerJob } from '../jobs.service';
import { DEFAULT_TEMPLATES, renderTemplate, type TemplateKey } from './templates';

export function maskEmail(address: string): string {
  const [local, domain] = address.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}

interface ResolvedProvider {
  type: 'console' | 'nodemailer';
  service: string | null;
  from: string;
  transport?: nodemailer.Transporter;
}

/** Nodemailer transport for a well-known service (Gmail, Microsoft 365, …) using an app password. */
function serviceTransport(service: string, user: string, pass: string) {
  return nodemailer.createTransport({ service, auth: { user, pass } });
}

/** Active provider: the one saved in the Super Admin console wins; otherwise the environment. */
async function resolveProvider(): Promise<ResolvedProvider> {
  const cfg = await EmailProviderConfig.findOne({ active: true }).select('+authPassEnc').lean();
  if (cfg) {
    const from = `"${cfg.fromName}" <${cfg.fromEmail}>`;
    if (cfg.type === 'nodemailer' && cfg.authUser && cfg.authPassEnc) {
      return { type: 'nodemailer', service: cfg.service, from, transport: serviceTransport(cfg.service, cfg.authUser, decryptSecret(cfg.authPassEnc)) };
    }
    return { type: 'console', service: null, from };
  }
  const fromAddress = env.EMAIL_FROM || env.MAIL_USER || 'no-reply@campuscare.local';
  const from = `"${env.EMAIL_FROM_NAME}" <${fromAddress}>`;
  if (env.EMAIL_PROVIDER === 'nodemailer' && env.MAIL_USER && env.MAIL_APP_PASSWORD) {
    return { type: 'nodemailer', service: env.MAIL_SERVICE, from, transport: serviceTransport(env.MAIL_SERVICE, env.MAIL_USER, env.MAIL_APP_PASSWORD) };
  }
  return { type: 'console', service: null, from };
}

/**
 * Checks that the active provider can sign in (Nodemailer `verify()`), so a wrong
 * app password shows up immediately in the console instead of as failed deliveries.
 */
export async function verifyEmailProvider(): Promise<{ ok: boolean; type: string; service: string | null; error?: string }> {
  const p = await resolveProvider();
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
  return delivery;
}

registerJob('email.send', async (payload) => {
  const delivery = await EmailDelivery.findById(payload.deliveryId);
  if (!delivery || delivery.status === 'sent') return;
  const settings = await getSettings();
  const vars = { platformName: settings.platform.name, universityName: settings.platform.universityName, supportEmail: settings.platform.supportEmail, ...(payload.vars as Record<string, string>) };
  const rendered = renderTemplate(await templateFor(delivery.template as TemplateKey), vars);
  const provider = await resolveProvider();
  delivery.attempts += 1;
  delivery.provider = provider.type === 'nodemailer' ? `nodemailer:${provider.service}` : 'console';
  try {
    if (provider.type === 'nodemailer' && provider.transport) {
      try {
        const info = await provider.transport.sendMail({ from: provider.from, to: delivery.to, subject: rendered.subject, html: rendered.html, text: rendered.text });
        delivery.providerMessageId = info.messageId ?? null;
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
    delivery.status = 'sent';
    delivery.sentAt = new Date();
    delivery.lastError = null;
    await delivery.save();
  } catch (err) {
    delivery.status = 'failed';
    delivery.lastError = (err as Error).message.slice(0, 300);
    await delivery.save();
    throw err; // let the job retry
  }
});

export function appLink(pathname: string) {
  return new URL(pathname, env.WEB_ORIGIN).toString();
}
