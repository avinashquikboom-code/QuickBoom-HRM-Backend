/*
  Warnings:

  - Changed the type of `assignedBy` on the `HrTask` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "HrTask" DROP COLUMN "assignedBy",
ADD COLUMN     "assignedBy" UUID NOT NULL;
