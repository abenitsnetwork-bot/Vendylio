# Content Security Policy

Status: **phase 1 — Report-Only** (added in Prompt #15, UX-01).

## What ships today

`frontend/next.config.ts` sets a `Content-Security-Policy-Report-Only` header on
every response (`cspReportOnly`). Report-Only means the browser **enforces
nothing** — it just POSTs a JSON violation report to `/api/csp-report` whenever a
resource *would* have been blocked by the enforcing version of the policy.

`/api/csp-report` (`src/app/api/csp-report/route.ts`) logs a compact line
(`violatedDirective`, `blockedUri`, `documentUri`) via `log.warn` and returns
`204`. No auth (the browser sends it unauthenticated), no DB. A per-IP limiter
(`pub:csp`, 30/min, `CSP_REPORT_RATE_LIMIT_MAX`) stops a misbehaving client from
flooding the logs.

## The policy

```
default-src 'self';
base-uri 'self';
object-src 'none';
frame-ancestors 'none';
script-src 'self' 'unsafe-inline' https://js.hcaptcha.com https://*.hcaptcha.com;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://res.cloudinary.com;
font-src 'self' data:;
connect-src 'self' https://*.hcaptcha.com https://*.sentry.io https://*.ingest.sentry.io;
frame-src https://*.hcaptcha.com;
form-action 'self';
report-uri /api/csp-report;
```

### Where each allowance comes from (the real external surface)

| Directive | Host | Why |
|---|---|---|
| `script-src` / `frame-src` | `*.hcaptcha.com`, `js.hcaptcha.com` | the login / signup / forgot-password captcha widget + its iframe |
| `img-src` | `res.cloudinary.com` | every storefront / product / hero / logo image |
| `connect-src` | `*.sentry.io`, `*.ingest.sentry.io` | the Sentry **browser** SDK ships error events from the client |
| `img-src` | `data:` / `blob:` | inline SVG data URIs + object-URL image previews in the uploader |
| fonts | — | Inter + Fraunces are **self-hosted** by `next/font` — no Google Fonts host needed |
| Stripe | — | checkout is a full-page **redirect** to `paymentUrl`, not a framed form or an XHR — nothing to allow |
| `@vercel/otel` | — | server-side only; CSP governs the browser, so irrelevant |

`'unsafe-inline'` on `script-src` is a phase-1 compromise: Next's framework
bootstrap and inline JSON payloads are inline `<script>`s. It is the one thing
phase 2 removes.

## Phase 2 — enforcing (follow-up)

1. Run Report-Only in production for 1–2 weeks. Watch `csp-report` logs for
   `blockedUri`s that are legitimate (a host we forgot) vs. noise (browser
   extensions inject `chrome-extension:` / `moz-extension:` — ignore those).
2. Add a per-request nonce in `middleware.ts`, thread it into the root layout's
   `<script nonce>` and Next's `nonce` option, and change `script-src` to
   `'self' 'nonce-<nonce>' https://*.hcaptcha.com` (drop `'unsafe-inline'`).
   A nonce forces the header out of `next.config.ts` (static) and into
   `middleware.ts` (per-request) — that is why it is not done here.
3. Rename the header `Content-Security-Policy` (enforcing) and update
   `observability/next-config-clean.test.ts`.
4. Verify the full flow: storefront, checkout, Stripe redirect + return,
   login/signup/captcha, dashboard, image upload, delivery settings.

Do not skip step 1. Do not enforce a policy you have not watched in Report-Only.
