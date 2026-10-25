import { NextResponse } from 'next/server';

/**
 * Digital Asset Links for Android App Links: lets the CampusCare app open verification, reset,
 * invitation and notification links from this website. Values come from server-side environment
 * variables (they are public by nature — Android fetches this file anonymously).
 *   ANDROID_PACKAGE_NAME   e.g. in.edu.srmap.campuscare
 *   ANDROID_CERT_SHA256    release signing certificate fingerprint(s), comma-separated, AA:BB:…
 */
export const dynamic = 'force-dynamic';

export function GET() {
  const pkg = process.env.ANDROID_PACKAGE_NAME?.trim();
  const fingerprints = (process.env.ANDROID_CERT_SHA256 ?? '').split(',').map((f) => f.trim().toUpperCase()).filter((f) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f));
  const body = pkg && fingerprints.length
    ? [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: fingerprints } }]
    : [];
  return NextResponse.json(body, { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
