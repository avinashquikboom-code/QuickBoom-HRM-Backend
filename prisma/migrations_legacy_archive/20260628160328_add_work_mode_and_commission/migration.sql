/*
  Warnings:

  - You are about to drop the column `branchId` on the `Store` table. All the data in the column will be lost.
  - You are about to drop the `Branch` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Store" DROP CONSTRAINT "Store_branchId_fkey";

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "shiftTypeId" TEXT NOT NULL DEFAULT 'MORNING',
ADD COLUMN     "workModeId" TEXT NOT NULL DEFAULT 'OFFICE';

-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "departmentId" INTEGER,
ADD COLUMN     "roleId" INTEGER;

-- AlterTable
ALTER TABLE "ShiftAssignment" ADD COLUMN     "shiftTypeId" TEXT NOT NULL DEFAULT 'MORNING',
ADD COLUMN     "workModeId" TEXT NOT NULL DEFAULT 'OFFICE';

-- AlterTable
ALTER TABLE "Store" DROP COLUMN "branchId";

-- DropTable
DROP TABLE "Branch";

-- CreateTable
CREATE TABLE "CommissionPolicy" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "commissionType" TEXT NOT NULL DEFAULT 'PERCENTAGE',
    "commissionValue" DOUBLE PRECISION NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "storeId" INTEGER,
    "employeeId" INTEGER,
    "departmentId" INTEGER,
    "designationId" INTEGER,
    "roleId" TEXT,
    "productId" INTEGER,
    "categoryId" INTEGER,
    "brandId" INTEGER,
    "targetAmount" DOUBLE PRECISION,
    "targetBonus" DOUBLE PRECISION,
    "monthlyBonus" DOUBLE PRECISION,
    "quarterlyBonus" DOUBLE PRECISION,
    "yearlyBonus" DOUBLE PRECISION,
    "maxCommission" DOUBLE PRECISION,
    "minTarget" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionTransaction" (
    "id" SERIAL NOT NULL,
    "billId" TEXT,
    "invoiceNumber" TEXT,
    "employeeId" INTEGER NOT NULL,
    "storeId" INTEGER,
    "saleAmount" DOUBLE PRECISION NOT NULL,
    "commissionType" TEXT NOT NULL,
    "commissionPercent" DOUBLE PRECISION,
    "commissionAmount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedBy" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "payrollId" INTEGER,
    "paidAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "policyId" INTEGER,

    CONSTRAINT "CommissionTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionHistory" (
    "id" SERIAL NOT NULL,
    "transactionId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "previousStatus" TEXT,
    "newStatus" TEXT,
    "previousAmount" DOUBLE PRECISION,
    "newAmount" DOUBLE PRECISION,
    "reason" TEXT,
    "performedBy" INTEGER,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionTarget" (
    "id" SERIAL NOT NULL,
    "policyId" INTEGER NOT NULL,
    "employeeId" INTEGER,
    "storeId" INTEGER,
    "targetType" TEXT NOT NULL,
    "targetAmount" DOUBLE PRECISION NOT NULL,
    "achievedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "progressPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "bonusAmount" DOUBLE PRECISION,
    "bonusPaid" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionSettlement" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "settlementDate" TIMESTAMP(3) NOT NULL,
    "totalCommission" DOUBLE PRECISION NOT NULL,
    "totalBonus" DOUBLE PRECISION NOT NULL,
    "totalDeduction" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netAmount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "payrollId" INTEGER,
    "processedBy" INTEGER,
    "processedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionAdjustment" (
    "id" SERIAL NOT NULL,
    "transactionId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "adjustmentType" TEXT NOT NULL,
    "adjustmentAmount" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "approvedBy" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommissionPolicy_storeId_idx" ON "CommissionPolicy"("storeId");

-- CreateIndex
CREATE INDEX "CommissionPolicy_employeeId_idx" ON "CommissionPolicy"("employeeId");

-- CreateIndex
CREATE INDEX "CommissionPolicy_isActive_idx" ON "CommissionPolicy"("isActive");

-- CreateIndex
CREATE INDEX "CommissionPolicy_effectiveFrom_idx" ON "CommissionPolicy"("effectiveFrom");

-- CreateIndex
CREATE INDEX "CommissionTransaction_employeeId_idx" ON "CommissionTransaction"("employeeId");

-- CreateIndex
CREATE INDEX "CommissionTransaction_storeId_idx" ON "CommissionTransaction"("storeId");

-- CreateIndex
CREATE INDEX "CommissionTransaction_status_idx" ON "CommissionTransaction"("status");

-- CreateIndex
CREATE INDEX "CommissionTransaction_createdAt_idx" ON "CommissionTransaction"("createdAt");

-- CreateIndex
CREATE INDEX "CommissionTransaction_payrollId_idx" ON "CommissionTransaction"("payrollId");

-- CreateIndex
CREATE INDEX "CommissionHistory_transactionId_idx" ON "CommissionHistory"("transactionId");

-- CreateIndex
CREATE INDEX "CommissionHistory_employeeId_idx" ON "CommissionHistory"("employeeId");

-- CreateIndex
CREATE INDEX "CommissionHistory_action_idx" ON "CommissionHistory"("action");

-- CreateIndex
CREATE INDEX "CommissionHistory_performedAt_idx" ON "CommissionHistory"("performedAt");

-- CreateIndex
CREATE INDEX "CommissionTarget_policyId_idx" ON "CommissionTarget"("policyId");

-- CreateIndex
CREATE INDEX "CommissionTarget_employeeId_idx" ON "CommissionTarget"("employeeId");

-- CreateIndex
CREATE INDEX "CommissionTarget_storeId_idx" ON "CommissionTarget"("storeId");

-- CreateIndex
CREATE INDEX "CommissionTarget_status_idx" ON "CommissionTarget"("status");

-- CreateIndex
CREATE INDEX "CommissionTarget_startDate_idx" ON "CommissionTarget"("startDate");

-- CreateIndex
CREATE INDEX "CommissionTarget_endDate_idx" ON "CommissionTarget"("endDate");

-- CreateIndex
CREATE INDEX "CommissionSettlement_employeeId_idx" ON "CommissionSettlement"("employeeId");

-- CreateIndex
CREATE INDEX "CommissionSettlement_settlementDate_idx" ON "CommissionSettlement"("settlementDate");

-- CreateIndex
CREATE INDEX "CommissionSettlement_status_idx" ON "CommissionSettlement"("status");

-- CreateIndex
CREATE INDEX "CommissionSettlement_payrollId_idx" ON "CommissionSettlement"("payrollId");

-- CreateIndex
CREATE INDEX "CommissionAdjustment_transactionId_idx" ON "CommissionAdjustment"("transactionId");

-- CreateIndex
CREATE INDEX "CommissionAdjustment_employeeId_idx" ON "CommissionAdjustment"("employeeId");

-- CreateIndex
CREATE INDEX "CommissionAdjustment_status_idx" ON "CommissionAdjustment"("status");

-- AddForeignKey
ALTER TABLE "CommissionPolicy" ADD CONSTRAINT "CommissionPolicy_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionPolicy" ADD CONSTRAINT "CommissionPolicy_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionPolicy" ADD CONSTRAINT "CommissionPolicy_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionPolicy" ADD CONSTRAINT "CommissionPolicy_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "Designation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionTransaction" ADD CONSTRAINT "CommissionTransaction_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionTransaction" ADD CONSTRAINT "CommissionTransaction_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionTransaction" ADD CONSTRAINT "CommissionTransaction_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "CommissionPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionHistory" ADD CONSTRAINT "CommissionHistory_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "CommissionTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionTarget" ADD CONSTRAINT "CommissionTarget_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "CommissionPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionTarget" ADD CONSTRAINT "CommissionTarget_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionTarget" ADD CONSTRAINT "CommissionTarget_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionSettlement" ADD CONSTRAINT "CommissionSettlement_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionAdjustment" ADD CONSTRAINT "CommissionAdjustment_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "CommissionTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
