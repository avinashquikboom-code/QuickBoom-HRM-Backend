import { Response } from 'express';
import { prisma } from '../../utils/db';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';

function getNextShiftDate(workingDays: string[]): { date: Date; dayName: string } {
  const today = new Date();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  
  for (let i = 0; i < 7; i++) {
    const checkDate = new Date();
    checkDate.setDate(today.getDate() + i);
    const checkDayName = dayNames[checkDate.getDay()];
    if (workingDays.includes(checkDayName)) {
      return { date: checkDate, dayName: checkDayName };
    }
  }
  return { date: today, dayName: dayNames[today.getDay()] };
}

export const getUpcomingWidgetData = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
      include: {
        shiftAssignments: {
          where: {
            OR: [
              { effectiveTo: null },
              { effectiveTo: { gte: new Date() } }
            ]
          },
          include: { shift: true },
          orderBy: { effectiveFrom: 'desc' },
          take: 1
        }
      }
    });

    if (!employee) {
      res.status(404).json({
        success: false,
        message: 'Employee record not found.'
      });
      return;
    }

    // 1. Fetch next shift info
    let upcomingShift = null;
    if (employee.shiftAssignments.length > 0) {
      const shift = employee.shiftAssignments[0].shift;
      const nextShift = getNextShiftDate(shift.workingDays);
      upcomingShift = {
        shiftId: shift.id,
        name: shift.name,
        startTime: shift.startTime,
        endTime: shift.endTime,
        color: shift.color,
        nextDate: nextShift.date.toISOString().split('T')[0],
        dayName: nextShift.dayName
      };
    }

    // 2. Fetch next upcoming holiday
    const nextHoliday = await prisma.holiday.findFirst({
      where: {
        date: { gte: new Date() }
      },
      orderBy: { date: 'asc' }
    });

    // 3. Fetch next approved leave request
    const nextLeave = await prisma.leaveRequest.findFirst({
      where: {
        employeeId: employee.id,
        status: 'APPROVED',
        toDate: { gte: new Date() }
      },
      orderBy: { fromDate: 'asc' }
    });

    // 4. Determine next salary date from system settings
    const systemSettings = await prisma.systemSetting.findUnique({
      where: { id: 1 }
    });
    const payrollConfig = (systemSettings?.payroll as any) || {};
    const processingDay = payrollConfig.processingDay !== undefined ? Number(payrollConfig.processingDay) : 25;
    
    const today = new Date();
    let salaryDate = new Date(today.getFullYear(), today.getMonth(), processingDay);
    if (today.getDate() >= processingDay) {
      salaryDate = new Date(today.getFullYear(), today.getMonth() + 1, processingDay);
    }

    // 5. Fetch latest announcement
    const latestAnnouncement = await prisma.announcement.findFirst({
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      data: {
        upcomingShift,
        upcomingHoliday: nextHoliday ? {
          id: nextHoliday.id,
          name: nextHoliday.name,
          date: nextHoliday.date.toISOString().split('T')[0],
          isPublic: nextHoliday.isPublic,
          description: nextHoliday.description
        } : null,
        upcomingLeave: nextLeave ? {
          id: nextLeave.id,
          type: nextLeave.type,
          fromDate: nextLeave.fromDate.toISOString().split('T')[0],
          toDate: nextLeave.toDate.toISOString().split('T')[0],
          reason: nextLeave.reason
        } : null,
        salaryDate: salaryDate.toISOString().split('T')[0],
        latestAnnouncement: latestAnnouncement ? {
          id: latestAnnouncement.id,
          title: latestAnnouncement.title,
          content: latestAnnouncement.content,
          category: latestAnnouncement.category,
          publishedBy: latestAnnouncement.publishedBy,
          createdAt: latestAnnouncement.createdAt
        } : null
      }
    });
  } catch (error) {
    console.error('Get upcoming widget data error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve upcoming widget data.'
    });
  }
};
