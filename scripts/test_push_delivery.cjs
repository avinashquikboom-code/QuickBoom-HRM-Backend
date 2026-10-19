const assert = require('node:assert/strict');
const Module = require('node:module');
require('ts-node/register/transpile-only');
let records = [], calls = [], queries = [], outcome = { responses: [{ success: true, messageId: 'mock-id' }], successCount: 1, failureCount: 0 };
const fake = {
  notification: { create: async ({data}) => { const row = { id: records.length+1,...data }; records.push(row); return row; }, update: async ({where,data}) => Object.assign(records.find(n=>n.id===where.id),data) },
  employee: { findFirst: async q => { queries.push(q); return { id: 10, userId: 100 }; }, findMany: async q => { queries.push(q); return [{id:10,userId:100},{id:11,userId:101}]; } },
  user: { findMany: async q => { queries.push(q); return [{id:100,employee:{id:10}}]; } },
  announcement: { create: async ({data}) => ({id:5,...data}) },
};
const sender = { sendNotificationToUser: async (...args) => { calls.push(args); if (outcome instanceof Error) throw outcome; return outcome; } };
const load = Module._load;
Module._load = function(request,parent,isMain){
  if (/\/utils\/db$/.test(request)) return { prisma:fake };
  if (/(?:^|\/)firebaseNotificationService$/.test(request)) return {firebaseNotificationService:sender};
  return load.call(this,request,parent,isMain);
};
const {persistAndPush}=require('../src/services/employeePushDelivery');
const hr=require('../src/controllers/hr/hrNotificationController');
const admin=require('../src/controllers/adminController');
const res=()=>({statusCode:200,body:null,status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}});
const content={title:'Test title',body:'Test body',category:'GENERAL'};
let passed=0;
async function test(name,fn){records=[];calls=[];queries=[];await fn();passed++;console.log('PASS',name);}
(async()=>{
 await test('FCM acceptance recorded separately from device delivery',async()=>{const s=await persistAndPush([{id:10,userId:100}],content);assert.equal(s.acceptedTokens,1);assert.equal(records[0].deliveryStatus,'SENT');assert.equal(records[0].fcmMessageId,'mock-id');assert.equal(calls[0][3].id,'1');});
 await test('overlapping recipients produce one history row and one push',async()=>{await persistAndPush([{id:10,userId:100},{id:10,userId:100}],content);assert.equal(records.length,1);assert.equal(calls.length,1);});
 await test('no registered token is IN_APP_ONLY rather than sent',async()=>{outcome={responses:[],successCount:0,failureCount:0};const s=await persistAndPush([{id:10,userId:100}],content);assert.equal(s.noTokenRecipients,1);assert.equal(records[0].deliveryStatus,'IN_APP_ONLY');});
 await test('partial provider failures remain visible in response and history',async()=>{outcome={responses:[{success:true,messageId:'accepted'},{success:false,error:{code:'messaging/registration-token-not-registered'}}],successCount:1,failureCount:1};const s=await persistAndPush([{id:10,userId:100}],content);assert.equal(s.failedRecipients,1);assert.equal(records[0].deliveryStatus,'PARTIAL');});
 await test('missing Firebase credentials cannot be reported as accepted',async()=>{outcome=Object.assign(new Error('configuration missing'),{code:'messaging/not-configured'});const s=await persistAndPush([{id:10,userId:100}],content);assert.equal(s.acceptedTokens,0);assert.equal(records[0].deliveryStatus,'FAILED');});
 await test('transport exception is unverified and not retried',async()=>{outcome=new Error('timeout');const s=await persistAndPush([{id:10,userId:100}],content);assert.equal(s.unknownRecipients,1);assert.equal(calls.length,1);assert.equal(records[0].deliveryStatus,'UNKNOWN');});
 outcome={responses:[{success:true,messageId:'accepted'}],successCount:1,failureCount:0};
 await test('individual endpoint awaits provider and preserves notification response',async()=>{let r=res();await hr.sendNotification({body:{employeeId:10,...content}},r);assert.equal(r.statusCode,201);assert.equal(r.body.notification.id,1);assert.equal(r.body.delivery.acceptedTokens,1);assert(queries[0].where.status);});
 await test('department resolves eligible employees and uses their device-aware user sender',async()=>{let r=res();await admin.sendNotificationToDepartment({body:{departmentId:2,...content}},r);assert.equal(r.statusCode,200);assert.deepEqual(calls.map(c=>c[0]),[100,101]);assert.equal(records[0].employeeId,10);assert.deepEqual(queries[0].where.user,{isActive:true});});
 await test('role targets resolved users rather than a second unrelated recipient query',async()=>{let r=res();await admin.sendNotificationToRole({body:{role:'EMPLOYEE',...content}},r);assert.equal(r.statusCode,200);assert.deepEqual(calls.map(c=>c[0]),[100]);assert.equal(records[0].employeeId,10);});
 await test('broadcast targets all eligible resolved employees including non-EMPLOYEE roles',async()=>{let r=res();await hr.broadcastAnnouncement({user:{email:'test@example.test'},body:content},r);assert.equal(r.statusCode,201);assert.deepEqual(calls.map(c=>c[0]),[100,101]);assert.equal(records[0].actionType,'ANNOUNCEMENT');});
 await test('invalid role and employee IDs are rejected before persistence',async()=>{let r=res();await admin.sendNotificationToRole({body:{role:'INVALID',...content}},r);assert.equal(r.statusCode,400);r=res();await hr.sendNotification({body:{employeeId:'10bad',...content}},r);assert.equal(r.statusCode,400);assert.equal(records.length,0);});
 console.log(`${passed} push flow checks passed. FCM was mocked; no real pushes or database writes occurred.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
