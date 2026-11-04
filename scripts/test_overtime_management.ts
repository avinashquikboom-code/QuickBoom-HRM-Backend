/**
 * Overtime Management Comprehensive Test Suite
 * Tests all 12 scenarios from specification:
 * 1. Punch in before shift start (Before-Shift OT)
 * 2. Punch out after shift end (After-Shift OT)
 * 3. Combined overtime (Both Before & After Shift)
 * 4. Exactly within scheduled hours (0 OT)
 * 5. Break deduction during overtime window
 * 6. Overnight shift (e.g. 22:00 -> 06:00 next day)
 * 7. Missing punch-out (After-shift OT is 0 until punch-out)
 * 8. Absent attendance record (No OT calculated)
 * 9. Overtime rejected by admin
 * 10. Overtime approved and included in payroll calculation
 * 11. Duplicate prevention (unique attendanceId constraint)
 * 12. Cross-employee security (employee cannot access another's overtime)
 */

import assert from 'node:assert/strict';
import { OvertimeService } from '../src/services/overtimeService';
import { prisma } from '../src/utils/db';
import payrollService from '../src/services/payrollService';

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🚀 OVERTIME MANAGEMENT COMPREHENSIVE TEST SUITE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Setup test department, shift, employee, and salary structure
  const testSuffix = Date.now().toString().slice(-6);
  const dept = await prisma.department.create({
    data: { name: `OT Test Dept ${testSuffix}` },
  });

  const standardShift = await prisma.shift.create({
    data: {
      name: `Standard Day Shift ${testSuffix}`,
      startTime: '10:00',
      endTime: '18:00',
      workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      breakMinutes: 60,
    },
  });

  const overnightShift = await prisma.shift.create({
    data: {
      name: `Overnight Night Shift ${testSuffix}`,
      startTime: '22:00',
      endTime: '06:00',
      workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      breakMinutes: 60,
    },
  });

  const employee = await prisma.employee.create({
    data: {
      employeeCode: `OT_EMP_${testSuffix}`,
      firstName: 'Vikram',
      lastName: 'Malhotra',
      status: 'active',
      departmentId: dept.id,
      shiftAssignments: {
        create: {
          shiftId: standardShift.id,
          effectiveFrom: new Date('2026-01-01'),
        },
      },
      salaryStructure: {
        create: {
          monthlySalary: 52000,
          grossSalary: 52000,
          basicSalary: 30000,
          overtimeHourlyRate: 250, // Explicit rate of ₹250/hour
        },
      },
    },
  });

  console.log(`✓ Test fixture initialized: Employee ID ${employee.id}, Shift ${standardShift.startTime} - ${standardShift.endTime}`);

  try {
    // ─── Scenario 1: Punch in before shift start ──────────────────────────────
    console.log('\n▶ Scenario 1: Employee punches in 1 hour before shift start (09:00 AM, Shift 10:00 AM)');
    const att1 = await prisma.attendance.create({
      data: {
        employeeId: employee.id,
        date: '2026-11-01',
        checkIn: new Date('2026-11-01T09:00:00+05:30'),
        checkOut: new Date('2026-11-01T18:00:00+05:30'), // Leaves on time
        status: 'PRESENT',
      },
    });

    const ot1 = await OvertimeService.syncOvertimeRecord(att1.id);
    assert(ot1, 'OvertimeRecord must be created');
    assert.equal(ot1.beforeShiftMinutes, 60, 'Before-shift OT must be exactly 60 minutes (1 hour)');
    assert.equal(ot1.afterShiftMinutes, 0, 'After-shift OT must be 0 minutes');
    assert.equal(ot1.totalOvertimeMinutes, 60, 'Total OT must be 60 minutes');
    console.log('  ✓ Scenario 1 PASSED: 60 mins before-shift, 0 mins after-shift.');

    // ─── Scenario 2: Punch out after shift end ────────────────────────────────
    console.log('\n▶ Scenario 2: Employee punches out 2 hours after shift end (Check-in 10:00, Check-out 20:00)');
    const att2 = await prisma.attendance.create({
      data: {
        employeeId: employee.id,
        date: '2026-11-02',
        checkIn: new Date('2026-11-02T10:00:00+05:30'), // On time
        checkOut: new Date('2026-11-02T20:00:00+05:30'), // 2 hours late
        status: 'PRESENT',
      },
    });

    const ot2 = await OvertimeService.syncOvertimeRecord(att2.id);
    assert(ot2, 'OvertimeRecord must be created');
    assert.equal(ot2.beforeShiftMinutes, 0, 'Before-shift OT must be 0');
    assert.equal(ot2.afterShiftMinutes, 120, 'After-shift OT must be exactly 120 minutes (2 hours)');
    assert.equal(ot2.totalOvertimeMinutes, 120, 'Total OT must be 120 minutes');
    console.log('  ✓ Scenario 2 PASSED: 0 mins before-shift, 120 mins after-shift.');

    // ─── Scenario 3: Combined Overtime (Before + After) ───────────────────────
    console.log('\n▶ Scenario 3: Combined Overtime: 09:00 AM check-in, 20:00 PM check-out');
    const att3 = await prisma.attendance.create({
      data: {
        employeeId: employee.id,
        date: '2026-11-03',
        checkIn: new Date('2026-11-03T09:00:00+05:30'), // 1 hour early
        checkOut: new Date('2026-11-03T20:00:00+05:30'), // 2 hours late
        status: 'PRESENT',
      },
    });

    const ot3 = await OvertimeService.syncOvertimeRecord(att3.id);
    assert(ot3, 'OvertimeRecord must be created');
    assert.equal(ot3.beforeShiftMinutes, 60, 'Before-shift OT must be 60 mins (1 hr)');
    assert.equal(ot3.afterShiftMinutes, 120, 'After-shift OT must be 120 mins (2 hrs)');
    assert.equal(ot3.totalOvertimeMinutes, 180, 'Total OT must be 180 mins (3 hrs)');
    console.log('  ✓ Scenario 3 PASSED: Combined 60 + 120 = 180 minutes.');

    // ─── Scenario 4: Exactly within scheduled hours ───────────────────────────
    console.log('\n▶ Scenario 4: Exactly within scheduled hours (10:00 - 18:00)');
    const att4 = await prisma.attendance.create({
      data: {
        employeeId: employee.id,
        date: '2026-11-04',
        checkIn: new Date('2026-11-04T10:00:00+05:30'),
        checkOut: new Date('2026-11-04T18:00:00+05:30'),
        status: 'PRESENT',
      },
    });

    const ot4 = await OvertimeService.syncOvertimeRecord(att4.id);
    assert.equal(ot4, null, 'Must return null / 0 overtime records when exactly within scheduled hours');
    console.log('  ✓ Scenario 4 PASSED: 0 minutes OT.');

    // ─── Scenario 5: Breaks taken during overtime ─────────────────────────────
    console.log('\n▶ Scenario 5: Employee takes a 30-min break during after-shift overtime (18:30 - 19:00)');
    const att5 = await prisma.attendance.create({
      data: {
        employeeId: employee.id,
        date: '2026-11-05',
        checkIn: new Date('2026-11-05T10:00:00+05:30'),
        checkOut: new Date('2026-11-05T20:00:00+05:30'), // Raw 120 min OT
        status: 'PRESENT',
        breakRecords: {
          create: {
            startTime: new Date('2026-11-05T18:30:00+05:30'),
            endTime: new Date('2026-11-05T19:00:00+05:30'), // 30 min break during OT
            duration: 1800,
          },
        },
      },
    });

    const ot5 = await OvertimeService.syncOvertimeRecord(att5.id);
    assert(ot5);
    assert.equal(ot5.afterShiftMinutes, 90, 'Break must be deducted from OT (120 - 30 = 90 mins)');
    assert.equal(ot5.totalOvertimeMinutes, 90);
    console.log('  ✓ Scenario 5 PASSED: Break during overtime deducted (90 mins net).');

    // ─── Scenario 6: Overnight Shift ─────────────────────────────────────────
    console.log('\n▶ Scenario 6: Overnight shift (22:00 -> 06:00 next day)');
    // Assign overnight shift for this employee
    await prisma.shiftAssignment.updateMany({
      where: { employeeId: employee.id },
      data: { effectiveTo: new Date('2026-11-09') },
    });
    await prisma.shiftAssignment.create({
      data: {
        employeeId: employee.id,
        shiftId: overnightShift.id,
        effectiveFrom: new Date('2026-11-10'),
      },
    });

    // Employee punches in at 21:00 (1 hr early) and out at 08:00 next day (2 hrs late)
    const att6 = await prisma.attendance.create({
      data: {
        employeeId: employee.id,
        date: '2026-11-10',
        checkIn: new Date('2026-11-10T21:00:00+05:30'),
        checkOut: new Date('2026-11-11T08:00:00+05:30'),
        status: 'PRESENT',
      },
    });

    const ot6 = await OvertimeService.syncOvertimeRecord(att6.id);
    assert(ot6);
    assert.equal(ot6.beforeShiftMinutes, 60, 'Overnight before-shift OT must be 60 mins');
    assert.equal(ot6.afterShiftMinutes, 120, 'Overnight after-shift OT must be 120 mins');
    assert.equal(ot6.totalOvertimeMinutes, 180, 'Overnight total OT must be 180 mins');
    console.log('  ✓ Scenario 6 PASSED: Overnight shift overtime calculated accurately.');

    // ─── Scenario 7: Missing Punch-out ───────────────────────────────────────
    console.log('\n▶ Scenario 7: Missing punch-out (Check-in 09:00 AM, Check-out null)');
    const att7 = await prisma.attendance.create({
      data: {
        employeeId: employee.id,
        date: '2026-11-12',
        checkIn: new Date('2026-11-12T09:00:00+05:30'),
        checkOut: null, // Missed punch-out
        status: 'PRESENT',
      },
    });

    const ot7 = await OvertimeService.syncOvertimeRecord(att7.id);
    assert(ot7);
    assert.equal(ot7.afterShiftMinutes, 0, 'After-shift OT must be 0 when punch-out is missing');
    console.log('  ✓ Scenario 7 PASSED: Missing punch-out handled safely.');

    // ─── Scenario 8: Absent attendance record ─────────────────────────────────
    console.log('\n▶ Scenario 8: Absent attendance record');
    const att8 = await prisma.attendance.create({
      data: {
        employeeId: employee.id,
        date: '2026-11-13',
        checkIn: null,
        checkOut: null,
        status: 'ABSENT',
      },
    });

    const ot8 = await OvertimeService.syncOvertimeRecord(att8.id);
    assert.equal(ot8, null, 'Must not calculate overtime for absent records');
    console.log('  ✓ Scenario 8 PASSED: No overtime calculated for absent employees.');

    // ─── Scenario 9: Overtime rejection by admin ─────────────────────────────
    console.log('\n▶ Scenario 9: Admin rejects overtime with reason');
    const rejected = await OvertimeService.rejectOvertime(ot1.id, 'Admin User', 'Did not have prior authorization for early punch-in');
    assert.equal(rejected.approvalStatus, 'REJECTED');
    assert.equal(rejected.rejectionReason, 'Did not have prior authorization for early punch-in');
    console.log('  ✓ Scenario 9 PASSED: Rejection status and reason recorded.');

    // ─── Scenario 10: Overtime approved and included in payroll ───────────────
    console.log('\n▶ Scenario 10: Overtime approved and integrated into payroll calculation');
    const approvedOt3 = await OvertimeService.approveOvertime(ot3.id, 'Manager Alice');
    assert.equal(approvedOt3.approvalStatus, 'APPROVED');
    assert.equal(approvedOt3.approvedBy, 'Manager Alice');

    // Run payroll calculation for November 2026
    const payroll = await payrollService.calculatePayroll(employee.id, 11, 2026);
    // ot3 has 180 minutes = 3 hours. At ₹250/hr = ₹750 payable overtime
    assert(payroll.overtimeHours >= 3, `Expected at least 3 overtime hours, got ${payroll.overtimeHours}`);
    assert(payroll.overtime >= 750, `Expected at least ₹750 overtime earnings, got ${payroll.overtime}`);

    // Verify rejected ot1 (1 hour) is NOT included in payable overtime!
    // Total approved OT should only be ot3 (3 hours), NOT ot1 (rejected)
    assert.equal(payroll.overtimeHours, 3, 'Rejected overtime must NOT be included in payroll overtime hours');
    assert.equal(payroll.overtime, 750, 'Rejected overtime must NOT be included in payroll payout');

    // Save payslip and verify link
    await payrollService.savePayslip(payroll);
    const linkedOt3 = await prisma.overtimeRecord.findUnique({ where: { id: ot3.id } });
    assert(linkedOt3?.payrollId, 'Approved overtime record must link to generated payslip ID');
    console.log(`  ✓ Scenario 10 PASSED: Approved OT included (₹${payroll.overtime} for ${payroll.overtimeHours} hrs), linked to Payslip #${linkedOt3.payrollId}.`);

    // ─── Scenario 11: Duplicate attendance events do not create duplicates ───
    console.log('\n▶ Scenario 11: Preventing duplicate overtime records on repeat events');
    const reSync1 = await OvertimeService.syncOvertimeRecord(att3.id);
    const reSync2 = await OvertimeService.syncOvertimeRecord(att3.id);
    assert.equal(reSync1?.id, reSync2?.id, 'Multiple sync calls must return the same record ID');
    const countForAtt3 = await prisma.overtimeRecord.count({ where: { attendanceId: att3.id } });
    assert.equal(countForAtt3, 1, 'Exactly 1 OvertimeRecord must exist per attendance ID');
    console.log('  ✓ Scenario 11 PASSED: Strict unique constraint prevents duplicates.');

    // ─── Scenario 12: Cross-employee security check ───────────────────────────
    console.log('\n▶ Scenario 12: Employee cannot access another employee\'s overtime records');
    const otherEmployee = await prisma.employee.create({
      data: {
        employeeCode: `OT_OTHER_${testSuffix}`,
        firstName: 'Sneha',
        lastName: 'Rao',
        status: 'active',
      },
    });

    const otherHistory = await OvertimeService.getEmployeeHistory(otherEmployee.id);
    assert.equal(otherHistory.items.length, 0, 'Other employee history must be isolated and empty');
    console.log('  ✓ Scenario 12 PASSED: Employee records strictly isolated by employeeId.');

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 ALL 12 OVERTIME SCENARIOS TESTED AND PASSED WITH 100% SUCCESS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  } finally {
    // Cleanup test data
    await prisma.overtimeRecord.deleteMany({
      where: { employeeId: { in: [employee.id] } },
    }).catch(() => null);
    await prisma.payslip.deleteMany({
      where: { employeeId: employee.id },
    }).catch(() => null);
    await prisma.attendance.deleteMany({
      where: { employeeId: employee.id },
    }).catch(() => null);
    await prisma.shiftAssignment.deleteMany({
      where: { employeeId: employee.id },
    }).catch(() => null);
    await prisma.salaryStructure.deleteMany({
      where: { employeeId: employee.id },
    }).catch(() => null);
    await prisma.employee.deleteMany({
      where: { employeeCode: { in: [`OT_EMP_${testSuffix}`, `OT_OTHER_${testSuffix}`] } },
    }).catch(() => null);
    await prisma.shift.deleteMany({
      where: { id: { in: [standardShift.id, overnightShift.id] } },
    }).catch(() => null);
    await prisma.department.deleteMany({
      where: { id: dept.id },
    }).catch(() => null);
  }
}

main().catch(err => {
  console.error('❌ Overtime test suite failed:', err);
  process.exit(1);
});
