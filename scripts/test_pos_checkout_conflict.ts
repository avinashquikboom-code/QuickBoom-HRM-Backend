import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {prisma} from '../src/utils/db';
import routes from '../src/pos/routes';
import {signAccessToken} from '../src/utils/jwt';
import * as service from '../src/pos/service';
async function main(){
 const db=new URL(process.env.POS_TEST_DATABASE_URL??'');assert(['localhost','127.0.0.1'].includes(db.hostname)&&db.port==='55439'&&db.pathname.includes('pos_test')&&process.env.DATABASE_URL===process.env.POS_TEST_DATABASE_URL);
 const suffix=randomUUID();const store=await prisma.store.create({data:{name:'Conflict test '+suffix,code:suffix}});
 const owner=await prisma.user.create({data:{email:suffix+'-owner@pos.test',password:'unused',role:'ADMIN'}});
 const cashier=await prisma.user.create({data:{email:suffix+'-cashier@pos.test',password:'unused',role:'ADMIN'}});
 const busy=await prisma.pOSRegister.create({data:{name:'Occupied',storeId:store.id}});
 const occupied=await prisma.pOSSession.create({data:{registerId:busy.id,userId:owner.id,openingCash:'0'}});
 const app=express();app.use(express.json());app.use('/api/v1/pos',routes);const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 const origin=`http://127.0.0.1:${(server.address() as any).port}/api/v1/pos`;
 const headers={Authorization:'Bearer '+signAccessToken({id:cashier.id,role:'ADMIN'}),'Content-Type':'application/json'};
 async function post(path:string,body:any){const res=await fetch(origin+path,{method:'POST',headers,body:JSON.stringify(body)});return {status:res.status,body:await res.json() as any};}
 const item={manual:true,name:'Manual line',barcode:'MANUAL-'+suffix,quantity:1,unitPrice:'100',discountPerUnit:'10',taxRate:'18'};
 const body={storeId:store.id,items:[item],payments:[{method:'CASH',amount:'106.20'}],customerName:'Conflict fixture customer',customerPhone:'9990001234',idempotencyKey:randomUUID()};
 try{
  const blocked=await post('/sales',body);
  if(process.argv.includes('--reproduce')) {assert.equal(blocked.status,409);assert.match(blocked.body.message,/Conflicting record/);console.log('REPRODUCED occupied-register checkout produces generic Prisma conflict:',blocked.body.message);return;}
  assert.equal(blocked.status,409);assert.match(blocked.body.message,/available register/i);assert.equal(await prisma.pOSSale.count({where:{idempotencyKey:body.idempotencyKey}}),0);
  const free=await prisma.pOSRegister.create({data:{name:'Available',storeId:store.id}});
  const pair=await Promise.all([post('/sales',body),post('/sales',body)]);for(const res of pair)assert.equal(res.status,200,JSON.stringify(res.body));assert.equal(pair[0].body.data.id,pair[1].body.data.id);
  const sale=pair[0].body.data;assert.equal(sale.customerName,body.customerName);assert.equal(sale.items[0].variantId,null);assert.equal(Number(sale.taxTotal),16.2);assert.equal(Number(sale.grandTotal),106.2);
  const session=await prisma.pOSSession.findUniqueOrThrow({where:{id:sale.sessionId}});assert.equal(session.registerId,free.id);assert.equal(session.userId,cashier.id);
  assert.equal((await prisma.pOSSession.findUniqueOrThrow({where:{id:occupied.id}})).userId,owner.id);
  const replay=await post('/sales',body);assert.equal(replay.status,200);assert.equal(replay.body.data.id,sale.id);
  assert.equal(await prisma.pOSSale.count({where:{idempotencyKey:body.idempotencyKey}}),1);assert.equal(await prisma.pOSSalePayment.count({where:{saleId:sale.id}}),1);
  const changed=await post('/sales',{...body,customerName:'Different'});assert.equal(changed.status,409);assert.match(changed.body.message,/Idempotency/);
  const unauthorized=await post('/sales',{...body,idempotencyKey:randomUUID(),sessionId:occupied.id});assert.equal(unauthorized.status,403);
  for(const method of ['CARD','UPI']){
   const items=[item,{...item,name:'Second line',barcode:'OTHER-'+suffix,quantity:2,unitPrice:'50',discountPerUnit:'0',taxRate:'5'}];
   const quote=await post('/quote',{storeId:store.id,items,orderDiscount:'10'});assert.equal(quote.status,200);
   const next={...body,items,orderDiscount:'10',idempotencyKey:randomUUID(),payments:[{method,amount:quote.body.data.grandTotal}]};
   const res=await post('/sales',next);assert.equal(res.status,200,JSON.stringify(res.body));assert.notEqual(res.body.data.id,sale.id);assert.equal(res.body.data.items.length,2);assert.equal(res.body.data.payments[0].method,method);assert.equal(Number(res.body.data.grandTotal),Number(quote.body.data.grandTotal));assert.equal(res.body.data.items.reduce((n:number,i:any)=>n+Number(i.lineTotal),0).toFixed(2),Number(res.body.data.grandTotal).toFixed(2));
  }
  // Screenshot regression: store-password terminal has a different identity
  // from the HRM cashier occupying the store's existing register.
  const terminal=await prisma.user.create({data:{email:suffix+'-terminal@pos.test',password:'unused',role:'SALESMAN'}});
  const actor={userId:terminal.id,role:'STORE_POS',storeId:store.id,isPosStoreSession:true,admin:false,permissions:{'pos.sell':true,'pos.discount':true}};
  const terminalBody={...body,idempotencyKey:randomUUID()};
  const terminalPair=await Promise.all([service.checkout(actor,terminalBody),service.checkout(actor,terminalBody)]);
  assert.equal(terminalPair[0].id,terminalPair[1].id);
  const terminalSession=await prisma.pOSSession.findUniqueOrThrow({where:{id:terminalPair[0].sessionId},include:{register:true}});
  assert.equal(terminalSession.userId,terminal.id);
  assert.equal(terminalSession.register.name,`Store POS Terminal (${terminal.id})`);
  assert.equal((await prisma.pOSSession.findUniqueOrThrow({where:{id:occupied.id}})).closedAt,null);
  assert.equal(await prisma.pOSRegister.count({where:{storeId:store.id,name:`Store POS Terminal (${terminal.id})`}}),1);
  const terminalNext=await service.checkout(actor,{...terminalBody,idempotencyKey:randomUUID()});
  assert.equal(terminalNext.sessionId,terminalSession.id);
  assert.notEqual(terminalNext.id,terminalPair[0].id);
  await prisma.pOSSession.update({where:{id:terminalSession.id},data:{closedAt:new Date()}});
  await prisma.pOSRegister.update({where:{id:terminalSession.registerId},data:{active:false}});
  await assert.rejects(service.checkout(actor,{...terminalBody,idempotencyKey:randomUUID()}),/No available register/);
  console.log('PASS store-terminal checkout with occupied HRM registers, concurrent replay, stable dedicated register reuse, and disabled terminal protection.');
  console.log('PASS occupied-register recovery, ownership, concurrent identical keys, replay after response loss, key mismatch, new invoices, manual lines, GST/discounts, CASH/CARD/UPI and one payment per invoice.');
 }finally{server.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>prisma.$disconnect());
