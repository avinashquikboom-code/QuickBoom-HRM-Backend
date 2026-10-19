import { prisma } from '../src/utils/db';
import { updateAdminLeaveStatus } from '../src/controllers/adminController';
import { AuthenticatedRequest } from '../src/middlewares/authMiddleware';

function createMockReq(user: any, body: any = {}, params: any = {}, query: any = {}): AuthenticatedRequest {
  return {
    user,
    body,
    params,
    query,
  } as any;
}

function createMockRes(): {
  statusCode: number;
  data: any;
  status: (code: number) => any;
  json: (data: any) => any;
} {
  const res: any = {
    statusCode: 200,
    data: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.data = payload;
      return this;
    },
  };
  return res;
}

async function runTests() {
  console.log('🧪 Starting Admin Leave Approval/Rejection Verification Test Suite...\n');
  let passed = 0;
  let total = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}${detail ? `: ${detail}` : ''}`);
    }
  }

  const adminUser = {
    id: 1,
    email: 'admin@hopkid.test',
    role: 'ADMIN',
  };

  // Create isolated test employee with NO linked user account (userId: null)
  // This simulates salesman / staff without user account which previously crashed notification.create
  const testEmpCode = `TEST_EMP_LEAVE_${Date.now()}`;
  const testEmployee = await prisma.employee.create({
    data: {
      employeeCode: testEmpCode,
      firstName: 'TestStaff',
      lastName: 'NoUser',
      status: 'active',
    },
  });

  try {
    // Test 1: Invalid status validation (undefined / empty / unknown)
    {
      const req = createMockReq(adminUser, { status: undefined }, { id: '999999' });
      const res = createMockRes();
      await updateAdminLeaveStatus(req, res as any);
      assert(res.statusCode === 400 && res.data?.success === false, 'Rejects undefined status with HTTP 400');
    }
    {
      const req = createMockReq(adminUser, { status: 'INVALID_STATUS' }, { id: '999999' });
      const res = createMockRes();
      await updateAdminLeaveStatus(req, res as any);
      assert(res.statusCode === 400 && res.data?.success === false, 'Rejects invalid status string with HTTP 400');
    }

    // Test 2: Invalid leave ID (non-numeric / not found)
    {
      const req = createMockReq(adminUser, { status: 'APPROVED' }, { id: 'abc' });
      const res = createMockRes();
      await updateAdminLeaveStatus(req, res as any);
      assert(res.statusCode === 400 && res.data?.success === false, 'Rejects non-numeric ID with HTTP 400');
    }
    {
      const req = createMockReq(adminUser, { status: 'APPROVED' }, { id: '99999999' });
      const res = createMockRes();
      await updateAdminLeaveStatus(req, res as any);
      assert(res.statusCode === 404 && res.data?.success === false, 'Returns HTTP 404 for non-existent leave ID');
    }

    // Create temporary test leave request for testEmployee (userId: null)
    const testLeave = await prisma.leaveRequest.create({
      data: {
        employeeId: testEmployee.id,
        type: 'CASUAL',
        fromDate: new Date('2026-11-10T00:00:00.000Z'),
        toDate: new Date('2026-11-12T00:00:00.000Z'), // 3 days
        reason: 'Family function',
        status: 'PENDING',
      },
    });

    // Test 3: Approve leave for employee without user account (was throwing 500 at notification.create)
    {
      const req = createMockReq(adminUser, { status: 'APPROVED', remarks: 'Approved by admin' }, { id: String(testLeave.id) });
      const res = createMockRes();
      await updateAdminLeaveStatus(req, res as any);
      assert(
        res.statusCode === 200 && res.data?.success === true && res.data?.leave?.status === 'APPROVED',
        'Successfully approves leave for employee without user account (no HTTP 500)',
        JSON.stringify(res.data)
      );

      // Verify leave balance was deducted
      const balance = await prisma.leaveBalance.findFirst({
        where: { employeeId: testEmployee.id },
      });
      assert(balance !== null && balance.casualUsed === 3, 'Deducted correct number of days (3) in leave balance');

      // Verify attendance was synced to LEAVE
      const attendance = await prisma.attendance.findMany({
        where: { employeeId: testEmployee.id, status: 'LEAVE' },
      });
      assert(attendance.length === 3, 'Synced attendance to LEAVE for all 3 days');
    }

    // Test 4: Idempotent Approval Retry (prevent duplicate deduction on retry)
    {
      const req = createMockReq(adminUser, { status: 'APPROVED', remarks: 'Retry approve' }, { id: String(testLeave.id) });
      const res = createMockRes();
      await updateAdminLeaveStatus(req, res as any);
      assert(res.statusCode === 200 && res.data?.success === true, 'Returns HTTP 200 on approval retry without error');

      const balance = await prisma.leaveBalance.findFirst({
        where: { employeeId: testEmployee.id },
      });
      assert(balance !== null && balance.casualUsed === 3, 'Prevented duplicate deduction on retry (used days still 3)');
    }

    // Test 5: Rejecting previously APPROVED leave (reverts balance and cleans up attendance)
    {
      const req = createMockReq(adminUser, { status: 'REJECTED', reviewNote: 'Change of plans' }, { id: String(testLeave.id) });
      const res = createMockRes();
      await updateAdminLeaveStatus(req, res as any);
      assert(
        res.statusCode === 200 && res.data?.success === true && res.data?.leave?.status === 'REJECTED',
        'Successfully rejects previously approved leave',
        JSON.stringify(res.data)
      );

      // Verify leave balance was restored
      const balance = await prisma.leaveBalance.findFirst({
        where: { employeeId: testEmployee.id },
      });
      assert(balance !== null && balance.casualUsed === 0, 'Reverted leave balance days back to 0');

      // Verify placeholder attendance records were cleaned up
      const attendance = await prisma.attendance.findMany({
        where: { employeeId: testEmployee.id, status: 'LEAVE' },
      });
      assert(attendance.length === 0, 'Cleaned up placeholder attendance records after rejection');
    }

    // Test 6: Idempotent Rejection Retry
    {
      const req = createMockReq(adminUser, { status: 'REJECTED', reviewNote: 'Retry reject' }, { id: String(testLeave.id) });
      const res = createMockRes();
      await updateAdminLeaveStatus(req, res as any);
      assert(res.statusCode === 200 && res.data?.success === true, 'Returns HTTP 200 on rejection retry without error');

      const balance = await prisma.leaveBalance.findFirst({
        where: { employeeId: testEmployee.id },
      });
      assert(balance !== null && balance.casualUsed === 0, 'Leave balance remains unchanged on rejection retry');
    }

    // Test 7: Rejecting a PENDING leave does NOT mark attendance as LEAVE
    {
      const pendingLeave = await prisma.leaveRequest.create({
        data: {
          employeeId: testEmployee.id,
          type: 'SICK',
          fromDate: new Date('2026-11-20T00:00:00.000Z'),
          toDate: new Date('2026-11-21T00:00:00.000Z'),
          reason: 'Sick',
          status: 'PENDING',
        },
      });

      const req = createMockReq(adminUser, { status: 'REJECTED', reviewNote: 'Not eligible' }, { id: String(pendingLeave.id) });
      const res = createMockRes();
      await updateAdminLeaveStatus(req, res as any);
      assert(res.statusCode === 200 && res.data?.leave?.status === 'REJECTED', 'Rejects pending leave cleanly');

      const attendance = await prisma.attendance.findMany({
        where: { employeeId: testEmployee.id, date: { in: ['2026-11-20', '2026-11-21'] } },
      });
      assert(attendance.length === 0, 'Does NOT create LEAVE attendance records when rejecting pending leave');

      // Cleanup pendingLeave
      await prisma.leaveRequest.delete({ where: { id: pendingLeave.id } });
    }

    // Test 8: Cannot approve or reject a CANCELLED leave
    {
      await prisma.leaveRequest.update({
        where: { id: testLeave.id },
        data: { status: 'CANCELLED' },
      });

      const req = createMockReq(adminUser, { status: 'APPROVED' }, { id: String(testLeave.id) });
      const res = createMockRes();
      await updateAdminLeaveStatus(req, res as any);
      assert(res.statusCode === 400 && res.data?.success === false, 'Cannot approve a cancelled leave request (HTTP 400)');
    }

    // Test 9: Week Off approval does NOT consume casual leave
    {
      const weekOffLeave = await prisma.leaveRequest.create({
        data: {
          employeeId: testEmployee.id,
          type: 'WEEK_OFF',
          fromDate: new Date('2026-11-25T00:00:00.000Z'),
          toDate: new Date('2026-11-25T00:00:00.000Z'),
          reason: 'Weekly off',
          status: 'PENDING',
        },
      });

      const req = createMockReq(adminUser, { status: 'APPROVED' }, { id: String(weekOffLeave.id) });
      const res = createMockRes();
      await updateAdminLeaveStatus(req, res as any);
      assert(res.statusCode === 200 && res.data?.success === true, 'Approves WEEK_OFF successfully');

      const balance = await prisma.leaveBalance.findFirst({
        where: { employeeId: testEmployee.id },
      });
      assert(balance !== null && balance.casualUsed === 0, 'WEEK_OFF does NOT consume casual leave balance');

      await prisma.attendance.deleteMany({ where: { employeeId: testEmployee.id, date: '2026-11-25' } });
      await prisma.leaveRequest.delete({ where: { id: weekOffLeave.id } });
    }

    // Cleanup testLeave
    await prisma.leaveRequest.delete({ where: { id: testLeave.id } });
  } finally {
    // Non-destructive cleanup of all test records
    await prisma.attendance.deleteMany({ where: { employeeId: testEmployee.id } });
    await prisma.leaveBalance.deleteMany({ where: { employeeId: testEmployee.id } });
    await prisma.notification.deleteMany({ where: { employeeId: testEmployee.id } });
    await prisma.employee.delete({ where: { id: testEmployee.id } });
    await prisma.$disconnect();
  }

  console.log(`\n================================`);
  console.log(`Test Results: ${passed}/${total} passed (${((passed / total) * 100).toFixed(0)}%)`);
  console.log(`================================\n`);

  if (passed !== total) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test suite unhandled error:', err);
  process.exit(1);
});
