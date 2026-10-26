// Read-only service regressions with isolated records; no real database or external API.
require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
let sales = [], employeeId = 7;
const tx = {
  employee: { findFirst: async () => ({ id: employeeId, userId: 9, firstName: 'Fixture', lastName: 'Seller', storeId: 2, store: { name: 'Test store' } }) },
  commissionTransaction: { findFirst: async ({ where }) => sales.find(s => s.employeeId === where.employeeId && (where.id != null ? s.id === where.id : where.OR.some(clause => Object.entries(clause).some(([key, value]) => value.in.includes(s[key]))))) || null },
  webhookLog: { findMany: async () => [] }, hopkidWebhookLog: { findMany: async () => [] },
  hrmCommissionDocument: { findMany: async () => [] },
  hrmCommissionSettings: { findUnique: async () => null },
};
tx.commissionTransaction.findMany = async ({ where }) => sales.filter(s => s.employeeId === where.employeeId && where.OR.some(clause => Object.entries(clause).some(([key, value]) => value.in.includes(s[key])))).slice(0, 2);
require.cache[require.resolve('../src/utils/db')] = { exports: { prisma: { $transaction: async fn => fn(tx) } } };
tx.commissionTransaction.count = async () => 0;
const { mobileInvoiceDetail, calculateInvoiceCommission } = require('../src/services/invoiceCommissionService');
const { recordedInvoiceCommission } = require('../src/services/recordedInvoiceCommission');
const fixture = (extra = {}) => ({ id: 51, employeeId: 7, storeId: 2, billId: '11885', invoiceNumber: 'HWM-11885', saleAmount: 999, commissionAmount: 9.99, commissionPercent: 1, commissionType: 'PERCENTAGE', status: 'APPROVED', eventType: 'INVOICE_CREATED', productBreakdown: [], createdAt: new Date('2026-10-26T00:00:00Z'), ...extra });
(async () => {
  for (const productBreakdown of [[], [{ productID: 'recorded-product', saleAmount: 999, quantity: 1, commissionRate: 0, commissionAmount: 0 }]]) {
    sales = [fixture({ productBreakdown })];
    const detail = await mobileInvoiceDetail(9, '11885', 'EMPLOYEE');
    for (const key of ['commissionAmount', 'commissionEarned', 'commission', 'totalCommission', 'newCommission', 'recordedCommissionAmount']) assert.equal(detail[key], 9.99, key);
    assert.equal(detail.saleAmount, 999); assert.equal(detail.grossSale, 999);
    assert.equal(detail.status, 'APPROVED'); assert.equal(detail.rateDisplay, productBreakdown.length ? '1%' : 'Recorded 1%');
    assert.equal(detail.commissionAmount, recordedInvoiceCommission(sales[0]).commissionEarned);
    if (productBreakdown.length === 1) {
      assert.equal(detail.productCommissionBreakdown[0].commissionAmount, 9.99);
      assert.equal(detail.productCommissionBreakdown[0].commissionRate, 1);
      assert.equal(detail.itemCommissionState, 'COMPLETE');
    } else {
      assert.equal(detail.itemCommissionState, 'UNRESOLVED');
    }
    assert.equal(detail.calculatedCommissionAmount, null);
  }
  console.log('PASS Bill #11885 fixture preserves recorded 9.99 / invoice 999 with missing or inconsistent item history');
  for (const status of ['APPROVED', 'PAID', 'PENDING']) {
    const line = { productID: 'recorded-product', saleAmount: 999, quantity: 1, commissionRate: 1, commissionAmount: 9.99, commissionState: 'CONFIGURED' };
    sales = [fixture({ status, productBreakdown: [line] })];
    const detail = await mobileInvoiceDetail(9, 'INV-11885', 'EMPLOYEE');
    assert.equal(detail.commissionAmount, 9.99); assert.equal(detail.productCommissionBreakdown[0].commissionAmount, 9.99);
    assert.equal(detail.status, status);
  }
  console.log('PASS approved, paid and verified pending snapshots are not recalculated from current policy');
  sales = [fixture({ commissionAmount: 0, commissionPercent: 0, productBreakdown: [] })];
  assert.equal((await mobileInvoiceDetail(9, '11885', 'EMPLOYEE')).commissionAmount, 0);
  const missing = await calculateInvoiceCommission(tx, fixture({ commissionAmount: null }), null, { storeId: 2, at: new Date(), reference: '11885' });
  assert.equal(missing.commissionAmount, null); assert.equal(missing.commissionState, 'COMMISSION_RECORD_MISSING');
  sales = [fixture({ status: 'PENDING', commissionAmount: 0 })];
  const pending = await mobileInvoiceDetail(9, '11885', 'EMPLOYEE');
  assert.equal(pending.commissionAmount, null); assert.equal(pending.status, 'PENDING');
  console.log('PASS confirmed zero stays zero; approval without a valid amount and incomplete pending records stay explicitly unresolved');
  sales = [fixture({ productBreakdown: [{ productID: 'alias-product', quantity: 1, saleAmount: 999, commissionPercentage: 1, productCommission: 9.99 }] })];
  let aliases = await mobileInvoiceDetail(9, '11885', 'EMPLOYEE');
  assert.equal(aliases.productCommissionBreakdown[0].commissionRate, 1);
  assert.equal(aliases.productCommissionBreakdown[0].commissionAmount, 9.99);
  sales = [fixture({ productBreakdown: [
    { productID: 'one', quantity: 1, saleAmount: 499, commissionRate: 1, commissionAmount: 4.99 },
    { productID: 'two', quantity: 1, saleAmount: 500, commissionRate: 1, commissionAmount: null },
  ] })];
  const partial = await mobileInvoiceDetail(9, '11885', 'EMPLOYEE');
  assert.equal(partial.productCommissionBreakdown[0].commissionAmount, 4.99);
  assert.equal(partial.productCommissionBreakdown[1].commissionRate, 1);
  assert.equal(partial.productCommissionBreakdown[1].commissionAmount, null);
  assert.equal(partial.commissionAmount, 9.99);
  tx.commissionTransaction.count = async () => 1;
  sales = [fixture({ productBreakdown: [{ productID: 'shared', quantity: 1, saleAmount: 999, commissionRate: 0, commissionAmount: 0 }] })];
  const shared = await mobileInvoiceDetail(9, '11885', 'EMPLOYEE');
  assert.equal(shared.productCommissionBreakdown[0].commissionAmount, null);
  tx.commissionTransaction.count = async () => 0;
  console.log('PASS product field aliases, single-product recorded values, partial item rates and shared-invoice allocation guard');
  const variantSnapshot = fixture({ productBreakdown: [
    { productID: 'same-product', variantId: 'blue', quantity: 1, saleAmount: 499, commissionRate: 1, commissionAmount: 4.99 },
    { productID: 'same-product', variantId: 'red', quantity: 1, saleAmount: 500, commissionRate: 1, commissionAmount: 5 },
  ] });
  const variants = await calculateInvoiceCommission(tx, variantSnapshot, { eventType:'INVOICE_CREATED', data:{ invoice:{ lineItems:[
    { productID:'same-product', variantId:'red', productName:'Red product', quantity:1, netAmountExTax:500 },
    { productID:'same-product', variantId:'blue', productName:'Blue product', quantity:1, netAmountExTax:499 },
  ] } } }, { storeId:2, at:new Date(), reference:'11885' });
  assert.deepEqual(variants.productCommissionBreakdown.map(line=>line.productName), ['Red product','Blue product']);
  assert.deepEqual(variants.productCommissionBreakdown.map(line=>line.commissionAmount), [5,4.99]);
  const late = await calculateInvoiceCommission(tx, fixture({approvedAt:new Date('2026-10-25')}), {
    eventType:'INVOICE_CREATED',data:{invoice:{lineItems:[{productID:'changed',employeeCode:'seller',quantity:1,saleAmount:999}]}}
  }, {storeId:2,at:new Date(),reference:'11885',employeeIdentifiers:['seller'],sourceRecordedAt:new Date('2026-10-26')});
  assert.equal(late.itemCommissionState, 'UNRESOLVED');
  assert.equal(late.productCommissionBreakdown[0].commissionAmount, null);
  console.log('PASS repeated products keep variant-specific amounts; post-approval payloads cannot supply invented item history');

  const { Prisma } = require('@prisma/client');
  const cutoff = new Date('2026-10-26T01:00:00Z');
  tx.hrmCommissionDocument.findMany = async ({where}) => { assert.equal(where.storeId, 2); return [{ id: 'doc-11885' }]; };
  tx.hrmCommissionLedger = { findMany: async ({where}) => {
    assert.equal(where.documentId, 'doc-11885'); assert.equal(where.postedAt.lte, cutoff);
    return [
      { lineId: 'one', rate: new Prisma.Decimal(1), type: 'PERCENTAGE', fixedBasis: 'UNIT', snapshot: { productId: 'one', externalLineId: 'one', newQuantity: '1', newRevenue: '500', newCommission: '5' } },
      { lineId: 'two', rate: new Prisma.Decimal(1), type: 'PERCENTAGE', fixedBasis: 'UNIT', snapshot: { productId: 'two', externalLineId: 'two', newQuantity: '1', newRevenue: '499', newCommission: '4.99' } },
    ];
  } };
  sales = [fixture({ approvedAt: cutoff })];
  const ledger = await mobileInvoiceDetail(9, '11885', 'EMPLOYEE');
  assert.equal(ledger.commissionSource, 'APPROVED_LEDGER');
  assert.deepEqual(ledger.productCommissionBreakdown.map(line => line.commissionRate), [1,1]);
  assert.deepEqual(ledger.productCommissionBreakdown.map(line => line.commissionAmount), [5,4.99]);
  assert.equal(ledger.commissionAmount, 9.99); assert.equal(ledger.calculatedCommissionAmount, null);
  tx.hrmCommissionDocument.findMany = async () => [];
  console.log('PASS immutable approved ledger restores multi-product rates and earned amounts without current-policy recalculation');


  sales = [fixture(), fixture({ id: 52, billId: '11886', invoiceNumber: 'HWM-11886', commissionAmount: 25 })];
  assert.equal((await mobileInvoiceDetail(9, '11885', 'EMPLOYEE')).commissionAmount, 9.99);
  assert.equal((await mobileInvoiceDetail(9, '11886', 'EMPLOYEE')).commissionAmount, 25);
  employeeId = 8;
  await assert.rejects(() => mobileInvoiceDetail(10, '11885', 'EMPLOYEE'), e => e.status === 404);
  employeeId = 7;
  sales = [fixture({ id: 11885, billId: '11886', invoiceNumber: 'HWM-11886', commissionAmount: 25 })];
  await assert.rejects(() => mobileInvoiceDetail(9, '11885', 'EMPLOYEE'), e => e.status === 404);
  sales = [fixture(), fixture({ id: 52, billId: 'HWM-11885', invoiceNumber: 'INV-11885' })];
  await assert.rejects(() => mobileInvoiceDetail(9, '11885', 'EMPLOYEE'), e => e.status === 409);
  console.log('PASS employee scoping and invoice identity prevent amounts leaking between bills or matching unrelated transaction IDs');
})().catch(error => { console.error(error); process.exitCode = 1; });
