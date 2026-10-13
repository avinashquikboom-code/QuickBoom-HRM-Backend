/*
  Warnings:

  - You are about to drop the column `city` on the `Store` table. All the data in the column will be lost.
  - You are about to drop the column `email` on the `Store` table. All the data in the column will be lost.
  - You are about to drop the column `phone` on the `Store` table. All the data in the column will be lost.
  - You are about to drop the column `state` on the `Store` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Store" DROP COLUMN "city",
DROP COLUMN "email",
DROP COLUMN "phone",
DROP COLUMN "state";
