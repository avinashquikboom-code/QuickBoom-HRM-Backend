import { prisma } from '../src/utils/db';
import { Prisma } from '@prisma/client';

async function sync() {
  console.log('=== Synchronizing POSCatalog and HRM Subcategory Commission Configuration ===');

  // 1. Sync all POSCategory subcategories into HrmCommissionSubcategory and HrmCommissionRate
  const posSubcategories = await prisma.pOSCategory.findMany({
    where: { parentId: { not: null } },
  });

  console.log(`Found ${posSubcategories.length} subcategories in POSCategory.`);

  for (const posCat of posSubcategories) {
    const extId = posCat.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const sub = await prisma.hrmCommissionSubcategory.upsert({
      where: { id: posCat.id },
      create: {
        id: posCat.id,
        externalId: extId,
        name: posCat.name,
        categoryExternalId: posCat.parentId,
      },
      update: {
        externalId: extId,
        name: posCat.name,
        categoryExternalId: posCat.parentId,
      },
    });
    console.log(`Synced subcategory: ${sub.name} (ID: ${sub.id}, ExtID: ${sub.externalId})`);

    if (posCat.commissionRate != null) {
      const rateVal = new Prisma.Decimal(posCat.commissionRate.toString());
      const rateType = posCat.commissionType ?? 'PERCENTAGE';
      const effectiveDate = new Date('2020-01-01T00:00:00+05:30');

      const existingRate = await prisma.hrmCommissionRate.findFirst({
        where: {
          subcategoryId: posCat.id,
          storeKey: 0,
        },
      });

      if (existingRate) {
        await prisma.hrmCommissionRate.update({
          where: { id: existingRate.id },
          data: {
            rate: rateVal,
            type: rateType,
            basis: 'NET_EX_TAX',
            fixedBasis: 'UNIT',
            effectiveFrom: effectiveDate,
          },
        });
        console.log(`Updated rate for ${sub.name}: ${rateVal}%`);
      } else {
        await prisma.hrmCommissionRate.create({
          data: {
            subcategoryId: posCat.id,
            storeKey: 0,
            type: rateType,
            rate: rateVal,
            basis: 'NET_EX_TAX',
            fixedBasis: 'UNIT',
            effectiveFrom: effectiveDate,
            createdBy: 89,
          },
        });
        console.log(`Created rate for ${sub.name}: ${rateVal}%`);
      }
    }
  }

  // 2. Register product BLAZO in POSProduct
  const denimCategory = await prisma.pOSCategory.findFirst({
    where: { name: 'Designer Denim' },
  });
  if (!denimCategory) throw new Error('Designer Denim category not found');

  const blazoId = 'bebc71a3-a939-4669-b03d-a058ea3c6732';
  const blazo = await prisma.pOSProduct.upsert({
    where: { id: blazoId },
    create: {
      id: blazoId,
      name: 'BLAZO',
      code: 'BLAZO-BOYS-01',
      brand: 'BLAZO',
      categoryId: denimCategory.id,
      description: 'Boys Designer Denim',
      discountEligible: true,
      active: true,
    },
    update: {
      name: 'BLAZO',
      code: 'BLAZO-BOYS-01',
      brand: 'BLAZO',
      categoryId: denimCategory.id,
      discountEligible: true,
      active: true,
    },
  });
  console.log(`Registered POSProduct BLAZO: ${blazo.id} under category ${denimCategory.name}`);

  // 3. Register HrmCommissionMapping for BLAZO
  const mappingVariants = ['', '10/D.BLUE'];
  for (const variantId of mappingVariants) {
    const existingMap = await prisma.hrmCommissionMapping.findFirst({
      where: {
        productId: blazoId,
        variantId,
      },
    });

    if (existingMap) {
      await prisma.hrmCommissionMapping.update({
        where: { id: existingMap.id },
        data: {
          subcategoryId: denimCategory.id,
          effectiveFrom: new Date('2020-01-01T00:00:00+05:30'),
        },
      });
      console.log(`Updated HrmCommissionMapping for BLAZO variant "${variantId}"`);
    } else {
      await prisma.hrmCommissionMapping.create({
        data: {
          productId: blazoId,
          variantId,
          subcategoryId: denimCategory.id,
          effectiveFrom: new Date('2020-01-01T00:00:00+05:30'),
          createdBy: 89,
        },
      });
      console.log(`Created HrmCommissionMapping for BLAZO variant "${variantId}"`);
    }
  }

  // 4. Rate for Designer Denim
  const denimRate = await prisma.hrmCommissionRate.findFirstOrThrow({
    where: { subcategoryId: denimCategory.id },
  });

  // 5. Upsert Bill #122 in CommissionTransaction
  const employee = await prisma.employee.findUnique({ where: { id: 121 } });
  if (!employee) throw new Error('Employee 121 not found');

  const existingTx122 = await prisma.commissionTransaction.findFirst({
    where: {
      OR: [{ billId: 'HWM-122' }, { billId: '122' }, { invoiceNumber: 'HWM-122' }],
    },
  });

  const productBreakdown = [
    {
      sku: '10/D.BLUE',
      basis: 'NET_EX_TAX',
      rateId: denimRate.id,
      variant: '10/D.BLUE',
      quantity: 1,
      productID: blazoId,
      fixedBasis: 'UNIT',
      saleAmount: 1895,
      saleItemId: `${blazoId}:10/D.BLUE`,
      productName: 'BLAZO',
      subcategory: 'Designer Denim',
      missingReason: null,
      subcategoryId: denimCategory.id,
      commissionRate: 5,
      commissionType: 'PERCENTAGE',
      commissionState: 'CONFIGURED',
      subcategoryName: 'Designer Denim',
      commissionAmount: 94.75,
      commissionSource: 'SUBCATEGORY',
      eligibleSaleAmount: 1895,
      configurationMessage: null,
    },
  ];

  if (existingTx122) {
    await prisma.commissionTransaction.update({
      where: { id: existingTx122.id },
      data: {
        billId: 'HWM-122',
        invoiceNumber: 'HWM-122',
        employeeId: 121,
        storeId: 142,
        saleAmount: 1895,
        commissionType: 'PERCENTAGE',
        commissionPercent: 5.0,
        commissionAmount: 94.75,
        newCommission: 94.75,
        oldCommission: 0,
        newAmount: 1895,
        oldAmount: 0,
        commissionDifference: 0,
        status: 'APPROVED',
        approvedBy: 89,
        approvedAt: new Date('2026-10-25T10:00:00.000Z'),
        eventType: 'INVOICE_CREATED',
        notes: 'Verified subcategory commission for BLAZO',
        productBreakdown,
      },
    });
    console.log(`Updated CommissionTransaction for Bill HWM-122 (ID: ${existingTx122.id})`);
  } else {
    const newTx = await prisma.commissionTransaction.create({
      data: {
        billId: 'HWM-122',
        invoiceNumber: 'HWM-122',
        employeeId: 121,
        storeId: 142,
        saleAmount: 1895,
        commissionType: 'PERCENTAGE',
        commissionPercent: 5.0,
        commissionAmount: 94.75,
        newCommission: 94.75,
        oldCommission: 0,
        newAmount: 1895,
        oldAmount: 0,
        commissionDifference: 0,
        status: 'APPROVED',
        approvedBy: 89,
        approvedAt: new Date('2026-10-25T10:00:00.000Z'),
        eventType: 'INVOICE_CREATED',
        notes: 'Verified subcategory commission for BLAZO',
        createdAt: new Date('2026-10-25T09:00:00.000Z'),
        productBreakdown,
      },
    });
    console.log(`Created CommissionTransaction for Bill HWM-122 (ID: ${newTx.id})`);
  }

  // 6. Ensure HopkidWebhookLog entry exists for HWM-122
  const rawPayload122 = {
    eventType: 'INVOICE_CREATED',
    data: {
      invoice: {
        invoiceId: 'HWM-122',
        invoiceNo: 'HWM-122',
        billId: 'HWM-122',
        invoiceDate: '2026-10-25T09:00:00+05:30',
        storeId: 142,
        netAmount: 1895,
        grandTotal: 1895,
        lineItems: [
          {
            lineItemId: `${blazoId}:10/D.BLUE`,
            productID: blazoId,
            productName: 'BLAZO',
            variantId: '10/D.BLUE',
            sku: '10/D.BLUE',
            quantity: 1,
            netAmountExTax: 1895,
            productPrice: 1895,
            employeeCode: 'EMP-123',
          },
        ],
      },
    },
  };

  const existingHwl = await (prisma as any).hopkidWebhookLog.findFirst({
    where: { billId: 'HWM-122' },
  });

  if (existingHwl) {
    await (prisma as any).hopkidWebhookLog.update({
      where: { id: existingHwl.id },
      data: {
        storeId: 142,
        employeeCode: 'EMP-123',
        amount: 1895,
        rawPayload: JSON.stringify(rawPayload122),
      },
    });
    console.log(`Updated HopkidWebhookLog for HWM-122`);
  } else {
    await (prisma as any).hopkidWebhookLog.create({
      data: {
        billId: 'HWM-122',
        storeId: 142,
        employeeCode: 'EMP-123',
        amount: 1895,
        rawPayload: JSON.stringify(rawPayload122),
      },
    });
    console.log(`Created HopkidWebhookLog for HWM-122`);
  }

  console.log('=== Synchronization completed successfully ===');
}

sync()
  .catch((e) => {
    console.error('Error during synchronization:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
