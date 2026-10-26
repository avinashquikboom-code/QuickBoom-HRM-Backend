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
const { mobileInvoiceDetail, calculateInvoiceCommission } = require('../src/services/invoiceCommissionService');
const { recordedInvoiceCommission } = require('../src/services/recordedInvoiceCommission');
const fixture = (extra = {}) => ({ id: 51, employeeId: 7, storeId: 2, billId: '11885', invoiceNumber: 'HWM-11885', saleAmount: 999, commissionAmount: 9.99, commissionPercent: 1, commissionType: 'PERCENTAGE', status: 'APPROVED', eventType: 'INVOICE_CREATED', productBreakdown: [], createdAt: new Date('2026-10-26T00:00:00Z'), ...extra });
(async () => {
  for (const productBreakdown of [[], [{ productID: 'recorded-product', saleAmount: 999, quantity: 1, commissionRate: 0, commissionAmount: 0 }]]) {
    sales = [fixture({ productBreakdown })];
    const detail = await mobileInvoiceDetail(9, '11885', 'EMPLOYEE');
    for (const key of ['commissionAmount', 'commissionEarned', 'commission', 'totalCommission', 'newCommission', 'recordedCommissionAmount']) assert.equal(detail[key], 9.99, key);
    assert.equal(detail.saleAmount, 999); assert.equal(detail.grossSale, 999);
    assert.equal(detail.status, 'APPROVED'); assert.equal(detail.rateDisplay, 'Recorded 1%');
    assert.equal(detail.commissionAmount, recordedInvoiceCommission(sales[0]).commissionEarned);
    assert(detail.productCommissionBreakdown.every(l => l.commissionAmount === null));
    assert.equal(detail.itemCommissionState, 'UNRESOLVED');
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
