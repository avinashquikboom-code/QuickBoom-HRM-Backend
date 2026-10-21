import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { createPrivateKey } from 'crypto';

const failure = (code: string, message: string) => Object.assign(new Error(message), { code });
export function loadFirebaseCredentials(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()) {
  let account: any;
  let source = '';
  let path: string | null = null;
  const declared = env.FIREBASE_SERVICE_ACCOUNT_PATH || env.GOOGLE_APPLICATION_CREDENTIALS;
  const candidates = declared ? [declared] : ['secrets/firebase-service-account.json', 'firebase-service-account.json'];
  for (const candidate of candidates) {
    const absolute = resolve(cwd, candidate);
    if (!declared && !existsSync(absolute)) continue;
    path = absolute;
    let raw: string;
    try { raw = readFileSync(absolute, 'utf8'); }
    catch { throw failure('firebase/credential-file-unreadable', 'Configured Firebase credential file is missing or unreadable in this runtime'); }
    try { account = JSON.parse(raw); }
    catch { throw failure('firebase/credential-json-invalid', 'Firebase credential file is not valid JSON'); }
    source = env.FIREBASE_SERVICE_ACCOUNT_PATH ? 'FIREBASE_SERVICE_ACCOUNT_PATH' : env.GOOGLE_APPLICATION_CREDENTIALS ? 'GOOGLE_APPLICATION_CREDENTIALS' : 'default-file';
    break;
  }
  if (!account && env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try { account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON); }
    catch { throw failure('firebase/credential-json-invalid', 'FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON'); }
    source = 'FIREBASE_SERVICE_ACCOUNT_JSON';
  }
  if (!account && env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    account = { project_id: env.FIREBASE_PROJECT_ID, client_email: env.FIREBASE_CLIENT_EMAIL, private_key: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') };
    source = 'individual-env';
  }
  if (!account) throw failure('messaging/not-configured', 'Firebase service account credentials are not configured');
  const projectId = account.project_id || account.projectId;
  const clientEmail = account.client_email || account.clientEmail;
  const privateKey = account.private_key || account.privateKey;
  if (typeof projectId !== 'string' || !/^[a-z0-9-]+$/.test(projectId) || typeof clientEmail !== 'string' || !clientEmail.includes('@') || typeof privateKey !== 'string' || (account.type && account.type !== 'service_account')) {
    throw failure('firebase/credential-fields-invalid', 'Firebase credentials require a service account project_id, client_email and private_key');
  }
  try {
    if (createPrivateKey(privateKey).asymmetricKeyType !== 'rsa') throw new Error();
  } catch { throw failure('firebase/credential-key-invalid', 'Firebase service account private key is not a valid RSA key'); }
  // Explicit FIREBASE_PROJECT_ID must agree with the selected credential file.
  const expectedProjectId = env.FIREBASE_PROJECT_ID || 'quickboom-hrm';
  if (projectId !== expectedProjectId || projectId !== 'quickboom-hrm') {
    throw failure('firebase/project-mismatch', 'Firebase service account project does not match the Quickboom Android Firebase project (quickboom-hrm)');
  }
  return { credential: { projectId, clientEmail, privateKey }, diagnostics: {
    source, path, readable: path ? true : null, validJson: true, validPrivateKey: true,
    projectId, expectedMobileProjectId: 'quickboom-hrm', projectMatchesMobile: true,
  } };
}
