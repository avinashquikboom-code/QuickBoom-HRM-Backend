import assert from 'assert';
import {
  AttendanceClassification,
  AttendanceClassificationInput,
  AttendanceDayRecord,
  ApprovedLeaveSpan,
  attendanceSummaryFromClassification,
  attendanceSummaryFromStoredPayslip,
  classifyPayrollAttendance,
  formatOvertime,
  calculateScheduledWorkingDays,
  normalizeDayName,
} from '../src/utils/attendanceSummary';
import { absentDeductionLabel } from '../src/utils/attendanceSummaryPdf';
import { computePayrollSettlement } from '../src/utils/salaryGross';

function check(desc: string, cond: boolean) {
  assert.ok(cond, desc);
  console.log(`PASS ${desc}`);
}

const MON_SAT = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TODAY = '2026-10-11';
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const dayName = (y: number, m: number, d: number) =>
  new Date(y, m - 1, d, 12, 0, 0).toLocaleDateString('en-US', { weekday: 'long' });
const daysIn = (y: number, m: number) => new Date(y, m, 0).getDate();
const isWorking = (y: number, m: number, d: number, holidays: string[] = []) =>
  MON_SAT.includes(dayName(y, m, d)) && !holidays.includes(ymd(y, m, d));
const ist = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);

function rec(date: string, status: string, inAt?: string, outAt?: string): AttendanceDayRecord {
  return {
    date,
    status,
    checkIn: inAt ? ist(date, inAt) : null,
    checkOut: outAt ? ist(date, outAt) : null,
  };
}

function classify(partial: Partial<AttendanceClassificationInput> & { year: number; month: number }) {
  return classifyPayrollAttendance({
    workingDayNames: MON_SAT,
    holidayYmds: [],
    records: [],
    leaves: [],
    todayYmd: TODAY,
    officeStartTime: '09:00',
    officeEndTime: '18:00',
    ...partial,
  });
}

/** Every calendar day lands in exactly one bucket. */
function assertReconciles(label: string, c: AttendanceClassification) {
  const accounted = c.presentDays + c.halfDays + c.paidLeaveDays + c.unpaidLeaveDays + c.absentDays + c.remainingWorkingDays;
  check(`${label}: day buckets sum to scheduled working days`, accounted === c.scheduledWorkingDays);
  check(`${label}: scheduled + not-joined = month working days`, c.scheduledWorkingDays + c.notJoinedDays === c.monthWorkingDays);
  const calendar = c.scheduledWorkingDays + c.weeklyOffCount + c.weeklyOffWorkedCount +
    c.holidayCount + c.holidayWorkedCount + c.daysBeforeJoining;
  check(`${label}: all calendar days accounted for`, calendar === c.totalCalendarDays);
  const s = attendanceSummaryFromClassification(c);
  check(`${label}: summary working days < calendar days when offs exist`,
    s.totalWorkingDays <= s.totalCalendarDays);
}

/** The pre-change payroll attendance loop, kept verbatim as the regression reference. */
function legacyPayrollCounts(input: AttendanceClassificationInput) {
  const { year, month } = input;
  const total = daysIn(year, month);
  const byDate = new Map<string, AttendanceDayRecord>();
  for (const r of input.records) byDate.set(r.date, r);
  const isPastMonth = ymd(year, month, total) < input.todayYmd;
  const out = { scheduled: 0, present: 0, half: 0, paid: 0, unpaid: 0, absent: 0, holiday: 0, weeklyOff: 0, holidayWorked: 0, weeklyOffWorked: 0 };
  for (let day = 1; day <= total; day++) {
    const dateStr = ymd(year, month, day);
    const isWeeklyOff = !input.workingDayNames.includes(dayName(year, month, day));
    const isHoliday = input.holidayYmds.includes(dateStr);
    const att = byDate.get(dateStr);
    const leave = input.leaves.find((l) => l.fromYmd <= dateStr && dateStr <= l.toYmd);
    const raw = String(att?.status || '').toUpperCase().trim();
    const hasPunch = Boolean(att?.checkIn || att?.checkOut);
    const isHalf = ['HALF_DAY', 'HALF-DAY', 'HALFDAY', 'HALF DAY'].includes(raw);
    const isPresent = raw === 'PRESENT' || raw === 'LATE' || raw === 'FULL_DAY' || (hasPunch && raw !== 'ABSENT' && !isHalf && !raw.includes('LEAVE'));
    const isLeaveStatus = ['LEAVE', 'ON_LEAVE', 'PAID_LEAVE', 'UNPAID_LEAVE', 'PAID'].includes(raw);
    if (isHoliday) {
      if (isPresent || raw === 'HOLIDAY_WORKED' || hasPunch) out.holidayWorked++; else out.holiday++;
    } else if (isWeeklyOff) {
      if (isPresent || raw === 'WEEKLY_OFF_WORKED' || hasPunch) out.weeklyOffWorked++; else out.weeklyOff++;
    } else {
      out.scheduled++;
      if (isHalf) out.half++;
      else if (isPresent) out.present++;
      else if (leave || isLeaveStatus) {
        const unpaid = (leave && (leave.type === 'UNPAID' || leave.type === 'LOP' || leave.leaveCategory === 'UNPAID')) || raw === 'UNPAID_LEAVE';
        if (unpaid) out.unpaid++; else out.paid++;
      } else if (raw === 'ABSENT') out.absent++;
      else if (isPastMonth || dateStr <= input.todayYmd) out.absent++;
    }
  }
  return out;
}

