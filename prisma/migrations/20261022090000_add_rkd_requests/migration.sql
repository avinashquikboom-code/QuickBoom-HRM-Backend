-- CreateTable
CREATE TABLE IF NOT EXISTS "RkdRequest" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "productName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "commissionAmount" DOUBLE PRECISION NOT NULL,
    "saleReference" TEXT,
    "particulars" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "reviewedBy" INTEGER,
    "reviewedByName" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "payrollId" INTEGER,
    "salaryMonth" INTEGER,
    "salaryYear" INTEGER,
    "isSalaryCredited" BOOLEAN NOT NULL DEFAULT false,
    "salaryCreditedAt" TIMESTAMP(3),
    "submissionKey" TEXT,
    "commissionTxId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RkdRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "RkdRequest_submissionKey_key" ON "RkdRequest"("submissionKey");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "RkdRequest_commissionTxId_key" ON "RkdRequest"("commissionTxId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RkdRequest_employeeId_idx" ON "RkdRequest"("employeeId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RkdRequest_status_idx" ON "RkdRequest"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RkdRequest_saleReference_idx" ON "RkdRequest"("saleReference");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RkdRequest_createdAt_idx" ON "RkdRequest"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RkdRequest_payrollId_idx" ON "RkdRequest"("payrollId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RkdRequest_employeeId_salaryYear_salaryMonth_idx" ON "RkdRequest"("employeeId", "salaryYear", "salaryMonth");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'RkdRequest_employeeId_fkey'
    ) THEN
        ALTER TABLE "RkdRequest" ADD CONSTRAINT "RkdRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
