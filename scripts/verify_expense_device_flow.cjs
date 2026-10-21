// Opt-in: real local API/PostgreSQL/FCM/Android test in a disposable schema.
// Reads the connected debug app's token internally; never prints it. Production
// settings, data and registrations are not touched. Does not test production navigation.
const assert=require('node:assert/strict');const fs=require('node:fs');const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');const Module=require('node:module');
require('dotenv').config({quiet:true});require('ts-node/register/transpile-only');
const {Pool,Client}=require('pg');const{PrismaClient}=require('@prisma/client');const{PrismaPg}=require('@prisma/adapter-pg');
const express=require('express');const{createServer}=require('node:http');const{once}=require('node:events');
const adb=(...args)=>execFileSync('adb',args,{encoding:'utf8',maxBuffer:30*1024*1024});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
 assert(['localhost','127.0.0.1','[::1]'].includes(new URL(process.env.DATABASE_URL).hostname),'Local DB only');
 const prefs=adb('shell','run-as','org.quickboom.hrm','cat','shared_prefs/FlutterSharedPreferences.xml');
 const token=prefs.match(/<string name="flutter\.fcm_token">([^<]+)<\/string>/)?.[1];assert(token,'No current Android token');
 const schema=`hrm_expense_test_${crypto.randomBytes(5).toString('hex')}`;const sql=new Client({connectionString:process.env.DATABASE_URL});await sql.connect();
 let prisma,server;
 try{
  await sql.query(`CREATE SCHEMA "${schema}"`);
  for(const table of ['User','Employee','Profile','Department','Office','Store','Expense','Notification','FCMToken','devices','UserPermission','RolePermission']){
   await sql.query(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
   // Own fixture sequences, so no public sequence or row is changed.
   const sequence=`${table}_fixture_seq`;
   await sql.query(`CREATE SEQUENCE "${schema}"."${sequence}" START ${1600000000+crypto.randomInt(100000000)}`);
   await sql.query(`ALTER TABLE "${schema}"."${table}" ALTER COLUMN id SET DEFAULT nextval('"${schema}"."${sequence}"')`);
  }
  const labels = (await sql.query("SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='Role' ORDER BY enumsortorder")).rows.map(row => "'"+row.enumlabel.replace(/'/g,"''")+"'");
  await sql.query(`CREATE TYPE "${schema}"."Role" AS ENUM (${labels.join(',')})`);
  for(const table of ['User','RolePermission']) {
    await sql.query(`ALTER TABLE "${schema}"."${table}" ALTER COLUMN role DROP DEFAULT`);
    await sql.query(`ALTER TABLE "${schema}"."${table}" ALTER COLUMN role TYPE "${schema}"."Role" USING role::text::"${schema}"."Role"`);
  }
  await sql.query(`ALTER TABLE "${schema}"."User" ALTER COLUMN role SET DEFAULT 'EMPLOYEE'`);
  await sql.query(`SET search_path TO "${schema}",public`);
  await sql.query('ALTER TABLE "Expense" DROP COLUMN IF EXISTS "submissionKey"');
  await sql.query(fs.readFileSync('prisma/migrations/20261022000100_expense_submission_key/migration.sql','utf8'));
  const pool=new Pool({connectionString:process.env.DATABASE_URL});
  prisma=new PrismaClient({adapter:new PrismaPg(pool,{schema,disposeExternalPool:true})});
  await prisma.user.createMany({data:[{id:100,email:'owner@expense-test.invalid',password:'test-only',role:'EMPLOYEE'},{id:900,email:'reviewer@expense-test.invalid',password:'test-only',role:'HR'},{id:901,email:'denied@expense-test.invalid',password:'test-only',role:'HR'}]});
  await prisma.employee.create({data:{id:50,userId:100,employeeCode:'EXPENSE_TEST_ONLY',firstName:'Expense',lastName:'Test',status:'active'}});
  await prisma.userPermission.create({data:{userId:901,permissions:{'pa-payroll':false}}});
  const load=Module._load;Module._load=function(r,p,i){
   if(/(?:^|\/)utils\/db$/.test(r)||r==='./db')return{prisma};
   if(/expenseReceiptService$/.test(r))return{expenseReceiptService:{generateExpenseReceipt:async()=>({relativeUrl:undefined})}};
   return load.call(this,r,p,i);
  };
  const{signAccessToken}=require('../src/utils/jwt');
  const app=express();app.use(express.json());
  app.use('/api/devices',require('../src/routes/deviceRoutes').default);
  app.use('/api/employee',require('../src/routes/employee/employeeRoutes').default);
  app.use('/api/hr',require('../src/routes/hr/hrRoutes').default);
  server=createServer(app);server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  const ownerJwt=signAccessToken({id:100,role:'EMPLOYEE'}),reviewerJwt=signAccessToken({id:900,role:'HR'});
  const post=async(path,jwt,body)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${jwt}`},body:JSON.stringify(body)});return{status:r.status,body:await r.json()};};
  const register=async(jwt,value,previousToken)=>{const r=await post('/api/devices/register',jwt,{token:value,platform:'android',previousToken});assert.equal(r.status,200);};
  const claim=key=>({requestId:key,category:'TRAVEL',amount:123.45,description:'Controlled isolated expense device test',date:'2026-10-22'});
  const tray=async(title,id)=>{
   for(let attempt=0;attempt<20;attempt++){
    const dump=adb('shell','dumpsys','notification','--noredact');
    const records=dump.split(/(?=NotificationRecord\()/).filter(block=>block.startsWith('NotificationRecord(')&&block.split('\n',1)[0].includes('pkg=org.quickboom.hrm ')&&block.includes(title)&&block.includes(`#${id}`));
    if(records.length)return{count:records.length,channel:records[0].match(/channel=([^\s]+)/)?.[1]};
    await pause(1000);
   }return{count:0};
  };
  // Keep Android in the background so Firebase owns system-tray display.
  adb('shell','monkey','-p','org.quickboom.hrm','-c','android.intent.category.LAUNCHER','1');await pause(2000);
  adb('shell','input','keyevent','KEYCODE_HOME');await pause(1000);
  await register(reviewerJwt,token);
  const first=await post('/api/employee/expenses',ownerJwt,claim('device-submission-001'));assert.equal(first.status,201);
  const id=Number(first.body.expense.id);let history=await prisma.notification.findMany({where:{actionId:String(id)}});
  assert.equal(history.length,1);assert.equal(history[0].userId,900);assert.equal(history[0].deliveryStatus,'SENT');assert(history[0].fcmMessageId);
  let android=await tray('Expense Claim Submitted',id);assert.equal(android.count,1);
  console.log(JSON.stringify({case:'submission',api:'POST /api/employee/expenses',recipientUserId:900,dbStatus:history[0].deliveryStatus,messageId:history[0].fcmMessageId,android}));
  const replay=await post('/api/employee/expenses',ownerJwt,claim('device-submission-001'));assert.equal(replay.body.replayed,true);assert.equal(await prisma.expense.count(),1);assert.equal(await prisma.notification.count(),1);
  await register(ownerJwt,token);
  const approved=await post(`/api/hr/expenses/${id}/approve`,reviewerJwt,{reviewerName:'Isolated HR test'});assert.equal(approved.status,200);assert.equal(approved.body.notificationDelivery.deliveryStatus,'SENT');
  android=await tray('Expense Claim Approved',id);assert.equal(android.count,1);
  console.log(JSON.stringify({case:'approval',api:'POST /api/hr/expenses/:id/approve',recipientUserId:100,dbStatus:approved.body.notificationDelivery.deliveryStatus,messageId:approved.body.notificationDelivery.fcmMessageId,android}));
  const repeat=await post(`/api/hr/expenses/${id}/approve`,reviewerJwt,{});assert.equal(repeat.body.replayed,true);assert.equal(await prisma.notification.count({where:{actionId:String(id),userId:100}}),1);
  const second=await post('/api/employee/expenses',ownerJwt,claim('device-submission-002'));const id2=Number(second.body.expense.id);
  const rejected=await post(`/api/hr/expenses/${id2}/reject`,reviewerJwt,{reviewNote:'Controlled rejection test'});assert.equal(rejected.status,200);assert.equal(rejected.body.notificationDelivery.deliveryStatus,'SENT');
  android=await tray('Expense Claim Rejected',id2);assert.equal(android.count,1);
  console.log(JSON.stringify({case:'rejection',api:'POST /api/hr/expenses/:id/reject',recipientUserId:100,dbStatus:rejected.body.notificationDelivery.deliveryStatus,messageId:rejected.body.notificationDelivery.fcmMessageId,android}));
  const third=await post('/api/employee/expenses',ownerJwt,claim('device-submission-003'));const id3=Number(third.body.expense.id);
  await register(ownerJwt,'controlled-invalid-expense-token',token);
  const failed=await post(`/api/hr/expenses/${id3}/approve`,reviewerJwt,{});assert.equal(failed.status,200);assert.equal(failed.body.notificationDelivery.deliveryStatus,'FAILED');assert.equal(failed.body.notificationDelivery.fcmMessageId,null);assert(failed.body.notificationDelivery.failureReason);
  const persisted=await prisma.notification.findUniqueOrThrow({where:{id:failed.body.notificationDelivery.notificationId}});assert.equal(persisted.deliveryStatus,'FAILED');
  assert.equal(await prisma.device.count({where:{userId:100}}),0);
  assert.equal(await prisma.fCMToken.count({where:{userId:100,isActive:true}}),0);
  console.log(JSON.stringify({case:'FCM failure',api:'POST /api/hr/expenses/:id/approve',recipientUserId:100,dbStatus:persisted.deliveryStatus,messageId:null,actualFirebaseError:persisted.failureReason,android:'No valid device targeted; no successful delivery claimed'}));
  console.log('PASS real authenticated expense APIs, isolated PostgreSQL migration/history/registrations, actual Firebase sends and physical Android tray for all three successful cases. Production and physical detail navigation unverified.');
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));if(prisma)await prisma.$disconnect();
  await sql.query('SET search_path TO public');await sql.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await sql.end();
  console.log('Temporary local test schema and fixture registrations removed; public/production data untouched.');
 }
}
main().then(()=>process.exit(0)).catch(error=>{console.error({name:error.name,code:error.code,message:String(error.message).slice(0,400)});process.exit(1);});
