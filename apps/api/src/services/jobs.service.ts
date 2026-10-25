import { Job } from '../models/platform';
import { logger } from '../lib/logger';

export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;
const handlers = new Map<string, JobHandler>();

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
    { $set: { status: 'running', lockedUntil: new Date(now.getTime() + 60_000) }, $inc: { attempts: 1 } },
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
      await handler((job.payload ?? {}) as Record<string, unknown>);
      job.status = 'done';
      job.lockedUntil = null;
      job.payload = {}; // data minimisation: completed jobs keep no payload (e.g. email links)
      job.lastError = null;
    } catch (err) {
      const message = (err as Error).message?.slice(0, 500) ?? 'error';
      job.lastError = message;
      job.lockedUntil = null;
      if (job.attempts >= job.maxAttempts) {
        job.status = 'failed';
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

const periodic: { name: string; everyMs: number; fn: () => Promise<void>; last: number }[] = [];
export function registerPeriodic(name: string, everyMs: number, fn: () => Promise<void>) {
  periodic.push({ name, everyMs, fn, last: 0 });
}

let timer: NodeJS.Timeout | null = null;
let busy = false;

export function startWorker(intervalMs = 2000) {
  if (timer) return;
  timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await runDueJobs();
      const now = Date.now();
      for (const p of periodic) {
        if (now - p.last >= p.everyMs) {
          p.last = now;
          await p.fn().catch((err) => logger.error({ task: p.name, err: (err as Error).message }, 'periodic task failed'));
        }
      }
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'worker tick failed');
    } finally {
      busy = false;
    }
  }, intervalMs);
}

export function stopWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
