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

// PostHog region: the ingestion and assets hosts behind /ingest (see src/instrumentation-client.ts).
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';
const POSTHOG_ASSETS = POSTHOG_HOST.replace('.i.posthog.com', '-assets.i.posthog.com');

/**
 * Analytics through Revo's own domain, so ad blockers don't drop them: /ingest/…
 * is forwarded to PostHog. PostHog places a visitor from the IP in
 * X-Forwarded-For, and behind Cloudflare that header holds Cloudflare's edge
 * (Madrid for a visitor in Morocco), so every visit looked American or
 * European. Cloudflare gives the visitor's own IP in CF-Connecting-IP: send
 * that instead.
 */
function analytics(req: NextRequest) {
  const path = req.nextUrl.pathname.slice('/ingest'.length) || '/';
  const host = path.startsWith('/static/') || path.startsWith('/array/') ? POSTHOG_ASSETS : POSTHOG_HOST;
  const target = new URL(`${host}${path}${req.nextUrl.search}`);

  const headers = new Headers(req.headers);
  const visitor =
    req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (visitor) headers.set('x-forwarded-for', visitor);
  // Revo's cookies (the session among them) have nothing to do with PostHog.
  headers.delete('cookie');
  return NextResponse.rewrite(target, { request: { headers } });
}

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (pathname === '/ingest' || pathname.startsWith('/ingest/')) return analytics(req);
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
  // Pages only: API routes authenticate themselves (route()) and static files pass
  // through. Plus the analytics proxy, files included.
  matcher: [
    '/((?!api|ingest|_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|robots.txt|.*\\.(?:png|jpg|svg|webp|ico|txt)$).*)',
    '/ingest/:path*',
  ],
};
