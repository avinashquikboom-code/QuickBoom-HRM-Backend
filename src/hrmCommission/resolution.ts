import { Prisma } from '@prisma/client';
import { NormalizedLine, requireValue } from './normalize';

/** Exact external subcategory or effective-dated catalog mapping; never employee/category fallback. */
export async function resolveSubcategory(tx: Prisma.TransactionClient, line: NormalizedLine, at: Date) {
  if (line.subcategoryExternalId) return tx.hrmCommissionSubcategory.findUnique({ where: { externalId: line.subcategoryExternalId } });
  const mapping = await tx.hrmCommissionMapping.findFirst({ where: { productId: line.productId, variantId: line.variantId, effectiveFrom: { lte: at } }, orderBy: { effectiveFrom: 'desc' } });
  return mapping ? tx.hrmCommissionSubcategory.findUnique({ where: { id: mapping.subcategoryId } }) : null;
}
export async function resolveSubcategoryRate(tx: Prisma.TransactionClient, subcategoryId: string, storeId: number, at: Date) {
  const rates = await tx.hrmCommissionRate.findMany({ where: { subcategoryId, storeKey: { in: [0, storeId] }, effectiveFrom: { lte: at } }, orderBy: [{ storeKey: 'desc' }, { effectiveFrom: 'desc' }] });
  requireValue(rates.length, 'HISTORICAL_OR_CURRENT_RATE_MISSING');
  return rates[0];
}