function run() {
  // March 2026: 31 days, 5 Sundays -> 26 scheduled working days (Mon–Sat office).
  const Y = 2026;
  const M = 3;
  const marchWorking = Array.from({ length: 31 }, (_, i) => i + 1).filter((d) => isWorking(Y, M, d));
  check('March 2026 has 26 working days and 31 calendar days', marchWorking.length === 26);

  // 1. Full attendance
  {
    const c = classify({ year: Y, month: M, records: marchWorking.map((d) => rec(ymd(Y, M, d), 'PRESENT', '09:00', '18:00')) });
    check('full attendance: 26 present', c.presentDays === 26);
    check('full attendance: 0 absent', c.absentDays === 0);
    check('full attendance: 5 weekly offs, never absences', c.weeklyOffCount === 5);
    const s = attendanceSummaryFromClassification(c);
    check('full attendance: total working days 26 (not calendar 31)', s.totalWorkingDays === 26 && s.totalCalendarDays === 31);
    check('full attendance: no overtime for exact shift hours', s.overtimeLabel === '0h 00m');
    assertReconciles('full attendance', c);
  }

  // 2. Absences and half-days
  {
    const records = marchWorking.slice(0, 20).map((d) => rec(ymd(Y, M, d), 'PRESENT', '09:00', '18:00'));
    records.push(rec(ymd(Y, M, marchWorking[20]), 'HALF_DAY', '09:00', '13:00'));
    records.push(rec(ymd(Y, M, marchWorking[21]), 'HALF_DAY', '09:00', '13:00'));
    records.push(rec(ymd(Y, M, marchWorking[22]), 'ABSENT'));
    const c = classify({ year: Y, month: M, records });
    check('absences: 20 present', c.presentDays === 20);
    check('absences: 2 half days', c.halfDays === 2);
    check('absences: 1 explicit + 3 unrecorded past days = 4 absent', c.absentDays === 4);
    assertReconciles('absences', c);
  }

  // 3. Paid and unpaid leave, with attendance/leave overlap
  {
    const leaves: ApprovedLeaveSpan[] = [
      { fromYmd: '2026-03-09', toYmd: '2026-03-10', type: 'CASUAL' },
      { fromYmd: '2026-03-11', toYmd: '2026-03-11', type: 'UNPAID' },
      { fromYmd: '2026-03-13', toYmd: '2026-03-13', type: 'SICK', leaveCategory: 'UNPAID' },
    ];
    const records = marchWorking
      .filter((d) => ![10, 11, 12, 13].includes(d))
      .map((d) => rec(ymd(Y, M, d), 'PRESENT', '09:00', '18:00'));
    records.push(rec('2026-03-12', 'UNPAID_LEAVE'));
    const c = classify({ year: Y, month: M, records, leaves });
    check('leave: day 9 has both attendance and leave -> counted once as present', c.presentDays === 22);
    check('leave: 1 paid leave day (day 10)', c.paidLeaveDays === 1);
    check('leave: 3 unpaid (UNPAID type, UNPAID_LEAVE status, UNPAID category)', c.unpaidLeaveDays === 3);
    check('leave: no absences', c.absentDays === 0);
    assertReconciles('leave', c);
  }

  // 4. Weekly offs and holidays are never absences
  {
    const holidays = ['2026-03-04', '2026-03-05'];
    const records = [
      rec('2026-03-05', 'PRESENT', '09:00', '18:00'),
      rec('2026-03-08', 'PRESENT', '09:00', '18:00'), // Sunday
    ];
    const c = classify({ year: Y, month: M, records, holidayYmds: holidays });
    check('offs: 2 holidays, 1 worked', c.holidayCount === 1 && c.holidayWorkedCount === 1);
    check('offs: 5 weekly offs, 1 worked', c.weeklyOffCount === 4 && c.weeklyOffWorkedCount === 1);
    check('offs: 24 scheduled working days, all absent', c.scheduledWorkingDays === 24 && c.absentDays === 24);
    const s = attendanceSummaryFromClassification(c);
    const row = (label: string) => s.rows.find((r) => r.label === label)?.value;
    check('offs: summary rows show worked counts', row('Weekly Off Days') === '5 (1 worked)' && row('Holidays') === '2 (1 worked)');
    assertReconciles('offs', c);
  }

  // 5. Overtime from punches beyond the scheduled shift
  {
    const records = [
      rec('2026-03-02', 'PRESENT', '09:00', '20:30'), // +150 vs 9h office shift
      rec('2026-03-03', 'PRESENT', '09:00', '18:00'), // 0
      rec('2026-03-04', 'PRESENT', '09:00'), // no check-out -> 0
      rec('2026-03-05', 'PRESENT', '10:00', '15:00'), // +60 vs 4h assigned shift
      rec('2026-03-06', 'PRESENT', '20:00', '07:00'), // overnight shift 22:00-06:00 (480) -> +180
    ];
    records[4].checkOut = ist('2026-03-07', '07:00');
    const c = classify({
      year: Y,
      month: M,
      records,
      shifts: [
        { fromYmd: '2026-03-05', toYmd: '2026-03-05', startTime: '10:00', endTime: '14:00' },
        { fromYmd: '2026-03-06', toYmd: '2026-03-06', startTime: '22:00', endTime: '06:00' },
      ],
    });
    check('overtime: 150 + 60 + 180 = 390 minutes', c.overtimeMinutes === 390);
    check('overtime: formatted as 6h 30m', attendanceSummaryFromClassification(c).overtimeLabel === '6h 30m');
    check('overtime format: 330 minutes -> 5h 30m', formatOvertime(330) === '5h 30m');
  }

  // 6. Mid-month joining (joined Monday 16 March)
  {
    const joined = '2026-03-16';
    const records = marchWorking.filter((d) => d >= 16).map((d) => rec(ymd(Y, M, d), 'PRESENT', '09:00', '18:00'));
    const c = classify({ year: Y, month: M, records, joiningYmd: joined });
    check('joining: 14 scheduled working days after joining', c.scheduledWorkingDays === 14 && c.presentDays === 14);
    check('joining: 12 working days before joining are not absences', c.absentDays === 0 && c.notJoinedDays === 12);
    check('joining: 3 Sundays before joining split out', c.notJoinedWeeklyOffDays === 3 && c.weeklyOffCount === 2);
    check('joining: payroll still divides by full-month working days', c.monthWorkingDays === 26);
    check('joining: payroll absent count unchanged (12 deducted as before)', c.absentDays + c.notJoinedElapsedDays === 12);
    const s = attendanceSummaryFromClassification(c);
    check('joining: summary total working days 14', s.totalWorkingDays === 14);
    check('joining: summary lists days before joining', s.rows.some((r) => r.label === 'Working Days Before Joining' && r.value === '12'));
    check('joining: absent deduction label explains the split',
      absentDeductionLabel(12, s) === 'Absent Deduction (0 absent + 12 before joining)');
    assertReconciles('joining', c);

    // Same employee, PAID payslip stored with whole-month counts.
    const stored = attendanceSummaryFromStoredPayslip(
      { workingDays: 26, totalCalendarDays: 31, presentDays: 14, absentDays: 12, weeklyOffCount: 5, holidayCount: 0 },
      c,
    );
    check('joining (PAID): stored summary matches live summary',
      stored.totalWorkingDays === 14 && stored.absentDays === 0 && stored.weeklyOffDays === 5 && stored.remainingWorkingDays === 0);
  }

  // 7. Attendance recorded before the joining date still counts (no evidence is discarded)
  {
    const c = classify({ year: Y, month: M, joiningYmd: '2026-03-20', records: [rec('2026-03-18', 'PRESENT', '09:00', '18:00')] });
    check('pre-join evidence: day with attendance before joining date is counted present', c.presentDays === 1);
    assertReconciles('pre-join evidence', c);
  }

  // 8. No records: past month -> all absent; current month -> future days remaining
  {
    const past = classify({ year: Y, month: M });
    check('no records (past month): 26 absent', past.absentDays === 26 && past.remainingWorkingDays === 0);
    assertReconciles('no records past', past);
    const current = classify({ year: 2026, month: 10 });
    const elapsed = Array.from({ length: 11 }, (_, i) => i + 1).filter((d) => isWorking(2026, 10, d)).length;
    const octWorking = Array.from({ length: 31 }, (_, i) => i + 1).filter((d) => isWorking(2026, 10, d)).length;
    check('no records (current month): elapsed days absent', current.absentDays === elapsed);
    check('no records (current month): future days remaining, not absent', current.remainingWorkingDays === octWorking - elapsed);
    assertReconciles('no records current', current);
  }

  // 9. Month-end / different period lengths & Dynamic Calendar Calculation
  {
    const feb = classify({ year: 2026, month: 2 });
    check('Feb 2026: 28 calendar days, 24 working days', feb.totalCalendarDays === 28 && feb.monthWorkingDays === 24);
    check('Feb 2026: period ends on the 28th', feb.periodEnd === '2026-02-28');
    const leapFeb = classify({ year: 2028, month: 2, todayYmd: '2028-03-05' });
    check('Feb 2028 (leap): 29 calendar days', leapFeb.totalCalendarDays === 29 && leapFeb.periodEnd === '2028-02-29');
    const apr = classify({ year: 2026, month: 4 });
    check('Apr 2026: 30 calendar days', apr.totalCalendarDays === 30);
    assertReconciles('Feb 2026', feb);
    assertReconciles('Apr 2026', apr);

    // Dynamic Calendar Function Checks
    const oct2026 = calculateScheduledWorkingDays(2026, 10, MON_SAT);
    check('Oct 2026: 31 calendar days', oct2026.totalCalendarDays === 31);
    check('Oct 2026: 4 weekly offs (Sundays 4, 11, 18, 25)', oct2026.weeklyOffDays === 4);
    check('Oct 2026: 27 working days before public holidays', oct2026.workingDays === 27);

    const feb2026Cal = calculateScheduledWorkingDays(2026, 2, MON_SAT);
    check('Feb 2026: 28 calendar days', feb2026Cal.totalCalendarDays === 28);
    check('Feb 2026: 4 weekly offs', feb2026Cal.weeklyOffDays === 4);
    check('Feb 2026: 24 working days', feb2026Cal.workingDays === 24);

    const feb2024Cal = calculateScheduledWorkingDays(2024, 2, MON_SAT);
    check('Feb 2024 (leap): 29 calendar days', feb2024Cal.totalCalendarDays === 29);
    check('Feb 2024 (leap): 4 weekly offs', feb2024Cal.weeklyOffDays === 4);
    check('Feb 2024 (leap): 25 working days', feb2024Cal.workingDays === 25);

    const apr2026Cal = calculateScheduledWorkingDays(2026, 4, MON_SAT);
    check('Apr 2026: 30 calendar days', apr2026Cal.totalCalendarDays === 30);
    check('Apr 2026: 4 weekly offs', apr2026Cal.weeklyOffDays === 4);
    check('Apr 2026: 26 working days', apr2026Cal.workingDays === 26);

    // 5-day work week (Monday - Friday)
    const MON_FRI = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const oct2026MonFri = calculateScheduledWorkingDays(2026, 10, MON_FRI);
    check('Oct 2026 (5-day week): 9 weekly offs (5 Sat + 4 Sun)', oct2026MonFri.weeklyOffDays === 9);
    check('Oct 2026 (5-day week): 22 working days', oct2026MonFri.workingDays === 22);

    // Public holiday deduction check
    const octWithHoliday = calculateScheduledWorkingDays(2026, 10, MON_SAT, ['2026-10-02']);
    check('Oct 2026 with Oct 2 holiday: 1 holiday', octWithHoliday.holidayDays === 1);
    check('Oct 2026 with Oct 2 holiday: 26 working days', octWithHoliday.workingDays === 26);
  }

  // 10. Salary amounts are unaffected: settlement for the earlier example still reconciles.
  {
    const settlement = computePayrollSettlement({
      baseGrossEarnings: 14000,
      holidayWeeklyOffPay: 1272.72,
      totalDeductions: 636.36,
    });
    check('salary unchanged: gross 15272.72', settlement.totalEarnings === 15272.72);
    check('salary unchanged: net 14636.36', settlement.netSalary === 14636.36);
  }

  // 11. Randomized regression: payroll-facing counts equal the pre-change algorithm.
  {
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const statuses = ['PRESENT', 'LATE', 'HALF_DAY', 'ABSENT', 'PAID_LEAVE', 'UNPAID_LEAVE', 'HOLIDAY_WORKED', ''];
    let mismatches = 0;
    for (let iter = 0; iter < 400; iter++) {
      const year = 2025 + Math.floor(rand() * 2);
      const month = 1 + Math.floor(rand() * 12);
      const total = daysIn(year, month);
      const records: AttendanceDayRecord[] = [];
      const holidayYmds: string[] = [];
      const leaves: ApprovedLeaveSpan[] = [];
      for (let d = 1; d <= total; d++) {
        const date = ymd(year, month, d);
        if (rand() < 0.06) holidayYmds.push(date);
        if (rand() < 0.7) {
          const status = statuses[Math.floor(rand() * statuses.length)];
          const punched = rand() < 0.5;
          records.push(rec(date, status, punched ? '09:10' : undefined, punched && rand() < 0.8 ? '18:40' : undefined));
        }
        if (rand() < 0.05) leaves.push({ fromYmd: date, toYmd: date, type: rand() < 0.5 ? 'UNPAID' : 'CASUAL' });
      }
      const joiningYmd = rand() < 0.4 ? ymd(year, month, 1 + Math.floor(rand() * total)) : null;
      const input: AttendanceClassificationInput = {
        year, month, workingDayNames: MON_SAT, holidayYmds, records, leaves,
        todayYmd: rand() < 0.3 ? ymd(year, month, 1 + Math.floor(rand() * total)) : TODAY,
        joiningYmd,
      };
      const legacy = legacyPayrollCounts(input);
      const c = classifyPayrollAttendance(input);
      const same =
        legacy.scheduled === c.monthWorkingDays &&
        legacy.present === c.presentDays &&
        legacy.half === c.halfDays &&
        legacy.paid === c.paidLeaveDays &&
        legacy.unpaid === c.unpaidLeaveDays &&
        legacy.absent === c.absentDays + c.notJoinedElapsedDays &&
        legacy.holiday === c.holidayCount + c.notJoinedHolidayDays &&
        legacy.weeklyOff === c.weeklyOffCount + c.notJoinedWeeklyOffDays &&
        legacy.holidayWorked === c.holidayWorkedCount &&
        legacy.weeklyOffWorked === c.weeklyOffWorkedCount;
      if (!same) {
        mismatches++;
        if (mismatches === 1) console.error('First mismatch', JSON.stringify({ input: { year, month, joiningYmd }, legacy, c }));
      }
      const accounted = c.presentDays + c.halfDays + c.paidLeaveDays + c.unpaidLeaveDays + c.absentDays + c.remainingWorkingDays;
      if (accounted !== c.scheduledWorkingDays) mismatches++;
    }
    check('randomized: 400 scenarios match pre-change payroll counts and reconcile', mismatches === 0);
  }

  // 12. All 12 attendance fields are present in exact specified order
  {
    const feb = classify({ year: 2026, month: 2 });
    const s = attendanceSummaryFromClassification(feb);
    const expectedLabels = [
      'Total Calendar Days',
      'Total Working Days',
      'Present Days',
      'Absent Days',
      'Half Days',
      'Paid Leave Days',
      'Unpaid Leave Days',
      'Weekly Off Days',
      'Holidays',
      'Overtime Hours',
      'Working Days Before Joining',
      'Remaining Working Days',
    ];
    check('attendance summary has exactly 12 rows', s.rows.length === 12);
    for (let i = 0; i < expectedLabels.length; i++) {
      check(`attendance row ${i + 1} is ${expectedLabels[i]}`, s.rows[i].label === expectedLabels[i]);
    }
  }

  console.log('\nAll attendance summary tests passed.');
}

run();

