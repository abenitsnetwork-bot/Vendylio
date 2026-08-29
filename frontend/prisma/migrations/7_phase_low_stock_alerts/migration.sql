-- Phase 4 — low-stock alerts.
-- Additive only: a nullable "already notified" timestamp on Product and
-- ProductVariant. NULL = eligible for a low/out-of-stock notification;
-- applyStockChange() resets it to NULL when stock recovers above the
-- effective threshold, so each low-stock episode alerts the seller once.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "lowStockNotifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN "lowStockNotifiedAt" TIMESTAMP(3);
