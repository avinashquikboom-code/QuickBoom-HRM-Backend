import { prisma } from '../src/utils/db';

async function main() {
  console.log('--- Checking POSSale via queryRaw ---');
  const posSales: any[] = await prisma.$queryRaw`
    SELECT * FROM "POSSale" WHERE "invoiceNo" ILIKE '%122%'
  `;
  console.log('POSSale matches:', JSON.stringify(posSales, null, 2));

  if (posSales.length > 0) {
    const saleId = posSales[0].id;
    const items: any[] = await prisma.$queryRaw`
      SELECT * FROM "POSSaleItem" WHERE "saleId"::text = ${saleId}
    `;
    console.log('POSSaleItem matches:', JSON.stringify(items, null, 2));

    const payments: any[] = await prisma.$queryRaw`
      SELECT * FROM "POSSalePayment" WHERE "saleId"::text = ${saleId}
    `;
    console.log('POSSalePayment matches:', JSON.stringify(payments, null, 2));
  }

  console.log('\n--- Checking POSRetailCommission ---');
  const rc: any[] = await prisma.$queryRaw`
    SELECT * FROM "POSRetailCommission" WHERE "invoiceNumber" ILIKE '%122%'
  `;
  console.log('POSRetailCommission matches:', JSON.stringify(rc, null, 2));

  console.log('\n--- Checking POSProduct / POSProductVariant / POSCategory for BLAZO or bebc71a3 ---');
  const products: any[] = await prisma.$queryRaw`
    SELECT * FROM "POSProduct" WHERE "id"::text = 'bebc71a3-a939-4669-b03d-a058ea3c6732' OR "name" ILIKE '%BLAZO%'
  `;
  console.log('POSProduct matches:', JSON.stringify(products, null, 2));

  if (products.length > 0) {
    const categoryId = products[0].categoryId;
    if (categoryId) {
      const category: any[] = await prisma.$queryRaw`
        SELECT * FROM "POSCategory" WHERE "id"::text = ${categoryId}
      `;
      console.log('POSCategory matches:', JSON.stringify(category, null, 2));
    }
    const variants: any[] = await prisma.$queryRaw`
      SELECT * FROM "POSProductVariant" WHERE "productId"::text = ${products[0].id}
    `;
    console.log('POSProductVariant matches:', JSON.stringify(variants, null, 2));
  }

  console.log('\n--- Checking WebhookLog and CommissionTransaction for HWM-122 ---');
  const ct: any[] = await prisma.$queryRaw`
    SELECT * FROM "CommissionTransaction" WHERE "billId" ILIKE '%122%' OR "invoiceNumber" ILIKE '%122%'
  `;
  console.log('CommissionTransaction:', JSON.stringify(ct, null, 2));

  const wl: any[] = await prisma.$queryRaw`
    SELECT id, "billId", "eventType", "createdAt", LEFT(payload, 500) as payload_sample FROM "WebhookLog" WHERE "billId" ILIKE '%122%' OR payload ILIKE '%122%'
  `;
  console.log('WebhookLog:', JSON.stringify(wl, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
