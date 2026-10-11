import {
  calculateScheduledWorkingDays,
  classifyPayrollAttendance,
  attendanceSummaryFromClassification,
  attendanceSummaryFromStoredPayslip,
  normalizeDayName,
  AttendanceClassificationInput,
  ApprovedLeaveSpan,
  AttendanceDayRecord,
} from '../src/utils/attendanceSummary';
import {
  computeGrossSalary,
  computePayrollSettlement,
  reconcileOfficialPayslipDisplay,
  money,
} from '../src/utils/salaryGross';

function check(desc: string, cond: boolean) {
  if (!cond) {
    throw new Error(`Assertion failed: ${desc}`);
  }
  console.log(`PASS ${desc}`);
}

const MON_SAT = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON_FRI = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

function run() {
  console.log('--- REQUIREMENT 1: Dynamic Calendar & Weekly Off Calculations ---');

  // October 2026: 31 calendar days, 4 Sundays (4, 11, 18, 25), 27 working days
  const oct2026 = calculateScheduledWorkingDays(2026, 10, MON_SAT);
  check('October 2026: Total Calendar Days is 31', oct2026.totalCalendarDays === 31);
  check('October 2026: Weekly Off Days is 4 (Sundays: 4, 11, 18, 25)', oct2026.weeklyOffDays === 4);
  check('October 2026: Total Scheduled Working Days is 27 before public holidays', oct2026.workingDays === 27);
  check('October 2026: Days reconcile (27 + 4 = 31)', oct2026.workingDays + oct2026.weeklyOffDays === 31);

  // February 2026: 28 calendar days, 4 Sundays (1, 8, 15, 22), 24 working days
  const feb2026 = calculateScheduledWorkingDays(2026, 2, MON_SAT);
  check('February 2026: Total Calendar Days is 28', feb2026.totalCalendarDays === 28);
  check('February 2026: Weekly Off Days is 4', feb2026.weeklyOffDays === 4);
  check('February 2026: Total Scheduled Working Days is 24', feb2026.workingDays === 24);
  check('February 2026: Days reconcile (24 + 4 = 28)', feb2026.workingDays + feb2026.weeklyOffDays === 28);

  // February 2024 (leap year): 29 calendar days, 4 Sundays, 25 working days
  const feb2024 = calculateScheduledWorkingDays(2024, 2, MON_SAT);
  check('February 2024 (leap year): Total Calendar Days is 29', feb2024.totalCalendarDays === 29);
  check('February 2024 (leap year): Weekly Off Days is 4', feb2024.weeklyOffDays === 4);
  check('February 2024 (leap year): Total Scheduled Working Days is 25', feb2024.workingDays === 25);
  check('February 2024: Days reconcile (25 + 4 = 29)', feb2024.workingDays + feb2024.weeklyOffDays === 29);

  // April 2026: 30 calendar days, 4 Sundays, 26 working days
  const apr2026 = calculateScheduledWorkingDays(2026, 4, MON_SAT);
  check('April 2026: Total Calendar Days is 30', apr2026.totalCalendarDays === 30);
  check('April 2026: Weekly Off Days is 4', apr2026.weeklyOffDays === 4);
  check('April 2026: Total Scheduled Working Days is 26', apr2026.workingDays === 26);
  check('April 2026: Days reconcile (26 + 4 = 30)', apr2026.workingDays + apr2026.weeklyOffDays === 30);

  // October 2026 with 5-day week (Mon-Fri)
  const oct2026MonFri = calculateScheduledWorkingDays(2026, 10, MON_FRI);
  check('October 2026 (Mon-Fri 5-day week): 9 Weekly Offs (5 Saturdays + 4 Sundays)', oct2026MonFri.weeklyOffDays === 9);
  check('October 2026 (Mon-Fri 5-day week): 22 Total Scheduled Working Days', oct2026MonFri.workingDays === 22);
  check('October 2026 (Mon-Fri): Days reconcile (22 + 9 = 31)', oct2026MonFri.workingDays + oct2026MonFri.weeklyOffDays === 31);

  // October 2026 with Gandhi Jayanti (Oct 2) public holiday
  const octWithHoliday = calculateScheduledWorkingDays(2026, 10, MON_SAT, ['2026-10-02']);
  check('October 2026 with Oct 2 holiday: 1 Holiday', octWithHoliday.holidayDays === 1);
  check('October 2026 with Oct 2 holiday: 4 Weekly Offs', octWithHoliday.weeklyOffDays === 4);
  check('October 2026 with Oct 2 holiday: 26 Working Days', octWithHoliday.workingDays === 26);
  check('October 2026 with holiday: Days reconcile (26 + 4 + 1 = 31)',
    octWithHoliday.workingDays + octWithHoliday.weeklyOffDays + octWithHoliday.holidayDays === 31);

  console.log('\n--- REQUIREMENT 2: October 9, 2026 Joining Date Specification ---');

  // Exact user prompt example: October 2026, employee joined on 9 October 2026
  const oct9JoinClassification = classifyPayrollAttendance({
    year: 2026,
    month: 10,
    workingDayNames: MON_SAT,
    holidayYmds: [],
    records: [],
    leaves: [],
    todayYmd: '2026-10-31',
    joiningYmd: '2026-10-09',
  });

  check('Oct 9 joiner: Total Calendar Days is 31', oct9JoinClassification.totalCalendarDays === 31);
  check('Oct 9 joiner: Weekly Off Days in month is 4 (Sundays: 4, 11, 18, 25)',
    oct9JoinClassification.weeklyOffCount + oct9JoinClassification.notJoinedWeeklyOffDays === 4);
  check('Oct 9 joiner: 1 Sunday before joining (Oct 4)', oct9JoinClassification.notJoinedWeeklyOffDays === 1);
  check('Oct 9 joiner: 3 Sundays after joining (Oct 11, 18, 25)', oct9JoinClassification.weeklyOffCount === 3);
  check('Oct 9 joiner: Working Days Before Joining is 7 (Oct 1-8 weekdays)', oct9JoinClassification.notJoinedDays === 7);
  check('Oct 9 joiner: Eligible Working Days is 20 (Oct 9-31 weekdays)', oct9JoinClassification.scheduledWorkingDays === 20);
  check('Oct 9 joiner: Total Scheduled Working Days is 27 (full month divisor)', oct9JoinClassification.monthWorkingDays === 27);
  check('Oct 9 joiner: 7 + 20 + 4 = 31 total calendar days reconcile',
    oct9JoinClassification.notJoinedDays + oct9JoinClassification.scheduledWorkingDays + (oct9JoinClassification.weeklyOffCount + oct9JoinClassification.notJoinedWeeklyOffDays) === 31);

  const oct9Summary = attendanceSummaryFromClassification(oct9JoinClassification);
  check('Oct 9 joiner summary: totalScheduledWorkingDays is 27', oct9Summary.totalScheduledWorkingDays === 27);
  check('Oct 9 joiner summary: eligibleWorkingDays is 20', oct9Summary.eligibleWorkingDays === 20);
  check('Oct 9 joiner summary: workingDaysBeforeJoining is 7', oct9Summary.workingDaysBeforeJoining === 7);
  check('Oct 9 joiner summary: weeklyOffDays is 4', oct9Summary.weeklyOffDays === 4);
  check('Oct 9 joiner summary: totalCalendarDays is 31', oct9Summary.totalCalendarDays === 31);

  // Daily rate and salary deduction for Oct 9 joiner:
  // Base Gross: 27,000 for 27 working days -> Daily Salary = 1,000/day
  const oct9MonthlySalary = 27000;
  const oct9Divisor = oct9JoinClassification.monthWorkingDays; // 27
  const oct9DailyRate = Math.round((oct9MonthlySalary / oct9Divisor) * 100) / 100;
  check('Oct 9 joiner: Daily rate is 1,000.00 (27000 / 27)', oct9DailyRate === 1000);

  const oct9PreJoinDeduction = oct9JoinClassification.notJoinedElapsedDays * oct9DailyRate; // 7 * 1000 = 7000
  check('Oct 9 joiner: Pre-joining deduction is 7,000.00 (for 7 un-worked pre-join days)', oct9PreJoinDeduction === 7000);

  const oct9Settlement = computePayrollSettlement({
    baseGrossEarnings: oct9MonthlySalary,
    totalDeductions: oct9PreJoinDeduction,
  });
  check('Oct 9 joiner: Gross Earnings is 27,000.00', oct9Settlement.totalEarnings === 27000);
  check('Oct 9 joiner: Total Deductions is 7,000.00', oct9Settlement.totalDeductions === 7000);
  check('Oct 9 joiner: Net Salary is 20,000.00 (for 20 eligible days worked)', oct9Settlement.netSalary === 20000);
  check('Oct 9 joiner: Take-Home is 20,000.00', oct9Settlement.totalTakeHomePay === 20000);

  console.log('\n--- REQUIREMENT 3: All 13 Attendance Summary Fields in Exact Order ---');

  const expectedLabels = [
    'Total Calendar Days',
    'Total Scheduled Working Days',
    'Weekly Off Days',
    'Holidays',
    'Working Days Before Joining',
    'Eligible Working Days After Joining',
    'Present Days',
    'Absent Days',
    'Half Days',
    'Paid Leave Days',
    'Unpaid Leave Days',
    'Remaining Working Days',
    'Overtime Hours',
  ];

  check('Summary rows count is exactly 13', oct9Summary.rows.length === 13);
  for (let i = 0; i < expectedLabels.length; i++) {
    check(`Row ${i + 1} matches "${expectedLabels[i]}"`, oct9Summary.rows[i].label === expectedLabels[i]);
  }

  console.log('\n--- REQUIREMENT 4: Section 7 Specific Test Scenarios ---');

  const BASE_GROSS = 27000;
  const WORKING_DIVISOR = 27;
  const DAILY_RATE = BASE_GROSS / WORKING_DIVISOR; // 1000

  // 1. Present day with a valid punch-in
  {
    const records: AttendanceDayRecord[] = [
      { date: '2026-10-01', status: 'PRESENT', checkIn: '2026-10-01T09:00:00Z', checkOut: '2026-10-01T18:00:00Z' },
    ];
    const c = classifyPayrollAttendance({
      year: 2026,
      month: 10,
      workingDayNames: MON_SAT,
      holidayYmds: [],
      records,
      leaves: [],
      todayYmd: '2026-10-01',
    });
    check('Case 1 (Present punch): 1 Present day', c.presentDays === 1);
    check('Case 1 (Present punch): 0 Absent days', c.absentDays === 0);
    const deductions = c.absentDays * DAILY_RATE;
    const net = BASE_GROSS - deductions;
    check('Case 1: No absence deduction applied for present day', deductions === 0 && net === 27000);
  }

  // 2. Missing punch-in on a scheduled working day
  {
    const c = classifyPayrollAttendance({
      year: 2026,
      month: 10,
      workingDayNames: MON_SAT,
      holidayYmds: [],
      records: [],
      leaves: [],
      todayYmd: '2026-10-01', // Oct 1 has elapsed with no punch-in
    });
    check('Case 2 (Missing punch): 1 Absent day for elapsed working day', c.absentDays === 1);
    check('Case 2 (Missing punch): 26 Remaining working days', c.remainingWorkingDays === 26);
    const deductions = c.absentDays * DAILY_RATE;
    const net = BASE_GROSS - deductions;
    check('Case 2: Full-day absence deduction applied (1000)', deductions === 1000 && net === 26000);
  }

  // 3. Sunday without punch-in: NEVER marked Absent
  {
    const c = classifyPayrollAttendance({
      year: 2026,
      month: 10,
      workingDayNames: MON_SAT,
      holidayYmds: [],
      records: [],
      leaves: [],
      todayYmd: '2026-10-04', // Sunday Oct 4
    });
    // On Oct 4: Oct 1,2,3 are elapsed working days (3 absent), 4 Sundays in month are weeklyOffCount (4)
    check('Case 3 (Sunday without punch): All 4 Sundays in month counted in weeklyOffCount', c.weeklyOffCount === 4);
    check('Case 3 (Sunday without punch): Sundays are NOT marked Absent (only 3 elapsed working days absent)', c.absentDays === 3);
  }

  // 4. Configured holiday without punch-in: NEVER marked Absent
  {
    const c = classifyPayrollAttendance({
      year: 2026,
      month: 10,
      workingDayNames: MON_SAT,
      holidayYmds: ['2026-10-02'],
      records: [],
      leaves: [],
      todayYmd: '2026-10-02',
    });
    check('Case 4 (Holiday without punch): Oct 2 counted as holidayCount', c.holidayCount === 1);
    check('Case 4 (Holiday without punch): Oct 2 is NOT marked Absent', c.absentDays === 1); // Only Oct 1 absent
  }

  // 5. Half-day attendance: 0.5x deduction
  {
    const records: AttendanceDayRecord[] = [
      { date: '2026-10-01', status: 'HALF_DAY', checkIn: '2026-10-01T09:00:00Z', checkOut: '2026-10-01T13:30:00Z' },
    ];
    const c = classifyPayrollAttendance({
      year: 2026,
      month: 10,
      workingDayNames: MON_SAT,
      holidayYmds: [],
      records,
      leaves: [],
      todayYmd: '2026-10-01',
    });
    check('Case 5 (Half day): 1 Half day', c.halfDays === 1);
    check('Case 5 (Half day): 0 Absent days', c.absentDays === 0);
    const halfDayDeduction = c.halfDays * 0.5 * DAILY_RATE; // 500
    check('Case 5 (Half day): Half-day deduction is 500.00', halfDayDeduction === 500);
    const net = BASE_GROSS - halfDayDeduction;
    check('Case 5 (Half day): Net is 26,500.00', net === 26500);
  }

  // 6. Approved paid leave: No deduction
  {
    const leaves: ApprovedLeaveSpan[] = [
      { fromYmd: '2026-10-01', toYmd: '2026-10-01', type: 'CASUAL', status: 'APPROVED' },
    ];
    const c = classifyPayrollAttendance({
      year: 2026,
      month: 10,
      workingDayNames: MON_SAT,
      holidayYmds: [],
      records: [],
      leaves,
      todayYmd: '2026-10-01',
    });
    check('Case 6 (Approved Paid Leave): 1 Paid Leave day', c.paidLeaveDays === 1);
    check('Case 6 (Approved Paid Leave): 0 Absent days', c.absentDays === 0);
    const net = BASE_GROSS - (c.absentDays * DAILY_RATE);
    check('Case 6 (Approved Paid Leave): Net is 27,000.00 without deduction', net === 27000);
  }

  // 7. Approved unpaid leave: 1.0x deduction
  {
    const leaves: ApprovedLeaveSpan[] = [
      { fromYmd: '2026-10-01', toYmd: '2026-10-01', type: 'UNPAID', status: 'APPROVED' },
    ];
    const c = classifyPayrollAttendance({
      year: 2026,
      month: 10,
      workingDayNames: MON_SAT,
      holidayYmds: [],
      records: [],
      leaves,
      todayYmd: '2026-10-01',
    });
    check('Case 7 (Approved Unpaid Leave): 1 Unpaid Leave day', c.unpaidLeaveDays === 1);
    check('Case 7 (Approved Unpaid Leave): 0 Absent days', c.absentDays === 0);
    const unpaidDeduction = c.unpaidLeaveDays * DAILY_RATE;
    check('Case 7 (Approved Unpaid Leave): Deduction is 1,000.00', unpaidDeduction === 1000);
    check('Case 7 (Approved Unpaid Leave): Net is 26,000.00', BASE_GROSS - unpaidDeduction === 26000);
  }

  // 8. Rejected or pending leave: Treated as Absent, NOT as approved leave
  {
    const leaves: ApprovedLeaveSpan[] = [
      { fromYmd: '2026-10-01', toYmd: '2026-10-01', type: 'CASUAL', status: 'REJECTED' },
      { fromYmd: '2026-10-02', toYmd: '2026-10-02', type: 'SICK', status: 'PENDING' },
    ];
    const c = classifyPayrollAttendance({
      year: 2026,
      month: 10,
      workingDayNames: MON_SAT,
      holidayYmds: [],
      records: [],
      leaves,
      todayYmd: '2026-10-02',
    });
    check('Case 8 (Rejected/Pending Leave): 0 Paid Leave days', c.paidLeaveDays === 0);
    check('Case 8 (Rejected/Pending Leave): 0 Unpaid Leave days', c.unpaidLeaveDays === 0);
    check('Case 8 (Rejected/Pending Leave): 2 Absent days for unapproved requests', c.absentDays === 2);
    const absentDeduction = c.absentDays * DAILY_RATE;
    check('Case 8: Absence deduction applied for rejected/pending leave (2000)', absentDeduction === 2000);
    check('Case 8: Net is 25,000.00', BASE_GROSS - absentDeduction === 25000);
  }

  // 9. Work performed on a weekly off: 1.0x payout
  {
    const records: AttendanceDayRecord[] = [
      { date: '2026-10-04', status: 'WEEKLY_OFF_WORKED', checkIn: '2026-10-04T09:00:00Z', checkOut: '2026-10-04T18:00:00Z' },
    ];
    const c = classifyPayrollAttendance({
      year: 2026,
      month: 10,
      workingDayNames: MON_SAT,
      holidayYmds: [],
      records,
      leaves: [],
      todayYmd: '2026-10-04',
    });
    check('Case 9 (Weekly off worked): 1 Weekly Off Worked day', c.weeklyOffWorkedCount === 1);
    const extraWeeklyOffPayout = c.weeklyOffWorkedCount * DAILY_RATE * 1.0; // 1000
    check('Case 9: Extra weekly-off payout is 1,000.00', extraWeeklyOffPayout === 1000);
    const settlement = computePayrollSettlement({
      baseGrossEarnings: BASE_GROSS,
      holidayWeeklyOffPay: extraWeeklyOffPayout,
      totalDeductions: 3 * DAILY_RATE, // Oct 1,2,3 absent
    });
    check('Case 9: Net Salary reflects weekly-off payout correctly', settlement.netSalary === 25000);
  }

  // 10. Deduplication prevents multiple records from inflating attendance
  {
    const duplicateRecords: AttendanceDayRecord[] = [
      { date: '2026-10-01', status: 'ABSENT', createdAt: '2026-10-01T08:00:00Z' },
      { date: '2026-10-01', status: 'PRESENT', checkIn: '2026-10-01T09:00:00Z', checkOut: '2026-10-01T18:00:00Z', createdAt: '2026-10-01T09:00:00Z' },
      { date: '2026-10-01', status: 'PRESENT', checkIn: '2026-10-01T09:00:00Z', createdAt: '2026-10-01T09:30:00Z' },
    ];
    const c = classifyPayrollAttendance({
      year: 2026,
      month: 10,
      workingDayNames: MON_SAT,
      holidayYmds: [],
      records: duplicateRecords,
      leaves: [],
      todayYmd: '2026-10-01',
    });
    check('Case 10 (Deduplication): Only 1 Present day counted (not 2 or 3)', c.presentDays === 1);
    check('Case 10 (Deduplication): 0 Absent days counted for that date', c.absentDays === 0);
  }

  console.log('\n--- REQUIREMENT 5: Financial Formulas & Reconciliations ---');

  // Multi-component salary: Basic (10000) + HRA (4000) + Medical (1500) + Travel (2000) + Special (2500) + Bonus (1000) + Incentive (1000) = 22000
  const grossFromComponents = computeGrossSalary({
    basicSalary: 10000,
    hra: 4000,
    medicalAllowance: 1500,
    travelAllowance: 2000,
    specialAllowance: 2500,
    bonus: 1000,
    incentive: 1000,
  });
  check('Gross Earnings is 22,000.00 from 7 distinct components', grossFromComponents === 22000);

  const fullSettlement = computePayrollSettlement({
    baseGrossEarnings: grossFromComponents,
    totalDeductions: 2500, // PF + Tax + Absences
    reimbursements: 850,
    commissionEarned: 1200,
  });

  check('Gross Earnings = 22,000.00', fullSettlement.totalEarnings === 22000);
  check('Total Deductions = 2,500.00', fullSettlement.totalDeductions === 2500);
  check('Net Salary = Gross - Deductions = 19,500.00', fullSettlement.netSalary === 19500);
  check('Total Take-Home Pay = Net + Reimbursement + Commission = 21,550.00', fullSettlement.totalTakeHomePay === 21550);
  check('Reimbursement is separate from Gross Earnings', fullSettlement.reimbursements === 850);
  check('Commission is separate from Gross Earnings', fullSettlement.commissionEarned === 1200);

  const officialDisplay = reconcileOfficialPayslipDisplay({
    basicSalary: 10000,
    hra: 4000,
    medicalAllowance: 1500,
    travelAllowance: 2000,
    specialAllowance: 2500,
    bonus: 1000,
    incentive: 1000,
    totalDeductions: 2500,
    reimbursements: 850,
    commissionEarned: 1200,
  });
  check('Official display component sum matches Gross Earnings', officialDisplay.componentSumMatchesGross === true);
  check('Official display Net reconciles with Gross - Deductions', officialDisplay.netReconciles === true);
  check('Official display Take-Home equals 21,550.00', officialDisplay.totalTakeHomePay === 21550);

  console.log('\n========================================');
  console.log('ALL PAYROLL AUDIT REQUIREMENTS VERIFIED!');
  console.log('========================================');
}

run();
