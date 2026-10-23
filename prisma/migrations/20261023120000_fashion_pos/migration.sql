-- CreateTable
CREATE TABLE "POSCategory" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" UUID,

    CONSTRAINT "POSCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "POSProduct" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "code" TEXT NOT NULL,
    "brand" TEXT NOT NULL DEFAULT '',
    "categoryId" UUID,
    "season" TEXT NOT NULL DEFAULT '',
    "material" TEXT NOT NULL DEFAULT '',
    "gender" TEXT NOT NULL DEFAULT '',
    "images" TEXT[],
    "sizeChart" JSONB,
    "discountEligible" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "POSProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "POSProductVariant" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "attributes" JSONB,
    "costPrice" DECIMAL(15,2) NOT NULL,
    "sellingPrice" DECIMAL(15,2) NOT NULL,
    "taxRate" DECIMAL(7,4) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "POSProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "POSInventoryBalance" (
    "id" UUID NOT NULL,
    "storeId" INTEGER NOT NULL,
    "variantId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "damaged" INTEGER NOT NULL DEFAULT 0,
    "lowStockThreshold" INTEGER NOT NULL DEFAULT 5,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "POSInventoryBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "POSStockMovement" (
    "id" UUID NOT NULL,
    "storeId" INTEGER NOT NULL,
    "variantId" UUID NOT NULL,
    "quantityDelta" INTEGER NOT NULL,
    "damagedDelta" INTEGER NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "POSStockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "POSRegister" (
    "id" UUID NOT NULL,
    "storeId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "POSRegister_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "POSSession" (
    "id" UUID NOT NULL,
    "registerId" UUID NOT NULL,
    "userId" INTEGER NOT NULL,
    "employeeId" INTEGER,
    "openingCash" DECIMAL(15,2) NOT NULL,
    "expectedCash" DECIMAL(15,2),
    "actualCash" DECIMAL(15,2),
    "variance" DECIMAL(15,2),
    "closeReason" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "POSSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "POSSale" (
    "id" UUID NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "storeId" INTEGER NOT NULL,
    "sessionId" UUID NOT NULL,
    "cashierId" INTEGER NOT NULL,
    "salespersonId" INTEGER,
    "customerName" TEXT,
    "customerPhone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "subtotal" DECIMAL(15,2) NOT NULL,
    "discountTotal" DECIMAL(15,2) NOT NULL,
    "taxTotal" DECIMAL(15,2) NOT NULL,
    "grandTotal" DECIMAL(15,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "POSSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "POSSaleItem" (
    "discountTotal" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "catalogUnitPrice" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "overrideReason" TEXT,
    "id" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "category" TEXT,
    "quantity" INTEGER NOT NULL,
    "returnedQuantity" INTEGER NOT NULL DEFAULT 0,
    "unitPrice" DECIMAL(15,2) NOT NULL,
    "costPrice" DECIMAL(15,2) NOT NULL,
    "discountPerUnit" DECIMAL(15,2) NOT NULL,
    "taxRate" DECIMAL(7,4) NOT NULL,
    "taxTotal" DECIMAL(15,2) NOT NULL,
    "lineTotal" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "POSSaleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "POSSalePayment" (
    "id" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "POSSalePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "POSReturn" (
    "id" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "userId" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "refundMethod" TEXT NOT NULL,
    "refundReference" TEXT,
    "refundAmount" DECIMAL(15,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "POSReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "POSReturnItem" (
    "revenueRefund" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "id" UUID NOT NULL,
    "returnId" UUID NOT NULL,
    "saleItemId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "resellable" BOOLEAN NOT NULL,
    "refundAmount" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "POSReturnItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "POSStockTransfer" (
    "id" UUID NOT NULL,
    "fromStoreId" INTEGER NOT NULL,
    "toStoreId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatchedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),

    CONSTRAINT "POSStockTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "POSStockTransferItem" (
    "id" UUID NOT NULL,
    "transferId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "POSStockTransferItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "POSAuditLog" (
    "id" UUID NOT NULL,
    "userId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "POSAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "POSCashMovement" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "userId" INTEGER NOT NULL,
    "direction" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "POSCashMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "POSCategory_name_key" ON "POSCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "POSProduct_code_key" ON "POSProduct"("code");

-- CreateIndex
CREATE INDEX "POSProduct_name_idx" ON "POSProduct"("name");

-- CreateIndex
CREATE INDEX "POSProduct_categoryId_active_idx" ON "POSProduct"("categoryId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "POSProductVariant_sku_key" ON "POSProductVariant"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "POSProductVariant_barcode_key" ON "POSProductVariant"("barcode");

-- CreateIndex
CREATE INDEX "POSProductVariant_productId_active_idx" ON "POSProductVariant"("productId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "POSInventoryBalance_storeId_variantId_key" ON "POSInventoryBalance"("storeId", "variantId");

-- CreateIndex
CREATE INDEX "POSStockMovement_storeId_createdAt_idx" ON "POSStockMovement"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "POSStockMovement_variantId_createdAt_idx" ON "POSStockMovement"("variantId", "createdAt");

-- CreateIndex
CREATE INDEX "POSStockMovement_reference_idx" ON "POSStockMovement"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "POSRegister_storeId_name_key" ON "POSRegister"("storeId", "name");

-- CreateIndex
CREATE INDEX "POSSession_registerId_closedAt_idx" ON "POSSession"("registerId", "closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "POSSale_invoiceNo_key" ON "POSSale"("invoiceNo");

-- CreateIndex
CREATE UNIQUE INDEX "POSSale_idempotencyKey_key" ON "POSSale"("idempotencyKey");

-- CreateIndex
CREATE INDEX "POSSale_storeId_createdAt_idx" ON "POSSale"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "POSSale_cashierId_createdAt_idx" ON "POSSale"("cashierId", "createdAt");

-- CreateIndex
CREATE INDEX "POSSale_salespersonId_createdAt_idx" ON "POSSale"("salespersonId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "POSSaleItem_saleId_variantId_key" ON "POSSaleItem"("saleId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "POSReturn_idempotencyKey_key" ON "POSReturn"("idempotencyKey");

-- CreateIndex
CREATE INDEX "POSReturn_saleId_createdAt_idx" ON "POSReturn"("saleId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "POSReturnItem_returnId_saleItemId_key" ON "POSReturnItem"("returnId", "saleItemId");

-- CreateIndex
CREATE INDEX "POSStockTransfer_fromStoreId_toStoreId_status_idx" ON "POSStockTransfer"("fromStoreId", "toStoreId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "POSStockTransferItem_transferId_variantId_key" ON "POSStockTransferItem"("transferId", "variantId");

-- CreateIndex
CREATE INDEX "POSAuditLog_entityId_createdAt_idx" ON "POSAuditLog"("entityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "POSCashMovement_idempotencyKey_key" ON "POSCashMovement"("idempotencyKey");

-- CreateIndex
CREATE INDEX "POSCashMovement_sessionId_createdAt_idx" ON "POSCashMovement"("sessionId", "createdAt");

-- AddForeignKey
ALTER TABLE "POSCategory" ADD CONSTRAINT "POSCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "POSCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSProduct" ADD CONSTRAINT "POSProduct_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "POSCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSProductVariant" ADD CONSTRAINT "POSProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "POSProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSInventoryBalance" ADD CONSTRAINT "POSInventoryBalance_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSInventoryBalance" ADD CONSTRAINT "POSInventoryBalance_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "POSProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSStockMovement" ADD CONSTRAINT "POSStockMovement_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSStockMovement" ADD CONSTRAINT "POSStockMovement_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "POSProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSStockMovement" ADD CONSTRAINT "POSStockMovement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSRegister" ADD CONSTRAINT "POSRegister_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSSession" ADD CONSTRAINT "POSSession_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "POSRegister"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSSession" ADD CONSTRAINT "POSSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSSession" ADD CONSTRAINT "POSSession_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSSale" ADD CONSTRAINT "POSSale_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSSale" ADD CONSTRAINT "POSSale_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "POSSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSSale" ADD CONSTRAINT "POSSale_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSSale" ADD CONSTRAINT "POSSale_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSSaleItem" ADD CONSTRAINT "POSSaleItem_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "POSSale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSSaleItem" ADD CONSTRAINT "POSSaleItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "POSProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSSalePayment" ADD CONSTRAINT "POSSalePayment_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "POSSale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSReturn" ADD CONSTRAINT "POSReturn_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "POSSale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSReturn" ADD CONSTRAINT "POSReturn_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "POSSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSReturn" ADD CONSTRAINT "POSReturn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSReturnItem" ADD CONSTRAINT "POSReturnItem_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "POSReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSReturnItem" ADD CONSTRAINT "POSReturnItem_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "POSSaleItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSStockTransfer" ADD CONSTRAINT "POSStockTransfer_fromStoreId_fkey" FOREIGN KEY ("fromStoreId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSStockTransfer" ADD CONSTRAINT "POSStockTransfer_toStoreId_fkey" FOREIGN KEY ("toStoreId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSStockTransferItem" ADD CONSTRAINT "POSStockTransferItem_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "POSStockTransfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSStockTransferItem" ADD CONSTRAINT "POSStockTransferItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "POSProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSAuditLog" ADD CONSTRAINT "POSAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSCashMovement" ADD CONSTRAINT "POSCashMovement_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "POSSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSCashMovement" ADD CONSTRAINT "POSCashMovement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Concurrency and financial invariants not expressible in Prisma schema.
CREATE SEQUENCE "POSInvoiceSequence";
CREATE UNIQUE INDEX "POSSession_one_open_register" ON "POSSession" ("registerId") WHERE "closedAt" IS NULL;
ALTER TABLE "POSInventoryBalance" ADD CONSTRAINT "POSInventoryBalance_nonnegative" CHECK ("quantity" >= 0 AND "damaged" >= 0 AND "lowStockThreshold" >= 0);
ALTER TABLE "POSProductVariant" ADD CONSTRAINT "POSVariant_prices" CHECK ("costPrice" >= 0 AND "sellingPrice" >= 0 AND "taxRate" BETWEEN 0 AND 100);
ALTER TABLE "POSSaleItem" ADD CONSTRAINT "POSSaleItem_quantities" CHECK ("quantity" > 0 AND "returnedQuantity" BETWEEN 0 AND "quantity");
ALTER TABLE "POSSalePayment" ADD CONSTRAINT "POSPayment_positive" CHECK ("amount" > 0);
ALTER TABLE "POSReturnItem" ADD CONSTRAINT "POSReturnItem_positive" CHECK ("quantity" > 0 AND "refundAmount" >= 0);
ALTER TABLE "POSStockTransferItem" ADD CONSTRAINT "POSTransferItem_positive" CHECK ("quantity" > 0);
ALTER TABLE "POSStockTransfer" ADD CONSTRAINT "POSTransfer_stores" CHECK ("fromStoreId" <> "toStoreId");
