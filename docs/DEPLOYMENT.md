# Deploying CampusCare (Vercel + Render + MongoDB Atlas + Android)

```
Android app ──HTTPS (bearer token)──────────────┐
             ──WSS (/realtime, single-use ticket)┤
                                                 ▼
Super Admin browser ──HTTPS──► Vercel (Next.js, apps/web)
                    │  /api/v1/*  rewrite (cookies stay first-party)
                    ▼
                 Render web service (Express + Socket.IO, apps/api) ──► MongoDB Atlas
                    ▲
Browser ──WSS (/realtime, single-use ticket)──┘
```

## 1. MongoDB Atlas

1. Create a cluster. M10 or higher is recommended for production: it gives backups and a private endpoint.
2. **Database Access:** create a user `campuscare_app` with *readWrite* on the `campuscare` database only. Use a long random password.
3. **Network Access:** allow Render's outbound IPs, or use private networking. Do not use `0.0.0.0/0` in production.
4. Copy the `mongodb+srv://` connection string into `MONGODB_URI` on Render.
5. Enable continuous backup / point-in-time restore. Test a restore before go-live.

**Indexes:** production runs with `autoIndex` off. After the first deploy, and after each deploy that changes models, run `npm run sync-indexes -w @campuscare/api`. These indexes enforce unique case numbers, double-booking protection and the TTL clean-up of tokens and sessions, so do not skip this.

## 2. API on Render

Use the included `render.yaml` blueprint, or create a **Web Service** by hand:

| Setting | Value |
|---|---|
| Root directory | *(repository root)* |
| Build command | `npm ci --include=dev && npm run build -w @campuscare/shared && npm run build -w @campuscare/api` |
| Post-deploy | `npm run sync-indexes -w @campuscare/api` (Render "pre-deploy command") |
| Start command | `npm start -w @campuscare/api` |
| Health check path | `/api/v1/health` |
| Node | 20+ |
| Persistent disk | Mount at `/var/data`, then set `STORAGE_DIR=/var/data/private` (evidence and chat files) |

Set the environment variables from `apps/api/.env.example`. In production you must set:

- `NODE_ENV=production`, `COOKIE_SECURE=true`, `TRUST_PROXY=1`.
- `WEB_ORIGIN=https://<your-vercel-domain>` and `API_PUBLIC_URL=https://<your-render-domain>`.
- `SESSION_SECRET`, `ANONYMITY_KEY`: run `openssl rand -base64 48` for each.
- `APP_ENCRYPTION_KEY`: run `openssl rand -base64 32`.
  - Keep it safe. Losing it makes the stored mail app password, Google secret and MFA seeds unreadable.
  - Changing `ANONYMITY_KEY` breaks the link between students and their anonymous reports.
- `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET`, `TURNSTILE_EXPECTED_HOSTNAMES`. The API refuses to start in production without them.
- `MONGODB_URI`.
- Android: `ANDROID_PACKAGE_NAME=in.edu.srmap.campuscare` and `ANDROID_CERT_SHA256=<release certificate SHA-256>` (see section 9).
- Push (optional): `FCM_SERVICE_ACCOUNT_JSON` — the Firebase service-account JSON (one line). Without it the app still receives alerts in-app and over realtime.
- Email (Nodemailer): `EMAIL_PROVIDER=nodemailer`, `MAIL_SERVICE=gmail`, `MAIL_USER` and `MAIL_APP_PASSWORD`. Or leave these unset and add the mailbox later in **Super Admin → Email**. The `console` provider is rejected in production.

The background worker (email retries, SOS delivery, Safe Walk overdue checks, reminders) runs in the API process when `RUN_WORKER=true`. If you scale to several instances, set `RUN_WORKER=true` on exactly one of them. Jobs are claimed atomically, so a second worker is safe but unnecessary.

## 3. Web app on Vercel

