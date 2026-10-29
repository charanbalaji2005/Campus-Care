# CampusCare API reference

Base path: `/api/v1`. In production the browser calls the API through the web app's own origin (Next.js rewrite), so cookies stay first-party.

## Conventions

- **Responses:** success is `{ "data": ... }`; errors are `{ "error": { "code", "message", "details"? } }`. Validation errors carry `details.fields`.
- **Authentication:** an opaque session token in the httpOnly cookie `cc_session` (SameSite=Lax, Secure in production). The server stores only a SHA-256 hash, with idle and absolute expiry.
- **Android app:** sends `X-CampusCare-Client: android` and `Authorization: Bearer <sessionToken>` (returned in the body of `POST /auth/login` and `POST /auth/google/mobile`), and never cookies. Cookie-less bearer requests skip CSRF (there is no ambient credential to forge). Same expiry, revocation and MFA rules as web sessions.
- **Who signs in where:** web sign-in is accepted only for Super Admins (others get `401 use_app`); app sign-in is refused for Super Admins (`401 use_website`).
- **Account domain:** every account (registration, invitation, Google) must use an `@srmap.edu.in` address — enforced in the shared Zod schemas and again in the API, regardless of other approved domains.
- **CSRF:** every non-GET request needs the header `x-csrf-token` equal to the `cc_csrf` cookie (from `GET /auth/csrf`), plus an allowed `Origin`.
- **Turnstile:** guarded routes need `turnstileToken` in the body. It is verified with Cloudflare Siteverify (hostname + action) and fails closed.
- **Re-auth:** guarded routes return `401 reauth_required` unless the password (and two-step code, if enabled) was confirmed via `POST /auth/reauth` within the configured window.
- **Router-level guards:** all `/admin/*` routes need `admin:access`. All `/super-admin/*` routes need `super_admin:access` and the MFA policy. Everything outside `/auth/*` (except the public auth endpoints) and `/webhooks/*` needs a signed-in, active account.
- **Object-level checks:** routes with no permission in the table still check, inside the handler, that the caller may act on that specific case, thread, appointment or file. Examples: reporter, assigned committee or triage access; thread participant; the appointment's own counsellor.
- **Idempotency:** incident creation, SOS, appointment requests and chat messages accept a client-generated UUID, so retries never duplicate.
- **Realtime:** Socket.IO at path `/realtime`. Get a single-use 60-second ticket from `POST /auth/realtime-ticket`. Room joins (`case:`, `chat:`, `sos:`, `responders`) are authorised on the server.

## Endpoints

### Authentication & account

| Method | Path | Guard |
|---|---|---|
| GET | `/api/v1/auth/csrf` |  |
| GET | `/api/v1/auth/public-settings` |  |
| POST | `/api/v1/auth/register` | Turnstile |
| POST | `/api/v1/auth/verify-email/check` | Read-only; never consumes the token |
| POST | `/api/v1/auth/verify-email` | Consumes the token (explicit user action) |
| POST | `/api/v1/auth/resend-verification` | Turnstile |
| POST | `/api/v1/auth/login` | Turnstile |
| POST | `/api/v1/auth/logout` |  |
| POST | `/api/v1/auth/logout-all` |  |
| GET | `/api/v1/auth/me` |  |
| GET | `/api/v1/auth/verification-status` | Signed in (own account only) |
| POST | `/api/v1/auth/forgot-password` | Turnstile |
| POST | `/api/v1/auth/reset-password/check` | Read-only; returns `state`: valid, expired, used, invalid |
| POST | `/api/v1/auth/reset-password` | Turnstile |
| POST | `/api/v1/auth/accept-invite` |  |
| PATCH | `/api/v1/auth/me` |  |
| PATCH | `/api/v1/auth/me/privacy` |  |
| POST | `/api/v1/auth/change-password` |  |
| POST | `/api/v1/auth/reauth` |  |
| GET | `/api/v1/auth/sessions` |  |
| DELETE | `/api/v1/auth/sessions/:id` |  |
| POST | `/api/v1/auth/mfa/setup` |  |
| POST | `/api/v1/auth/mfa/confirm` |  |
| POST | `/api/v1/auth/mfa/verify` |  |
| POST | `/api/v1/auth/mfa/disable` |  |
| POST | `/api/v1/auth/realtime-ticket` |  |
| GET | `/api/v1/auth/google` |  |
| GET | `/api/v1/auth/google/callback` |  |
| DELETE | `/api/v1/auth/google/link` |  |
| GET | `/api/v1/auth/google/status` |  |

