import { buildPayslipEarningLines, money } from './salaryGross';
import { absentDeductionLabel, attendancePeriodCaption } from './attendanceSummaryPdf';
import { AttendanceSummary, AttendanceSummaryRow } from './attendanceSummary';
import { numToWords } from '../services/payrollAutomationService';

const PdfPrinter = require('pdfmake');
const pdfmakeVfs = require('pdfmake/build/vfs_fonts.js');

// Built-in Helvetica has no glyph for the rupee sign (U+20B9); the Roboto
// fonts bundled with pdfmake do, so they are embedded instead.
const vfs: Record<string, string> = pdfmakeVfs.pdfMake?.vfs || pdfmakeVfs.vfs || pdfmakeVfs;
const vfsFont = (name: string) => Buffer.from(vfs[name], 'base64');

const fonts = {
  Roboto: {
    normal: vfsFont('Roboto-Regular.ttf'),
    bold: vfsFont('Roboto-Medium.ttf'),
    italics: vfsFont('Roboto-Italic.ttf'),
    bolditalics: vfsFont('Roboto-MediumItalic.ttf'),
  },
};

const printer = new PdfPrinter(fonts);

export interface GenerateSalarySlipPdfInput {
  employeeName: string;
  employeeCode: string;
  designation?: string | null;
  department?: string | null;
  officeName?: string | null;
  month: number;
  year: number;
  paymentStatus: string;
  documentId?: string | null;
  totalCalendarDays?: number | null;
  earnings: {
    baseSalary?: number | null;
    basicSalary?: number | null;
    hra?: number | null;
    medicalAllowance?: number | null;
    travelAllowance?: number | null;
    specialAllowance?: number | null;
    bonus?: number | null;
    incentive?: number | null;
    travelMedicalAllowance?: number | null;
  };
  extraHolidayPayout?: number | null;
  extraWeeklyOffPayout?: number | null;
  deductionsObj: {
    advanceDeduction?: number | null;
    pf?: number | null;
    esic?: number | null;
    absentDeduction?: number | null;
    halfDayDeduction?: number | null;
    leaveDeduction?: number | null;
    otherDeductions?: number | null;
    totalDeductions?: number | null;
  };
  absentDays?: number | null;
  halfDays?: number | null;
  unpaidLeaveDays?: number | null;
  workingDays?: number | null;
  presentDays?: number | null;
  paidLeaveDays?: number | null;
  weeklyOffCount?: number | null;
  holidayCount?: number | null;
  overtimeHours?: number | string | null;
  notJoinedDays?: number | null;
  remainingWorkingDays?: number | null;
  expenseCategories?: Record<string, number> | null;
  expenseReimbursement?: number | null;
  rkdIncentive?: number | null;
  rkdReferences?: string[];
  commissionEarned?: number | null;
  isCommissionEligible?: boolean | null;
  netSalary: number;
  totalTakeHomePay: number;
  netInWords?: string | null;
  attendanceSummary?: AttendanceSummary | null;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function buildSalarySlipDocDefinition(input: GenerateSalarySlipPdfInput): any {
  const PRIMARY = '#0D9488'; // Deep Teal
  const PRIMARY_DARK = '#0F766E';
  const PRIMARY_LIGHT = '#F0FDFA';
  const TEXT_MAIN = '#111827';
  const TEXT_MUTED = '#4B5563';
  const TEXT_LIGHT = '#6B7280';
  const BORDER_COLOR = '#E5E7EB';
  // Shared width for every amount column so right edges line up across sections.
  const AMOUNT_COL = 90;

  const monthName = MONTH_NAMES[input.month - 1] || `Month ${input.month}`;
  const periodLabel = `${monthName} ${input.year}`;
  const generatedOn = new Date().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  const isPaid = String(input.paymentStatus || '').toUpperCase() === 'PAID';
  const statusColor = isPaid ? '#059669' : '#D97706';
  const statusText = isPaid ? 'PAID' : 'PENDING';

  const fmt = (n: number | null | undefined) =>
    `\u20b9${(Number(n) || 0).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const fmtDed = (n: number | null | undefined) => {
    const val = Number(n) || 0;
    return val > 0 ? `-\u20b9${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '\u20b90.00';
  };

  const totalDays = input.totalCalendarDays || new Date(input.year, input.month, 0).getDate();
  const documentId =
    input.documentId ||
    `HR-PAY-${input.employeeCode || 'EMP'}-${input.year}${String(input.month).padStart(2, '0')}`;

  // 1. Build Itemized Earnings Lines
  const earningBreakdown = buildPayslipEarningLines({
    basicSalary: input.earnings.baseSalary ?? input.earnings.basicSalary,
    hra: input.earnings.hra,
    medicalAllowance: input.earnings.medicalAllowance,
    travelAllowance: input.earnings.travelAllowance,
    specialAllowance: input.earnings.specialAllowance,
    incentive: input.earnings.incentive,
    bonus: input.earnings.bonus,
    travelMedicalAllowance: input.earnings.travelMedicalAllowance,
    extraHolidayPayout: input.extraHolidayPayout,
    extraWeeklyOffPayout: input.extraWeeklyOffPayout,
  });
  const earningLines = earningBreakdown.lines;
  const rkdIncentive = money(input.rkdIncentive);
  if (rkdIncentive > 0) earningLines.push({ name: 'RKD Incentive', amount: rkdIncentive });
  const grossEarnings = money(earningBreakdown.displayedGrossEarnings + rkdIncentive);

  // 2. Build Itemized Deduction Lines
  const deductionLines: Array<{ name: string; amount: number }> = [];
  const ded = input.deductionsObj || {};

  if (ded.advanceDeduction && ded.advanceDeduction > 0) {
    deductionLines.push({ name: 'Advance Salary', amount: ded.advanceDeduction });
  }
  if (ded.pf && ded.pf > 0) {
    deductionLines.push({ name: 'Provident Fund (PF)', amount: ded.pf });
  }
  if (ded.esic && ded.esic > 0) {
    deductionLines.push({ name: 'ESIC / Tax', amount: ded.esic });
  }
  if (ded.absentDeduction && ded.absentDeduction > 0) {
    const label = absentDeductionLabel(input.absentDays || 0, input.attendanceSummary);
    deductionLines.push({ name: label, amount: ded.absentDeduction });
  }
  if (ded.halfDayDeduction && ded.halfDayDeduction > 0) {
    deductionLines.push({
      name: `Half Day Deduction (${input.halfDays || 0} half days)`,
      amount: ded.halfDayDeduction,
    });
  }
  if (ded.leaveDeduction && ded.leaveDeduction > 0) {
    deductionLines.push({
      name: `Leave Deduction (${input.unpaidLeaveDays || 0} unpaid leaves)`,
      amount: ded.leaveDeduction,
    });
  }
  if (ded.otherDeductions && ded.otherDeductions > 0) {
    deductionLines.push({ name: 'Other Deductions', amount: ded.otherDeductions });
  }
  if (deductionLines.length === 0) {
    deductionLines.push({ name: 'No Deductions', amount: 0 });
  }

  const totalDeductions = ded.totalDeductions ?? deductionLines.reduce((s, d) => s + d.amount, 0);

  // 3. Side-by-side Table Body (Earnings on left, Deductions on right)
  const financialTableBody: any[] = [
    [
      { text: 'Earnings', style: 'tableHeader', fillColor: PRIMARY },
      { text: 'Amount', style: 'tableHeader', alignment: 'right', fillColor: PRIMARY },
      { text: 'Deductions', style: 'tableHeader', fillColor: '#BE123C' },
      { text: 'Amount', style: 'tableHeader', alignment: 'right', fillColor: '#BE123C' },
    ],
  ];

  const maxRows = Math.max(earningLines.length, deductionLines.length);
  for (let i = 0; i < maxRows; i++) {
    const earn = earningLines[i];
    const deduct = deductionLines[i];
    const shaded = i % 2 === 1;
    financialTableBody.push([
      {
        text: earn ? earn.name : '',
        fontSize: 8.5,
        color: TEXT_MAIN,
        fillColor: shaded ? '#F9FAFB' : undefined,
      },
      {
        text: earn ? fmt(earn.amount) : '',
        fontSize: 8.5,
        alignment: 'right',
        color: TEXT_MAIN,
        fillColor: shaded ? '#F9FAFB' : undefined,
      },
      {
        text: deduct ? deduct.name : '',
        fontSize: 8.5,
        color: TEXT_MAIN,
        fillColor: shaded ? '#F9FAFB' : undefined,
      },
      {
        text: deduct ? (deduct.amount > 0 ? fmtDed(deduct.amount) : fmt(0)) : '',
        fontSize: 8.5,
        alignment: 'right',
        color: deduct && deduct.amount > 0 ? '#BE123C' : TEXT_MUTED,
        fillColor: shaded ? '#F9FAFB' : undefined,
      },
    ]);
  }

  // Totals Row
  financialTableBody.push([
    { text: 'Gross Earnings', fontSize: 8.5, bold: true, color: '#047857', fillColor: '#ECFDF5' },
    { text: fmt(grossEarnings), fontSize: 8.5, bold: true, alignment: 'right', color: '#047857', fillColor: '#ECFDF5' },
    { text: 'Total Deductions', fontSize: 8.5, bold: true, color: '#BE123C', fillColor: '#FFF1F2' },
    { text: fmtDed(totalDeductions), fontSize: 8.5, bold: true, alignment: 'right', color: '#BE123C', fillColor: '#FFF1F2' },
  ]);

  // 4. Attendance Summary Table (4 Columns, 6 Rows for all 12 fields)
  const attSummary = input.attendanceSummary;
  const attendanceBody: any[] = [
    [
      { text: 'Attendance Detail', style: 'tableHeader', fillColor: PRIMARY_DARK },
      { text: 'Value', style: 'tableHeader', alignment: 'right', fillColor: PRIMARY_DARK },
      { text: 'Attendance Detail', style: 'tableHeader', fillColor: PRIMARY_DARK },
      { text: 'Value', style: 'tableHeader', alignment: 'right', fillColor: PRIMARY_DARK },
    ],
  ];

  const rows = (attSummary && Array.isArray(attSummary.rows) && attSummary.rows.length > 0)
    ? attSummary.rows
    : [
        { label: 'Total Calendar Days', value: String(totalDays) },
        { label: 'Total Scheduled Working Days', value: String(input.workingDays ?? 0) },
        { label: 'Weekly Off Days', value: String(input.weeklyOffCount ?? 0) },
        { label: 'Holidays', value: String(input.holidayCount ?? 0) },
        { label: 'Working Days Before Joining', value: '0' },
        { label: 'Eligible Working Days After Joining', value: String(input.workingDays ?? 0) },
        { label: 'Present Days', value: String(input.presentDays ?? 0) },
        { label: 'Absent Days', value: String(input.absentDays ?? 0) },
        { label: 'Half Days', value: String(input.halfDays ?? 0) },
        { label: 'Paid Leave Days', value: String(input.paidLeaveDays ?? 0) },
        { label: 'Unpaid Leave Days', value: String(input.unpaidLeaveDays ?? 0) },
        { label: 'Remaining Working Days', value: '0' },
        { label: 'Overtime Hours', value: input.overtimeHours ? `${input.overtimeHours}h` : '0h 0m' },
      ];

  const half = Math.ceil(rows.length / 2);
  for (let i = 0; i < half; i++) {
    const left = rows[i];
    const right = rows[i + half];
    const shaded = i % 2 === 1;
    attendanceBody.push([
      { text: left ? left.label : '', fontSize: 8, color: TEXT_MAIN, fillColor: shaded ? '#F9FAFB' : undefined },
      { text: left ? left.value : '', fontSize: 8, bold: true, alignment: 'right', color: TEXT_MAIN, fillColor: shaded ? '#F9FAFB' : undefined },
      { text: right ? right.label : '', fontSize: 8, color: TEXT_MAIN, fillColor: shaded ? '#F9FAFB' : undefined },
      { text: right ? right.value : '', fontSize: 8, bold: true, alignment: 'right', color: TEXT_MAIN, fillColor: shaded ? '#F9FAFB' : undefined },
    ]);
  }

  // 5. Reimbursements Table
  const reimbursements = money(input.expenseReimbursement);
  const catEntries = Object.entries(input.expenseCategories || {});
  const reimbTableBody: any[] = [
    [
      { text: 'Reimbursement / Expense Category', style: 'tableHeader', fillColor: '#059669' },
      { text: 'Amount', style: 'tableHeader', alignment: 'right', fillColor: '#059669' },
    ],
  ];

  if (catEntries.length > 0) {
    catEntries.forEach(([cat, amt], idx) => {
      reimbTableBody.push([
        { text: `${cat} Expense`, fontSize: 8.5, color: TEXT_MAIN, fillColor: idx % 2 === 1 ? '#F9FAFB' : undefined },
        { text: fmt(amt), fontSize: 8.5, alignment: 'right', color: TEXT_MAIN, fillColor: idx % 2 === 1 ? '#F9FAFB' : undefined },
      ]);
    });
  } else if (reimbursements > 0) {
    reimbTableBody.push([
      { text: 'Approved Expenses', fontSize: 8.5, color: TEXT_MAIN },
      { text: fmt(reimbursements), fontSize: 8.5, alignment: 'right', color: TEXT_MAIN },
    ]);
  } else {
    reimbTableBody.push([
      { text: 'No Expenses / Reimbursements', fontSize: 8.5, color: TEXT_LIGHT, italics: true },
      { text: fmt(0), fontSize: 8.5, alignment: 'right', color: TEXT_LIGHT },
    ]);
  }

  reimbTableBody.push([
    { text: 'Total Reimbursements', fontSize: 8.5, bold: true, color: '#047857', fillColor: '#ECFDF5' },
    { text: fmt(reimbursements), fontSize: 8.5, bold: true, alignment: 'right', color: '#047857', fillColor: '#ECFDF5' },
  ]);

  const commission = input.isCommissionEligible ? money(input.commissionEarned) : 0;
  const netSalary = money(input.netSalary);
  const takeHomePay = money(input.totalTakeHomePay);
  const netInWords =
    input.netInWords || `${numToWords(Math.round(takeHomePay))} Rupees Only`;

  const summaryRow = (label: string, amount: string, opts: { bold?: boolean; color?: string; fontSize?: number } = {}) => [
    { text: label, fontSize: opts.fontSize ?? 8.5, bold: opts.bold, color: opts.color ?? TEXT_MAIN },
    { text: amount, fontSize: opts.fontSize ?? 8.5, bold: opts.bold, color: opts.color ?? TEXT_MAIN, alignment: 'right', noWrap: true },
  ];
  const payableSummaryBody: any[] = [
    summaryRow('Gross Earnings', fmt(grossEarnings)),
    summaryRow('Less: Total Deductions', fmtDed(totalDeductions), { color: '#BE123C' }),
    summaryRow('Net Salary', fmt(netSalary), { bold: true }),
  ];
  if (reimbursements > 0) {
    payableSummaryBody.push(summaryRow('Add: Eligible Reimbursements', `+${fmt(reimbursements)}`, { bold: true, color: '#059669', fontSize: 8 }));
  }
  if (commission > 0) {
    payableSummaryBody.push(summaryRow('Add: Commission', `+${fmt(commission)}`, { bold: true, color: '#059669', fontSize: 8 }));
  }

  // Return complete pdfmake document definition
  return {
    pageSize: 'A4',
    pageMargins: [36, 32, 36, 36],
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        {
          text: 'HOPKID Portal  \u2022  Confidential  \u2022  Computer Generated Salary Slip',
          fontSize: 7.5,
          color: '#9CA3AF',
          alignment: 'left',
        },
        {
          text: `Generated on ${generatedOn}  \u2022  Page ${currentPage} of ${pageCount}`,
          fontSize: 7.5,
          color: '#9CA3AF',
          alignment: 'right',
        },
      ],
      margin: [36, 0, 36, 0],
    }),
    content: [
      // 1. Company & Header Card
      {
        table: {
          widths: ['*'],
          body: [
            [
              {
                fillColor: PRIMARY,
                margin: [12, 10, 12, 10],
                columns: [
                  {
                    width: '*',
                    stack: [
                      { text: 'HOPKID PORTAL', fontSize: 16, bold: true, color: 'white' },
                      { text: 'Human Resources \u00B7 Payroll Division', fontSize: 8, color: '#CCFBF1', margin: [0, 2, 0, 4] },
                      {
                        text: `SALARY SLIP \u2014 ${periodLabel.toUpperCase()}`,
                        fontSize: 9,
                        bold: true,
                        color: 'white',
                      },
                    ],
                  },
                  {
                    width: 180,
                    alignment: 'right',
                    stack: [
                      { text: `Doc ID: ${documentId}`, fontSize: 8, color: '#CCFBF1' },
                      { text: `Generated: ${generatedOn}`, fontSize: 8, color: '#CCFBF1', margin: [0, 2, 0, 4] },
                      {
                        text: `STATUS: ${statusText}`,
                        fontSize: 8.5,
                        bold: true,
                        color: isPaid ? '#A7F3D0' : '#FDE68A',
                      },
                    ],
                  },
                ],
              },
            ],
          ],
        },
        layout: 'noBorders',
        margin: [0, 0, 0, 10],
      },

      // 2. Employee Information & Pay Period (2-Column Aligned Box)
      {
        table: {
          widths: ['50%', '50%'],
          body: [
            [
              {
                stack: [
                  { text: 'EMPLOYEE DETAILS', fontSize: 8, bold: true, color: PRIMARY, margin: [0, 0, 0, 4] },
                  {
                    columns: [
                      { text: 'Employee Name:', fontSize: 8, bold: true, color: TEXT_MUTED, width: 90 },
                      { text: input.employeeName, fontSize: 8, bold: true, color: TEXT_MAIN, width: '*' },
                    ],
                    margin: [0, 1, 0, 1],
                  },
                  {
                    columns: [
                      { text: 'Employee Code:', fontSize: 8, bold: true, color: TEXT_MUTED, width: 90 },
                      { text: input.employeeCode, fontSize: 8, bold: true, color: PRIMARY, width: '*' },
                    ],
                    margin: [0, 1, 0, 1],
                  },
                  {
                    columns: [
                      { text: 'Designation:', fontSize: 8, bold: true, color: TEXT_MUTED, width: 90 },
                      { text: input.designation || '\u2014', fontSize: 8, color: TEXT_MAIN, width: '*' },
                    ],
                    margin: [0, 1, 0, 1],
                  },
                  {
                    columns: [
                      { text: 'Department:', fontSize: 8, bold: true, color: TEXT_MUTED, width: 90 },
                      { text: input.department || '\u2014', fontSize: 8, color: TEXT_MAIN, width: '*' },
                    ],
                    margin: [0, 1, 0, 1],
                  },
                ],
                margin: [6, 6, 6, 6],
              },
              {
                stack: [
                  { text: 'PAY PERIOD DETAILS', fontSize: 8, bold: true, color: PRIMARY, margin: [0, 0, 0, 4] },
                  {
                    columns: [
                      { text: 'Office / Branch:', fontSize: 8, bold: true, color: TEXT_MUTED, width: 95 },
                      { text: input.officeName || '\u2014', fontSize: 8, color: TEXT_MAIN, width: '*' },
                    ],
                    margin: [0, 1, 0, 1],
                  },
                  {
                    columns: [
                      { text: 'Pay Period:', fontSize: 8, bold: true, color: TEXT_MUTED, width: 95 },
                      { text: periodLabel, fontSize: 8, color: TEXT_MAIN, width: '*' },
                    ],
                    margin: [0, 1, 0, 1],
                  },
                  {
                    columns: [
                      { text: 'Total Days of Month:', fontSize: 8, bold: true, color: TEXT_MUTED, width: 95 },
                      { text: `${totalDays} Days`, fontSize: 8, color: TEXT_MAIN, width: '*' },
                    ],
                    margin: [0, 1, 0, 1],
                  },
                  {
                    columns: [
                      { text: 'Status:', fontSize: 8, bold: true, color: TEXT_MUTED, width: 95 },
                      { text: statusText, fontSize: 8, bold: true, color: statusColor, width: '*' },
                    ],
                    margin: [0, 1, 0, 1],
                  },
                ],
                margin: [6, 6, 6, 6],
              },
            ],
          ],
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => BORDER_COLOR,
          vLineColor: () => BORDER_COLOR,
          paddingLeft: () => 4,
          paddingRight: () => 4,
          paddingTop: () => 2,
          paddingBottom: () => 2,
        },
        margin: [0, 0, 0, 10],
      },

      // 3. Attendance Summary Section
      {
        stack: [
          { text: 'Attendance Summary', fontSize: 9.5, bold: true, color: TEXT_MAIN, margin: [0, 0, 0, 2] },
          attSummary
            ? { text: attendancePeriodCaption(attSummary), fontSize: 7.5, color: TEXT_LIGHT, margin: [0, 0, 0, 4] }
            : null,
          {
            table: {
              headerRows: 1,
              dontBreakRows: true,
              widths: ['*', 70, '*', 70],
              body: attendanceBody,
            },
            layout: {
              hLineWidth: (i: number) => (i <= 1 ? 1 : 0.5),
              vLineWidth: () => 0,
              hLineColor: (i: number) => (i <= 1 ? PRIMARY_DARK : '#F3F4F6'),
              paddingLeft: () => 6,
              paddingRight: () => 6,
              paddingTop: () => 3.5,
              paddingBottom: () => 3.5,
            },
          },
        ].filter(Boolean),
        margin: [0, 0, 0, 10],
      },

      // 4. Financial Breakdown Table (Earnings & Deductions Side-by-Side)
      {
        stack: [
          { text: 'Salary Breakdown', fontSize: 9.5, bold: true, color: TEXT_MAIN, margin: [0, 0, 0, 4] },
          {
            table: {
              headerRows: 1,
              dontBreakRows: true,
              widths: ['*', AMOUNT_COL, '*', AMOUNT_COL],
              body: financialTableBody,
            },
            layout: {
              hLineWidth: (i: number) => (i <= 1 ? 1 : 0.5),
              vLineWidth: () => 0,
              hLineColor: (i: number) => (i <= 1 ? PRIMARY : '#F3F4F6'),
              paddingLeft: () => 6,
              paddingRight: () => 6,
              paddingTop: () => 4,
              paddingBottom: () => 4,
            },
          },
        ],
        margin: [0, 0, 0, 10],
      },

      // 5. Reimbursements Section
      {
        stack: [
          { text: 'Reimbursements / Expenses', fontSize: 9.5, bold: true, color: TEXT_MAIN, margin: [0, 0, 0, 4] },
          {
            table: {
              headerRows: 1,
              dontBreakRows: true,
              widths: ['*', AMOUNT_COL],
              body: reimbTableBody,
            },
            layout: {
              hLineWidth: (i: number) => (i <= 1 ? 1 : 0.5),
              vLineWidth: () => 0,
              hLineColor: (i: number) => (i <= 1 ? '#059669' : '#F3F4F6'),
              paddingLeft: () => 6,
              paddingRight: () => 6,
              paddingTop: () => 4,
              paddingBottom: () => 4,
            },
          },
        ],
        margin: [0, 0, 0, 10],
      },

      // 6. Payable Summary & Total Take-Home Pay Box
      {
        table: {
          widths: ['*'],
          body: [
            [
              {
                fillColor: PRIMARY_LIGHT,
                margin: [12, 10, 6, 10],
                stack: [
                  {
                    text: 'PAYABLE SUMMARY',
                    fontSize: 8.5,
                    bold: true,
                    color: PRIMARY_DARK,
                    margin: [0, 0, 0, 4],
                  },
                  {
                    table: { widths: ['*', AMOUNT_COL], body: payableSummaryBody },
                    layout: {
                      hLineWidth: () => 0,
                      vLineWidth: () => 0,
                      paddingLeft: () => 0,
                      paddingRight: () => 0,
                      paddingTop: () => 1.5,
                      paddingBottom: () => 1.5,
                    },
                  },
                  {
                    columns: [
                      {
                        width: '*',
                        stack: [
                          {
                            text: 'TOTAL TAKE-HOME PAY',
                            fontSize: 10,
                            bold: true,
                            color: PRIMARY_DARK,
                            margin: [0, 4, 0, 2],
                          },
                          {
                            text: `In Words: ${netInWords}`,
                            fontSize: 8,
                            italics: true,
                            color: TEXT_MUTED,
                          },
                        ],
                      },
                      {
                        width: 'auto',
                        text: fmt(takeHomePay),
                        fontSize: 18,
                        bold: true,
                        color: PRIMARY_DARK,
                        alignment: 'right',
                        noWrap: true,
                        margin: [8, 4, 0, 0],
                      },
                    ],
                  },
                ],
              },
            ],
          ],
        },
        layout: {
          hLineWidth: () => 1,
          vLineWidth: () => 1,
          hLineColor: () => PRIMARY,
          vLineColor: () => PRIMARY,
          paddingLeft: () => 0,
          paddingRight: () => 0,
        },
        margin: [0, 0, 0, 8],
      },

      // 7. Disclaimer
      {
        text: 'This is a computer-generated salary slip and does not require a physical signature. For any discrepancy, please contact the HR department.',
        fontSize: 7.5,
        color: '#9CA3AF',
        italics: true,
        alignment: 'center',
        margin: [0, 4, 0, 0],
      },
    ],
    styles: {
      tableHeader: {
        fontSize: 8,
        bold: true,
        color: 'white',
      },
    },
    defaultStyle: {
      font: 'Roboto',
      fontSize: 9,
    },
  };
}

export function generateSalarySlipPdfStream(input: GenerateSalarySlipPdfInput): any {
  const docDefinition = buildSalarySlipDocDefinition(input);
  return printer.createPdfKitDocument(docDefinition);
}
