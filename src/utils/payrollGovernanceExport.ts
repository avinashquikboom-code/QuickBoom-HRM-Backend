import { prisma } from './db';
import { getIstMonthRange } from './commissionHelper';
import { mapStructureGrossFields } from './salaryGross';
import payrollService from '../services/payrollService';

const PdfPrinter = require('pdfmake');

export const PAYROLL_EXPORT_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR', 'PLATFORM_ADMIN'] as const;
export const PAYROLL_EXPORT_FORMATS = ['pdf'] as const;
export const COMPANY_NAME = 'HopKid';

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
  generatedOn: string;
  filenameBase: string;
  summary: SummaryRow[];
  structures: TableSheet;
  payslips: TableSheet;
  advances: TableSheet;
  expenses: TableSheet;
};

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

export function payrollExportFilename(cycle: PayrollCycle, format: PayrollExportFormat = 'pdf'): string {
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

export function buildPayrollSummary(input: {
  cycleLabel: string;
  employeeCount: number;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  totalDisbursed: number;
  pendingCount: number;
  pendingAmount: number;
}): SummaryRow[] {
  return [
    { metric: 'Payroll month', value: input.cycleLabel },
    { metric: 'Total employees', value: String(input.employeeCount) },
    { metric: 'Gross salary', value: formatInr(input.totalGross) },
    { metric: 'Total deductions', value: formatInr(input.totalDeductions) },
    { metric: 'Net salary', value: formatInr(input.totalNet) },
    { metric: 'Total disbursed', value: formatInr(input.totalDisbursed) },
    { metric: 'Pending payments', value: `${input.pendingCount} (${formatInr(input.pendingAmount)})` },
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
    const mapped = ss ? mapStructureGrossFields(ss) : null;
    const bonus = mapped ? mapped.incentive + mapped.bonus : num(view.incentive) + num(view.bonus);
    const gross = mapped ? mapped.grossSalary : num(view.grossEarnings ?? view.grossSalary);
    const deductions = num(view.totalDeductions ?? view.deductions);
    const net = num(view.netSalary);
    structureRows.push([
      slip?.employee?.employeeCode || view.employeeCode || '',
      view.employeeName || '',
      mapped ? mapped.basicSalary : num(view.basicSalary ?? view.baseSalary),
      mapped ? mapped.hra : num(view.hra),
      mapped ? mapped.medicalAllowance : num(view.medicalAllowance),
      mapped ? mapped.travelAllowance : num(view.travelAllowance),
      mapped ? mapped.specialAllowance : num(view.specialAllowance),
      bonus,
      gross,
      deductions,
      net,
    ]);
  }

  const payslipRows: Array<Array<string | number>> = filteredViews.map((view) => [
    view.employeeCode || '',
    view.employeeName || '',
    view.payPeriod || cycle.monthLabel,
    num(view.grossEarnings ?? view.grossSalary),
    num(view.totalDeductions ?? view.deductions),
    num(view.netSalary),
    view.paymentStatus || view.status || '',
  ]);

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

  const summary = buildPayrollSummary({
    cycleLabel: cycle.monthLabel,
    employeeCount: employeeIds.length || filteredViews.length,
    totalGross: round2(totalGross),
    totalDeductions: round2(totalDeductions),
    totalNet: round2(totalNet),
    totalDisbursed: round2(totalDisbursed),
    pendingCount,
    pendingAmount: round2(pendingAmount),
  });

  const generatedOn = new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return {
    cycle,
    generatedOn,
    filenameBase: payrollExportFilename(cycle, 'pdf').replace(/\.pdf$/, ''),
    summary,
    structures: {
      name: 'Employee Salary Structures',
      headers: [
        'Code',
        'Employee Name',
        'Basic',
        'HRA',
        'Medical',
        'Travel',
        'Special',
        'Bonus',
        'Gross',
        'Deductions',
        'Net',
      ],
      rows: structureRows,
    },
    payslips: {
      name: 'Payslip & Payment Status',
      headers: ['Code', 'Employee Name', 'Pay Period', 'Gross', 'Deductions', 'Net', 'Payment Status'],
      rows: payslipRows,
    },
    advances: {
      name: 'Salary Advances',
      headers: [
        'Code',
        'Employee',
        'Advance Amount',
        'Approved Amount',
        'Outstanding',
        'EMI',
        'Status',
        'Requested On',
      ],
      rows: advanceRows,
    },
    expenses: {
      name: 'Expense Claims',
      headers: ['Claim Ref', 'Code', 'Employee', 'Amount', 'Approval', 'Payment', 'Claim Date'],
      rows: expenseRows,
    },
  };
}

function headerCell(text: string) {
  return {
    text,
    bold: true,
    color: '#FFFFFF',
    fontSize: 7,
    alignment: 'center' as const,
  };
}

function bodyCell(value: string | number, alignRight: boolean) {
  const isMoney = typeof value === 'number';
  return {
    text: isMoney ? formatInr(value) : String(value ?? ''),
    fontSize: 7,
    alignment: (alignRight || isMoney ? 'right' : 'left') as 'left' | 'right',
    noWrap: false,
  };
}

function tableLayout() {
  return {
    hLineWidth: () => 0.4,
    vLineWidth: () => 0.25,
    hLineColor: () => '#CBD5E1',
    vLineColor: () => '#E2E8F0',
    paddingLeft: () => 4,
    paddingRight: () => 4,
    paddingTop: () => 4,
    paddingBottom: () => 4,
    fillColor: (rowIndex: number) => {
      if (rowIndex === 0) return '#0D9488';
      return rowIndex % 2 === 0 ? '#F8FAFC' : null;
    },
  };
}

function buildSectionTable(sheet: TableSheet, moneyStartIndex: number) {
  const header = sheet.headers.map(headerCell);
  const body =
    sheet.rows.length === 0
      ? [
          header,
          [
            {
              text: 'No records for this payroll cycle and filter.',
              colSpan: sheet.headers.length,
              italics: true,
              fontSize: 8,
              color: '#64748B',
              margin: [4, 8, 4, 8],
            },
            ...sheet.headers.slice(1).map(() => ({ text: '' })),
          ],
        ]
      : [
          header,
          ...sheet.rows.map((row) =>
            row.map((cell, index) => bodyCell(cell, index >= moneyStartIndex))
          ),
        ];

  return {
    table: {
      headerRows: 1,
      keepWithHeaderRows: 1,
      dontBreakRows: true,
      widths: sheet.headers.map(() => '*'),
      body,
    },
    layout: tableLayout(),
  };
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

  const summaryPairs: string[][] = [];
  for (let i = 0; i < data.summary.length; i += 2) {
    const left = data.summary[i];
    const right = data.summary[i + 1];
    summaryPairs.push([
      `${left.metric}: ${left.value}`,
      right ? `${right.metric}: ${right.value}` : '',
    ]);
  }

  const content: object[] = [
    {
      columns: [
        {
          stack: [
            { text: COMPANY_NAME, style: 'company' },
            { text: 'Payroll Governance Report', style: 'header' },
            { text: `Payroll cycle: ${data.cycle.monthLabel}`, style: 'sub' },
          ],
        },
        {
          stack: [
            { text: 'Confidential', alignment: 'right', fontSize: 8, color: '#0F766E', bold: true },
            { text: `Generated: ${data.generatedOn}`, alignment: 'right', style: 'sub' },
            { text: 'Amounts in INR (₹)', alignment: 'right', style: 'sub' },
          ],
        },
      ],
      margin: [0, 0, 0, 10],
    },
    {
      canvas: [{ type: 'line', x1: 0, y1: 0, x2: 760, y2: 0, lineWidth: 1.5, lineColor: '#0D9488' }],
      margin: [0, 0, 0, 12],
    },
    { text: 'Payroll Summary', style: 'section', margin: [0, 0, 0, 6] },
    {
      table: {
        widths: ['*', '*'],
        body: summaryPairs.map((pair) => [
          { text: pair[0], fontSize: 8, fillColor: '#F0FDFA', margin: [6, 5, 6, 5] },
          { text: pair[1], fontSize: 8, fillColor: '#F0FDFA', margin: [6, 5, 6, 5] },
        ]),
      },
      layout: 'noBorders',
      margin: [0, 0, 0, 10],
    },
    { text: 'Employee Salary Structures', style: 'section', margin: [0, 8, 0, 6] },
    buildSectionTable(data.structures, 2),
    { text: 'Payslip & Payment Status', style: 'section', margin: [0, 14, 0, 6], pageBreak: 'before' as const },
    buildSectionTable(data.payslips, 3),
  ];

  if (data.advances.rows.length > 0) {
    content.push(
      { text: 'Salary Advances & EMI', style: 'section', margin: [0, 14, 0, 6], pageBreak: 'before' as const },
      buildSectionTable(data.advances, 2)
    );
  }
  if (data.expenses.rows.length > 0) {
    content.push(
      { text: 'Expense Claims', style: 'section', margin: [0, 14, 0, 6], pageBreak: 'before' as const },
      buildSectionTable(data.expenses, 3)
    );
  }

  const docDefinition = {
    pageOrientation: 'landscape' as const,
    pageSize: 'A4' as const,
    pageMargins: [28, 36, 28, 42],
    info: {
      title: 'Payroll Governance Report',
      author: COMPANY_NAME,
      subject: `Payroll cycle ${data.cycle.monthLabel}`,
      creator: `${COMPANY_NAME} HRM`,
    },
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        {
          text: `${COMPANY_NAME}  •  Payroll Governance Report  •  ${data.cycle.monthLabel}`,
          fontSize: 8,
          color: '#64748B',
          alignment: 'left' as const,
        },
        {
          text: `Page ${currentPage} of ${pageCount}`,
          fontSize: 8,
          color: '#64748B',
          alignment: 'right' as const,
        },
      ],
      margin: [28, 8, 28, 0],
    }),
    content,
    styles: {
      company: { fontSize: 11, bold: true, color: '#0F766E', characterSpacing: 1.2 },
      header: { fontSize: 16, bold: true, color: '#0F172A', margin: [0, 2, 0, 2] },
      sub: { fontSize: 8, color: '#475569' },
      section: { fontSize: 11, bold: true, color: '#0F766E' },
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
  query: PayrollExportQuery
): Promise<{ filename: string; contentType: string; buffer: Buffer }> {
  const data = await loadPayrollGovernanceExportData(query);
  return {
    filename: payrollExportFilename(data.cycle, 'pdf'),
    contentType: 'application/pdf',
    buffer: await buildPdfBuffer(data),
  };
}
