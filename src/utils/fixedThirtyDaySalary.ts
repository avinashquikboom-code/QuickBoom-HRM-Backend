import { AttendanceClassification } from './attendanceSummary';

export const SALARY_BASIS_DAYS = 30;
export const MONTHLY_PAID_LEAVE_LIMIT = 4;
export const MIN_ATTENDANCE_REQUIREMENT_DAYS = 24;

export interface ExtraAttendancePayRule {
  enabled: boolean;
  type?: 'PER_DAY_RATE' | 'FIXED_AMOUNT';
  rateMultiplier?: number;
  fixedAmount?: number;
  minimumPresentDays?: number;
}

export interface FixedThirtyDaySalaryResult {
  salaryBasisDays: number;
  monthlySalary: number;
  dailySalary: number;
  dailyRate: number;
  standardPayableDays: number;
  payableDays: number;
  shortMonthCredit: number;
  paidLeaveDays: number;
  paidLeavesUsed: number;
  remainingPaidLeaves: number;
  unpaidLeaveDays: number;
  unpaidAbsences: number;
  unpaidDeduction: number;
  attendanceDeduction: number;
  baseSalary: number;
  standardSalary: number;
  eligibleExtraAttendanceDates: string[];
  extraAttendanceDays: number;
  extraAttendancePayout: number;
  minAttendanceRequirement: number;
  minAttendanceMet: boolean;
}

export function lockedPayslip(status: unknown): boolean {
  return ['APPROVED', 'PAID', 'DISBURSED', 'COMPLETED'].includes(String(status || '').trim().toUpperCase());
}

