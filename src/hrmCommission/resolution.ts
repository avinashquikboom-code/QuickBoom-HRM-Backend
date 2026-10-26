import { Prisma } from '@prisma/client';
import { NormalizedLine, requireValue } from './normalize';

const isUuid = (val: unknown): val is string => typeof val === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

/** Exact external subcategory or effective-dated HRM/POS catalog mapping. */
export async function resolveSubcategory(tx: Prisma.TransactionClient, line: NormalizedLine, at: Date) {
  if (line.subcategoryExternalId) {
    const directSub = await tx.hrmCommissionSubcategory.findFirst({
      where: {
        OR: [
          { externalId: line.subcategoryExternalId },
          ...(isUuid(line.subcategoryExternalId) ? [{ id: line.subcategoryExternalId }] : []),
          { name: line.subcategoryExternalId }
        ]
      }
    });
    if (directSub) return directSub;

    // Check POSCategory by id or name
    const posCat = await tx.pOSCategory.findFirst({
      where: {
        OR: [
          ...(isUuid(line.subcategoryExternalId) ? [{ id: line.subcategoryExternalId }] : []),
          { name: line.subcategoryExternalId }
        ],
        parentId: { not: null }
      }
    }).catch(() => null);

    if (posCat) {
      const extId = posCat.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      return await tx.hrmCommissionSubcategory.upsert({
        where: { externalId: extId },
        create: {
          id: posCat.id,
          externalId: extId,
          name: posCat.name,
          categoryExternalId: posCat.parentId
        },
        update: { name: posCat.name, categoryExternalId: posCat.parentId }
      });
    }
  }

  // 2. Query HrmCommissionMapping with variant-specific precedence, falling back to product-level ('')
  const mapping = await tx.hrmCommissionMapping.findFirst({
    where: {
      productId: line.productId,
      variantId: { in: [line.variantId, ''] },
      effectiveFrom: { lte: at }
    },
    orderBy: [
      { variantId: 'desc' },
      { effectiveFrom: 'desc' }
    ]
  });

  if (mapping) {
    const sub = await tx.hrmCommissionSubcategory.findUnique({ where: { id: mapping.subcategoryId } });
    if (sub) return sub;
  }

  // 3. Query POSProduct catalog relationship if productId exists in POSProduct
  const product = isUuid(line.productId)
    ? await tx.pOSProduct.findUnique({
        where: { id: line.productId },
        include: { category: true }
      }).catch(() => null)
    : null;

  if (product?.categoryId && product.category && product.category.parentId) {
    const posCat = product.category;
    const extId = posCat.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return await tx.hrmCommissionSubcategory.upsert({
      where: { externalId: extId },
      create: {
        id: posCat.id,
        externalId: extId,
        name: posCat.name,
        categoryExternalId: posCat.parentId
      },
      update: { name: posCat.name, categoryExternalId: posCat.parentId }
    });
  }

  return null;
}

export async function resolveSubcategoryRate(tx: Prisma.TransactionClient, subcategoryId: string, storeId: number, at: Date) {
  if (isUuid(subcategoryId)) {
    const rates = await tx.hrmCommissionRate.findMany({
      where: {
        subcategoryId,
        storeKey: { in: [0, storeId] },
        effectiveFrom: { lte: at }
      },
      orderBy: [
        { storeKey: 'desc' },
        { effectiveFrom: 'desc' }
      ]
    });
    if (rates.length) return rates[0];
  }

  // Check if subcategoryId or subcategory name exists in POSCategory
  const sub = isUuid(subcategoryId)
    ? await tx.hrmCommissionSubcategory.findUnique({ where: { id: subcategoryId } }).catch(() => null)
    : await tx.hrmCommissionSubcategory.findUnique({ where: { externalId: subcategoryId } }).catch(() => null);

  const posCat = await tx.pOSCategory.findFirst({
    where: {
      OR: [
        ...(isUuid(subcategoryId) ? [{ id: subcategoryId }] : []),
        ...(sub ? [{ name: sub.name }] : [])
      ]
    }
  }).catch(() => null);

  if (posCat?.commissionRate != null) {
    const rateVal = new Prisma.Decimal(posCat.commissionRate.toString());
    const rateType = posCat.commissionType ?? 'PERCENTAGE';
    const effectiveRate = await tx.hrmCommissionRate.upsert({
      where: {
        subcategoryId_storeKey_effectiveFrom: {
          subcategoryId: posCat.id,
          storeKey: 0,
          effectiveFrom: new Date('2020-01-01T00:00:00+05:30')
        }
      },
      create: {
        subcategoryId: posCat.id,
        storeKey: 0,
        type: rateType,
        rate: rateVal,
        basis: 'NET_EX_TAX',
        fixedBasis: 'UNIT',
        effectiveFrom: new Date('2020-01-01T00:00:00+05:30'),
        createdBy: 1
      },
      update: {
        rate: rateVal,
        type: rateType
      }
    });
    return effectiveRate;
  }

  throw new Error('HISTORICAL_OR_CURRENT_RATE_MISSING');
}