### Incidents (complaints) & case chat

| Method | Path | Guard |
|---|---|---|
| POST | `/api/v1/incidents/evidence` | incidents:create |
| POST | `/api/v1/incidents/` | incidents:create, Turnstile |
| GET | `/api/v1/incidents/` |  |
| GET | `/api/v1/incidents/:id` |  |
| PATCH | `/api/v1/incidents/:id/status` |  |
| POST | `/api/v1/incidents/:id/assign` |  |
| GET | `/api/v1/incidents/:id/assignable-staff` |  |
| GET | `/api/v1/incidents/:id/notes` |  |
| POST | `/api/v1/incidents/:id/notes` |  |
| GET | `/api/v1/incidents/:id/messages` |  |
| POST | `/api/v1/incidents/:id/messages` |  |
| POST | `/api/v1/incidents/:id/attachments` |  |
| POST | `/api/v1/incidents/:id/read-receipts` |  |
| GET | `/api/v1/incidents/:id/read-state` |  |
| GET | `/api/v1/incidents/files/:fileId` |  |

### Support, community & counselling chat

| Method | Path | Guard |
|---|---|---|
| GET | `/api/v1/chat/channels` |  |
| POST | `/api/v1/chat/services/:id/open` | chat:support |
| GET | `/api/v1/chat/channels/:id` |  |
| GET | `/api/v1/chat/channels/:id/messages` |  |
| POST | `/api/v1/chat/channels/:id/messages` |  |
| POST | `/api/v1/chat/channels/:id/attachments` |  |
| GET | `/api/v1/chat/files/:fileId` |  |
| POST | `/api/v1/chat/channels/:id/close` |  |
| POST | `/api/v1/chat/messages/:id/report` |  |
| POST | `/api/v1/chat/messages/:id/block-sender` |  |
| GET | `/api/v1/chat/blocks` |  |
| DELETE | `/api/v1/chat/blocks/:id` |  |
| GET | `/api/v1/chat/moderation/reports` | chat:moderate |
| POST | `/api/v1/chat/moderation/reports/:id` | chat:moderate |
| POST | `/api/v1/chat/messages/:id/hide` |  |

### Counselling

| Method | Path | Guard |
|---|---|---|
| GET | `/api/v1/counselling/counsellors` |  |
| GET | `/api/v1/counselling/counsellors/:id/slots` |  |
| GET | `/api/v1/counselling/appointments` |  |
| POST | `/api/v1/counselling/appointments` | appointments:request |
| PATCH | `/api/v1/counselling/appointments/:id` |  |
| GET | `/api/v1/counselling/appointments/:id/notes` |  |
| POST | `/api/v1/counselling/appointments/:id/notes` |  |
| GET | `/api/v1/counselling/availability` |  |
| PUT | `/api/v1/counselling/availability` |  |
| GET | `/api/v1/counselling/students/:studentId` |  |
| GET | `/api/v1/counselling/my-students` |  |
| GET | `/api/v1/counselling/stats` |  |

### SOS & safety

