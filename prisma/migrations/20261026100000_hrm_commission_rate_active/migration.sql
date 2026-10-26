-- Preserve all existing rules; future version rows may explicitly disable a rate.
ALTER TABLE "HrmCommissionRate" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
