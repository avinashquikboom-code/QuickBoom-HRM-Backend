const assert = require('node:assert/strict');
const Module = require('node:module');
require('ts-node/register/transpile-only');
let notifications = [], sends = [], correction, slip, failSave = false, failFcm = false, recoveries = 0;
const employee = { id: 50, userId: 100, employeeCode: 'EMP50', firstName: 'Test', lastName: 'Employee' };
const db = {
  $queryRaw: async () => [],
  rkdRequest: { findMany: async () => [] },
  employee: { findUnique: async () => employee, findFirst: async () => employee },
  notification: {
    findFirst: async ({where}) => notifications.find(n => Object.entries(where).every(([k,v]) => n[k] === v)),
    create: async ({data}) => { const n = {id: notifications.length + 1, ...data}; notifications.push(n); return n; },
    update: async ({where, data}) => Object.assign(notifications.find(n => n.id === where.id), data),
  },
  attendanceCorrectionRequest: {
    findUnique: async () => correction,
    findMany: async () => correction ? [correction] : [],
    findFirst: async ({where}) => correction && correction.employeeId === where.employeeId && correction.status === where.status ? correction : null,
    create: async ({data}) => { if (failSave) throw Error('save failed'); correction = {id:'correction-1', ...data}; return correction; },
    updateMany: async ({where, data}) => {
      if (failSave) throw Error('save failed');
      if (correction.status !== where.status) return {count:0};
      Object.assign(correction, data); return {count:1};
    },
    update: async ({data}) => Object.assign(correction, data),
  },
  attendance: { findFirst: async () => ({id:1,status:'ABSENT'}), update: async () => ({}) },
  payslip: {
    findFirst: async () => null,
    findUnique: async () => slip,
    findMany: async ({where}) => !slip ? [] : where.status && !where.status.in.includes(slip.status) ? [] : [{...slip}],
    updateMany: async ({where, data}) => {
      if (failSave) throw Error('save failed');
      if (!where.status.in.includes(slip.status)) return {count:0};
      Object.assign(slip, data); return {count:1};
    },
  },
  salaryAdvance: { findMany: async () => [{id:1, remainingAmount:100, paidAmount:0, paidEmis:0}], update: async () => {recoveries++;} },
  user: {findMany: async () => [{id:900, role:'HR'}, {id:901,role:'STORE_MANAGER'}]},
  userPermission: {findMany: async () => []}, rolePermission: {findMany: async () => []},
};
// Serialize transactions to model PostgreSQL locks. No external database/FCM access.
let queue = Promise.resolve();
db.$transaction = fn => { const run = queue.then(() => fn(db)); queue = run.catch(() => {}); return run; };
const load = Module._load;
Module._load = function(r,p,i) {
  if (/(?:^|\/)utils\/db$/.test(r) || r === './db') return {prisma:db};
  if (/permissionHelper$/.test(r)) return {getEffectiveUserPermissions: async () => ({canRequestAttendanceCorrection:true})};
  if (/websocketSingleton$/.test(r)) return {getWebSocketInstance:()=>null};
  if (/firebaseNotificationService$/.test(r)) return {firebaseNotificationService:{sendNotificationToUser:async (...args) => {
    assert(Object.values(args[3]).every(v => typeof v === 'string'));
    if (args[3].actionType.includes('REJECTED')) assert.equal(correction.status,'REJECTED');
    if (args[3].actionType === 'SALARY_PAID') assert.equal(slip.status,'Paid');
    sends.push(args);
    return failFcm ? {successCount:0,failureCount:1,responses:[{success:false,error:{code:'messaging/mismatched-credential'}}]} :
      {successCount:1,failureCount:0,responses:[{success:true,messageId:'accepted-test'}]};
  }}};
  return load.call(this,r,p,i);
};
const attendance = require('../src/controllers/attendanceCorrectionController');
const payroll = require('../src/controllers/payrollController');
const service = require('../src/services/payrollService').default;
const response = () => ({code:200,status(n){this.code=n;return this;},json(b){this.body=b;return this;}});
const review = status => ({user:{id:900,role:'HR'}, params:{id:'correction-1'},body:{status}});
function reset() {
  notifications=[];sends=[];failSave=false;failFcm=false;recoveries=0;
  correction={id:'correction-1',employeeId:'EMP50',attendanceDate:new Date(),status:'PENDING',requestedStatus:'PRESENT'};
  slip={id:7,employeeId:50,month:10,year:2026,status:'Approved',advanceDeduction:10};
}
(async () => {
  reset(); correction=null;
  const submission={user:{id:100},body:{attendanceDate:new Date().toISOString().slice(0,10), requestedStatus:'PRESENT',reason:'Test'}};
  await Promise.all([attendance.applyCorrectionRequest(submission,response()), attendance.applyCorrectionRequest(submission,response())]);
  assert.equal(sends.filter(s=>s[0]===900).length,1);
  assert.equal(correction.status,'PENDING');
  assert(sends.some(s=>s[0]===900 && s[3].actionId==='correction-1'));
  assert(sends.some(s=>s[0]===901));
  console.log('PASS correction submitted -> authorized approvers, request reference, persisted history and FCM acceptance');
  reset(); correction=null; failSave=true;
  await attendance.applyCorrectionRequest(submission,response()); assert.equal(sends.length,0);
  for (const status of ['APPROVED','REJECTED']) {
    reset();
    await Promise.all([attendance.reviewHRAttendanceCorrection(review(status),response()),attendance.reviewHRAttendanceCorrection(review(status),response())]);
    assert.equal(correction.status,status);
    assert.equal(sends.filter(s=>s[0]===100).length,1);
    assert.equal(notifications.filter(n=>n.userId===100).length,1);
    await attendance.reviewHRAttendanceCorrection(review(status),response());
    assert.equal(sends.filter(s=>s[0]===100).length,1);
    reset();failSave=true;
    await attendance.reviewHRAttendanceCorrection(review(status),response());assert.equal(sends.length,0);
    console.log(`PASS correction ${status}: owner only, persisted first, concurrent/repeated retry dedup, failed save has no push`);
  }
  reset();slip.status='Draft';await service.notifyPublishedPayslip(50,10,2026);assert.equal(sends.length,0);
  slip.status='Approved';await Promise.all([service.notifyPublishedPayslip(50,10,2026),service.notifyPublishedPayslip(50,10,2026)]);
  assert.equal(sends.length,1);assert.equal(notifications.length,1);
  assert.equal(sends[0][3].actionId,'50-10-2026');assert(!/₹|net pay|net salary/i.test(sends[0][2]));
  console.log('PASS published slip: draft excluded, period target, no salary amount, single history row/push');
  reset();await Promise.all([payroll.disburseAdminPayslip({body:{payslipId:7}},response()),payroll.disburseAdminPayslip({body:{payslipId:7}},response())]);
  assert.equal(sends.filter(s=>s[0]===100).length,1);assert.equal(recoveries,1);
  assert.equal(sends.find(s=>s[0]===100)[3].actionId,'50-10-2026');
  await payroll.disburseAdminPayslip({body:{payslipId:7}},response());assert.equal(recoveries,1);
  console.log('PASS disbursement/paid: payslip-ID recipient mapping, concurrent/repeated retry dedup and one advance recovery');
  reset();await payroll.bulkDisbursePayroll({body:{month:10,year:2026}},response());
  await payroll.bulkDisbursePayroll({body:{month:10,year:2026}},response());assert.equal(sends.filter(s=>s[0]===100).length,1);
  reset();failSave=true;await payroll.disburseAdminPayslip({body:{payslipId:7}},response());assert.equal(sends.length,0);assert.equal(recoveries,0);
  reset();failFcm=true;await service.notifyPublishedPayslip(50,10,2026);
  assert.equal(notifications[0].deliveryStatus,'FAILED');assert.equal(notifications[0].failureReason,'messaging/mismatched-credential');assert.equal(notifications[0].fcmMessageId,null);
  console.log('PASS bulk retry, failed payment save, actual FCM rejection code retained; acceptance is not device delivery');
})().catch(e=>{console.error(e);process.exitCode=1;});
