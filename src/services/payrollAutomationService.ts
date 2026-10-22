import { lockedPayslip } from '../utils/fixedThirtyDaySalary';
import { prisma } from '../utils/db';

const ones = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'
];
const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

export function numToWords(n: number): string {
  const isNegative = n < 0;
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'Zero';
  let words = '';
  if (n < 20) words = ones[n];
  else if (n < 100) words = tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
  else if (n < 1000) words = ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + numToWords(n % 100) : '');
  else if (n < 100000) words = numToWords(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + numToWords(n % 1000) : '');
  else if (n < 10000000) words = numToWords(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + numToWords(n % 100000) : '');
  else words = numToWords(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + numToWords(n % 10000000) : '');
  return isNegative ? 'Minus ' + words : words;
}

import payrollService from './payrollService';

export class PayrollAutomationService {
  /**
   * Calculates salary for a specific employee in a target month and year,
   * then upserts the Payslip record.
   */
  static async calculateAndSaveSalary(
    employeeId: number,
    month: number,
    year: number,
    status: string = 'Pending Approval'
  ) {
    const existing = await prisma.payslip.findUnique({ where: { employeeId_month_year: { employeeId, month, year } } });
    if (existing && lockedPayslip(existing.status)) return existing;
    const calculation = await payrollService.calculatePayroll(employeeId, month, year);
    await payrollService.savePayslip(calculation, status);
    return prisma.payslip.findUniqueOrThrow({ where: { employeeId_month_year: { employeeId, month, year } } });
  }
}

export default PayrollAutomationService;
