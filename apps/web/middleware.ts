import { NextResponse, type NextRequest } from 'next/server';

/**
 * Fast redirect to sign-in when there is no Auth.js session token or CampusCare session cookie.
 * Every administrative API action is additionally authorized on the backend.
 */
export function middleware(req: NextRequest) {
  const hasAuthJs = req.cookies.get('authjs.session-token') || req.cookies.get('__Secure-authjs.session-token');
  const hasCcSession = req.cookies.get('cc_session');

  if (!hasAuthJs && !hasCcSession) {
    const url = req.nextUrl.clone();
    const next = req.nextUrl.pathname + req.nextUrl.search;
    url.pathname = '/super-admin/login';
    url.search = `?reason=expired&next=${encodeURIComponent(next)}`;
    const res = NextResponse.redirect(url);
    res.headers.set('Cache-Control', 'no-store, max-age=0');
    return res;
  }
  const res = NextResponse.next();
  res.headers.set('Cache-Control', 'no-store, max-age=0');
  return res;
}

export const config = {
  matcher: ['/super-admin/((?!login).*)', '/account/:path*'],
};
