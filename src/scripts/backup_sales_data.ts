import { prisma } from '../utils/db';
import * as fs from 'fs';
import * as path from 'path';

async function backupSalesData() {
  console.log('==================================================');
  console.log('📦 CREATING BACKUP FOR 01-AUG-2026 TO 12-AUG-2026');
  console.log('==================================================\n');

  const fromDate = new Date('2026-08-01T00:00:00.000Z');
  const toDate = new Date('2026-08-12T23:59:59.999Z');

  const salesBackup = await prisma.sales.findMany({
    where: { saleDate: { gte: fromDate, lte: toDate } }
  });

  const commTxnBackup = await prisma.commissionTransaction.findMany({
    where: { createdAt: { gte: fromDate, lte: toDate } }
  });

  const hopkidLogBackup = await prisma.hopkidWebhookLog.findMany({
    where: { createdAt: { gte: fromDate, lte: toDate } }
  });

  const webhookLogBackup = await prisma.webhookLog.findMany({
    where: { createdAt: { gte: fromDate, lte: toDate } }
  });

  const backupData = {
    exportedAt: new Date().toISOString(),
    dateRange: { from: fromDate.toISOString(), to: toDate.toISOString() },
    counts: {
      sales: salesBackup.length,
      commissionTransactions: commTxnBackup.length,
      hopkidWebhookLogs: hopkidLogBackup.length,
      webhookLogs: webhookLogBackup.length
    },
    sales: salesBackup,
    commissionTransactions: commTxnBackup,
    hopkidWebhookLogs: hopkidLogBackup,
    webhookLogs: webhookLogBackup
  };

  const backupDir = path.join(__dirname, '../../scratch');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const backupPath = path.join(backupDir, `backup_sales_01aug_12aug_${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));

  console.log(`✅ Backup successfully created at: ${backupPath}`);
  console.log(`   - Sales Records: ${salesBackup.length}`);
  console.log(`   - Commission Transactions: ${commTxnBackup.length}`);
  console.log(`   - Hopkid Webhook Logs: ${hopkidLogBackup.length}`);
  console.log(`   - Webhook Logs: ${webhookLogBackup.length}\n`);

  await prisma.$disconnect();
}

backupSalesData().catch(err => {
  console.error('❌ Backup Failed:', err);
  prisma.$disconnect();
  process.exit(1);
});
