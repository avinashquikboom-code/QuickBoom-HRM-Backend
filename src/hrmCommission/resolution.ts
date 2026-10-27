import { Prisma } from '@prisma/client';
import { NormalizedLine, requireValue } from './normalize';

const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** Resolve only persisted identities. Never equate names/slugs with catalog keys. */
export async function resolveSubcategory(tx: Prisma.TransactionClient, line: NormalizedLine, at: Date) {
  if (line.subcategoryExternalId) {
    const supplied = await tx.hrmCommissionSubcategory.findUnique({ where: { externalId: line.subcategoryExternalId } });
    if (supplied) return supplied;
    // An upstream category key may be unknown locally; persisted product mappings still apply.
  }
  for (const variantId of line.variantId ? [line.variantId, ''] : ['']) {
    const mapping = await tx.hrmCommissionMapping.findFirst({
      where: { productId: line.productId, variantId, effectiveFrom: { lte: at } },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (mapping) return tx.hrmCommissionSubcategory.findUnique({ where: { id: mapping.subcategoryId } });
  }
  // ERP product IDs and POS UUIDs identify the same persisted product. Resolve the
  // external key exactly; never use a product name or fuzzy SKU match.
  const externalId = /^\d+$/.test(line.productId) ? Number(line.productId) : null;
  if (!uuid(line.productId) && (!Number.isSafeInteger(externalId) || externalId! > 2147483647)) return null;
  const candidates = !uuid(line.productId) ? await tx.pOSProduct.findMany({
    where: { externalCommissionProductId: externalId! }, include: { category: true }, take: 2,
  }) : [];
  if (!uuid(line.productId) && candidates.length !== 1) return null;
  const catalogProduct = candidates[0];
  if (catalogProduct) {
    for (const variantId of line.variantId ? [line.variantId, ''] : ['']) {
      const mapping = await tx.hrmCommissionMapping.findFirst({
        where: { productId: catalogProduct.id, variantId, effectiveFrom: { lte: at } },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (mapping) return tx.hrmCommissionSubcategory.findUnique({ where: { id: mapping.subcategoryId } });
    }
  }
  // A current catalog association cannot establish an earlier historical association.
  // Historical corrections use an audited effective-dated HRM mapping instead.
  const product = catalogProduct ?? await tx.pOSProduct.findUnique({ where: { id: line.productId }, include: { category: true } });
  if (!product?.category || product.updatedAt > at || product.createdAt > at) return null;
  const keys = [product.category.id, ...(product.category.externalCommissionCategoryId == null ? [] : [String(product.category.externalCommissionCategoryId)])];
  const matches = await tx.hrmCommissionSubcategory.findMany({ where: { externalId: { in: keys } } });
  // Conflicting catalog identities require administrator reconciliation.
  return matches.length === 1 ? matches[0] : null;
}
export async function resolveSubcategoryRate(tx: Prisma.TransactionClient, subcategoryId: string, storeId: number, at: Date) {
  const rates = await tx.hrmCommissionRate.findMany({
    where: { subcategoryId, storeKey: { in: [0, storeId] }, effectiveFrom: { lte: at } },
    orderBy: [{ storeKey: 'desc' }, { effectiveFrom: 'desc' }],
  });
  requireValue(rates.length, 'HISTORICAL_OR_CURRENT_RATE_MISSING');
  // A disabled latest version must not revive an older/global rate.
  requireValue(rates[0].isActive, 'SUBCATEGORY_RATE_INACTIVE');
  return rates[0];
}
