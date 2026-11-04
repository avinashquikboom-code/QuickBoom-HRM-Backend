-- AlterTable
ALTER TABLE "Payslip" ADD COLUMN "overtimeAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "overtimeHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "overtimeRate" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SalaryStructure" ADD COLUMN "overtimeHourlyRate" DOUBLE PRECISION,
ADD COLUMN "overtimeMultiplier" DOUBLE PRECISION DEFAULT 1.0;

-- CreateTable
CREATE TABLE "OvertimeRecord" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "attendanceId" INTEGER NOT NULL,
    "shiftId" INTEGER,
    "overtimeDate" TEXT NOT NULL,
    "scheduledStartTime" TEXT,
    "scheduledEndTime" TEXT,
    "actualCheckIn" TIMESTAMP(3),
    "actualCheckOut" TIMESTAMP(3),
    "beforeShiftMinutes" INTEGER NOT NULL DEFAULT 0,
    "afterShiftMinutes" INTEGER NOT NULL DEFAULT 0,
    "totalOvertimeMinutes" INTEGER NOT NULL DEFAULT 0,
    "approvalStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "remarks" TEXT,
    "hourlyRate" DOUBLE PRECISION,
    "payableAmount" DOUBLE PRECISION,
    "payrollId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OvertimeRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OvertimeRecord_attendanceId_key" ON "OvertimeRecord"("attendanceId");

-- CreateIndex
CREATE INDEX "OvertimeRecord_employeeId_overtimeDate_idx" ON "OvertimeRecord"("employeeId", "overtimeDate");

-- CreateIndex
CREATE INDEX "OvertimeRecord_approvalStatus_idx" ON "OvertimeRecord"("approvalStatus");

-- CreateIndex
CREATE INDEX "OvertimeRecord_overtimeDate_idx" ON "OvertimeRecord"("overtimeDate");

-- CreateIndex
CREATE INDEX "OvertimeRecord_payrollId_idx" ON "OvertimeRecord"("payrollId");

-- AddForeignKey
ALTER TABLE "OvertimeRecord" ADD CONSTRAINT "OvertimeRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OvertimeRecord" ADD CONSTRAINT "OvertimeRecord_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OvertimeRecord" ADD CONSTRAINT "OvertimeRecord_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OvertimeRecord" ADD CONSTRAINT "OvertimeRecord_payrollId_fkey" FOREIGN KEY ("payrollId") REFERENCES "Payslip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

