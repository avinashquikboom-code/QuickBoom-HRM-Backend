-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "maxPunchRadiusMeters" DOUBLE PRECISION DEFAULT 50.0;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "customPunchRadius" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "maxPunchRadiusMeters" DOUBLE PRECISION DEFAULT 50.0;
