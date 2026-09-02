-- Pro plan billing (Phase 1a). Additive, nullable columns on Store only.
-- `Store.plan` (FREE|PRO) stays the single source of truth read everywhere;
-- these columns drive its value. `stripeCustomerId` = the merchant as a
-- CUSTOMER of Vendylio (Pro subscription), distinct from `stripeAccountId`
-- (the merchant's own connected account for receiving sales). `planSource`
-- records why a store is PRO (SUBSCRIPTION | COMP) so the daily
-- plan-downgrade-sweep cron can retire an expired comp without touching a
-- paying store. Every existing store keeps plan='FREE' with all-null billing.

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "planCompExpiresAt" TIMESTAMP(3),
ADD COLUMN     "planSource" TEXT,
ADD COLUMN     "stripeCustomerId" TEXT,
ADD COLUMN     "stripeSubscriptionId" TEXT,
ADD COLUMN     "subscriptionCurrentPeriodEnd" TIMESTAMP(3),
ADD COLUMN     "subscriptionStatus" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Store_stripeCustomerId_key" ON "Store"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Store_stripeSubscriptionId_key" ON "Store"("stripeSubscriptionId");
