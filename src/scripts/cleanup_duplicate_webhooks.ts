import { prisma } from '../utils/db';
import { extractWebhookMeta, normalizeEventType } from '../utils/commissionHelper';
import { computePayloadHash } from '../utils/webhookIdempotency';

async function cleanupDuplicates() {
  console.log('🧹 [Cleanup] Starting Webhook Logs & Sales Data Reset/Cleanup...');

  // 1. Clear WebhookAuditLog (HopkidWebhookLog in Prisma / WebhookAuditLog in DB)
  try {
    const deletedHopkidLogs = await prisma.hopkidWebhookLog.deleteMany({});
    console.log(`✅ [Cleanup] Cleared ${deletedHopkidLogs.count} records from HopkidWebhookLog (WebhookAuditLog).`);
  } catch (err: any) {
    console.warn(`⚠️ [Cleanup] HopkidWebhookLog delete notice: ${err.message}`);
  }

  // Safe fallback for raw "WebhookAuditLog" table if present in DB schema
  try {
    await prisma.$executeRawUnsafe('DELETE FROM "WebhookAuditLog";');
    console.log('✅ [Cleanup] Cleared records from WebhookAuditLog (raw table).');
  } catch {
    // Table may not exist separately from HopkidWebhookLog; ignore gracefully
  }

  // 2. Clear WebhookLog
  try {
    const deletedWebhookLogs = await prisma.webhookLog.deleteMany({});
    console.log(`✅ [Cleanup] Cleared ${deletedWebhookLogs.count} records from WebhookLog.`);
  } catch (err: any) {
    console.warn(`⚠️ [Cleanup] WebhookLog delete notice: ${err.message}`);
  }

  // 3. Deduplicate CommissionTransaction by (billId, employeeId)
  const allCommissionTx = await prisma.commissionTransaction.findMany({
    where: { billId: { not: null } },
    orderBy: { updatedAt: 'desc' },
  });

  const seenCommKeys = new Set<string>();
  const toDeleteCommIds: number[] = [];

  for (const tx of allCommissionTx) {
    if (tx.billId && tx.employeeId) {
      const key = `${tx.billId}_${tx.employeeId}`;
      if (seenCommKeys.has(key)) {
        toDeleteCommIds.push(tx.id);
      } else {
        seenCommKeys.add(key);
      }
    }
  }

  if (toDeleteCommIds.length > 0) {
    const deletedComm = await prisma.commissionTransaction.deleteMany({
      where: { id: { in: toDeleteCommIds } },
    });
    console.log(`✅ [Cleanup] Deleted ${deletedComm.count} duplicate CommissionTransaction records.`);
  } else {
    console.log('✅ [Cleanup] No duplicate CommissionTransaction records found.');
  }

  // 4. Deduplicate Sales records by (billId, employeeId)
  const allSales = await prisma.sales.findMany({
    orderBy: { updatedAt: 'desc' },
  });

  const seenSalesKeys = new Set<string>();
  const toDeleteSalesIds: string[] = [];

  for (const sale of allSales) {
    if (sale.billId && sale.employeeId) {
      const key = `${sale.billId}_${sale.employeeId}`;
      if (seenSalesKeys.has(key)) {
        toDeleteSalesIds.push(sale.id);
      } else {
        seenSalesKeys.add(key);
      }
    }
  }

  if (toDeleteSalesIds.length > 0) {
    const deletedSales = await prisma.sales.deleteMany({
      where: { id: { in: toDeleteSalesIds } },
    });
    console.log(`✅ [Cleanup] Deleted ${deletedSales.count} duplicate Sales records.`);
  } else {
    console.log('✅ [Cleanup] No duplicate Sales records found.');
  }

  console.log('🎉 [Cleanup] Webhook reset and deduplication completed successfully!');
  await prisma.$disconnect();
}

cleanupDuplicates().catch((err) => {
  console.error('❌ [Cleanup Error]:', err);
  prisma.$disconnect();
});
