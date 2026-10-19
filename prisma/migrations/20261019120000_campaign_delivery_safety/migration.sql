-- Additive only. Existing campaign migration must be applied first.
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMP(3);
ALTER TABLE "CampaignRecipient" ADD COLUMN IF NOT EXISTS "tokenStates" JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS "Campaign_dedupeKey_key" ON "Campaign"("dedupeKey");
-- Fail safely if legacy campaign history contains duplicates; never delete history.
CREATE UNIQUE INDEX IF NOT EXISTS "Notification_campaignId_employeeId_key" ON "Notification"("campaignId", "employeeId");
