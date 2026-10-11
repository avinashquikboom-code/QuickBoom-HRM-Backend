import assert from 'assert';
import {
  calculateScheduledWorkingDays,
  classifyPayrollAttendance,
  attendanceSummaryFromClassification,
  attendanceSummaryFromStoredPayslip,
  normalizeDayName,
  AttendanceClassificationInput,
} from '../src/utils/attendanceSummary';
import {
  computeGrossSalary,
  computePayrollSettlement,
  reconcileOfficialPayslipDisplay,
  money,
} from '../src/utils/salaryGross';

function check(desc: string, cond: boolean) {
  assert.ok(cond, desc);
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
  check('October 2026: Total Working Days is 27 before public holidays', oct2026.workingDays === 27);
  check('October 2026: Days reconcile (27 + 4 = 31)', oct2026.workingDays + oct2026.weeklyOffDays === 31);

  // February 2026: 28 calendar days, 4 Sundays (1, 8, 15, 22), 24 working days
  const feb2026 = calculateScheduledWorkingDays(2026, 2, MON_SAT);
  check('February 2026: Total Calendar Days is 28', feb2026.totalCalendarDays === 28);
  check('February 2026: Weekly Off Days is 4', feb2026.weeklyOffDays === 4);
  check('February 2026: Total Working Days is 24', feb2026.workingDays === 24);
  check('February 2026: Days reconcile (24 + 4 = 28)', feb2026.workingDays + feb2026.weeklyOffDays === 28);

  // February 2024: 29 calendar days (leap year), 4 Sundays (4, 11, 18, 25), 25 working days
  const feb2024 = calculateScheduledWorkingDays(2024, 2, MON_SAT);
  check('February 2024 (leap year): Total Calendar Days is 29', feb2024.totalCalendarDays === 29);
  check('February 2024 (leap year): Weekly Off Days is 4', feb2024.weeklyOffDays === 4);
  check('February 2024 (leap year): Total Working Days is 25', feb2024.workingDays === 25);
  check('February 2024: Days reconcile (25 + 4 = 29)', feb2024.workingDays + feb2024.weeklyOffDays === 29);

  // April 2026: 30 calendar days, 4 Sundays (5, 12, 19, 26), 26 working days
  const apr2026 = calculateScheduledWorkingDays(2026, 4, MON_SAT);
  check('April 2026: Total Calendar Days is 30', apr2026.totalCalendarDays === 30);
  check('April 2026: Weekly Off Days is 4', apr2026.weeklyOffDays === 4);
  check('April 2026: Total Working Days is 26', apr2026.workingDays === 26);
  check('April 2026: Days reconcile (26 + 4 = 30)', apr2026.workingDays + apr2026.weeklyOffDays === 30);

  // Multiple weekly offs: 5-day work week (Monday-Friday) in October 2026
  const oct2026MonFri = calculateScheduledWorkingDays(2026, 10, MON_FRI);
  check('October 2026 (Mon-Fri 5-day week): 9 Weekly Offs (5 Saturdays + 4 Sundays)', oct2026MonFri.weeklyOffDays === 9);
  check('October 2026 (Mon-Fri 5-day week): 22 Total Working Days', oct2026MonFri.workingDays === 22);
  check('October 2026 (Mon-Fri): Days reconcile (22 + 9 = 31)', oct2026MonFri.workingDays + oct2026MonFri.weeklyOffDays === 31);

  // Holiday handling: October 2026 with Gandhi Jayanti (Oct 2, Friday)
  const octWithHoliday = calculateScheduledWorkingDays(2026, 10, MON_SAT, ['2026-10-02']);
  check('October 2026 with Oct 2 holiday: 1 Holiday', octWithHoliday.holidayDays === 1);
  check('October 2026 with Oct 2 holiday: 4 Weekly Offs', octWithHoliday.weeklyOffDays === 4);
  check('October 2026 with Oct 2 holiday: 26 Working Days', octWithHoliday.workingDays === 26);
  check('October 2026 with holiday: Days reconcile (26 + 4 + 1 = 31)', octWithHoliday.workingDays + octWithHoliday.weeklyOffDays + octWithHoliday.holidayDays === 31);

  console.log('\n--- REQUIREMENT 2: Mid-Month Joining Attendance & Salary Breakdown ---');

  // Employee joined October 15, 2026
  const octJoinClassification = classifyPayrollAttendance({
    year: 2026,
    month: 10,
    workingDayNames: MON_SAT,
    holidayYmds: [],
    records: [],
    leaves: [],
    todayYmd: '2026-10-31',
    joiningYmd: '2026-10-15',
  });

  check('Oct 15 joiner: Total Calendar Days is 31', octJoinClassification.totalCalendarDays === 31);
  check('Oct 15 joiner: 12 Working Days Before Joining (Oct 1-14 weekdays)', octJoinClassification.notJoinedDays === 12);
  check('Oct 15 joiner: 2 Sundays before joining', octJoinClassification.notJoinedWeeklyOffDays === 2);
  check('Oct 15 joiner: 15 Scheduled Working Days after joining', octJoinClassification.scheduledWorkingDays === 15);
  check('Oct 15 joiner: 2 Sundays after joining', octJoinClassification.weeklyOffCount === 2);
  check('Oct 15 joiner: Month Working Days is 27 (full month divisor)', octJoinClassification.monthWorkingDays === 27);

  const octSummary = attendanceSummaryFromClassification(octJoinClassification);
  check('Oct 15 joiner summary: Total Working Days is 15', octSummary.totalWorkingDays === 15);
  check('Oct 15 joiner summary: Weekly Off Days is 4 (2 before + 2 after)', octSummary.weeklyOffDays === 4);
  check('Oct 15 joiner summary: Working Days Before Joining is 12', octSummary.notJoinedDays === 12);
  check('Oct 15 joiner summary: Total Calendar Days is 31 (15 + 12 + 4 = 31)',
    octSummary.totalWorkingDays + octSummary.notJoinedDays + octSummary.weeklyOffDays === octSummary.totalCalendarDays);

  // Daily rate and salary deduction for mid-month joiner:
  // Base Gross: 27,000 for 27 working days -> Daily Salary = 1,000/day
  const monthlySalary = 27000;
  const fullWorkingDays = octJoinClassification.monthWorkingDays; // 27
  const dailyRate = Math.round((monthlySalary / fullWorkingDays) * 100) / 100;
  check('Mid-month joiner: Daily rate is 1,000.00 (27000 / 27)', dailyRate === 1000);

  const preJoinDeduction = octJoinClassification.notJoinedElapsedDays * dailyRate; // 12 * 1000 = 12000
  check('Mid-month joiner: Pre-joining deduction is 12,000.00', preJoinDeduction === 12000);

  const joinerSettlement = computePayrollSettlement({
    baseGrossEarnings: monthlySalary,
    totalDeductions: preJoinDeduction,
  });
  check('Mid-month joiner: Gross Earnings is 27,000.00', joinerSettlement.totalEarnings === 27000);
  check('Mid-month joiner: Total Deductions is 12,000.00', joinerSettlement.totalDeductions === 12000);
  check('Mid-month joiner: Net Salary is 15,000.00 (for 15 days worked)', joinerSettlement.netSalary === 15000);
  check('Mid-month joiner: Take-Home is 15,000.00', joinerSettlement.totalTakeHomePay === 15000);

  console.log('\n--- REQUIREMENT 3: 12 Attendance Fields in Exact Order ---');

  const expectedLabels = [
    'Total Calendar Days',
    'Total Working Days',
    'Present Days',
    'Absent Days',
    'Half Days',
    'Paid Leave Days',
    'Unpaid Leave Days',
    'Weekly Off Days',
    'Holidays',
    'Overtime Hours',
    'Working Days Before Joining',
    'Remaining Working Days',
  ];

  check('Summary rows count is exactly 12', octSummary.rows.length === 12);
  for (let i = 0; i < expectedLabels.length; i++) {
    check(`Row ${i + 1} matches "${expectedLabels[i]}"`, octSummary.rows[i].label === expectedLabels[i]);
  }

  console.log('\n--- REQUIREMENT 4: Financial Formulas & Reconciliations ---');

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
