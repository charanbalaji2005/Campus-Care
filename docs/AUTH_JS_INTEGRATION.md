# CampusCare — NextAuth/Auth.js & MongoDB Atlas Integration Architecture

This document outlines the architecture, database schema, environment variables, and authentication boundaries between the **Super Admin Web Console (Next.js with Auth.js)**, the **Application API (Node.js + Express)**, and the **Mobile Application (Native Android Kotlin)**.

---

## 1. Architecture Overview

```
                      ┌────────────────────────────────────────┐
                      │          MongoDB Atlas Cluster         │
                      │ ────────────────────────────────────── │
                      │  • users            • sessions         │
                      │  • accounts         • verificationtkn  │
                      └──────────────┬──────────────────┬──────┘
                                     │                  │
               Direct Adapter / Mongoose                │ Mongoose
                                     │                  │
                ┌────────────────────┴───┐     ┌────────┴─────────────────┐
                │   Super Admin Website  │     │   Application REST API   │
                │     Next.js 15 App     │     │     Node.js + Express    │
                │     Auth.js (NextAuth) │◄───►│ (Bearer auth & security) │
                └────────────────────────┘     └──────────────┬───────────┘
                                                              │
                                                       HTTPS Bearer
                                                              │
                                               ┌──────────────┴───────────┐
                                               │    CampusCare Android    │
                                               │   Native Kotlin Compose  │
                                               └──────────────────────────┘
```

- **Super Admin Website (`apps/web`)**: Next.js 15 App Router running Auth.js v5 (`next-auth@5.0.0-beta.32`) with `@auth/mongodb-adapter`. Browser sessions use encrypted JWT cookies, scoped strictly to the Super Admin web application.
- **Application Backend (`apps/api`)**: Node.js + Express server managing institutional business logic, MFA enforcement, duty management, and outbound email delivery.
- **Mobile Application (`apps/android`)**: Native Android app using Keystore-encrypted bearer tokens against Express REST endpoints (`/api/v1/auth/*`). NextAuth session cookies are never shared with or expected from the Android app.

---

## 2. Database Collections & Canonical User Model

All clients map to the single canonical MongoDB Atlas `users` collection:

### `users` Collection Schema
| Field | Type | Description |
|---|---|---|
| `_id` | `ObjectId` | Canonical user identifier referenced throughout reports, incidents, and chats |
| `fullName` / `name` | `String` | User's display name |
| `email` | `String` (Unique) | Normalized, lowercase institutional address (`@srmap.edu.in` or approved domain) |
| `emailVerified` | `Boolean` / `Date` | Verification timestamp/status |
| `passwordHash` | `String` | Argon2id password hash (never returned in public queries) |
| `role` | `String` | `student` \| `counsellor` \| `security_officer` \| `admin` \| `super_admin` |
| `accountStatus` | `String` | `pending_verification` \| `active` \| `suspended` \| `invited` \| `archived` |
| `mfaEnabled` | `Boolean` | Two-step verification state (TOTP) |
| `studentId` | `String?` | Unique student roll number |
| `department` | `String?` | Academic/administrative department |
| `phone` | `String?` | Mobile contact number |

### Auth.js Specific Collections
Managed seamlessly alongside existing collections:
- **`accounts`**: Stores OAuth provider bindings (e.g., Google OAuth `providerAccountId`, `access_token`, `refresh_token`).
- **`sessions`**: Database session tracking for adapter operations.
- **`verificationtokens`**: Adapter verification token tracking.

---

## 3. Super Admin Role Enforcement & Gating

Administrative privileges are enforced at the server level:
1. **SignIn Callback**: The Auth.js `signIn` callback explicitly verifies that `dbUser.role === 'super_admin'` and `dbUser.accountStatus === 'active'`. Non-admin accounts are rejected before a session can be minted.
2. **Middleware Guard**: [`apps/web/middleware.ts`](file:///c:/Users/Charan%20Balaji/Downloads/CampusCare/campuscare/apps/web/middleware.ts) protects `/super-admin/*` routes.
3. **API Least-Privilege**: The Express backend evaluates `requirePermission('super_admin:access')` independently on every operational endpoint.

---

## 4. Password Reset & Verification Link Flow

To ensure password reset links never falsely report as "expired" or "used":
- **Dual Check Endpoints**: `/api/v1/auth/reset-password/check` accepts both `GET` (for immediate CSRF-free browser validation) and `POST` (for native mobile apps).
- **URL Resilience**: Checks evaluate both raw and decoded URL tokens (`tokenHash: { $in: [sha256(raw), sha256(decoded)] }`).
- **Atomic Consumption**: Tokens are consumed only upon successful submission of `POST /reset-password`.

---

## 5. Required Environment Variables

### Super Admin Web Application (`apps/web`)
```env
AUTH_SECRET=your_32_byte_base64_secret
AUTH_URL=https://campuscare-web.onrender.com
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/campuscare?retryWrites=true&w=majority
AUTH_GOOGLE_ID=your_google_client_id.apps.googleusercontent.com
AUTH_GOOGLE_SECRET=your_google_client_secret
API_ORIGIN=https://campuscare-api-gywg.onrender.com
```

### Backend API (`apps/api`)
```env
PORT=4000
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/campuscare?retryWrites=true&w=majority
APP_ENCRYPTION_KEY=your_app_encryption_key
SESSION_SECRET=your_session_secret
MAIL_USER=neelampallicharanbalaji14@gmail.com
MAIL_APP_PASSWORD=hwipnbegmfaoxfju
EMAIL_PROVIDER=nodemailer
MAIL_SERVICE=gmail
WEB_ORIGIN=https://campuscare-web.onrender.com
API_PUBLIC_URL=https://campuscare-api-gywg.onrender.com
```
