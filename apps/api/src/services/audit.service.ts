import mongoose from 'mongoose';
import type { Request } from 'express';
import { AuditLog } from '../models/platform';
import { nextSequence } from '../models/incident';
import { sha256, hmac } from '../lib/crypto';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { emitToRoom } from '../realtime/socket';

const GENESIS = '0'.repeat(64);
const SENSITIVE_KEYS = /pass(word)?|secret|token|hash|salt|mfa|recovery|cookie|auth(orization)?|credential/i;

export interface FieldDiff {
  path: string;
  prev: unknown;
  next: unknown;
}

/**
 * Deeply redacts sensitive keys (passwords, tokens, cookies, auth headers)
 * to guarantee that private credentials are never persisted to audit storage.
 */
export function redactSensitive(obj: unknown, depth = 0): unknown {
  if (depth > 6 || obj == null) return obj;
  if (typeof obj !== 'object') return obj;
  if (obj instanceof Date) return obj.toISOString();
  if (Array.isArray(obj)) return obj.map((item) => redactSensitive(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.test(k)) {
      out[k] = '[redacted]';
    } else if (typeof v === 'object' && v !== null) {
      out[k] = redactSensitive(v, depth + 1);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Computes granular before-and-after differences between two document snapshots.
 */
export function computeDiff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  prefix = '',
): { diff: FieldDiff[]; changedFields: string[] } {
  const diff: FieldDiff[] = [];
  const changedFieldsSet = new Set<string>();

  if (!before && !after) return { diff, changedFields: [] };
  const b = (before ? (redactSensitive(before) as Record<string, unknown>) : {}) || {};
  const a = (after ? (redactSensitive(after) as Record<string, unknown>) : {}) || {};

  const allKeys = new Set([...Object.keys(b), ...Object.keys(a)]);
  for (const k of allKeys) {
    if (k === '__v' || k === 'updatedAt' || k === 'createdAt') continue;
    const path = prefix ? `${prefix}.${k}` : k;
    const valB = b[k];
    const valA = a[k];

    if (JSON.stringify(valB) !== JSON.stringify(valA)) {
      changedFieldsSet.add(path);
      if (
        valB && valA &&
        typeof valB === 'object' && typeof valA === 'object' &&
        !Array.isArray(valB) && !Array.isArray(valA) &&
        !(valB instanceof Date) && !(valA instanceof Date)
      ) {
        const sub = computeDiff(valB as Record<string, unknown>, valA as Record<string, unknown>, path);
        diff.push(...sub.diff);
        sub.changedFields.forEach((f) => changedFieldsSet.add(f));
      } else {
        diff.push({ path, prev: valB ?? null, next: valA ?? null });
      }
    }
  }

  return { diff, changedFields: Array.from(changedFieldsSet) };
}

// In-memory TTL cache to reconcile application mutations with MongoDB change streams
const recentMutations = new Map<string, number>();
const MUTATION_TTL_MS = 6000;

export function recordRecentMutation(collection: string, docId: string): void {
  const key = `${collection.toLowerCase()}:${docId}`;
  recentMutations.set(key, Date.now());
  if (recentMutations.size > 2000) {
    const cutoff = Date.now() - MUTATION_TTL_MS;
    for (const [k, time] of recentMutations.entries()) {
      if (time < cutoff) recentMutations.delete(k);
    }
  }
}

export function isRecentMutation(collection: string, docId: string): boolean {
  const key = `${collection.toLowerCase()}:${docId}`;
  const time = recentMutations.get(key);
  if (!time) return false;
  if (Date.now() - time > MUTATION_TTL_MS) {
    recentMutations.delete(key);
    return false;
  }
  return true;
}

export interface AuditInput {
  action: string;
  actorId?: string | null;
  actorRole?: string | null;
  actorName?: string | null;
  actorType?: 'user' | 'admin' | 'system' | 'job' | 'database_direct' | 'migration';
  targetType?: string | null;
  targetId?: string | null;
  collectionName?: string | null;
  operation?: 'insert' | 'update' | 'delete' | 'restore' | 'read' | 'export' | 'auth' | 'system';
  outcome?: 'success' | 'denied' | 'failure';
  severity?: 'info' | 'warn' | 'critical';
  source?: 'app' | 'change_stream' | 'security' | 'job' | 'migration';
  correlated?: boolean;
  diff?: FieldDiff[];
  changedFields?: string[];
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  meta?: Record<string, unknown>;
  reason?: string | null;
  req?: Request;
  correlationId?: string | null;
  userAgent?: string | null;
}

export function ipHashOf(req?: Request): string | null {
  if (!req?.ip) return null;
  return hmac(env.SESSION_SECRET, `ip:${req.ip}`).slice(0, 32);
}

interface HashFields {
  seq: number;
  prevHash: string;
  at: Date;
  action: string;
  actorId: string | null;
  targetType: string | null;
  targetId: string | null;
  outcome: string;
  meta: unknown;
  reason?: string | null;
  correlationId?: string | null;
}

function entryHash(e: HashFields, hv = 2): string {
  const base = [e.seq, e.prevHash, e.at.toISOString(), e.action, e.actorId, e.targetType, e.targetId, e.outcome, e.meta];
  return sha256(JSON.stringify(hv >= 2 ? [...base, e.reason ?? null, e.correlationId ?? null] : base));
}

/**
 * Append a tamper-evident audit entry. Each entry cryptographically hashes the previous entry,
 * forming an immutable append-only hash chain.
 */
export async function audit(input: AuditInput): Promise<any> {
  try {
    const rawActor = input.actorId ?? (input.req?.user?._id ? String(input.req.user._id) : null);
    const actorId = rawActor && mongoose.isValidObjectId(rawActor) ? String(rawActor) : null;
    const actorRole = input.actorRole ?? (input.req?.user?.role ?? null);
    const actorName = input.actorName ?? (input.req?.user?.fullName ?? (rawActor && !actorId ? String(rawActor) : null));
    const actorType = input.actorType ?? (actorRole === 'super_admin' || actorRole === 'campus_admin' ? 'admin' : actorId ? 'user' : 'system');

    // Auto diff computation if before/after provided and diff not precomputed
    let diff = input.diff ?? [];
    let changedFields = input.changedFields ?? [];
    if ((input.before || input.after) && diff.length === 0) {
      const computed = computeDiff(input.before, input.after);
      diff = computed.diff;
      changedFields = computed.changedFields;
    }

    const seq = await nextSequence('audit');
    let prevHash = GENESIS;
    if (seq > 1) {
      for (let attempt = 0; attempt < 40; attempt++) {
        const prev = await AuditLog.findOne({ seq: seq - 1 }, { hash: 1 }).lean();
        if (prev) {
          prevHash = prev.hash;
          break;
        }
        await new Promise((r) => setTimeout(r, 25));
      }
    }

    const at = new Date();
    const meta = (redactSensitive(input.meta) as Record<string, unknown>) || {};
    const base = {
      seq,
      prevHash,
      at,
      action: input.action,
      actorId,
      targetType: input.targetType ?? input.collectionName ?? null,
      targetId: input.targetId ?? null,
      outcome: input.outcome ?? 'success',
      meta,
      reason: input.reason ? String(input.reason).slice(0, 1000) : null,
      correlationId: input.correlationId ?? input.req?.correlationId ?? null,
    };

    const entry = await AuditLog.create({
      ...base,
      actorRole,
      actorName,
      actorType,
      collectionName: input.collectionName ?? input.targetType ?? null,
      operation: input.operation ?? 'update',
      severity: input.severity ?? (input.action.includes('delete') || input.action.includes('role') ? 'critical' : 'info'),
      source: input.source ?? 'app',
      correlated: input.correlated ?? true,
      diff,
      changedFields,
      before: input.before ? (redactSensitive(input.before) as any) : null,
      after: input.after ? (redactSensitive(input.after) as any) : null,
      ipHash: ipHashOf(input.req),
      userAgent: input.userAgent ?? (input.req?.headers['user-agent'] ? String(input.req.headers['user-agent']).slice(0, 200) : null),
      hv: 2,
      hash: entryHash(base, 2),
    });

    if (input.collectionName && input.targetId) {
      recordRecentMutation(input.collectionName, input.targetId);
    }

    // Stream live audit event to connected Super Admin dashboard
    emitToRoom('ops:audit', 'audit:entry', {
      id: String(entry._id),
      seq: entry.seq,
      at: entry.at,
      action: entry.action,
      collectionName: entry.collectionName,
      operation: entry.operation,
      actorName: entry.actorName || (actorId ? 'Authorized User' : 'System'),
      actorRole: entry.actorRole,
      targetType: entry.targetType,
      targetId: entry.targetId,
      outcome: entry.outcome,
      severity: entry.severity,
      source: entry.source,
      changedFields: entry.changedFields,
      reason: entry.reason,
    });

    return entry;
  } catch (err) {
    logger.error({ err: (err as Error).message, action: input.action }, 'audit write failed');
  }
}

/**
 * Convenient helper to audit a document mutation with automatic before/after diffing.
 */
export async function auditMutation(opts: {
  collection?: string;
  collectionName?: string;
  operation: 'insert' | 'update' | 'delete' | 'restore';
  targetId: string;
  targetType?: string;
  action: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
  severity?: 'info' | 'warn' | 'critical';
  req?: Request;
  actorId?: string | null;
  actorRole?: string | null;
  actorName?: string | null;
  actorType?: 'user' | 'system' | 'job' | 'database_direct' | 'migration';
  meta?: Record<string, unknown>;
  correlationId?: string | null;
}): Promise<any> {
  const coll = opts.collectionName || opts.collection || 'system';
  const { diff, changedFields } = computeDiff(opts.before, opts.after);
  const severity = opts.severity || (
    opts.operation === 'delete' || opts.action.includes('role') || opts.action.includes('permission')
      ? 'critical'
      : opts.action.includes('status') || opts.action.includes('verified')
        ? 'warn'
        : 'info'
  );

  return await audit({
    action: opts.action,
    collectionName: coll,
    targetType: opts.targetType || coll,
    targetId: opts.targetId,
    operation: opts.operation,
    before: opts.before,
    after: opts.after,
    diff,
    changedFields,
    severity,
    reason: opts.reason,
    req: opts.req,
    actorId: opts.actorId,
    actorRole: opts.actorRole,
    actorName: opts.actorName,
    actorType: opts.actorType,
    meta: opts.meta,
    correlationId: opts.correlationId,
    source: 'app',
    correlated: true,
  });
}

/**
 * Audit security-relevant events (authentication, MFA, permission denials, sensitive exports).
 */
export async function auditSecurityEvent(opts: {
  action: string;
  outcome?: 'success' | 'denied' | 'failure';
  severity?: 'info' | 'warn' | 'critical';
  req?: Request;
  actorId?: string | null;
  targetId?: string | null;
  meta?: Record<string, unknown>;
  reason?: string | null;
}): Promise<void> {
  await audit({
    action: opts.action,
    operation: 'auth',
    outcome: opts.outcome ?? 'success',
    severity: opts.severity ?? (opts.outcome === 'denied' || opts.outcome === 'failure' ? 'warn' : 'info'),
    source: 'security',
    req: opts.req,
    actorId: opts.actorId,
    targetId: opts.targetId,
    meta: opts.meta,
    reason: opts.reason,
  });
}

/**
 * Validates the cryptographic hash chain of audit logs from genesis to the latest record.
 */
export async function verifyAuditChain(limit = 10000): Promise<{ ok: boolean; checked: number; brokenAtSeq?: number }> {
  const entries = await AuditLog.find({}).sort({ seq: 1 }).limit(limit).lean();
  let prevHash: string | null = null;
  for (const e of entries) {
    if (prevHash !== null && e.prevHash !== prevHash) {
      return { ok: false, checked: entries.length, brokenAtSeq: e.seq };
    }
    const expected = entryHash(
      {
        seq: e.seq,
        prevHash: e.prevHash,
        at: e.at,
        action: e.action,
        actorId: e.actorId ? String(e.actorId) : null,
        targetType: e.targetType ?? null,
        targetId: e.targetId ?? null,
        outcome: e.outcome,
        meta: e.meta ?? {},
        reason: e.reason ?? null,
        correlationId: e.correlationId ?? null,
      },
      e.hv ?? 1,
    );
    if (expected !== e.hash) {
      return { ok: false, checked: entries.length, brokenAtSeq: e.seq };
    }
    prevHash = e.hash;
  }
  return { ok: true, checked: entries.length };
}

/**
 * Retrieves the complete lifecycle timeline of a specific database record.
 */
export async function getRecordHistory(recordId: string): Promise<{
  recordId: string;
  count: number;
  events: Array<{
    id: string;
    seq: number;
    at: string;
    action: string;
    operation: string;
    actor: string;
    actorRole: string | null;
    changedFields: string[];
    diff: FieldDiff[];
    reason: string | null;
    outcome: string;
    severity: string;
    hash: string;
  }>;
  history: Array<{
    seq: number;
    at: Date;
    action: string;
    operation: string;
    actorName: string;
    actorRole: string | null;
    changedFields: string[];
    diff: FieldDiff[];
    reason: string | null;
    outcome: string;
    severity: string;
    hash: string;
  }>;
}> {
  const entries = await AuditLog.find({ targetId: recordId }).sort({ seq: 1 }).limit(200).lean();
  return {
    recordId,
    count: entries.length,
    events: entries.map((e) => ({
      id: String(e._id),
      seq: e.seq,
      at: e.at.toISOString(),
      action: e.action,
      operation: (e as any).operation || 'update',
      actor: (e as any).actorName || (e.actorId ? 'User' : 'System'),
      actorRole: e.actorRole ?? null,
      changedFields: (e as any).changedFields || [],
      diff: (e as any).diff || [],
      reason: e.reason ?? null,
      outcome: e.outcome,
      severity: (e as any).severity || 'info',
      hash: e.hash,
    })),
    history: entries.map((e) => ({
      seq: e.seq,
      at: e.at,
      action: e.action,
      operation: (e as any).operation || 'update',
      actorName: (e as any).actorName || (e.actorId ? 'User' : 'System'),
      actorRole: e.actorRole ?? null,
      changedFields: (e as any).changedFields || [],
      diff: (e as any).diff || [],
      reason: e.reason ?? null,
      outcome: e.outcome,
      severity: (e as any).severity || 'info',
      hash: e.hash,
    })),
  };
}

/**
 * Computes high-level audit & database monitoring metrics for the Super Admin dashboard.
 */
export async function getAuditMetrics(): Promise<{
  total: number;
  totalEvents: number;
  last24h: number;
  events24h: number;
  events7d: number;
  mutationsCount: number;
  securityEventsCount: number;
  securityAlerts: number;
  byCollection: Record<string, number>;
  byOperation: Record<string, number>;
  bySeverity: Record<string, number>;
  uncorrelatedCount: number;
  uncorrelatedDirectEdits: number;
  lastIngestionAt: string | null;
}> {
  const now = new Date();
  const dayAgo = new Date(Date.now() - 24 * 3600_000);
  const weekAgo = new Date(Date.now() - 7 * 86400_000);

  const [totalEvents, events24h, events7d, collectionsAgg, opsAgg, severityAgg, uncorrelatedCount] = await Promise.all([
    AuditLog.countDocuments({}),
    AuditLog.countDocuments({ at: { $gte: dayAgo } }),
    AuditLog.countDocuments({ at: { $gte: weekAgo } }),
    AuditLog.aggregate([
      { $match: { at: { $gte: weekAgo }, collectionName: { $ne: null } } },
      { $group: { _id: '$collectionName', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
    AuditLog.aggregate([
      { $match: { at: { $gte: weekAgo } } },
      { $group: { _id: '$operation', count: { $sum: 1 } } },
    ]),
    AuditLog.aggregate([
      { $match: { at: { $gte: weekAgo } } },
      { $group: { _id: '$severity', count: { $sum: 1 } } },
    ]),
    AuditLog.countDocuments({ correlated: false }),
  ]);

  const byCollection: Record<string, number> = {};
  collectionsAgg.forEach((c) => { byCollection[c._id] = c.count; });

  const byOperation: Record<string, number> = {};
  opsAgg.forEach((o) => { byOperation[o._id || 'update'] = o.count; });

  const bySeverity: Record<string, number> = {};
  severityAgg.forEach((s) => { bySeverity[s._id || 'info'] = s.count; });

  return {
    total: totalEvents,
    totalEvents,
    last24h: events24h,
    events24h,
    events7d,
    mutationsCount: (byOperation['insert'] || 0) + (byOperation['update'] || 0) + (byOperation['delete'] || 0),
    securityEventsCount: (byOperation['auth'] || 0) + (bySeverity['critical'] || 0),
    securityAlerts: (byOperation['auth'] || 0) + (bySeverity['critical'] || 0),
    byCollection,
    byOperation,
    bySeverity,
    uncorrelatedCount,
    uncorrelatedDirectEdits: uncorrelatedCount,
    lastIngestionAt: (await AuditLog.findOne().sort({ seq: -1 }).select('at').lean())?.at?.toISOString() ?? null,
  };
}
