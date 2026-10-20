import { AttendanceClassification } from './attendanceSummary';
export const SALARY_BASIS_DAYS = 30;
export const MONTHLY_PAID_LEAVE_LIMIT = 4;
export function lockedPayslip(status: unknown): boolean {
  return ['APPROVED', 'PAID', 'DISBURSED', 'COMPLETED'].includes(String(status || '').trim().toUpperCase());
}
export function fixedThirtyDaySalary(monthlySalary: number, c: AttendanceClassification, approvedExtraDates: string[] = [], extraRateMultiplier = 1) {
  if (!Number.isFinite(monthlySalary) || monthlySalary < 0 || !Number.isFinite(extraRateMultiplier) || extraRateMultiplier < 0) throw new Error('Invalid salary or extra-day rate');
  const dailySalary = monthlySalary / SALARY_BASIS_DAYS;
  const paidLeaveDays = Math.min(MONTHLY_PAID_LEAVE_LIMIT, c.paidLeaveDays);
  const unpaidLeaveDays = c.unpaidLeaveDays + Math.max(0, c.paidLeaveDays - paidLeaveDays);
  const creditedDays = c.presentDays + c.halfDays * 0.5 + paidLeaveDays + c.holidayCount + c.weeklyOffCount + c.holidayWorkedCount + c.weeklyOffWorkedCount;
  const fullyCovered = c.absentDays === 0 && c.halfDays === 0 && unpaidLeaveDays === 0 && c.daysBeforeJoining === 0 && c.remainingWorkingDays === 0;
  const shortMonthCredit = fullyCovered && c.totalCalendarDays < 30 ? Math.max(0, 30 - creditedDays) : 0;
  const standardPayableDays = Math.min(30, creditedDays + shortMonthCredit);
  let cumulative = 0;
  const eligible = (c.payableDayRecords || []).filter(day => {
    cumulative += day.units;
    return cumulative > 30 && day.worked && !day.nonWorkingDay;
  }).map(day => day.date);
  const approved = new Set(approvedExtraDates);
  const extraAttendanceDays = eligible.filter(date => approved.has(date)).length;
  const money = (value: number) => Math.round(value * 100) / 100;
  return { salaryBasisDays: 30, dailySalary: money(dailySalary), standardPayableDays, shortMonthCredit, paidLeaveDays, unpaidLeaveDays,
    eligibleExtraAttendanceDates: eligible, extraAttendanceDays, extraAttendancePayout: money(extraAttendanceDays * dailySalary * extraRateMultiplier),
    attendanceDeduction: money((30 - standardPayableDays) * dailySalary), standardSalary: money(standardPayableDays * dailySalary) };
}
