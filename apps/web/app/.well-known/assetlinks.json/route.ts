import { NextResponse } from 'next/server';

/**
 * Digital Asset Links for Android App Links: lets the CampusCare app open verification, reset,
 * invitation and notification links from this website. Values come from server-side environment
 * variables (they are public by nature — Android fetches this file anonymously).
 *   ANDROID_PACKAGE_NAME   package name(s), comma-separated: CampusCare Student and CampusCare College,
 *                          e.g. in.edu.srmap.campuscare,in.edu.srmap.campuscare.college
 *   ANDROID_CERT_SHA256    release signing certificate fingerprint(s), comma-separated, AA:BB:…
 */
export const dynamic = 'force-dynamic';

export function GET() {
  const packages = (process.env.ANDROID_PACKAGE_NAME ?? '').split(',').map((p) => p.trim()).filter((p) => /^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(p));
  const fingerprints = (process.env.ANDROID_CERT_SHA256 ?? '').split(',').map((f) => f.trim().toUpperCase()).filter((f) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f));
  // Both apps are signed with the same release key, so every package shares the fingerprints.
  const body = fingerprints.length
    ? packages.map((pkg) => ({ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: fingerprints } }))
    : [];
  return NextResponse.json(body, { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
