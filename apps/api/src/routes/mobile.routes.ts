import { Router } from 'express';
import { deviceRegistrationSchema } from '@campuscare/shared';
import { asyncHandler, ok, parse } from '../lib/http';
import { env, turnstileKeys } from '../config/env';
import { getSettings, publicSettings } from '../services/settings.service';
import { Contact } from '../models/content';
import { DeviceRegistration } from '../models/mobile';
import { requireAuth } from '../middleware/auth';
import { pushConfigured } from '../services/push.service';

/**
 * Endpoints used only by the CampusCare Android app.
 * The Super Admin website controls everything returned by /config (minimum app version, banner,
 * feature switches, emergency numbers), so a published APK stays in sync with the platform.
 */
export const mobileRouter = Router();

mobileRouter.get(
  '/config',
  asyncHandler(async (req, res) => {
    const [settings, pub] = await Promise.all([getSettings(), publicSettings()]);
    const versionCode = Number(req.headers['x-app-version-code'] ?? 0);
    const emergency = await Contact.find({ emergency: true, verified: true }).sort({ order: 1 }).limit(12).lean();
    ok(res, {
      serverTime: new Date().toISOString(),
      settings: pub,
      update: {
        required: versionCode > 0 && versionCode < settings.mobile.minSupportedVersionCode,
        available: versionCode > 0 && versionCode < settings.mobile.latestVersionCode,
        latestVersionName: settings.mobile.latestVersionName,
        downloadUrl: settings.mobile.downloadUrl || null,
        message: settings.mobile.updateMessage,
      },
      banner: settings.mobile.bannerMessage ? { message: settings.mobile.bannerMessage, severity: settings.mobile.bannerSeverity } : null,
      // Cached on the device so the emergency screen keeps working when the server is unreachable.
      emergencyContacts: emergency.map((c) => ({ id: String(c._id), name: c.name, phone: c.phone, category: c.category, purpose: c.purpose })),
      pushAvailable: pushConfigured(),
      realtimeUrl: env.API_PUBLIC_URL,
      realtimePath: '/realtime',
    });
  }),
);

/**
 * Hosts the Cloudflare Turnstile widget for the app's WebView. The token is handed to the app
 * through a JavaScript interface and then verified server-side like any other Turnstile token.
 * Add this API's hostname to the widget's hostnames and to TURNSTILE_EXPECTED_HOSTNAMES.
 */
mobileRouter.get('/turnstile', (req, res) => {
  const action = String(req.query.action ?? 'login').replace(/[^a-zA-Z]/g, '').slice(0, 32) || 'login';
  const siteKey = turnstileKeys.siteKey ?? '';
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; script-src 'unsafe-inline' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'unsafe-inline'; connect-src https://challenges.cloudflare.com; frame-ancestors 'none'",
  );
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;background:transparent;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:sans-serif}</style>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=ccLoad&render=explicit" async defer></script></head>
<body><div id="w"></div><script>
function send(kind, value){ try { window.CampusCareAndroid && window.CampusCareAndroid[kind](value || ''); } catch(e){} }
function ccLoad(){ turnstile.render('#w', { sitekey: ${JSON.stringify(siteKey)}, action: ${JSON.stringify(action)}, theme: 'light', size: 'flexible',
  callback: function(t){ send('onToken', t); }, 'expired-callback': function(){ send('onExpired'); }, 'error-callback': function(e){ send('onError', String(e)); } }); }
</script></body></html>`);
});

mobileRouter.post(
  '/devices',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = parse(deviceRegistrationSchema, req.body);
    await DeviceRegistration.findOneAndUpdate(
      { sessionId: req.authSession!._id },
      {
        $set: {
          userId: req.user!._id, platform: input.platform, pushToken: input.pushToken ?? null, appVersion: input.appVersion,
          appVersionCode: input.appVersionCode, deviceName: input.deviceName ?? null, lastSeenAt: new Date(), pushFailures: 0,
        },
      },
      { upsert: true },
    );
    ok(res, { ok: true, pushAvailable: pushConfigured() });
  }),
);

mobileRouter.delete(
  '/devices/current',
  requireAuth,
  asyncHandler(async (req, res) => {
    await DeviceRegistration.deleteOne({ sessionId: req.authSession!._id });
    ok(res, { ok: true });
  }),
);
