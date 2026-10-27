// Isolated invoice fixtures, never writes rates or accesses a real database.
require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const {Prisma} = require('@prisma/client');
const stores = [{id:9,name:'HopKid Branch A',code:'HK-A'},{id:7,name:'Unrelated Store',code:'OTHER'}];
const employee={id:42,employeeCode:'SELLER',firstName:'Test',lastName:'Seller',storeId:null,branchId:null,commissionPolicies:[]};
let savedRaw=null, writes=0;
const tx={
 store:{findUnique:async({where})=>stores.find(s=>s.id===where.id)||null,findMany:async({where})=>stores.filter(s=>where.code?s.code===where.code:s.name.toLowerCase()===where.name.equals.toLowerCase())},
 branch:{findUnique:async({where})=>where.id===7?{id:7,name:'HopKid Branch A'}:null},
 employee:{findUnique:async()=>employee},
 commissionTransaction:{count:async()=>0,update:async()=>{writes++;}},
 webhookLog:{findMany:async()=>savedRaw?[{id:'log',payload:JSON.stringify(savedRaw),createdAt:new Date('2026-10-01')}]:[]},
 hopkidWebhookLog:{findMany:async()=>[]},
 hrmCommissionDocument:{findFirst:async()=>null,findMany:async()=>[]},
 hrmCommissionSettings:{findUnique:async()=>null},
 hrmCommissionSubcategory:{findUnique:async({where})=>where.externalId==='A'?{id:'sub-a',name:'Subcategory A'}:where.externalId==='B'?{id:'sub-b',name:'Subcategory B'}:null},
 hrmCommissionRate:{findMany:async({where})=>{
   assert.deepEqual(where.storeKey.in,[0,9]);
   assert(where.effectiveFrom.lte instanceof Date);
   return [{id:`rule-${where.subcategoryId}`,type:'PERCENTAGE',rate:new Prisma.Decimal(where.subcategoryId==='sub-a'?'2':'3'),basis:'NET_EX_TAX',fixedBasis:'UNIT',isActive:true}];
 }},
};
require.cache[require.resolve('../src/utils/db')]={exports:{prisma:tx}};
const helper=require('../src/utils/commissionHelper');helper.resolveEmployeeId=async()=>42;
const {groupAndCalculateCommissionBySalesman}=require('../src/controllers/webhookController');
const {resolveInvoiceStore,prepareInvoiceApproval,calculateInvoiceCommission}=require('../src/services/invoiceCommissionService');
const {recordedInvoiceCommission}=require('../src/services/recordedInvoiceCommission');
const items=[{productID:'hopkid-a',subcategoryId:'A',quantity:1,netAmountExTax:499,employeeCode:'SELLER'},
 {productID:'hopkid-b',subcategoryId:'B',quantity:2,netAmountExTax:1000,employeeCode:'SELLER'}];
