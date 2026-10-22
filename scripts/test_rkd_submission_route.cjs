const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');
const ts = require('typescript');
require('ts-node/register/transpile-only');
// Isolated ephemeral JWT signing key; never read or print production credentials.
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
const jwt = require('jsonwebtoken');
const express = require('express');
let rows = [], notifications = [], failInsert = false;
const sales = {id:10,userId:100,employeeCode:'HK-10',firstName:'Test',lastName:'Sales',designation:'Sales Executive',department:{name:'Sales'},user:{role:'SALESMAN'}};
const nonSales = {id:20,userId:200,employeeCode:'EMP-20',firstName:'Test',lastName:'Employee',designation:'Developer',department:{name:'Engineering'},user:{role:'EMPLOYEE'}};
const db = {
 user:{findUnique:async({where})=>({id:where.id,isActive:true,role:where.id===100?'SALESMAN':'EMPLOYEE',employee:{status:'ACTIVE'}})},
 employee:{findUnique:async({where})=>where.userId===100?sales:where.userId===200?nonSales:null},
 rkdRequest:{
  findFirst:async({where})=>rows.find(r=>r.employeeId===where.employeeId&&r.saleReference===where.saleReference&&where.status.in.includes(r.status))||null,
  findUnique:async({where})=>rows.find(r=>r.submissionKey===where.submissionKey)||null,
  findUniqueOrThrow:async({where})=>{const r=rows.find(r=>r.submissionKey===where.submissionKey);if(!r)throw Error('Missing fixture');return r;},
  create:async({data})=>{if(failInsert)throw Error('TEST_INSERT_FAILED');const r={id:rows.length+1,createdAt:new Date('2026-10-22T04:39:00.000Z'),isSalaryCredited:false,...data};rows.push(r);return{...r,employee:sales};},
 },
};
// Model transaction-scoped advisory lock blocking for concurrent route tests.
const saleLocks = new Map();
db.$transaction=async fn=>{
 const releases=[];
 const tx={...db,$queryRaw:async (_sql,key)=>{
  const previous=saleLocks.get(key)||Promise.resolve();
  let release;const held=new Promise(resolve=>{release=resolve;});
  const tail=previous.then(()=>held);saleLocks.set(key,tail);
  await previous;releases.push(()=>{release();if(saleLocks.get(key)===tail)saleLocks.delete(key);});
  return [];
 }};
 try{return await fn(tx);}finally{releases.forEach(release=>release());}
};
const load=Module._load;
Module._load=function(name,parent,isMain){
 if(/(?:^|\/)utils\/db$/.test(name)||name==='./db')return{prisma:db,ensureRkdTable:async()=>{}};
 if(/hrNotificationHelper$/.test(name))return{sendHRNotification:async p=>{assert(rows.some(r=>String(r.id)===p.actionId));notifications.push(p);return[];},notifyEmployee:async()=>{throw Error('Submission must not notify salary/wallet payment');}};
 return load.call(this,name,parent,isMain);
};
const routeRoot = process.argv.includes('--compiled') ? '../dist/routes' : '../src/routes';
const routers = {
 employeeRoutes: require(`${routeRoot}/employee/employeeRoutes`).default,
 employeeLegacyRoutes: require(`${routeRoot}/employee/employeeLegacyRoutes`).default,
 employeeRkdRouter: require(`${routeRoot}/rkdRoutes`).employeeRkdRouter,
};
Module._load=load;
// Use the real index.ts mount literals AND order rather than a duplicate test URL configuration.
const index=ts.createSourceFile('index.ts',fs.readFileSync(path.join(__dirname,'../src/index.ts'),'utf8'),ts.ScriptTarget.Latest,true);
const mounts=[];
for(const statement of index.statements){
 if(!ts.isExpressionStatement(statement)||!ts.isCallExpression(statement.expression))continue;
 const call=statement.expression;
 if(!ts.isPropertyAccessExpression(call.expression)||call.expression.expression.getText(index)!=='app'||call.expression.name.text!=='use')continue;
 const [prefix,router]=call.arguments;
 if(prefix&&ts.isStringLiteral(prefix)&&router&&ts.isIdentifier(router)&&router.text in routers)mounts.push([prefix.text,router.text]);
}
assert.equal(mounts.filter(([prefix,name])=>prefix==='/api/employee/rkd'&&name==='employeeRkdRouter').length,1,'Register the existing RKD router exactly once');
if (process.argv.includes('--compiled')) {
 const compiled = ts.createSourceFile('index.js', fs.readFileSync(path.join(__dirname,'../dist/index.js'),'utf8'),ts.ScriptTarget.Latest,true);
 const prefixes = new Set(mounts.map(([prefix])=>prefix));
 const compiledOrder = [];
 for (const statement of compiled.statements) {
  if (!ts.isExpressionStatement(statement)||!ts.isCallExpression(statement.expression)) continue;
  const call = statement.expression;
  if (!ts.isPropertyAccessExpression(call.expression)||call.expression.expression.getText(compiled)!=='app'||call.expression.name.text!=='use') continue;
  const prefix=call.arguments[0];
  if (prefix&&ts.isStringLiteral(prefix)&&prefixes.has(prefix.text)) compiledOrder.push(prefix.text);
 }
 assert.deepEqual(compiledOrder,mounts.map(([prefix])=>prefix),'Built main app must mount the same RKD router before broad employee middleware');
}

