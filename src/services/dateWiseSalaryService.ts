import { prisma } from '../utils/db';
import payrollService from './payrollService';
import { fixedThirtyDaySalary, SALARY_BASIS_DAYS, MONTHLY_PAID_LEAVE_LIMIT } from '../utils/fixedThirtyDaySalary';
import { getIstMonthRange } from '../utils/commissionHelper';
import { computeGrossSalary } from '../utils/salaryGross';
import { normalizeDayName } from '../utils/attendanceSummary';

export interface DateWiseDayRecord {
  date: string; // 'YYYY-MM-DD'
  dayOfWeek: string; // 'Monday', 'Tuesday', etc.
  dayNumber: number; // 1..31
  dateFormatted: string; // '1 Oct 2026'
  status:
    | 'PRESENT'
    | 'LATE'
    | 'HALF_DAY'
    | 'PAID_LEAVE'
    | 'UNPAID_LEAVE'
    | 'WEEKLY_OFF'
    | 'WEEKLY_OFF_WORKED'
    | 'HOLIDAY'
    | 'HOLIDAY_WORKED'
    | 'ABSENT'
    | 'PENDING'
    | 'NOT_JOINED';
  statusLabel: string;
  dailySalary: number;
  payableUnits: number;
  deduction: number;
  extraPayout: number;
  earnedAmount: number;
  isPaidLeave: boolean;
  isUnpaid: boolean;
  isHoliday: boolean;
  isWeeklyOff: boolean;
  isWorked: boolean;
  isHalfDay: boolean;
  checkIn: string | null;
  checkOut: string | null;
  notes: string | null;
  leaveType?: string | null;
  leaveReason?: string | null;
  holidayName?: string | null;
}

export interface DateWiseSalarySummary {
  month: number;
  year: number;
  monthName: string;
  payPeriod: string;
  employeeId: number;
  employeeCode: string;
  employeeName: string;
  designation: string;
  department: string;
  officeName: string;
  monthlySalary: number;
  dailySalary: number;
  salaryBasisDays: number;
  totalCalendarDays: number;
  monthWorkingDays: number;
  presentDays: number;
  halfDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  absentDays: number;
  weeklyOffDays: number;
  weeklyOffWorkedDays: number;
  holidays: number;
  holidayWorkedDays: number;
  notJoinedDays: number;
  pendingDays: number;
  totalCreditedDays: number;
  standardPayableDays: number;
  totalEarnedFromDates: number;
  totalDateWiseBaseEarned: number;
  extraAttendancePayout: number;
  calendarAdjustment: number;
  attendanceDeductions: number;
  statutoryDeductions: number;
  pf: number;
  esic: number;
  professionalTax: number;
  tds: number;
  advanceDeduction: number;
  policyDeductions: number;
  totalDeductions: number;
  expenseReimbursement: number;
  commissionEarned: number;
  bonus: number;
  overtime: number;
  totalEarnings: number;
  netSalary: number;
  totalTakeHomePay: number;
  paymentStatus: string;
  reconciled: boolean;
}

export interface DateWiseSalaryResponse {
  summary: DateWiseSalarySummary;
  dates: DateWiseDayRecord[];
}

const pad2 = (n: number) => String(n).padStart(2, '0');

const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const HALF_DAY_SET = new Set(['HALF_DAY', 'HALF-DAY', 'HALFDAY', 'HALF DAY']);
const WORKED_SET = new Set(['PRESENT', 'LATE', 'FULL_DAY', 'HOLIDAY_WORKED', 'WEEKLY_OFF_WORKED']);
const LEAVE_SET = new Set(['LEAVE', 'ON_LEAVE', 'PAID_LEAVE', 'UNPAID_LEAVE', 'PAID']);

function formatTimeIst(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const dateObj = new Date(d);
  if (isNaN(dateObj.getTime())) return null;
  const istDate = new Date(dateObj.getTime() + 5.5 * 60 * 60 * 1000);
  let hours = istDate.getUTCHours();
  const minutes = pad2(istDate.getUTCMinutes());
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  return `${pad2(hours)}:${minutes} ${ampm}`;
}

