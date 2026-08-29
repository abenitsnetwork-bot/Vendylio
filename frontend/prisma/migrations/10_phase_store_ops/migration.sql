-- Phase 8 — store operations: business timezone, hard pause switch, and
-- (informational) opening hours.
--
-- All additive with safe defaults, so every existing store keeps working
-- unchanged: timezone defaults to US Eastern, ordersPaused to false (still
-- accepting orders), hours to [] (no schedule configured → always shown as
-- open). `hours` is JSONB: [{ "day": 0-6, "open": "HH:MM", "close": "HH:MM" }].

ALTER TABLE "Store" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'America/New_York';
ALTER TABLE "Store" ADD COLUMN "ordersPaused" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Store" ADD COLUMN "pauseMessage" TEXT;
ALTER TABLE "Store" ADD COLUMN "hours" JSONB NOT NULL DEFAULT '[]';