async function calculate(meta={branchId:7}) {
 return (await groupAndCalculateCommissionBySalesman(items,{invoiceNo:'12032',invoiceDate:'2026-10-01',netAmount:1499,metaStoreId:null,meta})).get(42);
}
(async()=>{
 for(const meta of [{branchId:7},{branchName:'HopKid Branch A'},{storeCode:'HK-A'}]) {
  const result=await calculate(meta);assert(result);
  assert.equal(Math.round(result.totalCommission*100)/100,39.98);
  assert.deepEqual(result.products.map(p=>p.commissionRate),[2,3]);
  assert.deepEqual(result.products.map(p=>p.commissionAmount),[9.98,30]);
  assert(result.products.every(p=>p.storeId===9&&p.commissionState==='CONFIGURED'));
 }
 // A branch's numeric ID must never be interpreted as a Store ID.
 assert.equal(await resolveInvoiceStore(tx,{meta:{branchId:99}}),null);
 employee.branchId=7;assert.equal(Math.round((await calculate({})).totalCommission*100)/100,39.98);employee.branchId=null;
 stores.push({id:10,name:'HopKid Branch A',code:'HK-DUP'});
 await assert.rejects(resolveInvoiceStore(tx,{meta:{branchName:'HopKid Branch A'}}),/STORE_MAPPING_AMBIGUOUS/);
 stores.pop();
 const missing=await calculate({});assert.equal(missing.products[0].missingReason,'STORE_ID_MISSING');
 assert.equal(missing.products[0].commissionAmount,null);
 const projected=recordedInvoiceCommission({status:'PENDING',eventType:'INVOICE_CREATED',commissionAmount:0,productBreakdown:missing.products});
 assert.equal(projected.commissionAmount,null);assert.equal(projected.hasMissingConfiguration,false);
 assert.equal(projected.rateDisplay,'Invoice store mapping unavailable');
 savedRaw={eventType:'INVOICE_CREATED',data:{invoice:{invoiceId:'12032',invoiceNo:'HWM-12032',invoiceDate:'2026-10-01',branchName:'HopKid Branch A',lineItems:items}}};
 const sale={id:5,employeeId:42,storeId:null,billId:'12032',invoiceNumber:'HWM-12032',status:'PENDING',eventType:'INVOICE_CREATED',commissionAmount:0,saleAmount:1499,createdAt:new Date('2026-10-01'),productBreakdown:missing.products};
 const first=await prepareInvoiceApproval(tx,sale),second=await prepareInvoiceApproval(tx,sale);
 assert.equal(first.storeId,9);assert.equal(first.commissionAmount,39.98);
 assert.deepEqual(first,second);assert.equal(writes,0,'preview must not persist store recovery or money');
 assert.deepEqual(await prepareInvoiceApproval(tx,{...sale,status:'APPROVED'}),{});
 assert.deepEqual(await prepareInvoiceApproval(tx,{...sale,status:'PAID'}),{});
 // Previously recorded examples are preserved; their rates are not reconstructed from totals.
 for(const [billId,saleAmount,commissionAmount] of [['11968',7350,73.5],['11960',7471,47.77],['11771',2948,38.97]]) {
  const result=await calculateInvoiceCommission(tx,{...sale,billId,status:'PAID',saleAmount,commissionAmount,productBreakdown:[]},null,{storeId:9,at:sale.createdAt,reference:billId});
  assert.equal(result.commissionAmount,commissionAmount);
 }
 // Exercise the existing repair transaction and wallet delta, including a repeated apply.
 let current={...sale};let walletDelta=0;let notifications=0;
 tx.user={findUnique:async()=>({role:'ADMIN'})};
 tx.commissionTransaction.findMany=async()=>current.status==='PENDING'?[{id:current.id}]:[];
 tx.commissionTransaction.findUniqueOrThrow=async()=>({...current});
 tx.commissionTransaction.update=async({data})=>{writes++;Object.assign(current,data);return current;};
 tx.$queryRaw=async()=>[];tx.$transaction=async callback=>callback(tx);
 tx.commissionHistory={create:async()=>({})};tx.hrmCommissionAudit={create:async()=>({})};
 helper.updateEmployeeWalletCommission=async(_id,amount,increase)=>{walletDelta+=increase?amount:-amount;};
 helper.broadcastCommissionEvent=async()=>{notifications++;};
 const {reconcilePendingInvoiceCommissions}=require('../src/services/pendingInvoiceReconciliation');
 const preview=await reconcilePendingInvoiceCommissions({actorId:1,transactionIds:[5],dryRun:true});
 assert.equal(preview.results[0].state,'READY');assert.equal(writes,0);assert.equal(walletDelta,0);
 const repaired=await reconcilePendingInvoiceCommissions({actorId:1,transactionIds:[5],dryRun:false});
 assert.equal(repaired.results[0].state,'RECONCILED');assert.equal(current.storeId,9);
 assert.equal(walletDelta,39.98);assert.equal(notifications,1);
 await reconcilePendingInvoiceCommissions({actorId:1,transactionIds:[5],dryRun:false});
 assert.equal(walletDelta,39.98);assert.equal(writes,1);assert.equal(notifications,1);
 console.log('PASS branch/code/name/seller mappings, numeric collision rejection, ambiguous mapping rejection, mixed subcategories, missing-store errors, metadata-based repair, repeat calculation and finalized history');
})().catch(error=>{console.error(error);process.exitCode=1;});
