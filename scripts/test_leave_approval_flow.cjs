const assert = require('node:assert/strict');
const Module = require('node:module');
require('ts-node/register/transpile-only');
let leave, records, sends, deductions, outcome;
const snapshot = () => ({...leave,employee:{...leave.employee}});
const db={
 leaveRequest:{
  findUnique:async()=>snapshot(),findUniqueOrThrow:async()=>snapshot(),
  updateMany:async({where,data})=>{if(leave.status!==where.status)return{count:0};Object.assign(leave,data);return{count:1};},
 },
 notification:{create:async({data})=>{const row={id:records.length+1,...data};records.push(row);return row;},update:async({where,data})=>Object.assign(records.find(r=>r.id===where.id),data)},
 attendance:{findFirst:async()=>({id:1}),update:async()=>({}),create:async()=>({})},
 user:{findUnique:async()=>({email:'reviewer@example.test'})},
};db.$transaction=async fn=>fn(db);
const load=Module._load;
Module._load=function(r,p,i){
 if(/(?:^|\/)utils\/db$/.test(r)||r==='./db')return{prisma:db};
 if(/leaveBalanceService$/.test(r))return{__esModule:true,default:{updateUsedLeave:async(...args)=>deductions.push(args),getEmployeeLeaveBalance:async()=>({})}};
 if(/websocketSingleton$/.test(r))return{getWebSocketInstance:()=>new Proxy({},{get:()=>async()=>{}})};
 if(/firebaseNotificationService$/.test(r))return{firebaseNotificationService:{sendNotificationToUser:async(...args)=>{sends.push(args);await new Promise(resolve=>setTimeout(resolve,5));if(outcome instanceof Error)throw outcome;return outcome;}}};
 if(/hrNotificationHelper$/.test(r)&&r!=='../src/utils/hrNotificationHelper'){
  const real=load.call(this,r,p,i);return{...real,sendHRNotification:async()=>{}};
 }
 return load.call(this,r,p,i);
};
const mobile=require('../src/controllers/mobile/mobileLeaveController');
const hr=require('../src/controllers/hr/hrController');
const admin=require('../src/controllers/adminController');
const response=()=>({code:200,body:null,status(c){this.code=c;return this;},json(b){this.body=b;return this;}});
function reset(){
 leave={id:207,employeeId:50,type:'CASUAL',status:'PENDING',fromDate:new Date('2026-11-10'),toDate:new Date('2026-11-10'),employee:{id:50,userId:100,officeId:1,firstName:'Test',lastName:'Employee'}};
 records=[];sends=[];deductions=[];outcome={successCount:1,failureCount:0,responses:[{success:true,messageId:'accepted-message-id'}]};
}
const request=status=>({params:{id:'207'},user:{id:900,role:'HR',email:'reviewer@example.test'},body:{status,reviewerName:'Test Reviewer',reviewNote:'Controlled test'}});
(async()=>{
 for(const [name,handler,status] of [
  ['mobile approval',mobile.approveLeaveRequest,'APPROVED'],['HR approval',hr.approveLeave,'APPROVED'],
  ['mobile rejection',mobile.rejectLeaveRequest,'REJECTED'],['HR rejection',hr.rejectLeave,'REJECTED'],
  ['admin approval',admin.updateAdminLeaveStatus,'APPROVED'],['admin rejection',admin.updateAdminLeaveStatus,'REJECTED'],
 ]){
  reset();const r=response();await handler(request(status),r);
  assert.equal(r.code,200,name);assert.equal(leave.status,status);
  assert.equal(sends.length,1,name);assert.equal(sends[0][0],100,'Send to employee, not approver 900');
  assert.equal(records.length,1);assert.equal(records[0].userId,100);
  assert.equal(records[0].deliveryStatus,'SENT');assert.equal(records[0].fcmMessageId,'accepted-message-id');
  assert.equal(r.body.notificationDelivery.deliveryStatus,'SENT');
  assert.equal(sends[0][3].actionId,'207');assert(Object.values(sends[0][3]).every(v=>typeof v==='string'));
  if(status==='APPROVED')assert.equal(deductions.length,1,'Deduct leave balance once');
  await handler(request(status),response());assert.equal(sends.length,1,'Retry must not send again');assert.equal(records.length,1);
  console.log('PASS',name,'employee targeting, awaited acceptance, history and retry deduplication');
 }
 reset();await Promise.all([mobile.approveLeaveRequest(request('APPROVED'),response()),hr.approveLeave(request('APPROVED'),response())]);
 assert.equal(sends.length,1);assert.equal(records.length,1);assert.equal(deductions.length,1);
 console.log('PASS concurrent mobile/HR approvals claim one transition and send once');
 reset();outcome={successCount:0,failureCount:1,responses:[{success:false,error:{code:'messaging/registration-token-not-registered'}}]};
 const r=response();await mobile.approveLeaveRequest(request('APPROVED'),r);
 assert.equal(r.body.success,true,'Approval may succeed while push fails');assert.equal(r.body.notificationDelivery.deliveryStatus,'FAILED');
 assert.equal(records[0].failureReason,'messaging/registration-token-not-registered');assert.equal(records[0].fcmMessageId,null);
 console.log('PASS approval success explicitly reports FCM rejection rather than push success');
 reset();outcome=Object.assign(new Error('Credential file unavailable'),{code:'firebase/credential-file-unreadable'});
 await mobile.approveLeaveRequest(request('APPROVED'),response());assert.equal(records[0].deliveryStatus,'FAILED');assert.equal(records[0].failureReason,outcome.code);
 console.log('PASS exact safe credential error recorded by actual approval/notification flow');
 reset();
 const auto=require('../src/services/leaveManagementService').default;
 auto.getLeavePolicies=async()=>[{leaveType:'CASUAL'}];
 auto.getEmployeeLeaveBalances=async()=>[{leaveType:'CASUAL',remainingDays:10}];
 assert.equal(await auto.autoApproveLeave(207),true);
 assert.equal(records.length,1);assert.equal(sends.length,1);assert.equal(sends[0][0],100);
 assert.equal(records[0].deliveryStatus,'SENT');
 assert.equal(await auto.autoApproveLeave(207),false);assert.equal(sends.length,1);
 console.log('PASS auto-approval now sends FCM to the employee once instead of saving only in-app history');

})().catch(error=>{console.error(error);process.exitCode=1;});
