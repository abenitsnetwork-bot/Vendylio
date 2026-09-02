// frontend/vitest.integration.config.ts — C1 integration harness.
//
// Runs `src/test-integration/**/*.itest.ts` against a REAL Postgres database
// and the real business layer. Only the third-party HTTP SDKs are mocked
// (Stripe, Resend, Upstash Redis, Cloudinary) — everything else (Prisma, the
// Serializable transactions, pg_advisory_xact_lock, FK constraints, the
// migration schema itself) runs for real. This is the class of bug the ~2100
// mocked unit tests cannot see: the P2028 deadlock (needs a real
// connection_limit=1 pool), transaction isolation, and the migrations.
//
// NOT part of `pnpm test` — the default `vitest.config.ts` only globs
// `*.test.ts`. Run explicitly with `pnpm --filter frontend test:integration`
// (gated by RUN_INTEGRATION=1 + a TEST_DATABASE_URL, see test-integration/setup.ts).
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['src/test-integration/**/*.itest.ts'],
    environment: 'node',
    // One real connection to one real database — the whole point is to exercise
    // the pool + advisory locks + Serializable isolation the way production
    // does. Parallel files racing on the same tables would be non-deterministic.
    fileParallelism: false,
    sequence: { concurrent: false },
    // vitest.setup.ts first — sets JWT_SECRET / ENCRYPTION_KEY before any
    // module imports @/lib/server/auth (which throws at import on a weak secret).
    setupFiles: ['./vitest.setup.ts', './src/test-integration/setup.ts'],
    // Using THIS config is the opt-in. `pnpm test` uses vitest.config.ts and
    // only globs *.test.ts, so these never run there or in CI.
    env: { RUN_INTEGRATION: '1' },
    // Migrations + first connection on a cold Neon branch take a beat.
    hookTimeout: 120_000,
    testTimeout: 30_000,
    passWithNoTests: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'server-only': path.resolve(__dirname, './node_modules/server-only/empty.js'),
    },
  },
});
