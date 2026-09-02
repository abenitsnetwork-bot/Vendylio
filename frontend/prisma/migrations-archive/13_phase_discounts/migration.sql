-- Phase D — seller-managed promo codes.
--
-- Additive:
--   Discount table — one row per code per store (unique on storeId+code).
--   Order.discountCode / Order.discountCents — the code applied at checkout
--     and what the buyer saved (0 for every existing order).
-- V1 mechanism is FREE_DELIVERY only; `kind` is free-text so PERCENT / FIXED
-- can be added later without another migration.

-- CreateTable
CREATE TABLE "Discount" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'FREE_DELIVERY',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "minSubtotalCents" INTEGER NOT NULL DEFAULT 0,
    "maxRedemptions" INTEGER,
    "redemptionCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Discount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Discount_storeId_idx" ON "Discount"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "Discount_storeId_code_key" ON "Discount"("storeId", "code");

-- AddForeignKey
ALTER TABLE "Discount" ADD CONSTRAINT "Discount_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "discountCode" TEXT;
ALTER TABLE "Order" ADD COLUMN "discountCents" INTEGER NOT NULL DEFAULT 0;
