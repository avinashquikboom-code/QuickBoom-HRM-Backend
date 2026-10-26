import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { prisma } from '../src/utils/db';
import routes from '../src/hrmCommission/routes';
import auditRoutes from '../src/controllers/webhookLogsController';
import { processStoredLog } from '../src/hrmCommission/projection';
import { signAccessToken } from '../src/utils/jwt';
let passed=0;
async function test(name:string, run:()=>Promise<void>){await run();console.log(`PASS ${name}`);passed++;}
async function main(){
 const url=new URL(process.env.DATABASE_URL??'');assert(['localhost','127.0.0.1'].includes(url.hostname)&&url.port==='55439'&&url.pathname.includes('hrm_commission_test'),'Isolated test database required');
 const key=randomUUID();
 const admin=await prisma.user.create({data:{email:`reports-${key}@test.invalid`,password:'unused',role:'ADMIN'}});
 const store=await prisma.store.create({data:{name:`reports-${key}`}}), empty=await prisma.store.create({data:{name:`empty-${key}`}});
 const sub=await prisma.hrmCommissionSubcategory.create({data:{name:`Verified ${key}`,externalId:key}});
 await prisma.hrmCommissionRate.create({data:{subcategoryId:sub.id,type:'PERCENTAGE',rate:5,basis:'NET_EX_TAX',effectiveFrom:new Date('2025-12-31T18:30:00Z'),createdBy:admin.id}});
 await prisma.hrmCommissionSettings.upsert({where:{id:1},create:{id:1,enabled:true,ingestSince:new Date('2025-12-31T18:30:00Z'),netField:'productNetAmount',netBasis:'UNVERIFIED',discounted:false,updatedBy:admin.id},update:{enabled:true}});
 const payload=(at:string, valid=true)=>({eventType:'INVOICE_CREATED',data:{invoice:{invoiceId:randomUUID(),storeId:store.id,invoiceDate:at,lineItems:[{lineItemId:'line',productID:key,quantity:1,...valid?{subcategoryId:sub.externalId}:{},netAmountExTax:2130}]}}});
 const ingest=async(raw:any)=>{const log=await prisma.hopkidWebhookLog.create({data:{storeId:store.id,amount:2130,rawPayload:JSON.stringify(raw)}});return {log,outcome:await processStoredLog(log.id)};};
 const first=await ingest(payload('2026-01-01T00:00:00+05:30'));
 await ingest(payload('2026-10-26T23:59:59.999+05:30'));await ingest(payload('2026-10-27T00:00:00+05:30'));
 const missing=await ingest(payload('2026-10-26',false));assert.equal(missing.outcome.error,'SUBCATEGORY_MAPPING_REQUIRED');
 const app=express();app.use(express.json());app.use('/commission',routes);app.use('/webhook',auditRoutes);
 const server=await new Promise<any>(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const root=`http://127.0.0.1:${server.address().port}`;
 const token=(role='ADMIN',extra={})=>signAccessToken({id:admin.id,role,...extra});
 const request=async(path:string,bearer:string|null=token())=>{const r=await fetch(root+path,{headers:bearer?{Authorization:`Bearer ${bearer}`}:{}});return {status:r.status,data:await r.json() as any};};
 const range=`storeId=${store.id}&from=2026-01-01&to=2026-10-26`;
 try{
 await test('sale-date boundaries include the complete IST end day and exclude next day',async()=>{const r=await request(`/commission/report?${range}`);assert.equal(r.status,200);assert.equal(Number(r.data.data.totals.eligibleNetSales),4260);assert.equal(Number(r.data.data.totals.commissionAmount),213);assert.equal(r.data.data.totals.completedBillsCount,2);});
 await test('real empty store and empty range return successful empty reports',async()=>{for(const q of [`storeId=${empty.id}&from=2026-01-01&to=2026-10-26`,`storeId=${store.id}&from=2026-02-01&to=2026-02-28`]){const r=await request(`/commission/report?${q}`);assert.equal(r.status,200);assert.equal(r.data.data.rows.length,0);}});
 await test('subcategory and search filters apply to the same verified ledger',async()=>{const r=await request(`/commission/report?${range}&subcategoryId=${sub.id}&search=Verified`);assert.equal(r.data.data.rows.length,1);const absent=await request(`/commission/report?${range}&search=does-not-exist`);assert.equal(absent.data.data.rows.length,0);});
 await test('ledger pagination and filters use original sale date',async()=>{const r=await request(`/commission/ledger?${range}&pageSize=1&subcategoryId=${sub.id}`);assert.equal(r.status,200);assert.equal(r.data.data.total,2);assert.equal(r.data.data.rows.length,1);assert(r.data.data.rows[0].billId);});
 await test('diagnostics distinguish source delivery, verified import, and mapping exception',async()=>{const r=await request(`/commission/diagnostics?storeId=${store.id}`);assert.equal(r.status,200);assert.equal(r.data.data.sourceLogs,4);assert.equal(r.data.data.documents,3);assert.equal(r.data.data.exceptions,1);});
 await test('duplicate webhook replay leaves financial totals unchanged',async()=>{await processStoredLog(first.log.id);const r=await request(`/commission/report?${range}`);assert.equal(Number(r.data.data.totals.commissionAmount),213);});
 await test('store managers cannot broaden report or diagnostic scope',async()=>{for(const endpoint of ['report','diagnostics','ledger']){const r=await request(`/commission/${endpoint}?storeId=${empty.id}`,token('STORE_MANAGER',{storeId:store.id}));assert.equal(r.status,403);}});
 await test('audit represents successful and failed persisted outcomes without fabricating transaction events',async()=>{const r=await request(`/webhook/logs?store=${store.id}`);assert.equal(r.status,200);assert.equal(r.data.data.length,4);assert.equal(r.data.data.filter((l:any)=>l.status==='FAILED').length,1);assert.equal(r.data.data.filter((l:any)=>l.status==='SUCCESS').length,3);const stats=await request(`/webhook/stats?store=${store.id}`);assert.equal(stats.data.data.total,4);assert.equal(stats.data.data.failed,1);});
 await test('raw unprocessed receipt is not a successful event; duplicate storage is counted once',async()=>{const raw=JSON.stringify(payload('2026-10-26'));const log=await prisma.hopkidWebhookLog.create({data:{storeId:store.id,rawPayload:raw}});const r=await request(`/webhook/logs?store=${store.id}`);assert.equal(r.data.data.find((x:any)=>x.id===`hopkid-${log.id}`).status,'RECEIVED');await prisma.webhookLog.create({data:{payload:raw,eventType:'INVOICE_CREATED',status:'SUCCESS'}});const all=await request('/webhook/logs?limit=5000');assert(!all.data.data.some((x:any)=>x.id===`hopkid-${log.id}`));});
 await test('empty audit responses are successful; unauthorized access is denied',async()=>{const r=await request(`/webhook/logs?store=${empty.id}`);assert.equal(r.status,200);assert.deepEqual(r.data.data,[]);assert.equal((await request('/webhook/logs',null)).status,401);assert.equal((await request('/webhook/stats',token('EMPLOYEE'))).status,403);});
 await test('invalid date and pagination requests return errors instead of zero reports',async()=>{assert.equal((await request('/commission/report?from=2026-02-30&to=2026-03-02')).status,400);assert.equal((await request('/webhook/logs?limit=NaN')).status,400);});
 await test('audit database errors propagate as HTTP 500 with no successful empty payload',async()=>{const original=prisma.$queryRaw;try{(prisma as any).$queryRaw=async()=>{throw new Error('simulated database outage');};const r=await request('/webhook/logs');assert.equal(r.status,500);assert.equal(r.data.success,false);assert.equal(r.data.data,undefined);}finally{(prisma as any).$queryRaw=original;}});
 console.log(`Commission reporting and audit: ${passed} checks passed`);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await prisma.$disconnect();process.exit(process.exitCode??0);});