| Setting | Value |
|---|---|
| Root directory | `apps/web` |
| Install command | `cd ../.. && npm ci --include=dev` |
| Build command | `cd ../.. && npm run build -w @campuscare/shared && npm run build -w @campuscare/web` |
| Output | Next.js (default) |

Environment variables:

- `API_ORIGIN=https://<your-render-domain>`. Server-side only; used by the `/api/v1/*` rewrite.
- `NEXT_PUBLIC_REALTIME_URL=https://<your-render-domain>`. Used by Socket.IO.
- `ANDROID_PACKAGE_NAME` and `ANDROID_CERT_SHA256` (same values as on Render). Server-side only; they generate `/.well-known/assetlinks.json` so email links open the app.
- `NEXT_PUBLIC_ANDROID_PACKAGE_NAME` (optional, defaults to `in.edu.srmap.campuscare`) for the "Open the app" button.

The website is the **Super Admin console only**. Students and staff who open it see a page that hands them over to the Android app; the API refuses web sign-in for every other role.

No secret is ever given to the web app. The Turnstile *site key* reaches the browser from `GET /api/v1/auth/public-settings`.

Add your custom domain. Then update `WEB_ORIGIN` on Render and the Turnstile hostname list to match.

## 4. Cloudflare Turnstile

1. Cloudflare dashboard → Turnstile → **Add widget** (Managed mode).
2. Add your production hostname(s) — **both** the website's domain and the **API's domain**. The Android app runs the widget on a page served by the API (`/api/v1/mobile/turnstile`), so `TURNSTILE_EXPECTED_HOSTNAMES` on Render must also include the API hostname.
3. Put the site key and secret on Render (`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET`).
4. Choose which forms are protected in **Super Admin → Security**.

In development, Cloudflare's documented test keys are used automatically: site key `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`.

## 5. Google sign-in (optional)

