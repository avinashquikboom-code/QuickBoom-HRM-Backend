-- Add missing employeeID column to User (schema.prisma had it without a migration,
-- which broke prod logins with P2022: column User.employeeID does not exist).
-- IF NOT EXISTS keeps this safe on databases where the column was already added manually.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "employeeID" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "User_employeeID_key" ON "User"("employeeID");
