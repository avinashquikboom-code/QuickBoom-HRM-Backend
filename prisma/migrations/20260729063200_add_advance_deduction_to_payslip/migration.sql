-- AddColumn: Payslip.advanceDeduction
-- The advanceDeduction column was added to the Prisma schema but the
-- migration was never generated, so production DB is missing this column.

ALTER TABLE "Payslip" ADD COLUMN IF NOT EXISTS "advanceDeduction" DOUBLE PRECISION NOT NULL DEFAULT 0;
