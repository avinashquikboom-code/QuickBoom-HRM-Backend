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
