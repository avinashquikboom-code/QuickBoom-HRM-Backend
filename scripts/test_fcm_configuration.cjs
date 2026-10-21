const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generateKeyPairSync } = require('node:crypto');
require('ts-node/register/transpile-only');
const { loadFirebaseCredentials } = require('../src/config/firebaseCredentials');
const { safeFcmError, classifyFcmError } = require('../src/utils/fcmErrors');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hrm-fcm-test-'));
const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs8' });
const account = { type: 'service_account', project_id: 'quickboom-hrm', client_email: 'test@quickboom-hrm.iam.gserviceaccount.com', private_key: key };
const file = path.join(dir, 'account.json');
const check = (env, code) => assert.throws(() => loadFirebaseCredentials(env, dir), e => e.code === code);
try {
  check({}, 'messaging/not-configured');
  check({ FIREBASE_SERVICE_ACCOUNT_PATH: 'missing.json', FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(account) }, 'firebase/credential-file-unreadable');
  fs.writeFileSync(file, '{ private secret invalid json');
  check({ FIREBASE_SERVICE_ACCOUNT_PATH: file }, 'firebase/credential-json-invalid');
  fs.writeFileSync(file, JSON.stringify({ ...account, private_key: 'invalid-key' }));
  check({ FIREBASE_SERVICE_ACCOUNT_PATH: file }, 'firebase/credential-key-invalid');
  fs.writeFileSync(file, JSON.stringify({ ...account, project_id: 'wrong-project' }));
  check({ FIREBASE_SERVICE_ACCOUNT_PATH: file }, 'firebase/project-mismatch');
  fs.writeFileSync(file, JSON.stringify(account));
  const result = loadFirebaseCredentials({ FIREBASE_SERVICE_ACCOUNT_PATH: 'account.json' }, dir);
  assert.equal(result.diagnostics.path, file);
  assert.equal(result.diagnostics.source, 'FIREBASE_SERVICE_ACCOUNT_PATH');
  assert.equal(result.diagnostics.projectMatchesMobile, true);
  assert(!JSON.stringify(result.diagnostics).includes(key));
  assert(!JSON.stringify(result.diagnostics).includes(account.client_email));
  check({ FIREBASE_SERVICE_ACCOUNT_PATH: file, FIREBASE_PROJECT_ID: 'wrong-project' }, 'firebase/project-mismatch');
  assert.equal(loadFirebaseCredentials({ FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(account) }, dir).diagnostics.projectId, 'quickboom-hrm');
  assert.equal(loadFirebaseCredentials({ FIREBASE_PROJECT_ID: account.project_id, FIREBASE_CLIENT_EMAIL: account.client_email, FIREBASE_PRIVATE_KEY: key.replace(/\n/g, '\\n') }, dir).diagnostics.validPrivateKey, true);
  const token = 'private:device-token';
  const safe = safeFcmError({ code: 'messaging/mismatched-credential', message: `SenderId mismatch ${token} ${key} ${account.client_email}` }, [token]);
  assert.equal(safe.code, 'messaging/mismatched-credential');
  assert.equal(safe.category, 'credentials');
  assert(safe.message.includes('SenderId mismatch'));
  assert(!safe.message.includes(token));
  assert(!safe.message.includes('BEGIN PRIVATE'));
  assert(!safe.message.includes(account.client_email));
  for (const [code, category] of [
    ['messaging/registration-token-not-registered', 'token'],
    ['messaging/invalid-registration-token', 'token'],
    ['app/invalid-credential', 'credentials'],
    ['messaging/insufficient-permission', 'permission'],
    ['firebase/credential-file-unreadable', 'configuration'],
    ['messaging/server-unavailable', 'transient'], ['app/network-error', 'transient'],
    ['ENOTFOUND', 'transient'], ['unexpected', 'unknown'],
  ]) assert.equal(classifyFcmError(code), category);
  console.log('PASS credential source/path resolution, invalid JSON/key, project mismatch, env compatibility, safe error messages and error classification. Generated test key only; no network calls.');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
