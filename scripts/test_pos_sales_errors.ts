import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {Prisma} from '@prisma/client';
import {prisma} from '../src/utils/db';
import routes from '../src/pos/routes';
import {signAccessToken} from '../src/utils/jwt';
import * as service from '../src/pos/service';

async function main() {
 const db = new URL(process.env.POS_TEST_DATABASE_URL ?? '');
 assert(['127.0.0.1','localhost'].includes(db.hostname) && db.port==='55439' && db.pathname.includes('pos_test') && process.env.DATABASE_URL===process.env.POS_TEST_DATABASE_URL, 'Isolated POS database required');
 const suffix=randomUUID();
 const store=await prisma.store.create({data:{name:'Sales errors '+suffix,code:suffix}});
 const cashier=await prisma.user.create({data:{email:suffix+'@pos.test',password:'unused',role:'ADMIN'}});
 await prisma.workMode.upsert({where:{id:'OFFICE'},create:{id:'OFFICE',name:'Office'},update:{}});
 const employee=await prisma.employee.create({data:{firstName:'Sales',lastName:'Test',employeeCode:suffix,status:'active',storeId:store.id}});
 const token=signAccessToken({id:cashier.id,role:'ADMIN'});
 const app=express();app.use(express.json());app.use('/api/v1/pos',routes);
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 const origin=`http://127.0.0.1:${(server.address() as any).port}/api/v1/pos`;
 async function post(path:string,body:any,auth=true){const res=await fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});return {status:res.status,body:await res.json() as any};}
 const item={manual:true,name:'Manual shirt',quantity:1,unitPrice:'100',taxRate:'0',discountPerUnit:'0'};
 const payload={storeId:store.id,items:[item],payments:[{method:'CASH',amount:'100'}],idempotencyKey:randomUUID()};
 try {
  const auth=await post('/sales',payload,false);assert.equal(auth.status,401);console.log('AUTH RESPONSE',JSON.stringify(auth));
  for(const [patch,expected] of [[{quantity:0},'quantity'],[{unitPrice:'0'},'greater than zero'],[{name:''},'item name'],[{discountPerUnit:'101'},'Discount exceeds'],[{taxRate:'101'},'tax rate'],[{barcode:'\ninvalid'},'printable ASCII'],[{salespersonId:999999},'active employee']] as const){
   const invalid=await post('/sales',{...payload,idempotencyKey:randomUUID(),items:[{...item,...patch}]});assert.equal(invalid.status,400,JSON.stringify(invalid));assert.match(invalid.body.message,new RegExp(expected));console.log('400 RESPONSE',JSON.stringify(invalid.body));
  }
  const mismatch=await post('/sales',{...payload,payments:[{method:'CASH',amount:'50'}]});assert.equal(mismatch.status,400);assert.match(mismatch.body.message,/Payments must equal/);
  for(const method of ['CASH','CARD','UPI']){
   const items=method==='CASH'?[item]:[{...item,discountPerUnit:'10',taxRate:'18',salespersonId:employee.id},{...item,name:'Second manual',quantity:2,unitPrice:'50',taxRate:'5'}];
   const quote=await post('/quote',{storeId:store.id,items});assert.equal(quote.status,200,JSON.stringify(quote));
   const body={...payload,items,payments:[{method,amount:quote.body.data.grandTotal}],idempotencyKey:randomUUID()};
   const sale=await post('/sales',body);assert.equal(sale.status,200,JSON.stringify(sale));assert(sale.body.data.items.every((i:any)=>i.variantId===null));
   if(method!=='CASH')assert.equal(sale.body.data.items[0].salespersonId,employee.id);
   const replay=await post('/sales',body);assert.equal(replay.status,200);assert.equal(replay.body.data.id,sale.body.data.id);
   assert.equal(await prisma.pOSSale.count({where:{idempotencyKey:body.idempotencyKey}}),1);
   const changed=await post('/sales',{...body,customerName:'Changed request'});assert.equal(changed.status,409);console.log('409 RESPONSE',JSON.stringify(changed.body));
   const next=await post('/sales',{...body,idempotencyKey:randomUUID()});assert.equal(next.status,200);assert.notEqual(next.body.data.id,sale.body.data.id);
   if(method==='CASH') {
    // Inject the concurrency-recovery boundary: initial read misses a committed
    // winner, and the transaction loses. Real winner is fetched from PostgreSQL.
    const originalFind=prisma.pOSSale.findUnique.bind(prisma.pOSSale);
    const originalTransaction=prisma.$transaction.bind(prisma);
    const conflict=new Prisma.PrismaClientKnownRequestError('Injected serialization loser',{code:'P2034',clientVersion:'test'});
    let first=true;
    (prisma.pOSSale as any).findUnique=async(args:any)=>{if(first){first=false;return null;}return originalFind(args);};
    (prisma as any).$transaction=async()=>{throw conflict;};
    try {
     const actor={userId:cashier.id,role:'ADMIN',admin:true,permissions:{}};
     await assert.rejects(service.checkout(actor,{...body,customerName:'Different concurrent payload'}),/Idempotency key used/);
    } finally {(prisma.pOSSale as any).findUnique=originalFind;(prisma as any).$transaction=originalTransaction;}
   }
  }
  console.log('PASS manual single/multi-item sales, discounts/GST, selected employee, CASH/CARD/UPI, invalid 400s, auth 401, same-key replay, changed-key conflict, recovery hash check and genuinely new bills.');
 } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>prisma.$disconnect());