| Method | Path | Guard |
|---|---|---|
| POST | `/api/v1/safety/trusted-contacts/consent` |  |
| POST | `/api/v1/safety/sos` | sos:raise |
| GET | `/api/v1/safety/sos/mine` |  |
| GET | `/api/v1/safety/sos/:id` |  |
| POST | `/api/v1/safety/sos/:id/cancel` |  |
| GET | `/api/v1/safety/responder/alerts` | sos:respond |
| POST | `/api/v1/safety/responder/alerts/:id/acknowledge` | sos:respond |
| POST | `/api/v1/safety/responder/alerts/:id/resolve` | sos:respond |
| GET | `/api/v1/safety/responder/locations` | safety:responder_view |
| GET | `/api/v1/safety/responder/safe-walks` | safety:responder_view |
| GET | `/api/v1/safety/trusted-contacts` |  |
| POST | `/api/v1/safety/trusted-contacts` | safety:self |
| DELETE | `/api/v1/safety/trusted-contacts/:id` |  |
| GET | `/api/v1/safety/safe-walk` |  |
| POST | `/api/v1/safety/safe-walk` | safety:self |
| POST | `/api/v1/safety/safe-walk/:id/:action` |  |
| GET | `/api/v1/safety/location-share` |  |
| POST | `/api/v1/safety/location-share` | safety:self |
| PATCH | `/api/v1/safety/location-share/:id` |  |
| POST | `/api/v1/safety/location-share/:id/stop` |  |
| GET | `/api/v1/safety/campus-alerts` |  |
| POST | `/api/v1/safety/campus-alerts/:id/check-in` |  |

### Content & notifications

| Method | Path | Guard |
|---|---|---|
| GET | `/api/v1/notifications` |  |
| POST | `/api/v1/notifications/:id/read` |  |
| POST | `/api/v1/notifications/read-all` |  |
| GET | `/api/v1/announcements` |  |
| GET | `/api/v1/contacts` |  |
| GET | `/api/v1/committees` |  |
| GET | `/api/v1/training` |  |
| GET | `/api/v1/training/:id` |  |
| POST | `/api/v1/training/:id/attempt` |  |
| GET | `/api/v1/dashboard/student` |  |

### Administration

| Method | Path | Guard |
|---|---|---|
| GET | `/api/v1/admin/overview` | analytics:read |
| GET | `/api/v1/admin/analytics` | analytics:read |
| GET | `/api/v1/admin/users` | users:manage |
| POST | `/api/v1/admin/users/invite` | users:manage |
| POST | `/api/v1/admin/users/:id/status` | users:manage |
| POST | `/api/v1/admin/users/:id/resend-invite` | users:manage |
| POST | `/api/v1/admin/users/:id/recovery` | users:manage |
| GET | `/api/v1/admin/users/export` | users:manage |
| GET | `/api/v1/admin/committees` | committees:manage |
| POST | `/api/v1/admin/committees` | committees:manage |
| PATCH | `/api/v1/admin/committees/:id` | committees:manage |
| POST | `/api/v1/admin/committees/:id/members` | committees:manage |
| DELETE | `/api/v1/admin/committees/:id/members/:userId` | committees:manage |
| GET | `/api/v1/admin/staff` |  |
| GET | `/api/v1/admin/campus-alerts` | campus_alerts:manage |
| POST | `/api/v1/admin/campus-alerts` | campus_alerts:manage |
| DELETE | `/api/v1/admin/campus-alerts/:id` | campus_alerts:manage |
| GET | `/api/v1/admin/audit-logs` | audit:read |
| GET | `/api/v1/admin/audit-logs/verify` | audit:read |
| GET | `/api/v1/admin/sessions/active-count` | users:manage |
| GET/POST | `/api/v1/admin/announcements` | announcements:manage |
| PATCH/DELETE | `/api/v1/admin/announcements/:id` | announcements:manage |
| GET/POST | `/api/v1/admin/training` | training:manage |
| PATCH/DELETE | `/api/v1/admin/training/:id` | training:manage |
| GET/POST | `/api/v1/admin/contacts` | contacts:manage |
| PATCH/DELETE | `/api/v1/admin/contacts/:id` | contacts:manage |

### Super Admin

