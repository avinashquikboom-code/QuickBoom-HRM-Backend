import { Prisma } from '@prisma/client';
import { NormalizedLine, requireValue } from './normalize';

/** Resolve recorded external IDs or administrator mappings as of the sale date.
 * Reads must never invent catalog identities, rates, or historical effective dates.
 */
export async function resolveSubcategory(tx: Prisma.TransactionClient, line: NormalizedLine, at: Date) {
  if (line.subcategoryExternalId) {
    return tx.hrmCommissionSubcategory.findUnique({ where: { externalId: line.subcategoryExternalId } });
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

  // Fallback: Check POSProduct catalog category if line.productId is a valid UUID
  if (line.productId) {
    const product = await tx.pOSProduct.findUnique({
      where: { id: line.productId },
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
