import crypto from 'node:crypto';
import { OAuth2Client, CodeChallengeMethod } from 'google-auth-library';
import { env } from '../config/env';
import { decryptSecret, randomToken } from '../lib/crypto';
import { IdentityProviderConfig } from '../models/platform';

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  allowedDomains: string[];
}

export async function getGoogleConfig(): Promise<GoogleConfig | null> {
  const cfg = await IdentityProviderConfig.findOne({ provider: 'google' }).select('+clientSecretEnc').lean();
  if (!cfg?.enabled) return null;
  const clientId = cfg.clientId || env.GOOGLE_CLIENT_ID;
  const clientSecret = cfg.clientSecretEnc ? decryptSecret(cfg.clientSecretEnc) : env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, allowedDomains: cfg.allowedDomains ?? [] };
}

export const GOOGLE_REDIRECT_PATH = '/api/v1/auth/google/callback';

/** The redirect URI must exactly match the one registered in Google Cloud Console. */
export function googleRedirectUri() {
  // When the web app proxies /api/v1 to the API, register the WEB origin callback.
  return new URL(GOOGLE_REDIRECT_PATH, env.WEB_ORIGIN).toString();
}

function client(cfg: GoogleConfig) {
  return new OAuth2Client({ clientId: cfg.clientId, clientSecret: cfg.clientSecret, redirectUri: googleRedirectUri() });
}

export interface OAuthStatePayload {
  state: string;
  codeVerifier: string;
  nonce: string;
  mode: 'login' | 'link';
  exp: number;
}

export async function buildGoogleAuthUrl(cfg: GoogleConfig, mode: 'login' | 'link') {
  const c = client(cfg);
  const { codeVerifier, codeChallenge } = await c.generateCodeVerifierAsync();
  const state = randomToken(24);
  const nonce = randomToken(16);
  const url = c.generateAuthUrl({
    access_type: 'online',
    scope: ['openid', 'email', 'profile'],
    state,
    nonce,
    prompt: 'select_account',
    code_challenge: codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
    ...(cfg.allowedDomains.length === 1 ? { hd: cfg.allowedDomains[0] } : {}),
  });
  const payload: OAuthStatePayload = { state, codeVerifier: codeVerifier!, nonce, mode, exp: Date.now() + 10 * 60_000 };
  return { url, payload };
}

/** Signed, short-lived cookie carrying state/PKCE verifier (HMAC with SESSION_SECRET). */
export function sealState(payload: OAuthStatePayload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', env.SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function unsealState(value: string | undefined): OAuthStatePayload | null {
  if (!value) return null;
  const [body, sig] = value.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', env.SESSION_SECRET).update(body).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as OAuthStatePayload;
    return p.exp > Date.now() ? p : null;
  } catch {
    return null;
  }
}

export interface GoogleIdentity {
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string;
  hostedDomain: string | null;
}

/** Exchanges the code (with PKCE) and verifies the ID token's signature, issuer, audience, expiry and nonce. */
export async function exchangeGoogleCode(cfg: GoogleConfig, code: string, state: OAuthStatePayload): Promise<GoogleIdentity> {
  const c = client(cfg);
  const { tokens } = await c.getToken({ code, codeVerifier: state.codeVerifier, redirect_uri: googleRedirectUri() });
  if (!tokens.id_token) throw new Error('No ID token returned');
  const ticket = await c.verifyIdToken({ idToken: tokens.id_token, audience: cfg.clientId });
  const p = ticket.getPayload();
  if (!p) throw new Error('Invalid ID token');
  if (p.iss !== 'https://accounts.google.com' && p.iss !== 'accounts.google.com') throw new Error('Unexpected issuer');
  if (p.nonce !== state.nonce) throw new Error('Nonce mismatch');
  if (!p.sub || !p.email) throw new Error('Missing identity claims');
  return {
    subject: p.sub,
    email: p.email.toLowerCase(),
    emailVerified: p.email_verified === true,
    name: p.name ?? p.email.split('@')[0],
    hostedDomain: p.hd ?? null,
  };
}

/**
 * Verifies an ID token obtained natively on Android (Credential Manager / Sign in with Google).
 * The app requests it with the WEB client ID as `serverClientId`, so the audience is the same
 * client ID the server already trusts. Signature, issuer, audience and expiry are checked by
 * google-auth-library; the nonce (if the app sent one) must match.
 */
export async function verifyGoogleIdToken(cfg: GoogleConfig, idToken: string, expectedNonce?: string): Promise<GoogleIdentity> {
  const c = new OAuth2Client({ clientId: cfg.clientId });
  const ticket = await c.verifyIdToken({ idToken, audience: cfg.clientId });
  const p = ticket.getPayload();
  if (!p) throw new Error('Invalid ID token');
  if (p.iss !== 'https://accounts.google.com' && p.iss !== 'accounts.google.com') throw new Error('Unexpected issuer');
  if (expectedNonce && p.nonce !== expectedNonce) throw new Error('Nonce mismatch');
  if (!p.sub || !p.email) throw new Error('Missing identity claims');
  return {
    subject: p.sub,
    email: p.email.toLowerCase(),
    emailVerified: p.email_verified === true,
    name: p.name ?? p.email.split('@')[0],
    hostedDomain: p.hd ?? null,
  };
}