| Method | Path | Guard |
|---|---|---|
| GET | `/api/v1/super-admin/dashboard` |  |
| GET | `/api/v1/super-admin/settings` | settings:manage |
| PATCH | `/api/v1/super-admin/settings` | settings:manage, re-auth |
| GET | `/api/v1/super-admin/domains` | domains:manage |
| POST | `/api/v1/super-admin/domains` | domains:manage, re-auth |
| POST | `/api/v1/super-admin/domains/:id/verify` | domains:manage, re-auth |
| PATCH | `/api/v1/super-admin/domains/:id` | domains:manage, re-auth |
| DELETE | `/api/v1/super-admin/domains/:id` | domains:manage, re-auth |
| GET | `/api/v1/super-admin/identity-providers` | identity_providers:manage |
| PATCH | `/api/v1/super-admin/identity-providers/google` | identity_providers:manage, re-auth |
| GET | `/api/v1/super-admin/email/providers` | email:manage |
| POST | `/api/v1/super-admin/email/providers` | email:manage, re-auth |
| PATCH | `/api/v1/super-admin/email/providers/:id` | email:manage, re-auth |
| POST | `/api/v1/super-admin/email/test` | email:manage |
| GET | `/api/v1/super-admin/email/templates` | email:manage |
| PUT | `/api/v1/super-admin/email/templates/:key` | email:manage, re-auth |
| DELETE | `/api/v1/super-admin/email/templates/:key` | email:manage, re-auth |
| POST | `/api/v1/super-admin/email/templates/:key/preview` | email:manage |
| GET | `/api/v1/super-admin/email/logs` | email:manage |
| GET | `/api/v1/super-admin/email/inbound` | email:manage |
| GET | `/api/v1/super-admin/roles` | roles:manage |
| PATCH | `/api/v1/super-admin/users/:id/role` | roles:manage, re-auth |
| POST | `/api/v1/super-admin/users/:id/revoke-sessions` | security:manage, re-auth |
| POST | `/api/v1/super-admin/users/:id/reset-mfa` | security:manage, re-auth |
| GET | `/api/v1/super-admin/case-routing` | routing:manage |
| PUT | `/api/v1/super-admin/case-routing` | routing:manage, re-auth |
| GET | `/api/v1/super-admin/chat/channels` | chat:configure |
| POST | `/api/v1/super-admin/chat/channels` | chat:configure |
| PATCH | `/api/v1/super-admin/chat/channels/:id` | chat:configure |
| POST | `/api/v1/super-admin/chat/channels/reorder` | chat:configure |
| DELETE | `/api/v1/super-admin/chat/channels/:id` | chat:configure, re-auth |
| GET | `/api/v1/super-admin/emergency-recipients` | sos:configure |
| POST | `/api/v1/super-admin/emergency-recipients` | sos:configure, re-auth |
| DELETE | `/api/v1/super-admin/emergency-recipients/:id` | sos:configure, re-auth |
| GET | `/api/v1/super-admin/security/events` | security:manage |
| GET | `/api/v1/super-admin/retention/preview` | retention:manage |
| POST | `/api/v1/super-admin/retention/run` | retention:manage, re-auth |
| GET | `/api/v1/super-admin/integrations` | settings:manage |

### Android app, wellbeing & community safety

