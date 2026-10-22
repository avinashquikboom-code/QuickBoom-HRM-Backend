-- Preserve all existing payslip amounts; new extra-attendance fields default to zero.
ALTER TABLE "Payslip" ADD COLUMN IF NOT EXISTS "extraAttendanceDays" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Payslip" ADD COLUMN IF NOT EXISTS "extraAttendancePayout" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Payslip" ADD COLUMN IF NOT EXISTS "extraAttendanceApproval" JSONB;
