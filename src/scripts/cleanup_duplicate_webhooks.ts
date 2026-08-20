import { prisma } from '../utils/db';
import { extractWebhookMeta, normalizeEventType } from '../utils/commissionHelper';
import { computePayloadHash } from '../utils/webhookIdempotency';

async function cleanupDuplicates() {
  console.log('🧹 [Cleanup] Starting Webhook Audit Log & Sales Deduplication...');

  // 1. Deduplicate WebhookLogs
  const allWebhookLogs = await prisma.webhookLog.findMany({
    orderBy: { createdAt: 'desc' },
  });

  const seenKeys = new Set<string>();
  const toDeleteWebhookLogIds: string[] = [];

  for (const log of allWebhookLogs) {
    const meta = extractWebhookMeta(log.payload);
    const eventType = normalizeEventType(log.eventType || meta.eventType);
    const billId = log.billId || meta.billId || 'NO_BILL';
    const eventId = meta.eventId || null;
    const hash = computePayloadHash(log.payload);

    const dedupKey = eventId
      ? `${eventType}_EVT_${eventId}`
      : `${eventType}_BILL_${billId}_${hash}`;

    if (seenKeys.has(dedupKey)) {
      toDeleteWebhookLogIds.push(log.id);
    } else {
      seenKeys.add(dedupKey);
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

  // 2. Deduplicate Sales records (keeping newest/canonical per billId)
  const allSales = await prisma.sales.findMany({
    orderBy: { createdAt: 'desc' },
  });

  const seenSalesBills = new Set<string>();
  const toDeleteSalesIds: string[] = [];

  for (const sale of allSales) {
    if (seenSalesBills.has(sale.billId)) {
      toDeleteSalesIds.push(sale.id);
    } else {
      seenSalesBills.add(sale.billId);
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