| Method & path | Who | Notes |
|---|---|---|
| `GET /mobile/config` | public | Remote config for installed apps: public settings, update policy (`update.required`), banner, cached emergency contacts, realtime URL, `pushAvailable`. |
| `GET /mobile/turnstile?action=` | public | Minimal page hosting the Turnstile widget inside the app's WebView (posts the token to the `CampusCareAndroid` bridge). |
| `POST /mobile/devices` · `DELETE /mobile/devices/current` | signed in | Register / remove this device (app version, optional FCM token). |
| `POST /auth/google/mobile` | public | `{ idToken, nonce, intent? }` from Android Credential Manager in either app (Web client ID audience; `azp` must be a listed Android client when `GOOGLE_ANDROID_CLIENT_IDS` is set). `intent` = `sign_in` or `sign_up` and, like `X-CampusCare-App`, is only a hint: the account decides. Student app: an existing student signs in; `sign_up` (or an older build without `intent`) creates a **student** only, under the student domain policy; `sign_in` with no account → `404 no_student_account`. College app: an existing staff account signs in (a pending applicant gets the restricted session); no account → `403 no_staff_account` with a sealed `staffRegistrationTicket` for `POST /auth/register-staff`. Wrong app for the role → `403 wrong_app` (nothing linked or changed). An existing account is joined by email only when the token's `hd` equals the address's domain (Google-managed Workspace address), else `409 google_link_required`. Unverified account → `403 email_not_verified` + `verificationTicket`. Accounts with MFA get `{ mfaRequired, challengeToken }` and no session until `POST /auth/mfa/challenge`. |
| `POST /incidents/suggest-category` | student | `{ text }` → suggested category, confidence, `looksUrgent`, `showCrisisSupport`. Text is not stored. Suggestion only — never decides anything. |
| `POST /incidents/:id/withdraw` · `POST /incidents/:id/reopen` | reporter | Withdraw before action starts; reopen within the configured window after resolution (`reason` required). |
| `GET /incidents/:id/read-state` · `POST /incidents/:id/read-receipts` | participants | Read receipts for case chat. |
| `GET /chat/channels/:id/messages?q=` | participants | Message search inside one conversation. |
| `POST /safety/sos` | student | Adds `notifyTrustedContacts`. Lifecycle: queued → sending → sent → acknowledged → en_route → resolved (or failed / cancelled), with a timeline. Unacknowledged alerts escalate to backup recipients, then administrators (Super Admin → SOS & safety sets the timings). |
| `POST /safety/responder/alerts/:id/en-route` · `…/notes` · `…/assign` · `…/resolve` | security | Responder actions; the student sees each step live. The student's safety card is included only if they consented. |
| `GET /safety/responder/team` · `GET /safety/responder/safe-walks` | security | Team list for assignment; overdue Safe Walks. |
| `GET,PUT,DELETE /me/safety-card` | student | AES-GCM-encrypted medical/accessibility card; `shareWithResponders` is explicit consent. |
| `GET,PUT /me/notification-prefs` | signed in | Per-category in-app / email / push switches. Critical safety alerts cannot be disabled. |
| `GET /me/privacy` | signed in | Privacy dashboard: active location shares, Safe Walk, linked accounts, sessions, trusted contacts, safety-card consent, staff access history (by role), data requests. |
| `GET /me/export` · `POST /me/data-requests` | signed in | Download own data (JSON); request deletion. |
| `GET /community/map` | signed in | Places, verified hazards, active alerts and a k-anonymous heatmap (cells below the threshold are never returned). |
| `POST /community/hazards` · `GET /community/hazards/mine` | student | Report a hazard (optionally anonymous). |
| `GET,PATCH /community/manage/hazards[/:id]` | `community_safety:manage` | Review hazards; reviewers never see the reporter. |
| `GET,POST,PATCH,DELETE /community/manage/places[/:id]` | `safety_intel:manage` | Campus places on the Safety Map. |
| `GET,POST /community/lost-found` · `GET /community/lost-found/:id` · `POST …/claims` · `POST /community/lost-found/claims/:claimId/decision` · `POST …/:id/status` · `POST,GET /community/lost-found/photos[/:id]` | signed in | Lost & found. Contact details are exchanged only after the poster approves a claim. |
| `GET,POST /community/suggestions` · `GET,PATCH /community/manage/suggestions[/:id]` | signed in / `community_safety:manage` | Anonymous suggestions and “You said, we did”. |
| `GET /community/manage/lost-found` | `community_safety:manage` | Listings for moderation. |
| `GET /super-admin/live-ops` | Super Admin | SOS response metrics, active alerts (no identities or locations), installs by app version, push status, failed jobs. |
| `GET /super-admin/data-requests` · `POST /super-admin/data-requests/:id/decision` | `retention:manage` | Complete or reject; deletion anonymises the account and needs `confirm: "DELETE ACCOUNT"` plus re-auth. |

