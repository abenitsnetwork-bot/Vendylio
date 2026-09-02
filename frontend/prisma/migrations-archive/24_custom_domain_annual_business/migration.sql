-- Phase 4b + 5 — custom domain, annual plan interval, Business waitlist.
-- Fully additive: 3 nullable/defaulted columns on Store + one new table.

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "customDomain" TEXT,
ADD COLUMN     "customDomainStatus" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "subscriptionInterval" TEXT;

-- CreateTable
CREATE TABLE "BusinessLead" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "storeName" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessLead_email_key" ON "BusinessLead"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Store_customDomain_key" ON "Store"("customDomain");

