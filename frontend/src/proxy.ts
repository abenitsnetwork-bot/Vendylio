import { NextResponse, type NextRequest } from 'next/server';

// Next 16 Proxy (formerly `middleware.ts` — renamed, same behaviour). Lives at
// src/ because app/ is under src/; a root-level file is silently ignored.
//
// Two jobs:
//
// 1. Silent-refresh gate for protected pages.
//
//    The (15-min) access cookie can expire while a (7-day) refresh cookie is
//    still valid — typically when a tab sat unfocused or the laptop slept. The
//    (authed) layout calling /api/auth/me would 401 and the user would be
//    kicked to /login. This proxy catches that case BEFORE the page renders
//    and bounces the request through /api/auth/refresh-and-return, which mints
//    fresh cookies and 302s back to the original URL — invisible to the user.
//
//    Protected paths are configured via AUTH_PROTECTED_PREFIXES (comma-
//    separated, e.g. "/dashboard,/account"). Empty by default — the API
//    surface is the only thing shipped, so out-of-the-box this proxy is a
//    no-op for auth.
//
// 2. Custom storefront domains (Phase 4b). A request whose Host is NOT one of
//    our own hosts is a merchant's connected domain (shop.brand.com): we
//    rewrite the storefront paths to /s/<host>/… so the same [slug] route
//    renders it (getPublicStore resolves slug-OR-customDomain). The page reads
//    the injected `x-vendylio-domain` header to emit root-relative links + the
//    right canonical.
//
// 3. Content-Security-Policy — phase 2 (enforcing, nonce-based). CSP phase 1
//    shipped a static `Content-Security-Policy-Report-Only` header from
//    next.config.ts (still emitted — the two run in parallel during the
//    transition). Phase 2 promotes it to the enforcing `Content-Security-
//    Policy` header with a per-request nonce on `script-src` (drops
//    `'unsafe-inline'`). A nonce must be minted per request and threaded into
//    the render, so the header has to move here (per-request) — a static CDN
//    header cannot carry a fresh nonce. Next.js reads the nonce out of the
//    `Content-Security-Policy` REQUEST header we set below and auto-applies it
//    to every framework/bundle/inline <script> it emits. Pages that read this
//    nonce are forced to dynamic rendering (see `export const dynamic` in
//    src/app/layout.tsx) — Next cannot inject a nonce into a prerendered page.
//    See frontend/docs/security/csp.md.
//
// Edge runtime: no DB, no bcrypt, no Prisma. We only inspect cookies/headers
// and build redirects/rewrites.

const COOKIE_PREFIX = process.env.COOKIE_PREFIX || 'app';
const ACCESS_COOKIE = `${COOKIE_PREFIX}-token`;
const REFRESH_COOKIE = `${COOKIE_PREFIX}-refresh`;
const LOGIN_PATH = process.env.AUTH_LOGIN_PATH || '/login';

