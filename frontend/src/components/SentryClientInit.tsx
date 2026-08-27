'use client';

import { useEffect } from 'react';

// Next.js 16 defaults to Turbopack for `next build`, and Turbopack does NOT
// auto-load `sentry.client.config.ts` the way the older Webpack build did —
// `withSentryConfig`'s auto-injection is a Webpack-only mechanism, so under
// Turbopack the file just sits there, never imported, and the client SDK
// never initializes (confirmed live: window.__SENTRY__ exists from the
// `@sentry/nextjs` package import elsewhere, but no DSN ever gets wired up,
// so zero events ever leave the browser). This component is the documented
// workaround: manually trigger the same config file's side-effecting
// `Sentry.init(...)` call from inside a Client Component's effect, so it
// runs once the page mounts in the browser regardless of which bundler
// built it.
export function SentryClientInit() {
  useEffect(() => {
    void import('../../sentry.client.config');
  }, []);
  return null;
}