### Community feed

Public to signed-in campus users once published. Private support chats, counselling conversations, complaint chats, SOS and location data live in their own collections and are never copied into the feed. Limits are `FEED_LIMITS` in `packages/shared/src/community.ts`.

| Method & path | Who | Notes |
|---|---|---|
| `GET /community/posts?scope=feed\|mine\|bookmarks&category=&q=&tag=&cursor=&limit=` | signed in | Feed newest first. `q` searches text and tags (`#tag` matches a tag). Pages with an opaque `cursor`. `mine`/`bookmarks` use `page`. The first feed page also returns `pinned` official announcements. Posts by people you blocked are left out. `disabled: true` when the feed is turned off. |
| `GET /community/featured` | signed in | Pinned official announcements, the next 3 events, and the counselling channel card. |
| `POST /community/posts` | `chat:community` | `{ body, category, tags[], attachmentIds[], locationLabel?, official?, clientId }`. Only `announcements:manage` may use `announcements` or `official: true` (otherwise 403 `not_official`, audited). Rate limits: 429 `rate_limited`. Same text again within 24 h: 409 `duplicate_post`. A repeated `clientId` returns the original post with `duplicate: true`. Screening may hold the post (`held: true`, `status: pending_review`). `crisisSupport` is set when the text mentions self-harm. `locationLabel` is free text the author typed; coordinates are never accepted. |
| `GET,PATCH,DELETE /community/posts/:id` | viewer / author | GET counts one unique view. PATCH edits your own post (and re-screens it), or pins an official one (`announcements:manage`). DELETE soft-deletes your own post. Channel posts are edited through the channel routes. |
| `POST /community/uploads` · `GET /community/files/:id` | participants | Images are JPG/PNG/WEBP up to 5 MB, checked from the bytes. Verified channel publishers and announcers may also upload PDFs. A file is readable only by people who can see its post (or the uploader before posting). |
| `PUT,DELETE /community/posts/:id/reaction` | signed in | `{ kind: like\|helpful\|support }`. One reaction per person, enforced by a unique index. Returns `{ reactionCount, myReaction }`. |
| `PUT,DELETE /community/posts/:id/bookmark` | signed in | Idempotent. |
| `GET,POST /community/posts/:id/comments` · `PATCH,DELETE /community/comments/:id` | signed in / author | Oldest first. Replies are one level deep. Paged with `cursor` (last top-level comment id). POST takes `{ body, parentId?, clientId }` and returns the server `commentCount`. Notifications never include the comment text. |
| `GET /community/(posts\|comments)/:id/author` | signed in | Profile preview. Students who hide their name stay anonymous. Returns `counsellorId` when a student views an active counsellor. |
| `POST /community/(posts\|comments)/:id/block-author` · `GET /community/blocks` · `DELETE /community/blocks/:id` | signed in | Uses the same block list as chat. Blocked authors' posts and comments are hidden from you, and they can't comment on your posts. Official accounts can't be blocked. |
| `POST /community/reports` | signed in | `{ targetType: post\|comment\|user, targetId, via?, reason, details? }`. One report per person per target. At `reportsToAutoHide` open reports (2 for urgent reasons) the content is held for review. |
| `POST /community/(posts\|comments)/:id/appeal` | author | `{ reason }`. One appeal per decision, reviewed by a different moderator. |
| `GET /community/moderation/queue` · `POST /community/moderation/(posts\|comments)/:id` · `POST /community/moderation/user-reports/:id` · `GET,POST /community/moderation/appeals[/:id]` | `community:moderate` | Actions: `approve\|hide\|remove\|restore\|dismiss`. Hide and remove need a `reason`, which the author sees. You can't moderate your own content or decide an appeal of your own decision. Audited. Gives no access to private chats or counselling conversations. |
| `GET,POST /community/events` · `GET,PATCH /community/events/:id` · `POST …/:id/cancel` · `POST …/:id/rsvp` | signed in / organisers | `?when=upcoming\|past&channel=counselling`. Only `announcements:manage`, `community:organize_events` or verified counselling publishers (counselling events only) can create. RSVP takes `going\|interested\|none` and respects capacity. Reminders go out about 24 h before. |

