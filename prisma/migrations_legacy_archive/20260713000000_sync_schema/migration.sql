-- DropForeignKey
ALTER TABLE "DeductionPolicy" DROP CONSTRAINT "DeductionPolicy_branchId_fkey";

-- DropForeignKey
ALTER TABLE "Employee" DROP CONSTRAINT "Employee_branchId_fkey";

-- DropForeignKey
ALTER TABLE "Store" DROP CONSTRAINT "Store_branchId_fkey";

-- DropIndex
DROP INDEX "AttendanceGenerationPolicy_branchId_idx";

-- DropIndex
DROP INDEX "DeductionPolicy_branchId_idx";

-- AlterTable
ALTER TABLE "AttendanceGenerationPolicy" DROP COLUMN "branchId";

-- AlterTable
ALTER TABLE "DeductionPolicy" DROP COLUMN "branchId";

-- AlterTable
ALTER TABLE "Employee" DROP COLUMN "branchId",
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'HOPKID';

-- AlterTable
ALTER TABLE "Store" DROP COLUMN "branchId";

-- DropTable
DROP TABLE "Branch";

-- CreateTable
CREATE TABLE "devices" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "fcmToken" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "devices_fcmToken_key" ON "devices"("fcmToken");

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
