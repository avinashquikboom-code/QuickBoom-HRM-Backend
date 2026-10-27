import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { normalizePayload } from '../src/hrmCommission/normalize';
import { resolveSubcategory } from '../src/hrmCommission/resolution';
import { calculateInvoiceCommission, invoiceUnitPrice } from '../src/services/invoiceCommissionService';

async function main() {
  const at = new Date('2026-10-01T00:00:00Z');
  const productId = '11111111-1111-4111-8111-111111111111';
  const sub = { id: 'sub', externalId: 'shirts', name: 'Shirts' };
  const policy = { id: 'configured-rate', rate: new Prisma.Decimal('2.75'), type: 'PERCENTAGE', fixedBasis: 'UNIT', basis: 'NET_EX_TAX', isActive: true };
  const tx: any = {
    hrmCommissionSubcategory: { findUnique: async ({where}: any) => where.id === sub.id ? sub : null },
    hrmCommissionMapping: { findFirst: async ({where}: any) => {
      assert.equal(where.effectiveFrom.lte.getTime(), at.getTime());
      return where.productId === productId && where.variantId === 'blue' ? {subcategoryId: sub.id} : null;
    } },
    pOSProduct: { findMany: async () => [{id: productId, name: 'Shirt', category: null}] },
    hrmCommissionRate: { findMany: async () => [policy] },
    hrmCommissionDocument: { findMany: async () => [] },
    hrmCommissionSettings: { findUnique: async () => null },
  };
  // Isolated fixture rates are never written to application configuration.
  const raw = {eventType: 'INVOICE_CREATED', data: {invoice: {invoiceId: '29146', invoiceDate: at.toISOString(), storeId: 1,
    lineItems: [{product_id: '123', variantId: 'blue', subcategoryId: 'unknown-upstream-key', Quantity: 1, netAmountExTax: 499}]}}};
  const doc = normalizePayload(raw, {netField: 'productNetAmount', netBasis: 'UNVERIFIED', discounted: false});
  assert.equal(doc.lines[0].productId, '123');
  assert.equal((await resolveSubcategory(tx, doc.lines[0], at))?.id, sub.id);
  const result = await calculateInvoiceCommission(tx, null, raw, {storeId: 1, at, reference: '29146'});
  assert.equal(result.commissionAmount, 13.72);
  assert.equal(result.commissionRate, 2.75);
  assert.equal(result.hasUnresolvedInvoiceItems, false);
  assert.equal(result.hasMissingConfiguration, false);
  assert.equal(result.rateDisplay, '2.75%');
  assert.equal(policy.rate.toString(), '2.75');
  tx.hrmCommissionDocument.findMany = async () => [{id: 'old-document', status: 'ACTIVE'}];
  tx.hrmCommissionLine = {findMany: async () => [{externalLineId: '123:blue', productId: '123', variantId: 'blue',
    quantity: new Prisma.Decimal(1), basis: 'NET_EX_TAX', eligibleRevenue: new Prisma.Decimal(100)}]};
  const updated = await calculateInvoiceCommission(tx, null, raw, {storeId: 1, at, reference: '29146'});
  assert.equal(updated.commissionAmount, 13.72, 'an earlier projection cannot override updated invoice amounts');
  tx.hrmCommissionDocument.findMany = async () => [];
  const noAmount = JSON.parse(JSON.stringify(raw));
  delete noAmount.data.invoice.lineItems[0].netAmountExTax;
  const incomplete = await calculateInvoiceCommission(tx, null, noAmount, {storeId: 1, at, reference: '29146'});
  assert.equal(incomplete.commissionAmount, null);
  assert.equal(incomplete.hasMissingInvoiceData, true);
  policy.type = 'FIXED'; policy.fixedBasis = 'LINE';
  const fixed = await calculateInvoiceCommission(tx, null, raw, {storeId: 1, at, reference: '29146'});
  assert.equal(fixed.rateDisplay, '₹2.75 / line');
  assert.equal(fixed.commissionAmount, 2.75);
  policy.isActive = false;
  const missing = await calculateInvoiceCommission(tx, null, raw, {storeId: 1, at, reference: '29146'});
  assert.equal(missing.commissionAmount, null);
  assert.equal(missing.hasMissingConfiguration, true);
  assert.equal(invoiceUnitPrice({productNetAmount: 499, quantity: 1}), 499);
  assert.equal(invoiceUnitPrice({saleAmount: 499, quantity: 2}), 249.5);
  assert.equal(invoiceUnitPrice({unitPrice: 0, productNetAmount: 499, quantity: 1}), 499);
  assert.equal(invoiceUnitPrice({quantity: 1}), null);
  assert.equal(invoiceUnitPrice({saleAmount: 499, quantity: 0}), null);
  tx.pOSProduct.findMany = async () => [{id: productId}, {id: 'other'}];
  assert.equal(await resolveSubcategory(tx, doc.lines[0], at), null);
  console.log('PASS exact external product/variant mapping, configured calculation, fixed display, missing policy, ambiguous catalog and verified unit prices');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
