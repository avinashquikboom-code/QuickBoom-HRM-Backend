ALTER TABLE "Expense" ADD COLUMN "submissionKey" TEXT;
CREATE UNIQUE INDEX "Expense_submissionKey_key" ON "Expense"("submissionKey");
