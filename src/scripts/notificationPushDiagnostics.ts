// Read-only: node dist/scripts/notificationPushDiagnostics.js --employee-code 030
// Legacy integer employee ID usage is also supported. Never sends a message.
import { createHash } from 'crypto';
import { prisma } from '../utils/db';
import { getMessaging } from '../config/firebase';
import { loadFirebaseCredentials } from '../config/firebaseCredentials';
import { safeFcmError } from '../utils/fcmErrors';

const safeCode = (value: unknown): string | null =>
  typeof value === 'string' && /^[a-zA-Z0-9/_-]+$/.test(value) ? value : null;

export function diagnoseFirebaseConfiguration() {
  let credentialDiagnostics: ReturnType<typeof loadFirebaseCredentials>['diagnostics'] | null = null;
  let credentialError: ReturnType<typeof safeFcmError> | null = null;
  try { credentialDiagnostics = loadFirebaseCredentials().diagnostics; }
  catch (error) { credentialError = safeFcmError(error); }
  let messagingInitialized = false;
  let initializationErrorCode: string | null = null;
  try { getMessaging(); messagingInitialized = true; }
  catch (error) { initializationErrorCode = safeCode((error as { code?: unknown })?.code) || 'diagnostics/initialization-failed'; }
  return {
    configuredProjectId: credentialDiagnostics?.projectId || null,
    serviceAccountPathConfigured: !!process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
    credentialDiagnostics, credentialError,
    clientEmailConfigured: !!process.env.FIREBASE_CLIENT_EMAIL,
    privateKeyConfigured: !!process.env.FIREBASE_PRIVATE_KEY,
    applicationCredentialsPathConfigured: !!process.env.GOOGLE_APPLICATION_CREDENTIALS,
    expectedMobileProjectId: 'quickboom-hrm',
    projectMatchesMobile: credentialDiagnostics?.projectMatchesMobile ?? false,
    messagingInitialized, initializationErrorCode,
    firebaseApiAccessVerified: false,
  };
}

export async function diagnosePush(args: string[]) {
  if (args.length === 1 && args[0] === '--configuration') {
    return { firebase: diagnoseFirebaseConfiguration() };
  }
  if (args.length === 1 && args[0] === '--recent-failures') {
    const attempts = await prisma.notification.findMany({
      where: { deliveryStatus: { in: ['FAILED', 'PARTIAL', 'UNKNOWN'] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 10,
      select: { id: true, employeeId: true, userId: true, createdAt: true, deliveryStatus: true, failureReason: true },
    });
    return { firebase: diagnoseFirebaseConfiguration(), recentFailures: attempts.map(({ failureReason, ...attempt }) => ({
      ...attempt,
      errorCodes: failureReason ? failureReason.split(',').map(code => safeCode(code.trim()) || 'diagnostics/unstructured-error-omitted') : [],
    })) };
  }
  const byCode = args[0] === '--employee-code';
  const value = byCode ? args[1] : args[0];
  const id = Number(value);
  if (!value || (byCode ? args.length !== 2 : args.length !== 1 || !Number.isSafeInteger(id) || id <= 0)) {
    throw Object.assign(new Error('Supply --employee-code CODE or an integer employee ID'), { code: 'diagnostics/invalid-target' });
  }
  const employee = await prisma.employee.findUnique({
    where: byCode ? { employeeCode: value } : { id },
    select: { id: true, employeeCode: true, status: true, userId: true, user: { select: { isActive: true } } },
  });
  if (!employee) throw Object.assign(new Error('Employee not found'), { code: 'diagnostics/employee-not-found' });
  const [tokens, devices, history] = await Promise.all([
    employee.userId == null ? [] : prisma.fCMToken.findMany({ where: { userId: employee.userId }, select: { token: true, isActive: true, platform: true, updatedAt: true } }),
    employee.userId == null ? [] : prisma.device.findMany({ where: { userId: employee.userId }, select: { fcmToken: true, platform: true, updatedAt: true } }),
    prisma.notification.findMany({
      where: { OR: [{ employeeId: employee.id }, ...(employee.userId == null ? [] : [{ userId: employee.userId }])] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 10,
      select: { id: true, createdAt: true, deliveryStatus: true, failureReason: true, fcmMessageId: true },
    }),
  ]);
  const describeToken = (token: string) => ({
    fingerprint: createHash('sha256').update(token).digest('hex').slice(0, 16),
    length: token.length, empty: !token.trim(), surroundingWhitespace: token !== token.trim(),
  });
  return {
    employeeId: employee.id, employeeCode: employee.employeeCode, userId: employee.userId,
    employeeActive: employee.status.toLowerCase() === 'active', accountActive: employee.user?.isActive ?? null,
    firebase: diagnoseFirebaseConfiguration(),
    registrations: {
      fcm: tokens.map(({ token, ...metadata }) => ({ ...metadata, ...describeToken(token) })),
      devices: devices.map(({ fcmToken, ...metadata }) => ({ ...metadata, ...describeToken(fcmToken) })),
      uniqueActiveTokens: new Set([...tokens.filter(t => t.isActive).map(t => t.token), ...devices.map(d => d.fcmToken)].filter(t => t.trim())).size,
    },
    recentAttempts: history.map(({ failureReason, fcmMessageId, ...attempt }) => ({
      ...attempt,
      errorCodes: failureReason ? failureReason.split(',').map(code => safeCode(code.trim()) || 'diagnostics/unstructured-error-omitted') : [],
      fcmMessageId,
      deviceReceiptVerified: false,
    })),
  };
}

if (require.main === module) {
  diagnosePush(process.argv.slice(2)).then(result => {
    console.info('[PushDiagnostics]', JSON.stringify(result, null, 2));
  }).catch(error => {
    console.error('[PushDiagnostics] Failed', { code: safeCode(error?.code) || 'diagnostics/failed' });
    process.exitCode = 1;
  }).finally(async () => { await prisma.$disconnect(); });
}
