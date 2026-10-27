import http from 'node:http';
import { env } from './config/env';
import { logger } from './lib/logger';
import { connectDatabase, disconnectDatabase } from './db/connect';
import { createApp } from './app';
import { initRealtime, closeRealtime } from './realtime/socket';
import { startWorker, stopWorker, registerPeriodic } from './services/jobs.service';
import { Evidence } from './models/incident';
import { storage } from './services/storage.service';
import { Appointment } from './models/counselling';
import { notify } from './services/notification.service';
import { getSettings } from './services/settings.service';
import { appLink } from './services/email/email.service';
import { autoSeedDatabase } from './db/auto-seed';
import { startDbWatcher, stopDbWatcher } from './services/db-watcher.service';

async function main() {
  await connectDatabase();
  await autoSeedDatabase();
  const app = createApp();
  const server = http.createServer(app);
  initRealtime(server);
  void startDbWatcher();

  if (env.RUN_WORKER) {
    // Remove uploads that were never attached to a message or case (after 24h).
    registerPeriodic('orphan-uploads', 60 * 60_000, async () => {
      const stale = await Evidence.find({ bound: false, createdAt: { $lt: new Date(Date.now() - 86400_000) } }).select('+storageKey').limit(200);
      for (const f of stale) {
        await storage.remove(f.storageKey).catch(() => undefined);
        await f.deleteOne();
      }
    });
    // Appointment reminders.
    registerPeriodic('appointment-reminders', 5 * 60_000, async () => {
      const s = await getSettings();
      if (!s.notifications.emailAppointmentReminders) return;
      const until = new Date(Date.now() + s.notifications.reminderHoursBefore * 3600_000);
      const due = await Appointment.find({ status: { $in: ['confirmed', 'rescheduled'] }, reminderSentAt: null, startAt: { $gt: new Date(), $lte: until } }).limit(100);
      for (const a of due) {
        const when = a.startAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
        await notify({ userId: String(a.studentId), kind: 'appointment', category: 'appointments', title: 'Appointment reminder', body: `Your appointment is on ${when}.`, link: '/student/counselling', email: { template: 'appointment_reminder', vars: { when, link: appLink('/student/counselling') }, dedupeKey: `reminder:${a._id}:${a.startAt.toISOString()}` } });
        a.reminderSentAt = new Date();
        await a.save();
      }
    });
    startWorker();
  }

  server.listen(env.PORT, () => logger.info({ port: env.PORT }, 'CampusCare API listening'));

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    stopWorker();
    stopDbWatcher();
    closeRealtime();
    server.close(async () => {
      await disconnectDatabase().catch(() => undefined);
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err: (err as Error).message }, 'failed to start');
  process.exit(1);
});
