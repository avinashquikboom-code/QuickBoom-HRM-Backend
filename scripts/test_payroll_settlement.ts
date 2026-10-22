import assert from 'assert';
import {
  computeGrossSalary,
  computePayrollSettlement,
  PayrollSettlement,
  normalizeDeduction,
  money,
  reconcileOfficialPayslipDisplay,
} from '../src/utils/salaryGross';

function check(desc: string, cond: boolean) {
  assert.ok(cond, desc);
  console.log(`PASS ${desc}`);
}

function run() {
  const base = computeGrossSalary({
    basicSalary: 7000,
    hra: 2800,
    medicalAllowance: 1250,
    travelAllowance: 1600,
    specialAllowance: 1350,
  });
  check('base gross is 14000 from five components', base === 14000);

  const holiday = 1272.72;
  const halfDay = 636.36;
  const fullDay = 1272.72;

  const none = computePayrollSettlement({
    baseGrossEarnings: base,
    totalDeductions: 0,
  });
  check('no extras: net equals base gross', none.netSalary === 14000);
  check('no extras: take-home equals net', none.totalTakeHomePay === 14000);
  // Type-check this test without --transpile-only: RKD is always numeric.
  const emptyRkdAdjustment: number = none.rkdIncentive;
  check('no RKD returns a required numeric zero', emptyRkdAdjustment === 0);

  const rkdInput = {
    baseGrossEarnings: base,
    totalDeductions: 500,
    reimbursements: 250,
    rkdIncentive: 1500,
    commissionEarned: 200,
  };
  const rkd: PayrollSettlement = computePayrollSettlement(rkdInput);
  check('RKD does not increase salary gross or earnings', rkd.baseGrossEarnings === 14000 && rkd.totalEarnings === 14000);
  check('RKD does not increase net salary', rkd.netSalary === 13500);
  check('RKD is identified within total adjustments', rkd.rkdIncentive === 1500 && rkd.reimbursements === 1750);
  check('take-home adds expenses, RKD and ordinary commission once', rkd.totalTakeHomePay === 15450);
  assert.deepStrictEqual(computePayrollSettlement(rkdInput), rkd, 'Recalculation must not accumulate RKD');
  const rkdDisplay = reconcileOfficialPayslipDisplay({
    basicSalary: base, totalDeductions: 500, reimbursements: 250,
    rkdIncentive: 1500, commissionEarned: 200,
  });
  check('official display preserves salary gross and net', rkdDisplay.displayedGrossEarnings === 14000 && rkdDisplay.netSalary === 13500);
  check('official display agrees on adjustments and take-home', rkdDisplay.settlement.reimbursements === 1750 && rkdDisplay.totalTakeHomePay === 15450);
  check('official earning lines exclude the RKD adjustment', rkdDisplay.lines.every(line => !line.name.includes('RKD')));

  const holidayCase = computePayrollSettlement({
    baseGrossEarnings: base,
    holidayWeeklyOffPay: holiday,
    totalDeductions: halfDay,
  });
  check('holiday additional earnings 1272.72', holidayCase.additionalEarnings === 1272.72);
  check('total earnings 15272.72', holidayCase.totalEarnings === 15272.72);
  check('regression net 14636.36', holidayCase.netSalary === 14636.36);
  check('regression take-home 14636.36', holidayCase.totalTakeHomePay === 14636.36);
  check('holiday not folded into displayed gross', holidayCase.baseGrossEarnings === 14000);

  const weeklyOff = computePayrollSettlement({
    baseGrossEarnings: base,
    holidayWeeklyOffPay: holiday,
    totalDeductions: 0,
  });
  check('weekly-off/holiday only: net 15272.72', weeklyOff.netSalary === 15272.72);

  const full = computePayrollSettlement({
    baseGrossEarnings: base,
    totalDeductions: fullDay,
  });
  check('full-day deduction 1272.72', full.totalDeductions === 1272.72);
  check('full-day net 12727.28', full.netSalary === 12727.28);

  const advance = computePayrollSettlement({
    baseGrossEarnings: base,
    holidayWeeklyOffPay: holiday,
    totalDeductions: halfDay + 2000,
  });
  check('advance + half-day deducted once', advance.netSalary === 12636.36);

  const approvedReimb = computePayrollSettlement({
    baseGrossEarnings: base,
    holidayWeeklyOffPay: holiday,
    totalDeductions: halfDay,
    reimbursements: 500,
  });
  check('approved reimbursement in take-home', approvedReimb.totalTakeHomePay === 15136.36);
  check('net salary excludes reimbursement', approvedReimb.netSalary === 14636.36);

  const pendingIgnored = computePayrollSettlement({
    baseGrossEarnings: base,
    holidayWeeklyOffPay: holiday,
    totalDeductions: halfDay,
    reimbursements: 0,
  });
  check('pending reimbursements are not passed in (0)', pendingIgnored.netSalary === 14636.36);

  const multi = computePayrollSettlement({
    baseGrossEarnings: base,
    holidayWeeklyOffPay: holiday,
    totalDeductions: halfDay + fullDay + 1000,
  });
  check('multiple deductions subtracted once', multi.netSalary === money(15272.72 - halfDay - fullDay - 1000));

  const negativeLegacy = computePayrollSettlement({
    baseGrossEarnings: base,
    totalDeductions: -636.36,
  });
  check('negative legacy deduction is normalized', normalizeDeduction(-636.36) === 636.36);
  check('negative deduction does not increase net', negativeLegacy.netSalary === 13363.64);

  const rounding = computePayrollSettlement({
    baseGrossEarnings: 14000.006,
    holidayWeeklyOffPay: 1272.724,
    totalDeductions: 636.365,
  });
  check('money values round to two decimals', rounding.baseGrossEarnings === 14000.01);
  check('holiday rounds to two decimals', rounding.holidayWeeklyOffPay === 1272.72);
  check('deduction rounds to two decimals', rounding.totalDeductions === 636.37);

  const noHoliday = computePayrollSettlement({
    baseGrossEarnings: 14000,
    holidayWeeklyOffPay: 0,
    totalDeductions: halfDay,
  });
  check('holiday already in gross: net 13363.64', noHoliday.netSalary === 13363.64);

  const official = reconcileOfficialPayslipDisplay({
    basicSalary: 7000,
    hra: 2800,
    medicalAllowance: 1250,
    travelAllowance: 1600,
    specialAllowance: 1350,
    extraHolidayPayout: holiday,
    totalDeductions: halfDay,
  });
  const displayedSum = money(official.lines.reduce((sum, line) => sum + line.amount, 0));
  check('official PDF lists holiday as an additional earning', official.extraPayout === 1272.72);
  check('displayed earning components sum to 15272.72', displayedSum === 15272.72);
  check('reported Gross Earnings equals component sum', official.displayedGrossEarnings === 15272.72);
  check('component sum matches settlement total earnings', official.componentSumMatchesGross === true);
  check('official PDF total deductions 636.36', official.totalDeductions === 636.36);
  check('official PDF net 14636.36', official.netSalary === 14636.36);
  check('official PDF take-home 14636.36', official.totalTakeHomePay === 14636.36);
  check('net reconciles with earnings and deductions', official.netReconciles === true);

  const noExtraDisplay = reconcileOfficialPayslipDisplay({
    basicSalary: 7000,
    hra: 2800,
    medicalAllowance: 1250,
    travelAllowance: 1600,
    specialAllowance: 1350,
    totalDeductions: halfDay,
  });
  check('without holiday, Gross Earnings stays 14000', noExtraDisplay.displayedGrossEarnings === 14000);
  check('without holiday, net is 13363.64', noExtraDisplay.netSalary === 13363.64);
  check('without holiday, lines still sum to reported gross', noExtraDisplay.componentSumMatchesGross === true);

  console.log('payroll settlement regression: all passed');
}

run();
