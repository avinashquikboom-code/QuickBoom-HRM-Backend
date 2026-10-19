// Read-only CLI: node dist/scripts/notificationPushDiagnostics.js EMPLOYEE_ID
import { prisma } from '../utils/db';
async function main() {
  const id = Number(process.argv[2]);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Supply the test employee integer ID');
  const employee = await prisma.employee.findUnique({ where: { id }, select: { id: true, status: true, userId: true, user: { select: { isActive: true } } } });
  if (!employee) throw new Error('Employee not found');
  const tokens = employee.userId ? await prisma.fCMToken.findMany({ where: { userId: employee.userId, isActive: true }, select: { token: true } }) : [];
  const devices = employee.userId ? await prisma.device.findMany({ where: { userId: employee.userId }, select: { fcmToken: true } }) : [];
  console.info('[PushDiagnostics]', {
    employeeId: employee.id, employeeActive: employee.status.toLowerCase() === 'active', accountActive: employee.user?.isActive === true,
    registeredFcmRows: tokens.length, registeredDeviceRows: devices.length,
    uniqueTokenCount: new Set([...tokens.map(t => t.token), ...devices.map(d => d.fcmToken)].filter(t => t.trim())).size,
    firebaseProjectId: process.env.FIREBASE_PROJECT_ID || null,
    clientEmailConfigured: !!process.env.FIREBASE_CLIENT_EMAIL,
    privateKeyConfigured: !!process.env.FIREBASE_PRIVATE_KEY,
    expectedMobileProjectId: 'quickboom-hrm',
  });
}
main().then(async () => { await prisma.$disconnect(); process.exit(0); }).catch(async (error) => {
  console.error('[PushDiagnostics] Failed', { code: error?.code, name: error?.name });
  await prisma.$disconnect(); process.exit(1);
});
