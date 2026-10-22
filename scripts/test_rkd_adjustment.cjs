const assert=require('node:assert/strict');
const Module=require('node:module');
require('ts-node/register/transpile-only');
process.env.JWT_SECRET=require('node:crypto').randomBytes(32).toString('hex');
const jwt=require('jsonwebtoken'),express=require('express');
let updates=0,recalculations=0,failRefresh=false;
const requests=[1,2,3,4,5,6,7].map(id=>({id,employeeId:10,commissionAmount:100*id,status:({3:'PENDING',4:'REJECTED',5:'RETURNED'})[id]||'APPROVED',salaryMonth:id===6?11:null,salaryYear:id===6?2026:null,isSalaryCredited:id===6,payrollId:id===6?62:null}));
const originalAmounts=requests.map(r=>r.commissionAmount);
const slips=[{id:61,employeeId:10,month:10,year:2026,status:'PAID'},{id:62,employeeId:10,month:11,year:2026,status:'Pending Approval'}];
const locks=[];
const db={
 $queryRaw:async (_sql,key)=>{locks.push(key);return[];},
 user:{findUnique:async({where})=>({id:where.id,role:where.id===100?'SALESMAN':'HR',isActive:true,employee:{status:'ACTIVE'}})},
 userPermission:{findUnique:async({where})=>({permissions:{'pa-commission':where.userId!==901}})},
 rolePermission:{findUnique:async()=>null},
 rkdRequest:{
  findUnique:async({where})=>requests.find(r=>r.id===where.id)||null,
  findUniqueOrThrow:async({where})=>{const row=requests.find(r=>r.id===where.id);assert(row);return{...row};},
  update:async({where,data})=>{updates++;const row=requests.find(r=>r.id===where.id);Object.assign(row,data);return{...row};},
 },
 payslip:{findUnique:async({where})=>slips.find(s=>Object.entries(where.employeeId_month_year).every(([key,value])=>s[key]===value))||null},
};
let queue=Promise.resolve();db.$transaction=fn=>{const pending=queue.then(()=>fn(db));queue=pending.catch(()=>{});return pending;};
const payroll={calculatePayroll:async(employeeId,month,year)=>{recalculations++;return{employeeId,month,year};},savePayslip:async calc=>{if(failRefresh)throw Error('CONTROLLED_REFRESH_FAILURE');requests.filter(r=>r.salaryMonth===calc.month&&r.salaryYear===calc.year).forEach(r=>Object.assign(r,{isSalaryCredited:true,payrollId:62}));}};
const load=Module._load;Module._load=function(name,parent,isMain){
 if(/(?:^|\/)utils\/db$/.test(name)||name==='./db')return{prisma:db,ensureRkdTable:async()=>{}};
 if(/services\/payrollService$/.test(name))return payroll;
 if(/services\/rkdNotificationWorkflow$/.test(name))return{};
 return load.call(this,name,parent,isMain);
};
const {hrRkdRouter}=require('../src/routes/rkdRoutes');Module._load=load;
const app=express();app.use(express.json());app.use('/api/hr/rkd',hrRkdRouter);
(async()=>{
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 try{
  const call=async(id,body,user=900)=>{
   const token=user?jwt.sign({id:user,role:user===100?'SALESMAN':'HR'},process.env.JWT_SECRET,{expiresIn:60}):null;
   const response=await fetch(`http://127.0.0.1:${server.address().port}/api/hr/rkd/${id}/adjust`,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
   return{status:response.status,body:await response.json()};
  };
  assert.equal((await call(1,{month:11,year:2026},null)).status,401);
  assert.equal((await call(1,{month:11,year:2026},100)).status,403);
  assert.equal((await call(1,{month:11,year:2026},901)).status,403);
  for(const id of ['abc','1x','1.5','0','-1','2147483648'])assert.equal((await call(id,{month:11,year:2026})).status,400);
  for(const body of [undefined,{},[],{commissionAmount:500},{month:11},{year:2026},{month:null,year:2026},{month:[11],year:2026},{month:'11oops',year:2026},{month:1.5,year:2026},{month:13,year:2026},{month:11,year:'2026x'},{month:11,year:2026.5},{month:11,year:2101}]){
   const result=await call(1,body);assert.equal(result.status,400,JSON.stringify(body));assert.equal(result.body.errorCode,'RKD_INVALID_PERIOD');
  }
  for(const id of [3,4,5])assert.equal((await call(id,{month:11,year:2026})).body.errorCode,'RKD_NOT_APPROVED');
  assert.equal((await call(999,{month:11,year:2026})).status,404);
  for(const id of [1,2]){
   const result=await call(id,{month:10,year:2026});assert.equal(result.status,400);assert.equal(result.body.errorCode,'RKD_PAYROLL_LOCKED');
   console.log(`Observed local response for RKD ${id}:`,JSON.stringify(result.body));
  }
  assert.equal(updates,0,'Invalid and forbidden operations must not change allocations');
  let result=await call(1,{month:11,year:2026,commissionAmount:99999});
  assert.equal(result.status,200);assert.equal(result.body.rkd.isSalaryCredited,true);assert.equal(result.body.rkd.adjustmentStatus,'ADJUSTED_IN_PAYROLL');assert.equal(requests[0].commissionAmount,100);
  const previousUpdates=updates,previousRecalculations=recalculations;
  result=await call(1,{month:11,year:2026});assert.equal(result.status,200);assert.equal(updates,previousUpdates);assert.equal(recalculations,previousRecalculations);
  result=await call(1,{month:12,year:2026});assert.equal(result.status,400);assert.equal(result.body.errorCode,'RKD_ALREADY_CREDITED');
  result=await call(2,{month:12,year:2026});assert.equal(result.status,200);assert.equal(result.body.rkd.isSalaryCredited,false);
  await Promise.all([call(2,{month:12,year:2026}),call(2,{month:12,year:2026})]);assert.equal(requests[1].commissionAmount,200);
  failRefresh=true;result=await call(7,{month:11,year:2026});assert.equal(result.status,200);assert.equal(result.body.rkd.isSalaryCredited,false);
  assert.deepEqual(requests.map(r=>r.commissionAmount),originalAmounts);
  assert(locks.includes('rkd-review:1'));assert(locks.includes('payroll-period:10:2026:11'));
  console.log('PASS real adjustment HTTP route: exact month/year contract, 400 response bodies, strict fields/IDs, 401/403, supported status/open period, persisted fresh credit markers, retries and no amount changes. DB/payroll mocked.');
 }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
