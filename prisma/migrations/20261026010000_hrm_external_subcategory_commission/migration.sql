-- CreateTable
CREATE TABLE "HrmCommissionSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "ingestSince" TIMESTAMP(3) NOT NULL,
    "netField" TEXT NOT NULL DEFAULT 'productNetAmount',
    "netBasis" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "discounted" BOOLEAN NOT NULL DEFAULT false,
    "updatedBy" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrmCommissionSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrmCommissionSubcategory" (
    "id" UUID NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryExternalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrmCommissionSubcategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrmCommissionMapping" (
    "id" UUID NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL DEFAULT '',
    "subcategoryId" UUID NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrmCommissionMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrmCommissionRate" (
    "id" UUID NOT NULL,
    "subcategoryId" UUID NOT NULL,
    "storeKey" INTEGER NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL,
    "rate" DECIMAL(15,4) NOT NULL,
    "basis" TEXT NOT NULL,
    "fixedBasis" TEXT NOT NULL DEFAULT 'UNIT',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrmCommissionRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrmCommissionInbox" (
    "id" UUID NOT NULL,
    "sourceLogId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrmCommissionInbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrmCommissionDocument" (
    "invoiceNumber" TEXT,
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storeId" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3),
    "lastHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrmCommissionDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrmCommissionLine" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "externalLineId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "subcategoryId" UUID NOT NULL,
    "subcategoryName" TEXT NOT NULL,
    "rateId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "rate" DECIMAL(15,4) NOT NULL,
    "basis" TEXT NOT NULL,
    "fixedBasis" TEXT NOT NULL,
    "quantity" DECIMAL(15,4) NOT NULL,
    "eligibleRevenue" DECIMAL(15,2) NOT NULL,
    "commissionAmount" DECIMAL(15,2) NOT NULL,
    "originalSaleLineId" UUID,

    CONSTRAINT "HrmCommissionLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrmCommissionEvent" (
    "id" UUID NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "sourceLogId" TEXT NOT NULL,
    "documentId" UUID NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrmCommissionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrmCommissionLedger" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "lineId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "storeId" INTEGER NOT NULL,
    "subcategoryId" UUID NOT NULL,
    "subcategoryName" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "rate" DECIMAL(15,4) NOT NULL,
    "basis" TEXT NOT NULL,
    "fixedBasis" TEXT NOT NULL,
    "quantity" DECIMAL(15,4) NOT NULL,
    "eligibleRevenue" DECIMAL(15,2) NOT NULL,
    "commissionAmount" DECIMAL(15,2) NOT NULL,
    "saleDate" TIMESTAMP(3) NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "HrmCommissionLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrmCommissionAudit" (
    "id" UUID NOT NULL,
    "userId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrmCommissionAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HrmCommissionSubcategory_externalId_key" ON "HrmCommissionSubcategory"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "HrmCommissionMapping_productId_variantId_effectiveFrom_key" ON "HrmCommissionMapping"("productId", "variantId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "HrmCommissionRate_subcategoryId_storeKey_effectiveFrom_key" ON "HrmCommissionRate"("subcategoryId", "storeKey", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "HrmCommissionInbox_sourceLogId_key" ON "HrmCommissionInbox"("sourceLogId");

-- CreateIndex
CREATE INDEX "HrmCommissionInbox_status_createdAt_idx" ON "HrmCommissionInbox"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "HrmCommissionDocument_key_key" ON "HrmCommissionDocument"("key");

-- CreateIndex
CREATE INDEX "HrmCommissionLine_originalSaleLineId_idx" ON "HrmCommissionLine"("originalSaleLineId");

-- CreateIndex
CREATE UNIQUE INDEX "HrmCommissionLine_documentId_externalLineId_key" ON "HrmCommissionLine"("documentId", "externalLineId");

-- CreateIndex
CREATE UNIQUE INDEX "HrmCommissionEvent_fingerprint_key" ON "HrmCommissionEvent"("fingerprint");

-- CreateIndex
CREATE INDEX "HrmCommissionLedger_storeId_saleDate_idx" ON "HrmCommissionLedger"("storeId", "saleDate");

-- CreateIndex
CREATE INDEX "HrmCommissionLedger_subcategoryId_postedAt_idx" ON "HrmCommissionLedger"("subcategoryId", "postedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HrmCommissionLedger_eventId_lineId_key" ON "HrmCommissionLedger"("eventId", "lineId");


-- Additional HRM-only invariants; no existing tables are altered.
ALTER TABLE "HrmCommissionRate" ADD CONSTRAINT "HrmCommissionRate_valid" CHECK (
  "type" IN ('PERCENTAGE','FIXED') AND "rate">=0 AND ("type"<>'PERCENTAGE' OR "rate"<=100)
  AND "basis" IN ('NET_EX_TAX','NET_INCL_TAX') AND "fixedBasis" IN ('UNIT','LINE') AND "storeKey">=0
);
ALTER TABLE "HrmCommissionSettings" ADD CONSTRAINT "HrmCommissionSettings_singleton" CHECK (id=1);
ALTER TABLE "HrmCommissionLine" ADD CONSTRAINT "HrmCommissionLine_nonnegative" CHECK (quantity>=0 AND "eligibleRevenue">=0 AND "commissionAmount">=0);
