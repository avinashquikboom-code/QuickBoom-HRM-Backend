-- Preserve all existing payslip amounts; new extra-attendance fields default to zero.
ALTER TABLE "Payslip" ADD COLUMN "extraAttendanceDays" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Payslip" ADD COLUMN "extraAttendancePayout" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Payslip" ADD COLUMN "extraAttendanceApproval" JSONB;
