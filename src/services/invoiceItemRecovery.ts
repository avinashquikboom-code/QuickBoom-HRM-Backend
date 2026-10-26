import { Prisma } from '@prisma/client';
import { extractProductLineMeta } from '../utils/productLineMeta';

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const placeholder = (value: unknown) => typeof value !== 'string' || !value.trim() || /^(unknown product|product)$/i.test(value.trim());

/** Display enrichment uses only an exact persisted catalog primary key, never a name/variant guess. */
export async function recoverInvoiceItemIdentities(tx: Prisma.TransactionClient, items: any[]) {
  const ids = [...new Set(items.map(item => extractProductLineMeta(item).productId).filter(uuid))];
  const products = ids.length ? await tx.pOSProduct.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const names = new Map(products.map(product => [product.id, product.name]));
  return items.map(item => {
    const meta = extractProductLineMeta(item);
    const current = meta.productName ?? item.name;
    const name = placeholder(current) && typeof meta.productId === 'string' ? names.get(meta.productId) : current;
    return { ...item, productID: meta.productId, ...(name ? { productName: name } : {}) };
  });
}

/** Recover recorded identities and eligible amounts. Mapping/rate resolution remains sale-date aware in the resolver. */
export async function recoverSavedInvoiceItems(tx: Prisma.TransactionClient, snapshots: any[]) {
  const recovered: any[] = [];
  for (const snapshot of snapshots) {
    const item = { ...snapshot, productID: extractProductLineMeta(snapshot).productId,
      lineItemId: snapshot.saleItemId ?? snapshot.lineItemId ?? snapshot.externalLineId,
      quantity: snapshot.quantity ?? snapshot.qty,
      variantId: snapshot.variantId ?? snapshot.sku ?? '' };
    if (snapshot.subcategoryExternalId != null) item.subcategoryId = snapshot.subcategoryExternalId;
    else if (uuid(snapshot.subcategoryId)) {
      // Saved snapshots use internal HRM IDs; payload normalization expects external IDs.
      const subcategory = await tx.hrmCommissionSubcategory.findUnique({ where: { id: snapshot.subcategoryId } });
      if (subcategory) item.subcategoryId = subcategory.externalId;
    }
    let basis = snapshot.basis;
    if (!basis && uuid(snapshot.rateId)) {
      const policy = await tx.hrmCommissionRate.findUnique({ where: { id: snapshot.rateId } });
      if (policy) basis = policy.basis;
    }
    const eligible = snapshot.eligibleSaleAmount ?? snapshot.eligibleRevenue ?? snapshot.saleAmount ?? snapshot.productNetAmount;
    if (eligible != null && basis === 'NET_EX_TAX') item.netAmountExTax = eligible;
    if (eligible != null && basis === 'NET_INCL_TAX') item.netAmountInclTax = eligible;
    // An amount without a saved basis is governed only by the verified source contract.
    delete item.commissionRate;
    delete item.commissionAmount;
    delete item.commissionPercent;
    delete item.commissionPercentage;
    recovered.push(item);
  }
  return recoverInvoiceItemIdentities(tx, recovered);
}
