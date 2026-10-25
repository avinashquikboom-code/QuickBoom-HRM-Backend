import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { prisma } from '../src/utils/db';
import routes from '../src/hrmCommission/routes';
import { processStoredLog, projectStoredHopkidLogs } from '../src/hrmCommission/projection';
import { normalizePayload } from '../src/hrmCommission/normalize';
import { signAccessToken } from '../src/utils/jwt';
let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) { await fn(); console.log(`PASS ${name}`); passed++; }
async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert(['127.0.0.1','localhost'].includes(url.hostname) && url.port === '55439' && url.pathname.includes('hrm_commission_test'), 'Isolated HRM test database required');
  const key = randomUUID();
  const user = await prisma.user.create({ data: { email: `hrm-commission-${key}@test.invalid`, password: 'test', role: 'ADMIN' } });
  const store = await prisma.store.create({ data: { name: `HRM ${key}` } }), otherStore = await prisma.store.create({ data: { name: `Other ${key}` } });
  const a = await prisma.hrmCommissionSubcategory.create({ data: { externalId: `shirts-${key}`, name: `Shirts ${key}`, categoryExternalId: 'clothing' } });
  const b = await prisma.hrmCommissionSubcategory.create({ data: { externalId: `pants-${key}`, name: `Pants ${key}` } });
  const since = new Date('2026-01-01T00:00:00+05:30');
  await prisma.hrmCommissionRate.createMany({ data: [a,b].map((sub,i) => ({ subcategoryId: sub.id, rate: i ? 3 : 5, type: 'PERCENTAGE', basis: 'NET_EX_TAX', fixedBasis: 'UNIT', effectiveFrom: since, createdBy: user.id })) });
  await prisma.hrmCommissionSettings.upsert({ where: { id: 1 }, create: { id: 1, ingestSince: since, enabled: true, netField: 'productNetAmount', netBasis: 'UNVERIFIED', discounted: false, updatedBy: user.id }, update: { enabled: true, ingestSince: since, netBasis: 'UNVERIFIED', discounted: false } });
  const invoice = (id: string, items: any[], extra: any = {}) => ({ eventType: 'invoice.created', data: { invoice: { invoiceId: id, invoiceNo: `INV-${id}`, storeId: store.id, invoiceDate: '2026-01-10', lineItems: items, ...extra } } });
  const item = (id = 'a', sub = a.externalId, amount: any = '1000', quantity = 1) => ({ lineItemId: id, productID: id, quantity, subcategoryId: sub, netAmountExTax: amount, taxAmount: String(Number(amount) * .18) });
  const credit = (id: string, original: string, line: any, extra: any = {}) => ({ eventType: 'credit_note.created', data: { creditNote: { creditNoteNo: id, storeId: store.id, creditDate: '2026-01-11', originalInvoiceId: original, lineItems: [line], ...extra } } });
  const ingest = async (raw: any) => {
    const source = await prisma.hopkidWebhookLog.create({ data: { rawPayload: JSON.stringify(raw) } });
    const result = await processStoredLog(source.id); return { ...result, source };
  };
  const total = async (invoiceId: string) => {
    const doc = await prisma.hrmCommissionDocument.findUniqueOrThrow({ where: { key: `${store.id}:SALE:${invoiceId}` } });
    const lines = await prisma.hrmCommissionLine.findMany({ where: { documentId: doc.id } });
    const ids = lines.map(l => l.id);
    const children = await prisma.hrmCommissionLine.findMany({ where: { originalSaleLineId: { in: ids } } });
    const sum = await prisma.hrmCommissionLedger.aggregate({ where: { lineId: { in: [...ids, ...children.map(l => l.id)] } }, _sum: { commissionAmount: true, eligibleRevenue: true, quantity: true } });
    return { commission: Number(sum._sum.commissionAmount), revenue: Number(sum._sum.eligibleRevenue), quantity: Number(sum._sum.quantity), lines };
  };
  let mixed = randomUUID();
  await test('mixed subcategories calculate 1000 at 5% plus 2000 at 3%, without employees or POS data', async () => {
    const result = await ingest(invoice(mixed, [item(), item('b',b.externalId,'2000',2)])); assert.equal(result.status,'PROCESSED');
    assert.equal((await total(mixed)).commission,110);
    assert.equal(await prisma.commissionTransaction.count({ where: { storeId: store.id } }),0);
    assert.equal(await prisma.pOSSale.count({ where: { storeId: store.id } }),0);
  });
  await test('duplicate deliveries and concurrent replays create one immutable economic event', async () => {
    const raw = invoice(mixed, [item(), item('b',b.externalId,'2000',2)]);
    const first = await ingest(raw); await Promise.all([processStoredLog(first.source.id), ingest(raw), ingest(raw)]);
    const sum = await total(mixed); assert.equal(sum.commission,110);
  });
  await test('POS commission overrides and employee rates are ignored', async () => {
    const id = randomUUID(); await ingest(invoice(id,[{ ...item(), commissionAmount: 9999, commissionRate: 99, employeeCode: 'missing', commissionPercentage: 80 }]));
    assert.equal((await total(id)).commission,50);
  });
  await test('future policy versions never recalculate stored sales or their refunds', async () => {
    await prisma.hrmCommissionRate.create({ data: { subcategoryId: a.id, rate: 99, type: 'PERCENTAGE', basis: 'NET_EX_TAX', fixedBasis: 'UNIT', effectiveFrom: new Date('2026-02-01T00:00:00+05:30'), createdBy: user.id } });
    const id=randomUUID(); await ingest(invoice(id,[item()], { invoiceDate:'2026-02-10' })); assert.equal((await total(id)).commission,990);
    assert.equal((await total(mixed)).commission,110);
  });
  await test('partial refund uses original line and rate, duplicate credit note is harmless', async () => {
    const raw = credit(randomUUID(),mixed,{ lineItemId:'r1', productID:'b', quantity:1, originalSaleItemId:'b' });
    assert.equal((await ingest(raw)).status,'PROCESSED'); await ingest(raw);
    assert.equal((await total(mixed)).commission,80); assert.equal((await total(mixed)).revenue,2000);
  });
  await test('full return exactly reverses original earnings; excessive return is held', async () => {
    assert.equal((await ingest(credit(randomUUID(),mixed,{ lineItemId:'r2', productID:'b', quantity:1, originalSaleItemId:'b' }))).status,'PROCESSED');
    assert.equal((await total(mixed)).commission,50);
    assert.equal((await ingest(credit(randomUUID(),mixed,{ lineItemId:'r3', productID:'b', quantity:1, originalSaleItemId:'b' }))).error,'REFUND_EXCEEDS_ORIGINAL_SALE');
  });
  await test('cancel after partial/full item credits nets to zero once, preserving audit entries', async () => {
    const raw = invoice(mixed,[],{ status:'CANCELLED' });
    assert.equal((await ingest(raw)).status,'PROCESSED'); await ingest(raw);
    const sum = await total(mixed); assert.equal(sum.commission,0); assert.equal(sum.revenue,0); assert.equal(sum.quantity,0);
    assert.equal((await ingest(credit(randomUUID(),mixed,{ lineItemId:'r4', productID:'a', quantity:1 }))).error,'ORIGINAL_SALE_NOT_FOUND_OR_CANCELLED');
  });
  await test('missing subcategory or historical rate blocks entire bill, never falls back to employee/category', async () => {
    const raw = invoice(randomUUID(),[item(), { lineItemId:'bad',productID:'unknown',quantity:1,categoryId:a.externalId,netAmountExTax:100,commissionPercentage:99 }]);
    assert.equal((await ingest(raw)).error,'SUBCATEGORY_MAPPING_REQUIRED');
    assert.equal(await prisma.hrmCommissionDocument.count({ where: { externalId: raw.data.invoice.invoiceId } }),0);
    assert.equal((await ingest(invoice(randomUUID(),[item()],{ invoiceDate:'2025-12-01' }))).error,'HISTORICAL_OR_CURRENT_RATE_MISSING');
  });
  await test('authoritative product mapping resolves missing subcategory as of sale date', async () => {
    await prisma.hrmCommissionMapping.create({ data: { productId: `mapped-${key}`, variantId:'SKU1', subcategoryId:a.id, effectiveFrom:since, createdBy:user.id } });
    const id=randomUUID(); assert.equal((await ingest(invoice(id,[{lineItemId:'mapped',productID:`mapped-${key}`,sku:'SKU1',quantity:1,netAmountExTax:1000}]))).status,'PROCESSED'); assert.equal((await total(id)).commission,50);
  });
  await test('ambiguous net amounts are held until administrator verifies discount/GST contract', async () => {
    const id=randomUUID(), result=await ingest(invoice(id,[{lineItemId:'a',productID:'a',subcategoryId:a.externalId,quantity:1,productNetAmount:900,taxAmount:162}]));
    assert.equal(result.error,'DISCOUNTED_NET_AMOUNT_BASIS_UNVERIFIED');
    await prisma.hrmCommissionSettings.update({where:{id:1},data:{netBasis:'NET_EX_TAX',discounted:true}});
    assert.equal((await processStoredLog(result.source.id)).status,'PROCESSED'); assert.equal((await total(id)).commission,45); assert.equal((await total(id)).revenue,900);
  });
  await test('GST-inclusive source amount converts correctly without changing external totals', async () => {
    await prisma.hrmCommissionSettings.update({where:{id:1},data:{netBasis:'NET_INCL_TAX'}});
    const id=randomUUID(); await ingest(invoice(id,[{lineItemId:'a',productID:'a',subcategoryId:a.externalId,quantity:1,productNetAmount:1062,taxAmount:162}]));
    assert.equal((await total(id)).commission,45); assert.equal((await total(id)).revenue,900);
  });
  await test('fixed per-line partial refunds allocate rounding residual exactly', async () => {
    const sub=await prisma.hrmCommissionSubcategory.create({data:{externalId:`fixed-${key}`,name:'Fixed'}});
    await prisma.hrmCommissionRate.create({data:{subcategoryId:sub.id,rate:'10.01',type:'FIXED',basis:'NET_EX_TAX',fixedBasis:'LINE',effectiveFrom:since,createdBy:user.id}});
    const id=randomUUID(); await ingest(invoice(id,[item('fixed',sub.externalId,'3000',3)])); assert.equal((await total(id)).commission,10.01);
    for (const expected of [6.67,3.34,0]) { const r=await ingest(credit(randomUUID(),id,{lineItemId:randomUUID(),productID:'fixed',quantity:1})); assert.equal(r.status,'PROCESSED',r.error??undefined); assert.equal((await total(id)).commission,expected); }
  });
  await test('invoice revisions keep original rate; out-of-order revision cannot rewrite current value', async () => {
    const id=randomUUID(); await ingest(invoice(id,[item()],{updatedAt:'2026-01-10T10:00:00Z'}));
    await ingest(invoice(id,[item('a',a.externalId,'2000')],{updatedAt:'2026-01-12T10:00:00Z'})); assert.equal((await total(id)).commission,100);
    await ingest(invoice(id,[item('a',a.externalId,'500')],{updatedAt:'2026-01-11T10:00:00Z'})); assert.equal((await total(id)).commission,100);
    assert.equal((await ingest(invoice(id,[item('a',a.externalId,'800')]))).error,'UNVERSIONED_OR_CONFLICTING_DOCUMENT_UPDATE');
  });
  await test('credit-note cancellation restores original commission, without deleting prior debit', async () => {
    const id=randomUUID(); await ingest(invoice(id,[item()])); const cn=randomUUID();
    await ingest(credit(cn,id,{lineItemId:'r',productID:'a',quantity:1})); assert.equal((await total(id)).commission,0);
    await ingest(credit(cn,id,{lineItemId:'r',productID:'a',quantity:1},{status:'CANCELLED'})); assert.equal((await total(id)).commission,50);
  });
  await test('linked exchange atomically records original-rate return and newly rated replacement', async () => {
    const id=randomUUID(); await ingest(invoice(id,[item()]));
    const result=await ingest({eventType:'salesExchange.created',data:{salesExchange:{exchangeNo:randomUUID(),storeId:store.id,exchangeDate:'2026-01-11',originalInvoiceId:id},SalesExchangeProductList:[{lineItemId:'old',productID:'a',quantity:1,IsOld:true,originalSaleItemId:'a'}, {...item('replacement',b.externalId,'2000',2),IsOld:false}]}});
    assert.equal(result.status,'PROCESSED'); assert.equal((await total(id)).commission,0);
  });
  await test('ambiguous line identities, malformed amounts and invalid dates are explicit exceptions', async () => {
    const bad = await ingest(invoice(randomUUID(),[item(),item()])); assert.equal(bad.error,'AMBIGUOUS_DUPLICATE_PRODUCT_LINES');
    assert.equal((await ingest(invoice(randomUUID(),[item('a',a.externalId,'-5')]))).error,'NET_EX_TAX_INVALID');
    assert.throws(()=>normalizePayload(invoice('bad',[item()],{invoiceDate:'2026-02-30'}),{netField:'productNetAmount',netBasis:'UNVERIFIED',discounted:false}),/SALE_DATE_INVALID/);
  });
  const app=express();app.use(express.json());app.use('/api/hrm/subcategory-commissions',routes);
  const server=await new Promise<any>(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const root=`http://127.0.0.1:${server.address().port}/api/hrm/subcategory-commissions`;
  const token=(role='ADMIN',extra={})=>signAccessToken({id:user.id,role,...extra});
  const request=async(path:string,method='GET',body?:any,bearer=token())=>{const r=await fetch(root+path,{method,headers:{Authorization:`Bearer ${bearer}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json() as any};};
  try {
    await test('HRM API reports expose subcategory/store totals, reversals and both date bases', async()=>{
      const r=await request(`/report?storeId=${store.id}&from=2026-01-01&to=2026-02-28`);assert.equal(r.status,200);assert(r.body.data.rows.length>0);assert(r.body.data.rows.every((x:any)=>x.storeId===store.id));assert(!('employeeId' in r.body.data.rows[0]));assert(r.body.data.storeTotals.length===1);
      const other=await request(`/report?storeId=${otherStore.id}&from=2026-01-01&to=2026-02-28`);assert.equal(other.body.data.rows.length,0);
      const date=new Date(Date.now()+19800000).toISOString().slice(0,10);assert.equal((await request(`/report?storeId=${store.id}&dateBasis=posting&from=${date}&to=${date}`)).status,200);
    });
    await test('API denies employee, POS credentials and cross-store report access',async()=>{
      assert.equal((await request('/configuration','GET',undefined,token('EMPLOYEE'))).status,403);
      assert.equal((await request('/configuration','GET',undefined,token('ADMIN',{isPosStoreSession:true}))).status,403);
      assert.equal((await request(`/report?storeId=${store.id}`,'GET',undefined,token('STORE_MANAGER',{storeId:otherStore.id}))).status,403);
    });
    await test('API rejects invalid/duplicate rates and prevents HR users from changing global policies',async()=>{
      const rate={subcategoryId:a.id,type:'PERCENTAGE',rate:101,basis:'NET_EX_TAX',fixedBasis:'UNIT',effectiveFrom:since.toISOString()};
      assert.equal((await request('/rates','POST',rate)).status,400);
      assert.equal((await request('/rates','POST',{...rate,rate:5})).status,409);
      assert.equal((await request('/rates','POST',{...rate,rate:5},token('HR'))).status,403);
      assert.equal((await request('/report?from=2026-02-30&to=2026-03-01')).status,400);
    });
    await test('API settings/configuration, source batch and audited exception retry operate only on HRM tables',async()=>{
      assert.equal((await request('/configuration')).status,200);
      const retry=await request('/exceptions');assert.equal(retry.status,200);assert(retry.body.data.length>0);
      const worker=await projectStoredHopkidLogs();assert.equal(typeof worker.processed,'number');
      assert.equal(await prisma.commissionTransaction.count({where:{storeId:store.id}}),0);
      assert.equal(await prisma.pOSRetailCommission.count({where:{storeId:store.id}}),0);
      assert.equal(await prisma.sales.count({where:{billId:{contains:key}}}),0);
    });
  } finally { await new Promise<void>(resolve=>server.close(()=>resolve())); }
  console.log(`HRM external subcategory commission: ${passed} checks passed`);
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await prisma.$disconnect();process.exit(process.exitCode??0);});