export function fixedThirtyDaySalary(
  monthlySalary: number,
  c: AttendanceClassification,
  approvedExtraDates: string[] = [],
  extraRuleOrMultiplier: number | ExtraAttendancePayRule = 1
): FixedThirtyDaySalaryResult {
  if (!Number.isFinite(monthlySalary) || monthlySalary < 0) {
    throw new Error('Invalid monthly salary');
  }

  // Parse extra attendance pay rule
  const rule: ExtraAttendancePayRule =
    typeof extraRuleOrMultiplier === 'number'
      ? {
          enabled: true,
          type: 'PER_DAY_RATE',
          rateMultiplier: extraRuleOrMultiplier,
          minimumPresentDays: 30,
        }
      : {
          enabled: Boolean(extraRuleOrMultiplier?.enabled),
          type: extraRuleOrMultiplier?.type || 'PER_DAY_RATE',
          rateMultiplier: Number.isFinite(extraRuleOrMultiplier?.rateMultiplier)
            ? extraRuleOrMultiplier.rateMultiplier
            : 1,
          fixedAmount: Number.isFinite(extraRuleOrMultiplier?.fixedAmount)
            ? extraRuleOrMultiplier.fixedAmount
            : 0,
          minimumPresentDays: Number.isFinite(extraRuleOrMultiplier?.minimumPresentDays)
            ? extraRuleOrMultiplier.minimumPresentDays
            : 30,
        };

  const money = (value: number) => Math.round(value * 100) / 100;
  const dailySalary = money(monthlySalary / SALARY_BASIS_DAYS);

  // Paid leave capped at 4 days per month
  const paidLeavesUsed = Math.min(MONTHLY_PAID_LEAVE_LIMIT, Math.max(0, c.paidLeaveDays || 0));
  const remainingPaidLeaves = Math.max(0, MONTHLY_PAID_LEAVE_LIMIT - paidLeavesUsed);
  const excessPaidLeaves = Math.max(0, (c.paidLeaveDays || 0) - paidLeavesUsed);
  const unpaidLeaveDays = (c.unpaidLeaveDays || 0) + excessPaidLeaves;

  // Credited days from attendance, paid leaves, and paid calendar non-working days
  const creditedDays =
    (c.presentDays || 0) +
    (c.halfDays || 0) * 0.5 +
    paidLeavesUsed +
    (c.holidayCount || 0) +
    (c.weeklyOffCount || 0) +
    (c.holidayWorkedCount || 0) +
    (c.weeklyOffWorkedCount || 0);

  const fullyCovered =
    (c.absentDays || 0) === 0 &&
    (c.halfDays || 0) === 0 &&
    unpaidLeaveDays === 0 &&
    (c.daysBeforeJoining || 0) === 0 &&
    (c.remainingWorkingDays || 0) === 0;

  // In short months (e.g. Feb 28 days), credit the 2 days if fully covered without unexcused absences
  const shortMonthCredit =
    fullyCovered && (c.totalCalendarDays || 30) < SALARY_BASIS_DAYS
      ? Math.max(0, SALARY_BASIS_DAYS - creditedDays)
      : 0;

  const standardPayableDays = Math.min(SALARY_BASIS_DAYS, creditedDays + shortMonthCredit);
  const unpaidAbsences = Math.max(0, SALARY_BASIS_DAYS - standardPayableDays);

  const unpaidDeduction = money(unpaidAbsences * dailySalary);
  const baseSalary = money(standardPayableDays * dailySalary);

  // Extra Attendance Pay Calculation (only if configured and approved rule)
  let cumulative = 0;
  const eligible = (c.payableDayRecords || [])
    .filter(day => {
      cumulative += day.units;
      return cumulative > SALARY_BASIS_DAYS && day.worked && !day.nonWorkingDay;
    })
    .map(day => day.date);

  const approved = new Set(approvedExtraDates);
  let extraAttendanceDays = 0;
  let extraAttendancePayout = 0.0;

  if (rule.enabled) {
    const minPresentRequired = rule.minimumPresentDays ?? 30;
    const meetsPresentRequirement = (c.presentDays || 0) >= minPresentRequired;

    if (meetsPresentRequirement || approved.size > 0) {
      if (rule.type === 'FIXED_AMOUNT') {
        const approvedCount = eligible.filter(date => approved.has(date)).length;
        if (approvedCount > 0) {
          extraAttendanceDays = approvedCount;
          extraAttendancePayout = money(approvedCount * (rule.fixedAmount || 0));
        } else if (meetsPresentRequirement) {
          extraAttendanceDays = 1;
          extraAttendancePayout = money(rule.fixedAmount || 0);
        }
      } else {
        // PER_DAY_RATE
        const multiplier = rule.rateMultiplier ?? 1.0;
        const approvedCount = eligible.filter(date => approved.has(date)).length;
        if (approvedCount > 0) {
          extraAttendanceDays = approvedCount;
          extraAttendancePayout = money(approvedCount * dailySalary * multiplier);
        } else if (meetsPresentRequirement) {
          const extraDaysCount = Math.max(1, (c.presentDays || 0) - minPresentRequired + 1);
          extraAttendanceDays = extraDaysCount;
          extraAttendancePayout = money(extraDaysCount * dailySalary * multiplier);
        }
      }
    }
  }

  const minAttendanceMet = (c.presentDays || 0) >= MIN_ATTENDANCE_REQUIREMENT_DAYS;

  return {
    salaryBasisDays: SALARY_BASIS_DAYS,
    monthlySalary: money(monthlySalary),
    dailySalary,
    dailyRate: dailySalary,
    standardPayableDays,
    payableDays: standardPayableDays,
    shortMonthCredit,
    paidLeaveDays: paidLeavesUsed,
    paidLeavesUsed,
    remainingPaidLeaves,
    unpaidLeaveDays,
    unpaidAbsences,
    unpaidDeduction,
    attendanceDeduction: unpaidDeduction,
    baseSalary,
    standardSalary: baseSalary,
    eligibleExtraAttendanceDates: eligible,
    extraAttendanceDays,
    extraAttendancePayout,
    minAttendanceRequirement: MIN_ATTENDANCE_REQUIREMENT_DAYS,
    minAttendanceMet,
  };
}

