-- Phase 14 — store draft / publish lifecycle.
--
-- New stores now start as DRAFTS (published defaults to false); they go live
-- only when the merchant finishes onboarding and hits POST /api/stores/publish
-- (which re-validates readiness server-side). Every store that already exists
-- when this migration runs was live under the old "published defaults true"
-- rule, so backfill it to published=true with publishedAt = its creation time.

ALTER TABLE "Store" ALTER COLUMN "published" SET DEFAULT false;
ALTER TABLE "Store" ADD COLUMN "publishedAt" TIMESTAMP(3);

UPDATE "Store" SET "published" = true, "publishedAt" = "createdAt";
