const assert = require('node:assert/strict');
const Module = require('node:module');
require('ts-node/register/transpile-only');
let error = { code: 'messaging/mismatched-credential', message: 'SenderId mismatch private-device-token' };
let initializationError;
let cleanup = 0;
const logs = [];
const db = { device: { deleteMany: async () => { cleanup++; } }, fCMToken: { updateMany: async () => { cleanup++; } } };
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (/\/utils\/db$/.test(request)) return { prisma: db };
  if (request === '../config/firebase') return { getMessaging: () => {
    if (initializationError) throw initializationError;
    return { sendEachForMulticast: async () => ({ successCount: 0, failureCount: 1, responses: [{ success: false, error }] }) };
  } };
  return originalLoad.call(this, request, parent, isMain);
};
const originalWarn = console.warn;
console.warn = (...args) => logs.push(args);
const { FirebaseNotificationService } = require('../src/services/firebaseNotificationService');
(async () => {
  try {
    const service = new FirebaseNotificationService();
    for (const code of ['messaging/mismatched-credential', 'messaging/insufficient-permission', 'messaging/server-unavailable', 'messaging/invalid-argument']) {
      error = { code, message: 'Provider message private-device-token' };
      const result = await service.sendNotificationToTokens(['private-device-token'], 'Test', 'Test', { id: '123' });
      assert.equal(result.successCount, 0);
      assert.equal(result.failureCount, 1);
      assert.equal(cleanup, 0, 'Do not delete tokens on project, permission, payload or transient failures');
      assert.equal(logs.at(-1)[1].code, code);
      assert.equal(logs.at(-1)[1].notificationId, '123');
      assert(!JSON.stringify(logs).includes('private-device-token'));
    }
    error = { code: 'messaging/registration-token-not-registered', message: 'Unregistered token' };
    await service.sendNotificationToTokens(['private-device-token'], 'Test', 'Test');
    assert.equal(cleanup, 2);
    initializationError = Object.assign(new Error('Bad runtime credential path'), { code: 'firebase/credential-file-unreadable' });
    await assert.rejects(() => service.sendNotificationToTokens(['private-device-token'], 'Test', 'Test'), e => e === initializationError);
    console.log('PASS original credential error preserved, zero acceptance on Firebase rejection, safe per-device diagnostics and permanent-token-only cleanup. FCM mocked.');
  } finally { console.warn = originalWarn; Module._load = originalLoad; }
})().catch(error => { console.error(error); process.exitCode = 1; });
