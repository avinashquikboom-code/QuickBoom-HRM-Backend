-- AlterTable
ALTER TABLE "POSSaleItem" ADD COLUMN "salespersonId" INTEGER;

-- CreateIndex
CREATE INDEX "POSSaleItem_salespersonId_idx" ON "POSSaleItem"("salespersonId");

-- AddForeignKey
ALTER TABLE "POSSaleItem" ADD CONSTRAINT "POSSaleItem_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
