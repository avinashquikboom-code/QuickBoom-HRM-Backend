CREATE TABLE "CampaignImageAsset" (
  "canonicalUrl" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "bucket" TEXT,
  "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CampaignImageAsset_pkey" PRIMARY KEY ("canonicalUrl")
);
CREATE INDEX "CampaignImageAsset_lastUsedAt_idx" ON "CampaignImageAsset"("lastUsedAt");
