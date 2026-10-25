import 'dotenv/config';
import { z } from 'zod';
import { MAIL_SERVICES } from '@campuscare/shared';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/campuscare'),

  /** Public origin of the web app, e.g. https://campuscare.example.edu (used for CORS, CSRF origin checks and email links). */
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  /** Extra allowed origins, comma separated. */
  EXTRA_ORIGINS: z.string().optional().default(''),
  /** Public base URL of this API (used for the Google OAuth redirect URI). */
  API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),
  TRUST_PROXY: z.coerce.number().default(1),

  /** 32+ byte secrets. Generate with: openssl rand -base64 48 */
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  /** Used for AES-256-GCM encryption of stored provider secrets and MFA seeds. Base64 of 32 bytes. */
  APP_ENCRYPTION_KEY: z.string().min(40, 'APP_ENCRYPTION_KEY must be base64 of 32 bytes'),
  /** Key for pseudonymous anonymous-report links. Rotate only with a migration plan. */
  ANONYMITY_KEY: z.string().min(32),
  COOKIE_SECURE: bool,
  COOKIE_DOMAIN: z.string().optional(),

  TURNSTILE_SITE_KEY: z.string().optional(),
  TURNSTILE_SECRET: z.string().optional(),
  TURNSTILE_EXPECTED_HOSTNAMES: z.string().optional().default(''),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  /** console = development only (writes to DEV_MAIL_DIR). nodemailer = send through a mail service account. */
  EMAIL_PROVIDER: z.enum(['console', 'nodemailer']).default('console'),
  EMAIL_FROM_NAME: z.string().default('CampusCare'),
  /** Optional. Defaults to MAIL_USER. Gmail only accepts the account itself or a verified "Send mail as" alias. */
  EMAIL_FROM: z.string().optional(),
  MAIL_SERVICE: z.enum(MAIL_SERVICES).default('gmail'),
  MAIL_USER: z.string().optional(),
  /** App password (Google: Account → Security → 2-Step Verification → App passwords). Spaces are ignored. */
  MAIL_APP_PASSWORD: z
    .string()
    .optional()
    .transform((v) => v?.replace(/\s+/g, '')),
  DEV_MAIL_DIR: z.string().default('.dev-mail'),

  /** Password reset links: single use, valid for this many minutes (15-30). */
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(15).max(30).default(30),
  /** Email verification links: single use, valid for this many hours (1-72). */
  EMAIL_VERIFICATION_TTL_HOURS: z.coerce.number().int().min(1).max(72).default(24),
  /**
   * Forgot-password / resend-verification always take at least this long, so response timing does not
   * reveal whether an account exists (the work for a real account is a few database writes).
   */
  AUTH_GENERIC_RESPONSE_MS: z.coerce.number().int().min(0).max(5000).default(400),

  STORAGE_DIR: z.string().default('storage/private'),

  INBOUND_EMAIL_WEBHOOK_SECRET: z.string().optional(),
  INBOUND_EMAIL_ADDRESS: z.string().optional(),

  /** Optional Firebase service-account JSON (raw or base64) for Android push notifications. */
  FCM_SERVICE_ACCOUNT_JSON: z.string().optional(),
  /** Android app links: package name and signing-certificate SHA-256 fingerprints (comma-separated). */
  ANDROID_PACKAGE_NAME: z.string().default('in.edu.srmap.campuscare'),
  ANDROID_CERT_SHA256: z.string().optional(),

  RUN_WORKER: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
});

function load() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    if (!env.COOKIE_SECURE) throw new Error('COOKIE_SECURE must be true in production');
    if (!env.TURNSTILE_SECRET || !env.TURNSTILE_SITE_KEY) throw new Error('TURNSTILE_SITE_KEY and TURNSTILE_SECRET are required in production');
    if (env.EMAIL_PROVIDER === 'nodemailer' && (!env.MAIL_USER || !env.MAIL_APP_PASSWORD)) throw new Error('MAIL_USER and MAIL_APP_PASSWORD are required when EMAIL_PROVIDER=nodemailer');
    // Verification / reset links are built from WEB_ORIGIN and must be public HTTPS URLs.
    if (!env.WEB_ORIGIN.startsWith('https://')) throw new Error('WEB_ORIGIN must be an https:// URL in production (email links are built from it)');
  }
  return env;
}

export const env = load();
export type Env = typeof env;

export const allowedOrigins = [env.WEB_ORIGIN, ...env.EXTRA_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)];

/**
 * Cloudflare's documented test keys are used only outside production when no keys are set.
 * The secret "1x0000000000000000000000000000000AA" always passes; this keeps local development
 * working without silently skipping verification code paths.
 */
export const turnstileKeys = {
  siteKey: env.TURNSTILE_SITE_KEY ?? (env.NODE_ENV === 'production' ? undefined : '1x00000000000000000000AA'),
  secret: env.TURNSTILE_SECRET ?? (env.NODE_ENV === 'production' ? undefined : '1x0000000000000000000000000000000AA'),
};
