ALTER TABLE "CommissionTransaction"
ADD COLUMN IF NOT EXISTS "productBreakdown" JSONB;