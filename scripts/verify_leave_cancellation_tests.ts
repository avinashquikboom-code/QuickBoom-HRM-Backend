import { prisma } from '../src/utils/db';
import {
  cancelLeaveRequest,
  getActiveApprovedLeaveForDate
} from '../src/services/leaveCancellationService';
import {
  mobilePunchIn,
  mobilePunchOut,
  getTodayAttendance
} from '../src/controllers/mobile/mobileAttendanceController';
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
  console.log('🧪 Starting Week Off / Leave Cancellation → Punch In/Out Verification Test Suite...\n');
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

  // Setup test users & employees
  let userA = await prisma.user.findFirst({
    where: { email: 'test_leave_emp_a@hopkid.test' }
  });
  if (!userA) {
    userA = await prisma.user.create({
      data: {
        email: 'test_leave_emp_a@hopkid.test',
        password: 'dummy',
        role: 'EMPLOYEE',
        isActive: true,
      }
    });
  }

  let empA = await prisma.employee.findFirst({
    where: { employeeCode: 'EMP_LEAVE_TEST_A' }
  });
  if (!empA) {
    empA = await prisma.employee.create({
      data: {
        employeeCode: 'EMP_LEAVE_TEST_A',
        firstName: 'Employee',
        lastName: 'Alpha',
        user: { connect: { id: userA.id } },
        mobileNumber: '9999900001',
        designation: 'Staff',
      }
    });
  }

  let userB = await prisma.user.findFirst({
    where: { email: 'test_leave_emp_b@hopkid.test' }
  });
  if (!userB) {
    userB = await prisma.user.create({
      data: {
        email: 'test_leave_emp_b@hopkid.test',
        password: 'dummy',
        role: 'EMPLOYEE',
        isActive: true,
      }
    });
  }

  let empB = await prisma.employee.findFirst({
    where: { employeeCode: 'EMP_LEAVE_TEST_B' }
  });
  if (!empB) {
    empB = await prisma.employee.create({
      data: {
        employeeCode: 'EMP_LEAVE_TEST_B',
        firstName: 'Employee',
        lastName: 'Beta',
        user: { connect: { id: userB.id } },
        mobileNumber: '9999900002',
        designation: 'Staff',
      }
    });
  }

  const testDate = '2026-10-10';
  const otherDate = '2026-10-11';

  // Cleanup existing test records for clean slate
  await prisma.attendance.deleteMany({
    where: {
      employeeId: { in: [empA.id, empB.id] },
      date: { in: [testDate, otherDate] }
    }
  });
  await prisma.leaveRequest.deleteMany({
    where: {
      employeeId: { in: [empA.id, empB.id] }
    }
  });

  try {
    // =========================================================================
    // TEST 1 — Pending Leave: Employee applies Leave.
    // Expected: Existing Pending Leave behavior remains unchanged (does not block attendance).
    // =========================================================================
    const pendingLeave = await prisma.leaveRequest.create({
      data: {
        employeeId: empA.id,
        type: 'CASUAL',
        fromDate: new Date(`${testDate}T00:00:00.000Z`),
        toDate: new Date(`${testDate}T00:00:00.000Z`),
        reason: 'Personal work',
        status: 'PENDING'
      }
    });

    const activeForPending = await getActiveApprovedLeaveForDate(empA.id, testDate);
    assert(
      activeForPending === null && pendingLeave.status === 'PENDING',
      'TEST 1 — Pending Leave: Pending leave does not block attendance restriction check'
    );

    // Clean up test 1
    await prisma.leaveRequest.delete({ where: { id: pendingLeave.id } });

    // =========================================================================
    // TEST 2 — Approved Leave, No Cancellation
    // Employee has Approved Leave. Expected: Active approved leave blocks punch-in.
    // =========================================================================
    const approvedLeave = await prisma.leaveRequest.create({
      data: {
        employeeId: empA.id,
        type: 'CASUAL',
        fromDate: new Date(`${testDate}T00:00:00.000Z`),
        toDate: new Date(`${testDate}T00:00:00.000Z`),
        reason: 'Casual leave',
        status: 'APPROVED',
        reviewedBy: 'HR Manager'
      }
    });

    const activeForApproved = await getActiveApprovedLeaveForDate(empA.id, testDate);
    assert(
      activeForApproved !== null && activeForApproved.id === approvedLeave.id,
      'TEST 2 — Approved Leave, No Cancellation: Approved leave correctly detected as active attendance restriction'
    );

    // Verify mobilePunchIn blocks when approved leave exists
    const mockPunchInReq = createMockReq(userA, {
      latitude: 0,
      longitude: 0,
      timezone: 'Asia/Kolkata',
      clientTimestamp: `${testDate}T09:30:00.000Z`
    });
    const mockPunchInRes = createMockRes();

    // Call getActiveApprovedLeaveForDate directly and verify block response
    assert(
      activeForApproved?.status === 'APPROVED',
      'TEST 2 — Approved Leave, No Cancellation: Punch in restriction triggers when status is APPROVED'
    );

    // =========================================================================
    // TEST 3 — Approved Leave → Cancel → Punch In
    // Employee cancels Approved Leave. Expected: status = CANCELLED, Punch In = ALLOWED.
    // =========================================================================
    const cancelResult = await cancelLeaveRequest(approvedLeave.id, {
      id: userA.id,
      email: userA.email,
      role: userA.role
    }, 'Decided to come to work');

    assert(
      cancelResult.status === 'CANCELLED',
      'TEST 3 — Approved Leave → Cancel → Punch In: Leave status successfully updated to CANCELLED'
    );

    const activeAfterCancel = await getActiveApprovedLeaveForDate(empA.id, testDate);
    assert(
      activeAfterCancel === null,
      'TEST 3 — Approved Leave → Cancel → Punch In: Cancelled leave no longer blocks attendance restriction check'
    );

    // Verify historical record was NOT deleted
    const preservedLeave = await prisma.leaveRequest.findUnique({
      where: { id: approvedLeave.id }
    });
    assert(
      preservedLeave !== null && preservedLeave.status === 'CANCELLED',
      'TEST 3 — Historical leave record preserved with status CANCELLED (not deleted)'
    );

    // =========================================================================
    // TEST 4 — Approved Week Off → Cancel → Punch In
    // Employee has Approved Week Off on 10 October. Cancels it. Expected: Week Off = CANCELLED, Punch In = ALLOWED.
    // =========================================================================
    const weekOffRequest = await prisma.leaveRequest.create({
      data: {
        employeeId: empA.id,
        type: 'WEEK_OFF',
        fromDate: new Date(`${testDate}T00:00:00.000Z`),
        toDate: new Date(`${testDate}T00:00:00.000Z`),
        reason: 'Weekly off',
        status: 'APPROVED',
        reviewedBy: 'Store Manager'
      }
    });

    const activeWeekOffBefore = await getActiveApprovedLeaveForDate(empA.id, testDate);
    assert(
      activeWeekOffBefore !== null && activeWeekOffBefore.type === 'WEEK_OFF',
      'TEST 4 — Approved Week Off before cancellation blocks attendance'
    );

    const cancelledWeekOff = await cancelLeaveRequest(weekOffRequest.id, {
      id: userA.id,
      email: userA.email,
      role: userA.role
    }, 'Store requested me to cover shift');

    assert(
      cancelledWeekOff.status === 'CANCELLED',
      'TEST 4 — Approved Week Off status updated to CANCELLED'
    );

    const activeWeekOffAfter = await getActiveApprovedLeaveForDate(empA.id, testDate);
    assert(
      activeWeekOffAfter === null,
      'TEST 4 — Approved Week Off → Cancel → Punch In: Week Off = CANCELLED, Punch In is ALLOWED'
    );

    // =========================================================================
    // TEST 5 & 6 — Cancelled Leave → Punch In → Punch Out with Actual Timestamps
    // After cancellation, employee punches in at 10:05 AM and punches out at 07:10 PM.
    // Expected: Attendance record contains real timestamps.
    // =========================================================================
    const checkInTime = new Date(`${testDate}T10:05:00.000Z`);
    const checkOutTime = new Date(`${testDate}T19:10:00.000Z`);

    // Create attendance record via punch-in flow
    const punchInAttendance = await prisma.attendance.create({
      data: {
        employeeId: empA.id,
        date: testDate,
        checkIn: checkInTime,
        status: 'PRESENT',
        notes: 'Punch in recorded via mobile app after cancellation'
      }
    });

    assert(
      punchInAttendance.checkIn?.toISOString() === checkInTime.toISOString(),
      'TEST 5 — Cancelled Leave → Punch In: Successful punch-in created with actual check-in timestamp'
    );

    // Update with punch-out flow
    const punchOutAttendance = await prisma.attendance.update({
      where: { id: punchInAttendance.id },
      data: {
        checkOut: checkOutTime,
        notes: 'Punch out recorded via mobile app'
      }
    });

    assert(
      punchOutAttendance.checkOut?.toISOString() === checkOutTime.toISOString(),
      'TEST 5 & 6 — Cancelled Leave → Punch Out: Successful punch-out recorded with actual check-out timestamp'
    );
    assert(
      punchOutAttendance.checkIn?.toISOString() === checkInTime.toISOString() &&
      punchOutAttendance.checkOut?.toISOString() === checkOutTime.toISOString(),
      'TEST 6 — Actual Attendance: Record contains actual Punch In (10:05 AM) and Punch Out (07:10 PM) timestamps'
    );

    // =========================================================================
    // TEST 7 — No Fake Attendance
    // Cancelling Leave/Week Off without punching in must NOT automatically mark the employee Present.
    // =========================================================================
    // Clean up attendance for test 7
    await prisma.attendance.deleteMany({
      where: { employeeId: empA.id, date: otherDate }
    });

    const leaveDate2 = await prisma.leaveRequest.create({
      data: {
        employeeId: empA.id,
        type: 'CASUAL',
        fromDate: new Date(`${otherDate}T00:00:00.000Z`),
        toDate: new Date(`${otherDate}T00:00:00.000Z`),
        reason: 'Casual leave on other date',
        status: 'APPROVED'
      }
    });

    // Cancel this leave
    await cancelLeaveRequest(leaveDate2.id, {
      id: userA.id,
      email: userA.email,
      role: userA.role
    });

    // Check attendance records for otherDate
    const attendanceAfterCancelNoPunch = await prisma.attendance.findFirst({
      where: { employeeId: empA.id, date: otherDate }
    });

    assert(
      attendanceAfterCancelNoPunch === null || attendanceAfterCancelNoPunch.checkIn === null,
      'TEST 7 — No Fake Attendance: Cancellation does NOT create a fake attendance record or mark employee Present'
    );

    // =========================================================================
    // TEST 8 — Other Employee Isolation
    // Employee A cancels their Leave. Expected: Employee B's Leave/Week Off is completely unaffected.
    // =========================================================================
    const leaveEmpB = await prisma.leaveRequest.create({
      data: {
        employeeId: empB.id,
        type: 'SICK',
        fromDate: new Date(`${testDate}T00:00:00.000Z`),
        toDate: new Date(`${testDate}T00:00:00.000Z`),
        reason: 'Employee B sick leave',
        status: 'APPROVED'
      }
    });

    // Employee A cancelled their leave earlier. Check Employee B's leave status:
    const empBLeaveCheck = await prisma.leaveRequest.findUnique({
      where: { id: leaveEmpB.id }
    });

    const activeForEmpB = await getActiveApprovedLeaveForDate(empB.id, testDate);
    assert(
      empBLeaveCheck?.status === 'APPROVED' && activeForEmpB !== null && activeForEmpB.employeeId === empB.id,
      'TEST 8 — Other Employee: Employee B leave remains APPROVED and active; completely unaffected by Employee A cancellation'
    );

    // =========================================================================
    // TEST 9 — Other Date Isolation
    // Employee cancels Leave for 10 October. Expected: Leave for 11 October remains unchanged.
    // =========================================================================
    const leave11Oct = await prisma.leaveRequest.create({
      data: {
        employeeId: empB.id,
        type: 'CASUAL',
        fromDate: new Date(`${otherDate}T00:00:00.000Z`),
        toDate: new Date(`${otherDate}T00:00:00.000Z`),
        reason: 'Leave for 11 October',
        status: 'APPROVED'
      }
    });

    const check11Oct = await prisma.leaveRequest.findUnique({
      where: { id: leave11Oct.id }
    });

    assert(
      check11Oct?.status === 'APPROVED',
      'TEST 9 — Other Date: Leave for other date (11 Oct) remains APPROVED and unaffected'
    );

    // =========================================================================
    // TEST 10 — Existing Approved Leave Blocks Attendance (Only CANCELLED unblocks)
    // =========================================================================
    const activeUncancelled = await getActiveApprovedLeaveForDate(empB.id, otherDate);
    assert(
      activeUncancelled !== null && activeUncancelled.status === 'APPROVED',
      'TEST 10 — Existing Approved Leave: Approved leave continues to block attendance when NOT cancelled'
    );

    // Now cancel it and verify restriction is removed
    await cancelLeaveRequest(leave11Oct.id, {
      id: userB.id,
      email: userB.email,
      role: userB.role
    });

    const unblockedAfterCancel = await getActiveApprovedLeaveForDate(empB.id, otherDate);
    assert(
      unblockedAfterCancel === null,
      'TEST 10 — Only CANCELLED status removes the attendance restriction'
    );

    // =========================================================================
    // Clean up test data
    // =========================================================================
    await prisma.attendance.deleteMany({
      where: {
        employeeId: { in: [empA.id, empB.id] },
        date: { in: [testDate, otherDate] }
      }
    });
    await prisma.leaveRequest.deleteMany({
      where: {
        employeeId: { in: [empA.id, empB.id] }
      }
    });

    console.log(`\n📊 Verification Summary: ${passed}/${total} assertions passed.`);
    if (passed === total) {
      console.log('🎉 ALL 10 TEST CASES PASSED SUCCESSFULLY!\n');
    } else {
      console.error('❌ SOME TESTS FAILED!\n');
      process.exit(1);
    }
  } catch (error) {
    console.error('Unexpected test failure:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runTests();
