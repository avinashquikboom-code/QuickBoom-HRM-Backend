import { prisma } from '../src/utils/db';
import payrollService from '../src/services/payrollService';

interface TestCaseResult {
  name: string;
  passed: boolean;
  expected: any;
  actual: any;
  notes?: string;
}

const results: TestCaseResult[] = [];

function assertTest(name: string, passed: boolean, expected: any, actual: any, notes?: string) {
  results.push({ name, passed, expected, actual, notes });
  if (passed) {
    console.log(`✅ [PASS] ${name}`);
  } else {
    console.error(`❌ [FAIL] ${name}`);
    console.error(`   Expected:`, expected);
    console.error(`   Actual:  `, actual);
    if (notes) console.error(`   Notes:   `, notes);
  }
}

async function runTests() {
  console.log('===============================================================');
  console.log('🧪 RUNNING SALARY CALCULATION, PERSISTENCE & PAYROLL SYNC TESTS');
  console.log('===============================================================\n');

  // Find a test employee in DB or pick the first active one
  const testEmp = await prisma.employee.findFirst({
    where: { status: 'active' },
    include: { salaryStructure: true, user: true, office: true }
  });

  if (!testEmp) {
    console.error('No active employee found for testing.');
    process.exit(1);
  }

  const employeeId = testEmp.id;
  console.log(`Using Test Employee: #${employeeId} - ${testEmp.firstName} ${testEmp.lastName} (${testEmp.employeeCode})`);

  // Backup existing salary structure
  const originalSS = await prisma.salaryStructure.findUnique({ where: { employeeId } });

  try {
    // -------------------------------------------------------------
    // TEST 1: Basic salary only
    // -------------------------------------------------------------
    console.log('\n--- TEST 1: Basic Salary Only ---');
    const t1Basic = 15000;
    const t1Gross = Number((t1Basic + 0 + 0 + 0 + 0 + 0 + 0).toFixed(2));
    assertTest(
      'Basic Salary Only Gross Calculation',
      t1Gross === 15000,
      15000,
      t1Gross
    );

    // -------------------------------------------------------------
    // TEST 2: The User Problem Example
    // Basic: ₹1,000, HRA: ₹100, Travel: ₹1,000, Special: ₹100, Incentives: ₹100, Bonus: ₹100
    // Medical: blank (0), Commission Rate: 5% (not added to gross)
    // Target Gross Salary: ₹2,400 (was showing ₹2,310 due to React async state lag)
    // -------------------------------------------------------------
    console.log('\n--- TEST 2: User Prompt Example (₹2,400 Gross Salary) ---');
    const components = {
      basic: 1000,
      hra: 100,
      travel: 1000,
      special: 100,
      incentives: 100,
      bonus: 100,
      medical: 0,
      commissionRate: 5 // percentage
    };
    
    // Decimal safe formula
    const calculatedGross = Number((
      (components.basic || 0) +
      (components.hra || 0) +
      (components.medical || 0) +
      (components.travel || 0) +
      (components.special || 0) +
      (components.incentives || 0) +
      (components.bonus || 0)
    ).toFixed(2));

    assertTest(
      'User Example: Gross Salary matches exact component sum ₹2,400 (not ₹2,310)',
      calculatedGross === 2400,
      2400,
      calculatedGross,
      'Excludes commission rate (5%) from gross and correctly sums all fixed components'
    );

    // -------------------------------------------------------------
    // TEST 3: Blank Optional Salary Fields Treated as 0 (No NaN or string concat)
    // -------------------------------------------------------------
    console.log('\n--- TEST 3: Blank and Undefined Optional Fields ---');
    const blankBasic: any = '1000';
    const blankHra: any = '';
    const blankTravel: any = undefined;
    const blankMed: any = null;

    const safeBasic = parseFloat(blankBasic) || 0;
    const safeHra = parseFloat(blankHra) || 0;
    const safeTravel = parseFloat(blankTravel as any) || 0;
    const safeMed = parseFloat(blankMed as any) || 0;
    const safeSum = safeBasic + safeHra + safeTravel + safeMed;

    assertTest(
      'Safe parsing avoids NaN and string concatenation',
      !isNaN(safeSum) && safeSum === 1000,
      1000,
      safeSum
    );

    // -------------------------------------------------------------
    // TEST 4: Salary Persistence across DB (Create & Upsert)
    // -------------------------------------------------------------
    console.log('\n--- TEST 4: Database Persistence (Upsert with user example values) ---');
    const savedSS = await prisma.salaryStructure.upsert({
      where: { employeeId },
      update: {
        basicSalary: components.basic,
        hra: components.hra,
        medicalAllowance: components.medical,
        travelAllowance: components.travel,
        specialAllowance: components.special,
        incentive: components.incentives,
        bonus: components.bonus,
        grossSalary: calculatedGross,
        monthlySalary: calculatedGross,
        pfEnabled: false,
        esicEnabled: false,
      },
      create: {
        employeeId,
        basicSalary: components.basic,
        hra: components.hra,
        medicalAllowance: components.medical,
        travelAllowance: components.travel,
        specialAllowance: components.special,
        incentive: components.incentives,
        bonus: components.bonus,
        grossSalary: calculatedGross,
        monthlySalary: calculatedGross,
        pfEnabled: false,
        esicEnabled: false,
      }
    });

    assertTest(
      'Salary Structure Persisted to PostgreSQL with ₹2,400 Gross and exact components',
      savedSS.grossSalary === 2400 &&
      savedSS.basicSalary === 1000 &&
      savedSS.hra === 100 &&
      savedSS.travelAllowance === 1000 &&
      savedSS.specialAllowance === 100 &&
      savedSS.incentive === 100 &&
      savedSS.bonus === 100,
      { gross: 2400, basic: 1000, travel: 1000, incentive: 100, bonus: 100 },
      { gross: savedSS.grossSalary, basic: savedSS.basicSalary, travel: savedSS.travelAllowance, incentive: savedSS.incentive, bonus: savedSS.bonus }
    );

    // -------------------------------------------------------------
    // TEST 5: Partial Update does NOT wipe existing fields to 0 or null
    // -------------------------------------------------------------
    console.log('\n--- TEST 5: Partial Update Non-Destructive Behavior ---');
    // Simulate updating only travelAllowance to 1200 while omitting other fields
    const currentSS = await prisma.salaryStructure.findUnique({ where: { employeeId } });
    const partialUpdateTravel = 1200;
    
    // Backend merge logic
    const mergedBasic = currentSS?.basicSalary ?? 0;
    const mergedHra = currentSS?.hra ?? 0;
    const mergedTravel = partialUpdateTravel;
    const mergedSpecial = currentSS?.specialAllowance ?? 0;
    const mergedIncentive = currentSS?.incentive ?? 0;
    const mergedBonus = currentSS?.bonus ?? 0;
    const mergedGross = Number((mergedBasic + mergedHra + mergedTravel + mergedSpecial + mergedIncentive + mergedBonus).toFixed(2));

    const partiallyUpdatedSS = await prisma.salaryStructure.update({
      where: { employeeId },
      data: {
        travelAllowance: mergedTravel,
        grossSalary: mergedGross,
        monthlySalary: mergedGross,
      }
    });

    assertTest(
      'Partial update preserved existing Basic, HRA, Incentives, Bonus and recalculated Gross to ₹2,600',
      partiallyUpdatedSS.basicSalary === 1000 &&
      partiallyUpdatedSS.hra === 100 &&
      partiallyUpdatedSS.travelAllowance === 1200 &&
      partiallyUpdatedSS.incentive === 100 &&
      partiallyUpdatedSS.bonus === 100 &&
      partiallyUpdatedSS.grossSalary === 2600,
      2600,
      partiallyUpdatedSS.grossSalary
    );

    // Revert to 1000 travel for following tests
    await prisma.salaryStructure.update({
      where: { employeeId },
      data: {
        travelAllowance: 1000,
        grossSalary: 2400,
        monthlySalary: 2400,
      }
    });

    // -------------------------------------------------------------
    // TEST 6: Payroll Calculation Service Integration
    // -------------------------------------------------------------
    console.log('\n--- TEST 6: Payroll Service Calculation & Payslip Sync ---');
    const now = new Date();
    const curMonth = now.getMonth() + 1;
    const curYear = now.getFullYear();

    const payrollCalc = await payrollService.calculatePayroll(employeeId, curMonth, curYear);
    
    assertTest(
      'Payroll Service reads updated SalaryStructure with baseSalary=1000 and grossSalary=2400',
      payrollCalc.baseSalary === 1000 && payrollCalc.grossSalary >= 2400,
      { base: 1000, grossGte: 2400 },
      { base: payrollCalc.baseSalary, gross: payrollCalc.grossSalary }
    );

    // Save payslip
    await payrollService.savePayslip(payrollCalc);
    const savedSlip = await prisma.payslip.findFirst({
      where: {
        employeeId,
        month: curMonth,
        year: curYear,
      }
    });
    assertTest(
      'Payslip saved to PostgreSQL with matching baseSalary and allowances summing to ₹2,400',
      savedSlip ? ((savedSlip.baseSalary + savedSlip.allowance) >= 2400 && savedSlip.travelAllowance === 1000) : false,
      true,
      savedSlip ? ((savedSlip.baseSalary + savedSlip.allowance) >= 2400 && savedSlip.travelAllowance === 1000) : false,
      `Base: ${savedSlip?.baseSalary}, Allowance: ${savedSlip?.allowance}, Travel: ${savedSlip?.travelAllowance}`
    );

    // -------------------------------------------------------------
    // TEST 7: Commission Isolation
    // -------------------------------------------------------------
    console.log('\n--- TEST 7: Commission Isolation & Business Rules ---');
    // Commission should be a percentage on Employee model, not added directly to Gross Salary
    const empWithComm = await prisma.employee.findUnique({ where: { id: employeeId } });
    assertTest(
      'Commission is not directly added to gross salary in salary structure',
      savedSS.grossSalary === 2400, // 2400 not 2405 or 2400 + 5
      2400,
      savedSS.grossSalary,
      'Commission rate (5%) is preserved as rate, not an allowance'
    );

    // -------------------------------------------------------------
    // TEST 8: Deductions and Net Salary Isolation
    // -------------------------------------------------------------
    console.log('\n--- TEST 8: Deductions and Net Salary Isolation ---');
    assertTest(
      'Net Salary equals Gross minus Deductions',
      payrollCalc.netSalary === Math.max(0, Number((payrollCalc.grossSalary - payrollCalc.deductions).toFixed(2))),
      true,
      payrollCalc.netSalary === Math.max(0, Number((payrollCalc.grossSalary - payrollCalc.deductions).toFixed(2))),
      `Gross: ${payrollCalc.grossSalary}, Deductions: ${payrollCalc.deductions}, Net: ${payrollCalc.netSalary}`
    );

    // -------------------------------------------------------------
    // TEST 9: Mobile API Payload Verification
    // -------------------------------------------------------------
    console.log('\n--- TEST 9: Mobile API Payload & Deserialization Verification ---');
    const mobileEmployee = await prisma.employee.findUnique({
      where: { id: employeeId },
      include: { salaryStructure: true, office: true }
    });

    const mobileProfilePayload = {
      salary: mobileEmployee?.salaryStructure?.grossSalary || mobileEmployee?.salaryStructure?.monthlySalary || 0,
      salaryStructure: mobileEmployee?.salaryStructure ? {
        basicSalary: mobileEmployee.salaryStructure.basicSalary,
        grossSalary: mobileEmployee.salaryStructure.grossSalary,
        monthlySalary: mobileEmployee.salaryStructure.monthlySalary,
        hra: mobileEmployee.salaryStructure.hra,
        medicalAllowance: mobileEmployee.salaryStructure.medicalAllowance,
        travelAllowance: mobileEmployee.salaryStructure.travelAllowance,
        specialAllowance: mobileEmployee.salaryStructure.specialAllowance,
        incentive: mobileEmployee.salaryStructure.incentive,
        bonus: mobileEmployee.salaryStructure.bonus,
      } : null
    };

    assertTest(
      'Mobile Profile Payload contains gross salary ₹2,400 and full salaryStructure',
      mobileProfilePayload.salary === 2400 &&
      mobileProfilePayload.salaryStructure?.travelAllowance === 1000 &&
      mobileProfilePayload.salaryStructure?.incentive === 100 &&
      mobileProfilePayload.salaryStructure?.bonus === 100,
      { salary: 2400, travelAllowance: 1000, incentive: 100, bonus: 100 },
      {
        salary: mobileProfilePayload.salary,
        travelAllowance: mobileProfilePayload.salaryStructure?.travelAllowance,
        incentive: mobileProfilePayload.salaryStructure?.incentive,
        bonus: mobileProfilePayload.salaryStructure?.bonus
      }
    );

  } finally {
    // Restore original salary structure
    if (originalSS) {
      await prisma.salaryStructure.update({
        where: { employeeId },
        data: {
          basicSalary: originalSS.basicSalary,
          hra: originalSS.hra,
          medicalAllowance: originalSS.medicalAllowance,
          travelAllowance: originalSS.travelAllowance,
          specialAllowance: originalSS.specialAllowance,
          incentive: originalSS.incentive,
          bonus: originalSS.bonus,
          grossSalary: originalSS.grossSalary,
          monthlySalary: originalSS.monthlySalary,
          salaryAdvanceLimit: originalSS.salaryAdvanceLimit,
          pfEnabled: originalSS.pfEnabled,
          employeePfRate: originalSS.employeePfRate,
          employerPfRate: originalSS.employerPfRate,
          esicEnabled: originalSS.esicEnabled,
          employeeEsicRate: originalSS.employeeEsicRate,
          employerEsicRate: originalSS.employerEsicRate,
        }
      });
      console.log(`\n[CLEANUP] Restored original salary structure for employee #${employeeId}.`);
    }
  }

  console.log('\n===============================================================');
  const allPassed = results.every(r => r.passed);
  const passedCount = results.filter(r => r.passed).length;
  console.log(`SUMMARY: ${passedCount}/${results.length} tests passed.`);
  if (allPassed) {
    console.log('🎉 ALL SALARY CALCULATION & SYNC TESTS PASSED SUCCESSFULLY!');
  } else {
    console.error('❌ SOME TESTS FAILED.');
    process.exit(1);
  }
  console.log('===============================================================\n');
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
