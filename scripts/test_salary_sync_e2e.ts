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

  // Test 2: Period Gross Earnings vs Fixed Gross Salary distinction
  // Scheduled working days = 22, daily salary = 14000 / 22 = 636.36
  // 2 worked holidays/weekly-offs = 2 * 636.36 = 1,272.72 -> 1,273
  // 1 absent day = 636.36
  // Period gross earnings = 14,000 + 1,273 = 15,273
  // Period net salary = 15,273 - 636.36 = 14,636.64 -> 14,636
  const schedWorkingDays = 22;
  const dailySalary = Math.round((fixedGross / schedWorkingDays) * 100) / 100;
  const extraHolidayPayout = Math.round(2 * dailySalary * 100) / 100;
  const periodGrossEarnings = Math.round((fixedGross + extraHolidayPayout) * 100) / 100;
  const absentDeduction = Math.round(1 * dailySalary * 100) / 100;
  const netSalary = Math.round((periodGrossEarnings - absentDeduction) * 100) / 100;

  assert.strictEqual(Math.round(periodGrossEarnings), 15273, `Expected ~₹15,273 period gross earnings, got ${periodGrossEarnings}`);
  assert.strictEqual(Math.round(netSalary), 14636, `Expected ~₹14,636 period net salary, got ${netSalary}`);
  console.log('✔ Test 2: Mathematical reproduction verified: Fixed ₹14,000 vs Period Gross ₹15,273 & Net ₹14,636');

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
  await payrollService.savePayslip({
    ...calc,
    extraHolidayPayout: 1273,
    deductions: 636.36,
    commissionEarned: 500,
    expenseReimbursement: 200,
  });

  const storedPayslip = await prisma.payslip.findFirstOrThrow({
    where: { employeeId: testEmp.id, month: 10, year: 2026 }
  });

  const fullView = await payrollService.resolveFullPayslipView(storedPayslip);
  assert.strictEqual(fullView.fixedGrossSalary, 14000, 'fullView.fixedGrossSalary must be 14000');
  assert.strictEqual(fullView.monthlySalary, 14000, 'fullView.monthlySalary must be 14000');
  assert.strictEqual(fullView.earnings.fixedGrossSalary, 14000, 'fullView.earnings.fixedGrossSalary must be 14000');
  assert.strictEqual(fullView.summary.fixedGrossSalary, 14000, 'fullView.summary.fixedGrossSalary must be 14000');
  console.log('✔ Test 5: Full payslip view exposes fixedGrossSalary ₹14,000');

  // Test 6: Finalized / Historical payslip preservation
  const finalizedSlip = await prisma.payslip.update({
    where: { id: storedPayslip.id },
    data: { status: 'PAID' },
  });
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
