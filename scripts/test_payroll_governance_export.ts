import {
  buildCsvDocument,
  buildPayrollSummary,
  buildPdfBuffer,
  buildXlsxBuffer,
  canExportPayrollGovernance,
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
    'xlsx filename convention',
    payrollExportFilename(october, 'xlsx') === 'Payroll_Governance_October_2026.xlsx'
  );
  check(
    'csv filename convention',
    payrollExportFilename(october, 'csv') === 'Payroll_Governance_October_2026.csv'
  );
  check(
    'pdf filename convention',
    payrollExportFilename(october, 'pdf') === 'Payroll_Governance_October_2026.pdf'
  );

  check('xlsx format is supported', isPayrollExportFormat('xlsx'));
  check('csv format is supported', isPayrollExportFormat('csv'));
  check('pdf format is supported', isPayrollExportFormat('pdf'));
  check('rejects unknown format', !isPayrollExportFormat('docx'));

  check('SUPER_ADMIN can export', canExportPayrollGovernance('SUPER_ADMIN'));
  check('HR can export', canExportPayrollGovernance('HR'));
  check('PLATFORM_ADMIN can export', canExportPayrollGovernance('PLATFORM_ADMIN'));
  check('EMPLOYEE cannot export', !canExportPayrollGovernance('EMPLOYEE'));

  check('search matches employee code', matchesPayrollSearch('EMP01', 'Ada Lovelace', 'EMP01', 'Engineer'));
  check('search is case-insensitive', matchesPayrollSearch('ada', 'Ada Lovelace', 'EMP01'));
  check('empty search matches all', matchesPayrollSearch('', 'Anyone'));
  check('unrelated search is excluded', !matchesPayrollSearch('zzz', 'Ada Lovelace', 'EMP01'));

  check('Approved counts as disbursed', isDisbursedStatus('Approved', 'PENDING'));
  check('PAID counts as disbursed', isDisbursedStatus('PENDING', 'PAID'));
  check('plain pending is not disbursed', !isDisbursedStatus('PENDING', 'PENDING'));

  const sixComponentGross = computeGrossSalary({
    basicSalary: 15000,
    hra: 1000,
    medicalAllowance: 1000,
    travelAllowance: 1500,
    specialAllowance: 1000,
    bonus: 1000,
  });
  check('export salary math matches 20500 structure gross', sixComponentGross === 20500);
  check(
    'advance limit is not mixed into structure gross',
    computeGrossSalary({
      basicSalary: 15000,
      hra: 1000,
      medicalAllowance: 1000,
      travelAllowance: 1500,
      specialAllowance: 1000,
      bonus: 1000,
      salaryAdvanceLimit: 25000,
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
    advanceCount: 1,
    advanceRequested: 5000,
    advanceOutstanding: 4000,
  });
  const byMetric = Object.fromEntries(summary.map((row) => [row.metric, row.value]));
  check('summary includes cycle', byMetric['Payroll cycle'] === 'October 2026');
  check('summary formats INR gross', byMetric['Total gross salary'] === formatInr(41000));
  check('summary pending count is 1', byMetric['Pending salary payments (count)'] === '1');
  check('disbursed and pending nets are not mixed', byMetric['Total disbursed'] === formatInr(20500));

  const sample: PayrollGovernanceExportData = {
    cycle: october,
    filenameBase: 'Payroll_Governance_October_2026',
    summary,
    structures: {
      name: 'Salary Structure',
      headers: ['Employee Code', 'Gross Salary (₹)'],
      rows: [['EMP01', 20500]],
    },
    payslips: {
      name: 'Employee Payslips',
      headers: ['Employee Code', 'Gross Salary (₹)', 'Net Salary (₹)'],
      rows: [['EMP01', 20500, 19500]],
    },
    advances: {
      name: 'Salary Advances',
      headers: ['Employee', 'Advance Amount (₹)'],
      rows: [],
    },
    expenses: {
      name: 'Expense Claims',
      headers: ['Claim Reference', 'Amount (₹)'],
      rows: [],
    },
  };

  const csv = buildCsvDocument(sample);
  check('csv has UTF-8 BOM', csv.startsWith('\uFEFF'));
  check('csv includes summary section', csv.includes('Payroll Summary'));
  check('csv includes structure section', csv.includes('Salary Structure & Components'));
  check('csv includes payslip section', csv.includes('Employee Payslips'));
  check('csv empty advances handled', csv.includes('No records for this payroll cycle and filter.'));
  check('csv does not invent employees', !csv.includes('EMP99'));
  check('csv keeps 20500 gross', csv.includes('20500'));

  const xlsx = await buildXlsxBuffer(sample);
  check('xlsx buffer is non-empty', xlsx.length > 100);
  check('xlsx is a zip/xlsx signature', xlsx[0] === 0x50 && xlsx[1] === 0x4b);

  const pdf = await buildPdfBuffer(sample);
  check('pdf buffer is non-empty', pdf.length > 100);
  check('pdf starts with %PDF', pdf.subarray(0, 4).toString() === '%PDF');

  check('round2 is stable', round2(19500.555) === 19500.56);

  console.log(`payroll governance export tests: ${passed}/${total} passed`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
