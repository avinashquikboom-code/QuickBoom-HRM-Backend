-- CreateTable
CREATE TABLE "POSBillingDraft" (
    "id" UUID NOT NULL,
    "userId" INTEGER NOT NULL,
    "employeeId" INTEGER,
    "storeId" INTEGER NOT NULL,
    "sessionId" UUID,
    "saleId" UUID,
    "status" TEXT NOT NULL DEFAULT 'WORKING',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "snapshot" JSONB NOT NULL,
    "lastWriteKey" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "POSBillingDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "POSWorkBreak" (
    "id" UUID NOT NULL,
    "draftId" UUID NOT NULL,
    "storeId" INTEGER NOT NULL,
    "sessionId" UUID,
    "requestKey" UUID NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,

    CONSTRAINT "POSWorkBreak_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "POSBillingDraft_saleId_key" ON "POSBillingDraft"("saleId");

-- CreateIndex
CREATE UNIQUE INDEX "POSBillingDraft_lastWriteKey_key" ON "POSBillingDraft"("lastWriteKey");

-- CreateIndex
CREATE INDEX "POSBillingDraft_userId_status_idx" ON "POSBillingDraft"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "POSWorkBreak_requestKey_key" ON "POSWorkBreak"("requestKey");

-- CreateIndex
CREATE INDEX "POSWorkBreak_draftId_startedAt_idx" ON "POSWorkBreak"("draftId", "startedAt");

-- AddForeignKey
ALTER TABLE "POSBillingDraft" ADD CONSTRAINT "POSBillingDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSBillingDraft" ADD CONSTRAINT "POSBillingDraft_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSBillingDraft" ADD CONSTRAINT "POSBillingDraft_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSBillingDraft" ADD CONSTRAINT "POSBillingDraft_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "POSSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSBillingDraft" ADD CONSTRAINT "POSBillingDraft_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "POSSale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSWorkBreak" ADD CONSTRAINT "POSWorkBreak_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "POSBillingDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSWorkBreak" ADD CONSTRAINT "POSWorkBreak_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSWorkBreak" ADD CONSTRAINT "POSWorkBreak_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "POSSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enforce active work/break uniqueness across processes, not just in the UI.
CREATE UNIQUE INDEX "POSBillingDraft_active_user" ON "POSBillingDraft" ("userId") WHERE "status" IN ('WORKING', 'ON_BREAK');
CREATE UNIQUE INDEX "POSWorkBreak_active_draft" ON "POSWorkBreak" ("draftId") WHERE "endedAt" IS NULL;
ALTER TABLE "POSBillingDraft" ADD CONSTRAINT "POSBillingDraft_status_check" CHECK ("status" IN ('WORKING', 'ON_BREAK', 'ARCHIVED', 'COMPLETED'));
ALTER TABLE "POSWorkBreak" ADD CONSTRAINT "POSWorkBreak_duration_check" CHECK (("endedAt" IS NULL AND "durationSeconds" IS NULL) OR ("endedAt" >= "startedAt" AND "durationSeconds" >= 0));
