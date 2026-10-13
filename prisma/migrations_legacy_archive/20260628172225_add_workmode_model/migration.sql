-- CreateTable
CREATE TABLE "WorkMode" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkMode_pkey" PRIMARY KEY ("id")
);

-- Seed WorkModes
INSERT INTO "WorkMode" ("id", "name", "updatedAt") VALUES ('OFFICE', 'Office', CURRENT_TIMESTAMP);
INSERT INTO "WorkMode" ("id", "name", "updatedAt") VALUES ('REMOTE', 'Remote', CURRENT_TIMESTAMP);
INSERT INTO "WorkMode" ("id", "name", "updatedAt") VALUES ('HYBRID', 'Hybrid', CURRENT_TIMESTAMP);

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_workModeId_fkey" FOREIGN KEY ("workModeId") REFERENCES "WorkMode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_workModeId_fkey" FOREIGN KEY ("workModeId") REFERENCES "WorkMode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
