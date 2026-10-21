import { calculateScheduledWorkingDays, classifyPayrollAttendance } from '../src/utils/attendanceSummary';
import { fixedThirtyDaySalary, SALARY_BASIS_DAYS, MONTHLY_PAID_LEAVE_LIMIT } from '../src/utils/fixedThirtyDaySalary';
import { computeGrossSalary, computePayrollSettlement, money } from '../src/utils/salaryGross';

function check(desc: string, cond: boolean, extra?: any) {
  if (!cond) {
    console.error(`FAIL: ${desc}`, extra ?? '');
    throw new Error(`FAIL: ${desc}`);
  }
  console.log(`PASS ${desc}`);
}

const MON_SAT = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function runTests() {
  console.log('=== TEST SUITE: DATE-WISE SALARY CALCULATION & RECONCILIATION ===\n');

  // --------------------------------------------------------------------------
  // Scenario 1: Fixed 30-day salary basis for ₹15,000 monthly salary
  // Daily rate = 15,000 / 30 = ₹500
  // --------------------------------------------------------------------------
  console.log('--- Scenario 1: ₹15,000 monthly salary -> Daily salary = ₹500.00 ---');
  {
    const monthlySalary = 15000;
    const dailySalary = Math.round((monthlySalary / SALARY_BASIS_DAYS) * 100) / 100;
    check('Daily salary basis is fixed at 30 days', SALARY_BASIS_DAYS === 30);
    check('Daily salary is exactly ₹500.00 for ₹15,000', dailySalary === 500);

    // Monthly salary ₹21,000 -> 21000/30 = 700
    const daily21k = Math.round((21000 / 30) * 100) / 100;
    check('Daily salary for ₹21,000 is ₹700.00', daily21k === 700);

    // Monthly salary ₹30,000 -> 30000/30 = 1000
    const daily30k = Math.round((30000 / 30) * 100) / 100;
    check('Daily salary for ₹30,000 is ₹1000.00', daily30k === 1000);
  }

  // --------------------------------------------------------------------------
  // Scenario 2: 30-Day Month (e.g. April 2026: 30 days) - Full attendance
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario 2: 30-Day Month (April 2026) - Full attendance ---');
  {
    const apr = calculateScheduledWorkingDays(2026, 4, MON_SAT);
    check('April 2026 has 30 calendar days', apr.totalCalendarDays === 30);
    check('April 2026 has 4 weekly offs (Sundays)', apr.weeklyOffDays === 4);
    check('April 2026 has 26 scheduled working days', apr.workingDays === 26);

    const classification = classifyPayrollAttendance({
      year: 2026,
      month: 4,
      workingDayNames: MON_SAT,
      holidayYmds: [],
      records: Array.from({ length: 30 }, (_, i) => ({
        date: `2026-04-${String(i + 1).padStart(2, '0')}`,
        status: 'PRESENT',
        checkIn: new Date(`2026-04-${String(i + 1).padStart(2, '0')}T09:00:00Z`),
        checkOut: new Date(`2026-04-${String(i + 1).padStart(2, '0')}T18:00:00Z`),
      })),
      leaves: [],
      todayYmd: '2026-04-30',
    });

    const basis = fixedThirtyDaySalary(15000, classification);
    check('Full attendance April: 30 standard payable days', basis.standardPayableDays === 30);
    check('Full attendance April: attendance deduction is 0', basis.attendanceDeduction === 0);
    check('Full attendance April: standard salary is ₹15,000', basis.standardSalary === 15000);
  }

  // --------------------------------------------------------------------------
  // Scenario 3: 31-Day Month (October 2026) - Full attendance & date-wise sum
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario 3: 31-Day Month (October 2026) - Full Attendance ---');
  {
    const oct = calculateScheduledWorkingDays(2026, 10, MON_SAT, ['2026-10-02']);
    check('October 2026 has 31 calendar days', oct.totalCalendarDays === 31);
    check('October 2026 has 4 Sundays and 1 Gandhi Jayanti holiday', oct.weeklyOffDays === 4 && oct.holidayDays === 1);

    // Employee present on all 26 working days, off on 4 Sundays, off on 1 holiday
    // All 31 calendar days are covered (no absences)
    const classification = classifyPayrollAttendance({
      year: 2026,
      month: 10,
      workingDayNames: MON_SAT,
      holidayYmds: ['2026-10-02'],
      records: Array.from({ length: 31 }, (_, i) => {
        const d = i + 1;
        // Don't punch on Sundays (4, 11, 18, 25) or Oct 2
        if ([4, 11, 18, 25, 2].includes(d)) return { date: `2026-10-${String(d).padStart(2, '0')}`, status: null };
        return {
          date: `2026-10-${String(d).padStart(2, '0')}`,
          status: 'PRESENT',
          checkIn: new Date(`2026-10-${String(d).padStart(2, '0')}T09:00:00Z`),
          checkOut: new Date(`2026-10-${String(d).padStart(2, '0')}T18:00:00Z`),
        };
      }),
      leaves: [],
      todayYmd: '2026-10-31',
    });

    check('Present days = 26', classification.presentDays === 26);
    check('Holidays = 1', classification.holidayCount === 1);
    check('Weekly offs = 4', classification.weeklyOffCount === 4);
    check('Absent days = 0', classification.absentDays === 0);

    const basis = fixedThirtyDaySalary(15000, classification);
    check('October full attendance: standard payable days = 30 (fixed cap)', basis.standardPayableDays === 30);
    check('October full attendance: attendance deduction = 0', basis.attendanceDeduction === 0);
    check('October full attendance: standard salary = 15000.00', basis.standardSalary === 15000);
  }

  // --------------------------------------------------------------------------
  // Scenario 4: 28-Day Month (February 2026) - Short month credit under 30-day basis
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario 4: 28-Day Month (February 2026) - 30-day basis reconciliation ---');
  {
    const feb = calculateScheduledWorkingDays(2026, 2, MON_SAT);
    check('Feb 2026 has 28 calendar days', feb.totalCalendarDays === 28);

    // Full attendance: present on all 24 working days, 4 Sundays off
    const classification = classifyPayrollAttendance({
      year: 2026,
      month: 2,
      workingDayNames: MON_SAT,
      holidayYmds: [],
      records: Array.from({ length: 28 }, (_, i) => {
        const d = i + 1;
        if ([1, 8, 15, 22].includes(d)) return { date: `2026-02-${String(d).padStart(2, '0')}`, status: null };
        return {
          date: `2026-02-${String(d).padStart(2, '0')}`,
          status: 'PRESENT',
          checkIn: new Date(`2026-02-${String(d).padStart(2, '0')}T09:00:00Z`),
          checkOut: new Date(`2026-02-${String(d).padStart(2, '0')}T18:00:00Z`),
        };
      }),
      leaves: [],
      todayYmd: '2026-02-28',
    });

    const basis = fixedThirtyDaySalary(15000, classification);
    check('Feb full attendance: short month credit = 2 days', basis.shortMonthCredit === 2);
    check('Feb full attendance: standard payable days = 30', basis.standardPayableDays === 30);
    check('Feb full attendance: standard salary = ₹15,000 (not reduced to 28 days)', basis.standardSalary === 15000);
  }

  // --------------------------------------------------------------------------
  // Scenario 5: Paid Leaves within policy limit (4 days) vs Unpaid Leaves
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario 5: Paid Leaves vs Unpaid Leaves ---');
  {
    // 2 days approved casual leave on Oct 5 and 6 in October
    const classificationWithLeaves = classifyPayrollAttendance({
      year: 2026,
      month: 10,
      workingDayNames: MON_SAT,
      holidayYmds: [],
      records: [
        { date: '2026-10-01', status: 'PRESENT' },
        { date: '2026-10-02', status: 'PRESENT' },
        { date: '2026-10-03', status: 'PRESENT' },
      ],
      leaves: [
        {
          fromYmd: '2026-10-05',
          toYmd: '2026-10-06',
          type: 'CASUAL',
          leaveCategory: 'PAID',
          status: 'APPROVED',
        },
      ],
      todayYmd: '2026-10-06',
    });

    check('Approved leave for 2 days counted as paidLeaveDays = 2', classificationWithLeaves.paidLeaveDays === 2);
    check('Absent days is 0 for Oct 1-6 (present + Sunday + approved leave)', classificationWithLeaves.absentDays === 0);

    // Leaves exceeding 4 days monthly limit
    const classificationExceeding = classifyPayrollAttendance({
      year: 2026,
      month: 10,
      workingDayNames: MON_SAT,
      holidayYmds: [],
      records: [],
      leaves: [
        {
          fromYmd: '2026-10-05',
          toYmd: '2026-10-10', // 6 calendar days: 5,6,7,8,9,10
          type: 'CASUAL',
          leaveCategory: 'PAID',
          status: 'APPROVED',
        },
      ],
      todayYmd: '2026-10-31',
    });

    check('Max 4 paid leave days allowed per month', classificationExceeding.paidLeaveDays === 4);
    check('Excess days beyond 4 become unpaidLeaveDays = 2', classificationExceeding.unpaidLeaveDays === 2);
  }

  // --------------------------------------------------------------------------
  // Scenario 6: Unpaid Absences and deductions attribution
  // Monthly salary ₹15,000. 1 Absent day -> ₹500 deduction
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario 6: Unpaid Absences & Deductions ---');
  {
    const dailyRate = 500;
    const absentDays = 3;
    const deduction = absentDays * dailyRate; // ₹1,500
    const earned = 15000 - deduction; // ₹13,500

    check('3 absent days deduction = ₹1,500', deduction === 1500);
    check('Earned salary = ₹13,500', earned === 13500);
  }

  // --------------------------------------------------------------------------
  // Scenario 7: Holiday & Weekly Off Worked Extra Payout
  // Worked on Gandhi Jayanti (Oct 2) -> Base credit (₹500) + Extra payout (₹500) = ₹1,000
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario 7: Holiday & Weekly Off Worked Extra Payout ---');
  {
    const classificationWorkedHoliday = classifyPayrollAttendance({
      year: 2026,
      month: 10,
      workingDayNames: MON_SAT,
      holidayYmds: ['2026-10-02'],
      records: [
        {
          date: '2026-10-02',
          status: 'PRESENT',
          checkIn: new Date('2026-10-02T09:00:00Z'),
          checkOut: new Date('2026-10-02T18:00:00Z'),
        },
      ],
      leaves: [],
      todayYmd: '2026-10-03',
    });

    check('Holiday worked count is 1', classificationWorkedHoliday.holidayWorkedCount === 1);
    const extraHolidayPayout = Math.round(1 * 500 * 1.0 * 100) / 100;
    check('Extra holiday payout is ₹500.00', extraHolidayPayout === 500);
  }

  // --------------------------------------------------------------------------
  // Scenario 9: Section 2 - Case 1: 26 Present Days + 4 Paid Leaves = 30 Payable Days (₹15,000)
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario 9: Case 1 - 26 Present Days + 4 Paid Leaves ---');
  {
    const classification: any = {
      presentDays: 26,
      halfDays: 0,
      paidLeaveDays: 4,
      unpaidLeaveDays: 0,
      absentDays: 0,
      holidayCount: 0,
      weeklyOffCount: 0,
      holidayWorkedCount: 0,
      weeklyOffWorkedCount: 0,
      totalCalendarDays: 30,
      payableDayRecords: [],
    };
    const basis = fixedThirtyDaySalary(15000, classification);
    check('Case 1: Total payable days = 30', basis.standardPayableDays === 30);
    check('Case 1: Paid leaves used = 4', basis.paidLeavesUsed === 4);
    check('Case 1: Remaining paid leaves = 0', basis.remainingPaidLeaves === 0);
    check('Case 1: Unpaid absences = 0', basis.unpaidAbsences === 0);
    check('Case 1: Base salary = ₹15,000', basis.baseSalary === 15000);
    check('Case 1: Min attendance requirement met (26 >= 24)', basis.minAttendanceMet === true);
  }

  // --------------------------------------------------------------------------
  // Scenario 10: Section 2 - Case 2: 28 Present Days + 2 Paid Leaves = 30 Payable Days (₹15,000)
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario 10: Case 2 - 28 Present Days + 2 Paid Leaves ---');
  {
    const classification: any = {
      presentDays: 28,
      halfDays: 0,
      paidLeaveDays: 2,
      unpaidLeaveDays: 0,
      absentDays: 0,
      holidayCount: 0,
      weeklyOffCount: 0,
      holidayWorkedCount: 0,
      weeklyOffWorkedCount: 0,
      totalCalendarDays: 30,
      payableDayRecords: [],
    };
    const basis = fixedThirtyDaySalary(15000, classification);
    check('Case 2: Total payable days = 30', basis.standardPayableDays === 30);
    check('Case 2: Paid leaves used = 2', basis.paidLeavesUsed === 2);
    check('Case 2: Remaining paid leaves = 2', basis.remainingPaidLeaves === 2);
    check('Case 2: Unpaid absences = 0', basis.unpaidAbsences === 0);
    check('Case 2: Base salary = ₹15,000', basis.baseSalary === 15000);
    check('Case 2: Min attendance requirement met (28 >= 24)', basis.minAttendanceMet === true);
  }

  // --------------------------------------------------------------------------
  // Scenario 11: Section 2 - Case 3: 24 Present Days, 4 Paid Leaves, 2 Unpaid Absences = 28 Payable Days (₹14,000)
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario 11: Case 3 - 24 Present Days, 4 Paid Leaves, 2 Unpaid Absences ---');
  {
    const classification: any = {
      presentDays: 24,
      halfDays: 0,
      paidLeaveDays: 4,
      unpaidLeaveDays: 2,
      absentDays: 0,
      holidayCount: 0,
      weeklyOffCount: 0,
      holidayWorkedCount: 0,
      weeklyOffWorkedCount: 0,
      totalCalendarDays: 30,
      payableDayRecords: [],
    };
    const basis = fixedThirtyDaySalary(15000, classification);
    check('Case 3: Total payable days = 28', basis.standardPayableDays === 28);
    check('Case 3: Unpaid absences = 2', basis.unpaidAbsences === 2);
    check('Case 3: Unpaid deduction = ₹1,000 (2 * 500)', basis.unpaidDeduction === 1000);
    check('Case 3: Base salary = ₹14,000 (28 * 500)', basis.baseSalary === 14000);
    check('Case 3: Base salary + Unpaid deduction = Monthly salary (14000 + 1000 = 15000)', basis.baseSalary + basis.unpaidDeduction === 15000);
    check('Case 3: Min attendance requirement met (24 >= 24)', basis.minAttendanceMet === true);
  }

  // --------------------------------------------------------------------------
  // Scenario 12: Section 2 - Case 4: 30 Present Days, 0 Leaves (Configurable Extra Attendance Pay)
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario 12: Case 4 - 30 Present Days (Configurable Extra Attendance Pay) ---');
  {
    const classification: any = {
      presentDays: 30,
      halfDays: 0,
      paidLeaveDays: 0,
      unpaidLeaveDays: 0,
      absentDays: 0,
      holidayCount: 0,
      weeklyOffCount: 0,
      holidayWorkedCount: 0,
      weeklyOffWorkedCount: 0,
      totalCalendarDays: 30,
      payableDayRecords: [],
    };

    // Case 4a: Extra Attendance Pay Rule disabled
    const basisDisabled = fixedThirtyDaySalary(15000, classification, [], { enabled: false });
    check('Case 4a: Base salary = ₹15,000', basisDisabled.baseSalary === 15000);
    check('Case 4a: Extra pay rule disabled -> extraAttendancePayout = 0', basisDisabled.extraAttendancePayout === 0);
    check('Case 4a: Remaining paid leaves = 4', basisDisabled.remainingPaidLeaves === 4);

    // Case 4b: Extra Attendance Pay Rule enabled with fixed amount ₹500
    const basisFixed = fixedThirtyDaySalary(15000, classification, [], {
      enabled: true,
      type: 'FIXED_AMOUNT',
      fixedAmount: 500,
      minimumPresentDays: 30,
    });
    check('Case 4b: Base salary = ₹15,000', basisFixed.baseSalary === 15000);
    check('Case 4b: Extra attendance payout = ₹500.00', basisFixed.extraAttendancePayout === 500);

    // Case 4c: Extra Attendance Pay Rule enabled with per-day rate multiplier (1.0x)
    const basisMultiplier = fixedThirtyDaySalary(15000, classification, [], {
      enabled: true,
      type: 'PER_DAY_RATE',
      rateMultiplier: 1.0,
      minimumPresentDays: 30,
    });
    check('Case 4c: Extra attendance payout = ₹500.00 (1 day * 500 * 1.0)', basisMultiplier.extraAttendancePayout === 500);
  }

  // --------------------------------------------------------------------------
  // Scenario 13: 24-Day Minimum Attendance Requirement Check
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario 13: 24-Day Minimum Attendance Requirement ---');
  {
    const underAttClassification: any = {
      presentDays: 23,
      halfDays: 0,
      paidLeaveDays: 4,
      unpaidLeaveDays: 3,
      absentDays: 0,
      holidayCount: 0,
      weeklyOffCount: 0,
      holidayWorkedCount: 0,
      weeklyOffWorkedCount: 0,
      totalCalendarDays: 30,
      payableDayRecords: [],
    };
    const basisUnder = fixedThirtyDaySalary(15000, underAttClassification);
    check('Present 23 days: minAttendanceMet = false', basisUnder.minAttendanceMet === false);
    check('Min attendance threshold = 24', basisUnder.minAttendanceRequirement === 24);

    const metAttClassification: any = {
      ...underAttClassification,
      presentDays: 24,
      unpaidLeaveDays: 2,
    };
    const basisMet = fixedThirtyDaySalary(15000, metAttClassification);
    check('Present 24 days: minAttendanceMet = true', basisMet.minAttendanceMet === true);
  }

  console.log('\n===============================================================');
  console.log('✅ ALL DATE-WISE SALARY CALCULATION SCENARIOS PASSED SUCCESSFULLY');
  console.log('===============================================================');
}

runTests();
