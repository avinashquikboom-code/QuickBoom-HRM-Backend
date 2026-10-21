const assert=require('node:assert/strict');const Module=require('node:module');require('ts-node/register/transpile-only');
let expenses=[],notifications=[],sends=[],failInsert=false,failFcm=false;
const owner={id:50,userId:100,firstName:'Test',lastName:'Employee',department:{name:'Test'},officeId:1};
const db={
 employee:{findFirst:async()=>owner,findUnique:async()=>owner},
 expense:{
  findUnique:async({where})=>expenses.find(e=>where.id?e.id===where.id:e.submissionKey===where.submissionKey)||null,
  findUniqueOrThrow:async q=>{const e=await db.expense.findUnique(q);if(!e)throw Error('Missing fixture');return {...e,employee:owner};},
  create:async({data})=>{if(failInsert)throw Object.assign(Error('Rolled back insert'),{code:'TEST_ROLLBACK'});if(data.submissionKey&&expenses.some(e=>e.submissionKey===data.submissionKey))throw Object.assign(Error('Duplicate'),{code:'P2002'});const row={id:expenses.length+1,submittedOn:new Date(),createdAt:new Date(),updatedAt:new Date(),...data};expenses.push(row);return row;},
  updateMany:async({where,data})=>{const e=expenses.find(e=>e.id===where.id&&e.status===where.status);if(!e)return{count:0};Object.assign(e,data);return{count:1};},
  update:async({where,data})=>Object.assign(expenses.find(e=>e.id===where.id),data),
 },
 notification:{create:async({data})=>{const n={id:notifications.length+1,...data};notifications.push(n);return n;},update:async({where,data})=>Object.assign(notifications.find(n=>n.id===where.id),data)},
 user:{findMany:async()=>[{id:900,role:'HR'},{id:901,role:'HR'}]},
 userPermission:{findMany:async()=>[{userId:901,permissions:{'pa-payroll':false}}]},rolePermission:{findMany:async()=>[]},
};db.$transaction=async fn=>fn(db);
const load=Module._load;Module._load=function(r,p,i){
 if(/(?:^|\/)utils\/db$/.test(r)||r==='./db')return{prisma:db};
 if(/websocketSingleton$/.test(r))return{getWebSocketInstance:()=>({sendToUser(){}})};
 if(/expenseReceiptService$/.test(r))return{expenseReceiptService:{generateExpenseReceipt:async()=>({relativeUrl:'/test-receipt.pdf'})}};
 if(/firebaseNotificationService$/.test(r))return{firebaseNotificationService:{sendNotificationToUser:async(...args)=>{sends.push(args);assert(Object.values(args[3]).every(v=>typeof v==='string'));return failFcm?{successCount:0,failureCount:1,responses:[{success:false,error:{code:'messaging/registration-token-not-registered'}}]}:{successCount:1,failureCount:0,responses:[{success:true,messageId:`accepted-${args[0]}`}]};}}};
 return load.call(this,r,p,i);
};
const employee=require('../src/controllers/employee/employeeController');const hr=require('../src/controllers/hr/hrController');
const response=()=>({code:200,body:null,status(c){this.code=c;return this;},json(b){this.body=b;return this;}});
const submit=(key='expense-request-001')=>({user:{id:100,role:'EMPLOYEE'},get:()=>undefined,body:{requestId:key,category:'TRAVEL',amount:125,description:'Controlled travel claim',date:'2026-10-22'}});
const review=()=>({user:{id:900,role:'HR'},params:{id:'1'},body:{reviewNote:'Controlled review'}});
const reset=()=>{expenses=[];notifications=[];sends=[];failInsert=false;failFcm=false;};
(async()=>{
 reset();let r=response();await employee.createEmployeeExpense(submit(),r);
 assert.equal(r.code,201);assert.equal(expenses.length,1);assert.equal(notifications.length,1);assert.equal(sends[0][0],900);assert.equal(notifications[0].userId,900);assert.equal(notifications[0].deliveryStatus,'SENT');assert.equal(sends[0][3].route,'/expenses');assert(sends[0][2].includes('Test Employee'));assert(sends[0][2].includes('125.00'));
 await employee.createEmployeeExpense(submit(),response());assert.equal(expenses.length,1);assert.equal(sends.length,1);
 console.log('PASS POST /api/employee/expenses -> authorized Finance HR approver 900; owner 100 and denied HR 901 excluded; committed history, FCM ID, string data, durable-key replay');
 const changed=submit();changed.body.amount=200;r=response();await employee.createEmployeeExpense(changed,r);assert.equal(r.code,409);assert.equal(sends.length,1);
 reset();failInsert=true;r=response();await employee.createEmployeeExpense(submit(),r);assert.equal(r.code,500);assert.equal(notifications.length,0);assert.equal(sends.length,0);
 console.log('PASS failed/rolled-back submission creates no notifications and makes no FCM call');
 for(const [label,handler,status]of[['approve',hr.approveExpense,'APPROVED'],['reject',hr.rejectExpense,'REJECTED']]){
  reset();await employee.createEmployeeExpense(submit(),response());notifications=[];sends=[];r=response();await handler(review(),r);
  assert.equal(r.code,200);assert.equal(expenses[0].status,status);assert.equal(sends.length,1);assert.equal(sends[0][0],100);assert.equal(notifications[0].userId,100);assert.equal(notifications[0].deliveryStatus,'SENT');assert.equal(notifications[0].fcmMessageId,'accepted-100');assert.equal(sends[0][3].expenseId,'1');assert.equal(r.body.notificationDelivery.deliveryStatus,'SENT');
  await handler(review(),response());assert.equal(sends.length,1);assert.equal(notifications.length,1);
  console.log(`PASS POST /api/hr/expenses/1/${label} -> owner 100, not approver 900; status committed, history/provider ID, amount/reference and retry deduplication`);
 }
 reset();await employee.createEmployeeExpense(submit(),response());notifications=[];sends=[];failFcm=true;r=response();await hr.approveExpense(review(),r);
 assert.equal(r.body.success,true);assert.equal(r.body.notificationDelivery.deliveryStatus,'FAILED');assert.equal(notifications[0].failureReason,'messaging/registration-token-not-registered');assert.equal(notifications[0].fcmMessageId,null);
 console.log('PASS rejected FCM remains FAILED in history/API while the expense approval succeeds; zero provider acceptance');
 reset();await employee.createEmployeeExpense(submit(),response());notifications=[];sends=[];await Promise.all([hr.approveExpense(review(),response()),hr.approveExpense(review(),response())]);assert.equal(sends.length,1);assert.equal(notifications.length,1);
 console.log('PASS concurrent expense approvals dispatch only once. DB/FCM mocked; no production data or device send.');
 reset();await Promise.all([employee.createEmployeeExpense(submit(),response()),employee.createEmployeeExpense(submit(),response())]);
 assert.equal(expenses.length,1);assert.equal(sends.length,1);assert.equal(notifications.length,1);
 console.log('PASS concurrent submission requests with the same key create one claim and one approver notification');
})().catch(error=>{console.error(error);process.exitCode=1;});
