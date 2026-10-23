-- AlterTable
ALTER TABLE "POSSession" ADD COLUMN     "shiftAssignmentId" INTEGER;

-- AlterTable
ALTER TABLE "POSSaleItem" ADD COLUMN     "barcode" TEXT;

-- AddForeignKey
ALTER TABLE "POSSession" ADD CONSTRAINT "POSSession_shiftAssignmentId_fkey" FOREIGN KEY ("shiftAssignmentId") REFERENCES "ShiftAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Financial invariants are limited to new POS tables.
ALTER TABLE "POSCommissionLine" ADD CONSTRAINT "POSCommissionLine_amounts" CHECK ("amount" >= 0 AND "reversedAmount" BETWEEN 0 AND "amount" AND "eligibleRevenue" >= 0);
ALTER TABLE "POSConfiguration" ADD CONSTRAINT "POSConfiguration_policy" CHECK (NOT "commissionEnabled" OR ("commissionBasis" IS NOT NULL AND "commissionBasis" IN ('NET_EX_TAX','NET_INCL_TAX') AND "fixedCommissionBasis" IS NOT NULL AND "fixedCommissionBasis" IN ('LINE','UNIT') AND "refundCommissionPolicy" = 'REVIEW_ADJUSTMENT'));
ALTER TABLE "POSConfiguration" ADD CONSTRAINT "POSConfiguration_return_window" CHECK ("returnWindowDays" IS NULL OR "returnWindowDays" BETWEEN 0 AND 3650);
ALTER TABLE "POSSalePayment" ADD CONSTRAINT "POSPayment_reconciliation" CHECK ("reconciliationStatus" IN ('UNRECONCILED','RECONCILED','DISPUTED'));
ALTER TABLE "POSReturn" ADD CONSTRAINT "POSReturn_reconciliation" CHECK ("reconciliationStatus" IN ('UNRECONCILED','RECONCILED','DISPUTED'));
