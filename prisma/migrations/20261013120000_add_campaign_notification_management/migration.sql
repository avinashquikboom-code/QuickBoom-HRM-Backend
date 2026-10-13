-- AlterTable Employee
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "dateOfBirth" TIMESTAMP(3);

-- AlterTable Notification
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "actionUrl" TEXT;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "campaignId" TEXT;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "deliveryStatus" TEXT NOT NULL DEFAULT 'SENT';
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "failureReason" TEXT;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "fcmMessageId" TEXT;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "readAt" TIMESTAMP(3);

-- CreateTable Campaign
CREATE TABLE IF NOT EXISTS "Campaign" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "description" TEXT,
    "notificationType" TEXT NOT NULL DEFAULT 'GENERAL_ANNOUNCEMENT',
    "imageUrl" TEXT,
    "actionUrl" TEXT,
    "audienceType" TEXT NOT NULL DEFAULT 'ALL_EMPLOYEES',
    "audienceCriteria" JSONB,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "totalRecipients" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "readCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdById" INTEGER,
    "companyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable CampaignRecipient
CREATE TABLE IF NOT EXISTS "CampaignRecipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "userId" INTEGER,
    "deliveryStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "fcmMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Campaign_companyId_idx" ON "Campaign"("companyId");
CREATE INDEX IF NOT EXISTS "Campaign_status_idx" ON "Campaign"("status");
CREATE INDEX IF NOT EXISTS "Campaign_scheduledAt_idx" ON "Campaign"("scheduledAt");
CREATE INDEX IF NOT EXISTS "Campaign_createdAt_idx" ON "Campaign"("createdAt");
CREATE INDEX IF NOT EXISTS "Campaign_createdById_idx" ON "Campaign"("createdById");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CampaignRecipient_campaignId_idx" ON "CampaignRecipient"("campaignId");
CREATE INDEX IF NOT EXISTS "CampaignRecipient_employeeId_idx" ON "CampaignRecipient"("employeeId");
CREATE INDEX IF NOT EXISTS "CampaignRecipient_userId_idx" ON "CampaignRecipient"("userId");
CREATE INDEX IF NOT EXISTS "CampaignRecipient_deliveryStatus_idx" ON "CampaignRecipient"("deliveryStatus");
CREATE INDEX IF NOT EXISTS "CampaignRecipient_isRead_idx" ON "CampaignRecipient"("isRead");
CREATE INDEX IF NOT EXISTS "CampaignRecipient_createdAt_idx" ON "CampaignRecipient"("createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "CampaignRecipient_campaignId_employeeId_key" ON "CampaignRecipient"("campaignId", "employeeId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Notification_campaignId_idx" ON "Notification"("campaignId");

-- AddForeignKey Notification -> Campaign
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Notification_campaignId_fkey'
    ) THEN
        ALTER TABLE "Notification" ADD CONSTRAINT "Notification_campaignId_fkey" 
        FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey Campaign -> User (createdById)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Campaign_createdById_fkey'
    ) THEN
        ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_createdById_fkey" 
        FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey CampaignRecipient -> Campaign
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'CampaignRecipient_campaignId_fkey'
    ) THEN
        ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_campaignId_fkey" 
        FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey CampaignRecipient -> Employee
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'CampaignRecipient_employeeId_fkey'
    ) THEN
        ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_employeeId_fkey" 
        FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey CampaignRecipient -> User
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'CampaignRecipient_userId_fkey'
    ) THEN
        ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_userId_fkey" 
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
