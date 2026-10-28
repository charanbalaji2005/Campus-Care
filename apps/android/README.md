# CampusCare Android apps (Kotlin + Jetpack Compose)

One codebase builds **two independently installable apps** (Gradle product flavors) that share the
same API, database, Socket.IO channel and push setup:

| Flavor    | App name           | Application ID                    | URL scheme              | Who can sign in |
|-----------|--------------------|-----------------------------------|-------------------------|-----------------|
| `student` | CampusCare Student | `in.edu.srmap.campuscare`         | `campuscare://`         | students only |
| `college` | CampusCare College | `in.edu.srmap.campuscare.college` | `campuscare-college://` | counsellors, committee members, Campus Security, moderators, campus admins (and a Super Admin acting as counsellor) |

The Student app keeps the original application ID, so existing installs update into it. A staff
member whose old app updates is signed out with a message pointing to CampusCare College.

**The API, not the APK, decides who may use which app.** Each app sends
`X-CampusCare-App: student|college`. The API refuses sign-in from the wrong app (`wrong_app`, only after
the password is correct), stores the app on the session, and ends any session that the other app
presents or whose account now belongs to the other app. The College app has no sign-up: the API
refuses `/auth/register` from it and never creates an account from a Google sign-in there. Older builds
that send no app header keep working until you raise the minimum version in Super Admin → Mobile app.
The **Super Admin** console stays on the website.

The app and the website share one backend (`apps/api`). Everything the Super Admin changes on the
website reaches installed APKs at runtime, with no rebuild:

| Website (Super Admin)                         | Reaches the app through                          |
|-----------------------------------------------|--------------------------------------------------|
| Feature switches, SOS countdown, media rules  | `GET /api/v1/mobile/config` (refreshed on launch and resume, cached for offline use) |
| Minimum / latest app version, download link   | `mobile.update` → forced "Update required" screen |
| Banner message                                | `mobile.banner` → banner at the top of the app   |
| Emergency contacts                            | cached copy used by the offline emergency screen |
| Turnstile, Google sign-in, email domain       | `settings` in the same response                  |
| Campus alerts, announcements, case updates    | realtime (Socket.IO) + optional FCM push          |

## Project layout

```
app/src/student/ CampusCare Student: ui/navigation/VariantGraph.kt (student screens), manifest (student email links)
app/src/college/ CampusCare College: ui/navigation/VariantGraph.kt (staff screens), manifest (staff email links,
                 no SOS tile or shortcut), navy launcher background, staff notification wording
app/src/main/java/edu/srmap/campuscare/   shared by both apps
  AppAudience.kt this build's app and which roles it accepts
  data/          Api.kt (all endpoints), ApiClient (OkHttp + bearer token), Models, Realtime (Socket.IO),
                 SecureStore (Android Keystore AES-GCM), SessionStore, ConfigRepository (remote config + cache)
  services/      FCM service, live-location foreground service, responder on-duty service, notifications
  ui/components/ design system: buttons, cards, inputs, chat thread, map (osmdroid), Turnstile, motion
  ui/navigation/ routes (with StudentOnly / StaffOnly groups), role-based bottom bar, deep links. AppRoot
                 registers the shared screens; each app registers its own, and the other app's routes show
                 a "part of CampusCare …" page
  ui/screens/    auth/, student/, common/ (profile, privacy, chat, cases), staff/ (counsellor, committee,
                 responder, admin, moderator)
  util/          formatting, intents (dial/SMS), location, Google sign-in, file picking
```

## Build

Requirements: Android Studio Ladybug (2024.2) or newer, JDK 17, Android SDK 35.

```bash
cd apps/android
# Both apps (production URLs come from gradle.properties):
./gradlew assembleStudentDebug assembleCollegeDebug
# Unit tests for each app:
./gradlew testStudentDebugUnitTest testCollegeDebugUnitTest
# Install both side by side on a connected phone:
./gradlew installStudentDebug installCollegeDebug
# One app against another deployment:
./gradlew assembleCollegeDebug \
  -Pcampuscare.apiUrl=https://api.your-campus.edu \
  -Pcampuscare.webUrl=https://campuscare.your-campus.edu \
  -Pcampuscare.googleWebClientId=YOUR_WEB_CLIENT_ID.apps.googleusercontent.com
```

