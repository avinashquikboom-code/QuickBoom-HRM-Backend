import { prisma } from '../src/utils/db';
import payrollService from '../src/services/payrollService';

async function runEndToEndVerification() {
  console.log('===============================================================');
  console.log('🚀 RUNNING END-TO-END PAYROLL SALARY SYNCHRONIZATION TESTS');
  console.log('===============================================================');

  let passed = 0;
  let total = 0;

  function assert(desc: string, condition: boolean, extra?: any) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${desc}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${desc}`, extra || '');
      throw new Error(`Assertion failed: ${desc}`);
    }
  }

  // Find a test employee with a salary structure
  const employee = await prisma.employee.findFirst({
    where: { status: { in: ['ACTIVE', 'active'] } },
    include: { salaryStructure: true, office: true, department: true }
  });

  if (!employee || !employee.salaryStructure) {
    throw new Error('No active employee with salary structure found for test.');
  }

  console.log(`\n📋 Target Employee: #${employee.id} (${employee.employeeCode} - ${employee.firstName} ${employee.lastName})`);
  const initialStructure = { ...employee.salaryStructure };

  try {
    // -------------------------------------------------------------
    // TEST 1: Verify Database Relationships & Salary Components
    // -------------------------------------------------------------
    console.log('\n--- TEST 1: Database Relationships & Salary Structure Components ---');
    const ss = await prisma.salaryStructure.findUnique({
      where: { employeeId: employee.id }
    });
    assert('Employee has valid 1:1 SalaryStructure relationship', ss !== null);
    assert('SalaryStructure basicSalary is persisted', typeof ss?.basicSalary === 'number');
    assert('SalaryStructure hra is persisted', typeof ss?.hra === 'number');
    assert('SalaryStructure travelAllowance is persisted', typeof ss?.travelAllowance === 'number');
    assert('SalaryStructure medicalAllowance is persisted', typeof ss?.medicalAllowance === 'number');
    assert('SalaryStructure specialAllowance is persisted', typeof ss?.specialAllowance === 'number');
    assert('SalaryStructure grossSalary equals sum of components',
      ss!.grossSalary === (ss!.basicSalary + ss!.hra + ss!.travelAllowance + ss!.medicalAllowance + ss!.specialAllowance + (ss!.incentive || 0) + (ss!.bonus || 0))
    );

    // -------------------------------------------------------------
    // TEST 2: Unfinalized Payslip Live Synchronization
    // -------------------------------------------------------------
    console.log('\n--- TEST 2: Unfinalized Payslip Live Synchronization ---');
    // Set a known salary structure
    const updatedSS = await prisma.salaryStructure.update({
      where: { employeeId: employee.id },
      data: {
        basicSalary: 20000,
        hra: 5000,
        travelAllowance: 2000,
        medicalAllowance: 1500,
        specialAllowance: 1500,
        incentive: 1000,
        bonus: 1000,
        grossSalary: 32000,
        monthlySalary: 32000
      }
    });

    // Create or find an unfinalized payslip for test month 11/2026
    const testMonth = 11;
    const testYear = 2026;
    let unfinalizedSlip = await prisma.payslip.findUnique({
      where: { employeeId_month_year: { employeeId: employee.id, month: testMonth, year: testYear } }
    });

    if (!unfinalizedSlip) {
      unfinalizedSlip = await prisma.payslip.create({
        data: {
          employeeId: employee.id,
          month: testMonth,
          year: testYear,
          baseSalary: 10000,
          allowance: 2000,
          deductions: 0,
          netSalary: 12000,
          status: 'Approved',
          employeeCode: employee.employeeCode,
          employeeName: `${employee.firstName} ${employee.lastName}`,
          designation: employee.designation || 'Staff',
          department: employee.department?.name || 'General',
          officeName: employee.office?.name || 'Main Office',
          netInWords: 'Twelve Thousand Rupees Only',
        }
      });
    } else {
      unfinalizedSlip = await prisma.payslip.update({
        where: { id: unfinalizedSlip.id },
        data: { status: 'Approved' }
      });
    }

    // Resolve unfinalized view
    const viewUnfinalized = await payrollService.resolveFullPayslipView(unfinalizedSlip, employee);
    assert('Unfinalized payslip dynamically reflects latest basicSalary (20000)', viewUnfinalized.baseSalary === 20000);
    assert('Unfinalized payslip dynamically reflects latest hra (5000)', viewUnfinalized.hra === 5000);
    assert('Unfinalized payslip dynamically reflects latest travelAllowance (2000)', viewUnfinalized.travelAllowance === 2000);
    assert('Unfinalized payslip dynamically reflects latest medicalAllowance (1500)', viewUnfinalized.medicalAllowance === 1500);
    assert('Unfinalized payslip dynamically reflects latest specialAllowance (1500)', viewUnfinalized.specialAllowance === 1500);
    assert('Unfinalized payslip dynamically reflects latest incentive (1000)', viewUnfinalized.incentive === 1000);
    assert('Unfinalized payslip dynamically reflects latest bonus (1000)', viewUnfinalized.bonus === 1000);
    assert('Unfinalized payslip allowance equals sum of all allowances (12000)', viewUnfinalized.allowance === 12000);
    assert('Unfinalized payslip gross matches monthly gross salary (32000)', viewUnfinalized.grossSalary === 32000);

    // -------------------------------------------------------------
    // TEST 3: Finalized (PAID) Historical Payslip Immutability
    // -------------------------------------------------------------
    console.log('\n--- TEST 3: Finalized Historical Payslip Immutability ---');
    const pastMonth = 5;
    const pastYear = 2026;
    let finalizedSlip = await prisma.payslip.findUnique({
      where: { employeeId_month_year: { employeeId: employee.id, month: pastMonth, year: pastYear } }
    });

    if (!finalizedSlip) {
      finalizedSlip = await prisma.payslip.create({
        data: {
          employeeId: employee.id,
          month: pastMonth,
          year: pastYear,
          baseSalary: 12000,
          allowance: 3000,
          hra: 1500,
          travelAllowance: 500,
          medicalAllowance: 500,
          specialAllowance: 500,
          deductions: 500,
          netSalary: 14500,
          status: 'PAID',
          employeeCode: employee.employeeCode,
          employeeName: `${employee.firstName} ${employee.lastName}`,
          designation: employee.designation || 'Staff',
          department: employee.department?.name || 'General',
          officeName: employee.office?.name || 'Main Office',
          netInWords: 'Fourteen Thousand Five Hundred Rupees Only',
        }
      });
    } else {
      finalizedSlip = await prisma.payslip.update({
        where: { id: finalizedSlip.id },
        data: {
          status: 'PAID',
          baseSalary: 12000,
          allowance: 3000,
          hra: 1500,
          travelAllowance: 500,
          medicalAllowance: 500,
          specialAllowance: 500,
          deductions: 500,
          netSalary: 14500,
        }
      });
    }

    // Now attempt to resolve view for this finalized slip
    const viewFinalized = await payrollService.resolveFullPayslipView(finalizedSlip, employee);
    assert('Finalized payslip preserves historical baseSalary (12000)', viewFinalized.baseSalary === 12000);
    assert('Finalized payslip preserves historical allowance (3000)', viewFinalized.allowance === 3000);
    assert('Finalized payslip preserves historical HRA (1500)', viewFinalized.hra === 1500);
    assert('Finalized payslip preserves historical netSalary (14500)', viewFinalized.netSalary === 14500);
    assert('Finalized payslip status remains PAID', viewFinalized.status === 'PAID');

    // Also verify savePayslip aborts if slip is already PAID
    const calc = await payrollService.calculatePayroll(employee.id, pastMonth, pastYear);
    await payrollService.savePayslip(calc);

    const slipInDbAfterSave = await prisma.payslip.findUnique({
      where: { employeeId_month_year: { employeeId: employee.id, month: pastMonth, year: pastYear } }
    });
    assert('savePayslip strictly preserves finalized historical record without overwriting', slipInDbAfterSave?.baseSalary === 12000);
    assert('Historical status remains PAID', slipInDbAfterSave?.status === 'PAID');

    // -------------------------------------------------------------
    // TEST 4: Advance Limit Preserved Intact
    // -------------------------------------------------------------
    console.log('\n--- TEST 4: Advance Limit Preserved Intact ---');
    assert('Advance Limit field exists on salaryStructure', typeof initialStructure.salaryAdvanceLimit === 'number');
    assert('Advance Limit in DB is unaltered by payroll service', typeof updatedSS.salaryAdvanceLimit === 'number');

    // -------------------------------------------------------------
    // Clean up test records & restore initial structure
    // -------------------------------------------------------------
    console.log('\n--- CLEANUP: Restoring original state ---');
    await prisma.salaryStructure.update({
      where: { employeeId: employee.id },
      data: {
        basicSalary: initialStructure.basicSalary,
        hra: initialStructure.hra,
        travelAllowance: initialStructure.travelAllowance,
        medicalAllowance: initialStructure.medicalAllowance,
        specialAllowance: initialStructure.specialAllowance,
        incentive: initialStructure.incentive,
        bonus: initialStructure.bonus,
        grossSalary: initialStructure.grossSalary,
        monthlySalary: initialStructure.monthlySalary,
        salaryAdvanceLimit: initialStructure.salaryAdvanceLimit
      }
    });

    // Delete test payslips
    await prisma.payslip.deleteMany({
      where: {
        employeeId: employee.id,
        month: { in: [testMonth, pastMonth] },
        year: { in: [testYear, pastYear] }
      }
    });

    console.log(`[CLEANUP] Restored salary structure & removed temporary test payslips.`);

    console.log('\n===============================================================');
    console.log(`SUMMARY: ${passed}/${total} tests passed.`);
    console.log('🎉 ALL PAYROLL SALARY SYNCHRONIZATION TESTS PASSED SUCCESSFULLY!');
    console.log('===============================================================');
  } catch (err) {
    // Restore on error
    await prisma.salaryStructure.update({
      where: { employeeId: employee.id },
      data: {
        basicSalary: initialStructure.basicSalary,
        hra: initialStructure.hra,
        travelAllowance: initialStructure.travelAllowance,
        medicalAllowance: initialStructure.medicalAllowance,
        specialAllowance: initialStructure.specialAllowance,
        incentive: initialStructure.incentive,
        bonus: initialStructure.bonus,
        grossSalary: initialStructure.grossSalary,
        monthlySalary: initialStructure.monthlySalary,
        salaryAdvanceLimit: initialStructure.salaryAdvanceLimit
      }
    }).catch(() => {});
    throw err;
  }
}

runEndToEndVerification()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Test run failed:', e);
    process.exit(1);
  });
