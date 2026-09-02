# Migration baseline runbook — 2026-09-02

## Why

The 26 migrations in this folder (`0_init` … `26_withdrawal_statement`) **cannot
recreate the database from empty**:

- `Store`, `Product`, `Customer`, `Review`, `Delivery`, `ProductVariant` are in
  the Prisma schema and in every live DB, but **no migration contains
  `CREATE TABLE` for them** — they were created by an early `prisma db push`
  before the migration discipline existed, and migrations `5+` were authored
  assuming those tables exist.
- The folder names are not zero-padded, so `prisma migrate dev`'s shadow-DB
  replay sorts `10_phase_store_ops` (ALTER "Store") **before** `2_organizations`
  → `P3006 / P1014 "table Store does not exist"`.

Every new migration since then needed the manual
`migrate diff --from-url → db execute → migrate resolve` workaround.

## What was done

1. Verified **no drift** between the live DB and `schema.prisma`:
   ```
   prisma migrate diff --from-url "$DIRECT_URL" --to-schema-datamodel prisma/schema.prisma --script
   # → "-- This is an empty migration."
   ```
2. Generated `prisma/migrations/00000000000000_baseline/migration.sql` as
   `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma`
   (+ a `CREATE EXTENSION IF NOT EXISTS pgcrypto` header and a doc comment).
   36 tables, 77 indexes, 36 foreign keys.
3. Moved the 26 old folders here to `prisma/migrations-archive/`.

## What YOU must run (touches the databases — do it on a Neon branch first)

> dev and prod share the same Neon project `ep-wandering-block-a6z7v46o`.
> Take a Neon snapshot / create a branch **before** step 2.

### 1. Test on a throwaway Neon branch

```bash
# Create a branch of prod in the Neon console, copy its DIRECT (non-pooled) URL.
export TEST_URL="postgres://…branch…/neondb?sslmode=require"

cd frontend

# a) reset the branch's migration ledger to just the baseline
pnpm exec prisma db execute --url "$TEST_URL" --stdin <<'SQL'
DELETE FROM "_prisma_migrations";
SQL
pnpm exec prisma migrate resolve --url "$TEST_URL" --applied 00000000000000_baseline

# b) prove the ledger is clean
pnpm exec prisma migrate status   # (uses DATABASE_URL — point it at $TEST_URL for this check)

# c) prove the baseline actually recreates the schema on a *fresh* DB
#    (create a SECOND empty Neon branch, then:)
export FRESH_URL="postgres://…empty-branch…/neondb?sslmode=require"
DATABASE_URL="$FRESH_URL" DIRECT_URL="$FRESH_URL" pnpm exec prisma migrate deploy
DIRECT_URL="$FRESH_URL" pnpm exec prisma migrate diff \
  --from-url "$FRESH_URL" --to-schema-datamodel prisma/schema.prisma --script
#   → must print "-- This is an empty migration."
```

### 2. Apply to the real DB (dev + prod are the same DB)

```bash
# DIRECT_URL is the non-pooled prod URL from .env.local
DIRECT_URL=$(grep -E '^DIRECT_URL=' .env.local | sed -E 's/^DIRECT_URL=//; s/^"//; s/"$//')

pnpm exec prisma db execute --url "$DIRECT_URL" --stdin <<'SQL'
DELETE FROM "_prisma_migrations";
SQL
pnpm exec prisma migrate resolve --url "$DIRECT_URL" --applied 00000000000000_baseline
```

### 3. Confirm

```bash
pnpm exec prisma migrate status     # "Database schema is up to date!"
pnpm --filter frontend test         # 2085 green
pnpm build                          # exit 0
```

## After this

- `prisma migrate dev` works again from a clean baseline.
- `prisma migrate reset` recreates the whole schema.
- New migrations are timestamp-named (`20260902…_add_x`) and sort after the
  baseline — no more unpadded-name replay bug, no more manual workaround.
- These archived folders are kept for history only. They are **not** in
  `prisma/migrations/` and Prisma ignores them.
