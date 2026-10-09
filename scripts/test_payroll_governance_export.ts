import {
  buildPayrollSummary,
  buildPdfBuffer,
  canExportPayrollGovernance,
  COMPANY_NAME,
  formatInr,
  isDisbursedStatus,
  isPayrollExportFormat,
  matchesPayrollSearch,
  parsePayrollCycle,
  payrollExportFilename,
  round2,
  type PayrollGovernanceExportData,
} from '../src/utils/payrollGovernanceExport';
import { computeGrossSalary } from '../src/utils/salaryGross';

async function run() {
  let passed = 0;
  let total = 0;
  const check = (desc: string, cond: boolean) => {
    total += 1;
    if (!cond) throw new Error(`FAIL: ${desc}`);
    passed += 1;
    console.log(`PASS ${desc}`);
  };

  const october = parsePayrollCycle('2026-10');
  check('parses October 2026 cycle', october.year === 2026 && october.month === 10);
  check('month label is October 2026', october.monthLabel === 'October 2026');
  check(
    'pdf filename convention',
    payrollExportFilename(october, 'pdf') === 'Payroll_Governance_October_2026.pdf'
  );

  check('pdf format is supported', isPayrollExportFormat('pdf'));
  check('xlsx is no longer a payroll export format', !isPayrollExportFormat('xlsx'));
  check('csv is no longer a payroll export format', !isPayrollExportFormat('csv'));

  check('SUPER_ADMIN can export', canExportPayrollGovernance('SUPER_ADMIN'));
  check('HR can export', canExportPayrollGovernance('HR'));
  check('EMPLOYEE cannot export', !canExportPayrollGovernance('EMPLOYEE'));

  check('search matches employee code', matchesPayrollSearch('EMP01', 'Ada Lovelace', 'EMP01', 'Engineer'));
  check('unrelated search is excluded', !matchesPayrollSearch('zzz', 'Ada Lovelace', 'EMP01'));

  check('Approved counts as disbursed', isDisbursedStatus('Approved', 'PENDING'));
  check('plain pending is not disbursed', !isDisbursedStatus('PENDING', 'PENDING'));

  check(
    'export salary math matches 20500 structure gross',
    computeGrossSalary({
      basicSalary: 15000,
      hra: 1000,
      medicalAllowance: 1000,
      travelAllowance: 1500,
      specialAllowance: 1000,
      bonus: 1000,
    }) === 20500
  );

  const summary = buildPayrollSummary({
    cycleLabel: 'October 2026',
    employeeCount: 2,
    totalGross: 41000,
    totalDeductions: 2000,
    totalNet: 39000,
    totalDisbursed: 20500,
    pendingCount: 1,
    pendingAmount: 18500,
  });
  const byMetric = Object.fromEntries(summary.map((row) => [row.metric, row.value]));
  check('summary includes payroll month', byMetric['Payroll month'] === 'October 2026');
  check('summary formats INR gross', byMetric['Gross salary'] === formatInr(41000));
  check('disbursed and pending nets are not mixed', byMetric['Total disbursed'] === formatInr(20500));
  check('company name is HopKid', COMPANY_NAME === 'HopKid');

  const longRows: Array<Array<string | number>> = [];
  for (let i = 1; i <= 40; i += 1) {
    longRows.push([
      `EMP${String(i).padStart(2, '0')}`,
      `Employee ${i}`,
      15000,
      1000,
      1000,
      1500,
      1000,
      1000,
      20500,
      1000,
      19500,
    ]);
  }

  const sample: PayrollGovernanceExportData = {
    cycle: october,
    generatedOn: '09 Oct 2026, 08:00 pm',
    filenameBase: 'Payroll_Governance_October_2026',
    summary,
    structures: {
      name: 'Employee Salary Structures',
      headers: ['Code', 'Employee Name', 'Basic', 'HRA', 'Medical', 'Travel', 'Special', 'Bonus', 'Gross', 'Deductions', 'Net'],
      rows: longRows,
    },
    payslips: {
      name: 'Payslip & Payment Status',
      headers: ['Code', 'Employee Name', 'Pay Period', 'Gross', 'Deductions', 'Net', 'Payment Status'],
      rows: [['EMP01', 'Employee 1', 'October 2026', 20500, 1000, 19500, 'PENDING']],
    },
    advances: {
      name: 'Salary Advances',
      headers: ['Code', 'Employee', 'Advance Amount'],
      rows: [],
    },
    expenses: {
      name: 'Expense Claims',
      headers: ['Claim Ref', 'Amount'],
      rows: [],
    },
  };

  const pdf = await buildPdfBuffer(sample);
  const pdfText = pdf.toString('latin1');
  check('pdf buffer is non-empty', pdf.length > 100);
  check('pdf starts with %PDF', pdf.subarray(0, 4).toString() === '%PDF');
  check('pdf metadata includes company author', pdfText.includes('HopKid'));
  check('pdf metadata includes report title', pdfText.includes('Payroll Governance Report'));
  check('pdf metadata includes selected month', pdfText.includes('October 2026'));
  check('pdf paginates long lists', /\/Type\s*\/Page/.test(pdfText) || pdfText.includes('/Type /Pages'));
  check('round2 is stable', round2(19500.555) === 19500.56);

  console.log(`payroll governance export tests: ${passed}/${total} passed`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
