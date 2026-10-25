import type { NotificationCategory, NotificationPriority } from '@campuscare/shared';
import { Notification } from '../models/content';
import { User } from '../models/user';
import { emitToUser } from '../realtime/socket';
import { sendEmail } from './email/email.service';
import { pushToUser } from './push.service';
import type { TemplateKey } from './email/templates';
import { logger } from '../lib/logger';

interface NotifyInput {
  userId: string;
  kind: string;
  title: string;
  /** Must never contain complaint details, counselling content or other private information. */
  body: string;
  link?: string | null;
  /** critical = emergency (always delivered on every channel); high = time-sensitive. */
  priority?: NotificationPriority;
  /** User-controllable category. Omit for account-security and safety messages. */
  category?: NotificationCategory;
  email?: { template: TemplateKey; vars: Record<string, string>; dedupeKey?: string };
  /** Wait for the push provider and report its outcome (used where delivery must be recorded, e.g. SOS). */
  awaitPush?: boolean;
}

export interface NotifyResult {
  id: string;
  /** null when push was not attempted (category muted) or not awaited. */
  push: { sent: number; configured: boolean; error?: string } | null;
}

type Prefs = Partial<Record<NotificationCategory, { inApp?: boolean; email?: boolean; push?: boolean }>>;

function channelAllowed(prefs: Prefs, category: NotificationCategory | undefined, channel: 'inApp' | 'email' | 'push', priority: NotificationPriority) {
  if (priority === 'critical' || !category) return true;
  return prefs?.[category]?.[channel] !== false;
}

export async function notify(input: NotifyInput) {
  const priority = input.priority ?? 'normal';
  const user = await User.findById(input.userId, { email: 1, fullName: 1, accountStatus: 1, privacy: 1, notificationPrefs: 1 }).lean();
  const prefs = (user?.notificationPrefs ?? {}) as Prefs;
  const showInApp = channelAllowed(prefs, input.category, 'inApp', priority);
  const n = await Notification.create({
    userId: input.userId, kind: input.kind, title: input.title, body: input.body, link: input.link ?? null, priority, category: input.category ?? null,
    // Muted categories are still recorded (for delivery history) but already marked read.
    readAt: showInApp ? null : new Date(),
  });
  if (showInApp) emitToUser(input.userId, 'notification', { id: String(n._id), kind: n.kind, title: n.title, body: n.body, link: n.link, priority, createdAt: n.createdAt });
  let push: NotifyResult['push'] = null;
  if (channelAllowed(prefs, input.category, 'push', priority)) {
    const pending = pushToUser(input.userId, { title: input.title, body: input.body, kind: input.kind, link: input.link, priority, notificationId: String(n._id) })
      .then(async (r) => {
        if (r.sent) await Notification.updateOne({ _id: n._id }, { $set: { pushedAt: new Date() } });
        return r;
      })
      .catch((err) => {
        logger.warn({ err: (err as Error).message }, 'push failed');
        return { sent: 0, configured: true, error: (err as Error).message?.slice(0, 200) ?? 'push failed' };
      });
    if (input.awaitPush) push = await pending;
  }
  if (input.email && user && user.accountStatus === 'active' && user.privacy?.allowEmailNotifications !== false && channelAllowed(prefs, input.category, 'email', priority)) {
    await sendEmail(input.email.template, user.email, { name: user.fullName, ...input.email.vars }, input.email.dedupeKey);
  }
  return Object.assign(n, { push });
}

export async function notifyMany(userIds: string[], input: Omit<NotifyInput, 'userId'>) {
  const unique = [...new Set(userIds)];
  await Promise.all(unique.map((userId) => notify({ ...input, userId })));
}
