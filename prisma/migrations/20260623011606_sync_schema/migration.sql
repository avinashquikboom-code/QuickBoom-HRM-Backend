-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Role" ADD VALUE 'STORE_MANAGER';
ALTER TYPE "Role" ADD VALUE 'SALESMAN';
ALTER TYPE "Role" ADD VALUE 'HELPER';

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "designationId" INTEGER,
ADD COLUMN     "joiningDate" TIMESTAMP(3),
ADD COLUMN     "mobileNumber" TEXT,
ADD COLUMN     "reportingManagerId" INTEGER;

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "panNumber" TEXT DEFAULT '',
ADD COLUMN     "passportNumber" TEXT DEFAULT '',
ADD COLUMN     "voterId" TEXT DEFAULT '';

-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "officeId" INTEGER;

-- CreateTable
CREATE TABLE "UserSession" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "deviceInfo" TEXT,
    "ipAddress" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "employeeId" INTEGER,
    "branchId" INTEGER,
    "ipAddress" TEXT,
    "deviceInfo" TEXT,
    "action" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "employeeId" INTEGER,
    "assignedDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Designation" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Designation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomRole" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryStructure" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "monthlySalary" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "basicSalary" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hra" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "medicalAllowance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "travelAllowance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "specialAllowance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "incentive" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bonus" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pfEnabled" BOOLEAN NOT NULL DEFAULT false,
    "employeePfRate" DOUBLE PRECISION NOT NULL DEFAULT 12.0,
    "employerPfRate" DOUBLE PRECISION NOT NULL DEFAULT 12.0,
    "esicEnabled" BOOLEAN NOT NULL DEFAULT false,
    "employeeEsicRate" DOUBLE PRECISION NOT NULL DEFAULT 0.75,
    "employerEsicRate" DOUBLE PRECISION NOT NULL DEFAULT 3.25,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaryStructure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BreakRecord" (
    "id" SERIAL NOT NULL,
    "attendanceId" INTEGER NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "duration" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BreakRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_token_key" ON "UserSession"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_code_key" ON "Asset"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Project_name_key" ON "Project"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Designation_name_key" ON "Designation"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CustomRole_name_key" ON "CustomRole"("name");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryStructure_employeeId_key" ON "SalaryStructure"("employeeId");

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "Designation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_reportingManagerId_fkey" FOREIGN KEY ("reportingManagerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryStructure" ADD CONSTRAINT "SalaryStructure_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreakRecord" ADD CONSTRAINT "BreakRecord_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