APKs are written to `app/build/outputs/apk/<student|college>/<debug|release>/` and bundles to
`app/build/outputs/bundle/<student|college>Release/`. The same properties can go in
`~/.gradle/gradle.properties` so Android Studio picks them up.

Release builds must use an `https://` API URL (cleartext traffic is only allowed for the emulator
host in debug builds).

### Signed release

1. Create a key once: `keytool -genkeypair -v -keystore campuscare-release.jks -keyalg RSA -keysize 4096 -validity 10000 -alias campuscare`
2. Copy `keystore.properties.example` to `keystore.properties` and fill it in (never commit either file).
3. `./gradlew assembleStudentRelease assembleCollegeRelease bundleStudentRelease bundleCollegeRelease`
   Both apps are signed with the same key. Without `keystore.properties`, release builds fall back to the
   debug key, which is fine for testing but not for distribution.

### GitHub Actions

`.github/workflows/android.yml` builds a debug APK on every push and a signed release APK + AAB for
`v*` tags (or a manual run with *release* ticked). Configure the variables and secrets listed at the
top of the workflow. Artifacts are attached to the workflow run.

## Connecting the app to your deployment

1. **API URL** — set `campuscare.apiUrl` at build time (above).
2. **App Links** — so verification / reset / invite emails open the app, set on the API server:
   `ANDROID_PACKAGE_NAME=in.edu.srmap.campuscare,in.edu.srmap.campuscare.college` and
   `ANDROID_CERT_SHA256=<release certificate SHA-256>` on the **website** server, which serves
   `/.well-known/assetlinks.json` with one entry per package. Student links (`/verify-email`, `/student`)
   open the Student app, and staff links (`/committee`, `/security`, `/consultancy`, `/moderator`) open the
   College app. Both apps claim `/reset-password`, `/accept-invite` and `/support`.
3. **Cloudflare Turnstile** — the app runs the widget from a page served by the API
   (`/api/v1/mobile/turnstile`). Add the API's hostname to the widget's hostname list in Cloudflare
   and to `TURNSTILE_EXPECTED_HOSTNAMES` on the server.
4. **Google sign-in (optional)** — in Google Cloud create an *Android* OAuth client for **each**
   package name with your signing certificate's SHA-1, and pass the existing *Web* client ID as
   `campuscare.googleWebClientId`. Only `@srmap.edu.in` Google accounts are accepted, and accounts are
   never linked automatically by email.
5. **Push notifications (optional)** — register **both** package names in the Firebase project and add
   the downloaded `app/google-services.json`, which then lists both apps (or put one file in each of
   `app/src/student/` and `app/src/college/`). Then set
   `FCM_SERVICE_ACCOUNT_JSON` on the API. Without it, notifications still arrive in-app and over the
   realtime connection while the app is open; Campus Security responders should switch **On duty**
   so SOS alerts keep arriving with the app in the background.

## Security notes

- Session tokens are stored only in Android Keystore–encrypted storage and sent as a bearer token
  with `X-CampusCare-Client: android`. No cookies are used, so web CSRF rules do not apply.
- Realtime connections use single-use, 60-second tickets — never the session token.
- Account creation and sign-in accept only `@srmap.edu.in` addresses (enforced by the server).
- Location is sent only for an SOS, a Safe Walk with sharing turned on, or an explicit time-limited
  live share; a persistent notification shows while sharing.
- Calling and SMS fallbacks never need the server (outage mode).

## Verification status

This code was written and checked with static tools (syntax parsing plus import, icon and
argument-name checks) in an environment without access to Google's Maven repository, so it has
**not yet been compiled or run on a device**. Build it in Android Studio or with the GitHub Actions
workflow and fix any compiler messages before distributing an APK. `ValidationTest` contains JVM unit
tests (`./gradlew testDebugUnitTest`).
