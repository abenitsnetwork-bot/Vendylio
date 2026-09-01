-- Phase 4a — storefront analytics (daily aggregates) + team invitations.
-- Fully additive: three new tables, no existing row or column is touched.
--   StorefrontDayStat / ProductViewDayStat — per-day counters upserted by
--     POST /api/track (no purge cron needed; the tables stay tiny).
--   TeamInvite — tokened email invitations that create OrganizationMember rows.

-- CreateTable
CREATE TABLE "TeamInvite" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "token" TEXT NOT NULL,
    "invitedByUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "TeamInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorefrontDayStat" (
    "storeId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "storeViews" INTEGER NOT NULL DEFAULT 0,
    "productViews" INTEGER NOT NULL DEFAULT 0,
    "visitors" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StorefrontDayStat_pkey" PRIMARY KEY ("storeId","day")
);

-- CreateTable
CREATE TABLE "ProductViewDayStat" (
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductViewDayStat_pkey" PRIMARY KEY ("productId","day")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeamInvite_token_key" ON "TeamInvite"("token");

-- CreateIndex
CREATE INDEX "TeamInvite_organizationId_idx" ON "TeamInvite"("organizationId");

-- CreateIndex
CREATE INDEX "TeamInvite_email_idx" ON "TeamInvite"("email");

-- CreateIndex
CREATE INDEX "ProductViewDayStat_storeId_day_idx" ON "ProductViewDayStat"("storeId", "day");

-- AddForeignKey
ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorefrontDayStat" ADD CONSTRAINT "StorefrontDayStat_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductViewDayStat" ADD CONSTRAINT "ProductViewDayStat_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductViewDayStat" ADD CONSTRAINT "ProductViewDayStat_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

