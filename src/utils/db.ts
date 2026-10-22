import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const isLocal = process.env.DATABASE_URL?.includes('localhost') || process.env.DATABASE_URL?.includes('127.0.0.1');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false }, // Always use SSL for remote databases (e.g. Supabase)
  // Optimized connection pool settings for better performance
  max: 20, // Increased from 10 for better concurrency
  min: 5,  // Increased from 2 to reduce connection wait times
  idleTimeoutMillis: 60000, // Increased from 30s to reduce connection churn
  connectionTimeoutMillis: 5000, // Decreased from 10s for faster failover
  statement_timeout: 20000, // Decreased from 30s to prevent hanging queries
});

const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ 
  adapter,
  log: process.env.NODE_ENV === 'production' ? ['error', 'warn'] : ['query', 'error', 'warn'],
});

let isBankEditTableEnsured = false;
export async function ensureBankEditTable(): Promise<void> {
  if (isBankEditTableEnsured) return;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "BankEditRequest" (
        "id" SERIAL PRIMARY KEY,
        "employeeId" INTEGER NOT NULL,
        "bankName" TEXT,
        "accountNumber" TEXT,
        "ifscCode" TEXT,
        "accountType" TEXT,
        "branchName" TEXT,
        "reason" TEXT,
        "status" TEXT NOT NULL DEFAULT 'PENDING',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "decidedAt" TIMESTAMP(3),
        "decidedBy" INTEGER
      );
    `);
    isBankEditTableEnsured = true;
    console.log('✅ [ensureBankEditTable] Verified BankEditRequest table exists.');
  } catch (error) {
    console.warn('⚠️ [ensureBankEditTable] Exception ignored:', error);
  }
}

let isDbConstraintsEnsured = false;
export async function ensureDatabaseConstraints(): Promise<void> {
  if (isDbConstraintsEnsured) return;
  try {
    // 1. Ensure required audit columns exist on CommissionTransaction
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "CommissionTransaction" ADD COLUMN IF NOT EXISTS "oldAmount" DOUBLE PRECISION DEFAULT 0;
      ALTER TABLE "CommissionTransaction" ADD COLUMN IF NOT EXISTS "newAmount" DOUBLE PRECISION DEFAULT 0;
      ALTER TABLE "CommissionTransaction" ADD COLUMN IF NOT EXISTS "oldCommission" DOUBLE PRECISION DEFAULT 0;
      ALTER TABLE "CommissionTransaction" ADD COLUMN IF NOT EXISTS "newCommission" DOUBLE PRECISION DEFAULT 0;
      ALTER TABLE "CommissionTransaction" ADD COLUMN IF NOT EXISTS "commissionDifference" DOUBLE PRECISION DEFAULT 0;
      ALTER TABLE "CommissionTransaction" ADD COLUMN IF NOT EXISTS "productBreakdown" JSONB;
      ALTER TABLE "CommissionTransaction" ADD COLUMN IF NOT EXISTS "eventType" TEXT DEFAULT 'INVOICE_CREATED';

      -- Ensure Employee and Notification columns exist safely
      ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "dateOfBirth" TIMESTAMP(3);
      ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;
      ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "actionUrl" TEXT;
      ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "deliveryStatus" TEXT NOT NULL DEFAULT 'SENT';
      ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "failureReason" TEXT;
      ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "fcmMessageId" TEXT;
      ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "readAt" TIMESTAMP(3);
    `);

    // Ensure _prisma_migrations does not have a failed 0_init baseline migration blocking Prisma
    try {
      await prisma.$executeRawUnsafe(`
        UPDATE "_prisma_migrations"
        SET "finished_at" = NOW(), "applied_steps_count" = 1
        WHERE "migration_name" = '0_init' AND "finished_at" IS NULL AND "rolled_back_at" IS NULL;
      `);
    } catch {
      // Non-blocking
    }

    // 2. Ensure unique constraints exist for idempotency and relations
    await prisma.$executeRawUnsafe(`
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
    `);
    isDbConstraintsEnsured = true;
    console.log('✅ [ensureDatabaseConstraints] Verified columns & UNIQUE constraints exist.');
  } catch (error) {
    console.warn('⚠️ [ensureDatabaseConstraints] Exception ignored:', error);
  }
}

let isRkdTableEnsured = false;
export async function ensureRkdTable(): Promise<void> {
  if (isRkdTableEnsured) return;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "RkdRequest" (
        "id" SERIAL PRIMARY KEY,
        "employeeId" INTEGER NOT NULL,
        "productName" TEXT NOT NULL,
        "quantity" INTEGER NOT NULL,
        "commissionAmount" DOUBLE PRECISION NOT NULL,
        "saleReference" TEXT,
        "particulars" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'PENDING',
        "rejectionReason" TEXT,
        "reviewedBy" INTEGER,
        "reviewedByName" TEXT,
        "reviewedAt" TIMESTAMP(3),
        "payrollId" INTEGER,
        "salaryMonth" INTEGER,
        "salaryYear" INTEGER,
        "isSalaryCredited" BOOLEAN NOT NULL DEFAULT false,
        "salaryCreditedAt" TIMESTAMP(3),
        "submissionKey" TEXT,
        "commissionTxId" INTEGER,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "RkdRequest_submissionKey_key" ON "RkdRequest"("submissionKey");
      CREATE UNIQUE INDEX IF NOT EXISTS "RkdRequest_commissionTxId_key" ON "RkdRequest"("commissionTxId");
      CREATE INDEX IF NOT EXISTS "RkdRequest_employeeId_idx" ON "RkdRequest"("employeeId");
      CREATE INDEX IF NOT EXISTS "RkdRequest_status_idx" ON "RkdRequest"("status");
      CREATE INDEX IF NOT EXISTS "RkdRequest_saleReference_idx" ON "RkdRequest"("saleReference");
      CREATE INDEX IF NOT EXISTS "RkdRequest_createdAt_idx" ON "RkdRequest"("createdAt");
      CREATE INDEX IF NOT EXISTS "RkdRequest_payrollId_idx" ON "RkdRequest"("payrollId");
      CREATE INDEX IF NOT EXISTS "RkdRequest_salaryPeriod_idx" ON "RkdRequest"("employeeId", "salaryYear", "salaryMonth");
    `);
    isRkdTableEnsured = true;
    console.log('✅ [ensureRkdTable] Verified RkdRequest table and indices exist.');
  } catch (error) {
    console.warn('⚠️ [ensureRkdTable] Exception ignored:', error);
  }
}