const flutter=fs.readFileSync(path.join(__dirname,'../../QuickBoom-HRM-App/lib/core/constants/app_url.dart'),'utf8');
assert.match(flutter,/employeeRkd\s*=\s*['"]\/api\/employee\/rkd['"]/);
const app=express();app.use(express.json());for(const [prefix,name]of mounts)app.use(prefix,routers[name]);
const body={productName:'xyz',quantity:1,commissionAmount:500.0,saleReference:null,particulars:'na',requestId:'rkd-1792642731145-22408'};
const token=id=>jwt.sign({id,role:id===100?'SALESMAN':'EMPLOYEE'},process.env.JWT_SECRET,{expiresIn:'1m'});
(async()=>{
 const server=app.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
 try{
  const url=`http://127.0.0.1:${server.address().port}/api/employee/rkd`;
  const post=async(payload,auth=token(100))=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:`Bearer ${auth}`}:{})},body:JSON.stringify(payload)});
  assert.equal((await post(body,null)).status,401);assert.equal(rows.length,0);
  assert.equal((await post(body,'invalid-test-token')).status,401);
  assert.equal((await post(body,token(200))).status,403);assert.equal(rows.length,0);
  let response=await post(body);
  const submissionText=await response.text();
  assert.equal(response.status,201,submissionText);
  const submission=JSON.parse(submissionText);
  assert.equal(submission.rkd.createdAt,'2026-10-22T04:39:00.000Z');
  if(process.argv.includes('--timestamp-fixture')) {
   fs.writeFileSync(path.join(__dirname,'../../QuickBoom-HRM-App/test/fixtures/rkd_timestamp_api.json'),JSON.stringify(submission.rkd,null,2)+'\n');
  }
  assert.equal(rows.length,1);assert.equal(rows[0].employeeId,10);assert.equal(rows[0].status,'PENDING');assert.equal(rows[0].saleReference,null);assert.equal(rows[0].isSalaryCredited,false);assert.equal(notifications.length,1);
  response=await post(body);assert.equal(response.status,201);assert.equal(rows.length,1);assert.equal(notifications.length,1);
  response=await post({...body,commissionAmount:600});assert.equal(response.status,409);assert.equal(rows.length,1);
  response=await post({...body,requestId:'spoof-test',employeeId:999,userId:999});assert.equal(response.status,201);assert.equal(rows.at(-1).employeeId,10);
  for(const invalid of [{quantity:1.5},{quantity:'1x'},{quantity:[1]},{quantity:0},{commissionAmount:'Infinity'},{commissionAmount:'500x'},{commissionAmount:{}},{saleReference:[]},{requestId:{}},{requestId:[]},{requestId:' '},{productName:[]},{particulars:[]}]){
   response=await post({...body,requestId:`invalid-${crypto.randomUUID()}`,...invalid});assert.equal(response.status,400,JSON.stringify(invalid));
  }
  assert.equal(rows.length,2);assert.equal(notifications.length,2);
  const referenced = {...body,requestId:'referenced-request',saleReference:'SALE-ROUTE-1'};
  assert.equal((await post(referenced)).status,201);
  assert.equal((await post(referenced)).status,201);
  const duplicate=await post({...referenced,requestId:'different-request'});
  assert.equal(duplicate.status,400);
  const duplicateBody=await duplicate.json();
  assert.equal(duplicateBody.existingRequestId,3);
  assert.equal(duplicateBody.errorCode,'rkd/duplicate-sale-reference');
  assert.match(duplicateBody.message,/SALE-ROUTE-1/);
  assert.equal(rows.length,3);assert.equal(notifications.length,3);
  const beforeConcurrent=rows.length;
  const sameSale={...body,saleReference:'CONCURRENT-SALE',requestId:'concurrent-a'};
  const competing=await Promise.all([post(sameSale),post({...sameSale,requestId:'concurrent-b'})]);
  assert.deepEqual(competing.map(r=>r.status).sort(),[201,400]);
  assert.equal(rows.length,beforeConcurrent+1);
  const sameRetry={...body,saleReference:'CONCURRENT-RETRY',requestId:'concurrent-retry'};
  const retries=await Promise.all([post(sameRetry),post(sameRetry)]);
  assert.deepEqual(retries.map(r=>r.status),[201,201]);
  assert.equal(rows.length,beforeConcurrent+2);
  assert.equal(notifications.length,5);
  failInsert=true;response=await post({...body,requestId:'insert-failure'});assert.equal(response.status,500);assert.equal(notifications.length,5);
  console.log('PASS real HTTP POST /api/employee/rkd using index.ts mount order, real router/auth/controller/service; exact Flutter body returns 201/PENDING, optional null reference, token-derived employee, sales authorization, validation, replay/conflict and failed-save notification checks. DB/FCM mocked; no external writes.');
 }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
