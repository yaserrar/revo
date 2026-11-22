import { NextResponse, type NextRequest } from 'next/server';

// Optimistic gate only: the real checks run in the (app) layout and in route().
// `/` is the public landing page; every other page except these needs a session
// (sign-in, the design kit, and the legal pages).
const SESSION_COOKIES = ['authjs.session-token', '__Secure-authjs.session-token'];
const PUBLIC_PAGES = ['/sign-in', '/dev', '/privacy', '/terms'];

function hasSessionCookie(req: NextRequest): boolean {
  return req.cookies
    .getAll()
    .some((c) => SESSION_COOKIES.some((name) => c.name === name || c.name.startsWith(`${name}.`)));
}

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const isPublic =
    pathname === '/' || PUBLIC_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const signedIn = hasSessionCookie(req);

  if (!isPublic && !signedIn) {
    const url = new URL('/sign-in', req.url);
    url.searchParams.set('callbackUrl', `${pathname}${search}`);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Pages only: API routes authenticate themselves (route()); static files and the
  // analytics proxy (/ingest, rewritten to PostHog in next.config.ts) pass through.
  matcher: [
    '/((?!api|ingest|_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|robots.txt|.*\\.(?:png|jpg|svg|webp|ico|txt)$).*)',
  ],
};
