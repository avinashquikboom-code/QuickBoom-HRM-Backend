const assert = require('node:assert/strict');
const Module = require('node:module');
require('ts-node/register/transpile-only');
const records = [], calls = [];
const prisma = {
 user: {findMany: async () => [{id:1,role:'HR'},{id:2,role:'HR'},{id:3,role:'HR'}]},
 userPermission: {findMany: async () => [{userId:3,permissions:{'pa-leave':false}}]},
 rolePermission: {findMany: async () => []},
 notification: {
  create: async ({data}) => {const row={id:records.length+1,...data};records.push(row);return row;},
  update: async ({where,data}) => Object.assign(records.find(r=>r.id===where.id),data),
 },
};
const originalLoad = Module._load;
Module._load=function(request,parent,isMain){
 if(request==='./db')return{prisma};
 if(request==='./websocketSingleton')return{getWebSocketInstance:()=>({sendToUser(){}})};
 if(request==='../services/firebaseNotificationService')return{firebaseNotificationService:{sendNotificationToUser:async(userId,title,body,data)=>{
  calls.push({userId,title,body,data});
  assert(Object.values(data).every(v=>typeof v==='string'));
  return userId===1?{successCount:1,failureCount:0,responses:[{success:true,messageId:'accepted-hr-1'}]}:{successCount:0,failureCount:1,responses:[{success:false,error:{code:'messaging/registration-token-not-registered'}}]};
 }}};
 return originalLoad.call(this,request,parent,isMain);
};
const{sendHRNotification}=require('../src/utils/hrNotificationHelper');
(async()=>{
 await sendHRNotification({employeeId:50,title:'New Leave Request',body:'Controlled test',category:'LEAVE',actionType:'LEAVE_APPLICATION',actionId:207});
 assert.equal(records.length,2);assert.deepEqual(calls.map(c=>c.userId),[1,2]);
 assert.equal(records[0].deliveryStatus,'SENT');assert.equal(records[0].fcmMessageId,'accepted-hr-1');
 assert.equal(records[1].deliveryStatus,'FAILED');assert.equal(records[1].fcmMessageId,null);
 assert.equal(records[1].failureReason,'messaging/registration-token-not-registered');
 assert.deepEqual(calls.map(c=>c.data.id),['1','2']);assert(calls.every(c=>c.data.actionId==='207'));
 console.log('PASS real leave HR helper preserves permissions, unique recipient notification IDs, awaited sends and isolated acceptance/rejection results. FCM/database mocked.');
})().catch(e=>{console.error(e);process.exitCode=1;});
