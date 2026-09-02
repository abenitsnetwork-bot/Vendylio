// frontend/src/test-integration/setup.ts — C1 integration harness setup file.
//
// Runs ONCE per worker, before any *.itest.ts (and before those files import
// any app module). Responsibilities:
//   1. Gate: RUN_INTEGRATION=1 + a safe TEST_DATABASE_URL, else skip loudly.
//   2. Point the app's Prisma client at the test database (env read at
//      `new PrismaClient()` construction, which happens on first route import).
//   3. Fill in the env the business layer needs (Stripe secrets for the
//      webhook HMAC, etc.).
//   4. Register the third-party HTTP SDK mocks (Stripe, Resend, Upstash,
//      Cloudinary) — the ONLY things mocked in this suite.
//   5. `prisma migrate deploy` against the test database.
import { vi } from 'vitest';
import { resolveTestDbUrl } from './db';

const GATED = process.env.RUN_INTEGRATION === '1';

if (!GATED) {
  // Vitest has no first-class "skip this whole run" — throw a clear message.
  // The npm script sets RUN_INTEGRATION=1, so this only fires on a bare
  // `vitest --config vitest.integration.config.ts`.
  throw new Error(
    'Integration suite is gated. Run `pnpm --filter frontend test:integration` ' +
      '(sets RUN_INTEGRATION=1) with TEST_DATABASE_URL pointing at a throwaway database.',
  );
}

const TEST_DB_URL = resolveTestDbUrl();

// ── App env ────────────────────────────────────────────────────────────────
process.env.DATABASE_URL = TEST_DB_URL;
process.env.DIRECT_URL = TEST_DB_URL;
// NODE_ENV is already 'test' (vitest sets it, vitest.setup.ts pins it).
// Stripe: the webhook route verifies the raw-body HMAC with this secret; the
// stripeFixture() test helper signs with the same default. No real API calls
// are made (provider-singleton is mocked per test file).
process.env.STRIPE_SECRET_KEY ||= 'sk_test_integration_fixture_only';
process.env.STRIPE_WEBHOOK_SECRET ||= 'test-webhook-secret';
process.env.APP_URL ||= 'http://localhost:3000';
// The suite owns the withdrawal-guard config — don't inherit the developer's
// .env tuning (a $10 minimum + required PIN would break the money-flow /
// race scenarios, which test the lock + balance + commission FIFO, not the
// guards). Guards have their own unit tests.
process.env.WITHDRAWAL_MIN_AMOUNT = '1';
process.env.WITHDRAWAL_MAX_AMOUNT = '';
process.env.WITHDRAWAL_DAILY_LIMIT = '';
process.env.WITHDRAWAL_COOLDOWN_HOURS = '0';
process.env.WITHDRAWAL_REQUIRE_PIN = '0';
process.env.WITHDRAWAL_BALANCE_CHECK = '1';
// Keep the slow/optional external checks off.
process.env.PASSWORD_HIBP_CHECK = '0';
delete process.env.HCAPTCHA_SECRET;
delete process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.RESEND_API_KEY;

// `after()` from next/server needs a Next request scope that doesn't exist
// when a route handler is called directly. Run the callback inline instead
// (the post-response email send etc. is best-effort and the outbox row is the
// durable fallback anyway). Everything else in next/server is preserved.
vi.mock('next/server', async (importActual) => {
  const actual = await importActual<typeof import('next/server')>();
  return {
    ...actual,
    after: (fn: unknown) => {
      if (typeof fn === 'function') {
        try {
          void (fn as () => unknown)();
        } catch {
          /* best-effort, mirrors production semantics */
        }
      }
    },
  };
});

// ── Third-party SDK mocks (the only mocks in this suite) ────────────────────
// `next/headers` — a stateful in-memory cookie jar shared across every route
// call in a scenario (auth cookies set by verify-email must be readable by a
// later requireAuth()). Reset between tests via resetCookieJar() from harness.
vi.mock('next/headers', async () => {
  // cookie-jar.ts has NO app imports — importing harness here would deadlock
  // the factory (harness → @/lib/server/auth → next/headers → this factory).
  const { cookieJar } = await import('./cookie-jar');
  return {
    cookies: () => Promise.resolve(cookieJar()),
    headers: () => Promise.resolve(new Headers()),
  };
});

// Post-response "send it now" helpers — inert (the outbox rows they'd claim
// are still written in the request transaction, which is what the tests read).
vi.mock('@/lib/server/auth/send-verification-now', () => ({
  sendVerificationCodeNow: vi.fn().mockResolvedValue(undefined),
}));

// Resend — never send an email.
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: vi.fn().mockResolvedValue({ data: { id: 'email_test' }, error: null }) };
  },
}));

// Upstash Redis — force the app's `getRedis()` / `redis` to null (no client),
// exercising the in-memory fallbacks (rate-limit, circuit breaker, leases).
vi.mock('@upstash/redis', () => ({
  Redis: class {
    static fromEnv() {
      throw new Error('no upstash in integration tests');
    }
  },
}));

// Cloudinary — no uploads in these scenarios; stub the surface defensively.
vi.mock('cloudinary', () => ({
  v2: {
    config: vi.fn(),
    uploader: {
      upload_stream: vi.fn(),
      destroy: vi.fn().mockResolvedValue({ result: 'ok' }),
    },
  },
}));
