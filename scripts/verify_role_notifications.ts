import { prisma } from '../src/utils/db';
import { notifyEmployee, notifyHRAndAdmins, sendHRNotification } from '../src/utils/hrNotificationHelper';

async function runTests() {
  console.log('🧪 Starting Role-Specific Notification Verification Tests...\n');

  // Clean test notifications before run
  await prisma.notification.deleteMany({
    where: {
      title: {
        startsWith: '[TEST]',
      },
    },
  });

  // 1. Fetch or identify users
  const adminUsers = await prisma.user.findMany({
    where: { role: { in: ['SUPER_ADMIN', 'ADMIN', 'HR', 'PLATFORM_ADMIN'] }, isActive: true },
    select: { id: true, email: true, role: true },
    take: 2,
  });

  const employees = await prisma.employee.findMany({
    where: { userId: { not: null }, status: 'active' },
    select: { id: true, userId: true, firstName: true, lastName: true },
    take: 2,
  });

  console.log(`Found ${adminUsers.length} test HR/Admin users, ${employees.length} test Employees.`);

  if (employees.length < 2) {
    console.log('⚠️ Need at least 2 employees to test isolation. Skipping multi-employee simulation.');
    return;
  }

  const empA = employees[0];
  const empB = employees[1];

  console.log(`Employee A: ID=${empA.id}, UserID=${empA.userId}, Name=${empA.firstName}`);
  console.log(`Employee B: ID=${empB.id}, UserID=${empB.userId}, Name=${empB.firstName}`);

  // Test 1: Employee A submits leave
  console.log('\n--- Test 1: Employee A submits leave ---');
  await notifyEmployee({
    targetUserId: empA.userId,
    targetEmployeeId: empA.id,
    title: '[TEST] Leave Request Submitted',
    body: 'Your leave request for 10 Oct 2026 has been submitted successfully.',
    category: 'LEAVE',
    actionId: 99991,
    actionType: 'leave_request',
  });

  await notifyHRAndAdmins({
    title: '[TEST] New Leave Request',
    body: `${empA.firstName} ${empA.lastName} submitted a leave request for 10 Oct 2026.`,
    category: 'LEAVE',
    actionId: 99991,
    actionType: 'leave_request',
    employeeId: empA.id,
    requiredModuleId: 'pa-leave',
  });

  // Verify DB isolation
  const empANotifs1 = await prisma.notification.findMany({ where: { userId: empA.userId, title: { startsWith: '[TEST]' } } });
  const empBNotifs1 = await prisma.notification.findMany({ where: { userId: empB.userId, title: { startsWith: '[TEST]' } } });
  console.log(`Employee A received: ${empANotifs1.length} notifications (${empANotifs1.map(n => n.title).join(', ')})`);
  console.log(`Employee B received: ${empBNotifs1.length} notifications (MUST BE 0)`);
  if (empBNotifs1.length !== 0) throw new Error('Isolation failed: Employee B received notification!');

  // Test 2: HR approves Employee A leave
  console.log('\n--- Test 2: HR approves Employee A leave ---');
  await notifyEmployee({
    targetUserId: empA.userId,
    targetEmployeeId: empA.id,
    title: '[TEST] Leave Approved',
    body: 'Your leave request for 10 Oct 2026 has been approved.',
    category: 'LEAVE',
    actionId: 99991,
    actionType: 'leave_approved',
  });

  const empANotifs2 = await prisma.notification.findMany({ where: { userId: empA.userId, title: { startsWith: '[TEST]' } } });
  const empBNotifs2 = await prisma.notification.findMany({ where: { userId: empB.userId, title: { startsWith: '[TEST]' } } });
  console.log(`Employee A now has: ${empANotifs2.length} notifications`);
  console.log(`Employee B now has: ${empBNotifs2.length} notifications (MUST BE 0)`);
  if (empBNotifs2.length !== 0) throw new Error('Isolation failed: Employee B received notification!');

  // Test 3: Payroll run (Employee A salary generated)
  console.log('\n--- Test 3: Employee A salary generated ---');
  await notifyEmployee({
    targetUserId: empA.userId,
    targetEmployeeId: empA.id,
    title: '[TEST] October 2026 Salary Slip Available',
    body: 'Your salary slip for October 2026 has been generated.',
    category: 'PAYROLL',
    actionId: 88881,
    actionType: 'salary_slip',
  });

  const empANotifs3 = await prisma.notification.findMany({ where: { userId: empA.userId, title: { startsWith: '[TEST] October 2026' } } });
  const empBNotifs3 = await prisma.notification.findMany({ where: { userId: empB.userId, title: { startsWith: '[TEST] October 2026' } } });
  console.log(`Employee A salary notifs: ${empANotifs3.length}`);
  console.log(`Employee B salary notifs: ${empBNotifs3.length} (MUST BE 0)`);
  if (empBNotifs3.length !== 0) throw new Error('Isolation failed: Employee B received Employee A salary notification!');

  // Test 4: Unread Count and Mark as Read isolation
  console.log('\n--- Test 4: Mark as Read & Unread Count Isolation ---');
  const initialUnreadA = await prisma.notification.count({ where: { userId: empA.userId, isRead: false, title: { startsWith: '[TEST]' } } });
  console.log(`Employee A unread test notifications: ${initialUnreadA}`);

  // Mark 1 of Employee A's notifications read
  const notifToRead = empANotifs1[0];
  await prisma.notification.update({ where: { id: notifToRead.id }, data: { isRead: true } });

  const afterUnreadA = await prisma.notification.count({ where: { userId: empA.userId, isRead: false, title: { startsWith: '[TEST]' } } });
  console.log(`Employee A unread after reading one: ${afterUnreadA} (decreased by 1)`);
  if (afterUnreadA !== initialUnreadA - 1) throw new Error('Unread count calculation failed!');

  // Clean up test data
  await prisma.notification.deleteMany({
    where: {
      title: {
        startsWith: '[TEST]',
      },
    },
  });

  console.log('\n✅ ALL ROLE-SPECIFIC NOTIFICATION TESTS PASSED SUCCESSFULLY!');
}

runTests()
  .catch((e) => {
    console.error('❌ Test failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
