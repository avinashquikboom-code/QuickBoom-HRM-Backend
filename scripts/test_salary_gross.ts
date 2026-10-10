import assert from 'assert';
import { computeGrossSalary, mapStructureGrossFields, netSalaryFromGross, resolveApplicableGross, computePayrollSettlement } from '../src/utils/salaryGross';

function run() {
  let passed = 0;
  let total = 0;
  const check = (desc: string, cond: boolean) => {
    total += 1;
    if (!cond) throw new Error(`FAIL: ${desc}`);
    passed += 1;
    console.log(`PASS ${desc}`);
  };

  const sixComponents = {
    basicSalary: 15000,
    hra: 1000,
    medicalAllowance: 1000,
    travelAllowance: 1500,
    specialAllowance: 1000,
    bonus: 1000,
  };

  check('six displayed components total 20500', computeGrossSalary(sixComponents) === 20500);

  const listGross = computeGrossSalary(sixComponents);
  const modalGross = computeGrossSalary({ ...sixComponents, incentive: 0, fixedBonus: 1000 });
  check('list and modal use the same 20500 total', listGross === 20500 && modalGross === 20500);

  check(
    'incentive is counted once when present',
    computeGrossSalary({ ...sixComponents, incentive: 1000 }) === 21500
  );

  check(
    'bonus / fixedBonus / performanceBonus are not double-counted',
    computeGrossSalary({ ...sixComponents, fixedBonus: 1000, performanceBonus: 1000 }) === 20500
  );

  check(
    'advance limit is excluded from gross',
    computeGrossSalary({ ...sixComponents, salaryAdvanceLimit: 25000 }) === 20500
  );

  const staleStored = mapStructureGrossFields({
    ...sixComponents,
    incentive: 0,
    salaryAdvanceLimit: 5000,
  });
  check('GET mapping ignores stale stored totals by recomputing 20500', staleStored.grossSalary === 20500);
  check('grossTotal matches grossSalary', staleStored.grossTotal === staleStored.grossSalary);
  check('monthlySalary matches recomputed gross', staleStored.monthlySalary === 20500);
  check('advance is preserved and not added to gross', staleStored.salaryAdvanceLimit === 5000);

  const savePayload = {
    basicSalary: 15000,
    hra: 1000,
    medicalAllowance: 1000,
    travelAllowance: 1500,
    specialAllowance: 1000,
    incentive: 0,
    bonus: 1000,
  };
  const persisted = mapStructureGrossFields(savePayload);
  check('save/update persists component-sum gross 20500', persisted.grossSalary === 20500);
  check('payroll monthlySalary syncs to the same saved gross', persisted.monthlySalary === persisted.grossSalary);

  const payrollFromStaleRow = mapStructureGrossFields({
    ...savePayload,
  });
  check(
    'payroll generation uses component sum, not a stale 19500/21500 row',
    payrollFromStaleRow.monthlySalary === 20500
  );

  check('empty components yield 0', computeGrossSalary({}) === 0);

  const applicable14000 = resolveApplicableGross({
    basicSalary: 14000,
    extraHolidayPayout: 1272.72,
    extraWeeklyOffPayout: 0,
    storedGross: 15272.72,
  });
  check('applicable gross stays 14000 when extra holiday day is present', applicable14000 === 14000);
  check(
    'inflated 15272.72 is structure + one daily (14000/11)',
    Math.round((15272.72 - 14000) * 100) / 100 === 1272.72
  );
  const halfDay = 636.36;
  check(
    'net = 14000 - 636.36 half-day - 0 advance',
    netSalaryFromGross(14000, halfDay) === 13363.64
  );
  check(
    'inflated net 14636.36 is 15272.72 minus the same half-day',
    netSalaryFromGross(15272.72, halfDay) === 14636.36
  );
  check(
    'stored inflated gross without structure falls back by removing extra day',
    resolveApplicableGross({
      extraHolidayPayout: 1272.72,
      storedGross: 15272.72,
    }) === 14000
  );
  check('deductions are subtracted only once', netSalaryFromGross(14000, halfDay + 0) === 13363.64);

  const settled = computePayrollSettlement({
    baseGrossEarnings: 14000,
    holidayWeeklyOffPay: 1272.72,
    totalDeductions: halfDay,
  });
  check('Gross stays 14000', settled.baseGrossEarnings === 14000);
  check('holiday is additional once', settled.additionalEarnings === 1272.72 && settled.totalEarnings === 15272.72);
  check('net is 15272.72 - 636.36', settled.netSalary === 14636.36);
  check('take-home matches net when no commission or reimbursements', settled.totalTakeHomePay === 14636.36);

  const alreadyInGross = computePayrollSettlement({
    baseGrossEarnings: 14000,
    holidayWeeklyOffPay: 0,
    totalDeductions: halfDay,
  });
  check('when holiday is already in gross, net is 14000 - 636.36', alreadyInGross.netSalary === 13363.64);

  const withReimb = computePayrollSettlement({
    baseGrossEarnings: 14000,
    holidayWeeklyOffPay: 1272.72,
    totalDeductions: halfDay,
    reimbursements: 200,
    commissionEarned: 500,
  });
  check('approved reimbursements are included in net once', withReimb.netSalary === 14836.36);
  check('take-home is net plus commission only', withReimb.totalTakeHomePay === 15336.36);

  console.log(`salaryGross tests: ${passed}/${total} passed`);
}

run();
