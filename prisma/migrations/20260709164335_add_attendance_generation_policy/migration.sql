-- CreateTable
CREATE TABLE "AttendanceGenerationPolicy" (
    "id" SERIAL NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "generationMode" TEXT NOT NULL DEFAULT 'MONTHLY',
    "autoGenerateCurrentMonth" BOOLEAN NOT NULL DEFAULT true,
    "autoGenerateFutureMonths" BOOLEAN NOT NULL DEFAULT false,
    "numberOfFutureMonths" INTEGER NOT NULL DEFAULT 1,
    "payrollCutoffDate" INTEGER NOT NULL DEFAULT 25,
    "attendanceFreezeDate" INTEGER NOT NULL DEFAULT 28,
    "autoGenerateWeeklyOffs" BOOLEAN NOT NULL DEFAULT true,
    "autoApplyHolidays" BOOLEAN NOT NULL DEFAULT true,
    "autoApplyShiftCalendar" BOOLEAN NOT NULL DEFAULT true,
    "autoMarkAbsentAfterWorkingHours" BOOLEAN NOT NULL DEFAULT false,
    "autoApplyHalfDayRules" BOOLEAN NOT NULL DEFAULT true,
    "autoApplyLateMarkRules" BOOLEAN NOT NULL DEFAULT true,
    "autoApplyEarlyExitRules" BOOLEAN NOT NULL DEFAULT true,
    "branchId" INTEGER,
    "departmentId" INTEGER,
    "officeId" INTEGER,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "AttendanceGenerationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceGenerationPolicy_isEnabled_idx" ON "AttendanceGenerationPolicy"("isEnabled");

-- CreateIndex
CREATE INDEX "AttendanceGenerationPolicy_branchId_idx" ON "AttendanceGenerationPolicy"("branchId");

-- CreateIndex
CREATE INDEX "AttendanceGenerationPolicy_departmentId_idx" ON "AttendanceGenerationPolicy"("departmentId");

-- CreateIndex
CREATE INDEX "AttendanceGenerationPolicy_officeId_idx" ON "AttendanceGenerationPolicy"("officeId");
