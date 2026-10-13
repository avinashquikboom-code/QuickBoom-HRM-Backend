-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "accountNumber" TEXT,
ADD COLUMN     "accountType" TEXT DEFAULT 'Savings',
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "branchId" INTEGER,
ADD COLUMN     "branchName" TEXT,
ADD COLUMN     "ifscCode" TEXT;

-- CreateTable
CREATE TABLE "DeductionPolicy" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "deductionType" TEXT NOT NULL,
    "deductionValue" DOUBLE PRECISION NOT NULL,
    "maxDeduction" DOUBLE PRECISION,
    "applicableDays" TEXT[],
    "branchId" INTEGER,
    "departmentId" INTEGER,
    "officeId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "DeductionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeductionPolicy_type_idx" ON "DeductionPolicy"("type");

-- CreateIndex
CREATE INDEX "DeductionPolicy_branchId_idx" ON "DeductionPolicy"("branchId");

-- CreateIndex
CREATE INDEX "DeductionPolicy_departmentId_idx" ON "DeductionPolicy"("departmentId");

-- CreateIndex
CREATE INDEX "DeductionPolicy_officeId_idx" ON "DeductionPolicy"("officeId");

-- CreateIndex
CREATE INDEX "DeductionPolicy_isActive_idx" ON "DeductionPolicy"("isActive");

-- CreateIndex
CREATE INDEX "Branch_isActive_idx" ON "Branch"("isActive");

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeductionPolicy" ADD CONSTRAINT "DeductionPolicy_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeductionPolicy" ADD CONSTRAINT "DeductionPolicy_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeductionPolicy" ADD CONSTRAINT "DeductionPolicy_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE SET NULL ON UPDATE CASCADE;
