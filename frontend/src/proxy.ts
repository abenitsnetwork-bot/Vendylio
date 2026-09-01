import { NextResponse, type NextRequest } from 'next/server';

// Next 16 Proxy (formerly `middleware.ts` — renamed, same behaviour). Lives at
// src/ because app/ is under src/; a root-level file is silently ignored.
//
// Silent-refresh gate for protected pages.
//
// The (15-min) access cookie can expire while a (7-day) refresh cookie is
// still valid — typically when a tab sat unfocused or the laptop slept. The
// (authed) layout calling /api/auth/me would 401 and the user would be kicked
// to /login. This proxy catches that case BEFORE the page renders and
// bounces the request through /api/auth/refresh-and-return, which mints fresh
// cookies and 302s back to the original URL — invisible to the user.
//
// Protected paths are configured via AUTH_PROTECTED_PREFIXES (comma-separated,
// e.g. "/dashboard,/account"). Empty by default — the API surface is the only
// thing shipped, so out-of-the-box this proxy is a no-op.
//
// Phase 4b — custom storefront domains. A request whose Host is NOT one of
// our own hosts is a merchant's connected domain (shop.brand.com): we rewrite
// the storefront paths to /s/<host>/… so the same [slug] route renders it
// (getPublicStore resolves slug-OR-customDomain). The page reads the injected
// `x-vendylio-domain` header to emit root-relative links + the right canonical.
//
// Edge runtime: no DB, no bcrypt, no Prisma. We only inspect cookies/headers
// and build redirects/rewrites.

const COOKIE_PREFIX = process.env.COOKIE_PREFIX || 'app';
const ACCESS_COOKIE = `${COOKIE_PREFIX}-token`;
const REFRESH_COOKIE = `${COOKIE_PREFIX}-refresh`;
const LOGIN_PATH = process.env.AUTH_LOGIN_PATH || '/login';

function appHost(): string {
  try {
    return new URL(process.env.APP_URL || 'http://localhost:3000').hostname.toLowerCase();
  } catch {
    return 'localhost';
  }
}

function isOwnHost(host: string): boolean {
  const bare = host.split(':')[0]!.toLowerCase();
  return (
    bare === appHost() ||
    bare === 'localhost' ||
    bare === '127.0.0.1' ||
    bare.endsWith('.vercel.app')
  );
}

// Storefront paths a custom domain is allowed to serve. Everything else on a
// custom domain passes through untouched (and will mostly 404 — a connected
// domain must never expose /dashboard or /admin).
function isStorefrontPath(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname === '/checkout' ||
    pathname.startsWith('/products/') ||
    pathname.startsWith('/orders/')
  );
}

function rewriteCustomDomain(req: NextRequest): NextResponse | null {
  const host = req.headers.get('host');
  if (!host || isOwnHost(host)) return null;

  const bare = host.split(':')[0]!.toLowerCase();
  const { pathname, search } = req.nextUrl;

  if (!isStorefrontPath(pathname)) {
    // Not a storefront path on a custom domain — leave it alone (no dashboard
    // via a merchant domain). Skip the auth guards below too.
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = `/s/${bare}${pathname === '/' ? '' : pathname}`;
  url.search = search;

  const headers = new Headers(req.headers);
  headers.set('x-vendylio-domain', bare);
  return NextResponse.rewrite(url, { request: { headers } });
}

function isAdminPath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

// /admin pre-filter — an anonymous request never even receives the admin
// HTML shell. The real authorization is the server-side role check in
// src/app/admin/layout.tsx (`notFound()` for non-admins); this just keeps
// the surface undiscoverable to visitors with no session at all. A
// logged-in admin whose short-lived access cookie has expired is bounced
// through the same silent-refresh path as any other protected page.
function guardAdmin(req: NextRequest): NextResponse | null {
  if (!isAdminPath(req.nextUrl.pathname)) return null;
  if (req.cookies.get(ACCESS_COOKIE)?.value) return NextResponse.next();

  const { pathname, search } = req.nextUrl;
  if (req.cookies.get(REFRESH_COOKIE)?.value) {
    const url = req.nextUrl.clone();
    url.pathname = '/api/auth/refresh-and-return';
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url, 303);
  }
  return new NextResponse(null, { status: 404 });
}

const AUTHED_PREFIXES = (process.env.AUTH_PROTECTED_PREFIXES || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function isAuthedPath(pathname: string): boolean {
  return AUTHED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function proxy(req: NextRequest): NextResponse {
  const domainRewrite = rewriteCustomDomain(req);
  if (domainRewrite) return domainRewrite;

  const adminGuard = guardAdmin(req);
  if (adminGuard) return adminGuard;

  if (AUTHED_PREFIXES.length === 0) return NextResponse.next();

  const { pathname, search } = req.nextUrl;
  if (!isAuthedPath(pathname)) return NextResponse.next();

  if (req.cookies.get(ACCESS_COOKIE)?.value) return NextResponse.next();

  const target = pathname + search;

  if (!req.cookies.get(REFRESH_COOKIE)?.value) {
    const url = req.nextUrl.clone();
    url.pathname = LOGIN_PATH;
    url.search = `?next=${encodeURIComponent(target)}`;
    return NextResponse.redirect(url, 303);
  }

  const url = req.nextUrl.clone();
  url.pathname = '/api/auth/refresh-and-return';
  url.search = `?next=${encodeURIComponent(target)}`;
  return NextResponse.redirect(url, 303);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/|.*\\..*).*)'],
};
