# CampusCare

A university safety, complaint and wellbeing platform with these parts:

- Incident reporting, with optional anonymity, committee routing and a private case chat.
- Anti-ragging, gender-sensitivity and grievance workflows.
- Counselling appointments with confidential notes.
- Private support chat and a moderated community chat.
- A 10-second SOS with campus-security response.
- Safe Walk, trusted contacts, live location sharing and campus alerts.
- Smart SOS with escalation, Safe Walk, live location, a privacy-preserving safety map, hazard reports, lost & found,
  anonymous suggestions, awareness training with certificates, a digital safety card and a privacy dashboard.

**Two clients, one backend:**

- **Android app (Kotlin + Jetpack Compose)** — for students, counsellors, committee members, Campus Security
  responders, administrators and moderators.
- **Website (Next.js)** — the **Super Admin control centre only**. Everything the Super Admin changes reaches
  installed APKs through the API (remote config, realtime and push) without a new build.

Accounts can only be created with an official **@srmap.edu.in** email address.

> **Status:** feature-complete codebase, not yet production-certified. See [What has been verified](#what-has-been-verified) and the go-live checklist in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Repository layout

```
apps/
  web/        Next.js 15 (App Router) + TypeScript, Tailwind, Radix/shadcn-style UI, Framer Motion, Recharts, Lucide
  api/        Express + TypeScript, MongoDB (Mongoose), Zod, Socket.IO, Argon2id, Nodemailer
  android/    Kotlin 2.1 + Jetpack Compose (Material 3) app — see apps/android/README.md
packages/
  shared/     Zod schemas, roles & permissions, workflow transitions, settings defaults, media policy (used by both apps)
docs/         API.md, DEPLOYMENT.md, SECURITY.md
render.yaml   Render blueprint for the API
.github/workflows/android.yml   builds the APK (debug on push, signed release on v* tags)
```

## Who uses what

| Role | Client |
|---|---|
| Student | Android app — home dashboard, SOS, report incident, my reports + case chat, counselling, Safe Walk, safety map, community, profile & privacy |
| Counsellor | Android app — today, sessions, availability, private notes, messages |
| Committee member | Android app — case queue, case workspace (status, assignment, internal notes, chat) |
| Campus Security | Android app — live SOS queue with On-duty mode, alert detail (acknowledge → on my way → resolve), live map |
| Administrator / moderator | Android app — triage, campus alerts, announcements, staff invites, moderation |
| **Super Admin** | **Website** `/super-admin/*` (entry `/super-admin/login`) |

The API refuses website sign-in for every role except Super Admin (`use_app`) and refuses app sign-in
for Super Admins (`use_website`). Old web links such as `/student/...` show an "Open the app" page, and
open the app directly once Android App Links are configured.

## Quick start (local)

Requirements: Node 20+ and a MongoDB database (an Atlas free cluster works).

```bash
npm install
cp apps/api/.env.example apps/api/.env      # fill in MONGODB_URI and generate the three secrets
cp apps/web/.env.example apps/web/.env.local
npm run build:shared

npm run seed                                  # reference data: committees, routing, placeholder contacts, training, channels
# optional fictional demo accounts (development only, you choose the password):
SEED_DEMO_USERS=true SEED_DEMO_PASSWORD='choose-a-long-password' npm run seed

# first Super Admin — prints a single-use invite link (no default password exists)
SUPER_ADMIN_EMAIL=it-admin@srmap.edu.in SUPER_ADMIN_NAME="Your Name" npm run bootstrap:super-admin

npm run dev:api     # http://localhost:4000
npm run dev:web     # http://localhost:3000
```

In development:

- Turnstile uses Cloudflare's public test keys.
- Emails are written to `apps/api/.dev-mail/` instead of being sent.

Demo accounts are fictional people with `cc-demo-…@srmap.edu.in` addresses (`cc-demo-student@`, `cc-demo-student2@`, `cc-demo-counsellor@`, `cc-demo-committee@`, `cc-demo-icc@`, `cc-demo-security@`, `cc-demo-admin@`). They sign in from the Android app (debug build pointing at `http://10.0.2.2:4000` on the emulator). The seed refuses to create them in production.

Android: open `apps/android` in Android Studio, or `cd apps/android && ./gradlew assembleDebug`. See [apps/android/README.md](apps/android/README.md).

## Commands

| Command | What it does |
|---|---|
| `npm run build` | Build shared → api → web |
| `npm run typecheck` | Type-check all workspaces |
| `npm test` | Unit tests. API integration tests run only when `MONGODB_URI` is set. |
| `npm run seed` | Reference data (+ demo data with `SEED_DEMO_USERS=true`, refused in production) |
| `npm run bootstrap:super-admin` | One-time first Super Admin invitation |
| `npm run sync-indexes -w @campuscare/api` | Create MongoDB indexes (required in production) |

## Email (Nodemailer)

Emails are sent with **Nodemailer**, which signs in to a real mailbox using an **app password**. Gmail / Google Workspace is the default. Microsoft 365, Outlook.com, Yahoo and Zoho can also be chosen. There are no raw SMTP host or port settings.

```env
EMAIL_PROVIDER=nodemailer
MAIL_SERVICE=gmail
MAIL_USER=campuscare-noreply@your-university.edu
MAIL_APP_PASSWORD=abcdefghijklmnop   # Google Account → Security → 2-Step Verification → App passwords
```

You can also set the mailbox in **Super Admin → Email**, which overrides these environment variables. **Test sign-in & send** checks the login and then sends you a test email.

With `EMAIL_PROVIDER=console` (development only), emails are written to `apps/api/.dev-mail/` instead of being sent.

## Image and video sending in chats

Image and video sending is **off by default** for every chat type:

- private support
- counselling
- complaint (case) chat
- community

A Super Admin turns it on per chat type, separately for images and videos, with size limits, in **Super Admin → Support & chat**.

When it is off:

- the attach button is not shown;
- the API rejects uploads and messages with `403 media_disabled`.

The switch is checked both when a file is uploaded and when the message is sent. File types are detected from file contents, not names. Files are private to the conversation's participants.

## Security design (summary)

Full details are in [docs/SECURITY.md](docs/SECURITY.md).

- **Sessions:** server-side, httpOnly cookies, CSRF double-submit + Origin check, idle/absolute expiry, revocation on password change.
- **Passwords:** Argon2id. Lockout after repeated failures. Generic responses on login and password reset.
- **Email verification:** single-use, hashed tokens.
- **Google OAuth:** PKCE + state; no automatic account linking by email.
- **Two-step verification:** TOTP. Required for Super Admins by default.
- **No public privileged sign-up:** staff are invited; the first Super Admin comes from a CLI bootstrap.
- **Turnstile:** verified on the server for registration, sign-in, password reset, resend-verification and incident submission.
- **Least privilege:**
  - Triage admins see redacted case metadata only.
  - Sensitive case content and counselling notes need explicit, per-person permissions that no role has by default.
  - Moderators see only reported *community* messages.
- **Anonymous reports:** stored with a keyed HMAC tag, never a user ID.
- **Audit log:** append-only and hash-chained, with a verify button.
- **Secrets at rest:** the mail app password, Google client secret and MFA seeds are encrypted with AES-256-GCM.

## What has been verified

Run in the development sandbox:

- `packages/shared`: 15 unit tests pass (including the @srmap.edu.in account rule and the category helper).
- `apps/api`: TypeScript compiles cleanly; 32 unit tests pass (Turnstile, crypto, file sniffing, email templates and the Nodemailer settings, case access policy, slot generation, settings validation, CSRF, bearer-token app requests, optional push, chat media gate).
- `apps/web`: TypeScript compiles cleanly and `next build` succeeds. A local `next start` smoke test confirmed: `/.well-known/assetlinks.json` is generated from the environment, old student links show the "open in the app" page, and console pages redirect to `/super-admin/login` without a session.
- `apps/android`: every Kotlin file parses (tree-sitter), and scripted checks found no unresolved project imports, no wrong or missing arguments in calls to project functions, and no icon names outside the Material icon catalogue (a few newer icons could still be absent from Compose's icon set — the compiler will say). Every endpoint the app calls was matched against the API's route table.

**Not yet verified:**

- **The Android app has not been compiled or run.** Google's Maven repository and the Gradle distribution were not reachable from the build sandbox, so no APK was produced. Build it with Android Studio or the included GitHub Actions workflow and fix any compiler messages before distributing it.
- **API integration tests** (11 tests — the original 6 plus: Super-Admin-only website sign-in, app bearer sessions and logout, public remote config, the @srmap.edu.in lock with another approved domain, and SOS escalation/acknowledgement with the live-ops privacy check) are written but were **not run**: no MongoDB was available. Run them with `MONGODB_URI=… npm test`.
- No end-to-end test against a real database, email provider, Turnstile production keys, Google OAuth, FCM or a physical phone.
- No load test, accessibility audit or independent security review.

Do not treat this as production-ready until the checklist in `docs/DEPLOYMENT.md` is complete.

## Credentials you will need to supply

- MongoDB Atlas connection string.
- Three generated secrets: `SESSION_SECRET`, `APP_ENCRYPTION_KEY`, `ANONYMITY_KEY`.
- Cloudflare Turnstile site key and secret.
- A sending mailbox for Nodemailer (Gmail / Google Workspace by default) and its app password.
- Android release signing key (`keystore.properties`, never committed) and its SHA-256 fingerprint for App Links.
- Optional:
  - Google OAuth client ID and secret (plus an Android OAuth client for in-app Google sign-in).
  - Firebase project (`google-services.json` for the app, `FCM_SERVICE_ACCOUNT_JSON` for the API) for push notifications.
  - An inbound-email webhook secret.

None are included in this repository.