export class DateWiseSalaryService {
  /**
   * Generates authoritative date-wise salary breakdown for a given employee and payroll period.
   * Uses the exact 30-day salary basis policy: dailySalary = monthlySalary / 30.
   */
  async getDateWiseBreakdown(
    employeeId: number,
    month: number,
    year: number
  ): Promise<DateWiseSalaryResponse> {
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      include: {
        salaryStructure: true,
        office: true,
        department: true,
        user: true,
      },
    });

    if (!employee) {
      throw new Error(`Employee #${employeeId} not found`);
    }

    const targetMonth = Number(month);
    const targetYear = Number(year);
    const monthName = monthNames[targetMonth - 1] || 'Unknown';
    const payPeriod = `${monthName} ${targetYear}`;
    const totalCalendarDays = new Date(targetYear, targetMonth, 0).getDate();
    const monthRange = getIstMonthRange(targetYear, targetMonth);

    // Fetch the authoritative payroll calculation & payslip snapshot
    const calc = await payrollService.calculatePayroll(employeeId, targetMonth, targetYear);
    const storedPayslip = await prisma.payslip.findUnique({
      where: {
        employeeId_month_year: {
          employeeId,
          month: targetMonth,
          year: targetYear,
        },
      },
    });
    const view = await payrollService.resolveFullPayslipView(storedPayslip || (calc as any), employee);

    // Get live attendance snapshot, holidays, and leaves
    const [attendanceRecords, holidays, allLeaves, shiftAssignments] = await Promise.all([
      prisma.attendance.findMany({
        where: {
          employeeId,
          date: { gte: monthRange.startDateStr, lte: monthRange.endDateStr },
        },
        orderBy: { date: 'asc' },
      }),
      prisma.holiday.findMany({
        where: {
          date: { gte: monthRange.monthStart, lte: monthRange.monthEnd },
        },
      }),
      prisma.leaveRequest.findMany({
        where: {
          employeeId,
          fromDate: { lte: monthRange.monthEnd },
          toDate: { gte: monthRange.monthStart },
        },
      }),
      prisma.shiftAssignment.findMany({
        where: {
          employeeId,
          effectiveFrom: { lte: monthRange.monthEnd },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: monthRange.monthStart } }],
        },
        include: { shift: true },
        orderBy: { effectiveFrom: 'desc' },
      }),
    ]);

    const toIstYmd = (d: Date | string) => {
      const ist = new Date(new Date(d).getTime() + 5.5 * 60 * 60 * 1000);
      return `${ist.getUTCFullYear()}-${pad2(ist.getUTCMonth() + 1)}-${pad2(ist.getUTCDate())}`;
    };

    const nowIst = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const todayYmd = `${nowIst.getUTCFullYear()}-${pad2(nowIst.getUTCMonth() + 1)}-${pad2(nowIst.getUTCDate())}`;
    const isPastMonth = `${targetYear}-${pad2(targetMonth)}-${pad2(totalCalendarDays)}` < todayYmd;
    const joiningYmd = employee.joiningDate ? toIstYmd(employee.joiningDate) : null;

    // Working days setup
    const activeShift = shiftAssignments.find((a) => a.shift?.workingDays && a.shift.workingDays.length > 0);
    const configuredWorkingDays =
      activeShift?.shift?.workingDays && activeShift.shift.workingDays.length > 0
        ? activeShift.shift.workingDays
        : employee.office?.workingDays && employee.office.workingDays.length > 0
        ? employee.office.workingDays
        : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const normalizedWorkingDays = new Set(configuredWorkingDays.map(normalizeDayName));

    // Map holidays by YMD string
    const holidayMap = new Map<string, string>();
    for (const h of holidays) {
      holidayMap.set(toIstYmd(h.date), h.name || 'Public Holiday');
    }

    // Map attendance records by date (deduplicating using highest rank)
    const attMap = new Map<string, (typeof attendanceRecords)[number]>();
    for (const rec of attendanceRecords) {
      const existing = attMap.get(rec.date);
      if (!existing) {
        attMap.set(rec.date, rec);
      } else {
        const isBetter =
          (WORKED_SET.has(rec.status?.toUpperCase() || '') && !WORKED_SET.has(existing.status?.toUpperCase() || '')) ||
          (Boolean(rec.checkIn || rec.checkOut) && !existing.checkIn && !existing.checkOut);
        if (isBetter) attMap.set(rec.date, rec);
      }
    }

    // Approved & unapproved leaves mapped
    const leaveList = allLeaves.map((l) => ({
      fromYmd: toIstYmd(l.fromDate),
      toYmd: toIstYmd(l.toDate),
      type: l.type,
      category: l.leaveCategory,
      status: l.status?.toUpperCase() || 'PENDING',
      reason: l.reason,
    }));

    // Authoritative monthly gross & 30-day fixed basis daily rate
    const monthlySalary = view.fixedGrossSalary || calc.monthlySalary || calc.baseSalary || 15000;
    const dailySalary = Math.round((monthlySalary / SALARY_BASIS_DAYS) * 100) / 100;

    // Extra attendance approvals
    const existingApproval = (storedPayslip?.extraAttendanceApproval as {
      dates?: string[];
      rateMultiplier?: number;
      approvedBy?: number;
    } | null) || null;
    const approvedExtraDates = new Set(
      existingApproval?.approvedBy && Array.isArray(existingApproval.dates) ? existingApproval.dates : []
    );
    const extraRateMultiplier = existingApproval?.rateMultiplier ?? 1.0;

    // Generate date records
    const dates: DateWiseDayRecord[] = [];
    let runningPaidLeaves = 0;
    let presentCount = 0;
    let halfDayCount = 0;
    let paidLeaveCount = 0;
    let unpaidLeaveCount = 0;
    let absentCount = 0;
    let weeklyOffCount = 0;
    let weeklyOffWorkedCount = 0;
    let holidayCount = 0;
    let holidayWorkedCount = 0;
    let notJoinedCount = 0;
    let pendingCount = 0;
    let totalDateWiseBaseEarned = 0;
    let totalDateWiseExtraPayout = 0;
    let totalDateWiseDeductions = 0;

    for (let day = 1; day <= totalCalendarDays; day++) {
      const dateStr = `${targetYear}-${pad2(targetMonth)}-${pad2(day)}`;
      const dateObj = new Date(targetYear, targetMonth - 1, day, 12, 0, 0);
      const dayOfWeek = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
      const dateFormatted = `${day} ${monthName.slice(0, 3)} ${targetYear}`;

      // Check shift/working day
      const shiftForDate = shiftAssignments.find(
        (s) => toIstYmd(s.effectiveFrom) <= dateStr && (!s.effectiveTo || dateStr <= toIstYmd(s.effectiveTo))
      );
      const activeWorkingDaysForDate =
        shiftForDate && Array.isArray(shiftForDate.shift.workingDays) && shiftForDate.shift.workingDays.length > 0
          ? new Set(shiftForDate.shift.workingDays.map(normalizeDayName))
          : normalizedWorkingDays;

      const isWeeklyOff = !activeWorkingDaysForDate.has(dayOfWeek);
      const isHoliday = holidayMap.has(dateStr);
      const holidayName = holidayMap.get(dateStr) || null;

      const att = attMap.get(dateStr);
      const attStatus = att?.status?.toUpperCase()?.trim() || '';
      const hasPunch = Boolean(att?.checkIn || att?.checkOut);

      const approvedLeave = leaveList.find(
        (l) => l.status === 'APPROVED' && l.fromYmd <= dateStr && dateStr <= l.toYmd
      );
      const unapprovedLeave = leaveList.find(
        (l) => l.status !== 'APPROVED' && l.fromYmd <= dateStr && dateStr <= l.toYmd
      );

      const isHalfDay = HALF_DAY_SET.has(attStatus);
      const isPresent =
        attStatus === 'PRESENT' ||
        attStatus === 'LATE' ||
        attStatus === 'FULL_DAY' ||
        (hasPunch && attStatus !== 'ABSENT' && !isHalfDay && !attStatus.includes('LEAVE'));
      const isExplicitAbsent = attStatus === 'ABSENT';
      const hasEvidence =
        isPresent ||
        isHalfDay ||
        LEAVE_SET.has(attStatus) ||
        Boolean(approvedLeave) ||
        hasPunch ||
        attStatus === 'HOLIDAY_WORKED' ||
        attStatus === 'WEEKLY_OFF_WORKED';

      const checkInFormatted = formatTimeIst(att?.checkIn);
      const checkOutFormatted = formatTimeIst(att?.checkOut);

      let status: DateWiseDayRecord['status'] = 'PENDING';
      let statusLabel = 'Pending';
      let payableUnits = 0.0;
      let deduction = 0.0;
      let extraPayout = 0.0;
      let earnedAmount = 0.0;
      let notes: string | null = att?.notes || null;
      let isPaidLeave = false;
      let isUnpaid = false;
      let isWorked = false;

      // 1. Not joined yet
      if (joiningYmd && dateStr < joiningYmd && !hasEvidence) {
        status = 'NOT_JOINED';
        statusLabel = 'Not Joined';
        notes = 'Before joining date';
        payableUnits = 0.0;
        deduction = 0.0;
        earnedAmount = 0.0;
        notJoinedCount++;
      }
      // 2. Holiday
      else if (isHoliday) {
        const workedOnHoliday = isPresent || attStatus === 'HOLIDAY_WORKED' || hasPunch;
        if (workedOnHoliday) {
          status = 'HOLIDAY_WORKED';
          statusLabel = 'Holiday (Worked)';
          payableUnits = 1.0;
          extraPayout = dailySalary * 1.0;
          earnedAmount = dailySalary + extraPayout;
          holidayWorkedCount++;
          isWorked = true;
        } else {
          status = 'HOLIDAY';
          statusLabel = 'Holiday';
          payableUnits = 1.0;
          earnedAmount = dailySalary;
          holidayCount++;
        }
        notes = holidayName || 'Public Holiday';
      }
      // 3. Weekly Off
      else if (isWeeklyOff) {
        const workedOnWeeklyOff = isPresent || attStatus === 'WEEKLY_OFF_WORKED' || hasPunch;
        if (workedOnWeeklyOff) {
          status = 'WEEKLY_OFF_WORKED';
          statusLabel = 'Weekly Off (Worked)';
          payableUnits = 1.0;
          extraPayout = dailySalary * 1.0;
          earnedAmount = dailySalary + extraPayout;
          weeklyOffWorkedCount++;
          isWorked = true;
        } else {
          status = 'WEEKLY_OFF';
          statusLabel = 'Weekly Off';
          payableUnits = 1.0;
          earnedAmount = dailySalary;
          weeklyOffCount++;
        }
        notes = 'Weekly Off';
      }
      // 4. Half Day
      else if (isHalfDay) {
        status = 'HALF_DAY';
        statusLabel = 'Half Day';
        payableUnits = 0.5;
        deduction = Math.round(0.5 * dailySalary * 100) / 100;
        earnedAmount = Math.round(0.5 * dailySalary * 100) / 100;
        halfDayCount++;
        isWorked = true;
      }
      // 5. Present
      else if (isPresent) {
        const officeStartTime = employee.office?.workingHoursStart;
        const isLate =
          att?.checkIn && officeStartTime
            ? new Date(att.checkIn).toTimeString().slice(0, 5) > officeStartTime
            : false;
        status = isLate ? 'LATE' : 'PRESENT';
        statusLabel = isLate ? 'Late Present' : 'Present';
        payableUnits = 1.0;
        earnedAmount = dailySalary;
        presentCount++;
        isWorked = true;
      }
      // 6. Approved Leave
      else if (approvedLeave) {
        const isExplicitUnpaid =
          ['UNPAID', 'LOP'].includes(String(approvedLeave.type).toUpperCase()) ||
          String(approvedLeave.category).toUpperCase() === 'UNPAID' ||
          attStatus === 'UNPAID_LEAVE';
        if (isExplicitUnpaid || runningPaidLeaves >= MONTHLY_PAID_LEAVE_LIMIT) {
          status = 'UNPAID_LEAVE';
          statusLabel = 'Unpaid Leave';
          payableUnits = 0.0;
          deduction = dailySalary;
          earnedAmount = 0.0;
          unpaidLeaveCount++;
          isUnpaid = true;
        } else {
          runningPaidLeaves++;
          status = 'PAID_LEAVE';
          statusLabel = 'Paid Leave';
          payableUnits = 1.0;
          earnedAmount = dailySalary;
          paidLeaveCount++;
          isPaidLeave = true;
        }
        notes = approvedLeave.reason || approvedLeave.type || 'Approved Leave';
      }
      // 7. Absent (explicit absent, unapproved leave, or elapsed working day)
      else if (isExplicitAbsent || unapprovedLeave || isPastMonth || dateStr <= todayYmd) {
        status = 'ABSENT';
        statusLabel = 'Absent';
        payableUnits = 0.0;
        deduction = dailySalary;
        earnedAmount = 0.0;
        absentCount++;
        if (unapprovedLeave) {
          notes = `Unapproved Leave (${unapprovedLeave.status})`;
        }
      }
      // 8. Pending future date
      else {
        status = 'PENDING';
        statusLabel = 'Pending';
        payableUnits = 0.0;
        deduction = 0.0;
        earnedAmount = 0.0;
        pendingCount++;
        notes = 'Awaiting attendance';
      }

      // Check if this date has approved extra attendance day payout
      if (approvedExtraDates.has(dateStr) && extraPayout === 0 && isWorked) {
        const extra = Math.round(dailySalary * extraRateMultiplier * 100) / 100;
        extraPayout += extra;
        earnedAmount += extra;
      }

      totalDateWiseBaseEarned += Math.round(payableUnits * dailySalary * 100) / 100;
      totalDateWiseExtraPayout += extraPayout;
      totalDateWiseDeductions += deduction;

      dates.push({
        date: dateStr,
        dayOfWeek,
        dayNumber: day,
        dateFormatted,
        status,
        statusLabel,
        dailySalary,
        payableUnits,
        deduction,
        extraPayout,
        earnedAmount: Math.round(earnedAmount * 100) / 100,
        isPaidLeave,
        isUnpaid,
        isHoliday,
        isWeeklyOff,
        isWorked,
        isHalfDay,
        checkIn: checkInFormatted,
        checkOut: checkOutFormatted,
        notes,
        leaveType: approvedLeave?.type || unapprovedLeave?.type || null,
        leaveReason: approvedLeave?.reason || unapprovedLeave?.reason || null,
        holidayName,
      });
    }

    // 30-Day basis reconciliation
    const creditedDays =
      presentCount +
      halfDayCount * 0.5 +
      paidLeaveCount +
      holidayCount +
      weeklyOffCount +
      holidayWorkedCount +
      weeklyOffWorkedCount;

    const fullyCovered =
      absentCount === 0 &&
      halfDayCount === 0 &&
      unpaidLeaveCount === 0 &&
      notJoinedCount === 0 &&
      pendingCount === 0;

    // In a short month (e.g. Feb 28 days), credit the difference to 30 days
    const shortMonthCredit =
      fullyCovered && totalCalendarDays < SALARY_BASIS_DAYS ? Math.max(0, SALARY_BASIS_DAYS - creditedDays) : 0;
    const standardPayableDays = Math.min(SALARY_BASIS_DAYS, creditedDays + shortMonthCredit);
    const calendarAdjustment = Math.round(shortMonthCredit * dailySalary * 100) / 100;

    // Attributable attendance deductions under fixed 30-day basis
    const attendanceDeductions = Math.round((SALARY_BASIS_DAYS - standardPayableDays) * dailySalary * 100) / 100;

    // Standard earned from dates capped at standardPayableDays * dailySalary
    const totalEarnedFromDates = Math.min(monthlySalary, Math.round(standardPayableDays * dailySalary * 100) / 100);

    // Other monthly components from authoritative payroll service
    const statutoryDeductions = view.statutoryDeductions || (view.pf || 0) + (view.esic || 0) || 0;
    const pf = view.pf || 0;
    const esic = view.esic || 0;
    const professionalTax = view.professionalTax || 0;
    const tds = view.tds || 0;
    const advanceDeduction = view.advanceDeduction || 0;
    const policyDeductions = view.policyDeductions || view.otherDeductions || 0;
    const totalDeductions = view.deductions || view.totalDeductions || attendanceDeductions + statutoryDeductions + advanceDeduction;

    const extraAttendancePayout =
      view.extraHolidayPayout || view.extraWeeklyOffPayout || calc.extraAttendancePayout || totalDateWiseExtraPayout;
    const expenseReimbursement = view.expenseReimbursement || 0;
    const commissionEarned = view.commissionEarned || 0;
    const bonus = view.bonus || 0;
    const overtime = view.overtime || 0;

    const totalEarnings = view.totalEarnings || view.grossEarnings || monthlySalary + extraAttendancePayout + bonus + overtime;
    const netSalary = view.netSalary || Math.max(0, Math.round((totalEarnings - totalDeductions) * 100) / 100);
    const totalTakeHomePay =
      view.totalTakeHomePay || Math.round((netSalary + expenseReimbursement + commissionEarned) * 100) / 100;
    const paymentStatus = view.paymentStatus || storedPayslip?.status || 'PENDING';

    const empName = `${employee.firstName} ${employee.lastName}`.trim();

    const summary: DateWiseSalarySummary = {
      month: targetMonth,
      year: targetYear,
      monthName,
      payPeriod,
      employeeId: employee.id,
      employeeCode: employee.employeeCode,
      employeeName: empName,
      designation: employee.designation || 'Staff',
      department: employee.department?.name || 'General',
      officeName: employee.office?.name || 'Main Office',
      monthlySalary,
      dailySalary,
      salaryBasisDays: SALARY_BASIS_DAYS,
      totalCalendarDays,
      monthWorkingDays: calc.workingDays || 26,
      presentDays: presentCount,
      halfDays: halfDayCount,
      paidLeaveDays: paidLeaveCount,
      unpaidLeaveDays: unpaidLeaveCount,
      absentDays: absentCount,
      weeklyOffDays: weeklyOffCount,
      weeklyOffWorkedDays: weeklyOffWorkedCount,
      holidays: holidayCount,
      holidayWorkedDays: holidayWorkedCount,
      notJoinedDays: notJoinedCount,
      pendingDays: pendingCount,
      totalCreditedDays: creditedDays,
      standardPayableDays,
      totalEarnedFromDates,
      totalDateWiseBaseEarned: Math.round(totalDateWiseBaseEarned * 100) / 100,
      extraAttendancePayout: Math.round(extraAttendancePayout * 100) / 100,
      calendarAdjustment,
      attendanceDeductions,
      statutoryDeductions,
      pf,
      esic,
      professionalTax,
      tds,
      advanceDeduction,
      policyDeductions,
      totalDeductions,
      expenseReimbursement,
      commissionEarned,
      bonus,
      overtime,
      totalEarnings,
      netSalary,
      totalTakeHomePay,
      paymentStatus,
      reconciled: true,
    };

    return {
      summary,
      dates,
    };
  }
}

export const dateWiseSalaryService = new DateWiseSalaryService();
export default dateWiseSalaryService;
