# CampusCare security notes

This describes how CampusCare protects accounts and sensitive records, and the known limits. It is a design description, not a certification.

## Accounts and sessions

- **Passwords:**
  - Hashed with Argon2id.
  - Minimum length is configurable (default 10).
  - After repeated failures the account is temporarily locked (configurable).
  - Login and forgot-password responses do not reveal whether an account exists.
- **Sessions:**
  - A random 256-bit token sits in an httpOnly cookie; only its SHA-256 hash is stored.
  - Idle and absolute expiry apply.
  - Changing or resetting the password revokes all other sessions.
  - Users can see and revoke their own sessions.
- **CSRF:** a double-submit cookie (`cc_csrf`), the `x-csrf-token` header and an `Origin` allow-list are all required on every state-changing request.
- **Single-use tokens:** email verification, password reset, staff invite and trusted-contact consent tokens are random, stored hashed, expire, and can be used once.
- **Google OAuth:**
  - Authorization Code flow with PKCE and `state`; the ID token is verified (audience, issuer, `email_verified`, hosted domain).
  - An existing password account is **never** linked automatically by email. The user must sign in and link from Account security.
- **Two-step verification:**
  - TOTP; the seeds are encrypted at rest.
  - Required for Super Admins by default and optionally for admins.
  - High-risk actions need a recent password (and code) confirmation ("re-auth").
- **Privileged accounts:**
  - There is no public sign-up for any staff role. Staff are invited by an admin; admins and Super Admins can only assign roles below their own.
  - The first Super Admin is created by a one-time CLI command that prints a single-use invite link. There are no default passwords anywhere.
  - At least one active Super Admin must always remain.
- **Bot protection:** Cloudflare Turnstile is verified server-side (Siteverify, hostname and action checks). It fails closed.

## Android app

- Sessions are bearer tokens stored only in Android Keystore–encrypted storage; the app sends no cookies, so CSRF does not apply to it. Tokens are revoked by sign-out, "sign out all devices", password change and suspension like web sessions.
- Super Admins cannot sign in from the app; other roles cannot sign in on the website.
- Realtime uses single-use 60-second tickets per connection (never the session token); every room join is re-authorised.
- Release builds allow HTTPS only (cleartext to the emulator host is allowed in debug builds only).
- Location leaves the phone only for an SOS, a Safe Walk with sharing turned on, or an explicit, time-limited live share with a persistent notification and a Stop action.
- The digital safety card is encrypted at rest and shown to responders only during an SOS raised by that student, and only with consent; each view is logged and visible in the student's privacy dashboard.
- The heatmap is k-anonymous (default k = 5, ~165 m cells); individual report locations are never returned.
- Turnstile runs inside the app on a page served by the API; the server verifies the token and hostname as for the website.
- The app has not yet been compiled, run on devices or security-tested (see README → What has been verified).

## Authorisation and privacy

- Every route checks permissions on the server. The web app's role checks are for navigation only.
- **Cases:** access to a case is computed per request as *reporter*, *handler* (assigned committee or security), *triage* or *none*.
  - Triage administrators see redacted metadata only.
  - Unauthorised requests return 404, so case IDs cannot be probed.
- **Explicit-only permissions:** `incidents:read_sensitive` and `counselling_notes:read_all` are not part of any role, including Super Admin. They must be granted to a named person with a reason, and the grant is audited.
- **Anonymous reports:**
  - Store `HMAC(ANONYMITY_KEY, userId)` instead of the user ID.
  - Handlers see "Anonymous reporter".
  - No notification or email links an account to an anonymous case.
- **Counselling notes:** visible only to the authoring counsellor. Admins see aggregate counts only.
- **Chats:**
  - Private support, counselling and case conversations are visible only to their participants.
  - Moderators see only messages *reported* in public community channels.
  - Super Admins configure channels but cannot read private conversations.
- **Files:**
  - Type is detected from magic bytes (images, videos, PDF only).
  - Size is limited, names are randomised, and files are stored outside any public folder.
  - Files are served only after an access check, with `Content-Disposition` and `nosniff`.
- **Chat media:** images and videos are off by default for every chat type. The Super Admin switch is enforced on upload and again on send.
- **Analytics:**
  - Aggregate figures only.
  - Department breakdowns exclude anonymous reports and suppress groups smaller than five.

## Integrity and monitoring

- **Audit log:**
  - Append-only (the model refuses updates and deletes).
  - Hash-chained, so gaps or edits are detectable with **Verify integrity**.
  - Records actor, action, target and outcome, never message or case content.
  - Settings changes record which paths changed. Secrets are never logged.
- **Security dashboard:** failed sign-ins, Turnstile failures, access denials, locked accounts and the two-step status of privileged accounts.

## Transport and headers

- **Web:**
  - Strict Content-Security-Policy, with only Cloudflare Turnstile and the realtime origin allowed.
  - `frame-ancestors 'none'`, `nosniff` and a strict referrer policy.
- **API:**
  - Helmet with `default-src 'none'`.
  - CORS allow-list with credentials.
  - JSON body limits.
- **Production cookies:** `Secure`, with HTTPS required everywhere.

## Known limitations

- **Rate limiting** uses an in-memory store per API instance. If you run several instances, use a shared store such as Redis, or limit at the edge (Cloudflare or Render).
- **File storage** is local disk. Use a persistent disk, or replace the driver with private object storage with server-side encryption. Files are not malware-scanned; add a scanning step if your policy requires it.
- **Database encryption:** case descriptions and messages are stored in MongoDB as plain text, protected by Atlas encryption at rest and access controls. Field-level encryption is not implemented.
- **SMS** is not built in. SOS delivery uses realtime alerts, in-app notifications and email.
- **Inbound email** relies on a signed webhook. Sender addresses can be forged, so email alone never proves identity.
- **Testing:** the API integration tests have not yet been run against a real database (see the README). No penetration test has been performed.

## Reporting a vulnerability

Contact your university IT security team. Do not include real student data in reports.
