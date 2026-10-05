import { prisma } from '../utils/db';

const ones = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'
];
const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

export function numToWords(n: number): string {
  if (n === 0) return 'Zero';
  if (n < 0) return 'Minus ' + numToWords(-n);
  if (n < 20) return ones[n];
  if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
  if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + numToWords(n % 100) : '');
  if (n < 100000) return numToWords(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + numToWords(n % 1000) : '');
  if (n < 10000000) return numToWords(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + numToWords(n % 100000) : '');
  return numToWords(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + numToWords(n % 10000000) : '');
}

import payrollService, { payslipComponentData } from './payrollService';

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
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      include: {
        office: true,
        department: true,
        salaryStructure: true,
      },
    });

    if (!employee) {
      throw new Error(`Employee with ID ${employeeId} not found.`);
    }

    const calculation = await payrollService.calculatePayroll(employeeId, month, year);

    const designationName = employee.designation || 'Associate';
    const departmentName = employee.department?.name || 'Operations';
    const officeName = employee.office?.name || 'Headquarters';
    const fullName = `${employee.firstName} ${employee.lastName || ''}`.trim();
    const netInWordsStr = `${numToWords(calculation.netSalary)} Rupees Only`;

    const payslip = await prisma.payslip.upsert({
      where: {
        employeeId_month_year: {
          employeeId,
          month,
          year,
        },
      },
      update: {
        baseSalary: calculation.baseSalary,
        allowance: calculation.allowance,
        deductions: calculation.deductions,
        advanceDeduction: calculation.advanceDeduction,
        netSalary: calculation.netSalary,
        presentDays: calculation.presentDays,
        absentDays: calculation.absentDays,
        halfDays: calculation.halfDays,
        paidLeaveDays: calculation.paidLeaveDays,
        unpaidLeaveDays: calculation.unpaidLeaveDays,
        holidayCount: calculation.holidayCount,
        weeklyOffCount: calculation.weeklyOffCount,
        holidayWorkedCount: calculation.holidayWorkedCount,
        weeklyOffWorkedCount: calculation.weeklyOffWorkedCount,
        extraHolidayPayout: calculation.extraHolidayPayout,
        extraWeeklyOffPayout: calculation.extraWeeklyOffPayout,
        dailySalary: calculation.dailySalary,
        workingDays: calculation.workingDays,
        totalCalendarDays: calculation.totalCalendarDays,
        commissionEarned: calculation.commissionEarned,
        expenseReimbursement: calculation.expenseReimbursement,
        ...payslipComponentData(calculation),
        status,
        employeeCode: employee.employeeCode,
        employeeName: fullName,
        designation: designationName,
        department: departmentName,
        officeName,
        netInWords: netInWordsStr,
        updatedAt: new Date(),
      },
      create: {
        employeeId,
        month,
        year,
        baseSalary: calculation.baseSalary,
        allowance: calculation.allowance,
        deductions: calculation.deductions,
        advanceDeduction: calculation.advanceDeduction,
        netSalary: calculation.netSalary,
        presentDays: calculation.presentDays,
        absentDays: calculation.absentDays,
        halfDays: calculation.halfDays,
        paidLeaveDays: calculation.paidLeaveDays,
        unpaidLeaveDays: calculation.unpaidLeaveDays,
        holidayCount: calculation.holidayCount,
        weeklyOffCount: calculation.weeklyOffCount,
        holidayWorkedCount: calculation.holidayWorkedCount,
        weeklyOffWorkedCount: calculation.weeklyOffWorkedCount,
        extraHolidayPayout: calculation.extraHolidayPayout,
        extraWeeklyOffPayout: calculation.extraWeeklyOffPayout,
        dailySalary: calculation.dailySalary,
        workingDays: calculation.workingDays,
        totalCalendarDays: calculation.totalCalendarDays,
        commissionEarned: calculation.commissionEarned,
        expenseReimbursement: calculation.expenseReimbursement,
        ...payslipComponentData(calculation),
        status,
        employeeCode: employee.employeeCode,
        employeeName: fullName,
        designation: designationName,
        department: departmentName,
        officeName,
        netInWords: netInWordsStr,
        createdAt: new Date(),
      },
    });

    return payslip;
  }
}

export default PayrollAutomationService;
