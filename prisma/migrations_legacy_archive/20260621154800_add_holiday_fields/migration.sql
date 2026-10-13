-- AlterTable
ALTER TABLE "Holiday" ADD COLUMN "recurring" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "type" TEXT NOT NULL DEFAULT 'mandatory';

-- AlterTable
ALTER TABLE "Office" ADD COLUMN "workingDays" TEXT[] DEFAULT ARRAY['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']::TEXT[],
ADD COLUMN "workingHoursEnd" TEXT NOT NULL DEFAULT '18:00',
ADD COLUMN "workingHoursStart" TEXT NOT NULL DEFAULT '09:00';

-- AlterTable
ALTER TABLE "SystemSetting" ADD COLUMN "attendance" JSONB,
ADD COLUMN "company" JSONB,
ADD COLUMN "leave" JSONB,
ADD COLUMN "payroll" JSONB;