// ── Content-Security-Policy (enforcing, phase 2) ─────────────────────────────
// Mirrors the non-script directives of next.config.ts `cspReportOnly`. The one
// real change is `script-src`: `'unsafe-inline'` is replaced by a per-request
// `'nonce-…'` + `'strict-dynamic'` (a nonce'd bootstrap script is trusted to
// load the rest of the bundle graph; browsers that support `'strict-dynamic'`
// ignore the host allowlist, older ones fall back to it). The hCaptcha host
// entries stay for that fallback. `'unsafe-eval'` is added in dev only (React's
// dev runtime needs it; production React/Next never eval).
//
// `style-src` keeps `'unsafe-inline'` on purpose: Next/font + Tailwind inject
// inline <style> and style= attributes, style-based attacks are far lower
// severity, and nonce-ing every style attribute is not feasible. Standard
// practice.
function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === 'development';
  // Vercel injects the Live/Toolbar on preview + development deploys (never on
  // production for end users). It frames vercel.live and opens a Pusher
  // websocket. Allow it OFF production so the preview console stays free of
  // noise that would mask real CSP violations during the transition.
  const previewTooling = process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production';

  // hCaptcha's own CSP guidance lists BOTH the apex and the wildcard for
  // script/frame/connect (the widget's loader + challenge iframe + XHR hit
  // hcaptcha.com directly, not only *.hcaptcha.com).
  const hcaptcha = ['https://hcaptcha.com', 'https://*.hcaptcha.com'];

  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...hcaptcha,
    ...(previewTooling ? ['https://vercel.live'] : []),
    ...(isDev ? ["'unsafe-eval'"] : []),
  ].join(' ');

  const connectSrc = [
    "'self'",
    ...hcaptcha,
    'https://*.sentry.io',
    'https://*.ingest.sentry.io',
    ...(previewTooling ? ['https://vercel.live', 'wss://ws-us3.pusher.com'] : []),
  ].join(' ');

  const frameSrc = [...hcaptcha, ...(previewTooling ? ['https://vercel.live'] : [])].join(' ');

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https://res.cloudinary.com${
      previewTooling ? ' https://vercel.live https://vercel.com' : ''
    }`,
    `font-src 'self' data:${previewTooling ? ' https://vercel.live https://assets.vercel.com' : ''}`,
    `connect-src ${connectSrc}`,
    `frame-src ${frameSrc}`,
    "form-action 'self'",
    'report-uri /api/csp-report',
  ].join('; ');
}

function appHost(): string {
  try {
    return new URL(process.env.APP_URL || 'http://localhost:3000').hostname.toLowerCase();
  } catch {
    return 'localhost';
  }
}

function isOwnHost(host: string): boolean {
  const bare = host.split(':')[0]!.toLowerCase();
  const app = appHost();
  const apex = app.replace(/^www\./, ''); // treat apex + www as the same site
  return (
    bare === app ||
    bare === apex ||
    // Any sub-domain of our own apex is ours (www, previews, etc.), never a
    // merchant's connected domain.
    bare.endsWith(`.${apex}`) ||
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

function rewriteCustomDomain(req: NextRequest, reqHeaders: Headers): NextResponse | null {
  const host = req.headers.get('host');
  if (!host || isOwnHost(host)) return null;

  const bare = host.split(':')[0]!.toLowerCase();
  const { pathname, search } = req.nextUrl;

  if (!isStorefrontPath(pathname)) {
    // Not a storefront path on a custom domain — leave it alone (no dashboard
    // via a merchant domain). Skip the auth guards below too.
    return NextResponse.next({ request: { headers: reqHeaders } });
  }

  const url = req.nextUrl.clone();
  url.pathname = `/s/${bare}${pathname === '/' ? '' : pathname}`;
  url.search = search;

  const headers = new Headers(reqHeaders);
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
function guardAdmin(req: NextRequest, reqHeaders: Headers): NextResponse | null {
  if (!isAdminPath(req.nextUrl.pathname)) return null;
  if (req.cookies.get(ACCESS_COOKIE)?.value) {
    return NextResponse.next({ request: { headers: reqHeaders } });
  }

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
  // Mint a fresh nonce per request and stage it on the request headers so the
  // downstream RSC render can read it (`headers().get('x-nonce')`) and Next can
  // parse it out of the `Content-Security-Policy` request header to auto-nonce
  // its own <script> tags.
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const csp = buildCsp(nonce);
  const reqHeaders = new Headers(req.headers);
  reqHeaders.set('x-nonce', nonce);
  reqHeaders.set('Content-Security-Policy', csp);

  // Attach the enforcing CSP to whatever response we ultimately return. The
  // static `Content-Security-Policy-Report-Only` from next.config.ts is
  // emitted alongside it (both run during the transition).
  const finalize = (res: NextResponse): NextResponse => {
    res.headers.set('Content-Security-Policy', csp);
    return res;
  };

  const domainRewrite = rewriteCustomDomain(req, reqHeaders);
  if (domainRewrite) return finalize(domainRewrite);

  const adminGuard = guardAdmin(req, reqHeaders);
  if (adminGuard) return finalize(adminGuard);

  const pass = () => finalize(NextResponse.next({ request: { headers: reqHeaders } }));

  if (AUTHED_PREFIXES.length === 0) return pass();

  const { pathname, search } = req.nextUrl;
  if (!isAuthedPath(pathname)) return pass();

  if (req.cookies.get(ACCESS_COOKIE)?.value) return pass();

  const target = pathname + search;

  if (!req.cookies.get(REFRESH_COOKIE)?.value) {
    const url = req.nextUrl.clone();
    url.pathname = LOGIN_PATH;
    url.search = `?next=${encodeURIComponent(target)}`;
    return finalize(NextResponse.redirect(url, 303));
  }

  const url = req.nextUrl.clone();
  url.pathname = '/api/auth/refresh-and-return';
  url.search = `?next=${encodeURIComponent(target)}`;
  return finalize(NextResponse.redirect(url, 303));
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/|.*\\..*).*)'],
};
