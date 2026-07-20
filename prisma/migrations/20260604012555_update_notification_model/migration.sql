-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "userId" INTEGER,
ALTER COLUMN "employeeId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
