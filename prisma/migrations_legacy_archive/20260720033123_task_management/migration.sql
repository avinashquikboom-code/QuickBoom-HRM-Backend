-- CreateEnum
CREATE TYPE "HrPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "HrTaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "HrTask" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assignedTo" TEXT NOT NULL,
    "assignedBy" INTEGER NOT NULL,
    "priority" "HrPriority" NOT NULL DEFAULT 'MEDIUM',
    "dueDate" TIMESTAMP(3),
    "status" "HrTaskStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrTaskUpdate" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "byUserId" INTEGER NOT NULL,
    "oldStatus" "HrTaskStatus",
    "newStatus" "HrTaskStatus" NOT NULL,
    "comment" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrTaskUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HrTask_assignedTo_idx" ON "HrTask"("assignedTo");

-- CreateIndex
CREATE INDEX "HrTask_status_idx" ON "HrTask"("status");

-- CreateIndex
CREATE INDEX "HrTask_dueDate_idx" ON "HrTask"("dueDate");

-- CreateIndex
CREATE INDEX "HrTaskUpdate_taskId_idx" ON "HrTaskUpdate"("taskId");

-- AddForeignKey
ALTER TABLE "HrTaskUpdate" ADD CONSTRAINT "HrTaskUpdate_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "HrTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
