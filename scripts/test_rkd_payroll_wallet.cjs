const assert=require('node:assert/strict');
const Module=require('node:module');require('ts-node/register/transpile-only');
let requests=[],commissions=[],slips=[],history=[],notifications=[],sends=[],failSave=false;
const employee={id:10,userId:100,employeeCode:'HK-SALES-01',firstName:'Test',lastName:'Sales',designation:'Sales Executive',department:{name:'Sales'},office:{name:'Main',workingDays:['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']},user:{role:'SALESMAN'}};
const match=(r,w)=>Object.entries(w).every(([k,v])=>v&&typeof v==='object'&&'in'in v?v.in.includes(r[k]):r[k]===v);
const db={
 $queryRaw:async()=>[],employee:{findUnique:async()=>employee},
 rkdRequest:{
  findFirst:async({where})=>requests.find(r=>r.employeeId===where.employeeId&&r.saleReference===where.saleReference&&where.status.in.includes(r.status))||null,
  findUniqueOrThrow:async({where})=>({...requests.find(r=>r.id===where.id),employee}),
  findUnique:async({where})=>requests.find(r=>r.submissionKey===where.submissionKey)||null,
  create:async({data})=>{const r={id:requests.length+1,createdAt:new Date(),...data};requests.push(r);return{...r,employee};},
  update:async({where,data})=>{Object.assign(requests.find(r=>r.id===where.id),data);return{...requests.find(r=>r.id===where.id),employee};},
  findMany:async({where})=>requests.filter(r=>match(r,where)),
  updateMany:async({where,data})=>{const rows=requests.filter(r=>match(r,where));rows.forEach(r=>Object.assign(r,data));return{count:rows.length};},
 },
 commissionTransaction:{
  upsert:async({where,create,update})=>{const found=commissions.find(t=>t.billId===where.billId_employeeId.billId);if(found)return Object.assign(found,update);const t={id:commissions.length+1,...create};commissions.push(t);return t;},
  aggregate:async({where})=>{assert(where.AND,'RKD mirrors must be excluded from ordinary commission');return{_sum:{commissionAmount:200}};},
 },commissionHistory:{create:async({data})=>history.push(data)},
 payslip:{
  findUnique:async({where})=>where.id?slips.find(p=>p.id===where.id)||null:slips.find(p=>match(p,where.employeeId_month_year))||null,
  findMany:async()=>[],
  upsert:async({where,create,update})=>{if(failSave)throw Error('TEST_SNAPSHOT_FAILURE');const p=slips.find(p=>match(p,where.employeeId_month_year));if(p)return Object.assign(p,update);const row={id:slips.length+1,...create};slips.push(row);return row;},
 },systemSetting:{findFirst:async()=>null},expense:{findMany:async()=>[]},salaryAdvance:{findMany:async()=>[]},deductionPolicy:{findMany:async()=>[]},
 notification:{findFirst:async({where})=>notifications.find(n=>match(n,where))||null,create:async({data})=>{const n={id:notifications.length+1,...data};notifications.push(n);return n;},update:async({where,data})=>Object.assign(notifications.find(n=>n.id===where.id),data)},
};
let queue=Promise.resolve();db.$transaction=fn=>{const p=queue.then(async()=>{const backup=structuredClone({requests,commissions,slips,history});try{return await fn(db);}catch(e){({requests,commissions,slips,history}=backup);throw e;}});queue=p.catch(()=>{});return p;};
const load=Module._load;Module._load=function(r,p,i){
 if(/(?:^|\/)utils\/db$/.test(r)||r==='./db')return{prisma:db};
 if(/websocketSingleton$/.test(r))return{getWebSocketInstance:()=>null};
 if(/firebaseNotificationService$/.test(r))return{firebaseNotificationService:{sendNotificationToUser:async(...args)=>{sends.push(args);return{successCount:1,failureCount:0,responses:[{success:true,messageId:'accepted-test'}]};}}};
 return load.call(this,r,p,i);
};
db.wallet={findUnique:async()=>({id:1,availableBalance:123,advanceLimit:0,pendingClaims:0,transactions:[]})};
db.salaryStructure={findUnique:async()=>({monthlySalary:15000,salaryAdvanceLimit:0})};
db.expense.aggregate=async()=>({_sum:{amount:0}});
db.payslip.findFirst=async({where})=>slips.find(p=>match(p,where))||null;
const employeeController=require('../src/controllers/employee/employeeController');
const workflow=require('../src/services/rkdNotificationWorkflow');
const payroll=require('../src/services/payrollService').default;
const {getRkdWalletEarnings,getRkdPayrollEarnings}=require('../src/services/rkdPayrollService');
const {computePayrollSettlement}=require('../src/utils/salaryGross');
const {buildSalarySlipDocDefinition}=require('../src/utils/salarySlipPdfGenerator');
const now=new Date(Date.now()+330*60000),month=now.getUTCMonth()+1,year=now.getUTCFullYear();
payroll.getSalaryStructure=async()=>({id:1,baseSalary:15000,pf:0,esi:0,professionalTax:0,tds:0});
payroll.getAttendanceData=async()=>({workingDays:30,totalCalendarDays:31,presentDays:30,absentDays:0,halfDays:0,paidLeaveDays:0,unpaidLeaveDays:0,holidayWorkedCount:0,weeklyOffWorkedCount:0,holidayCount:0,weeklyOffCount:0,overtimeHours:0,
 classification:{periodStart:'2026-10-01',periodEnd:'2026-10-31',totalCalendarDays:31,monthWorkingDays:30,scheduledWorkingDays:30,presentDays:30,absentDays:0,halfDays:0,paidLeaveDays:0,unpaidLeaveDays:0,holidayCount:0,weeklyOffCount:0,holidayWorkedCount:0,weeklyOffWorkedCount:0,notJoinedWeeklyOffDays:0,notJoinedHolidayDays:0,notJoinedDays:0,remainingWorkingDays:0,overtimeMinutes:0,payableDayRecords:[],daysBeforeJoining:0}});
