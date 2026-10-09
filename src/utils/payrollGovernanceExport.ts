import ExcelJS from 'exceljs';
import { prisma } from './db';
import { getIstMonthRange } from './commissionHelper';
import { mapStructureGrossFields } from './salaryGross';
import payrollService from '../services/payrollService';

const PdfPrinter = require('pdfmake');

export const PAYROLL_EXPORT_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR', 'PLATFORM_ADMIN'] as const;
export const PAYROLL_EXPORT_FORMATS = ['xlsx', 'csv', 'pdf'] as const;

export type PayrollExportFormat = (typeof PAYROLL_EXPORT_FORMATS)[number];

export type PayrollExportQuery = {
  month?: string;
  search?: string;
  advanceStatus?: string;
};

export type PayrollCycle = {
  year: number;
  month: number;
  monthStr: string;
  monthLabel: string;
  monthStart: Date;
  monthEnd: Date;
};

type SummaryRow = { metric: string; value: string };
type TableSheet = { name: string; headers: string[]; rows: Array<Array<string | number>> };

export type PayrollGovernanceExportData = {
  cycle: PayrollCycle;
  filenameBase: string;
  summary: SummaryRow[];
  structures: TableSheet;
  payslips: TableSheet;
  advances: TableSheet;
  expenses: TableSheet;
};

const INR_EXCEL_FORMAT = '"₹"#,##0.00';

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function canExportPayrollGovernance(role?: string | null): boolean {
  const normalized = String(role || '').toUpperCase().replace(/_/g, '');
  return PAYROLL_EXPORT_ROLES.some((r) => r.replace(/_/g, '') === normalized);
}

export function isPayrollExportFormat(value: string): value is PayrollExportFormat {
  return (PAYROLL_EXPORT_FORMATS as readonly string[]).includes(value);
}

export function parsePayrollCycle(monthQuery?: string): PayrollCycle {
  const now = new Date();
  const istDate = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  let year = istDate.getUTCFullYear();
  let month = istDate.getUTCMonth() + 1;

  if (monthQuery && /^\d{4}-\d{2}$/.test(monthQuery)) {
    const [y, m] = monthQuery.split('-').map(Number);
    if (y >= 2000 && m >= 1 && m <= 12) {
      year = y;
      month = m;
    }
  }

  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  });
  const range = getIstMonthRange(year, month);
  return {
    year,
    month,
    monthStr,
    monthLabel,
    monthStart: range.monthStart,
    monthEnd: range.monthEnd,
  };
}

export function payrollExportFilename(cycle: PayrollCycle, format: PayrollExportFormat): string {
  const stamp = cycle.monthLabel.replace(/\s+/g, '_');
  return `Payroll_Governance_${stamp}.${format}`;
}

export function matchesPayrollSearch(search: string | undefined, ...parts: Array<string | null | undefined>): boolean {
  const query = (search || '').trim().toLowerCase();
  if (!query) return true;
  return parts.some((part) => String(part || '').toLowerCase().includes(query));
}

export function isDisbursedStatus(status?: string | null, paymentStatus?: string | null): boolean {
  const values = [status, paymentStatus].map((value) => String(value || '').toUpperCase());
  return values.some((value) => value === 'PAID' || value === 'APPROVED');
}

export function formatInr(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(round2(value));
}

