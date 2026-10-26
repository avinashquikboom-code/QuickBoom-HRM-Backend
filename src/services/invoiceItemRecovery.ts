import { Prisma } from '@prisma/client';

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
/** Recover recorded identities and eligible amounts, never unit-price math or saved employee rates. */
export async function recoverSavedInvoiceItems(tx: Prisma.TransactionClient, snapshots: any[]) {
  const recovered: any[] = [];
  for (const snapshot of snapshots) {
    const item = { ...snapshot, productID: snapshot.productID ?? snapshot.productId,
      lineItemId: snapshot.saleItemId ?? snapshot.lineItemId ?? snapshot.externalLineId,
      quantity: snapshot.quantity ?? snapshot.qty,
      variantId: snapshot.variantId ?? snapshot.sku ?? '' };
    if (snapshot.subcategoryExternalId != null) item.subcategoryId = snapshot.subcategoryExternalId;
    else if (uuid(snapshot.subcategoryId)) {
      // New snapshots store HRM UUIDs; incoming Hopkid lines use external IDs.
      const subcategory = await tx.hrmCommissionSubcategory.findUnique({ where: { id: snapshot.subcategoryId } });
      if (subcategory) {
        item.subcategoryId = subcategory.externalId;
        if (!item.subcategoryName) item.subcategoryName = subcategory.name;
      } else {
        const posCat = await tx.pOSCategory.findUnique({ where: { id: snapshot.subcategoryId } }).catch(() => null);
        if (posCat) {
          item.subcategoryId = posCat.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
          if (!item.subcategoryName) item.subcategoryName = posCat.name;
        }
      }
    } else if (item.productID) {
      // Saved snapshot was persisted with null subcategoryId: resolve via product mapping
      let mapping = await tx.hrmCommissionMapping.findFirst({
        where: {
          productId: item.productID,
          variantId: { in: [item.variantId, ''] }
        },
        orderBy: [{ variantId: 'desc' }, { effectiveFrom: 'desc' }]
      });
      if (!mapping && !uuid(item.productID)) {
        const prod = await tx.pOSProduct.findFirst({
          where: { OR: [{ code: item.productID }, { name: item.productID }] }
        }).catch(() => null);
        if (prod) {
          mapping = await tx.hrmCommissionMapping.findFirst({
            where: {
              productId: prod.id,
              variantId: { in: [item.variantId, ''] }
            },
            orderBy: [{ variantId: 'desc' }, { effectiveFrom: 'desc' }]
          });
        }
      }
      if (mapping) {
        const sub = await tx.hrmCommissionSubcategory.findUnique({ where: { id: mapping.subcategoryId } });
        if (sub) {
          item.subcategoryId = sub.externalId;
          item.subcategoryName = sub.name;
        }
      } else {
        const prod = uuid(item.productID)
          ? await tx.pOSProduct.findUnique({
              where: { id: item.productID },
              include: { category: true }
            }).catch(() => null)
          : await tx.pOSProduct.findFirst({
              where: { OR: [{ code: item.productID }, { name: item.productID }] },
              include: { category: true }
            }).catch(() => null);
        if (prod?.categoryId && prod.category && prod.category.parentId) {
          item.subcategoryId = prod.category.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
          item.subcategoryName = prod.category.name;
        }
      }
    }
    let basis = snapshot.basis;
    if (!basis && uuid(snapshot.rateId)) {
      const policy = await tx.hrmCommissionRate.findUnique({ where: { id: snapshot.rateId } });
      if (policy) basis = policy.basis;
    }
    if (!basis && (snapshot.eligibleSaleAmount != null || snapshot.eligibleRevenue != null)) {
      if (item.subcategoryId) {
        const sub = await tx.hrmCommissionSubcategory.findFirst({
          where: {
            OR: [
              { externalId: item.subcategoryId },
              ...(uuid(item.subcategoryId) ? [{ id: item.subcategoryId }] : [])
            ]
          }
        });
        if (sub) {
          const rate = await tx.hrmCommissionRate.findFirst({ where: { subcategoryId: sub.id } });
          if (rate) basis = rate.basis;
        }
      }
      if (!basis) basis = 'NET_EX_TAX';
    }
    const eligible = snapshot.eligibleSaleAmount ?? snapshot.eligibleRevenue ?? snapshot.saleAmount ?? snapshot.productNetAmount;
    if (eligible != null && basis === 'NET_EX_TAX') item.netAmountExTax = eligible;
    if (eligible != null && basis === 'NET_INCL_TAX') item.netAmountInclTax = eligible;
    // Without a recorded basis, the existing verified source contract still governs generic amounts.
    // Do not relabel arbitrary saleAmount/price as a verified tax-exclusive amount.
    delete item.commissionRate;
    delete item.commissionAmount;
    delete item.commissionPercent;
    delete item.commissionPercentage;
    recovered.push(item);
  }
  return recovered;
}
