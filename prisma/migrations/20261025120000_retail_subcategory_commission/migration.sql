-- Additive only: historical employee commissions are never reclassified or recalculated.
ALTER TABLE "POSCategory" ADD COLUMN "commissionType" TEXT, ADD COLUMN "commissionRate" DECIMAL(15,4);
ALTER TABLE "POSCategory" ADD CONSTRAINT "POSCategory_commission_valid" CHECK (
  ("commissionType" IS NULL AND "commissionRate" IS NULL) OR
  ("parentId" IS NOT NULL AND "commissionType" IS NOT NULL AND "commissionRate" IS NOT NULL AND "commissionRate">=0 AND
    (("commissionType"='PERCENTAGE' AND "commissionRate"<=100) OR "commissionType"='FIXED'))
);
CREATE TABLE "POSRetailCommission" (
  "id" UUID NOT NULL PRIMARY KEY, "saleItemId" UUID NOT NULL UNIQUE, "saleId" UUID NOT NULL,
  "storeId" INTEGER NOT NULL, "invoiceNumber" TEXT NOT NULL,
  "subcategoryId" UUID, "subcategoryName" TEXT, "commissionType" TEXT, "rate" DECIMAL(15,4),
  "basis" TEXT NOT NULL, "fixedBasis" TEXT NOT NULL, "quantity" INTEGER NOT NULL,
  "returnedQuantity" INTEGER NOT NULL DEFAULT 0, "eligibleRevenue" DECIMAL(15,2) NOT NULL,
  "amount" DECIMAL(15,2) NOT NULL, "reversedRevenue" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "reversedAmount" DECIMAL(15,2) NOT NULL DEFAULT 0, "exclusionReason" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE', "createdAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "POSRetailCommission_storeId_createdAt_idx" ON "POSRetailCommission"("storeId","createdAt");
CREATE INDEX "POSRetailCommission_saleId_idx" ON "POSRetailCommission"("saleId");
CREATE TABLE "POSRetailCommissionAdjustment" (
  "id" UUID NOT NULL PRIMARY KEY, "eventKey" TEXT NOT NULL UNIQUE,
  "saleId" UUID NOT NULL, "saleItemId" UUID NOT NULL, "storeId" INTEGER NOT NULL,
  "amount" DECIMAL(15,2) NOT NULL, "eligibleRevenue" DECIMAL(15,2) NOT NULL,
  "reason" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3), "reviewedBy" INTEGER, "reviewReason" TEXT
);
CREATE INDEX "POSRetailCommissionAdjustment_storeId_createdAt_idx" ON "POSRetailCommissionAdjustment"("storeId","createdAt");