### Official Counselling Support channel and counsellor chat

| Method & path | Who | Notes |
|---|---|---|
| `GET /community/channels/counselling` | signed in | Name, description, `verified`, `following`, `canPublish` (decided by the server), topics, verified counsellors with availability (`available\|outside_hours\|away`, `nextAvailableAt`), and `emergencyNotice`. |
| `POST /community/channels/counselling/follow` | signed in | `{ following }`. Followers are notified of new posts (no content in the notification). |
| `GET /community/channels/counselling/posts?topic=&q=&cursor=` | signed in | Published posts plus `pinned` (max 3). |
| `POST /community/channels/counselling/posts` | verified publisher | `{ body, topic, tags[], attachmentIds[], resourceLinks[{title,url https}], status: draft\|published\|scheduled, scheduledAt?, commentsEnabled, pinned, clientId }`. Publishing needs the `counsellor` role, an active account and an unrevoked Super Admin verification. Anyone else gets 403 `not_publisher`, and the denial is audited. Publishing, scheduling and drafting are all audited with the counsellor's identity and the time. |
| `PATCH,DELETE /community/channels/counselling/posts/:postId` | verified publisher | Content changes and deletion are for your own posts only. Any publisher can pin or unpin published posts. Other counsellors' drafts and scheduled posts return 404. Moderated posts can't be changed or pinned (409). |
| `GET /community/channels/counselling/dashboard` | verified publisher | Your own drafts, scheduled and published posts with engagement totals. Counts only, never who viewed or reacted. |
| `GET,POST /community/channels/counselling/publishers` · `DELETE …/publishers/:userId` | `community_channels:manage` (Super Admin) | Verify or revoke publishers. Only active `counsellor` accounts can be verified. Audited. Website: Super Admin → Counselling channel. |
| `GET,POST /counselling/conversations` | signed in / student | A student opens or reopens a private one-to-one conversation with an active counsellor (`{ counsellorId }`; max 5 new per day). The list shows only conversations you belong to. |
| `GET /counselling/conversations/:id` · `GET,POST …/:id/messages` | the two participants | Anyone else gets 404, including moderators and other counsellors. Messages use the chat system (`clientMessageId` idempotency, read state via `GET /chat/channels/:id/read-state`, media policy `counselling`). Notifications contain no message text or student name. Nothing here is ever published to the feed. |

**Retention and consent.** Counselling conversations are kept while both accounts are active so the student and counsellor can refer back to them. The automatic retention job (Super Admin → Data retention) only covers community chat messages today and does **not** expire counselling conversations. They are removed through the student's data-deletion request (`POST /me/data-requests`). The institution should decide the retention period for counselling conversations and add it to the retention job. Students are told in the app that the chat is confidential, is not an emergency service, and that replies may take time.

### Webhooks

| Method | Path | Guard |
|---|---|---|
| POST | `/api/v1/webhooks/inbound-email` |  |

## Chat media (images and videos)

All media sending is **off by default**. The Super Admin controls it with `PATCH /super-admin/settings`, for example:

```json
{ "settings": { "chat": { "media": { "support": { "images": true, "videos": false } }, "maxImageMb": 10, "maxVideoMb": 50 } } }
```

The available scopes are `support`, `counselling`, `case` and `community`.

The policy is enforced twice:

1. **On upload** (`POST /chat/channels/:id/attachments`, `POST /incidents/:id/attachments`): the file type is detected from magic bytes, not the extension or the client MIME type.
2. **On send**, when the attachment is referenced in a message.

A disabled scope returns `403 media_disabled`. Files are stored privately and served only to participants of the conversation.
