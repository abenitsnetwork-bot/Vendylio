-- Phase 7 — secure guest tracking token on Order.
--
-- The guest tracking page + transactional email links are bearer-credential
-- URLs: whoever holds the link can see the order. Until now that credential
-- was the raw cuid `id`. This adds a dedicated high-entropy token instead:
-- non-enumerable, decoupled from the PK, and rotatable if a link leaks.
--
-- Backfill: existing rows get 24 random bytes rendered url-safe-base64
-- (32 chars, matching the app-side randomBytes(24).toString('base64url')).
-- gen_random_bytes() comes from pgcrypto (available on Neon). New rows always
-- get their token from application code — the column has no DB default.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- AlterTable — nullable first so the backfill can run
ALTER TABLE "Order" ADD COLUMN "trackingToken" TEXT;

UPDATE "Order"
SET "trackingToken" = replace(replace(
      encode(gen_random_bytes(24), 'base64'),
    '+', '-'), '/', '_')
WHERE "trackingToken" IS NULL;

ALTER TABLE "Order" ALTER COLUMN "trackingToken" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Order_trackingToken_key" ON "Order"("trackingToken");
