-- Migration: Add storeId support while preserving officeId for backward compatibility
-- This migration adds storeId fields to Employee and Attendance tables
-- and adds geofence fields to Store table
-- All officeId fields are preserved to maintain backward compatibility

-- Add storeId to Employee table (nullable)
ALTER TABLE "Employee" ADD COLUMN "storeId" INTEGER;

-- Add index on storeId for Employee
CREATE INDEX IF NOT EXISTS "Employee_storeId_idx" ON "Employee"("storeId");

-- Add storeId to Attendance table (nullable)
ALTER TABLE "Attendance" ADD COLUMN "storeId" INTEGER;

-- Add index on storeId for Attendance
CREATE INDEX IF NOT EXISTS "Attendance_storeId_idx" ON "Attendance"("storeId");

-- Add geofence fields to Store table
ALTER TABLE "Store" ADD COLUMN "officeId" INTEGER;
ALTER TABLE "Store" ADD COLUMN "latitude" DOUBLE PRECISION;
ALTER TABLE "Store" ADD COLUMN "longitude" DOUBLE PRECISION;
ALTER TABLE "Store" ADD COLUMN "idealRadiusMeters" DOUBLE PRECISION DEFAULT 25.0;
ALTER TABLE "Store" ADD COLUMN "maxPunchRadiusMeters" DOUBLE PRECISION DEFAULT 50.0;

-- Add foreign key constraint for Store.officeId -> Office.id
ALTER TABLE "Store" ADD CONSTRAINT "Store_officeId_fkey" 
    FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE SET NULL;

-- Add foreign key constraint for Attendance.storeId -> Store.id
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_storeId_fkey" 
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL;

-- Note: Employee.storeId already has a foreign key constraint from existing schema

-- Migration complete
-- All officeId fields are preserved for backward compatibility
-- New storeId fields can be used gradually as the system transitions to Store-based hierarchy
