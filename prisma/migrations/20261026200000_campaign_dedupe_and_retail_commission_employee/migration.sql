-- AlterTable Campaign
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMP(3);

-- AlterTable CampaignRecipient
ALTER TABLE "CampaignRecipient" ADD COLUMN IF NOT EXISTS "tokenStates" JSONB;

-- AlterTable POSRetailCommission
ALTER TABLE "POSRetailCommission" ADD COLUMN IF NOT EXISTS "employeeId" INTEGER;

-- AlterTable RkdRequest
ALTER TABLE "RkdRequest" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Campaign_dedupeKey_key" ON "Campaign"("dedupeKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "POSRetailCommission_employeeId_createdAt_idx" ON "POSRetailCommission"("employeeId", "createdAt");
CREATE INDEX IF NOT EXISTS "POSRetailCommission_employeeId_status_idx" ON "POSRetailCommission"("employeeId", "status");
CREATE INDEX IF NOT EXISTS "POSRetailCommission_status_createdAt_idx" ON "POSRetailCommission"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "POSRetailCommission_subcategoryId_status_idx" ON "POSRetailCommission"("subcategoryId", "status");
CREATE INDEX IF NOT EXISTS "POSRetailCommission_storeId_subcategoryId_createdAt_idx" ON "POSRetailCommission"("storeId", "subcategoryId", "createdAt");

-- AddForeignKey POSRetailCommission -> Employee
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'POSRetailCommission_employeeId_fkey'
    ) THEN
        ALTER TABLE "POSRetailCommission" ADD CONSTRAINT "POSRetailCommission_employeeId_fkey" 
        FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- Drop legacy Notification unique index if exists
DROP INDEX IF EXISTS "Notification_campaignId_employeeId_key";
