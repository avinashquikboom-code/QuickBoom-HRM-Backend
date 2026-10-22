const assert = require('node:assert/strict');
const Module = require('node:module');
require('ts-node/register/transpile-only');
let databaseCalls = 0;
let queriedId;
const load = Module._load;
Module._load = function (name, parent, isMain) {
  if (name === '../utils/db') return {
    ensureRkdTable: async () => { databaseCalls++; },
    prisma: { rkdRequest: { findUnique: async ({where}) => { databaseCalls++; queriedId = where.id; return null; } } },
  };
  if (name === '../utils/salaryGross') return {};
  if (name === '../services/rkdNotificationWorkflow') return {};
  return load.call(this, name, parent, isMain);
};
const controller = require('../src/controllers/rkdController');
Module._load = load;
const response = () => ({code:200, status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
(async () => {
  for (const handler of [controller.getEmployeeRkdDetails, controller.getHrRkdDetails, controller.approveHrRkdRequest, controller.rejectHrRkdRequest]) {
    for (const id of [undefined, [], ['1'], ['1','2'], '', ' ', '1,2', '1extra', '1.5', '-1', '0', '2147483648', '9007199254740993']) {
      databaseCalls = 0;
      const res = response();
      await handler({params:{id},body:{reason:'Controlled test'},user:{id:900}},res);
      assert.equal(res.code,400, `${handler.name} must reject ${JSON.stringify(id)}`);
      assert.equal(databaseCalls,0,'Invalid IDs must not reach database or workflow operations');
    }
  }
  for (const [input,expected] of [['1',1],['001',1],['2147483647',2147483647]]) {
    const res = response();
    await controller.getHrRkdDetails({params:{id:input}},res);
    assert.equal(queriedId,expected);
    assert.equal(res.code,404,'Valid missing IDs keep the existing not-found behavior');
  }
  console.log('PASS RKD route ID validation: arrays/missing/malformed/out-of-range IDs return 400 before DB/workflow operations; valid integer IDs retain lookup behavior.');
})().catch(error => {console.error(error);process.exitCode=1;});
