import { AttendanceSummary, AttendanceSummaryRow } from './attendanceSummary';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatYmd(ymd: string): string {
  const [y, m, d] = String(ymd || '').split('-').map(Number);
  if (!y || !m || !d) return ymd || '';
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
}

export function attendancePeriodCaption(s: AttendanceSummary): string {
  const parts = [
    `Period: ${formatYmd(s.periodStart)} \u2013 ${formatYmd(s.periodEnd)}`,
    `${s.totalCalendarDays} calendar days`,
    'Working days exclude weekly offs and holidays',
  ];
  if (s.joiningDate && s.joiningDate > s.periodStart && s.joiningDate <= s.periodEnd) {
    parts.push(`Joined ${formatYmd(s.joiningDate)}`);
  }
  return parts.join('  \u2022  ');
}

/**
 * Days deducted as absent by payroll can include elapsed working days before
 * the joining date; the label shows that split so it reconciles with the summary.
 */
export function absentDeductionLabel(payrollAbsentDays: number, s?: AttendanceSummary | null): string {
  const total = Number(payrollAbsentDays) || 0;
  if (!s) return `Absent Deduction (${total} days)`;
  const beforeJoining = Math.max(0, total - s.absentDays);
  if (beforeJoining === 0) return `Absent Deduction (${total} days)`;
  return `Absent Deduction (${s.absentDays} absent + ${beforeJoining} before joining)`;
}

/**
 * pdfmake content for the Attendance Summary: a full-width four-column grid
 * (label, value, label, value) so the section stays compact on A4.
 */
export function attendanceSummaryPdfContent(
  s: AttendanceSummary | null | undefined,
  opts: { primary: string; titleStyle?: string; titleMargin?: number[] },
): any[] {
  if (!s || !Array.isArray(s.rows) || s.rows.length === 0) return [];
  const rows: AttendanceSummaryRow[] = s.rows;
  const cell = (row: AttendanceSummaryRow | undefined, kind: 'label' | 'value', shaded: boolean) => ({
    text: row ? (kind === 'label' ? row.label : row.value) : '',
    fontSize: 9,
    bold: kind === 'value',
    color: kind === 'label' ? '#374151' : '#111827',
    alignment: kind === 'value' ? 'right' : 'left',
    fillColor: shaded ? '#F9FAFB' : undefined,
  });

  const body: any[] = [[
    { text: 'Attendance Detail', fontSize: 8, bold: true, color: 'white', fillColor: opts.primary },
    { text: 'Value', fontSize: 8, bold: true, color: 'white', fillColor: opts.primary, alignment: 'right' },
    { text: 'Attendance Detail', fontSize: 8, bold: true, color: 'white', fillColor: opts.primary },
    { text: 'Value', fontSize: 8, bold: true, color: 'white', fillColor: opts.primary, alignment: 'right' },
  ]];
  const half = Math.ceil(rows.length / 2);
  for (let i = 0; i < half; i++) {
    const shaded = i % 2 === 1;
    body.push([
      cell(rows[i], 'label', shaded),
      cell(rows[i], 'value', shaded),
      cell(rows[i + half], 'label', shaded),
      cell(rows[i + half], 'value', shaded),
    ]);
  }

  return [
    opts.titleStyle
      ? { text: 'Attendance Summary', style: opts.titleStyle, margin: opts.titleMargin ?? [0, 0, 0, 4] }
      : { text: 'Attendance Summary', bold: true, fontSize: 11, color: '#111827', margin: opts.titleMargin ?? [0, 0, 0, 4] },
    { text: attendancePeriodCaption(s), fontSize: 7.5, color: '#6B7280', margin: [0, 0, 0, 6] },
    {
      table: { headerRows: 1, dontBreakRows: true, widths: ['*', 70, '*', 70], body },
      layout: {
        hLineWidth: (i: number) => (i <= 1 ? 1.5 : 0.5),
        vLineWidth: () => 0,
        hLineColor: (i: number) => (i <= 1 ? opts.primary : '#F3F4F6'),
        paddingLeft: () => 8,
        paddingRight: () => 8,
        paddingTop: () => 5,
        paddingBottom: () => 5,
      },
      margin: [0, 0, 0, 16],
    },
  ];
}