1. Google Cloud Console → APIs & Services → Credentials → **OAuth client ID** (Web application).
2. Authorised JavaScript origin: your web origin.
3. Authorised redirect URI: copy it from **Super Admin → Sign-in providers**. It is `https://<web-domain>/api/v1/auth/google/callback`.
4. Enter the client ID and secret in that page and enable the provider. The secret is encrypted at rest.
5. For in-app Google sign-in, also create an **Android** OAuth client (package name + your signing certificate's **SHA-1**) and build the app with `-Pcampuscare.googleWebClientId=<the Web client ID>`. Only @srmap.edu.in Google accounts are accepted, and an existing account is never linked by email automatically.
6. On the website, Google sign-in is available to the Super Admin only after linking it from Account security.

## 6. Email

- **Outbound (Nodemailer + Gmail):**
  1. Create a dedicated mailbox, ideally on Google Workspace, e.g. `campuscare-noreply@your-university.edu`.
  2. Turn on 2-Step Verification for it.
  3. Create an **app password** at <https://myaccount.google.com/apppasswords>. On Google Workspace, your admin must allow app passwords.
  4. Enter the mailbox and app password in **Super Admin → Email**, or set `MAIL_USER` / `MAIL_APP_PASSWORD` on Render.
  5. Press **Test sign-in & send**. It checks the sign-in first, then sends you a test email.
  - Microsoft 365, Outlook.com, Yahoo and Zoho are also offered. Microsoft has been phasing out password-based (basic) sign-in for sending mail, so confirm your tenant still allows it before choosing Microsoft 365.
  - Gmail caps daily sending (about 500 messages for personal Gmail, about 2,000 for Workspace). For a large campus, use a dedicated Workspace mailbox and watch **Email → Delivery log**.
  - The From address must be the mailbox itself or a verified "Send mail as" alias. SPF, DKIM and DMARC for your domain must cover Google.
- **Inbound (optional):** point your provider's inbound webhook at `https://<api-domain>/api/v1/webhooks/inbound-email`. Set the same `INBOUND_EMAIL_WEBHOOK_SECRET` there and on Render. Requests must carry the header `x-campuscare-signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">` and be no more than 5 minutes old. Most providers need a small relay (for example, a serverless function) to add this signature.

## 7. First Super Admin (no default passwords)

Run this once from a Render shell, or locally against the production database:

```bash
SUPER_ADMIN_EMAIL=it.admin@srmap.edu.in SUPER_ADMIN_NAME="IT Administrator" npm run bootstrap:super-admin
```

It prints a **single-use invite link** that is valid for 24 hours. Open it, set a password and enrol two-step verification.

The command refuses to run if a Super Admin already exists. Add further administrators from inside the console.

Then, in the console:

1. Add and verify your **approved email domains**.
2. Configure **email** and **Turnstile**.
3. Create **committees** and **case routing**.
4. Invite staff.
5. Add **emergency contacts** and **SOS recipients**.
6. Review **Support & chat**. Image and video sending is off by default.

Optional reference data (committees, routing rules, placeholder contacts, training modules, chat channels): `npm run seed`. Replace the placeholder contacts with real, verified numbers. Demo accounts (`SEED_DEMO_USERS=true`) are refused when `NODE_ENV=production`.

## 8. Before go-live checklist

- [ ] The Android app builds in CI, is installed on test phones of several Android versions, and every role signs in and completes its main flows against staging.
- [ ] App Links verified: `adb shell pm get-app-links in.edu.srmap.campuscare` shows the website domain as `verified`.
- [ ] **Mobile app** page in the console has the download link and current version numbers.

- [ ] Integration tests run against a staging Atlas cluster: set `MONGODB_URI` and run `npm test -w @campuscare/api`.
- [ ] Restore from backup tested.
- [ ] Nodemailer mailbox verified with **Test sign-in & send**; verification and reset emails arrive and are not marked as spam.
- [ ] An end-to-end SOS test with real security staff and devices. Check the delivery states are accurate.
- [ ] Emergency phone numbers in the contacts directory verified by calling them.
- [ ] Data retention periods agreed with the university's records and legal teams.
- [ ] Privacy notice reviewed by the university.
- [ ] Independent security review / penetration test.
- [ ] Persistent disk, or private object storage, attached for uploads. Without it, files are lost on redeploy.

## 9. Android app

Full instructions: [apps/android/README.md](../apps/android/README.md).

1. **Signing key** — create once with `keytool` and keep it safe (losing it means users must reinstall). Never commit it.
2. **Build** — GitHub Actions (`.github/workflows/android.yml`): set the repository variables `CAMPUSCARE_API_URL` (your Render URL), `CAMPUSCARE_WEB_URL` (your Vercel URL), optional `CAMPUSCARE_GOOGLE_WEB_CLIENT_ID`, and the secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` (optional `GOOGLE_SERVICES_JSON`). Push a tag like `v1.0.0` to get a signed APK and AAB as workflow artifacts. Locally: `./gradlew assembleRelease -Pcampuscare.apiUrl=https://…`.
3. **App Links** — copy the release certificate's SHA-256 (printed by the workflow, or `keytool -list -v -keystore …`) into `ANDROID_CERT_SHA256` on Render and Vercel. If you publish through Google Play with Play App Signing, use the *app signing key* fingerprint from Play Console (you can list both, comma-separated).
4. **Distribution** — publish on Google Play (recommended) or host the APK at an HTTPS URL. Put the link and version numbers in **Super Admin → Mobile app**; raise *Minimum supported version code* to force old installs to update.
5. **Push (optional)** — create a Firebase project, add an Android app with the package name, provide `google-services.json` to the build (`GOOGLE_SERVICES_JSON` secret) and the service-account JSON to the API (`FCM_SERVICE_ACCOUNT_JSON`). **Super Admin → Live operations** shows how many installs have push enabled.
6. **Responders** — Campus Security staff should switch **On duty** in the app during shifts so SOS alerts arrive instantly even with the app in the background.
