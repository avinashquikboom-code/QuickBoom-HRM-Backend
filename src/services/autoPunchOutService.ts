import cron from 'node-cron';
import { prisma } from '../utils/db';
import auditLogService from './auditLogService';

/**
 * Helper to get current date in YYYY-MM-DD format for Asia/Kolkata timezone
 */
export function getTodayISTDateString(): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date()); // Returns 'YYYY-MM-DD'
  } catch {
    return new Date().toISOString().split('T')[0];
  }
}

/**
 * Creates a Date object representing 23:59:00 IST on the given YYYY-MM-DD date.
 */
export function getAutoPunchOutTimestamp(dateStr: string): Date {
  // Use ISO string with explicit IST (+05:30) offset
  return new Date(`${dateStr}T23:59:00+05:30`);
}

export interface AutoPunchOutResult {
  success: boolean;
  date: string;
  processedCount: number;
  skippedCount: number;
  details: Array<{
    attendanceId: number;
    employeeId: number;
    status: string;
    checkOut: string;
  }>;
}

/**
 * Executes automatic punch-out for employees who checked in on the target date
 * but forgot to punch out (checkIn != null and checkOut == null).
 * 
 * Business Rules:
 * - checkIn != null AND checkOut == null -> checkOut set to 23:59:00 on same date, status set to HALF_DAY.
 * - If employee already has a checkOut (manual or previous run) -> DO NOTHING.
 * - If employee never checked in (no check-in / absent) -> DO NOTHING.
 * - Idempotent and concurrency-safe via atomic DB conditional update.
 */
export async function performAutoPunchOut(targetDate?: string): Promise<AutoPunchOutResult> {
  const dateStr = targetDate || getTodayISTDateString();
  const autoPunchOutTime = getAutoPunchOutTimestamp(dateStr);

  console.log(`🔄 [Auto Punch-Out] Starting job for date: ${dateStr} (Auto punch-out timestamp: ${autoPunchOutTime.toISOString()})`);

  // Find all attendance records for this date with checkIn but no checkOut
  const pendingAttendances = await prisma.attendance.findMany({
    where: {
      date: dateStr,
      checkIn: { not: null },
      checkOut: null,
    },
    include: {
      employee: {
        select: {
          id: true,
          employeeCode: true,
          firstName: true,
          lastName: true,
          userId: true,
        },
      },
    },
  });

  const details: AutoPunchOutResult['details'] = [];
  let processedCount = 0;
  let skippedCount = 0;

  for (const att of pendingAttendances) {
    try {
      // Atomic update with checkOut: null filter to prevent race condition if employee just punched out
      const updateResult = await prisma.attendance.updateMany({
        where: {
          id: att.id,
          checkOut: null, // Concurrency guard
        },
        data: {
          checkOut: autoPunchOutTime,
          status: 'HALF_DAY',
          isOnBreak: false,
          notes: att.notes
            ? `${att.notes} | [SYSTEM_AUTO_PUNCH_OUT]`
            : '[SYSTEM_AUTO_PUNCH_OUT] Auto punch-out applied at 11:59 PM (Half Day)',
        },
      });

      if (updateResult.count > 0) {
        processedCount++;
        const empName = att.employee ? `${att.employee.firstName} ${att.employee.lastName}`.trim() : `ID ${att.employeeId}`;
        console.log(`✅ [Auto Punch-Out] Auto punched OUT employee ${empName} (Code: ${att.employee?.employeeCode || 'N/A'}, Attendance ID: ${att.id}) -> HALF_DAY at 23:59.`);

        // Audit Log entry
        await auditLogService.log({
          employeeId: att.employeeId,
          userId: att.employee?.userId || undefined,
          action: `SYSTEM_AUTO_PUNCH_OUT: Auto punched out at 11:59 PM for attendance date ${dateStr}. Status marked as HALF_DAY.`,
        });

        details.push({
          attendanceId: att.id,
          employeeId: att.employeeId,
          status: 'HALF_DAY',
          checkOut: autoPunchOutTime.toISOString(),
        });
      } else {
        // Record was updated concurrently (e.g. employee manually punched out)
        skippedCount++;
        console.log(`ℹ️ [Auto Punch-Out] Skipped attendance ID ${att.id} (already punched out concurrently).`);
      }
    } catch (err) {
      console.error(`❌ [Auto Punch-Out] Failed to auto punch-out attendance ID ${att.id}:`, err);
    }
  }

  console.log(`🏁 [Auto Punch-Out] Finished for date ${dateStr}. Processed: ${processedCount}, Skipped: ${skippedCount}.`);

  return {
    success: true,
    date: dateStr,
    processedCount,
    skippedCount,
    details,
  };
}

/**
 * Initializes the node-cron scheduled job for 11:59 PM IST every day.
 */
export function initAutoPunchOutCron() {
  console.log('⏰ [Auto Punch-Out Cron] Initializing 11:59 PM IST daily auto punch-out scheduler...');

  // 59 23 * * * -> At 23:59 (11:59 PM) every day
  cron.schedule(
    '59 23 * * *',
    async () => {
      console.log('⏰ [Auto Punch-Out Cron] 11:59 PM trigger fired.');
      try {
        const result = await performAutoPunchOut();
        console.log(`✅ [Auto Punch-Out Cron] Run complete: ${result.processedCount} employee(s) auto-punched out.`);
      } catch (error) {
        console.error('❌ [Auto Punch-Out Cron] Job execution error:', error);
      }
    },
    {
      timezone: 'Asia/Kolkata',
    }
  );
}
