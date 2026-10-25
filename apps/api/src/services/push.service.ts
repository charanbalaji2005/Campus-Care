import { JWT } from 'google-auth-library';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { DeviceRegistration } from '../models/mobile';

/**
 * Firebase Cloud Messaging (HTTP v1) adapter. Push is optional: without FCM_SERVICE_ACCOUNT_JSON
 * the app still receives everything in-app and over the realtime connection, and the Super Admin
 * console reports push as "not configured". Payloads never contain case or counselling content.
 */
interface ServiceAccount { project_id: string; client_email: string; private_key: string }

let account: ServiceAccount | null | undefined;
let jwt: JWT | null = null;

function loadAccount(): ServiceAccount | null {
  if (account !== undefined) return account;
  const raw = env.FCM_SERVICE_ACCOUNT_JSON;
  if (!raw) return (account = null);
  try {
    const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const parsed = JSON.parse(text) as ServiceAccount;
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) throw new Error('incomplete');
    account = parsed;
  } catch {
    logger.error('FCM_SERVICE_ACCOUNT_JSON is not a valid service-account JSON; push disabled');
    account = null;
  }
  return account;
}

export function pushConfigured(): boolean {
  return Boolean(loadAccount());
}

async function accessToken(): Promise<string | null> {
  const a = loadAccount();
  if (!a) return null;
  jwt ??= new JWT({ email: a.client_email, key: a.private_key, scopes: ['https://www.googleapis.com/auth/firebase.messaging'] });
  const t = await jwt.getAccessToken();
  return t.token ?? null;
}

export interface PushPayload {
  title: string;
  body: string;
  kind: string;
  link?: string | null;
  priority: 'critical' | 'high' | 'normal' | 'low';
  notificationId?: string;
}

/** Sends a data message to every registered device of a user. Returns how many devices accepted it. */
export async function pushToUser(userId: string, payload: PushPayload): Promise<{ sent: number; configured: boolean }> {
  const a = loadAccount();
  if (!a) return { sent: 0, configured: false };
  const devices = await DeviceRegistration.find({ userId, pushToken: { $ne: null } }).lean();
  if (!devices.length) return { sent: 0, configured: true };
  const token = await accessToken();
  if (!token) return { sent: 0, configured: true };
  let sent = 0;
  for (const d of devices) {
    try {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${a.project_id}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token: d.pushToken,
            // Data-only: the app builds the notification itself so it can use the right channel
            // (emergency alerts use a high-importance channel that bypasses nothing it isn't allowed to).
            data: {
              title: payload.title, body: payload.body, kind: payload.kind, link: payload.link ?? '',
              priority: payload.priority, notificationId: payload.notificationId ?? '',
            },
            android: { priority: payload.priority === 'critical' || payload.priority === 'high' ? 'HIGH' : 'NORMAL', ttl: payload.priority === 'critical' ? '300s' : '86400s' },
          },
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        sent++;
      } else if (res.status === 404 || res.status === 400) {
        // Token no longer valid (app uninstalled / data cleared).
        await DeviceRegistration.updateOne({ _id: d._id }, { $set: { pushToken: null } });
      } else {
        await DeviceRegistration.updateOne({ _id: d._id }, { $inc: { pushFailures: 1 } });
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'push send failed');
    }
  }
  return { sent, configured: true };
}
