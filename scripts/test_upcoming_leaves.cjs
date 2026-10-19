// Isolated controller regression checks. Database imports are replaced before loading application code.
const assert = require('node:assert/strict');
const Module = require('node:module');
require('ts-node/register/transpile-only');
let query;
let findMany = async args => { query = args; return []; };
const prisma = new Proxy({ leaveRequest: { findMany: args => findMany(args) } }, {
  get(target, key) {
    if (key in target) return target[key];
    throw new Error(`Unexpected database access in isolated test: ${String(key)}`);
  },
});
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (/\/utils\/db$/.test(request)) return { prisma, ensureBankEditTable: async () => { throw new Error('Unexpected DB operation'); } };
  return originalLoad.call(this, request, parent, isMain);
};
const { fetchUpcomingLeaves } = require('../src/controllers/adminController');
const { roleMiddleware } = require('../src/middlewares/roleMiddleware');
function response() { return { code: 200, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; }
(async () => {
  const req = { user: { id: 1, role: 'ADMIN' }, query: {} };
  let res = response();
  await fetchUpcomingLeaves(req, res);
  assert.deepEqual(res.body, { success: true, leaves: [] });
  assert.equal(query.where.status, 'APPROVED');
  assert.equal(query.where.toDate.gte.getHours(), 0);
  assert.equal(query.where.fromDate.lte.getHours(), 23);
  assert(query.where.toDate.gte < query.where.fromDate.lte);
  assert.deepEqual(query.select.employee.select, { firstName: true, lastName: true, office: { select: { name: true } } });
  assert.equal(query.select.employee.select.dateOfBirth, undefined);
  findMany = async () => [{ id: 42, type: 'CASUAL', fromDate: new Date('2026-10-19T00:00:00Z'), toDate: new Date('2026-10-20T00:00:00Z'), employee: { firstName: 'Test', lastName: 'Employee', office: null } }];
  res = response(); await fetchUpcomingLeaves(req, res);
  assert.deepEqual(res.body, { success: true, leaves: [{ id: '42', employeeName: 'Test Employee', branch: 'Unassigned', type: 'CASUAL', dates: '2026-10-19 to 2026-10-20' }] });
  findMany = async () => { throw Object.assign(new Error('mock missing column'), { code: 'P2022' }); };
  const originalError = console.error;
  let logged = false;
  console.error = () => { logged = true; };
  try { res = response(); await fetchUpcomingLeaves(req, res); } finally { console.error = originalError; }
  assert.equal(logged, true); assert.equal(res.code, 500);
  assert.deepEqual(res.body, { success: false, message: 'Failed to fetch upcoming leaves' });
  const auth = roleMiddleware(['SUPER_ADMIN', 'ADMIN', 'HR', 'PLATFORM_ADMIN']);
  let called = false;
  res = response(); auth({ user: { role: 'EMPLOYEE' } }, res, () => { called = true; }); assert.equal(res.code, 403); assert.equal(called, false);
  res = response(); auth({}, res, () => { called = true; }); assert.equal(res.code, 401); assert.equal(called, false);
  res = response(); auth(req, res, () => { called = true; }); assert.equal(called, true);
  console.log('PASS: empty results, date overlap window, minimal field selection, response compatibility, unassigned office, database failure returns 500, and role checks. No database contacted.');
})().catch(error => { console.error(error); process.exitCode = 1; });
