ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "submissionKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Expense_submissionKey_key" ON "Expense"("submissionKey");
