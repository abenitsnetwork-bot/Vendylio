-- CreateTable
CREATE TABLE "WithdrawalStatement" (
    "id" TEXT NOT NULL,
    "withdrawalId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "data" JSONB NOT NULL,
    "grossSalesCents" INTEGER NOT NULL,
    "totalDeductionsCents" INTEGER NOT NULL,
    "netPayableCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WithdrawalStatement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WithdrawalStatement_withdrawalId_key" ON "WithdrawalStatement"("withdrawalId");

-- CreateIndex
CREATE INDEX "WithdrawalStatement_storeId_createdAt_idx" ON "WithdrawalStatement"("storeId", "createdAt");

-- AddForeignKey
ALTER TABLE "WithdrawalStatement" ADD CONSTRAINT "WithdrawalStatement_withdrawalId_fkey" FOREIGN KEY ("withdrawalId") REFERENCES "Withdrawal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WithdrawalStatement" ADD CONSTRAINT "WithdrawalStatement_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

