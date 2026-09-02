# Content Security Policy

Status: **phase 2 — enforcing (nonce-based)**, with the phase-1 Report-Only
header still emitted in parallel during the transition.

## What ships today

Two CSP headers are sent on every HTML response:

| Header | Set by | Policy |
|---|---|---|
| `Content-Security-Policy` (**enforcing**) | `src/proxy.ts`, per request | nonce-based `script-src`, no `'unsafe-inline'` for scripts |
| `Content-Security-Policy-Report-Only` | `next.config.ts`, static CDN header | the permissive phase-1 policy (`'unsafe-inline'` on `script-src`) |

The Report-Only header stays until the enforcing policy has been observed clean
in production for ~1 week (watch `/api/csp-report`), then it is removed in a
follow-up commit and this doc drops to "phase 2, single header".

`/api/csp-report` (`src/app/api/csp-report/route.ts`) logs a compact line
(`violatedDirective`, `blockedUri`, `documentUri`) via `log.warn` and returns
`204`. Both policies point their `report-uri` at it. No auth, no DB. A per-IP
limiter (`pub:csp`, 30/min, `CSP_REPORT_RATE_LIMIT_MAX`) stops a misbehaving
client from flooding the logs.

## The enforcing policy

Built by `buildCsp(nonce)` in `src/proxy.ts`:

```
default-src 'self';
base-uri 'self';
object-src 'none';
frame-ancestors 'none';
script-src 'self' 'nonce-<per-request>' 'strict-dynamic' https://js.hcaptcha.com https://*.hcaptcha.com;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://res.cloudinary.com;
font-src 'self' data:;
connect-src 'self' https://*.hcaptcha.com https://*.sentry.io https://*.ingest.sentry.io;
frame-src https://*.hcaptcha.com;
form-action 'self';
report-uri /api/csp-report;
```

In development, `'unsafe-eval'` is appended to `script-src` (React's dev runtime
needs it; production React/Next never `eval`).

### How the nonce flows

1. `proxy.ts` mints `crypto.randomUUID()` (hyphens stripped) per request.
2. It sets the nonce on **two** places:
   - the **request** headers — `x-nonce` (readable from a Server Component via
     `headers().get('x-nonce')`) **and** inside the `Content-Security-Policy`
     request header (`'nonce-…'`), which is what Next.js parses.
   - the **response** `Content-Security-Policy` header the browser enforces.
3. During SSR, Next.js extracts the nonce from the request-header CSP and
   auto-attaches it to every framework script, page bundle, and Next-generated
   inline `<script>`. No per-tag wiring needed.

### Why the whole app is dynamically rendered

A nonce can only be injected into a page rendered **per request** — a
prerendered page is generated at build time with no request in scope.
`src/app/layout.tsx` therefore sets `export const dynamic = 'force-dynamic'`,
which opts every route out of static prerendering. The build's static-page count
drops accordingly. This is an accepted cost: the pages that lose prerendering
(`/login`, `/pricing`, `/how-it-works`, `/verify-email`, the `/dashboard/*` and
`/onboarding/*` shells) are auth-gated or low-traffic and do little work in
their server component; the high-traffic storefront routes (`/s/[slug]*`) were
already dynamic (they read request headers for custom-domain + owner-preview
resolution), so there is no regression there.

### Where each allowance comes from (the real external surface)

| Directive | Host | Why |
|---|---|---|
| `script-src` / `frame-src` | `*.hcaptcha.com`, `js.hcaptcha.com` | the login / signup / forgot-password captcha widget + its iframe. Under `'strict-dynamic'` a conformant browser ignores these host entries (hCaptcha's `<script>` is created by an already-trusted script, so it is allowed transitively); they remain for browsers without `'strict-dynamic'` support. |
| `img-src` | `res.cloudinary.com` | every storefront / product / hero / logo image |
| `connect-src` | `*.sentry.io`, `*.ingest.sentry.io` | the Sentry **browser** SDK ships error events from the client |
| `img-src` | `data:` / `blob:` | inline SVG data URIs + object-URL image previews in the uploader |
| fonts | — | Inter + Fraunces are **self-hosted** by `next/font` — no font host needed |
| Stripe | — | checkout is a full-page **redirect** to `paymentUrl`, not a framed form or an XHR — nothing to allow |
| `@vercel/otel` | — | server-side only; CSP governs the browser, so irrelevant |

`style-src` keeps `'unsafe-inline'` deliberately: `next/font` + Tailwind inject
inline `<style>` blocks and `style=` attributes, style-based attacks are far
lower severity, and nonce-ing every style attribute is not feasible. This is
standard practice.

`JsonLd.tsx` renders `<script type="application/ld+json">` — not executable,
not governed by `script-src`.

## Rollout & rollback

- The enforcing header is **purely additive** — rollback is a single revert of
  the `proxy.ts` + `layout.tsx` change; the phase-1 Report-Only header keeps
  working untouched.
- **Validate on a Vercel preview deploy first** (push the branch → preview URL):
  - `curl -I <preview>` shows both CSP headers.
  - Storefront, `/s/[slug]/checkout` → Stripe redirect + return, `/login` +
    `/register` (hCaptcha renders + solves), `/dashboard`, image upload,
    `/dashboard/delivery` — all load with **no CSP errors in the console**.
  - `/api/csp-report` receives no legitimate violations over ~48 h.
- Only then merge to `main`. After ~1 week clean in production, remove the
  Report-Only header from `next.config.ts`.

## Follow-up

- Drop the `Content-Security-Policy-Report-Only` header from `next.config.ts`
  once the enforcing policy is confirmed clean in production.
- Consider `require-trusted-types-for 'script'` as a phase 3.
