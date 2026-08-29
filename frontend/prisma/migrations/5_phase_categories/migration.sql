-- Phase 1 — per-store custom categories.
-- Replaces the hard-coded Product.category enum with a Category table the
-- seller manages. Data-aware: every existing store gets the 4 legacy
-- categories seeded, and its products are re-pointed by mapping the old
-- enum value to the matching new row.

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Category_storeId_sortOrder_idx" ON "Category"("storeId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Category_storeId_slug_key" ON "Category"("storeId", "slug");

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: add the nullable FK column, keep the old column for the data step below
ALTER TABLE "Product" ADD COLUMN "categoryId" TEXT;

-- Data: seed the 4 legacy categories for every existing store
INSERT INTO "Category" ("id", "storeId", "name", "slug", "sortOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, s."id", v.name, v.slug, v.ord, now(), now()
FROM "Store" s
CROSS JOIN (VALUES
  ('Food & Spices',          'food-spices',          0),
  ('Beauty & Personal Care', 'beauty-personal-care', 1),
  ('Textiles & Crafts',      'textiles-crafts',      2),
  ('Other',                  'other',                3)
) AS v(name, slug, ord);

-- Data: re-point every product at its store's matching new category row
UPDATE "Product" p
SET "categoryId" = c."id"
FROM "Category" c
WHERE c."storeId" = p."storeId"
  AND c."slug" = CASE p."category"
    WHEN 'FOOD_SPICES'          THEN 'food-spices'
    WHEN 'BEAUTY_PERSONAL_CARE' THEN 'beauty-personal-care'
    WHEN 'TEXTILES_CRAFTS'      THEN 'textiles-crafts'
    WHEN 'OTHER'                THEN 'other'
    ELSE 'other'
  END;

-- AlterTable: drop the legacy enum column now that data is migrated
ALTER TABLE "Product" DROP COLUMN "category";

-- CreateIndex
CREATE INDEX "Product_storeId_categoryId_idx" ON "Product"("storeId", "categoryId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
