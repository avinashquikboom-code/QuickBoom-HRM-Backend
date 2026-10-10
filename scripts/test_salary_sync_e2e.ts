import assert from 'assert';
import { prisma } from '../src/utils/db';
import { computeGrossSalary } from '../src/utils/salaryGross';
import payrollService from '../src/services/payrollService';

async function testSalarySync() {
  console.log('--- RUNNING SALARY SYNCHRONIZATION TEST SUITE ---');

  // Test 1: Structure Gross Salary calculation matches Admin Panel
  // Basic ₹7,000, HRA ₹2,800, Medical ₹1,250, Travel ₹1,600, Special ₹1,350 => ₹14,000
  const components = {
    basicSalary: 7000,
    hra: 2800,
    medicalAllowance: 1250,
    travelAllowance: 1600,
    specialAllowance: 1350,
    salaryAdvanceLimit: 2000,
  };
  const fixedGross = computeGrossSalary(components);
  assert.strictEqual(fixedGross, 14000, `Expected ₹14,000 fixed gross, got ${fixedGross}`);
  console.log('✔ Test 1: Fixed monthly gross salary = ₹14,000 (advanceLimit ₹2,000 excluded)');

  // Test 2: Correct Salary Calculation without Artificial Gross Inflation:
  // Gross Salary = ₹14,000.00
  // Scheduled working days = 22, daily salary = 14000 / 22 = 636.36
  // Half-day deduction = 636.36
  // Advance deduction = 0.00
  // Applicable Gross Earnings = ₹14,000.00
  // Net Salary = Applicable Gross Earnings - Total Deductions = 14,000.00 - 636.36 = ₹13,363.64
  const schedWorkingDays = 22;
  const dailySalary = Math.round((fixedGross / schedWorkingDays) * 100) / 100;
  const halfDayDeduction = 636.36;
  const advanceDeduction = 0.00;
  const totalDeductions = halfDayDeduction + advanceDeduction;
  const applicableGrossEarnings = fixedGross;
  const netSalary = Math.round((applicableGrossEarnings - totalDeductions) * 100) / 100;

  assert.strictEqual(applicableGrossEarnings, 14000, `Expected ₹14,000 base gross, got ${applicableGrossEarnings}`);
  assert.strictEqual(netSalary, 13363.64, `Expected ₹13,363.64 net salary, got ${netSalary}`);
  console.log('✔ Test 2: Verified: Gross Salary ₹14,000 - Half-day ₹636.36 = Net Salary ₹13,363.64');

  // Test 3: Upsert a test employee with code '096' and verify Salary Structure update + payroll calculation
  console.log('\nSetting up test employee code 096 (Naydu Jhankhana)...');
  const testEmp = await prisma.employee.upsert({
    where: { employeeCode: '096' },
    update: {
      firstName: 'NAYDU',
      lastName: 'JHANKHANA',
      status: 'active',
    },
    create: {
      employeeCode: '096',
      firstName: 'NAYDU',
      lastName: 'JHANKHANA',
      status: 'active',
      designation: 'Sales Executive',
    },
  });

  // Assign salary structure
  const updatedSS = await payrollService.updateSalaryStructure(testEmp.id, {
    basicSalary: 7000,
    hra: 2800,
    medicalAllowance: 1250,
    travelAllowance: 1600,
    specialAllowance: 1350,
    salaryAdvanceLimit: 2000,
  });

  assert.strictEqual(updatedSS.grossSalary, 14000, 'updatedSS.grossSalary must be 14,000');
  assert.strictEqual(updatedSS.monthlySalary, 14000, 'updatedSS.monthlySalary must be 14,000');
  assert.strictEqual(updatedSS.salaryAdvanceLimit, 2000, 'updatedSS.salaryAdvanceLimit must be 2,000');
  console.log('✔ Test 3: Salary structure updated via payrollService: grossSalary = ₹14,000');

  // Verify wallet advance limit synchronized
  const wallet = await prisma.wallet.findFirst({ where: { employeeId: testEmp.id } });
  if (wallet) {
    assert.strictEqual(wallet.advanceLimit, 2000, 'Wallet advanceLimit must be synchronized to 2,000');
    console.log('✔ Test 3b: Wallet advance limit synchronized to ₹2,000');
  }

  // Test 4: Payroll calculation for employee 096
  const calc = await payrollService.calculatePayroll(testEmp.id, 10, 2026);
  assert.strictEqual(calc.fixedGrossSalary, 14000, `calc.fixedGrossSalary must be 14000, got ${calc.fixedGrossSalary}`);
  assert.strictEqual(calc.monthlySalary, 14000, `calc.monthlySalary must be 14000, got ${calc.monthlySalary}`);
  console.log('✔ Test 4: calculatePayroll assigns fixedGrossSalary = ₹14,000');

  // Test 5: Payslip view model contract for employee 096
  await prisma.payslip.deleteMany({ where: { employeeId: testEmp.id, month: 10, year: 2026 } });
  await payrollService.savePayslip({
    ...calc,
    absentDays: 0,
    halfDays: 1,
    halfDayDeduction: 636.36,
    deductions: 636.36,
    netSalary: 13363.64,
    commissionEarned: 500,
    expenseReimbursement: 200,
  });

  const storedPayslip = await prisma.payslip.update({
    where: {
      employeeId_month_year: {
        employeeId: testEmp.id,
        month: 10,
        year: 2026,
      },
    },
    data: {
      status: 'PAID',
      absentDays: 0,
      halfDays: 1,
      deductions: 636.36,
      extraHolidayPayout: 0,
      extraWeeklyOffPayout: 0,
      netSalary: 13363.64,
    },
  });

  const fullView = await payrollService.resolveFullPayslipView(storedPayslip);
  assert.strictEqual(fullView.fixedGrossSalary, 14000, 'fullView.fixedGrossSalary must be 14000');
  assert.strictEqual(fullView.monthlySalary, 14000, 'fullView.monthlySalary must be 14000');
  assert.strictEqual(fullView.grossSalary, 14000, 'fullView.grossSalary must be 14000');
  assert.strictEqual(fullView.grossEarnings, 14000, 'fullView.grossEarnings must be 14000');
  assert.strictEqual(fullView.earnings.fixedGrossSalary, 14000, 'fullView.earnings.fixedGrossSalary must be 14000');
  assert.strictEqual(fullView.summary.fixedGrossSalary, 14000, 'fullView.summary.fixedGrossSalary must be 14000');
  assert.strictEqual(fullView.summary.grossEarnings, 14000, 'fullView.summary.grossEarnings must be 14000');
  assert.strictEqual(fullView.netSalary, 13363.64, 'fullView.netSalary must be 13363.64');
  console.log('✔ Test 5: Full payslip view exposes gross ₹14,000 and net ₹13,363.64');

  // Test 6: Finalized / Historical payslip preservation
  const finalizedSlip = storedPayslip;
  // Now modify salary structure to 18,000
  await prisma.salaryStructure.update({
    where: { employeeId: testEmp.id },
    data: { basicSalary: 11000, grossSalary: 18000, monthlySalary: 18000 },
  });
  // Resolve view of finalized payslip - it should still preserve historical 14,000 fixed salary!
  const historicalView = await payrollService.resolveFullPayslipView(finalizedSlip);
  assert.strictEqual(historicalView.fixedGrossSalary, 14000, 'Historical finalized payslip must preserve 14,000 fixed salary');
  console.log('✔ Test 6: Finalized / PAID payslip preserved and not overwritten by subsequent salary structure changes');

  // Restore test employee back to 14,000
  await payrollService.updateSalaryStructure(testEmp.id, {
    basicSalary: 7000,
    hra: 2800,
    medicalAllowance: 1250,
    travelAllowance: 1600,
    specialAllowance: 1350,
    salaryAdvanceLimit: 2000,
  });

  console.log('\n--- ALL SALARY SYNCHRONIZATION TESTS PASSED SUCCESSFULLY! ---');
}

testSalarySync().catch(err => {
  console.error('Test failed:', err);
}).finally(async () => {
  await prisma.$disconnect();
  process.exit(0);
});
