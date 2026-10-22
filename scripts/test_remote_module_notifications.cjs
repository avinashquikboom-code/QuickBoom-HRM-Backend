const assert = require('node:assert/strict');
const Module = require('node:module');
require('ts-node/register/transpile-only');
let remote, access, notices, sends, grants, permissions, failSave, failGrant, failFcm, ids;
const owner = {id:50, userId:100, employeeCode:'EMP50', firstName:'Test', lastName:'Employee'};
const users = [{id:100,role:'HR'}, {id:900,role:'HR'}, {id:901,role:'HR'}, {id:902,role:'EMPLOYEE'}];
const denied = {userId:901, permissions:{'pa-remote-work':false,'pa-access-requests':false}};
const matches = (row, where) => Object.entries(where).every(([key,value]) => {
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    if ('in' in value) return value.in.includes(row[key]);
    if ('not' in value) return row[key] !== value.not;
    if ('gte' in value && !(row[key] >= value.gte)) return false;
    if ('lte' in value && !(row[key] <= value.lte)) return false;
    return true;
  }
  return value instanceof Date ? +row[key] === +value : row[key] === value;
});
const db = {
 $queryRaw:async()=>[],
 employee:{findFirst:async()=>owner,findUnique:async({where})=> where.id === 999 ? null : owner},
 user:{findMany:async({where})=>users.filter(u=>where.role.in.includes(u.role))},
 userPermission:{
  findMany:async()=>[denied],
  findUnique:async({where})=>where.userId===901 ? denied : permissions[where.userId] || null,
  upsert:async({where,create,update})=>permissions[where.userId]={...(permissions[where.userId]||create),...update},
 },
 rolePermission:{findMany:async()=>[],findUnique:async()=>null},
 notification:{
  findFirst:async({where})=>notices.find(n=>matches(n,where))||null,
  create:async({data})=>{const n={id:++ids,createdAt:new Date(),...data};notices.push(n);return n;},
  update:async({where,data})=>Object.assign(notices.find(n=>n.id===where.id),data),
 },
 remoteWorkRequest:{
  findUnique:async({where})=>remote.find(r=>r.id===where.id)||null,
  findFirst:async({where})=>remote.find(r=>matches(r,where))||null,
  create:async({data})=>{if(failSave)throw Error('TEST_SAVE_FAILURE'); const r={id:`remote-${++ids}`,createdAt:new Date(),updatedAt:new Date(),...data};remote.push(r);return r;},
  update:async({where,data})=>{if(failSave)throw Error('TEST_SAVE_FAILURE');return Object.assign(remote.find(r=>r.id===where.id),data,{updatedAt:new Date()});},
  updateMany:async({where,data})=>{if(failSave)throw Error('TEST_SAVE_FAILURE');const r=remote.find(r=>matches(r,where));if(!r)return{count:0};Object.assign(r,data,{updatedAt:new Date()});return{count:1};},
 },
 featureAccessRequest:{
  findFirst:async({where})=>access.find(r=>matches(r,where))||null,
  findUnique:async({where})=>{const r=access.find(r=>r.id===where.id);return r?{...r,employee:owner}:null;},
  create:async({data})=>{if(failSave)throw Error('TEST_SAVE_FAILURE');const r={id:`access-${++ids}`,appliedOn:new Date(),...data};access.push(r);return{...r,employee:owner};},
  updateMany:async({where,data})=>{if(failSave)throw Error('TEST_SAVE_FAILURE');const r=access.find(r=>matches(r,where));if(!r)return{count:0};Object.assign(r,data);return{count:1};},
 },
 featureAccess:{upsert:async({where,create,update})=>{if(failGrant)throw Error('TEST_GRANT_FAILURE');const key=JSON.stringify(where);return grants[key]={...(grants[key]||create),...update};}},
 auditLog:{create:async()=>({})},
};
let queue=Promise.resolve();
db.$transaction=fn=>{const run=queue.then(async()=>{
 const snapshot=structuredClone({remote,access,notices,grants,permissions});
 try{return await fn(db);}catch(e){({remote,access,notices,grants,permissions}=snapshot);throw e;}
});queue=run.catch(()=>{});return run;};
const load=Module._load;
Module._load=function(r,p,i){
 if(/(?:^|\/)utils\/db$/.test(r)||r==='./db')return{prisma:db};
 if(/websocketSingleton$/.test(r))return{getWebSocketInstance:()=>({sendToUser(){},broadcastPermissionUpdate:async()=>{}})};
 if(/firebaseNotificationService$/.test(r))return{firebaseNotificationService:{sendNotificationToUser:async(...args)=>{
   assert(Object.values(args[3]).every(v=>typeof v==='string'));
   const type=args[3].actionType;
   if(type==='REMOTE_WORK_APPROVED'||type==='REMOTE_WORK_REJECTED')assert.equal(remote.find(r=>r.id===args[3].requestId).status,type.slice(12));
   if(type==='ACCESS_REQUEST_APPROVED'){assert.equal(access.find(r=>r.id===args[3].requestId).status,'APPROVED');assert(Object.keys(grants).length);}
   sends.push(args);
   return failFcm?{successCount:0,failureCount:1,responses:[{success:false,error:{code:'messaging/mismatched-credential'}}]}:
    {successCount:1,failureCount:0,responses:[{success:true,messageId:'accepted-test'}]};
 }}};
 return load.call(this,r,p,i);
};
const remoteController=require('../src/controllers/remoteWorkController');
const moduleController=require('../src/controllers/accessRequestController');
const featureController=require('../src/controllers/featureAccessController');
const permissionController=require('../src/controllers/permissionController');
const mobileController=require('../src/controllers/mobile/mobileFeatureAccessController');
const {requireRequestApprover}=require('../src/utils/requestApprovalPermissions');
const res=()=>({code:200,status(c){this.code=c;return this;},json(b){this.body=b;return this;}});
const req=(body={},params={},id=100,role='EMPLOYEE')=>({body,params,user:{id,role},headers:{},ip:'127.0.0.1'});
const reset=()=>{remote=[];access=[];notices=[];sends=[];grants={};permissions={};failSave=false;failGrant=false;failFcm=false;ids=0;};
const period={fromDate:'2026-10-23',toDate:'2026-10-24',reason:'Controlled test'};
const moduleBody={featureName:'Attendance',reason:'Controlled test',requestedFromDate:'2026-10-23',requestedToDate:'2026-10-24'};
const fixture=()=>({id:'access-fixture',employeeId:50,featureName:'Attendance',status:'PENDING',requestedFromDate:new Date('2026-10-23'),requestedToDate:new Date('2026-10-24')});
(async()=>{
 reset();await Promise.all([remoteController.applyRemoteWork(req(period),res()),remoteController.applyRemoteWork(req(period),res())]);
 assert.equal(remote.length,1);assert.deepEqual(sends.map(s=>s[0]),[900]);assert.equal(notices.length,1);assert.equal(notices[0].deliveryStatus,'SENT');assert(sends[0][2].includes('2026-10-23'));assert(sends[0][2].includes('Test Employee'));assert.equal(sends[0][3].screen,'/remote-work');
 console.log('PASS remote submission: persisted request, permitted approver only, no self/denied-role recipient, date/reference, concurrent dedup');
 reset();failSave=true;await remoteController.applyRemoteWork(req(period),res());assert.equal(notices.length,0);assert.equal(sends.length,0);
 for(const status of ['APPROVED','REJECTED']){
  reset();await remoteController.applyRemoteWork(req(period),res());notices=[];sends=[];
  const review=req({status},{id:remote[0].id},900,'HR');
  await Promise.all([remoteController.reviewRemoteWorkRequest(review,res()),remoteController.reviewRemoteWorkRequest(review,res())]);
  assert.equal(remote[0].status,status);assert.equal(sends.length,1);assert.equal(sends[0][0],100);assert.equal(notices[0].deliveryStatus,'SENT');assert(sends[0][2].includes('2026-10-23'));
  await remoteController.reviewRemoteWorkRequest(review,res());assert.equal(sends.length,1);
  const conflicting=res();await remoteController.reviewRemoteWorkRequest(req({status:status==='APPROVED'?'REJECTED':'APPROVED'},{id:remote[0].id},900,'HR'),conflicting);assert.equal(conflicting.code,409);
  console.log(`PASS remote ${status}: owner, date range, post-save provider result and concurrent/repeated review dedup`);
 }
 reset();await remoteController.applyRemoteWork(req(period),res());await remoteController.reviewRemoteWorkRequest(req({status:'REJECTED'},{id:remote[0].id},900,'HR'),res());
 // Force a later persisted submission round, as in actual resubmission.
 remote[0].appliedOn=new Date('2026-10-01');notices.forEach(n=>n.createdAt=new Date('2026-10-01'));
 sends=[];await remoteController.applyRemoteWork(req({...period,requestId:remote[0].id}),res());assert.equal(sends[0][0],900);
 await remoteController.reviewRemoteWorkRequest(req({status:'APPROVED'},{id:remote[0].id},900,'HR'),res());assert.equal(sends.at(-1)[0],100);
 console.log('PASS in-place rejected remote resubmission not suppressed by prior-round deduplication');
 const aliases=[moduleController.createAccessRequest,featureController.requestFeatureAccess,permissionController.requestPermissionAccess,mobileController.requestFeatureAccess];
 for(const submit of aliases){reset();await Promise.all([submit(req(moduleBody),res()),submit(req(moduleBody),res())]);assert.equal(access.length,1);assert.deepEqual(sends.map(s=>s[0]),[900]);assert.equal(sends[0][3].route,'/access-requests');assert(sends[0][2].includes('Attendance'));assert(sends[0][2].includes('Test Employee'));}
 console.log('PASS all four existing module submission APIs: one request/history/push, authorized approver, module/name/reference');
 reset();failSave=true;await moduleController.createAccessRequest(req(moduleBody),res());assert.equal(sends.length,0);
 for(const alternate of [false,true])for(const status of ['APPROVED','REJECTED']){
  reset();access=[fixture()];const r=req({status},{id:'access-fixture',requestId:'access-fixture'},900,'HR');
  const handler=alternate?featureController.processAccessRequest:status==='APPROVED'?moduleController.approveAccessRequest:moduleController.rejectAccessRequest;
  await Promise.all([handler(r,res()),handler(r,res())]);assert.equal(access[0].status,status);assert.equal(sends.length,1);assert.equal(sends[0][0],100);assert.equal(notices[0].deliveryStatus,'SENT');assert.equal(sends[0][3].actionId,'access-fixture');
  if(status==='APPROVED'){if(!alternate)assert.equal(permissions[100].permissions.canViewAttendance,true);else {assert.equal(Object.keys(permissions).length,0);assert.equal(+Object.values(grants)[0].validFromDate,+new Date('2026-10-23'));}assert.equal(Object.values(grants)[0].isEnabled,true);}else assert.equal(Object.keys(grants).length,0);
  await handler(r,res());assert.equal(sends.length,1);
 }
 console.log('PASS both module review APIs: approval + grant committed together, rejection does not grant, owner and retry dedup');
 reset();access=[fixture()];failGrant=true;const failed=res();await moduleController.approveAccessRequest(req({}, {id:'access-fixture'},900,'HR'),failed);
 assert.equal(failed.code,500);assert.equal(access[0].status,'PENDING');assert.equal(Object.keys(permissions).length,0);assert.equal(sends.length,0);assert.equal(notices.length,0);
 console.log('PASS grant failure rolls back status/permission changes and emits no approval notification');
 reset();access=[fixture()];failFcm=true;const rejectedProvider=res();await moduleController.approveAccessRequest(req({}, {id:'access-fixture'},900,'HR'),rejectedProvider);
 assert.equal(rejectedProvider.body.success,true);assert.equal(notices[0].deliveryStatus,'FAILED');assert.equal(notices[0].failureReason,'messaging/mismatched-credential');assert.equal(notices[0].fcmMessageId,null);
 console.log('PASS zero FCM acceptance retains actual SDK rejection code and cannot claim device delivery');
 for(const moduleId of ['pa-remote-work','pa-access-requests'])for(const [id,role,allowed]of[[100,'EMPLOYEE',false],[901,'HR',false],[900,'HR',true]]){
  let next=false;const response=res();await requireRequestApprover(moduleId)(req({}, {},id,role),response,()=>{next=true;});assert.equal(next,allowed);if(!allowed)assert.equal(response.code,403);
 }
 reset();access=[fixture()];owner.userId=null;
 const unlinked=res();await moduleController.approveAccessRequest(req({}, {id:'access-fixture'},900,'HR'),unlinked);
 assert.equal(unlinked.code,409);assert.equal(access[0].status,'PENDING');assert.equal(notices.length,0);owner.userId=100;
 for(const status of ['APPROVED','REJECTED']){
  reset();await remoteController.applyRemoteWork(req(period),res());notices=[];sends=[];failSave=true;
  await remoteController.reviewRemoteWorkRequest(req({status},{id:remote[0].id},900,'HR'),res());
  assert.equal(remote[0].status,'PENDING');assert.equal(sends.length,0);assert.equal(notices.length,0);
  reset();access=[fixture()];failSave=true;
  await moduleController.reviewAccessRequest(req({}, {id:'access-fixture'},900,'HR'),res(),status);
  assert.equal(access[0].status,'PENDING');assert.equal(sends.length,0);assert.equal(notices.length,0);
 }
 console.log('PASS unlinked requester cannot be approved or fuzzy-linked; failed remote/module review writes send nothing');
 console.log('PASS reviewer role/module authorization matches notification recipient filtering. DB/FCM mocked, no production calls.');
})().catch(e=>{console.error(e);process.exitCode=1;});
