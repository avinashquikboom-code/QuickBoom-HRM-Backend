export type SalaryGrossComponents = {
  basicSalary?: number | null;
  hra?: number | null;
  medicalAllowance?: number | null;
  travelAllowance?: number | null;
  specialAllowance?: number | null;
  incentive?: number | null;
  bonus?: number | null;
  performanceBonus?: number | null;
  fixedBonus?: number | null;
  salaryAdvanceLimit?: number | null;
};

function n(value: number | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Single source of truth for structure gross salary.
 *
 * Prisma stores only `incentive` and `bonus`. There is no separate
 * performanceBonus column. `fixedBonus` maps to `bonus`; if both `bonus`
 * and `fixedBonus` are sent, bonus wins so the amount is not counted twice.
 * salaryAdvanceLimit is never included.
 */
export function computeGrossSalary(c: SalaryGrossComponents): number {
  const bonus = n(c.bonus) || n(c.fixedBonus) || n(c.performanceBonus);
  const sum =
    n(c.basicSalary) +
    n(c.hra) +
    n(c.medicalAllowance) +
    n(c.travelAllowance) +
    n(c.specialAllowance) +
    n(c.incentive) +
    bonus;
  return Math.round(sum * 100) / 100;
}

/**
 * Applicable monthly gross is the salary-structure component sum.
 * Holiday / weekly-off extra days are recorded separately and must not
 * be added into Gross Earnings — monthly salary already covers the month.
 */
export function resolveApplicableGross(c: SalaryGrossComponents & {
  extraHolidayPayout?: number | null;
  extraWeeklyOffPayout?: number | null;
  extraAttendancePayout?: number | null;
  storedGross?: number | null;
}): number {
  const structure = computeGrossSalary(c);
  if (structure > 0) return structure;
  const extra = n(c.extraHolidayPayout) + n(c.extraWeeklyOffPayout);
  const stored = n(c.storedGross);
  if (stored > extra) return Math.round((stored - extra) * 100) / 100;
  return stored;
}

export function money(value: number | null | undefined): number {
  return Math.round(n(value) * 100) / 100;
}

export function normalizeDeduction(value: number | null | undefined): number {
  return Math.abs(money(value));
}

export function netSalaryFromGross(gross: number, totalDeductions: number): number {
  const net = money(money(gross) - normalizeDeduction(totalDeductions));
  return net > 0 ? net : 0;
}

export type PayrollSettlement = {
  baseGrossEarnings: number;
  holidayWeeklyOffPay: number;
  additionalEarnings: number;
  totalEarnings: number;
  totalDeductions: number;
  reimbursements: number;
  commissionEarned: number;
  netSalary: number;
  totalTakeHomePay: number;
};

/**
 * Single payable formula for admin, mobile, PDF, and payroll APIs.
 *
 * Gross Earnings is the salary-structure component sum only.
 * Holiday / weekly-off payout is additional (stored separately) and is
 * added once into totalEarnings / net. It is not added if the caller
 * already folded it into baseGrossEarnings.
 * Approved reimbursements are part of net payable. Commission stays on
 * take-home only (existing sales/Hopkid rule).
 */
export function computePayrollSettlement(input: {
  baseGrossEarnings: number;
  extraAttendancePay?: number | null;
  holidayWeeklyOffPay?: number | null;
  overtime?: number | null;
  periodBonus?: number | null;
  totalDeductions?: number | null;
  reimbursements?: number | null;
  rkdIncentive?: number | null;
  commissionEarned?: number | null;
}): PayrollSettlement {
  const baseGrossEarnings = money(input.baseGrossEarnings);
  const holidayWeeklyOffPay = money(input.holidayWeeklyOffPay);
  const additionalEarnings = money(
    holidayWeeklyOffPay + n(input.extraAttendancePay) + n(input.overtime) + n(input.periodBonus) + n(input.rkdIncentive)
  );
  const totalEarnings = money(baseGrossEarnings + additionalEarnings);
  const totalDeductions = normalizeDeduction(input.totalDeductions);
  const reimbursements = money(input.reimbursements);
  const commissionEarned = money(input.commissionEarned);
  const netSalary = Math.max(0, money(totalEarnings - totalDeductions));
  const totalTakeHomePay = Math.max(0, money(netSalary + reimbursements + commissionEarned));
  return {
    baseGrossEarnings,
    holidayWeeklyOffPay,
    additionalEarnings,
    totalEarnings,
    totalDeductions,
    reimbursements,
    commissionEarned,
    netSalary,
    totalTakeHomePay,
  };
}

export type PayslipEarningLine = { name: string; amount: number };

/**
 * Official payslip earning lines. Holiday / weekly-off payout is additional
 * to structure components and is listed once. Displayed Gross Earnings is
 * the sum of those lines (totalEarnings), not structure gross alone.
 */
export function buildPayslipEarningLines(input: {
  basicSalary?: number | null;
  hra?: number | null;
  medicalAllowance?: number | null;
  travelAllowance?: number | null;
  specialAllowance?: number | null;
  incentive?: number | null;
  bonus?: number | null;
  travelMedicalAllowance?: number | null;
  extraHolidayPayout?: number | null;
  extraWeeklyOffPayout?: number | null;
  extraAttendancePayout?: number | null;
}): { lines: PayslipEarningLine[]; extraPayout: number; displayedGrossEarnings: number } {
  const lines: PayslipEarningLine[] = [];
  const push = (name: string, amount: number | null | undefined, always = false) => {
    const value = money(amount);
    if (always || value > 0) lines.push({ name, amount: value });
  };
  push('Basic Salary', input.basicSalary, true);
  push('House Rent Allowance (HRA)', input.hra);
  const medical = money(input.medicalAllowance);
  const travel = money(input.travelAllowance);
  push('Medical Allowance', medical);
  push('Travel Allowance', travel);
  if (medical <= 0 && travel <= 0) {
    push('Allowances (Travel/Medical)', input.travelMedicalAllowance);
  }
  push('Special Allowance', input.specialAllowance);
  push('Bonus', input.bonus);
  push('Incentive', input.incentive);
  const extraPayout = money(n(input.extraHolidayPayout) + n(input.extraWeeklyOffPayout));
  if (extraPayout > 0) {
    push('Holiday / Weekly Off Payout', extraPayout);
  }
  push('Approved Extra Attendance Pay', input.extraAttendancePayout);
  const displayedGrossEarnings = money(lines.reduce((sum, line) => sum + line.amount, 0));
  return { lines, extraPayout, displayedGrossEarnings };
}

export function reconcileOfficialPayslipDisplay(input: {
  basicSalary?: number | null;
  hra?: number | null;
  medicalAllowance?: number | null;
  travelAllowance?: number | null;
  specialAllowance?: number | null;
  incentive?: number | null;
  bonus?: number | null;
  travelMedicalAllowance?: number | null;
  extraHolidayPayout?: number | null;
  extraWeeklyOffPayout?: number | null;
  extraAttendancePayout?: number | null;
  totalDeductions?: number | null;
  reimbursements?: number | null;
  rkdIncentive?: number | null;
  commissionEarned?: number | null;
}) {
  const breakdown = buildPayslipEarningLines(input);
  const settlement = computePayrollSettlement({
    baseGrossEarnings: money(breakdown.displayedGrossEarnings - breakdown.extraPayout - n(input.extraAttendancePayout)),
    extraAttendancePay: input.extraAttendancePayout,
    holidayWeeklyOffPay: breakdown.extraPayout,
    totalDeductions: input.totalDeductions,
    reimbursements: input.reimbursements,
    commissionEarned: input.commissionEarned,
    rkdIncentive: input.rkdIncentive,
  });
  const lines = input.rkdIncentive ? [...breakdown.lines, { name: 'RKD Incentive', amount: money(input.rkdIncentive) }] : breakdown.lines;
  const displayedGrossEarnings = money(breakdown.displayedGrossEarnings + n(input.rkdIncentive));
  return {
    lines,
    extraPayout: breakdown.extraPayout,
    displayedGrossEarnings,
    totalDeductions: settlement.totalDeductions,
    netSalary: settlement.netSalary,
    totalTakeHomePay: settlement.totalTakeHomePay,
    componentSumMatchesGross: Math.abs(displayedGrossEarnings - settlement.totalEarnings) < 0.02,
    netReconciles:
      Math.abs(settlement.netSalary - money(
        displayedGrossEarnings - settlement.totalDeductions
      )) < 0.02,
    settlement,
  };
}

export function mapStructureGrossFields(ss: {
  basicSalary?: number | null;
  hra?: number | null;
  medicalAllowance?: number | null;
  travelAllowance?: number | null;
  specialAllowance?: number | null;
  incentive?: number | null;
  bonus?: number | null;
  salaryAdvanceLimit?: number | null;
}) {
  const grossSalary = computeGrossSalary(ss);
  return {
    basicSalary: n(ss.basicSalary),
    hra: n(ss.hra),
    medicalAllowance: n(ss.medicalAllowance),
    travelAllowance: n(ss.travelAllowance),
    specialAllowance: n(ss.specialAllowance),
    incentive: n(ss.incentive),
    bonus: n(ss.bonus),
    salaryAdvanceLimit: n(ss.salaryAdvanceLimit),
    grossSalary,
    monthlySalary: grossSalary,
    grossTotal: grossSalary,
  };
}

/**
 * Determines whether an employee is eligible for commission.
 * Keeps commission exclusively for Hopkid employees and sales-related staff;
 * removes commission for all other employees.
 */
export function isCommissionEligibleEmployee(emp: {
  source?: string | null;
  employeeCode?: string | null;
  employeeID?: string | null;
  designation?: string | null;
  department?: { name?: string | null } | string | null;
  user?: { role?: string | null } | null;
  role?: string | null;
  commissionPercentage?: number | null;
} | null | undefined): boolean {
  if (!emp) return false;

  // 1. Hopkid employee check
  const source = String(emp.source || '').toUpperCase();
  if (source === 'HOPKID') return true;

  const empCode = String(emp.employeeCode || '').toUpperCase();
  if (empCode.startsWith('HK')) return true;

  const empId = String(emp.employeeID || '').toUpperCase();
  if (empId.startsWith('HK') || empId.includes('HOPKID')) return true;

  // 2. Sales related check
  const designation = String(emp.designation || '').toLowerCase();
  if (designation.includes('sales')) return true;

  const deptName = typeof emp.department === 'string'
    ? emp.department.toLowerCase()
    : String(emp.department?.name || '').toLowerCase();
  if (deptName.includes('sales')) return true;

  const userRole = String(emp.user?.role || emp.role || '').toUpperCase();
  if (userRole === 'SALESMAN' || userRole.includes('SALES')) return true;

  return false;
}

export const isSalesEmployee = isCommissionEligibleEmployee;
