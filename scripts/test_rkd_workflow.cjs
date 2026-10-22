const assert = require('node:assert/strict');
const Module = require('node:module');
require('ts-node/register/transpile-only');

let rkdRequests = [];
let commissionTransactions = [];
let commissionHistory = [];
let notifications = [];
let sends = [];
let failFcm = false;

const salesOwner = {
  id: 10,
  userId: 100,
  employeeCode: 'HK-SALES-01',
  employeeID: 'HK-SALES-01',
  firstName: 'Arun',
  lastName: 'Sharma',
  designation: 'Senior Sales Executive',
  commissionPercentage: 5.0,
  department: { name: 'Sales' },
  officeId: 1,
  storeId: 1,
};

const regularEmployee = {
  id: 20,
  userId: 200,
  employeeCode: 'EMP-DEV-01',
  employeeID: 'EMP-DEV-01',
  firstName: 'Rahul',
  lastName: 'Verma',
  designation: 'Software Engineer',
  department: { name: 'Engineering' },
  officeId: 1,
};

const hrUser = {
  id: 900,
  role: 'HR',
  profile: { fullName: 'Pooja HR' },
};

const db = {
  employee: {
    findUnique: async ({ where }) => {
      if (where.userId === 100 || where.id === 10) return { ...salesOwner, user: { role: 'SALESMAN' } };
      if (where.userId === 200 || where.id === 20) return { ...regularEmployee, user: { role: 'EMPLOYEE' } };
      return null;
    },
    findFirst: async () => salesOwner,
  },
  profile: {
    findFirst: async () => ({ fullName: 'Pooja HR' }),
  },
  commissionPolicy: {
    findFirst: async () => ({ commissionType: 'PERCENTAGE', commissionValue: 5.0, isActive: true }),
    findMany: async () => [],
  },
  commissionTransaction: {
    upsert: async ({ where, create, update }) => {
      let existing = commissionTransactions.find(
        (t) => t.billId === where.billId_employeeId.billId && t.employeeId === where.billId_employeeId.employeeId
      );
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      const row = { id: commissionTransactions.length + 1, createdAt: new Date(), ...create };
      commissionTransactions.push(row);
      return row;
    },
    update: async ({ where, data }) => {
      const tx = commissionTransactions.find((t) => t.id === where.id);
      if (tx) Object.assign(tx, data);
      return tx;
    },
  },
  commissionHistory: {
    create: async ({ data }) => {
      const row = { id: commissionHistory.length + 1, ...data };
      commissionHistory.push(row);
      return row;
    },
  },
  rkdRequest: {
    findUnique: async ({ where }) => {
      return rkdRequests.find((r) =>
        where.id ? r.id === where.id : (where.submissionKey ? r.submissionKey === where.submissionKey : false)
      ) || null;
    },
    findUniqueOrThrow: async ({ where }) => {
      const found = rkdRequests.find((r) =>
        where.id ? r.id === where.id : (where.submissionKey ? r.submissionKey === where.submissionKey : false)
      );
      if (!found) throw new Error('Not found');
      return { ...found, employee: salesOwner };
    },
    findFirst: async ({ where }) => {
      return rkdRequests.find((r) => {
        if (where.employeeId && r.employeeId !== where.employeeId) return false;
        if (where.saleReference && r.saleReference !== where.saleReference) return false;
        if (where.status?.in && !where.status.in.includes(r.status)) return false;
        return true;
      }) || null;
    },
    findMany: async () => rkdRequests.map((r) => ({ ...r, employee: salesOwner })),
    count: async () => rkdRequests.length,
    groupBy: async () => [
      { status: 'PENDING', _count: { id: rkdRequests.filter((r) => r.status === 'PENDING').length }, _sum: { commissionAmount: 0 } },
      { status: 'APPROVED', _count: { id: rkdRequests.filter((r) => r.status === 'APPROVED').length }, _sum: { commissionAmount: 500 } },
    ],
    create: async ({ data }) => {
      if (data.submissionKey && rkdRequests.some((r) => r.submissionKey === data.submissionKey)) {
        throw Object.assign(new Error('Duplicate'), { code: 'P2002' });
      }
      const row = {
        id: rkdRequests.length + 1,
        status: 'PENDING',
        isSalaryCredited: false,
        rejectionReason: null,
        reviewedByName: null,
        reviewedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      rkdRequests.push(row);
      return { ...row, employee: salesOwner };
    },
    update: async ({ where, data }) => {
      const item = rkdRequests.find((r) => r.id === where.id);
      if (!item) throw new Error('Not found');
      Object.assign(item, data);
      return { ...item, employee: salesOwner };
    },
  },
  notification: {
    create: async ({ data }) => {
      const n = { id: notifications.length + 1, ...data };
      notifications.push(n);
      return n;
    },
    findFirst: async () => null,
    update: async ({ where, data }) => {
      const n = notifications.find((x) => x.id === where.id);
      if (n) Object.assign(n, data);
      return n;
    },
  },
  user: {
    findMany: async () => [hrUser],
  },
  userPermission: {
    findMany: async () => [{ userId: 900, permissions: { 'pa-commission': true } }],
  },
  rolePermission: {
    findMany: async () => [],
  },
  payslip: {
    findUnique: async () => null,
  },
  $queryRaw: async () => [{ '?column?': 1 }],
  $executeRawUnsafe: async () => {},
};
db.$transaction = async (fn) => fn(db);

const load = Module._load;
Module._load = function (r, p, i) {
  if (/(?:^|\/)utils\/db$/.test(r) || r === './db') return { prisma: db, ensureRkdTable: async () => {} };
  if (/websocketSingleton$/.test(r)) return { getWebSocketInstance: () => ({ sendToUser() {} }) };
  if (/firebaseNotificationService$/.test(r)) {
    return {
      firebaseNotificationService: {
        sendNotificationToUser: async (...args) => {
          sends.push(args);
          return failFcm
            ? { successCount: 0, failureCount: 1, responses: [{ success: false, error: { code: 'messaging/token-error' } }] }
            : { successCount: 1, failureCount: 0, responses: [{ success: true, messageId: `msg-${args[0]}` }] };
        },
      },
    };
  }
  return load.call(this, r, p, i);
};

const rkdController = require('../src/controllers/rkdController');

const response = () => ({
  code: 200,
  body: null,
  status(c) {
    this.code = c;
    return this;
  },
  json(b) {
    this.body = b;
    return this;
  },
});

function reset() {
  rkdRequests = [];
  commissionTransactions = [];
  commissionHistory = [];
  notifications = [];
  sends = [];
  failFcm = false;
}

(async () => {
  console.log('--- STARTING RKD MODULE VERIFICATION ---');

  // Test 1: Non-sales employee blocked from submitting RKD request
  reset();
  let r = response();
  await rkdController.createRkdRequest(
    {
      user: { id: 200, role: 'EMPLOYEE' },
      body: { productName: 'Widget Pro', quantity: 2, commissionAmount: 500, particulars: 'Test sale' },
      get: () => undefined,
    },
    r
  );
  assert.equal(r.code, 403, 'Non-sales employee must receive 403 Forbidden');
  console.log('✅ Test 1 Passed: Unauthorized non-sales employee blocked (403)');

  // Test 2: Sales Employee submits valid RKD request
  reset();
  r = response();
  await rkdController.createRkdRequest(
    {
      user: { id: 100, role: 'SALESMAN' },
      body: {
        productName: 'Hopkid Shoes Model X',
        quantity: 2,
        commissionAmount: 500,
        saleReference: 'INV-2026-001',
        particulars: 'Retail walk-in sale at Bandra Store',
        requestId: 'req-001',
      },
      get: () => undefined,
    },
    r
  );
  assert.equal(r.code, 201, 'Sales employee submission must return 201');
  assert.equal(rkdRequests.length, 1);
  assert.equal(rkdRequests[0].status, 'PENDING');
  assert.equal(rkdRequests[0].isSalaryCredited, false);
  assert.equal(notifications.length, 1, 'HR notification must be created');
  assert.equal(notifications[0].title, 'New RKD Request');
  assert(notifications[0].body.includes('Arun Sharma'));
  console.log('✅ Test 2 Passed: Sales employee submits valid RKD request; status PENDING; HR notified');

  // Test 3: Idempotent replay of same request
  r = response();
  await rkdController.createRkdRequest(
    {
      user: { id: 100, role: 'SALESMAN' },
      body: {
        productName: 'Hopkid Shoes Model X',
        quantity: 2,
        commissionAmount: 500,
        saleReference: 'INV-2026-001',
        particulars: 'Retail walk-in sale at Bandra Store',
        requestId: 'req-001',
      },
      get: () => undefined,
    },
    r
  );
  assert.equal(rkdRequests.length, 1, 'Duplicate submission key must not create duplicate request');
  assert.equal(notifications.length, 1, 'Replay must not trigger duplicate HR notification');
  console.log('✅ Test 3 Passed: Idempotent replay prevents duplicate records and notifications');

  // Test 4: Prevent duplicate RKD request for same sale reference
  r = response();
  await rkdController.createRkdRequest(
    {
      user: { id: 100, role: 'SALESMAN' },
      body: {
        productName: 'Hopkid Shoes Model Y',
        quantity: 1,
        commissionAmount: 250,
        saleReference: 'INV-2026-001', // duplicate reference
        particulars: 'Another claim for same invoice',
        requestId: 'req-002',
      },
      get: () => undefined,
    },
    r
  );
  assert.equal(r.code, 400, 'Duplicate sale reference must return 400');
  console.log('✅ Test 4 Passed: Duplicate sale reference prohibited');

  // Test 5: Rejection requires reason
  r = response();
  await rkdController.rejectHrRkdRequest(
    {
      user: { id: 900, role: 'HR' },
      params: { id: '1' },
      body: { reason: '' },
    },
    r
  );
  assert.equal(r.code, 400, 'Rejection without reason must return 400');
  console.log('✅ Test 5 Passed: Rejection reason is strictly mandatory');

  // Test 6: HR rejects RKD request with reason
  notifications = [];
  sends = [];
  r = response();
  await rkdController.rejectHrRkdRequest(
    {
      user: { id: 900, role: 'HR' },
      params: { id: '1' },
      body: { reason: 'Sale was cancelled by customer' },
    },
    r
  );
  assert.equal(r.code, 200);
  assert.equal(rkdRequests[0].status, 'REJECTED');
  assert.equal(rkdRequests[0].rejectionReason, 'Sale was cancelled by customer');
  assert.equal(commissionTransactions.length, 0, 'Rejected request must NOT create commission ledger entry');
  assert.equal(notifications.length, 1, 'Employee must receive rejection notification');
  assert.equal(notifications[0].title, 'RKD Request Rejected');
  assert(notifications[0].body.includes('Sale was cancelled by customer'));
  console.log('✅ Test 6 Passed: HR rejection updates status, excludes salary, and notifies employee');

  // Test 7: HR accepts / approves pending request and integrates with salary/ledger
  reset();
  // Submit fresh request
  await rkdController.createRkdRequest(
    {
      user: { id: 100, role: 'SALESMAN' },
      body: {
        productName: 'Hopkid Jacket Winter Edition',
        quantity: 3,
        commissionAmount: 1500,
        saleReference: 'INV-2026-009',
        particulars: 'Seasonal winter jacket promo sale',
        requestId: 'req-fresh-100',
      },
      get: () => undefined,
    },
    response()
  );
  notifications = [];
  sends = [];

  r = response();
  await rkdController.approveHrRkdRequest(
    {
      user: { id: 900, role: 'HR' },
      params: { id: '1' },
      body: {},
    },
    r
  );
  assert.equal(r.code, 200);
  assert.equal(rkdRequests[0].status, 'APPROVED');
  assert.equal(rkdRequests[0].isSalaryCredited, false, 'Approval is eligibility; inclusion is recorded only when a payslip is saved');
  assert.equal(commissionTransactions.length, 1, 'Approved request must create exactly one CommissionTransaction');
  assert.equal(commissionTransactions[0].billId, 'RKD-1');
  assert.equal(commissionTransactions[0].commissionAmount, 1500);
  assert.equal(commissionTransactions[0].status, 'APPROVED');
  assert.equal(commissionHistory.length, 1, 'CommissionHistory must record approval audit entry');
  assert.equal(notifications.length, 1, 'Employee must receive approval notification');
  assert.equal(notifications[0].title, 'RKD Request Approved');
  assert(notifications[0].body.includes('approved'));
  console.log('✅ Test 7 Passed: HR approval creates salary ledger entry (RKD-1) and notifies employee');

  // Test 8: Concurrent / duplicate approval does not double-credit salary
  await rkdController.approveHrRkdRequest(
    {
      user: { id: 900, role: 'HR' },
      params: { id: '1' },
      body: {},
    },
    response()
  );
  assert.equal(commissionTransactions.length, 1, 'No duplicate commission transactions on retry');
  console.log('✅ Test 8 Passed: Idempotent approval prevents duplicate salary credits');

  console.log('\n🎉 ALL 8 BACKEND WORKFLOW TESTS PASSED PERFECTLY! 🎉\n');
})().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