export function formatExportDate(value: Date | string | null | undefined): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function csvEscape(value: string | number): string {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function buildCsvDocument(data: PayrollGovernanceExportData): string {
  const sections: string[] = [];

  const pushSheet = (title: string, sheet: TableSheet) => {
    const lines = [title, sheet.headers.map(csvEscape).join(',')];
    if (sheet.rows.length === 0) {
      lines.push('No records for this payroll cycle and filter.');
    } else {
      for (const row of sheet.rows) {
        lines.push(row.map(csvEscape).join(','));
      }
    }
    sections.push(lines.join('\r\n'));
  };

  const summaryLines = [
    'Payroll Summary',
    ['Metric', 'Value'].map(csvEscape).join(','),
    ...data.summary.map((row) => [row.metric, row.value].map(csvEscape).join(',')),
  ];
  sections.push(summaryLines.join('\r\n'));
  pushSheet('Salary Structure & Components', data.structures);
  pushSheet('Employee Payslips', data.payslips);
  pushSheet('Salary Advances & EMI Governance', data.advances);
  pushSheet('Expense Claims & History', data.expenses);

  return `\uFEFF${sections.join('\r\n\r\n')}`;
}

export function buildPayrollSummary(input: {
  cycleLabel: string;
  employeeCount: number;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  totalDisbursed: number;
  pendingCount: number;
  pendingAmount: number;
  advanceCount: number;
  advanceRequested: number;
  advanceOutstanding: number;
}): SummaryRow[] {
  return [
    { metric: 'Payroll cycle', value: input.cycleLabel },
    { metric: 'Total employees', value: String(input.employeeCount) },
    { metric: 'Total gross salary', value: formatInr(input.totalGross) },
    { metric: 'Total deductions', value: formatInr(input.totalDeductions) },
    { metric: 'Total net salary', value: formatInr(input.totalNet) },
    { metric: 'Total disbursed', value: formatInr(input.totalDisbursed) },
    { metric: 'Pending salary payments (count)', value: String(input.pendingCount) },
    { metric: 'Pending salary payments (amount)', value: formatInr(input.pendingAmount) },
    { metric: 'Salary advances (count)', value: String(input.advanceCount) },
    { metric: 'Salary advances requested', value: formatInr(input.advanceRequested) },
    { metric: 'Salary advances outstanding', value: formatInr(input.advanceOutstanding) },
  ];
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function loadPayrollGovernanceExportData(
  query: PayrollExportQuery
): Promise<PayrollGovernanceExportData> {
  const cycle = parsePayrollCycle(query.month);
  const search = query.search;
  const advanceStatus = (query.advanceStatus || 'ALL').toUpperCase();

  const slips = await prisma.payslip.findMany({
    where: { month: cycle.month, year: cycle.year },
    include: {
      employee: {
        include: {
          department: true,
          office: true,
          salaryStructure: true,
        },
      },
    },
    orderBy: { employeeCode: 'asc' },
  });

  const views = await Promise.all(
    slips.map((slip) => payrollService.resolveFullPayslipView(slip, slip.employee))
  );

  const filteredViews = views.filter((view) =>
    matchesPayrollSearch(
      search,
      view.employeeName,
      view.employeeCode,
      view.designation,
      view.department
    )
  );

  const employeeIds = Array.from(new Set(filteredViews.map((view) => Number(view.employeeId)).filter((id) => id > 0)));

  const structureRows: Array<Array<string | number>> = [];
  for (const view of filteredViews) {
    const slip = slips.find((s) => s.employeeId === view.employeeId);
    const ss = slip?.employee?.salaryStructure;
    if (!ss) continue;
    const mapped = mapStructureGrossFields(ss);
    const pfAmount = ss.pfEnabled ? round2(mapped.basicSalary * (ss.employeePfRate / 100)) : 0;
    const esicAmount = ss.esicEnabled ? round2(mapped.grossSalary * (ss.employeeEsicRate / 100)) : 0;
    structureRows.push([
      slip?.employee?.employeeCode || view.employeeCode || '',
      view.employeeName || '',
      view.designation || slip?.employee?.designation || '',
      mapped.basicSalary,
      mapped.hra,
      mapped.medicalAllowance,
      mapped.travelAllowance,
      mapped.specialAllowance,
      mapped.incentive,
      mapped.bonus,
      mapped.grossSalary,
      ss.pfEnabled ? pfAmount : 'Not applicable',
      ss.esicEnabled ? esicAmount : 'Not applicable',
      mapped.salaryAdvanceLimit,
    ]);
  }

  const payslipRows: Array<Array<string | number>> = filteredViews.map((view) => {
    const extraPayout = num(view.extraHolidayPayout) + num(view.extraWeeklyOffPayout);
    return [
      view.employeeCode || '',
      view.employeeName || '',
      view.designation || '',
      view.payPeriod || cycle.monthLabel,
      num(view.basicSalary ?? view.baseSalary),
      num(view.hra),
      num(view.medicalAllowance),
      num(view.travelAllowance),
      num(view.specialAllowance),
      num(view.incentive),
      num(view.bonus),
      extraPayout,
      num(view.commissionEarned ?? view.commission),
      num(view.grossEarnings ?? view.grossSalary),
      num(view.pf),
      num(view.esic),
      num(view.advanceDeduction),
      num(view.absentDeduction),
      num(view.halfDayDeduction),
      num(view.leaveDeduction),
      num(view.otherDeductions),
      num(view.totalDeductions ?? view.deductions),
      num(view.netSalary),
      view.paymentStatus || view.status || '',
      '',
    ];
  });

  const advanceWhere: {
    requestedOn: { gte: Date; lte: Date };
    status?: string;
  } = {
    requestedOn: { gte: cycle.monthStart, lte: cycle.monthEnd },
  };
  if (advanceStatus && advanceStatus !== 'ALL') {
    advanceWhere.status = advanceStatus;
  }

  const advances = await prisma.salaryAdvance.findMany({
    where: advanceWhere,
    include: {
      wallet: {
        include: {
          employee: {
            select: {
              employeeCode: true,
              firstName: true,
              lastName: true,
              designation: true,
              department: { select: { name: true } },
            },
          },
        },
      },
    },
    orderBy: { requestedOn: 'desc' },
  });

  const filteredAdvances = advances.filter((adv) => {
    const emp = adv.wallet?.employee;
    const name = emp ? `${emp.firstName} ${emp.lastName || ''}`.trim() : '';
    return matchesPayrollSearch(
      search,
      name,
      emp?.employeeCode,
      emp?.designation,
      emp?.department?.name
    );
  });

  const advanceRows: Array<Array<string | number>> = filteredAdvances.map((adv) => {
    const emp = adv.wallet?.employee;
    const name = emp ? `${emp.firstName} ${emp.lastName || ''}`.trim() : 'Unknown';
    const approvedStatuses = ['APPROVED', 'PAID_OFF'];
    const approvedAmount = approvedStatuses.includes(adv.status) ? adv.amount : 0;
    const emi =
      adv.monthlyEmi > 0
        ? adv.monthlyEmi
        : adv.months > 0
          ? round2(adv.amount / adv.months)
          : adv.amount;
    return [
      emp?.employeeCode || '',
      name,
      adv.amount,
      approvedAmount,
      adv.remainingAmount,
      emi,
      adv.status,
      formatExportDate(adv.requestedOn),
    ];
  });

  const expenses = await prisma.expense.findMany({
    where: {
      date: { gte: cycle.monthStart, lte: cycle.monthEnd },
    },
    include: {
      employee: {
        select: {
          employeeCode: true,
          firstName: true,
          lastName: true,
          department: { select: { name: true } },
        },
      },
    },
    orderBy: { submittedOn: 'desc' },
  });

  const filteredExpenses = expenses.filter((exp) => {
    const name = `${exp.employee.firstName} ${exp.employee.lastName || ''}`.trim();
    return matchesPayrollSearch(
      search,
      name,
      exp.employee.employeeCode,
      exp.employee.department?.name,
      String(exp.id)
    );
  });

  const expenseRows: Array<Array<string | number>> = filteredExpenses.map((exp) => {
    const name = `${exp.employee.firstName} ${exp.employee.lastName || ''}`.trim();
    const approvalStatus = exp.status === 'PAID' ? 'APPROVED' : exp.status;
    const paymentStatus = exp.status === 'PAID' ? 'PAID' : exp.status === 'APPROVED' ? 'UNPAID' : exp.status;
    return [
      String(exp.id),
      exp.employee.employeeCode,
      name,
      exp.amount,
      approvalStatus,
      paymentStatus,
      formatExportDate(exp.date),
    ];
  });

  let totalGross = 0;
  let totalDeductions = 0;
  let totalNet = 0;
  let totalDisbursed = 0;
  let pendingCount = 0;
  let pendingAmount = 0;
  for (const view of filteredViews) {
    const gross = num(view.grossEarnings ?? view.grossSalary);
    const deductions = num(view.totalDeductions ?? view.deductions);
    const net = num(view.netSalary);
    totalGross += gross;
    totalDeductions += deductions;
    totalNet += net;
    if (isDisbursedStatus(view.status, view.paymentStatus)) {
      totalDisbursed += net;
    } else {
      pendingCount += 1;
      pendingAmount += net;
    }
  }

  const advanceRequested = filteredAdvances.reduce((sum, adv) => sum + adv.amount, 0);
  const advanceOutstanding = filteredAdvances.reduce((sum, adv) => sum + adv.remainingAmount, 0);

  const summary = buildPayrollSummary({
    cycleLabel: cycle.monthLabel,
    employeeCount: employeeIds.length || filteredViews.length,
    totalGross: round2(totalGross),
    totalDeductions: round2(totalDeductions),
    totalNet: round2(totalNet),
    totalDisbursed: round2(totalDisbursed),
    pendingCount,
    pendingAmount: round2(pendingAmount),
    advanceCount: filteredAdvances.length,
    advanceRequested: round2(advanceRequested),
    advanceOutstanding: round2(advanceOutstanding),
  });

  return {
    cycle,
    filenameBase: payrollExportFilename(cycle, 'xlsx').replace(/\.xlsx$/, ''),
    summary,
    structures: {
      name: 'Salary Structure',
      headers: [
        'Employee Code',
        'Employee Name',
        'Designation',
        'Basic Salary (₹)',
        'HRA (₹)',
        'Medical Allowance (₹)',
        'Travel Allowance (₹)',
        'Special Allowance (₹)',
        'Incentive (₹)',
        'Bonus (₹)',
        'Gross Salary (₹)',
        'PF (₹)',
        'ESIC (₹)',
        'Advance Limit (₹)',
      ],
      rows: structureRows,
    },
    payslips: {
      name: 'Employee Payslips',
      headers: [
        'Employee Code',
        'Employee Name',
        'Designation',
        'Pay Period',
        'Basic Salary (₹)',
        'HRA (₹)',
        'Medical Allowance (₹)',
        'Travel Allowance (₹)',
        'Special Allowance (₹)',
        'Incentive (₹)',
        'Bonus (₹)',
        'Extra Holiday/WO Payout (₹)',
        'Commission (₹)',
        'Gross Salary (₹)',
        'PF (₹)',
        'ESIC (₹)',
        'Advance Deduction (₹)',
        'Absent Deduction (₹)',
        'Half Day Deduction (₹)',
        'Leave Deduction (₹)',
        'Other Deductions (₹)',
        'Total Deductions (₹)',
        'Net Salary (₹)',
        'Payment Status',
        'Disbursement Date',
      ],
      rows: payslipRows,
    },
    advances: {
      name: 'Salary Advances',
      headers: [
        'Employee Code',
        'Employee',
        'Advance Amount (₹)',
        'Approved Amount (₹)',
        'Outstanding Balance (₹)',
        'EMI Amount (₹)',
        'Status',
        'Requested On',
      ],
      rows: advanceRows,
    },
    expenses: {
      name: 'Expense Claims',
      headers: [
        'Claim Reference',
        'Employee Code',
        'Employee',
        'Amount (₹)',
        'Approval Status',
        'Payment Status',
        'Claim Date',
      ],
      rows: expenseRows,
    },
  };
}

function addSheet(workbook: ExcelJS.Workbook, sheet: TableSheet, currencyCols: number[]): void {
  const worksheet = workbook.addWorksheet(sheet.name);
  worksheet.addRow(sheet.headers);
  const header = worksheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D9488' } };
  header.alignment = { vertical: 'middle', wrapText: true };

  if (sheet.rows.length === 0) {
    worksheet.addRow(['No records for this payroll cycle and filter.']);
  } else {
    for (const row of sheet.rows) {
      const added = worksheet.addRow(row);
      for (const col of currencyCols) {
        const cell = added.getCell(col);
        if (typeof cell.value === 'number') {
          cell.numFmt = INR_EXCEL_FORMAT;
        }
      }
    }
  }

  worksheet.columns.forEach((col, index) => {
    const headerText = String(sheet.headers[index] || '');
    col.width = Math.min(Math.max(headerText.length + 4, 14), 28);
  });
}

export async function buildXlsxBuffer(data: PayrollGovernanceExportData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'HopKid HRM';
  const summarySheet = workbook.addWorksheet('Payroll Summary');
  summarySheet.addRow(['Metric', 'Value']);
  const header = summarySheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D9488' } };
  for (const row of data.summary) {
    summarySheet.addRow([row.metric, row.value]);
  }
  summarySheet.getColumn(1).width = 40;
  summarySheet.getColumn(2).width = 28;

  addSheet(workbook, data.structures, [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  addSheet(workbook, data.payslips, [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
  addSheet(workbook, data.advances, [3, 4, 5, 6]);
  addSheet(workbook, data.expenses, [4]);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function buildPdfBuffer(data: PayrollGovernanceExportData): Promise<Buffer> {
  const fonts = {
    Roboto: {
      normal: 'Helvetica',
      bold: 'Helvetica-Bold',
      italics: 'Helvetica-Oblique',
      bolditalics: 'Helvetica-BoldOblique',
    },
  };

  const table = (title: string, sheet: TableSheet) => {
    const emptyRow = sheet.headers.map((_, index) =>
      index === 0 ? 'No records for this payroll cycle and filter.' : ''
    );
    const body =
      sheet.rows.length === 0
        ? [sheet.headers, emptyRow]
        : [sheet.headers, ...sheet.rows.map((row) => row.map((cell) => String(cell)))];
    return [
      { text: title, style: 'section', margin: [0, 12, 0, 6] },
      {
        table: { headerRows: 1, body },
        layout: 'lightHorizontalLines',
        fontSize: 7,
      },
    ];
  };

  const docDefinition = {
    pageOrientation: 'landscape' as const,
    pageSize: 'A4' as const,
    content: [
      { text: `Payroll Governance — ${data.cycle.monthLabel}`, style: 'header' },
      { text: 'Generated from persisted payroll records. Amounts in INR (₹).', style: 'sub', margin: [0, 0, 0, 8] },
      { text: 'Payroll Summary', style: 'section', margin: [0, 4, 0, 6] },
      {
        table: {
          headerRows: 1,
          widths: ['*', '*'],
          body: [['Metric', 'Value'], ...data.summary.map((row) => [row.metric, row.value])],
        },
        layout: 'lightHorizontalLines',
      },
      ...table('Salary Structure & Components', data.structures),
      ...table('Employee Payslips', data.payslips),
      ...table('Salary Advances & EMI Governance', data.advances),
      ...table('Expense Claims & History', data.expenses),
    ],
    styles: {
      header: { fontSize: 16, bold: true, color: '#0f766e' },
      sub: { fontSize: 9, color: '#475569' },
      section: { fontSize: 11, bold: true, color: '#0f766e' },
    },
    defaultStyle: { fontSize: 8 },
  };

  const printer = new PdfPrinter(fonts);
  const pdfDoc = printer.createPdfKitDocument(docDefinition);
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
    pdfDoc.on('error', reject);
    pdfDoc.end();
  });
}

export async function generatePayrollGovernanceFile(
  query: PayrollExportQuery,
  format: PayrollExportFormat
): Promise<{ filename: string; contentType: string; buffer: Buffer }> {
  const data = await loadPayrollGovernanceExportData(query);
  const filename = payrollExportFilename(data.cycle, format);

  if (format === 'xlsx') {
    return {
      filename,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: await buildXlsxBuffer(data),
    };
  }
  if (format === 'csv') {
    return {
      filename,
      contentType: 'text/csv; charset=utf-8',
      buffer: Buffer.from(buildCsvDocument(data), 'utf8'),
    };
  }
  return {
    filename,
    contentType: 'application/pdf',
    buffer: await buildPdfBuffer(data),
  };
}
