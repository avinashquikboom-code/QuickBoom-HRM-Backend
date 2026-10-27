import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { normalizePayload } from '../src/hrmCommission/normalize';
import { resolveSubcategory, resolveSubcategoryRate } from '../src/hrmCommission/resolution';
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
  const variantId='22222222-2222-4222-8222-222222222222';
  tx.pOSProduct.findMany=async()=>[{id:productId,name:'Shirt',category:null}];
  tx.pOSProductVariant={findMany:async ({where}:any)=>{
    assert.equal(where.productId,productId,'variant identity must be scoped to its exact catalog product');
    return [{id:variantId,sku:'blue',barcode:'blue-barcode'}];
  }};
  tx.hrmCommissionMapping.findFirst=async({where}:any)=>where.productId===productId&&where.variantId===variantId
    ? {subcategoryId:sub.id}:where.variantId===''?{subcategoryId:'generic'}:null;
  const lookup=tx.hrmCommissionSubcategory.findUnique;
  tx.hrmCommissionSubcategory.findUnique=async(query:any)=>query.where.id==='generic'?{id:'generic'}:lookup(query);
  assert.equal((await resolveSubcategory(tx,doc.lines[0],at))?.id,sub.id,'verified variant rate precedes product-wide rate');
  tx.pOSProductVariant.findMany=async()=>[{id:variantId,sku:'blue',barcode:'x'},{id:productId,sku:'x',barcode:'blue'}];
  await assert.rejects(resolveSubcategory(tx,doc.lines[0],at),/PRODUCT_VARIANT_AMBIGUOUS/);
  tx.pOSProductVariant.findMany=async()=>[];
  tx.hrmCommissionMapping.findFirst=async()=>null;
  tx.pOSProduct.findMany=async()=>[{id:productId,category:{id:'leaf-subcategory'},createdAt:new Date('2026-01-01'),updatedAt:new Date('2026-01-01')}];
  tx.hrmCommissionSubcategory.findMany=async({where}:any)=>{
    assert.deepEqual(where.externalId.in,['leaf-subcategory']);return [sub];
  };
  assert.equal((await resolveSubcategory(tx,doc.lines[0],at))?.id,sub.id,'exact catalog category links to configured subcategory');
  let rateQueries=0;
  tx.hrmCommissionRate.findMany=async({where}:any)=>{
    rateQueries++;return where.effectiveFrom?[]:[policy];
  };
  await assert.rejects(resolveSubcategoryRate(tx,sub.id,1,at),/HISTORICAL_OR_CURRENT_RATE_MISSING/);
  assert.equal(rateQueries,1,'a missing historical rule must not fall back to a future rate');
  console.log('PASS exact external product/variant mapping, configured calculation, fixed display, missing policy, ambiguous catalog and verified unit prices');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
