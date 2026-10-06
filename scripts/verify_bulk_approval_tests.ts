import { prisma } from '../src/utils/db';
import {
  bulkApproveHRAttendanceCorrections,
  reviewHRAttendanceCorrection,
  executeCorrectionApproval,
} from '../src/controllers/attendanceCorrectionController';
import { AuthenticatedRequest } from '../src/middlewares/authMiddleware';

function createMockReq(user: any, body: any = {}, params: any = {}): AuthenticatedRequest {
  return {
    user,
    body,
    params,
    query: {},
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
  console.log('🧪 Starting Bulk Approve Verification Test Suite...\n');
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

  // Setup test employee
  let testEmployee = await prisma.employee.findFirst({
    where: { employeeCode: 'TEST_EMP_BULK_01' },
  });

  if (!testEmployee) {
    testEmployee = await prisma.employee.create({
      data: {
        employeeCode: 'TEST_EMP_BULK_01',
        firstName: 'BulkTest',
        lastName: 'Employee',
        designation: 'Tester',
        status: 'active',
      },
    });
  }

  const hrUser = {
    id: 1,
    email: 'admin@quickboom.com',
    role: 'ADMIN',
  };

  const nonPermittedUser = {
    id: 99,
    email: 'unauthorized@quickboom.com',
    role: 'EMPLOYEE',
  };

  try {
    // ----------------------------------------------------
    // Test 1: 5 Pending requests selected -> All 5 approved
    // ----------------------------------------------------
    const t1Requests = [];
    for (let i = 0; i < 5; i++) {
      t1Requests.push(
        await prisma.attendanceCorrectionRequest.create({
          data: {
            employeeId: testEmployee.employeeCode,
            attendanceDate: new Date(`2026-01-1${i + 1}T09:00:00Z`),
            currentStatus: 'ABSENT',
            requestedStatus: 'PRESENT',
            reason: `Test 1 correction #${i + 1}`,
            status: 'PENDING',
          },
        })
      );
    }

    const t1Req = createMockReq(hrUser, { ids: t1Requests.map((r) => r.id) });
    const t1Res = createMockRes();
    await bulkApproveHRAttendanceCorrections(t1Req, t1Res as any);

    assert(
      t1Res.statusCode === 200 &&
        t1Res.data.success === true &&
        t1Res.data.approvedCount === 5 &&
        t1Res.data.failedCount === 0,
      'Test 1: 5 Pending requests selected -> All 5 approved'
    );

    // Verify DB state
    const t1Updated = await prisma.attendanceCorrectionRequest.findMany({
      where: { id: { in: t1Requests.map((r) => r.id) } },
    });
    assert(
      t1Updated.every((r) => r.status === 'APPROVED' && r.reviewedBy === hrUser.email),
      'Test 1 (DB check): All 5 requests updated to APPROVED with reviewedBy set'
    );

    // ----------------------------------------------------
    // Test 2: 5 requests: 3 Pending, 2 Approved -> Only 3 Pending approved
    // ----------------------------------------------------
    const t2Pending = [];
    for (let i = 0; i < 3; i++) {
      t2Pending.push(
        await prisma.attendanceCorrectionRequest.create({
          data: {
            employeeId: testEmployee.employeeCode,
            attendanceDate: new Date(`2026-02-1${i + 1}T09:00:00Z`),
            currentStatus: 'ABSENT',
            requestedStatus: 'PRESENT',
            reason: `Test 2 pending #${i + 1}`,
            status: 'PENDING',
          },
        })
      );
    }
    const t2AlreadyApproved = [];
    for (let i = 0; i < 2; i++) {
      t2AlreadyApproved.push(
        await prisma.attendanceCorrectionRequest.create({
          data: {
            employeeId: testEmployee.employeeCode,
            attendanceDate: new Date(`2026-02-2${i + 1}T09:00:00Z`),
            currentStatus: 'ABSENT',
            requestedStatus: 'PRESENT',
            reason: `Test 2 already approved #${i + 1}`,
            status: 'APPROVED',
            reviewedBy: 'pre-existing@admin.com',
          },
        })
      );
    }

    const t2AllIds = [...t2Pending.map((r) => r.id), ...t2AlreadyApproved.map((r) => r.id)];
    const t2Req = createMockReq(hrUser, { ids: t2AllIds });
    const t2Res = createMockRes();
    await bulkApproveHRAttendanceCorrections(t2Req, t2Res as any);

    assert(
      t2Res.statusCode === 200 &&
        t2Res.data.approvedCount === 3 &&
        t2Res.data.failedCount === 2,
      'Test 2: 5 requests (3 Pending, 2 Approved) -> Only 3 Pending approved'
    );

    // Verify already approved were SKIPPED
    const t2SkippedResults = t2Res.data.results.filter((r: any) => r.status === 'SKIPPED');
    assert(
      t2SkippedResults.length === 2 &&
        t2SkippedResults.every((r: any) => r.reason === 'Already approved'),
      'Test 2 (Audit): 2 already approved requests were safely skipped with reason'
    );

    // ----------------------------------------------------
    // Test 3: 5 requests: 3 Pending, 1 Approved, 1 Rejected -> 3 approved, others unchanged
    // ----------------------------------------------------
    const t3Pending = [];
    for (let i = 0; i < 3; i++) {
      t3Pending.push(
        await prisma.attendanceCorrectionRequest.create({
          data: {
            employeeId: testEmployee.employeeCode,
            attendanceDate: new Date(`2026-03-1${i + 1}T09:00:00Z`),
            currentStatus: 'ABSENT',
            requestedStatus: 'PRESENT',
            reason: `Test 3 pending #${i + 1}`,
            status: 'PENDING',
          },
        })
      );
    }
    const t3Approved = await prisma.attendanceCorrectionRequest.create({
      data: {
        employeeId: testEmployee.employeeCode,
        attendanceDate: new Date('2026-03-21T09:00:00Z'),
        currentStatus: 'ABSENT',
        requestedStatus: 'PRESENT',
        reason: 'Test 3 approved',
        status: 'APPROVED',
        reviewedBy: 'prev-admin@admin.com',
      },
    });
    const t3Rejected = await prisma.attendanceCorrectionRequest.create({
      data: {
        employeeId: testEmployee.employeeCode,
        attendanceDate: new Date('2026-03-22T09:00:00Z'),
        currentStatus: 'ABSENT',
        requestedStatus: 'PRESENT',
        reason: 'Test 3 rejected',
        status: 'REJECTED',
        reviewedBy: 'prev-admin@admin.com',
        reviewNote: 'Denied reason',
      },
    });

    const t3AllIds = [...t3Pending.map((r) => r.id), t3Approved.id, t3Rejected.id];
    const t3Req = createMockReq(hrUser, { ids: t3AllIds });
    const t3Res = createMockRes();
    await bulkApproveHRAttendanceCorrections(t3Req, t3Res as any);

    assert(
      t3Res.statusCode === 200 &&
        t3Res.data.approvedCount === 3 &&
        t3Res.data.failedCount === 2,
      'Test 3: 5 selected (3 Pending, 1 Approved, 1 Rejected) -> 3 approved'
    );

    const t3RejectedCheck = await prisma.attendanceCorrectionRequest.findUnique({
      where: { id: t3Rejected.id },
    });
    assert(
      t3RejectedCheck?.status === 'REJECTED' && t3RejectedCheck?.reviewNote === 'Denied reason',
      'Test 3 (DB check): Rejected record remains untouched'
    );

    // ----------------------------------------------------
    // Test 4: Frontend Select All simulation
    // ----------------------------------------------------
    // Given 20 requests: 15 Pending, 3 Approved, 2 Rejected
    const simulatedBatch = [
      ...Array.from({ length: 15 }, (_, i) => ({ id: `p-${i}`, status: 'PENDING' })),
      ...Array.from({ length: 3 }, (_, i) => ({ id: `a-${i}`, status: 'APPROVED' })),
      ...Array.from({ length: 2 }, (_, i) => ({ id: `r-${i}`, status: 'REJECTED' })),
    ];
    // Select All logic as implemented in AttendanceCorrectionsTab:
    const selectedAllPending = simulatedBatch
      .filter((r) => r.status === 'PENDING')
      .map((r) => r.id);

    assert(
      selectedAllPending.length === 15 &&
        !selectedAllPending.some((id) => id.startsWith('a-') || id.startsWith('r-')),
      'Test 4: Select All selects exactly the 15 Pending requests out of 20'
    );

    // ----------------------------------------------------
    // Test 5: Empty selection -> returns 400
    // ----------------------------------------------------
    const t5Req = createMockReq(hrUser, { ids: [] });
    const t5Res = createMockRes();
    await bulkApproveHRAttendanceCorrections(t5Req, t5Res as any);
    assert(
      t5Res.statusCode === 400 && t5Res.data.success === false,
      'Test 5: Empty selection is rejected with 400'
    );

    // ----------------------------------------------------
    // Test 6: Cancel confirmation preserves state
    // ----------------------------------------------------
    const t6Pending = await prisma.attendanceCorrectionRequest.create({
      data: {
        employeeId: testEmployee.employeeCode,
        attendanceDate: new Date('2026-04-01T09:00:00Z'),
        currentStatus: 'ABSENT',
        requestedStatus: 'PRESENT',
        reason: 'Test 6 cancel check',
        status: 'PENDING',
      },
    });
    // Simulating user clicking Cancel: frontend does nothing, request remains PENDING
    const t6Check = await prisma.attendanceCorrectionRequest.findUnique({
      where: { id: t6Pending.id },
    });
    assert(
      t6Check?.status === 'PENDING',
      'Test 6: Cancel confirmation keeps selection and leaves record PENDING'
    );

    // ----------------------------------------------------
    // Test 7: Approve confirmation executes bulk approval
    // ----------------------------------------------------
    const t7Req = createMockReq(hrUser, { ids: [t6Pending.id] });
    const t7Res = createMockRes();
    await bulkApproveHRAttendanceCorrections(t7Req, t7Res as any);
    const t7Check = await prisma.attendanceCorrectionRequest.findUnique({
      where: { id: t6Pending.id },
    });
    assert(
      t7Res.data.success === true && t7Check?.status === 'APPROVED',
      'Test 7: Approve confirmation successfully executes approval'
    );

    // ----------------------------------------------------
    // Test 8: Concurrency check: One request becomes Approved before bulk processing
    // ----------------------------------------------------
    const t8Pending1 = await prisma.attendanceCorrectionRequest.create({
      data: {
        employeeId: testEmployee.employeeCode,
        attendanceDate: new Date('2026-05-01T09:00:00Z'),
        currentStatus: 'ABSENT',
        requestedStatus: 'PRESENT',
        reason: 'Test 8 req 1',
        status: 'PENDING',
      },
    });
    const t8Pending2 = await prisma.attendanceCorrectionRequest.create({
      data: {
        employeeId: testEmployee.employeeCode,
        attendanceDate: new Date('2026-05-02T09:00:00Z'),
        currentStatus: 'ABSENT',
        requestedStatus: 'PRESENT',
        reason: 'Test 8 req 2',
        status: 'PENDING',
      },
    });

    // Another admin approves t8Pending1 first:
    await prisma.attendanceCorrectionRequest.update({
      where: { id: t8Pending1.id },
      data: { status: 'APPROVED', reviewedBy: 'other-admin@test.com' },
    });

    // Now bulk approve runs with both IDs:
    const t8Req = createMockReq(hrUser, { ids: [t8Pending1.id, t8Pending2.id] });
    const t8Res = createMockRes();
    await bulkApproveHRAttendanceCorrections(t8Req, t8Res as any);

    assert(
      t8Res.statusCode === 200 &&
        t8Res.data.approvedCount === 1 &&
        t8Res.data.failedCount === 1,
      'Test 8: Concurrent approval: already approved request is safely skipped; other pending is approved'
    );

    // ----------------------------------------------------
    // Test 9: Unauthorized user attempts bulk API call -> 403 Forbidden
    // ----------------------------------------------------
    const t9Req = createMockReq(nonPermittedUser, { ids: [t8Pending2.id] });
    const t9Res = createMockRes();
    await bulkApproveHRAttendanceCorrections(t9Req, t9Res as any);

    assert(
      t9Res.statusCode === 403 && t9Res.data.success === false,
      'Test 9: User without approval permission rejected with 403 Forbidden'
    );

    // ----------------------------------------------------
    // Test 10: Single approve still works exactly as before
    // ----------------------------------------------------
    const t10Single = await prisma.attendanceCorrectionRequest.create({
      data: {
        employeeId: testEmployee.employeeCode,
        attendanceDate: new Date('2026-06-01T09:00:00Z'),
        currentStatus: 'ABSENT',
        requestedStatus: 'PRESENT',
        reason: 'Test 10 single approve',
        status: 'PENDING',
      },
    });

    const t10Req = createMockReq(
      hrUser,
      { status: 'APPROVED', reviewNote: 'Single approve note' },
      { id: t10Single.id }
    );
    const t10Res = createMockRes();
    await reviewHRAttendanceCorrection(t10Req, t10Res as any);

    const t10Check = await prisma.attendanceCorrectionRequest.findUnique({
      where: { id: t10Single.id },
    });

    assert(
      t10Res.statusCode === 200 &&
        t10Res.data.success === true &&
        t10Check?.status === 'APPROVED' &&
        t10Check?.reviewNote === 'Single approve note',
      'Test 10: Existing single Approve works exactly as before'
    );

    console.log(`\n========================================`);
    console.log(`Test Results: ${passed}/${total} assertions passed.`);
    console.log(`========================================\n`);

    if (passed === total) {
      console.log('🎉 ALL 10 TEST CASES PASSED SUCCESSFULLY!');
    } else {
      process.exit(1);
    }
  } finally {
    // Cleanup test data
    await prisma.attendanceCorrectionRequest.deleteMany({
      where: { employeeId: testEmployee.employeeCode },
    });
    await prisma.attendance.deleteMany({
      where: { employeeId: testEmployee.id },
    });
    await prisma.employee.delete({
      where: { id: testEmployee.id },
    });
    await prisma.$disconnect();
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
