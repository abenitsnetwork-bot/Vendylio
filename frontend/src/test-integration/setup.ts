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
import { vi, beforeAll } from 'vitest';
import { resolveTestDbUrl, ensureMigrated } from './db';

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
// Keep the slow/optional external checks off.
process.env.PASSWORD_HIBP_CHECK = '0';
delete process.env.HCAPTCHA_SECRET;
delete process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.RESEND_API_KEY;

// ── Third-party SDK mocks (the only mocks in this suite) ────────────────────
// `next/headers` — a stateful in-memory cookie jar shared across every route
// call in a scenario (auth cookies set by verify-email must be readable by a
// later requireAuth()). Reset between tests via resetCookieJar() from harness.
vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./harness');
  return {
    cookies: () => Promise.resolve(cookieJar()),
    headers: () => Promise.resolve(new Headers()),
  };
});

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

beforeAll(() => {
  ensureMigrated(TEST_DB_URL);
});
