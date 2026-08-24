import { prisma } from '../utils/db';
import { extractWebhookMeta, normalizeEventType } from '../utils/commissionHelper';
import { computePayloadHash } from '../utils/webhookIdempotency';

async function cleanupDuplicates() {
  console.log('🧹 [Cleanup] Starting Webhook Audit Log & Sales Deduplication...');

  // 1. Deduplicate WebhookLogs by eventId
  const allWebhookLogs = await prisma.webhookLog.findMany({
    orderBy: { createdAt: 'desc' },
  });

  const seenEventIds = new Set<string>();
  const toDeleteWebhookLogIds: string[] = [];

  for (const log of allWebhookLogs) {
    if (log.eventId) {
      if (seenEventIds.has(log.eventId)) {
        toDeleteWebhookLogIds.push(log.id);
      } else {
        seenEventIds.add(log.eventId);
      }
    }
  }

  if (toDeleteWebhookLogIds.length > 0) {
    const deleted = await prisma.webhookLog.deleteMany({
      where: { id: { in: toDeleteWebhookLogIds } },
    });
    console.log(`✅ [Cleanup] Deleted ${deleted.count} duplicate WebhookLog records.`);
  } else {
    console.log('✅ [Cleanup] No duplicate WebhookLog records found.');
  }

  // 2. Deduplicate CommissionTransaction by (billId, employeeId)
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

  // 3. Deduplicate Sales records by (billId, employeeId)
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

  console.log('🎉 [Cleanup] Completed successfully!');
  await prisma.$disconnect();
}

cleanupDuplicates().catch((err) => {
  console.error('❌ [Cleanup Error]:', err);
  prisma.$disconnect();
});
