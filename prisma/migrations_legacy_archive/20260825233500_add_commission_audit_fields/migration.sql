-- AlterTable CommissionTransaction to add audit and delta tracking columns
ALTER TABLE "CommissionTransaction" ADD COLUMN IF NOT EXISTS "oldAmount" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE "CommissionTransaction" ADD COLUMN IF NOT EXISTS "newAmount" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE "CommissionTransaction" ADD COLUMN IF NOT EXISTS "oldCommission" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE "CommissionTransaction" ADD COLUMN IF NOT EXISTS "newCommission" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE "CommissionTransaction" ADD COLUMN IF NOT EXISTS "commissionDifference" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE "CommissionTransaction" ADD COLUMN IF NOT EXISTS "eventType" TEXT DEFAULT 'INVOICE_CREATED';

-- Ensure unique constraint on (billId, employeeId) for idempotency and multi-salesman support
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'CommissionTransaction_billId_employeeId_key'
    ) THEN
        BEGIN
            ALTER TABLE "CommissionTransaction" ADD CONSTRAINT "CommissionTransaction_billId_employeeId_key" UNIQUE ("billId", "employeeId");
        EXCEPTION WHEN others THEN
            NULL;
        END;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Sales_billId_employeeId_key'
    ) THEN
        BEGIN
            ALTER TABLE "Sales" ADD CONSTRAINT "Sales_billId_employeeId_key" UNIQUE ("billId", "employeeId");
        EXCEPTION WHEN others THEN
            NULL;
        END;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'WebhookLog_eventId_key'
    ) THEN
        BEGIN
            ALTER TABLE "WebhookLog" ADD CONSTRAINT "WebhookLog_eventId_key" UNIQUE ("eventId");
        EXCEPTION WHEN others THEN
            NULL;
        END;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'CreditNote_creditNoteNo_key'
    ) THEN
        BEGIN
            ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_creditNoteNo_key" UNIQUE ("creditNoteNo");
        EXCEPTION WHEN others THEN
            NULL;
        END;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'SalesExchange_exchangeNo_key'
    ) THEN
        BEGIN
            ALTER TABLE "SalesExchange" ADD CONSTRAINT "SalesExchange_exchangeNo_key" UNIQUE ("exchangeNo");
        EXCEPTION WHEN others THEN
            NULL;
        END;
    END IF;
END $$;