payroll.getAttendanceSnapshot=async()=> (await payroll.getAttendanceData()).classification;
payroll.calculateOvertime=()=>0;payroll.calculateBonus=async()=>0;payroll.applyDeductionPolicies=async()=>0;
(async()=>{
 const submission=await workflow.createRkdRequestOnce({employeeId:10,productName:'Product',quantity:1,commissionAmount:1500,saleReference:'SALE-1',particulars:'Controlled RKD'},'submission-1');
 assert.equal(submission.rkd.status,'PENDING');assert.equal((await getRkdWalletEarnings(10)).length,0);
 assert.equal((await payroll.calculatePayroll(10,month,year)).rkdIncentive,0);
 const decisions=await Promise.all([workflow.transitionRkdReview(1,'APPROVED',900,'HR'),workflow.transitionRkdReview(1,'APPROVED',900,'HR')]);
 assert.equal(decisions.filter(r=>r.changed).length,1);assert.equal(commissions.length,1);assert.equal(history.length,1);assert.equal(requests[0].reviewedBy,900);assert(requests[0].reviewedAt);assert.equal(requests[0].isSalaryCredited,false);
 await workflow.notifyRkdReviewed(decisions.find(r=>r.changed).rkd);assert.equal(sends[0][3].actionType,'RKD_APPROVED');assert(!sends.some(s=>/SALARY_PAID|WALLET_CREDIT/.test(s[3].actionType)));
 const earning=(await getRkdWalletEarnings(10))[0];assert.equal(earning.reference,'RKD-1');assert.equal(earning.description,'RKD Incentive');assert.equal(earning.amount,1500);assert.equal(earning.withdrawable,false);assert.equal(earning.status,'APPROVED_EARNING');
 const calc=await payroll.calculatePayroll(10,month,year);assert.equal(calc.rkdIncentive,1500);assert.equal(calc.commissionEarned,200);assert.equal(calc.totalEarnings,16500);assert.equal(calc.netSalary,16500);assert.equal(calc.totalTakeHomePay,16700);
 failSave=true;await assert.rejects(()=>payroll.savePayslip(calc));assert.equal(slips.length,0);assert.equal(requests[0].isSalaryCredited,false);failSave=false;
 await payroll.savePayslip(calc);assert.equal(slips[0].netSalary,16500);assert.equal(slips[0].commissionEarned,200);assert.equal(requests[0].payrollId,slips[0].id);assert.equal(requests[0].isSalaryCredited,true);
 assert(sends.some(s=>s[3].actionType==='PAYSLIP_GENERATED'));
 const view=await payroll.resolveFullPayslipView(slips[0],employee);assert.equal(view.rkdIncentive,1500);assert.deepEqual(view.rkdReferences,['RKD-1']);assert.equal(view.netSalary,16500);assert.equal(view.totalTakeHomePay,16700);
 const walletResponse={status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
 await employeeController.fetchEmployeeWallet({user:{id:100},query:{month,year}},walletResponse);
 assert.equal(walletResponse.body.success,true);assert.equal(walletResponse.body.wallet.availableBalance,123);assert.equal(walletResponse.body.wallet.netSalary,16500);assert.equal(walletResponse.body.wallet.totalTakeHomePay,16700);assert.equal(walletResponse.body.wallet.rkdEarnings[0].reference,'RKD-1');
 const definition=buildSalarySlipDocDefinition({employeeName:'Test Sales',employeeCode:'HK-SALES-01',month,year,paymentStatus:'PENDING',earnings:{baseSalary:15000},rkdIncentive:view.rkdIncentive,rkdReferences:view.rkdReferences,netSalary:view.netSalary,totalTakeHomePay:view.totalTakeHomePay,commissionEarned:200,isCommissionEligible:true});
 assert(JSON.stringify(definition).includes('RKD Incentive'));assert(JSON.stringify(definition).includes('RKD-1'));
 const before=JSON.stringify(slips[0]);await payroll.savePayslip(calc);assert.equal(JSON.stringify(slips[0]),before);
 await workflow.createRkdRequestOnce({employeeId:10,productName:'Later',quantity:1,commissionAmount:600,particulars:'Late approved earning'},'submission-2');
 await workflow.transitionRkdReview(2,'APPROVED',900,'HR');assert.equal(requests[1].salaryMonth,null);assert.equal((await getRkdWalletEarnings(10)).find(r=>r.requestId===2).status,'AWAITING_PAYROLL_ADJUSTMENT');
 assert.equal((await getRkdPayrollEarnings(10,month,year)).amount,1500);assert.equal(JSON.stringify(slips[0]),before);
 slips[0].status='Paid';const paidView=await payroll.resolveFullPayslipView(slips[0],employee);assert.equal(paidView.rkdIncentive,1500);assert.equal(paidView.netSalary,16500);
 await workflow.createRkdRequestOnce({employeeId:10,productName:'Rejected',quantity:1,commissionAmount:700,particulars:'Not eligible'},'submission-3');await workflow.transitionRkdReview(3,'REJECTED',900,'HR','Rejected');
 assert(!(await getRkdWalletEarnings(10)).some(r=>r.requestId===3));assert.equal(commissions.length,2);
 assert.equal(computePayrollSettlement({baseGrossEarnings:15000,rkdIncentive:1500,commissionEarned:200}).totalTakeHomePay,16700);
 console.log('PASS submission -> concurrent approval -> payroll calculation/snapshot/PDF -> wallet earning; single accounting amount, references, finalization/manual-adjustment hold, rejection exclusion, no cash-credit/payment push. DB/FCM mocked.');
})().catch(e=>{console.error(e);process.exitCode=1;});
