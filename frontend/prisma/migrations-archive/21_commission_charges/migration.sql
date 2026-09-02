-- Phase 1b — universal commission on Cash App / Zelle orders.
-- CommissionCharge = a receivable the platform is OWED because manual-method
-- money went peer-to-peer to the merchant. Collected by withholding from the
-- next withdrawal (OWED -> SETTLED) or a Stripe invoice (OWED -> INVOICED).
-- Additive: no existing row is touched; every existing Withdrawal gets
-- commissionSettledCents = 0.

-- AlterTable
ALTER TABLE "Withdrawal" ADD COLUMN     "commissionSettledCents" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CommissionCharge" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'OWED',
    "kind" TEXT NOT NULL DEFAULT 'SALE',
    "settledByWithdrawalId" TEXT,
    "stripeInvoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "CommissionCharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- One Stripe invoice settles many charges, so this is a plain index (not unique).
CREATE INDEX "CommissionCharge_stripeInvoiceId_idx" ON "CommissionCharge"("stripeInvoiceId");

-- CreateIndex
CREATE INDEX "CommissionCharge_storeId_status_idx" ON "CommissionCharge"("storeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionCharge_orderId_kind_key" ON "CommissionCharge"("orderId", "kind");

-- AddForeignKey
ALTER TABLE "CommissionCharge" ADD CONSTRAINT "CommissionCharge_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionCharge" ADD CONSTRAINT "CommissionCharge_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

