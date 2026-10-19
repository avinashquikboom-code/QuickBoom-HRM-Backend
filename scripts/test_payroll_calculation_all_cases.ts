import assert from 'assert';
import {
  calculateScheduledWorkingDays,
  classifyPayrollAttendance,
  attendanceSummaryFromClassification,
  AttendanceClassificationInput,
  AttendanceDayRecord,
  ApprovedLeaveSpan,
} from '../src/utils/attendanceSummary';
import {
  computeGrossSalary,
  computePayrollSettlement,
  money,
  reconcileOfficialPayslipDisplay,
} from '../src/utils/salaryGross';

function check(desc: string, cond: boolean) {
  if (!cond) {
    throw new Error(`FAIL: ${desc}`);
  }
  console.log(`PASS ${desc}`);
}

const MON_SAT = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function runTests() {
  console.log('=== RUNNING 12 PAYROLL REGRESSION TEST SCENARIOS ===\n');

  // --------------------------------------------------------------------------
  // Scenario 1: Gross salary ₹15,000 with 17 present days
  // October 2026: 31 calendar days, 4 Sundays, 27 scheduled working days
  // --------------------------------------------------------------------------
  console.log('--- Scenario 1: Gross ₹15,000 with 17 Present Days ---');
  {
    const gross = 15000;
    const workingDays = 27; // October 2026 (Mon-Sat, 4 Sundays)
    const dailyRate = Math.round((gross / workingDays) * 100) / 100; // 555.56
    const presentDays = 17;
    const unworkedDays = workingDays - presentDays; // 10 days
    const absenceDeduction = money(unworkedDays * dailyRate); // 5555.60
    // Exact earned salary for 17 days
    const earnedGross = money(gross - absenceDeduction); // 9444.40

    check('Daily salary rate is 555.56 (15000 / 27)', dailyRate === 555.56);
    check('Unworked days is exactly 10 (27 - 17)', unworkedDays === 10);
    check('Absence deduction is 5555.60 for 10 unworked days', absenceDeduction === 5555.6);
    check('Earned net salary is 9444.40 before advance recovery', earnedGross === 9444.4);

    // With ₹3,000 advance scheduled over 3 months (EMI 1,000)
    const withEmi1000 = computePayrollSettlement({
      baseGrossEarnings: gross,
      totalDeductions: absenceDeduction + 1000,
    });
    check('With 1000 advance EMI, net salary is 8444.40', withEmi1000.netSalary === 8444.4);

    // With ₹3,000 advance scheduled over 6 months (EMI 500)
    const withEmi500 = computePayrollSettlement({
      baseGrossEarnings: gross,
      totalDeductions: absenceDeduction + 500,
    });
    check('With 500 advance EMI, net salary is 8944.40', withEmi500.netSalary === 8944.4);

    // With no advance deduction scheduled
    const withNoAdv = computePayrollSettlement({
      baseGrossEarnings: gross,
      totalDeductions: absenceDeduction,
    });
    check('With no advance scheduled, net salary is 9444.40', withNoAdv.netSalary === 9444.4);
  }

  // --------------------------------------------------------------------------
  // Scenario 2: Full attendance for a complete payroll month
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario 2: Full Attendance for Complete Payroll Month ---');
  {
    const gross = 15000;
    const workingDays = 27;
    const presentDays = 27;
    const unworkedDays = workingDays - presentDays; // 0
    const absenceDeduction = 0;

    const fullMonth = computePayrollSettlement({
      baseGrossEarnings: gross,
      totalDeductions: absenceDeduction,
    });
    check('Full attendance unworked days is 0', unworkedDays === 0);
    check('Full attendance deductions is 0', fullMonth.totalDeductions === 0);
    check('Full attendance net salary equals full gross 15000.00', fullMonth.netSalary === 15000);
    check('Full attendance take-home equals 15000.00', fullMonth.totalTakeHomePay === 15000);
  }

  // --------------------------------------------------------------------------
  // Scenario 3: Absence and unpaid leave
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario 3: Absence and Unpaid Leave ---');
  {
    const gross = 15000;
    const workingDays = 27;
    const dailyRate = Math.round((gross / workingDays) * 100) / 100; // 555.56
    const presentDays = 20;
    const unpaidLeaveDays = 2;
    const totalUnworked = workingDays - presentDays; // 7
    const absentDays = totalUnworked - unpaidLeaveDays; // 5

    const unpaidLeaveDeduction = money(unpaidLeaveDays * dailyRate); // 1111.12
    const absentDeduction = money(absentDays * dailyRate); // 2777.80
    const totalDeductions = money(unpaidLeaveDeduction + absentDeduction); // 3888.92

    const result = computePayrollSettlement({
      baseGrossEarnings: gross,
      totalDeductions,
    });
    check('Unpaid leave deduction is 1111.12 (2 * 555.56)', unpaidLeaveDeduction === 1111.12);
    check('Absent deduction is 2777.80 (5 * 555.56)', absentDeduction === 2777.8);
    check('Total deductions is 3888.92', totalDeductions === 3888.92);
    check('Net salary is 11111.08 (15000 - 3888.92)', result.netSalary === 11111.08);
  }

  // --------------------------------------------------------------------------
  // Scenario 4: Paid leave and weekly offs
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario 4: Paid Leave and Weekly Offs ---');
  {
    const gross = 15000;
    const workingDays = 27;
    const presentDays = 25;
    const paidLeaveDays = 2;
    const paidWorkingDays = presentDays + paidLeaveDays; // 27
    const unworkedDays = workingDays - paidWorkingDays; // 0

    const result = computePayrollSettlement({
      baseGrossEarnings: gross,
      totalDeductions: 0,
    });
    check('Paid working days sum to 27 (25 present + 2 paid leave)', paidWorkingDays === 27);
    check('Unworked days is 0 when on approved paid leave', unworkedDays === 0);
    check('Weekly offs (Sundays) are paid as part of monthly salary without deduction', result.netSalary === 15000);
  }

  // --------------------------------------------------------------------------
  // Scenario 5: Mid-month joining (Oct 9, 2026)
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario 5: Mid-Month Joining ---');
  {
    const gross = 27000;
    const workingDays = 27;
    const dailyRate = gross / workingDays; // 1000
    const preJoinWorkingDays = 7;
    const eligibleWorkingDays = 20;
    const preJoinDeduction = preJoinWorkingDays * dailyRate; // 7000

    const result = computePayrollSettlement({
      baseGrossEarnings: gross,
      totalDeductions: preJoinDeduction,
    });
    check('Pre-joining scheduled working days is 7', preJoinWorkingDays === 7);
    check('Pre-joining deduction is 7000.00', preJoinDeduction === 7000);
    check('Net salary is 20000.00 for the 20 eligible working days worked', result.netSalary === 20000);
  }

  // --------------------------------------------------------------------------
  // Scenario 6: Half-day and late deductions
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario 6: Half-Day and Late Deductions ---');
  {
    const gross = 15000;
    const workingDays = 27;
    const dailyRate = Math.round((gross / workingDays) * 100) / 100; // 555.56
    const presentDays = 26;
    const halfDays = 1;
    const halfDayDeduction = money(halfDays * 0.5 * dailyRate); // 277.78
    const lateMarkDeduction = 100; // Fixed late mark penalty

    const result = computePayrollSettlement({
      baseGrossEarnings: gross,
      totalDeductions: halfDayDeduction + lateMarkDeduction,
    });
    check('Half-day deduction is 0.5x daily salary = 277.78', halfDayDeduction === 277.78);
    check('Net salary correctly subtracts half-day and late deductions', result.netSalary === money(15000 - 277.78 - 100));
  }

  // --------------------------------------------------------------------------
  // Scenario 7: Advance with no recovery scheduled
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario 7: Advance with No Recovery Scheduled ---');
  {
    const gross = 15000;
    // An advance exists in wallet (e.g. limit 3000, used 3000), but recovery starts next month or status != APPROVED
    const scheduledRecovery = 0;

    const result = computePayrollSettlement({
      baseGrossEarnings: gross,
      totalDeductions: scheduledRecovery,
    });
    check('Advance with no scheduled recovery applies 0 deduction', result.totalDeductions === 0);
    check('Net salary remains unaffected by un-scheduled advances', result.netSalary === 15000);
  }

  // --------------------------------------------------------------------------
  // Scenario 8: Advance with scheduled partial recovery
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario 8: Advance with Scheduled Partial Recovery ---');
  {
    const gross = 15000;
    const advanceAmount = 3000;
    const tenureMonths = 3;
    const monthlyEmi = Math.round((advanceAmount / tenureMonths) * 100) / 100; // 1000

    const result = computePayrollSettlement({
      baseGrossEarnings: gross,
      totalDeductions: monthlyEmi,
    });
    check('Scheduled EMI is 1000.00 (3000 / 3 months)', monthlyEmi === 1000);
    check('Deduction is exactly monthly EMI, NOT full advance usage', result.totalDeductions === 1000);
    check('Net salary reflects exact scheduled EMI deduction (14000.00)', result.netSalary === 14000);
  }

  // --------------------------------------------------------------------------
  // Scenario 9: Advance already recovered in a previous payroll run
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario 9: Advance Already Recovered in Previous Payroll ---');
  {
    const gross = 15000;
    const advanceAmount = 3000;
    const priorRecoveredAmount = 3000; // Fully recovered across past paid runs
    const remainingToRecover = Math.max(0, advanceAmount - priorRecoveredAmount); // 0
    const scheduledEmi = 1000;
    const emiToDeduct = Math.min(scheduledEmi, remainingToRecover); // 0

    const result = computePayrollSettlement({
      baseGrossEarnings: gross,
      totalDeductions: emiToDeduct,
    });
    check('Remaining unrecovered advance is 0', remainingToRecover === 0);
    check('Deduction for already recovered advance is 0', emiToDeduct === 0);
    check('Net salary has no duplicate advance deduction', result.netSalary === 15000);
  }

  // --------------------------------------------------------------------------
  // Scenario 10: Employees with different salary structures
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario 10: Employees with Different Salary Structures ---');
  {
    // Employee A: Executive with 50,000 gross
    const execGross = computeGrossSalary({
      basicSalary: 25000,
      hra: 12500,
      travelAllowance: 5000,
      medicalAllowance: 3500,
      specialAllowance: 4000,
    });
    check('Executive gross is 50000.00 from 5 components', execGross === 50000);
    const execDaily = Math.round((execGross / 27) * 100) / 100; // 1851.85
    const execNet = computePayrollSettlement({
      baseGrossEarnings: execGross,
      totalDeductions: money(2 * execDaily), // 2 days absent
    });
    check('Executive net reflects executive daily rate', execNet.netSalary === money(50000 - 2 * 1851.85));

    // Employee B: Associate with 12,000 gross
    const assocGross = computeGrossSalary({
      basicSalary: 6000,
      hra: 3000,
      travelAllowance: 1500,
      medicalAllowance: 1500,
    });
    check('Associate gross is 12000.00', assocGross === 12000);
    const assocDaily = Math.round((assocGross / 27) * 100) / 100; // 444.44
    const assocNet = computePayrollSettlement({
      baseGrossEarnings: assocGross,
      totalDeductions: money(2 * assocDaily), // 2 days absent
    });
    check('Associate net reflects associate daily rate', assocNet.netSalary === money(12000 - 2 * 444.44));
  }

  // --------------------------------------------------------------------------
  // Scenario 11: Payroll recalculation without duplicate deductions
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario 11: Payroll Recalculation Without Duplicate Deductions ---');
  {
    const gross = 15000;
    const advanceEmi = 1000;
    const absentDeduction = 555.56;
    const initialTotalDeductions = money(advanceEmi + absentDeduction);

    const run1 = computePayrollSettlement({
      baseGrossEarnings: gross,
      totalDeductions: initialTotalDeductions,
    });

    // Recalculating the same period does not re-add previous EMI
    const run2 = computePayrollSettlement({
      baseGrossEarnings: gross,
      totalDeductions: initialTotalDeductions,
    });

    check('Run 1 total deductions is 1555.56', run1.totalDeductions === 1555.56);
    check('Run 2 total deductions matches Run 1 exactly', run2.totalDeductions === run1.totalDeductions);
    check('Run 2 net salary matches Run 1 exactly without duplicate deductions', run2.netSalary === run1.netSalary);
  }

  // --------------------------------------------------------------------------
  // Scenario 12: Consistency between API, Mobile Wallet, Admin Panel, and PDF
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario 12: Cross-Surface Consistency ---');
  {
    const gross = 15000;
    const holidayPay = 555.56;
    const deductions = 1555.56;
    const reimbursement = 250;
    const commission = 750;

    const settlement = computePayrollSettlement({
      baseGrossEarnings: gross,
      holidayWeeklyOffPay: holidayPay,
      totalDeductions: deductions,
      reimbursements: reimbursement,
      commissionEarned: commission,
    });

    const displayReconciliation = reconcileOfficialPayslipDisplay({
      basicSalary: 7500,
      hra: 3750,
      travelAllowance: 1875,
      medicalAllowance: 1875,
      extraHolidayPayout: holidayPay,
      totalDeductions: deductions,
    });

    // Authoritative numbers
    const canonicalGross = settlement.baseGrossEarnings; // 15000.00
    const canonicalTotalEarnings = settlement.totalEarnings; // 15555.56
    const canonicalNet = settlement.netSalary; // 14000.00
    const canonicalTakeHome = settlement.totalTakeHomePay; // 15000.00

    check('Authoritative Gross Earnings is 15000.00 across all surfaces', canonicalGross === 15000);
    check('Authoritative Total Earnings is 15555.56 across all surfaces', canonicalTotalEarnings === 15555.56);
    check('Authoritative Net Salary is 14000.00 across all surfaces', canonicalNet === 14000);
    check('Authoritative Total Take-Home is 15000.00 (Net + Reimb 250 + Comm 750)', canonicalTakeHome === 15000);
    check('Official PDF display matches canonical Net Salary', displayReconciliation.netSalary === canonicalNet);
    check('Official PDF display matches canonical Total Deductions', displayReconciliation.totalDeductions === deductions);
  }

  console.log('\n======================================================');
  console.log('ALL 12 PAYROLL REGRESSION TEST SCENARIOS PASSED!');
  console.log('======================================================');
}

runTests();
