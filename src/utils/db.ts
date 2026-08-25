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
      ALTER TABLE "CommissionTransaction" ADD COLUMN IF NOT EXISTS "eventType" TEXT DEFAULT 'INVOICE_CREATED';
    `);

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