-- Phase 3 — inventory ledger + low-stock thresholds.
-- Additive: a nullable per-product threshold, a store-level default, and the
-- append-only StockMovement table. Seeds one opening-balance CORRECTION row
-- per existing product / variant so the ledger isn't empty on day one.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "lowStockThreshold" INTEGER;

-- AlterTable
ALTER TABLE "Store" ADD COLUMN "defaultLowStockThreshold" INTEGER NOT NULL DEFAULT 3;

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "delta" DOUBLE PRECISION NOT NULL,
    "resultingQuantity" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "orderId" TEXT,
    "actorType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockMovement_storeId_createdAt_idx" ON "StockMovement"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_productId_createdAt_idx" ON "StockMovement"("productId", "createdAt");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data: opening-balance ledger row for every existing product without variants
INSERT INTO "StockMovement" ("id", "storeId", "productId", "variantId", "delta", "resultingQuantity", "reason", "note", "actorType", "createdAt")
SELECT gen_random_uuid()::text, p."storeId", p."id", NULL, p."quantity", p."quantity", 'CORRECTION', 'Opening balance', 'SYSTEM', now()
FROM "Product" p
WHERE NOT EXISTS (SELECT 1 FROM "ProductVariant" v WHERE v."productId" = p."id");

-- Data: opening-balance ledger row for every existing variant
INSERT INTO "StockMovement" ("id", "storeId", "productId", "variantId", "delta", "resultingQuantity", "reason", "note", "actorType", "createdAt")
SELECT gen_random_uuid()::text, p."storeId", v."productId", v."id", v."quantity", v."quantity", 'CORRECTION', 'Opening balance', 'SYSTEM', now()
FROM "ProductVariant" v
JOIN "Product" p ON p."id" = v."productId";
