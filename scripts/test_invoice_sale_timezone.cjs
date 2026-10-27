// Isolated DIVA identity fixtures. The rate below is test configuration, not a verified production rate.
require('ts-node/register/transpile-only');
const assert=require('node:assert/strict');
const {Prisma}=require('@prisma/client');
const productId='827ddbdb-3733-41b8-b8f1-900231834629',variantId='4311451b-2639-450a-82c5-4a9e6fc461fe';
const sub={id:'11111111-1111-4111-8111-111111111111',externalId:'fixture-sub',name:'Fixture Subcategory',categoryExternalId:'fixture-category'};
const policy={id:'fixture-rate',type:'PERCENTAGE',rate:new Prisma.Decimal('2.75'),basis:'NET_EX_TAX',fixedBasis:'UNIT',isActive:true};
const invoice={invoiceId:'134',invoiceNo:'HWM-134',storeId:66,date:'2026-10-27T11:22:33',createdAt:'2026-10-27T05:52:35Z',
 lineItems:[{productID:productId,variantId,productName:'DIVA',quantity:1,netAmountExTax:1690,employeeCode:'SELLER'}]};
const raw={eventType:'INVOICE_CREATED',data:{invoice}};
const receivedAt=new Date('2026-10-27T09:00:00Z');
let contract={hopkidStoreTimezones:{'66':'Asia/Kolkata'}};
let writes=0;
const tx={
 store:{findUnique:async()=>({id:66,name:'Fixture store'})},
 systemSetting:{findUnique:async()=>({integrations:contract})},
 pOSProduct:{findMany:async()=>[{id:productId,name:'DIVA',categoryId:'fixture-category',category:{name:'Fixture category'}}]},
 hrmCommissionDocument:{findMany:async()=>[]},hrmCommissionSettings:{findUnique:async()=>null},
 hrmCommissionMapping:{findFirst:async({where})=>{
  assert(where.effectiveFrom.lte instanceof Date);assert.equal(where.productId,productId);assert.equal(where.variantId,variantId);
  return {subcategoryId:sub.id};
 }},
 hrmCommissionSubcategory:{findUnique:async()=>sub},hrmCommissionRate:{findMany:async({where})=>{
  assert.equal(where.subcategoryId,sub.id);assert.deepEqual(where.storeKey.in,[0,66]);
  assert.equal(where.effectiveFrom.lte.toISOString(),'2026-10-27T05:52:33.000Z');return [policy];
 }},
 webhookLog:{findMany:async()=>[{id:'log',payload:JSON.stringify(raw),createdAt:receivedAt}]},hopkidWebhookLog:{findMany:async()=>[]},
 commissionTransaction:{update:async()=>{writes++;}},
};
require.cache[require.resolve('../src/utils/db')]={exports:{prisma:tx}};
const {date}=require('../src/hrmCommission/normalize');
const {resolveInvoiceSaleTime}=require('../src/services/invoiceSaleTime');
const {calculateInvoiceCommission}=require('../src/services/invoiceCommissionService');
const {projectInvoiceCommissionForRead}=require('../src/services/invoiceCommissionReadProjection');
const {recordedInvoiceCommission}=require('../src/services/recordedInvoiceCommission');
const {parseSaleDateCorrectly}=require('../src/utils/commissionHelper');
(async()=>{
 assert.equal(date('2026-10-27T05:52:33Z','SALE_DATE').toISOString(),'2026-10-27T05:52:33.000Z');
 assert.equal((await parseSaleDateCorrectly('2026-10-27T05:52:33Z')).toISOString(),'2026-10-27T05:52:33.000Z');
 assert.equal(date('2026-10-27T11:22:33+05:30','SALE_DATE').toISOString(),'2026-10-27T05:52:33.000Z');
 assert.equal(date('2026-10-27 11:22:33','SALE_DATE','Asia/Kolkata').toISOString(),'2026-10-27T05:52:33.000Z');
 assert.equal(date('2026-10-27T11:22:33','SALE_DATE','+05:30').toISOString(),'2026-10-27T05:52:33.000Z');
 assert.throws(()=>date('2026-10-27T11:22:33','SALE_DATE'),/SALE_DATE_TIMEZONE_REQUIRED/);
 assert.throws(()=>date('2026-02-30T12:00:00Z','SALE_DATE'),/SALE_DATE_INVALID/);
 assert.throws(()=>date('2026-11-01T01:30:00','SALE_DATE','America/New_York'),/AMBIGUOUS_OR_NONEXISTENT/);
 assert.throws(()=>date('2026-03-08T02:30:00','SALE_DATE','America/New_York'),/AMBIGUOUS_OR_NONEXISTENT/);
 const stamp=await resolveInvoiceSaleTime(tx,invoice,66);
 assert.equal(stamp.occurredAt.toISOString(),'2026-10-27T05:52:33.000Z');assert.equal(stamp.field,'date');
 assert.notEqual(stamp.occurredAt.toISOString(),invoice.createdAt);
 assert.equal(stamp.timeZoneSource,'STORE_SOURCE_CONTRACT');
 const sale={id:134,employeeId:7,storeId:66,billId:'134',invoiceNumber:'HWM-134',status:'PENDING',eventType:'INVOICE_CREATED',
  createdAt:receivedAt,saleAmount:1690,commissionAmount:0,commissionPercent:null,commissionType:'PERCENTAGE',productBreakdown:[{
   productID:productId,variantId,commissionState:'INVOICE_DATA_MISSING',missingReason:'SALE_DATE_TIMEZONE_REQUIRED',commissionAmount:null,commissionRate:null}]};
 const result=await calculateInvoiceCommission(tx,sale,raw,{storeId:66,at:receivedAt,reference:'134',sourceRecordedAt:receivedAt});
 for(const field of ['commissionAmount','commissionEarned','totalCommission']) assert.equal(result[field],46.48);
 for(const field of ['commissionRate','commissionPercent','commissionPercentage']) assert.equal(result[field],2.75);
 assert.equal(result.commissionState,'COMPLETE');assert.equal(result.saleTimestampField,'date');
 assert.equal(result.productWiseCommission[0].productId,productId);assert.equal(result.productWiseCommission[0].variantId,variantId);
 assert.equal(result.productWiseCommission[0].categoryId,'fixture-category');assert.equal(result.productWiseCommission[0].subcategoryId,sub.id);
 assert.equal(result.productWiseCommission[0].rateId,policy.id);
 const projected=await projectInvoiceCommissionForRead(sale,tx),wallet=recordedInvoiceCommission(projected);
 assert.equal(wallet.commissionAmount,result.commissionAmount);assert.equal(wallet.commissionRate,result.commissionRate);
 assert.equal(projected.status,'PENDING');assert.equal(sale.commissionAmount,0);assert.equal(writes,0);
 tx.commissionTransaction.findFirst=async()=>sale;
 const {CommissionService}=require('../src/services/commissionService');
 const latest=await CommissionService.getLatestSale(7);
 assert.equal(latest.commission,46.48);assert.equal(latest.commissionRate,2.75);
 const frozen={...sale,status:'PAID',commissionAmount:77};assert.equal(await projectInvoiceCommissionForRead(frozen,tx),frozen);
 // Apply uses the same result, fixes only the pending sale timestamp, and credits once.
 let persisted={...sale};let credited=0;
 tx.user={findUnique:async()=>({role:'ADMIN'})};tx.$transaction=async callback=>callback(tx);tx.$queryRaw=async()=>[];
 tx.commissionTransaction.count=async()=>0;
 tx.commissionTransaction.findMany=async()=>persisted.status==='PENDING'?[{id:134}]:[];
 tx.commissionTransaction.findUniqueOrThrow=async()=>({...persisted});
 tx.commissionTransaction.update=async({data})=>{writes++;Object.assign(persisted,data);return persisted;};
 tx.commissionHistory={create:async()=>({})};
 tx.hrmCommissionAudit={create:async({data})=>{assert.equal(data.data.previousSaleTimestamp,receivedAt.toISOString());assert.equal(data.data.saleTimestamp,'2026-10-27T05:52:33.000Z');return {};}};
 const helper=require('../src/utils/commissionHelper');
 helper.updateEmployeeWalletCommission=async(_id,amount,increase)=>{credited+=increase?amount:-amount;};
 helper.broadcastCommissionEvent=async()=>{};
 const {reconcilePendingInvoiceCommissions}=require('../src/services/pendingInvoiceReconciliation');
 const preview=await reconcilePendingInvoiceCommissions({actorId:1,transactionIds:[134],dryRun:true});
 assert.equal(preview.results[0].commissionAmount,46.48);assert.equal(writes,0);
 await reconcilePendingInvoiceCommissions({actorId:1,transactionIds:[134],dryRun:false});
 assert.equal(persisted.createdAt.toISOString(),'2026-10-27T05:52:33.000Z');assert.equal(credited,46.48);
 await reconcilePendingInvoiceCommissions({actorId:1,transactionIds:[134],dryRun:false});
 assert.equal(credited,46.48);assert.equal(writes,1);
 contract={};
 await assert.rejects(resolveInvoiceSaleTime(tx,invoice,66),/SALE_DATE_TIMEZONE_REQUIRED/);
 await assert.rejects(resolveInvoiceSaleTime(tx,{...invoice,createdAtTimeZone:'UTC'},66),/SALE_DATE_TIMEZONE_REQUIRED/);
 const error=await calculateInvoiceCommission(tx,sale,raw,{storeId:66,at:receivedAt,reference:'134'});
 assert.equal(error.commissionAmount,null);assert.equal(error.commissionSource,'UNRESOLVED');
 assert.equal(error.invoiceDataReason,'SALE_DATE_TIMEZONE_REQUIRED');assert.equal(error.rateDisplay,'Invoice sale timestamp unavailable');
 assert.equal(error.hasMissingConfiguration,false);
 console.log('PASS source/receipt separation, explicit UTC, verified store timezone, DST rejection, DIVA exact identity fixture, 1690 calculation, wallet parity and genuine missing-timezone errors');
})().catch(error=>{console.error(error);process.exitCode=1;});
