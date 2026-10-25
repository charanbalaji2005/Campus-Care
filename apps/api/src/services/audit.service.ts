import type { Request } from 'express';
import { AuditLog } from '../models/platform';
import { nextSequence } from '../models/incident';
import { sha256, hmac } from '../lib/crypto';
import { env } from '../config/env';
import { logger } from '../lib/logger';

const GENESIS = '0'.repeat(64);
const SENSITIVE_KEYS = /pass|secret|token|body|description|note|message|cookie|authorization/i;

function redact(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!meta) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SENSITIVE_KEYS.test(k)) out[k] = '[redacted]';
    else if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) out[k] = redact(v as Record<string, unknown>);
    else out[k] = v;
  }
  return out;
}

export interface AuditInput {
  action: string;
  actorId?: string | null;
  actorRole?: string | null;
  targetType?: string;
  targetId?: string;
  outcome?: 'success' | 'denied' | 'failure';
  meta?: Record<string, unknown>;
  /** Justification given by the actor (manual overrides, private reviews). Never put secrets or message content here. */
  reason?: string | null;
  req?: Request;
  /** Defaults to the request id when `req` is given. */
  correlationId?: string | null;
}

export function ipHashOf(req?: Request): string | null {
  if (!req?.ip) return null;
  return hmac(env.SESSION_SECRET, `ip:${req.ip}`).slice(0, 32);
}

interface HashFields { seq: number; prevHash: string; at: Date; action: string; actorId: string | null; targetType: string | null; targetId: string | null; outcome: string; meta: unknown; reason?: string | null; correlationId?: string | null }

/** v1 entries (written before reason/correlation ids existed) keep their original hash so old chains still verify. */
function entryHash(e: HashFields, hv = 2) {
  const base = [e.seq, e.prevHash, e.at.toISOString(), e.action, e.actorId, e.targetType, e.targetId, e.outcome, e.meta];
  return sha256(JSON.stringify(hv >= 2 ? [...base, e.reason ?? null, e.correlationId ?? null] : base));
}

/**
 * Append a tamper-evident audit entry. Each entry includes the hash of the previous one,
 * so any edit or deletion breaks the chain (see verifyAuditChain).
 */
export async function audit(input: AuditInput): Promise<void> {
  try {
    const actorId = input.actorId ?? input.req?.user?._id?.toString() ?? null;
    const actorRole = input.actorRole ?? input.req?.user?.role ?? null;
    const seq = await nextSequence('audit');
    let prevHash = GENESIS;
    if (seq > 1) {
      // A concurrent writer may hold seq-1 for a few milliseconds; wait for it so the chain stays intact.
      for (let attempt = 0; attempt < 40; attempt++) {
        const prev = await AuditLog.findOne({ seq: seq - 1 }, { hash: 1 }).lean();
        if (prev) { prevHash = prev.hash; break; }
        await new Promise((r) => setTimeout(r, 25));
      }
    }
    const at = new Date();
    const meta = redact(input.meta);
    const base = {
      seq, prevHash, at, action: input.action, actorId, targetType: input.targetType ?? null,
      targetId: input.targetId ?? null, outcome: input.outcome ?? 'success', meta,
      reason: input.reason ? String(input.reason).slice(0, 1000) : null,
      correlationId: input.correlationId ?? input.req?.correlationId ?? null,
    };
    await AuditLog.create({ ...base, actorRole, ipHash: ipHashOf(input.req), hv: 2, hash: entryHash(base, 2) });
  } catch (err) {
    // Audit failure must be visible to operators but must not leak data.
    logger.error({ err: (err as Error).message, action: input.action }, 'audit write failed');
  }
}

export async function verifyAuditChain(limit = 5000): Promise<{ ok: boolean; checked: number; brokenAtSeq?: number }> {
  const entries = await AuditLog.find({}).sort({ seq: 1 }).limit(limit).lean();
  let prevHash: string | null = null;
  for (const e of entries) {
    if (prevHash !== null && e.prevHash !== prevHash) return { ok: false, checked: entries.length, brokenAtSeq: e.seq };
    const expected = entryHash({
      seq: e.seq, prevHash: e.prevHash, at: e.at, action: e.action, actorId: e.actorId ? String(e.actorId) : null,
      // Mongoose `minimize` drops an empty meta object on save; it was hashed as {}.
      targetType: e.targetType ?? null, targetId: e.targetId ?? null, outcome: e.outcome, meta: e.meta ?? {},
      reason: e.reason ?? null, correlationId: e.correlationId ?? null,
    }, e.hv ?? 1);
    if (expected !== e.hash) return { ok: false, checked: entries.length, brokenAtSeq: e.seq };
    prevHash = e.hash;
  }
  return { ok: true, checked: entries.length };
}
