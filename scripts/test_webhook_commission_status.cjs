// Response contract regression; isolated data only, no database writes or recalculation.
require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const sale = {id:1,employeeId:7,storeId:2,billId:'29146',invoiceNumber:'HWM-29146',saleAmount:499,
  commissionAmount:13.72,commissionPercent:2.75,commissionType:'PERCENTAGE',status:'PENDING',eventType:'INVOICE_CREATED',
  createdAt:new Date(),productBreakdown:[{commissionState:'CONFIGURED',commissionRate:2.75,commissionAmount:13.72,commissionType:'PERCENTAGE'}]};
let older = false;
const raw = {eventType:'INVOICE_UPDATED',data:{invoice:{invoiceId:'29146',invoiceNo:'INV-29146',storeId:2,netAmount:499,lineItems:[{employeeCode:'TEST'}]}}};
const db = {
  employee:{findFirst:async()=>({id:7,employeeCode:'TEST',mobileNumber:'',firstName:'Test',lastName:'Seller'})},
  creditNoteLine:{findMany:async()=>[]},
  hrmCommissionDocument:{findMany:async()=>[]},
  hrmCommissionSettings:{findUnique:async()=>null},
  pOSProduct:{findMany:async()=>[]},
  commissionTransaction:{findMany:async({where})=> {
    assert.equal(where.employeeId,7);
    return older && !where.AND ? [] : [sale];
  }},
  webhookLog:{findMany:async()=>[{id:'event',eventType:'INVOICE_UPDATED',status:'FAILED',errorMessage:'Original delivery failed',billId:'29146',amount:499,createdAt:new Date(),payload:JSON.stringify(raw)}]},
  hopkidWebhookLog:{findMany:async()=>[]},
};
require.cache[require.resolve('../src/utils/db')] = {exports:{prisma:db}};
const {getMobileWebhookLogs} = require('../src/controllers/mobile/mobileCommissionController');
async function response() {
 let result;
 await getMobileWebhookLogs({user:{id:9},query:{limit:'10'}},{json:data=>result=data,status:code=>{throw new Error(`HTTP ${code}`)}});
 assert.equal(result.success,true);
 return result.data.find(row=>row.id==='event');
}
(async()=>{
 let row=await response();
 assert.equal(row.deliveryStatus,'FAILED');
 assert.equal(row.status,'FAILED');
 assert.equal(row.errorMessage,'Original delivery failed');
 assert.equal(row.approvalStatus,'PENDING');
 assert.equal(row.commissionState,'COMPLETE');
 assert.equal(row.commissionStatus,'COMPLETE');
 assert.equal(row.commissionRate,2.75);
 assert.equal(row.commissionEarned,13.72);
 assert.equal(row.hasMissingConfiguration,false);
 assert.equal(row.rateDisplay,'2.75%');
 older=true;
 row=await response();
 assert.equal(row.commissionEarned,13.72,'older invoice aliases must still resolve outside the prefetched page');
 sale.productBreakdown[0].commissionType='FIXED'; sale.productBreakdown[0].fixedBasis='LINE';
 row=await response();assert.equal(row.rateDisplay,'₹2.75 / line');
 sale.productBreakdown[0]={commissionState:'INVOICE_DATA_MISSING',commissionAmount:null,commissionRate:null,missingReason:'PRODUCT_ID_MISSING'};
 row=await response();assert.equal(row.commissionEarned,null);assert.equal(row.hasMissingInvoiceData,true);assert.equal(row.hasMissingConfiguration,false);
 assert.equal(row.commissionState,'INVOICE_DATA_MISSING');
 console.log('PASS webhook delivery, approval and calculation states stay separate; latest recorded rates and amounts, fixed rates, older aliases and genuine data errors');
})().catch(error=>{console.error(error);process.exitCode=1;});
