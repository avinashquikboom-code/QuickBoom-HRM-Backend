/** Isolated UI verification server. Never accepts a production database. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {prisma} from '../src/utils/db';
import routes from '../src/hrmCommission/routes';
import audit from '../src/controllers/webhookLogsController';
import {processStoredLog} from '../src/hrmCommission/projection';
import {signAccessToken} from '../src/utils/jwt';
async function main(){
 const url=new URL(process.env.DATABASE_URL??'');assert(['localhost','127.0.0.1'].includes(url.hostname)&&url.port==='55439'&&url.pathname.includes('hrm_commission_test'),'Isolated test database required');
 const key=randomUUID(),user=await prisma.user.create({data:{email:`ui-${key}@test.invalid`,password:'unused',role:'ADMIN'}});
 const store=await prisma.store.create({data:{name:'UI verification store'}}),empty=await prisma.store.create({data:{name:'UI empty store'}});
 const sub=await prisma.hrmCommissionSubcategory.create({data:{externalId:key,name:'UI verified subcategory'}});
 await prisma.hrmCommissionRate.create({data:{subcategoryId:sub.id,type:'PERCENTAGE',rate:5,basis:'NET_EX_TAX',effectiveFrom:new Date('2026-01-01'),createdBy:user.id}});
 await prisma.hrmCommissionSettings.upsert({where:{id:1},create:{id:1,enabled:true,ingestSince:new Date('2026-01-01'),updatedBy:user.id},update:{enabled:true}});
 const raw={eventType:'INVOICE_CREATED',data:{invoice:{invoiceId:key,invoiceNo:'UI-VERIFICATION',storeId:store.id,invoiceDate:'2026-10-26',lineItems:[{lineItemId:'ui-line',productID:key,quantity:1,subcategoryId:sub.externalId,netAmountExTax:2130}]}}};
 const log=await prisma.hopkidWebhookLog.create({data:{storeId:store.id,billId:key,amount:2130,rawPayload:JSON.stringify(raw)}});await processStoredLog(log.id);
 const app=express();app.use(express.json());
 app.use('/api',(req,res,next)=>{req.headers.authorization=`Bearer ${signAccessToken({id:user.id,role:'ADMIN'})}`;
  if(req.path.startsWith('/webhook')&&req.headers['x-test-scenario']==='audit-error'){res.status(503).json({success:false,message:'Isolated test: webhook database unavailable'});return;}
  if(req.path.startsWith('/webhook')&&req.headers['x-test-scenario']==='audit-empty')req.url+=(req.url.includes('?')?'&':'?')+`store=${empty.id}`;
  next();});
 app.get('/api/admin/stores',async(_req,res)=>res.json({success:true,data:await prisma.store.findMany({where:{id:{in:[store.id,empty.id]}}})}));
 app.use('/api/hrm/subcategory-commissions',routes);app.use('/api/webhook',audit);
 app.use(express.static('/private/tmp/hrm-commission-ui-harness'));
 app.listen(55441,'127.0.0.1',()=>console.log(`Isolated UI harness ready at http://127.0.0.1:55441; verification store ${store.id}`));
}
main().catch(async e=>{console.error(e);await prisma.$disconnect();process.exit(1);});
