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
- Email (Nodemailer): `EMAIL_PROVIDER=nodemailer`, `MAIL_SERVICE=gmail`, `MAIL_USER` and `MAIL_APP_PASSWORD`. Or leave these unset and add the mailbox later in **Super Admin → Email**. The `console` provider is rejected in production. Optional: `PASSWORD_RESET_TTL_MINUTES`, `EMAIL_VERIFICATION_TTL_HOURS`, `AUTH_GENERIC_RESPONSE_MS` (see section 6).

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
5. For in-app Google sign-in, both apps use this same Web client and the same API endpoint (`POST /auth/google/mobile`). In the **same** Google Cloud project also create one **Android** OAuth client per package and signing key: `in.edu.srmap.campuscare` (CampusCare Student) and `in.edu.srmap.campuscare.college` (CampusCare College), each with the **SHA-1** of the debug key (for local builds) and of the release/upload key — and, for Play-distributed builds, the Play app-signing key's SHA-1 from Play Console → App integrity. Build both apps with `-Pcampuscare.googleWebClientId=<the Web client ID>` (set in `apps/android/gradle.properties`). Optionally set `GOOGLE_ANDROID_CLIENT_IDS=<student client ID>,<college client ID>,…` on the API so only tokens issued to those Android clients (`azp`) are accepted. Only @srmap.edu.in Google accounts are accepted; an existing account is joined by email only when Google manages that address (Workspace `hd` claim), and the app a person uses never decides their role.
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

### Account emails: verification, password reset, resend

These emails carry single-use links. Configure them with the variables below (API, Render).

| Variable | Default | Purpose |
|---|---|---|
| `EMAIL_PROVIDER` | `console` | `nodemailer` sends through a real mailbox. `console` is for development only: it writes each email to `DEV_MAIL_DIR` and is refused in production. |
| `MAIL_SERVICE` | `gmail` | Nodemailer well-known service. |
| `MAIL_USER` / `MAIL_APP_PASSWORD` | – | Mailbox and app password. Both are required when `EMAIL_PROVIDER=nodemailer`. A mailbox saved in **Super Admin → Email** takes priority over these. |
| `EMAIL_FROM` / `EMAIL_FROM_NAME` | `MAIL_USER` / `CampusCare` | Sender. Gmail accepts only the mailbox itself or a verified alias. |
| `DEV_MAIL_DIR` | `.dev-mail` | Development only. Emails written here contain live links: keep the folder private and never commit it. |
| `WEB_ORIGIN` | `http://localhost:3000` | Public origin used to build every link (`/verify-email?token=…`, `/reset-password?token=…`). It must be `https://` in production (the API refuses to start otherwise) and must be the same host the Android app was built with (`campuscare.webUrl`), so App Links open the app. |
| `PASSWORD_RESET_TTL_MINUTES` | `30` | Reset link lifetime, 15–30 minutes. |
| `EMAIL_VERIFICATION_TTL_HOURS` | `24` | Verification link lifetime, 1–72 hours. |
| `EMAIL_OTP_TTL_MINUTES` | `10` | Lifetime of the 6-digit email codes (verification and password reset), 5–30 minutes. |
| `AUTH_GENERIC_RESPONSE_MS` | `400` | Minimum response time of forgot-password and resend-verification, so timing does not reveal whether an account exists. |

There is no separate `APP_PUBLIC_URL`: the website at `WEB_ORIGIN` is both the App Link host and the fallback page when the app is not installed.

How the flows behave:

- **Links.** Each link contains only the token: no email address or other personal data. Only a SHA-256 hash of the token is stored. A newer link replaces older ones.
- **Opening a link never uses it.** Email security scanners often open links. The website and the app first check the link (read-only), then wait for the person to press **Verify my email** or **Update password**, which sends the token with a POST.
- **App or web.** On Android with the app installed, `https://<WEB_ORIGIN host>/verify-email` and `/reset-password` open the app (App Links, verified by `/.well-known/assetlinks.json`; see section 9). Without the app, or on a computer, the same link opens the website page, which does the same job.
- **Generic answers.** Forgot-password and resend-verification give the same answer whether or not the address has an account. They say a link "is on its way", not that it was delivered, because delivery is queued and retried.
- **Rate limits.** Per IP: 6 email requests an hour (shared by forgot-password and resend). Per account: one email a minute and at most 5 an hour. Over the per-account limit the answer stays the same, but no email is sent. The app and website show a countdown before **Send again** is enabled.
- **When email cannot be sent**, these endpoints return `503 email_unavailable` and the screens show an error, never "sent". This happens when no provider is usable (console in production, or a mail service without credentials) or when the last 3 delivery attempts in the past 10 minutes all failed. The check looks only at the mail service, never at the requested account, so it does not reveal whether an address is registered. It clears by itself after the next successful delivery (queued emails keep retrying) or after 10 minutes. Registration that needs verification is refused in the same way, so no account gets stuck waiting for an email that cannot be sent. Watch **Super Admin → Email → Delivery log** for failures.
- **After a password reset** every session and pending sign-in is ended, other reset links stop working, and a "password changed" email (without the password) is sent. Nobody is signed in automatically: the person signs in again, and two-step verification still applies. The reset link also counts as proof of the email address, so a pending account becomes verified.
- `GET /api/v1/auth/verification-status` returns the signed-in account's own verification state.

**Code (OTP) or link.** Students and staff choose how to verify their email and how to reset a password: a
6-digit code typed into the app or website, or the link described above. The same email service, limits and
generic answers apply to both.

- Codes come from the CSPRNG (`crypto.randomInt`). Only an HMAC of the code (keyed with `SESSION_SECRET` and bound
  to the account and purpose) is stored. Codes never appear in logs, API responses, URLs or the delivery log,
  and the queued email job's copy is wiped once it is sent or given up.
- A code works once, expires after `EMAIL_OTP_TTL_MINUTES`, and is burned after 5 wrong guesses (attempts are
  reserved atomically, so parallel guesses cannot exceed 5). Asking for a new code or link ends the previous
  one, whichever kind it was. Links and codes share the per-account limits (one a minute, 5 an hour).
- **Verification:** `POST /auth/register` takes `verificationMethod: otp | link` (older clients: link) and returns a
  signed, 24-hour `verificationTicket`. So does a sign-in with the right password to an unverified account
  (`email_not_verified` error details). The ticket lets that person call `POST /auth/verification/status` (masked
  address, method, delivery status, resend wait) and `POST /auth/verification/send` (new code or link). The code is
  checked by `POST /auth/verify-email/otp`; without a matching ticket every failure gets the same answer. Queuing
  an email never verifies anything, and no session is created.
- **Password reset:** `POST /auth/forgot-password` takes `method: otp | link`. `POST /auth/reset-password/otp` exchanges
  a correct code for a 10-minute single-use reset token (same generic error for every failure), which
  `POST /auth/reset-password` then uses with the new password. The password rules, session revocation, "password
  changed" email and "no automatic sign-in" are the same as for links.
- **Super Admin accounts never get a code.** A code requested for one is answered with the usual reset or
  verification link instead (the public answer does not say so), and `/reset-password/otp` refuses them.
- Delivery status shown to a ticket holder is `sending`, `accepted` (handed to the mail service: not proof of
  delivery), `delivered` (only if the provider reports it), `bounced`, `rejected` or `failed`. Super Admin → Email
  diagnostics lists code emails next to link emails.

**Local development.** With `EMAIL_PROVIDER=console`, open the newest file in `apps/api/.dev-mail/` and copy the link into a browser. Debug builds of the app use `http://10.0.2.2:3000` as the web URL, and App Links need HTTPS, so in development open links in the browser, or send one to the emulator: `adb shell am start -a android.intent.action.VIEW -d "campuscare://open?link=/verify-email?token=<token>"`.

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
