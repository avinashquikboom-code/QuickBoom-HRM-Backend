export type AttendanceDayRecord = {
  date: string;
  status?: string | null;
  checkIn?: Date | string | null;
  checkOut?: Date | string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

export type ApprovedLeaveSpan = {
  fromYmd: string;
  toYmd: string;
  type?: string | null;
  leaveCategory?: string | null;
  status?: string | null;
};

export type ShiftWindow = {
  fromYmd: string;
  toYmd?: string | null;
  startTime: string;
  endTime: string;
  workingDays?: string[];
};

export type AttendanceClassificationInput = {
  year: number;
  month: number;
  workingDayNames: string[];
  holidayYmds: string[];
  records: AttendanceDayRecord[];
  leaves: ApprovedLeaveSpan[];
  todayYmd: string;
  joiningYmd?: string | null;
  officeStartTime?: string | null;
  officeEndTime?: string | null;
  shifts?: ShiftWindow[];
  isLateCheckIn?: (record: AttendanceDayRecord) => boolean;
};

export type AttendanceClassification = {
  payableDayRecords?: Array<{ date: string; units: number; worked: boolean; nonWorkingDay: boolean }>;
  periodStart: string;
  periodEnd: string;
  joiningYmd: string | null;
  totalCalendarDays: number;
  /** Scheduled working days in the whole month; salary divisor is separately fixed at 30. */
  monthWorkingDays: number;
  /** Scheduled working days inside the employment window (on/after joining). */
  scheduledWorkingDays: number;
  presentDays: number;
  absentDays: number;
  halfDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  holidayCount: number;
  weeklyOffCount: number;
  holidayWorkedCount: number;
  weeklyOffWorkedCount: number;
  /** Scheduled working days before the joining date with no attendance/leave record. */
  notJoinedDays: number;
  /** Subset of notJoinedDays that have already elapsed; payroll deducts these like absences. */
  notJoinedElapsedDays: number;
  /** Calendar days before the joining date that were not worked. */
  daysBeforeJoining: number;
  /** Weekly offs / holidays before the joining date (part of daysBeforeJoining). */
  notJoinedWeeklyOffDays: number;
  notJoinedHolidayDays: number;
  /** Scheduled working days in the future with no record yet. */
  remainingWorkingDays: number;
  lateMarks: number;
  overtimeMinutes: number;
};

export type AttendanceSummary = {
  periodStart: string;
  periodEnd: string;
  totalCalendarDays: number;
  /** Total scheduled working days in the entire month (attendance schedule). */
  totalScheduledWorkingDays: number;
  /** Scheduled working days in whole month; salary divisor is separately fixed at 30. */
  monthWorkingDays: number;
  /** Scheduled working days inside employment window (on/after joining). */
  totalWorkingDays: number;
  /** Eligible working days on/after joining date. */
  eligibleWorkingDays: number;
  /** Scheduled working days before joining date. */
  workingDaysBeforeJoining: number;
  /** Scheduled working days before joining date (alias). */
  notJoinedDays: number;
  presentDays: number;
  absentDays: number;
  halfDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  weeklyOffDays: number;
  weeklyOffWorkedDays: number;
  holidays: number;
  holidayWorkedDays: number;
  remainingWorkingDays: number;
  overtimeMinutes: number;
  overtimeLabel: string;
  joiningDate: string | null;
  /** Display rows shared by every salary slip surface. */
  rows: AttendanceSummaryRow[];
};

const pad2 = (n: number) => String(n).padStart(2, '0');

const HALF_DAY = new Set(['HALF_DAY', 'HALF-DAY', 'HALFDAY', 'HALF DAY']);
const WORKED = new Set(['PRESENT', 'LATE', 'FULL_DAY', 'HOLIDAY_WORKED', 'WEEKLY_OFF_WORKED']);
const LEAVE = new Set(['LEAVE', 'ON_LEAVE', 'PAID_LEAVE', 'UNPAID_LEAVE', 'PAID']);

function statusOf(rec: AttendanceDayRecord | undefined): string {
  return String(rec?.status || '').toUpperCase().trim();
}

function hasPunch(rec: AttendanceDayRecord | undefined): boolean {
  return Boolean(rec?.checkIn || rec?.checkOut);
}

/**
 * When several attendance rows exist for one date, keep the most
 * authoritative one (worked > half day > punched > leave > punched absent > placeholder).
 */
function rank(rec: AttendanceDayRecord): number {
  const s = statusOf(rec);
  if (WORKED.has(s)) return 5;
  if (HALF_DAY.has(s)) return 4;
  if (hasPunch(rec) && s !== 'ABSENT') return 3;
  if (LEAVE.has(s)) return 2;
  if (hasPunch(rec) && s === 'ABSENT') return 1;
  return 0;
}

function timeOf(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

export function dedupeAttendanceByDate(records: AttendanceDayRecord[]): Map<string, AttendanceDayRecord> {
  const byDate = new Map<string, AttendanceDayRecord>();
  for (const rec of records) {
    const existing = byDate.get(rec.date);
    if (!existing) {
      byDate.set(rec.date, rec);
      continue;
    }
    const a = rank(existing);
    const b = rank(rec);
    if (b > a) {
      byDate.set(rec.date, rec);
    } else if (b === a) {
      const existingPunches = (existing.checkIn ? 1 : 0) + (existing.checkOut ? 1 : 0);
      const newPunches = (rec.checkIn ? 1 : 0) + (rec.checkOut ? 1 : 0);
      const newer = timeOf(rec.updatedAt || rec.createdAt) > timeOf(existing.updatedAt || existing.createdAt);
      if (newPunches > existingPunches || (newPunches === existingPunches && newer)) {
        byDate.set(rec.date, rec);
      }
    }
  }
  return byDate;
}

function minutesOfDay(hhmm: string | null | undefined): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || '').trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function scheduledShiftMinutes(startTime?: string | null, endTime?: string | null): number {
  const start = minutesOfDay(startTime);
  const end = minutesOfDay(endTime);
  if (start === null || end === null) return 0;
  const span = end >= start ? end - start : end + 24 * 60 - start;
  return span > 0 ? span : 0;
}

/**
 * Overtime for one day = punched duration (check-out minus check-in) beyond
 * the scheduled shift duration. Days without both punches have no overtime.
 */
export function overtimeMinutesForDay(rec: AttendanceDayRecord | undefined, scheduledMinutes: number): number {
  if (!rec?.checkIn || !rec?.checkOut || scheduledMinutes <= 0) return 0;
  const worked = Math.floor((timeOf(rec.checkOut) - timeOf(rec.checkIn)) / 60000);
  return worked > scheduledMinutes ? worked - scheduledMinutes : 0;
}

export function formatOvertime(totalMinutes: number): string {
  const mins = Math.max(0, Math.round(Number(totalMinutes) || 0));
  return `${Math.floor(mins / 60)}h ${pad2(mins % 60)}m`;
}

function shiftMinutesForDate(dateStr: string, input: AttendanceClassificationInput): number {
  const shift = (input.shifts || []).find((s) => s.fromYmd <= dateStr && (!s.toYmd || dateStr <= s.toYmd));
  if (shift) {
    const mins = scheduledShiftMinutes(shift.startTime, shift.endTime);
    if (mins > 0) return mins;
  }
  return scheduledShiftMinutes(input.officeStartTime ?? '09:00', input.officeEndTime ?? '18:00');
}

export function normalizeDayName(d: string): string {
  const s = String(d || '').trim().toLowerCase();
  if (s.startsWith('sun')) return 'Sunday';
  if (s.startsWith('mon')) return 'Monday';
  if (s.startsWith('tue')) return 'Tuesday';
  if (s.startsWith('wed')) return 'Wednesday';
  if (s.startsWith('thu')) return 'Thursday';
  if (s.startsWith('fri')) return 'Friday';
  if (s.startsWith('sat')) return 'Saturday';
  return d;
}

/**
 * Calculate calendar days, weekly off days, holidays, and scheduled working
 * days dynamically from the actual calendar for the selected payroll month.
 * Never hardcodes days or assumes fixed 26, 30, or 31.
 */
export function calculateScheduledWorkingDays(
  year: number,
  month: number,
  workingDayNames?: string[] | null,
  holidayYmds?: string[] | null,
): {
  totalCalendarDays: number;
  workingDays: number;
  weeklyOffDays: number;
  holidayDays: number;
} {
  const totalCalendarDays = new Date(year, month, 0).getDate();
  const rawWorkingDays = (Array.isArray(workingDayNames) && workingDayNames.length > 0)
    ? workingDayNames
    : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const normalizedWorkingDays = new Set(rawWorkingDays.map(normalizeDayName));
  const holidays = new Set((holidayYmds || []).map((h) => String(h).slice(0, 10)));
  const monthPrefix = `${year}-${pad2(month)}`;

  let weeklyOffDays = 0;
  let holidayDays = 0;
  let workingDays = 0;

  for (let day = 1; day <= totalCalendarDays; day++) {
    const dateStr = `${monthPrefix}-${pad2(day)}`;
    const dayName = new Date(year, month - 1, day, 12, 0, 0).toLocaleDateString('en-US', { weekday: 'long' });
    const isWeeklyOff = !normalizedWorkingDays.has(dayName);
    const isHoliday = holidays.has(dateStr);

    if (isHoliday) {
      holidayDays++;
    } else if (isWeeklyOff) {
      weeklyOffDays++;
    } else {
      workingDays++;
    }
  }

  return { totalCalendarDays, workingDays, weeklyOffDays, holidayDays };
}

/**
 * Single attendance classification for a payroll period. Each calendar day
 * lands in exactly one bucket, so attendance and leave never double count.
 * Holidays take priority over weekly offs, and neither is ever an absence.
 */
export function classifyPayrollAttendance(input: AttendanceClassificationInput): AttendanceClassification {
  const { year, month } = input;
  const totalCalendarDays = new Date(year, month, 0).getDate();
  const monthPrefix = `${year}-${pad2(month)}`;
  const periodStart = `${monthPrefix}-01`;
  const periodEnd = `${monthPrefix}-${pad2(totalCalendarDays)}`;
  const isPastMonth = periodEnd < input.todayYmd;
  const holidays = new Set(input.holidayYmds);
  const normalizedWorkingDays = new Set((input.workingDayNames || []).map(normalizeDayName));
  const byDate = dedupeAttendanceByDate(input.records);
  const joiningYmd = input.joiningYmd || null;

  const result: AttendanceClassification = {
    payableDayRecords: [],
    periodStart,
    periodEnd,
    joiningYmd,
    totalCalendarDays,
    monthWorkingDays: 0,
    scheduledWorkingDays: 0,
    presentDays: 0,
    absentDays: 0,
    halfDays: 0,
    paidLeaveDays: 0,
    unpaidLeaveDays: 0,
    holidayCount: 0,
    weeklyOffCount: 0,
    holidayWorkedCount: 0,
    weeklyOffWorkedCount: 0,
    notJoinedDays: 0,
    notJoinedElapsedDays: 0,
    daysBeforeJoining: 0,
    notJoinedWeeklyOffDays: 0,
    notJoinedHolidayDays: 0,
    remainingWorkingDays: 0,
    lateMarks: 0,
    overtimeMinutes: 0,
  };

  for (let day = 1; day <= totalCalendarDays; day++) {
    const dateStr = `${monthPrefix}-${pad2(day)}`;
    const dayName = new Date(year, month - 1, day, 12, 0, 0).toLocaleDateString('en-US', { weekday: 'long' });

    const shift = (input.shifts || []).find((s) => s.fromYmd <= dateStr && (!s.toYmd || dateStr <= s.toYmd));
    const activeWorkingDays = (shift && Array.isArray(shift.workingDays) && shift.workingDays.length > 0)
      ? new Set(shift.workingDays.map(normalizeDayName))
      : normalizedWorkingDays;

    const isWeeklyOff = !activeWorkingDays.has(dayName);
    const isHoliday = holidays.has(dateStr);
    if (!isHoliday && !isWeeklyOff) result.monthWorkingDays++;

    const att = byDate.get(dateStr);
    const approvedLeave = input.leaves.find(
      (l) => (!l.status || l.status.toUpperCase() === 'APPROVED') && l.fromYmd <= dateStr && dateStr <= l.toYmd,
    );
    const unapprovedLeave = input.leaves.find(
      (l) => Boolean(l.status && l.status.toUpperCase() !== 'APPROVED') && l.fromYmd <= dateStr && dateStr <= l.toYmd,
    );
    const status = statusOf(att);
    const punched = hasPunch(att);
    const isHalfDay = HALF_DAY.has(status);
    const isPresent =
      status === 'PRESENT' || status === 'LATE' || status === 'FULL_DAY' ||
      (punched && status !== 'ABSENT' && !isHalfDay && !status.includes('LEAVE'));
    const isLeaveStatus = LEAVE.has(status) && !unapprovedLeave;
    const isExplicitAbsent = status === 'ABSENT';
    const hasEvidence = isPresent || isHalfDay || isLeaveStatus || Boolean(approvedLeave) || punched ||
      status === 'HOLIDAY_WORKED' || status === 'WEEKLY_OFF_WORKED';

    if (joiningYmd && dateStr < joiningYmd && !hasEvidence) {
      result.daysBeforeJoining++;
      if (isHoliday) {
        result.notJoinedHolidayDays++;
      } else if (isWeeklyOff) {
        result.notJoinedWeeklyOffDays++;
      } else {
        result.notJoinedDays++;
        if (isExplicitAbsent || isPastMonth || dateStr <= input.todayYmd) {
          result.notJoinedElapsedDays++;
        }
      }
      continue;
    }

    const shiftMinutes = shiftMinutesForDate(dateStr, input);
    result.overtimeMinutes += overtimeMinutesForDay(att, shiftMinutes);

    if (isHoliday) {
      result.payableDayRecords!.push({ date: dateStr, units: 1, worked: isPresent || status === 'HOLIDAY_WORKED' || punched, nonWorkingDay: true });
      if (isPresent || status === 'HOLIDAY_WORKED' || punched) result.holidayWorkedCount++;
      else result.holidayCount++;
      continue;
    }
    if (isWeeklyOff) {
      result.payableDayRecords!.push({ date: dateStr, units: 1, worked: isPresent || status === 'WEEKLY_OFF_WORKED' || punched, nonWorkingDay: true });
      if (isPresent || status === 'WEEKLY_OFF_WORKED' || punched) result.weeklyOffWorkedCount++;
      else result.weeklyOffCount++;
      continue;
    }

    result.scheduledWorkingDays++;
    if (isHalfDay) {
      result.halfDays++;
      result.payableDayRecords!.push({ date: dateStr, units: 0.5, worked: true, nonWorkingDay: false });
    } else if (isPresent) {
      result.presentDays++;
      result.payableDayRecords!.push({ date: dateStr, units: 1, worked: true, nonWorkingDay: false });
      if (att && input.isLateCheckIn?.(att)) result.lateMarks++;
    } else if (approvedLeave) {
      const isUnpaid =
        (approvedLeave && (['UNPAID', 'LOP'].includes(String(approvedLeave.type).toUpperCase()) || String(approvedLeave.leaveCategory).toUpperCase() === 'UNPAID')) ||
        status === 'UNPAID_LEAVE';
      if (isUnpaid || result.paidLeaveDays >= 4) result.unpaidLeaveDays++;
      else {
        result.paidLeaveDays++;
        result.payableDayRecords!.push({ date: dateStr, units: 1, worked: false, nonWorkingDay: false });
      }
    } else if (isExplicitAbsent || isPastMonth || dateStr <= input.todayYmd) {
      result.absentDays++;
    } else {
      result.remainingWorkingDays++;
    }
  }

  return result;
}

/** Display summary straight from a live classification. */
export function attendanceSummaryFromClassification(c: AttendanceClassification): AttendanceSummary {
  const totalWeeklyOffDays = c.weeklyOffCount + c.weeklyOffWorkedCount + c.notJoinedWeeklyOffDays;
  const totalHolidays = c.holidayCount + c.holidayWorkedCount + c.notJoinedHolidayDays;
  return withRows({
    periodStart: c.periodStart,
    periodEnd: c.periodEnd,
    totalCalendarDays: c.totalCalendarDays,
    totalScheduledWorkingDays: c.monthWorkingDays,
    monthWorkingDays: c.monthWorkingDays,
    totalWorkingDays: c.scheduledWorkingDays,
    eligibleWorkingDays: c.scheduledWorkingDays,
    workingDaysBeforeJoining: c.notJoinedDays,
    notJoinedDays: c.notJoinedDays,
    presentDays: c.presentDays,
    absentDays: c.absentDays,
    halfDays: c.halfDays,
    paidLeaveDays: c.paidLeaveDays,
    unpaidLeaveDays: c.unpaidLeaveDays,
    weeklyOffDays: totalWeeklyOffDays,
    weeklyOffWorkedDays: c.weeklyOffWorkedCount,
    holidays: totalHolidays,
    holidayWorkedDays: c.holidayWorkedCount,
    remainingWorkingDays: c.remainingWorkingDays,
    overtimeMinutes: c.overtimeMinutes,
    overtimeLabel: formatOvertime(c.overtimeMinutes),
    joiningDate: c.joiningYmd,
  });
}

/**
 * Summary for a finalized (PAID) payslip: day counts come from the stored
 * payslip row that was paid. Stored absent / weekly off / holiday counts cover
 * the whole month (pre-joining absences were deducted), so the days before
 * joining are split out for display.
 */
export function attendanceSummaryFromStoredPayslip(
  stored: {
    workingDays?: number | null;
    totalCalendarDays?: number | null;
    presentDays?: number | null;
    absentDays?: number | null;
    halfDays?: number | null;
    paidLeaveDays?: number | null;
    unpaidLeaveDays?: number | null;
    holidayCount?: number | null;
    weeklyOffCount?: number | null;
    holidayWorkedCount?: number | null;
    weeklyOffWorkedCount?: number | null;
  },
  live: AttendanceClassification,
): AttendanceSummary {
  const n = (v: number | null | undefined) => Math.max(0, Math.round(Number(v) || 0));
  const monthWorkingDays = n(stored.workingDays) || live.monthWorkingDays;
  const eligibleWorkingDays = Math.max(0, monthWorkingDays - live.notJoinedDays);
  const presentDays = n(stored.presentDays);
  const halfDays = n(stored.halfDays);
  const paidLeaveDays = n(stored.paidLeaveDays);
  const unpaidLeaveDays = n(stored.unpaidLeaveDays);
  const absentDays = Math.max(0, n(stored.absentDays) - live.notJoinedElapsedDays);
  const accounted = presentDays + halfDays + paidLeaveDays + unpaidLeaveDays + absentDays;
  const weeklyOffWorked = n(stored.weeklyOffWorkedCount);
  const holidayWorked = n(stored.holidayWorkedCount);
  const totalWeeklyOffDays = n(stored.weeklyOffCount) || (live.weeklyOffCount + live.weeklyOffWorkedCount + live.notJoinedWeeklyOffDays);
  const totalHolidays = n(stored.holidayCount) || (live.holidayCount + live.holidayWorkedCount + live.notJoinedHolidayDays);
  return withRows({
    periodStart: live.periodStart,
    periodEnd: live.periodEnd,
    totalCalendarDays: n(stored.totalCalendarDays) || live.totalCalendarDays,
    totalScheduledWorkingDays: monthWorkingDays,
    monthWorkingDays,
    totalWorkingDays: eligibleWorkingDays,
    eligibleWorkingDays,
    workingDaysBeforeJoining: live.notJoinedDays,
    notJoinedDays: live.notJoinedDays,
    presentDays,
    absentDays,
    halfDays,
    paidLeaveDays,
    unpaidLeaveDays,
    weeklyOffDays: totalWeeklyOffDays,
    weeklyOffWorkedDays: weeklyOffWorked,
    holidays: totalHolidays,
    holidayWorkedDays: holidayWorked,
    remainingWorkingDays: Math.max(0, eligibleWorkingDays - accounted),
    overtimeMinutes: live.overtimeMinutes,
    overtimeLabel: formatOvertime(live.overtimeMinutes),
    joiningDate: live.joiningYmd,
  });
}

export type AttendanceSummaryRow = { label: string; value: string };

function withRows(s: Omit<AttendanceSummary, 'rows'>): AttendanceSummary {
  return { ...s, rows: attendanceSummaryRows(s) };
}

/** Rows rendered by every salary slip surface (PDFs, Admin, mobile). */
export function attendanceSummaryRows(s: Omit<AttendanceSummary, 'rows'>): AttendanceSummaryRow[] {
  const rows: AttendanceSummaryRow[] = [
    { label: 'Total Calendar Days', value: String(s.totalCalendarDays) },
    { label: 'Total Scheduled Working Days', value: String(s.totalScheduledWorkingDays ?? s.monthWorkingDays ?? s.totalWorkingDays) },
    {
      label: 'Weekly Off Days',
      value: s.weeklyOffWorkedDays > 0 ? `${s.weeklyOffDays} (${s.weeklyOffWorkedDays} worked)` : String(s.weeklyOffDays),
    },
    {
      label: 'Holidays',
      value: s.holidayWorkedDays > 0 ? `${s.holidays} (${s.holidayWorkedDays} worked)` : String(s.holidays),
    },
    { label: 'Working Days Before Joining', value: String(s.workingDaysBeforeJoining ?? s.notJoinedDays ?? 0) },
    { label: 'Eligible Working Days After Joining', value: String(s.eligibleWorkingDays ?? s.totalWorkingDays) },
    { label: 'Present Days', value: String(s.presentDays) },
    { label: 'Absent Days', value: String(s.absentDays) },
    { label: 'Half Days', value: String(s.halfDays) },
    { label: 'Paid Leave Days', value: String(s.paidLeaveDays) },
    { label: 'Unpaid Leave Days', value: String(s.unpaidLeaveDays) },
    { label: 'Remaining Working Days', value: String(s.remainingWorkingDays) },
    { label: 'Overtime Hours', value: s.overtimeLabel },
  ];
  return rows;
}
