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

export class PayrollAutomationService {
  /**
   * Calculates salary for a specific employee in a target month and year,
   * then upserts the Payslip record.
   */
  static async calculateAndSaveSalary(
    employeeId: string,
    month: number,
    year: number,
    status: string = 'Pending Approval'
  ) {
    // 1. Fetch Employee with all metadata
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

    // 2. Query attendance records for the target month
    const monthStr = `${year}-${String(month).padStart(2, '0')}`;
    const attendances = await prisma.attendance.findMany({
      where: {
        employeeId,
        date: { startsWith: monthStr },
      },
    });

    // 3. Count attendance states
    const present = attendances.filter((a) => a.status === 'PRESENT').length;
    const late = attendances.filter((a) => a.status === 'LATE').length;
    const halfDay = attendances.filter((a) => a.status === 'HALF_DAY').length;
    const totalDays = attendances.length;

    // Proration logic: Present days = full present + late (present but late) + half of halfDays
    const presentDays = present + late + (halfDay * 0.5);
    const salaryRatio = totalDays > 0 ? (presentDays / totalDays) : 1.0;

    // 4. Determine base components from SalaryStructure or fallback defaults
    let basic = 0;
    let hra = 0;
    let medical = 0;
    let travel = 0;
    let special = 0;
    let incentive = 0;
    let bonus = 0;
    
    let pfEnabled = false;
    let employeePfRate = 12.0;
    let esicEnabled = false;
    let employeeEsicRate = 0.75;

    if (employee.salaryStructure) {
      const ss = employee.salaryStructure;
      basic = ss.basicSalary;
      hra = ss.hra;
      medical = ss.medicalAllowance;
      travel = ss.travelAllowance;
      special = ss.specialAllowance;
      incentive = ss.incentive;
      bonus = ss.bonus;
      pfEnabled = ss.pfEnabled;
      employeePfRate = ss.employeePfRate;
      esicEnabled = ss.esicEnabled;
      employeeEsicRate = ss.employeeEsicRate;
    } else {
      // Fallback defaults
      const isSenior = employee.designation?.toLowerCase().includes('senior') ||
                       employee.designation?.toLowerCase().includes('lead') ||
                       employee.designation?.toLowerCase().includes('manager');
      const defaultTotal = isSenior ? 85000 : 45000;
      basic = defaultTotal * 0.50; // 50% basic
      hra = defaultTotal * 0.30;   // 30% HRA
      special = defaultTotal * 0.20; // 20% special allowance
    }

    // 5. Calculate monthly earnings prorated by attendance ratio
    const proratedBase = Math.round(basic * salaryRatio);
    const proratedHra = Math.round(hra * salaryRatio);
    const proratedAllowances = Math.round((medical + travel + special) * salaryRatio);
    
    const totalEarnings = proratedBase + proratedHra + proratedAllowances + incentive + bonus;

    // 6. Calculate deductions: PF and ESIC
    // PF is calculated as % of pro-rated basic salary
    const pfDeduction = pfEnabled ? Math.round(proratedBase * (employeePfRate / 100)) : 0;
    
    // ESIC is calculated as % of total earnings
    const esicDeduction = esicEnabled ? Math.round(totalEarnings * (employeeEsicRate / 100)) : 0;
    
    const totalDeductions = pfDeduction + esicDeduction;

    // 7. Calculate Net Salary
    const netSalary = Math.max(0, totalEarnings - totalDeductions);
    const netInWordsStr = `${numToWords(netSalary)} Rupees Only`;

    // 8. Upsert Payslip
    const designationName = employee.designation || 'Associate';
    const departmentName = employee.department?.name || 'Operations';
    const officeName = employee.office?.name || 'Headquarters';
    const fullName = `${employee.firstName} ${employee.lastName || ''}`.trim();

    const payslip = await prisma.payslip.upsert({
      where: {
        employeeId_month_year: {
          employeeId,
          month,
          year,
        },
      },
      update: {
        baseSalary: proratedBase,
        allowance: totalEarnings - proratedBase, // allowance + HRA + incentive + bonus
        deductions: totalDeductions,
        netSalary,
        status,
        employeeCode: employee.employeeCode,
        employeeName: fullName,
        designation: designationName,
        department: departmentName,
        officeName,
        netInWords: netInWordsStr,
      },
      create: {
        employeeId,
        month,
        year,
        baseSalary: proratedBase,
        allowance: totalEarnings - proratedBase,
        deductions: totalDeductions,
        netSalary,
        status,
        employeeCode: employee.employeeCode,
        employeeName: fullName,
        designation: designationName,
        department: departmentName,
        officeName,
        netInWords: netInWordsStr,
      },
    });

    return payslip;
  }
}

export default PayrollAutomationService;
