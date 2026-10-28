import { Job } from '../models/platform';
import { logger } from '../lib/logger';

export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;
const handlers = new Map<string, JobHandler>();

/** A job that takes longer than this is treated as failed (and retried), so it can never block the queue. */
const JOB_TIMEOUT_MS = 120_000;
/** A periodic task that takes longer than this is abandoned for this round and reported. */
const PERIODIC_TIMEOUT_MS = 60_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => { t = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms); t.unref?.(); }),
  ]).finally(() => clearTimeout(t));
}

/** In-memory heartbeat of this instance's worker, shown in Super Admin diagnostics. */
const state = {
  startedAt: null as Date | null,
  lastJobTickAt: null as Date | null,
  lastJobDoneAt: null as Date | null,
  lastJobError: null as string | null,
};

export function registerJob(type: string, handler: JobHandler) {
  handlers.set(type, handler);
}

export async function enqueueJob(type: string, payload: Record<string, unknown>, opts: { runAt?: Date; dedupeKey?: string; maxAttempts?: number } = {}) {
  try {
    return await Job.create({ type, payload, runAt: opts.runAt ?? new Date(), dedupeKey: opts.dedupeKey ?? null, maxAttempts: opts.maxAttempts ?? 5 });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return null; // already queued (idempotent)
    throw err;
  }
}

/** Claims one due job atomically so several API instances can run workers safely. */
async function claimNext() {
  const now = new Date();
  return Job.findOneAndUpdate(
    {
      $or: [
        { status: 'pending', runAt: { $lte: now } },
        { status: 'running', lockedUntil: { $lte: now } }, // crashed worker
      ],
    },
    { $set: { status: 'running', lockedUntil: new Date(now.getTime() + JOB_TIMEOUT_MS + 30_000) }, $inc: { attempts: 1 } },
    { sort: { runAt: 1 }, new: true },
  );
}

export async function runDueJobs(max = 20): Promise<number> {
  let processed = 0;
  for (let i = 0; i < max; i++) {
    const job = await claimNext();
    if (!job) break;
    processed++;
    const handler = handlers.get(job.type);
    try {
      if (!handler) throw new Error(`No handler for job type ${job.type}`);
      await withTimeout(handler((job.payload ?? {}) as Record<string, unknown>), JOB_TIMEOUT_MS, `Job ${job.type}`);
      state.lastJobDoneAt = new Date();
      job.status = 'done';
      job.lockedUntil = null;
      job.payload = {}; // data minimisation: completed jobs keep no payload (e.g. email links)
      job.lastError = null;
    } catch (err) {
      const message = (err as Error).message?.slice(0, 500) ?? 'error';
      job.lastError = message;
      state.lastJobError = `${job.type}: ${message.slice(0, 200)}`;
      job.lockedUntil = null;
      if (job.attempts >= job.maxAttempts) {
        job.status = 'failed';
        if (job.type === 'email.send') job.payload = {}; // undeliverable email: drop its links (single-use tokens)
        logger.error({ jobId: String(job._id), type: job.type }, 'job failed permanently');
      } else {
        job.status = 'pending';
        // Exponential backoff: 5s, 20s, 80s, ...
        job.runAt = new Date(Date.now() + 5000 * Math.pow(4, job.attempts - 1));
      }
    }
    await job.save();
  }
  return processed;
}

interface Periodic { name: string; everyMs: number; fn: () => Promise<void>; last: number; running: boolean; startedAt: number; lastError: string | null; lastMs: number | null }
const periodic: Periodic[] = [];
export function registerPeriodic(name: string, everyMs: number, fn: () => Promise<void>) {
  periodic.push({ name, everyMs, fn, last: 0, running: false, startedAt: 0, lastError: null, lastMs: null });
}

let jobTimer: NodeJS.Timeout | null = null;
let periodicTimer: NodeJS.Timeout | null = null;
let jobsBusy = false;

async function jobTick() {
  if (jobsBusy) return;
  jobsBusy = true;
  try {
    await runDueJobs();
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'worker tick failed');
  } finally {
    jobsBusy = false;
    state.lastJobTickAt = new Date();
  }
}

/**
 * Jobs (emails, SOS delivery) and periodic tasks run on separate loops, and every periodic task runs
 * on its own with a time limit: one slow or hung task can no longer hold up the email queue (it used
 * to share a single loop, so queued emails waited until the next restart).
 */
export function startWorker(intervalMs = 2000) {
  if (jobTimer) return;
  state.startedAt = new Date();
  jobTimer = setInterval(() => void jobTick(), intervalMs);
  periodicTimer = setInterval(() => {
    const now = Date.now();
    for (const p of periodic) {
      if (p.running || now - p.last < p.everyMs) continue;
      p.last = now;
      p.running = true;
      p.startedAt = now;
      withTimeout(p.fn(), PERIODIC_TIMEOUT_MS, `Periodic task ${p.name}`)
        .then(() => { p.lastError = null; })
        .catch((err) => {
          p.lastError = (err as Error).message?.slice(0, 200) ?? 'error';
          logger.error({ task: p.name, err: p.lastError }, 'periodic task failed');
        })
        .finally(() => {
          p.running = false;
          p.lastMs = Date.now() - p.startedAt;
        });
    }
  }, intervalMs);
}

/** Runs due jobs now instead of at the next tick (e.g. right after an account email is queued). */
export function kickJobs() {
  if (process.env.NODE_ENV === 'test') return; // in tests, jobs are driven explicitly
  setImmediate(() => {
    void runDueJobs().catch((err) => logger.error({ err: (err as Error).message }, 'kickJobs failed'));
  });
  if (jobTimer) {
    setImmediate(() => void jobTick());
  }
}

export function stopWorker() {
  if (jobTimer) clearInterval(jobTimer);
  if (periodicTimer) clearInterval(periodicTimer);
  jobTimer = null;
  periodicTimer = null;
}

/** This instance's worker heartbeat (other instances report their own). */
export function workerStatus() {
  const now = Date.now();
  return {
    runningInThisInstance: Boolean(jobTimer),
    startedAt: state.startedAt,
    lastJobTickAt: state.lastJobTickAt,
    secondsSinceLastTick: state.lastJobTickAt ? Math.round((now - state.lastJobTickAt.getTime()) / 1000) : null,
    lastJobDoneAt: state.lastJobDoneAt,
    lastJobError: state.lastJobError,
    slowOrFailingTasks: periodic
      .filter((p) => p.lastError || (p.running && now - p.startedAt > 10_000))
      .map((p) => ({ name: p.name, runningForSeconds: p.running ? Math.round((now - p.startedAt) / 1000) : null, lastError: p.lastError })),
  };
}
