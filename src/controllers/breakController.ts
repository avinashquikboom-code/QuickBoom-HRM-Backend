import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';

function resolveTimezone(tz: string): string {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return tz;
  } catch (e) {
    return 'Asia/Kolkata';
  }
}

function getLocalDateString(timezone: string = 'Asia/Kolkata', dateInput: Date = new Date()): string {
  const resolved = resolveTimezone(timezone);
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: resolved,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const parts = formatter.formatToParts(dateInput);
    const year = parts.find(p => p.type === 'year')?.value;
    const month = parts.find(p => p.type === 'month')?.value;
    const day = parts.find(p => p.type === 'day')?.value;
    return `${year}-${month}-${day}`;
  } catch (error) {
    const localDate = new Date(dateInput.getTime() + 5.5 * 60 * 60 * 1000);
    return localDate.toISOString().split('T')[0];
  }
}

// POST /api/breaks/start
export const startBreak = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { type } = req.body;
    if (!type || !['LUNCH', 'TEA', 'PERSONAL', 'MEETING'].includes(type)) {
      res.status(400).json({
        success: false,
        message: 'Invalid break type. Allowed: LUNCH, TEA, PERSONAL, MEETING.',
        errorCode: 'INVALID_BREAK_TYPE'
      });
      return;
    }

    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
      include: { user: { include: { profile: true } } }
    });

    if (!employee) {
      res.status(404).json({
        success: false,
        message: 'Employee record not found.',
        errorCode: 'EMPLOYEE_NOT_FOUND'
      });
      return;
    }

    const userTimezone = employee.user?.profile?.timezone || 'Asia/Kolkata';
    const now = new Date();
    const todayStr = getLocalDateString(userTimezone, now);

    // 1. Verify punch-in today
    const attendance = await prisma.attendance.findFirst({
      where: {
        employeeId: employee.id,
        date: todayStr,
        checkIn: { not: null },
        checkOut: null
      }
    });

    if (!attendance) {
      res.status(400).json({
        success: false,
        message: 'You must be punched in and not checked out to start a break today.',
        errorCode: 'NO_ACTIVE_PUNCH_IN'
      });
      return;
    }

    // 2. Check if another break is already active
    const activeBreak = await prisma.break.findFirst({
      where: {
        employeeId: employee.id,
        endAt: null
      }
    });

    if (activeBreak) {
      res.status(400).json({
        success: false,
        message: 'You already have an active break.',
        errorCode: 'BREAK_ALREADY_ACTIVE'
      });
      return;
    }

    // 3. Create the new Break record
    const newBreak = await prisma.break.create({
      data: {
        employeeId: employee.id,
        type,
        startAt: now,
        date: todayStr
      }
    });

    // 4. Update the Attendance table fields for backward compatibility
    await prisma.attendance.update({
      where: { id: attendance.id },
      data: {
        isOnBreak: true,
        breakStartTime: now
      }
    });

    res.status(200).json({
      success: true,
      message: 'Break started successfully.',
      data: newBreak
    });
  } catch (error) {
    console.error('Start break error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start break.',
      errorCode: 'SERVER_ERROR'
    });
  }
};

// POST /api/breaks/end
export const endBreak = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
      include: { user: { include: { profile: true } } }
    });

    if (!employee) {
      res.status(404).json({
        success: false,
        message: 'Employee record not found.',
        errorCode: 'EMPLOYEE_NOT_FOUND'
      });
      return;
    }

    // 1. Find the active break
    const activeBreak = await prisma.break.findFirst({
      where: {
        employeeId: employee.id,
        endAt: null
      }
    });

    if (!activeBreak) {
      res.status(400).json({
        success: false,
        message: 'No active break found.',
        errorCode: 'NO_ACTIVE_BREAK'
      });
      return;
    }

    const now = new Date();
    const durationMs = now.getTime() - activeBreak.startAt.getTime();
    const durationSeconds = Math.max(0, Math.floor(durationMs / 1000));

    // 2. End the active break
    const endedBreak = await prisma.break.update({
      where: { id: activeBreak.id },
      data: {
        endAt: now
      }
    });

    // 3. Update active Attendance record for backward compatibility
    const userTimezone = employee.user?.profile?.timezone || 'Asia/Kolkata';
    const todayStr = getLocalDateString(userTimezone, now);
    const attendance = await prisma.attendance.findFirst({
      where: {
        employeeId: employee.id,
        date: todayStr,
        checkIn: { not: null },
        checkOut: null
      }
    });

    if (attendance) {
      await prisma.attendance.update({
        where: { id: attendance.id },
        data: {
          isOnBreak: false,
          breakStartTime: null,
          totalBreakSeconds: attendance.totalBreakSeconds + durationSeconds
        }
      });
    }

    res.status(200).json({
      success: true,
      message: 'Break ended successfully.',
      data: {
        ...endedBreak,
        durationSeconds
      }
    });
  } catch (error) {
    console.error('End break error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to end break.',
      errorCode: 'SERVER_ERROR'
    });
  }
};

// GET /api/breaks/today
export const getTodayBreaks = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
      include: { user: { include: { profile: true } } }
    });

    if (!employee) {
      res.status(404).json({
        success: false,
        message: 'Employee record not found.',
        errorCode: 'EMPLOYEE_NOT_FOUND'
      });
      return;
    }

    const userTimezone = employee.user?.profile?.timezone || 'Asia/Kolkata';
    const now = new Date();
    const todayStr = getLocalDateString(userTimezone, now);

    const breaks = await prisma.break.findMany({
      where: {
        employeeId: employee.id,
        date: todayStr
      },
      orderBy: { startAt: 'asc' }
    });

    const activeBreak = breaks.find(b => b.endAt === null) || null;

    res.status(200).json({
      success: true,
      breaks,
      activeBreak
    });
  } catch (error) {
    console.error('Get today breaks error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch today\'s breaks.',
      errorCode: 'SERVER_ERROR'
    });
  }
};
