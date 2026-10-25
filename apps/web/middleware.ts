import { NextResponse, type NextRequest } from 'next/server';

/**
 * Fast redirect to sign-in when there is no session cookie at all.
 * This is only a UX shortcut: every API call is still authorised on the server,
 * and the portal shell checks the role from /auth/me.
 */
export function middleware(req: NextRequest) {
  if (!req.cookies.get('cc_session')) {
    const url = req.nextUrl.clone();
    const next = req.nextUrl.pathname + req.nextUrl.search;
    url.pathname = '/super-admin/login';
    url.search = `?next=${encodeURIComponent(next)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/super-admin/((?!login).*)', '/account/:path*'],
};
