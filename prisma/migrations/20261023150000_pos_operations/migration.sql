-- AlterTable
ALTER TABLE "POSCategory" ADD COLUMN     "externalCommissionCategoryId" INTEGER;

-- AlterTable
ALTER TABLE "POSProduct" ADD COLUMN     "externalCommissionProductId" INTEGER;

-- AlterTable
ALTER TABLE "POSSale" ADD COLUMN     "customerId" UUID,
ADD COLUMN     "paymentStatus" TEXT NOT NULL DEFAULT 'RECORDED',
ADD COLUMN     "rounding" DECIMAL(15,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "POSSalePayment" ADD COLUMN     "gatewayTransactionId" TEXT,
ADD COLUMN     "reconciledAt" TIMESTAMP(3),
ADD COLUMN     "reconciliationNote" TEXT,
ADD COLUMN     "reconciliationStatus" TEXT NOT NULL DEFAULT 'UNRECONCILED';

-- AlterTable
ALTER TABLE "POSReturn" ADD COLUMN     "reconciledAt" TIMESTAMP(3),
ADD COLUMN     "reconciliationNote" TEXT,
ADD COLUMN     "reconciliationStatus" TEXT NOT NULL DEFAULT 'UNRECONCILED';

-- CreateTable
CREATE TABLE "POSConfiguration" (
    "storeId" INTEGER NOT NULL,
    "commissionEnabled" BOOLEAN NOT NULL DEFAULT false,
    "commissionBasis" TEXT,
    "fixedCommissionBasis" TEXT,
    "refundCommissionPolicy" TEXT,
    "returnWindowDays" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "POSConfiguration_pkey" PRIMARY KEY ("storeId")
);

-- CreateTable
CREATE TABLE "POSCustomer" (
    "id" UUID NOT NULL,
    "storeId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "POSCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "POSPaymentMethod" (
    "id" UUID NOT NULL,
    "storeId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "POSPaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "POSCommissionLine" (
    "id" UUID NOT NULL,
    "saleItemId" UUID NOT NULL,
    "transactionId" INTEGER NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "reversedAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "eligibleRevenue" DECIMAL(15,2) NOT NULL,
    "policySnapshot" JSONB NOT NULL,

    CONSTRAINT "POSCommissionLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "POSCustomer_storeId_name_idx" ON "POSCustomer"("storeId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "POSCustomer_storeId_phone_key" ON "POSCustomer"("storeId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "POSPaymentMethod_storeId_code_key" ON "POSPaymentMethod"("storeId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "POSCommissionLine_saleItemId_key" ON "POSCommissionLine"("saleItemId");

-- CreateIndex
CREATE INDEX "POSCommissionLine_transactionId_idx" ON "POSCommissionLine"("transactionId");

-- AddForeignKey
ALTER TABLE "POSSale" ADD CONSTRAINT "POSSale_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "POSCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSConfiguration" ADD CONSTRAINT "POSConfiguration_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSCustomer" ADD CONSTRAINT "POSCustomer_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSPaymentMethod" ADD CONSTRAINT "POSPaymentMethod_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSCommissionLine" ADD CONSTRAINT "POSCommissionLine_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "POSSaleItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSCommissionLine" ADD CONSTRAINT "POSCommissionLine_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "CommissionTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
