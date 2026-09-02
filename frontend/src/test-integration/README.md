# Integration harness (C1)

Route handlers exercised against a **real Postgres database** and the real
business layer. Only the third-party HTTP SDKs are mocked (Stripe, Resend,
Upstash Redis, Cloudinary). This is the class of bug the ~2100 mocked unit
tests can't see: the `P2028` deadlock (only reproduces with a real
`connection_limit=1` pool), transaction isolation, FK constraints,
`pg_advisory_xact_lock`, and the migration schema itself.

## Running

```bash
# 1. Point TEST_DATABASE_URL at a THROWAWAY database — a Neon branch of prod,
#    or a local container. NEVER the dev/prod database: the harness TRUNCATEs
#    every table between tests. Put it in frontend/.env.local:
TEST_DATABASE_URL="postgresql://…neon-branch…/neondb?sslmode=require&pgbouncer=true&connection_limit=1"

# 2. Run
pnpm --filter frontend test:integration
```

Keep `connection_limit=1` in the URL — that's what makes the P2028 regression
test (`withdrawal-race.itest.ts`) meaningful.

`setup.ts` runs `prisma migrate deploy` against the test database on the first
`beforeAll`, so a fresh/empty branch is fine.

## Guards

- `resolveTestDbUrl()` refuses a URL whose host matches `.env` / `.env.local`
  `DATABASE_URL` or `DIRECT_URL`.
- Refuses `NODE_ENV=production`.
- Not in `pnpm test` or CI — the default `vitest.config.ts` only globs
  `*.test.ts`; these files are `*.itest.ts` under a separate config.

## Scenarios

| File | Covers |
|---|---|
| `money-flow.itest.ts` | card checkout → Stripe webhook (real HMAC, Serializable tx, dedup) → PAID + stock ledger + commission; Cash App checkout → confirm-payment → `CommissionCharge` OWED; withdrawal withholds the commission (FIFO) → SETTLED; refund → restock + commission unwind |
| `withdrawal-race.itest.ts` | two concurrent `POST /api/withdrawals` → the advisory lock serializes them, exactly one row is created (the test that catches the P2028 deadlock) |
| `auth-flow.itest.ts` | `signup` writes User + VerificationCode in one tx; `verify-email` consumes the code, stamps `emailVerifiedAt`, issues the session cookies; a replayed code is rejected |

## Adding a scenario

New file `*.itest.ts` in this directory. Import route handlers directly, use
the `harness.ts` helpers (`seed*`, `authAs`, `apiRequest`, `truncate`). Mock a
third-party SDK only if the route reaches out over HTTP.
