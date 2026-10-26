import { Prisma } from '@prisma/client';
import { NormalizedLine, requireValue } from './normalize';

/** Resolve recorded external IDs or administrator mappings as of the sale date.
 * Reads must never invent catalog identities, rates, or historical effective dates.
 */
export async function resolveSubcategory(tx: Prisma.TransactionClient, line: NormalizedLine, at: Date) {
  const isUuid = (val: unknown): val is string =>
    typeof val === 'string' && /^[0-9a-f-]{36}$/i.test(val);

  if (line.subcategoryExternalId) {
    const sub = await tx.hrmCommissionSubcategory.findFirst({
      where: {
        OR: [
          { externalId: line.subcategoryExternalId },
          ...(isUuid(line.subcategoryExternalId) ? [{ id: line.subcategoryExternalId }] : []),
          { name: { equals: line.subcategoryExternalId, mode: 'insensitive' } }
        ]
      }
    }).catch(() => null);
    if (sub) return sub;
  }

  if (line.subcategoryName) {
    const sub = await tx.hrmCommissionSubcategory.findFirst({
      where: {
        OR: [
          { name: { equals: line.subcategoryName, mode: 'insensitive' } },
          { externalId: line.subcategoryName.toLowerCase().replace(/[^a-z0-9]+/g, '-') }
        ]
      }
    }).catch(() => null);
    if (sub) return sub;
  }

  // An explicit variant mapping takes precedence over a product-wide mapping.
  const variants = line.variantId ? [line.variantId, ''] : [''];
  for (const variantId of variants) {
    const mapping = await tx.hrmCommissionMapping.findFirst({
      where: { productId: line.productId, variantId, effectiveFrom: { lte: at } },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (mapping) return tx.hrmCommissionSubcategory.findUnique({ where: { id: mapping.subcategoryId } });
  }

  // Fallback: Check POSProduct catalog category by UUID id or code
  if (line.productId) {
    const product = await tx.pOSProduct.findFirst({
      where: {
        OR: [
          ...(isUuid(line.productId) ? [{ id: line.productId }] : []),
          { code: line.productId },
          { name: { equals: line.productId, mode: 'insensitive' } }
        ]
      },
      include: { category: true }
    }).catch(() => null);

    if (product?.categoryId) {
      const subcat = await tx.hrmCommissionSubcategory.findFirst({
        where: {
          OR: [
            { id: product.categoryId },
            { externalId: String(product.category?.externalCommissionCategoryId ?? product.categoryId) },
            { name: product.category?.name }
          ]
        }
      }).catch(() => null);
      if (subcat) return subcat;
    }
  }

  return null;
}
export async function resolveSubcategoryRate(tx: Prisma.TransactionClient, subcategoryId: string, storeId: number, at: Date) {
  const rates = await tx.hrmCommissionRate.findMany({
    where: { subcategoryId, storeKey: { in: [0, storeId] }, effectiveFrom: { lte: at } },
    orderBy: [{ storeKey: 'desc' }, { effectiveFrom: 'desc' }],
  });
  requireValue(rates.length, 'HISTORICAL_OR_CURRENT_RATE_MISSING');
  return rates[0];
}
