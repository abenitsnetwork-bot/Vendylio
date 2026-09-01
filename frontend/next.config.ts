import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

// Static security headers applied to every response.
// Set via next.config.ts (not proxy.ts) so Vercel's edge can serve them
// from the CDN cache without invoking a function — zero per-request latency.
//
// UX-01 (Prompt #15) — CSP rollout, phase 1: REPORT-ONLY. This header never
// blocks anything; the browser just POSTs violations to /api/csp-report so we
// can see what a real enforced policy would break before turning it on. The
// allowlist below is derived from the actual external surface: hCaptcha
// (script + iframe), Cloudinary (storefront images), Sentry (browser SDK
// ingest). Google Fonts are self-hosted by next/font — no font host needed.
//
// Phase 2 (follow-up, after observing reports): switch `script-src` to a
// per-request nonce (needs proxy.ts), drop `'unsafe-inline'` there, and
// promote this to the enforcing `Content-Security-Policy` header.
const cspReportOnly = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  // 'unsafe-inline' stays for phase 1 (Next's framework bootstrap + inline
  // JSON). Phase 2 replaces it with a nonce.
  "script-src 'self' 'unsafe-inline' https://js.hcaptcha.com https://*.hcaptcha.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://res.cloudinary.com",
  "font-src 'self' data:",
  "connect-src 'self' https://*.hcaptcha.com https://*.sentry.io https://*.ingest.sentry.io",
  'frame-src https://*.hcaptcha.com',
  "form-action 'self'",
  'report-uri /api/csp-report',
].join('; ');

const securityHeaders = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  { key: 'Content-Security-Policy-Report-Only', value: cspReportOnly },
];

const config: NextConfig = {
  reactStrictMode: true,
  // Standalone output bundles a self-contained server.js + minimal node_modules
  // into .next/standalone — required by the Docker runtime image (frontend/Dockerfile).
  // Has no impact on `next dev` / `next start` workflows.
  output: 'standalone',
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

// Sentry build-time wrapper. Uploads source maps when SENTRY_AUTH_TOKEN +
// SENTRY_ORG + SENTRY_PROJECT are present (typically only in CI). Without
// those env vars the wrapper still works — it just skips the upload step.
// silent:true keeps the build log clean when nothing is configured.
export default withSentryConfig(config, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  // Tunnel client requests through a Next.js route to bypass ad-blockers
  // that filter direct Sentry calls. Off by default — turn on if your
  // user base has heavy ad-blocker usage.
  // tunnelRoute: '/monitoring',
  hideSourceMaps: true,
  disableLogger: true,
});
