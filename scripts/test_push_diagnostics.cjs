const assert = require('node:assert/strict');
const Module = require('node:module');
require('ts-node/register/transpile-only');
const calls = [];
let configError = null;
const fake = {
  employee: { findUnique: async query => { calls.push(query); return { id: 412, employeeCode: '030', status: 'active', userId: 789, user: { isActive: true } }; } },
  fCMToken: { findMany: async () => [{ token: 'private-device-token', isActive: true, platform: 'android', updatedAt: new Date(0) }] },
  device: { findMany: async () => [{ fcmToken: 'private-device-token', platform: 'android', updatedAt: new Date(0) }] },
  notification: { findMany: async query => {
    calls.push(query);
    return [{ id: 1, createdAt: new Date(0), deliveryStatus: 'FAILED', failureReason: 'messaging/mismatched-credential,unsafe secret value', fcmMessageId: null }];
  } },
};
const load = Module._load;
Module._load = function(request, parent, isMain) {
  if (/\/utils\/db$/.test(request)) return { prisma: fake };
  if (request === '../config/firebaseCredentials') return { loadFirebaseCredentials: () => ({ diagnostics: { source: 'FIREBASE_SERVICE_ACCOUNT_PATH', projectId: 'quickboom-hrm', projectMatchesMobile: true } }) };
  if (request === '../config/firebase') return { getMessaging: () => { if (configError) throw configError; return {}; } };
  return load.call(this, request, parent, isMain);
};
const { diagnosePush } = require('../src/scripts/notificationPushDiagnostics');
(async () => {
  await assert.rejects(() => diagnosePush([]), error => error.code === 'diagnostics/invalid-target');
  await assert.rejects(() => diagnosePush(['--employee-code']), error => error.code === 'diagnostics/invalid-target');
  const result = await diagnosePush(['--employee-code', '030']);
  assert.deepEqual(calls[0].where, { employeeCode: '030' });
  assert.equal(result.employeeId, 412);
  assert.equal(result.registrations.uniqueActiveTokens, 1);
  assert.equal(result.registrations.fcm[0].fingerprint, result.registrations.devices[0].fingerprint);
  assert.equal(result.firebase.firebaseApiAccessVerified, false);
  assert.equal(result.recentAttempts[0].deviceReceiptVerified, false);
  assert.deepEqual(result.recentAttempts[0].errorCodes, ['messaging/mismatched-credential', 'diagnostics/unstructured-error-omitted']);
  assert(!JSON.stringify(result).includes('private-device-token'));
  assert(!JSON.stringify(result).includes('unsafe secret value'));
  assert.equal(calls[1].take, 10);
  assert.deepEqual(calls[1].where.OR, [{ employeeId: 412 }, { userId: 789 }]);
  configError = { code: 'messaging/not-configured' };
  const unavailable = await diagnosePush(['412']);
  assert.deepEqual(calls[2].where, { id: 412 });
  assert.equal(unavailable.firebase.messagingInitialized, false);
  assert.equal(unavailable.firebase.initializationErrorCode, 'messaging/not-configured');
  console.log('PASS read-only diagnostics: exact employee code 030 vs database ID, recent stored failure codes, token union/fingerprints, secret exclusion and SDK initialization distinguished from FCM API/device verification. Database/Firebase mocked; no messages sent.');
})().catch(error => { console.error(error); process.exitCode = 1; });
