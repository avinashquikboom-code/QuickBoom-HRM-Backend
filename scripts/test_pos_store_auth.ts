/** Real routers/database. Never run fixture writes against an HRM database. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/utils/db';
import posRoutes from '../src/pos/routes';
import adminRoutes from '../src/routes/adminRoutes';
import authRoutes from '../src/routes/authRoutes';
import { signAccessToken } from '../src/utils/jwt';
import { initializeStorePOSCredentials } from '../src/pos/storeCredentials';
import * as service from '../src/pos/service';
import { Actor } from '../src/pos/auth';
async function run(){
 const db=new URL(process.env.POS_TEST_DATABASE_URL??'');assert(['localhost','127.0.0.1'].includes(db.hostname)&&db.port==='55439'&&db.pathname.includes('pos_test')&&process.env.DATABASE_URL===process.env.POS_TEST_DATABASE_URL,'Isolated local POS database required');
 const suffix=randomUUID();const store=async(tag:string,isActive=true)=>prisma.store.create({data:{name:`${tag} ${suffix}`,code:`${tag}-${suffix}`,isActive}});
 const a=await store('A'),b=await store('B'),custom=await store('CUSTOM'),disabled=await store('DISABLED'),inactive=await store('INACTIVE',false);
 const customHash=await bcrypt.hash('ExistingPrivatePassword!',10);
 await prisma.pOSStoreCredential.create({data:{storeId:custom.id,passwordHash:customHash}});
 await prisma.pOSStoreCredential.create({data:{storeId:disabled.id,passwordHash:customHash,posEnabled:false}});
 const superAdmin=await prisma.user.create({data:{email:`${suffix}@super.test.invalid`,password:await bcrypt.hash('HRMTestPassword!',4),role:'SUPER_ADMIN'}});
 const admin=await prisma.user.create({data:{email:`${suffix}@admin.test.invalid`,password:'unused',role:'ADMIN'}});
 const superToken=signAccessToken({id:superAdmin.id,role:superAdmin.role}),adminToken=signAccessToken({id:admin.id,role:admin.role});
 const app=express();app.use(express.json());app.use((req,res,next)=>{(req as any).cookies=Object.fromEntries((req.headers.cookie??'').split(';').filter(Boolean).map(pair=>{const i=pair.indexOf('=');return[pair.slice(0,i).trim(),decodeURIComponent(pair.slice(i+1))]}));next();});
 app.use('/api/v1/pos',posRoutes);app.use('/api/admin',adminRoutes);app.use('/api/auth',authRoutes);
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 let count=0;
 async function request(path:string,body?:unknown,token?:string,status=200,method=body?'POST':'GET'){
  const response=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));assert(!JSON.stringify(data).includes('passwordHash'));return data;
 }
 const login=(code:string,password:string,status=200)=>request('/api/v1/pos/auth/login',{storeCode:code,password},undefined,status);
 const creds=(storeId:number,body:unknown,status=200,token=superToken)=>request(`/api/admin/stores/${storeId}/pos-credentials`,body,token,status);
 async function test(name:string,fn:()=>Promise<void>){await fn();count++;console.log('PASS '+name);}
 let tokenA='',tokenB='';
 try{
  await test('initializer fills active missing credentials, preserves custom/disabled, skips inactive and is repeatable',async()=>{
   const dry=await initializeStorePOSCredentials(true);assert(dry.missing>=2);assert.equal(await prisma.pOSStoreCredential.count({where:{storeId:a.id}}),0);
   await initializeStorePOSCredentials();await initializeStorePOSCredentials();
   for(const id of[a.id,b.id]){const c=await prisma.pOSStoreCredential.findUniqueOrThrow({where:{storeId:id}});assert(await bcrypt.compare('123456',c.passwordHash));assert.notEqual(c.passwordHash,'123456');}
   assert.equal((await prisma.pOSStoreCredential.findUniqueOrThrow({where:{storeId:custom.id}})).passwordHash,customHash);
   assert.equal((await prisma.pOSStoreCredential.findUniqueOrThrow({where:{storeId:disabled.id}})).posEnabled,false);
   assert.equal(await prisma.pOSStoreCredential.count({where:{storeId:inactive.id}}),0);
   tokenA=(await login(a.code!,'123456')).token;tokenB=(await login(b.code!,'123456')).token;
   await request('/api/v1/pos/context',undefined,tokenA);
  });
  await test('new store creation receives exactly one hashed default credential',async()=>{
   const result=await request('/api/admin/stores',{name:`New ${suffix}`,code:`NEW-${suffix}`},superToken,201);
   const c=await prisma.pOSStoreCredential.findUniqueOrThrow({where:{storeId:result.data.id}});assert(await bcrypt.compare('123456',c.passwordHash));assert.equal(await prisma.pOSStoreCredential.count({where:{storeId:result.data.id}}),1);
   await login(result.data.code,'123456');
  });
  await test('only a signed current Super Admin can manage credentials',async()=>{
   await creds(a.id,{password:'Rejected123!'},403,adminToken);
   await creds(a.id,{password:'Rejected123!'},401,'dev-local-auth-token');
   await creds(a.id,{password:'Rejected123!'},403,tokenA);
   await request('/api/admin/stores/'+a.id+'/pos-credentials',{password:'Rejected123!'},undefined,401);
  });
  await test('store password change revokes old password and tokens, without changing another store',async()=>{
   await creds(a.id,{password:'UniqueStorePassword!'});
   await login(a.code!,'123456',401);
   await request('/api/v1/pos/context',undefined,tokenA,401);
   tokenA=(await login(a.code!,'UniqueStorePassword!')).token;
   await request('/api/v1/pos/context',undefined,tokenA);
   await request('/api/v1/pos/context',undefined,tokenB);
   await login(b.code!,'123456');await login(custom.code!,'ExistingPrivatePassword!');
   await initializeStorePOSCredentials();await login(a.code!,'UniqueStorePassword!');
  });
  await test('reset restores initial password and revokes the previous session',async()=>{
   await request(`/api/admin/stores/${a.id}/pos-password/reset`,{},superToken);
   await request('/api/v1/pos/context',undefined,tokenA,401);await login(a.code!,'UniqueStorePassword!',401);
   tokenA=(await login(a.code!,'123456')).token;
  });
  await test('access status changes independently; disabled/inactive stores and sessions are denied',async()=>{
   await request(`/api/admin/stores/${a.id}/pos-access`,{posEnabled:false},superToken,200,'PATCH');
   await login(a.code!,'123456',403);await request('/api/v1/pos/context',undefined,tokenA,403);
   await creds(a.id,{password:'StillDisabledPassword!'});
   assert.equal((await prisma.pOSStoreCredential.findUniqueOrThrow({where:{storeId:a.id}})).posEnabled,false);
   await request(`/api/admin/stores/${a.id}/pos-password/reset`,{},superToken);await login(a.code!,'123456',403);
   await request(`/api/admin/stores/${a.id}/pos-access`,{posEnabled:true},superToken,200,'PATCH');tokenA=(await login(a.code!,'123456')).token;
   await login(disabled.code!,'ExistingPrivatePassword!',403);await login(inactive.code!,'123456',403);await login(b.code!,'123456');
  });
  await test('credentials and public/store metadata never expose plaintext or password hashes',async()=>{
   const list=await request('/api/admin/stores',undefined,superToken);const row=list.data.find((s:{id:number})=>s.id===a.id);assert(row.posCredential);assert.equal(row.posCredential.posEnabled,true);assert(!JSON.stringify(list).includes('123456'));
   const publicStores=await request('/api/v1/pos/auth/stores');assert(!publicStores.data.some((s:{id:number})=>s.id===disabled.id||s.id===inactive.id));
   await creds(a.id,{password:'too short',posEnabled:'true'},400);await creds(a.id,{password:'x'.repeat(73)},400);
  });
  await test('store token cannot access HRM APIs or exchange itself through legacy HRM refresh',async()=>{
   await request('/api/admin/stores',undefined,tokenA,403);
   await request('/api/auth/refresh',{},tokenA,401);
   await request('/api/auth/login',{email:`pos-store-${a.id}@hopkid.local`,password:'123456'},undefined,401);
  });
  await test('store identity is derived from token and cross-store sale/payment/receipt access is rejected',async()=>{
   const context=await request('/api/v1/pos/context?storeId='+b.id,undefined,tokenA);assert.equal(context.data.actor.storeId,a.id);assert.deepEqual(context.data.stores.map((s:{id:number})=>s.id),[a.id]);
   await request(`/api/v1/pos/products/lookup?storeId=${b.id}&code=x`,undefined,tokenA,403);
   await request('/api/v1/pos/sales',{storeId:b.id,sessionId:randomUUID(),idempotencyKey:randomUUID(),items:[{variantId:randomUUID(),quantity:1}],payments:[{method:'CASH',amount:'1'}]},tokenA,403);
   const actor:Actor={userId:superAdmin.id,role:'SUPER_ADMIN',permissions:{},admin:true};
   const product=await service.createProduct(actor,{name:'Isolation '+suffix,code:'ISO-'+suffix,variants:[{sku:'ISO-'+suffix,costPrice:'50',sellingPrice:'100',taxRate:'5'}]});
   const v=product.variants[0]!;await service.adjust(actor,{storeId:b.id,variantId:v.id,quantityDelta:2,type:'OPENING',reason:'Test fixture'});
   const register=await prisma.pOSRegister.create({data:{storeId:b.id,name:'Isolation'}});const session=await service.openRegister(actor,register.id,{openingCash:'100'});
   const sale=await service.checkout(actor,{storeId:b.id,sessionId:session.id,idempotencyKey:randomUUID(),items:[{variantId:v.id,quantity:1}],payments:[{method:'CASH',amount:'105'}]});
   await request('/api/v1/pos/sales/'+sale.id,undefined,tokenA,403);
   await request('/api/v1/pos/payments/'+sale.payments[0]!.id+'/reconcile',{status:'RECONCILED',reason:'Cross-store test'},tokenA,403);
   await request('/api/v1/pos/sales/'+sale.id,undefined,tokenB);
   await request('/api/v1/pos/context',undefined,undefined,401);
  });
  await test('password and access changes are audited without secrets',async()=>{
   const logs=await prisma.activityLog.findMany({where:{entityType:'Store',entityId:String(a.id)}});
   assert(logs.some(l=>l.action==='SET_STORE_POS_CREDENTIALS'));assert(logs.some(l=>l.action==='RESET_STORE_POS_PASSWORD'));assert(logs.some(l=>l.action==='UPDATE_STORE_POS_ACCESS'));assert(!JSON.stringify(logs).includes('UniqueStorePassword!'));
  });
  await test('failed logins lock the store persistently after five attempts',async()=>{
   const attempts=await Promise.all(Array.from({length:5},()=>fetch(origin+'/api/v1/pos/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeCode:b.code,password:'IncorrectPassword'})})));
   assert.equal(attempts.filter(r=>r.status===401).length,4);assert.equal(attempts.filter(r=>r.status===429).length,1);
   await login(b.code!,'123456',429);
   assert((await prisma.pOSStoreCredential.findUniqueOrThrow({where:{storeId:b.id}})).lockedUntil);
  });
  await test('IP limiter also bounds unknown-store attempts',async()=>{
   let limited=false;for(let i=0;i<31;i++){const response=await fetch(origin+'/api/v1/pos/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeCode:'UNKNOWN-'+suffix,password:'wrong'})});if(response.status===429){limited=true;break;}assert.equal(response.status,401);}assert(limited);
  });
  console.log(`PASS ${count} real store POS authentication checks`);
 }finally{await new Promise<void>(r=>server.close(()=>r()));await prisma.$disconnect();}
}
run().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
