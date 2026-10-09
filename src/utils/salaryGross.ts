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
