/*
  Warnings:

  - The primary key for the `HrTask` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `HrTaskUpdate` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - Changed the type of `id` on the `HrTask` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `HrTaskUpdate` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `taskId` on the `HrTaskUpdate` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- DropForeignKey
ALTER TABLE "HrTaskUpdate" DROP CONSTRAINT "HrTaskUpdate_taskId_fkey";

-- AlterTable
ALTER TABLE "HrTask" DROP CONSTRAINT "HrTask_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
ADD CONSTRAINT "HrTask_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "HrTaskUpdate" DROP CONSTRAINT "HrTaskUpdate_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "taskId",
ADD COLUMN     "taskId" UUID NOT NULL,
ADD CONSTRAINT "HrTaskUpdate_pkey" PRIMARY KEY ("id");

-- CreateIndex
CREATE INDEX "HrTaskUpdate_taskId_idx" ON "HrTaskUpdate"("taskId");

-- AddForeignKey
ALTER TABLE "HrTaskUpdate" ADD CONSTRAINT "HrTaskUpdate_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "HrTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
