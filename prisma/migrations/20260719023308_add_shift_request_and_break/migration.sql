-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "branchId" INTEGER;

-- AlterTable
ALTER TABLE "LeaveRequest" ADD COLUMN     "deductionApplied" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "leaveCategory" TEXT NOT NULL DEFAULT 'PLANNED';

-- CreateTable
CREATE TABLE "Break" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "date" TEXT NOT NULL,

    CONSTRAINT "Break_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftRequest" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "currentShift" TEXT NOT NULL,
    "requestedShift" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedBy" INTEGER,

    CONSTRAINT "ShiftRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "radiusMeters" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationHistory" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "isOutside" BOOLEAN NOT NULL DEFAULT false,
    "at" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocationHistory_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Break" ADD CONSTRAINT "Break_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRequest" ADD CONSTRAINT "ShiftRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationHistory" ADD CONSTRAINT "LocationHistory_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
