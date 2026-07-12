-- Add missing employeeID column to Employee table
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "employeeID" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Employee_employeeID_key" ON "Employee"("employeeID");
