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
  storedGross?: number | null;
}): number {
  const structure = computeGrossSalary(c);
  if (structure > 0) return structure;
  const extra = n(c.extraHolidayPayout) + n(c.extraWeeklyOffPayout);
  const stored = n(c.storedGross);
  if (stored > extra) return Math.round((stored - extra) * 100) / 100;
  return stored;
}

export function netSalaryFromGross(gross: number, totalDeductions: number): number {
  const net = Math.round((n(gross) - n(totalDeductions)) * 100) / 100;
  return net > 0 ? net : 0;
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
