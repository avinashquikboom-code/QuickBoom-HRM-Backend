-- CreateTable
CREATE TABLE "POSStoreCredential" (
    "id" UUID NOT NULL,
    "storeId" INTEGER NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "posEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "POSStoreCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "POSStoreCredential_storeId_key" ON "POSStoreCredential"("storeId");

-- CreateIndex
CREATE INDEX "POSStoreCredential_storeId_idx" ON "POSStoreCredential"("storeId");

-- AddForeignKey
ALTER TABLE "POSStoreCredential" ADD CONSTRAINT "POSStoreCredential_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
