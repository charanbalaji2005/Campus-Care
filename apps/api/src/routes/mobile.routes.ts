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
  // mode=background (newer apps): the widget runs inline while the form is filled in, stays invisible
  // unless Cloudflare needs the person to interact, and refreshes its token before it expires. Older
  // apps omit it and keep the original always-visible dialog behaviour.
  const background = req.query.mode === 'background';
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; script-src 'unsafe-inline' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'unsafe-inline'; connect-src https://challenges.cloudflare.com; frame-ancestors 'none'",
  );
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
  html,body{margin:0;padding:0;background:transparent;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-user-select:none;user-select:none}
  #w{display:flex;justify-content:center;align-items:center;min-height:65px;min-width:300px}
</style>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=ccLoad&render=explicit" async defer onerror="ccErr('script_load_error')"></script>
</head>
<body>
  <div id="w"></div>
  <script>
    function send(kind, value){
      try {
        if (window.CampusCareAndroid && typeof window.CampusCareAndroid[kind] === 'function') {
          window.CampusCareAndroid[kind](value !== undefined ? String(value) : '');
        }
      } catch(e) {}
    }
    function ccErr(msg){ send('onError', msg || 'turnstile_error'); }
    function ccLoad(){
      try {
        if (!window.turnstile) { ccErr('turnstile_not_available'); return; }
        send('onLoaded', '');
        var id = turnstile.render('#w', {
          sitekey: ${JSON.stringify(siteKey)},
          action: ${JSON.stringify(action)},
          theme: 'light',
          size: 'flexible',${background ? `
          appearance: 'interaction-only',
          'refresh-expired': 'auto',
          'before-interactive-callback': function(){ send('onInteractive', '1'); },
          'after-interactive-callback': function(){ send('onInteractive', '0'); },` : ''}
          callback: function(token){ send('onToken', token); },
          'expired-callback': function(){ send('onExpired', ''); },
          'error-callback': function(code){ send('onError', String(code || 'challenge_failed')); }
        });
        // Called by the app after it has used a token (tokens are single use) to prepare the next one.
        window.ccReset = function(){ try { turnstile.reset(id); } catch(e) { ccErr('reset_failed'); } };
      } catch(e) {
        ccErr(e && e.message ? e.message : 'render_failed');
      }
    }
  </script>
</body></html>`);
});

mobileRouter.post(
  '/devices',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = parse(deviceRegistrationSchema, req.body);
    // One FCM token = one app installation = the account signed in there now. If the app switched
    // accounts without a clean sign-out (offline logout), drop the old account's row so its
    // notifications never reach the person now using this phone.
    if (input.pushToken) await DeviceRegistration.deleteMany({ pushToken: input.pushToken, sessionId: { $ne: req.authSession!._id } });
    await DeviceRegistration.findOneAndUpdate(
      { sessionId: req.authSession!._id },
      {
        $set: {
          userId: req.user!._id, platform: input.platform, app: req.authSession!.app ?? req.clientApp ?? null, pushToken: input.pushToken ?? null, appVersion: input.appVersion,
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
