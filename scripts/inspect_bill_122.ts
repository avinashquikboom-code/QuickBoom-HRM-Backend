import { prisma } from '../src/utils/db';

async function main() {
  console.log('--- Checking CommissionTransaction ---');
  const ct = await prisma.commissionTransaction.findMany({
    where: {
      OR: [
        { billId: { contains: '122' } },
        { invoiceNumber: { contains: '122' } },
        { id: 122 },
      ]
    }
  });
  console.log('CommissionTransaction matches:', ct.length);
  for (const c of ct) {
    console.log(JSON.stringify({
      id: c.id,
      billId: c.billId,
      invoiceNumber: c.invoiceNumber,
      saleAmount: c.saleAmount,
      commissionAmount: c.commissionAmount,
      commissionType: c.commissionType,
      commissionRate: c.commissionRate,
      status: c.status,
      eventType: c.eventType,
      storeId: c.storeId,
      employeeId: c.employeeId,
      productBreakdown: c.productBreakdown,
    }, null, 2));
  }

  console.log('\n--- Checking WebhookLog ---');
  const wl = await prisma.webhookLog.findMany({
    where: {
      OR: [
        { billId: { contains: '122' } },
        { id: { contains: '122' } },
        { payload: { contains: '122' } },
        { payload: { contains: 'bebc71a3-a939-4669-b03d-a058ea3c6732' } },
      ]
    },
    take: 5
  });
  console.log('WebhookLog matches:', wl.length);
  for (const w of wl) {
    console.log('WebhookLog ID:', w.id, 'billId:', w.billId, 'eventType:', w.eventType);
    console.log('Payload sample:', w.payload.substring(0, 500));
  }

  console.log('\n--- Checking HopkidWebhookLog ---');
  const hwl = await (prisma as any).hopkidWebhookLog?.findMany({
    where: {
      OR: [
        { billId: { contains: '122' } },
        { rawPayload: { contains: '122' } },
      ]
    },
    take: 5
  });
  console.log('HopkidWebhookLog matches:', hwl?.length ?? 0);
  for (const h of hwl ?? []) {
    console.log('HopkidWebhookLog ID:', h.id, 'billId:', h.billId);
    console.log('RawPayload sample:', h.rawPayload?.substring(0, 500));
  }

  console.log('\n--- Checking HrmCommissionDocument & Lines ---');
  const docs = await prisma.hrmCommissionDocument.findMany({
    where: {
      OR: [
        { externalId: { contains: '122' } },
        { invoiceNumber: { contains: '122' } },
      ]
    },
    include: { lines: true }
  });
  console.log('HrmCommissionDocument matches:', docs.length);
  for (const d of docs) {
    console.log(JSON.stringify(d, null, 2));
  }

  console.log('\n--- Checking HrmCommissionMapping / Subcategory for BLAZO / bebc71a3-a939-4669-b03d-a058ea3c6732 ---');
  const mappings = await prisma.hrmCommissionMapping.findMany({
    where: {
      OR: [
        { externalProductId: 'bebc71a3-a939-4669-b03d-a058ea3c6732' },
        { externalSubcategoryId: { contains: 'BLAZO', mode: 'insensitive' } },
      ]
    },
    include: { subcategory: { include: { rates: true } } }
  });
  console.log('HrmCommissionMapping matches:', JSON.stringify(mappings, null, 2));

  const allSubcategories = await prisma.hrmCommissionSubcategory.findMany({
    include: { rates: true, mappings: true }
  });
  console.log('All HrmCommissionSubcategories count:', allSubcategories.length);
  for (const s of allSubcategories) {
    console.log('Subcategory:', s.id, s.name, 'Rates:', s.rates.length, 'Mappings:', s.mappings.length);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
