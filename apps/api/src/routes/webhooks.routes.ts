import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { asyncHandler, AppError, ok } from '../lib/http';
import { hmac, safeEqual } from '../lib/crypto';
import { webhookLimiter } from '../middleware/security';
import { InboundEmailEvent } from '../models/platform';
import { Incident } from '../models/incident';
import { User } from '../models/user';
import { getSettings } from '../services/settings.service';
import { createIncident, loadIncidentFor, postCaseMessage } from '../services/incident.service';
import { audit } from '../services/audit.service';
import { randomUUID } from 'node:crypto';

export const webhooksRouter = Router();

const inboundSchema = z.object({
  provider: z.string().max(40),
  messageId: z.string().min(3).max(300),
  from: z.string().email().max(254),
  to: z.string().email().max(254),
  subject: z.string().max(300).default(''),
  text: z.string().max(20000).default(''),
  spf: z.enum(['pass', 'fail', 'softfail', 'neutral', 'none']).optional(),
  dkim: z.enum(['pass', 'fail', 'none']).optional(),
  attachments: z.array(z.object({ filename: z.string().max(200), contentType: z.string().max(100), size: z.number() })).max(20).default([]),
});

/** Reply address for a case: complaints+case-<id>-<sig>@domain. The signature stops forged case links. */
export function caseReplyAddress(incidentId: string) {
  if (!env.INBOUND_EMAIL_ADDRESS) return null;
  const [local, domain] = env.INBOUND_EMAIL_ADDRESS.split('@');
  return `${local}+case-${incidentId}-${hmac(env.SESSION_SECRET, `reply:${incidentId}`).slice(0, 12)}@${domain}`;
}

function verifySignature(req: Request): boolean {
  const secret = env.INBOUND_EMAIL_WEBHOOK_SECRET;
  const header = String(req.headers['x-campuscare-signature'] ?? '');
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!secret || !header || !raw) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const ts = Number(parts.t);
  if (!ts || Math.abs(Date.now() / 1000 - ts) > 300) return false; // replay window
  const expected = crypto.createHmac('sha256', secret).update(`${ts}.${raw.toString('utf8')}`).digest('hex');
  return Boolean(parts.v1) && safeEqual(parts.v1, expected);
}

webhooksRouter.post(
  '/inbound-email',
  webhookLimiter,
  asyncHandler(async (req, res) => {
    const settings = await getSettings();
    if (!settings.inboundEmail.enabled || !env.INBOUND_EMAIL_WEBHOOK_SECRET || !env.INBOUND_EMAIL_ADDRESS) throw new AppError(404, 'not_found', 'Not found.');
    if (!verifySignature(req)) {
      await audit({ action: 'inbound_email.bad_signature', outcome: 'denied', req });
      throw new AppError(401, 'bad_signature', 'Invalid signature.');
    }
    const input = inboundSchema.parse(req.body);
    const record = async (outcome: 'case_created' | 'reply_linked' | 'quarantined' | 'rejected', reason: string | null, incidentId: unknown = null) => {
      try {
        await InboundEmailEvent.create({ provider: input.provider, messageId: input.messageId, from: input.from.toLowerCase(), to: input.to.toLowerCase(), subject: input.subject, outcome, reason, incidentId, attachmentCount: input.attachments.length });
      } catch (err) {
        if ((err as { code?: number }).code !== 11000) throw err;
      }
    };
    if (await InboundEmailEvent.exists({ provider: input.provider, messageId: input.messageId })) return ok(res, { duplicate: true });

    if (input.spf === 'fail' || input.dkim === 'fail') {
      await record('quarantined', 'Sender authentication failed (SPF/DKIM)');
      return ok(res, { outcome: 'quarantined' });
    }
    const [mailboxLocal, mailboxDomain] = env.INBOUND_EMAIL_ADDRESS.toLowerCase().split('@');
    const [toLocal, toDomain] = input.to.toLowerCase().split('@');
    if (toDomain !== mailboxDomain || !(toLocal === mailboxLocal || toLocal.startsWith(`${mailboxLocal}+`))) {
      await record('rejected', 'Recipient is not the configured complaints mailbox');
      return ok(res, { outcome: 'rejected' });
    }
    const sender = await User.findOne({ email: input.from.toLowerCase(), accountStatus: 'active', emailVerified: true });
    const attachmentNote = input.attachments.length ? ' Attachments are not imported from email — upload them in the app.' : '';

    // Reply to an existing case
    const m = toLocal.match(/\+case-([a-f0-9]{24})-([a-f0-9]{12})$/);
    if (m) {
      if (!settings.inboundEmail.allowReplies) { await record('rejected', 'Email replies are disabled'); return ok(res, { outcome: 'rejected' }); }
      const [, incidentId, sig] = m;
      if (!safeEqual(sig, hmac(env.SESSION_SECRET, `reply:${incidentId}`).slice(0, 12)) || !sender) {
        await record('quarantined', 'Unverified reply address or unknown sender');
        return ok(res, { outcome: 'quarantined' });
      }
      try {
        const { incident, level, viewer } = await loadIncidentFor(sender, incidentId);
        if (level !== 'reporter' && level !== 'handler') throw new Error('no access');
        if (incident.anonymous) throw new Error('anonymous case'); // email would reveal identity
        await postCaseMessage(sender, incident, level, viewer, { body: input.text.slice(0, 4000) + attachmentNote, attachmentIds: [], clientMessageId: randomUUID() });
        await record('reply_linked', null, incident._id);
        return ok(res, { outcome: 'reply_linked' });
      } catch {
        await record('quarantined', 'Sender is not a participant of this case');
        return ok(res, { outcome: 'quarantined' });
      }
    }

    // New complaint by email
    if (!settings.inboundEmail.allowCaseCreation) { await record('quarantined', 'Case creation by email is disabled'); return ok(res, { outcome: 'quarantined' }); }
    if (!sender || sender.role !== 'student') { await record('quarantined', 'Sender is not a verified student account'); return ok(res, { outcome: 'quarantined' }); }
    if (input.text.trim().length < 30) { await record('quarantined', 'Message too short to create a case'); return ok(res, { outcome: 'quarantined' }); }
    const incident = await createIncident(sender, {
      category: 'other', title: (input.subject || 'Complaint received by email').slice(0, 140), description: input.text.slice(0, 5000) + attachmentNote,
      incidentDate: new Date(), location: 'Not specified (email)', severity: 'medium', urgent: false, anonymous: false, preferredContact: 'email',
      idempotencyKey: randomUUID(),
    });
    await Incident.updateOne({ _id: incident._id }, { $set: { source: 'email' } });
    await record('case_created', null, incident._id);
    ok(res, { outcome: 'case_created' });
  }),
);
