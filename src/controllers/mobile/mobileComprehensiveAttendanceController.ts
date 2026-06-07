import { Response } from 'express';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';
import { prisma } from '../../utils/db';

/**
 * Get comprehensive attendance report for mobile employee
 * Includes half-day/full-day classification, break details, and location tracking
 */
export const getMobileComprehensiveReport = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { month, year } = req.query;
    const userId = req.user?.id;

    if (!month || !year) {
      res.status(400).json({
        success: false,
        message: 'Month and year are required.',
        errorCode: 'MISSING_DATE_PARAMS'
      });
      return;
    }

    const monthNum = parseInt(month as string);
    const yearNum = parseInt(year as string);

    if (monthNum < 1 || monthNum > 12 || yearNum < 2020 || yearNum > 2030) {
      res.status(400).json({
        success: false,
        message: 'Invalid month or year.',
        errorCode: 'INVALID_DATE_PARAMS'
      });
      return;
    }

    const startDate = new Date(yearNum, monthNum - 1, 1);
    const endDate = new Date(yearNum, monthNum, 0);

    const attendanceData = await prisma.$queryRaw`
      SELECT 
        a.id,
        a.date,
        a.checkIn,
        a.checkOut,
        a.status,
        a.latitude,
        a.longitude,
        a.isOnBreak,
        a.breakStartTime,
        a.totalBreakSeconds,
        o.name as officeName,
        o.latitude as officeLat,
        o.longitude as officeLon,
        o.maxPunchRadiusMeters as officeRadius,
        -- Calculate work hours
        CASE 
          WHEN a.checkIn IS NOT NULL AND a.checkOut IS NOT NULL
          THEN EXTRACT(EPOCH FROM (a.checkOut - a.checkIn)) - a.totalBreakSeconds
          ELSE 0
        END as totalWorkSeconds,
        -- Determine attendance type
        CASE 
          WHEN a.status = 'PRESENT' AND a.checkIn IS NOT NULL AND a.checkOut IS NOT NULL
          THEN CASE 
            WHEN EXTRACT(EPOCH FROM (a.checkOut - a.checkIn)) - a.totalBreakSeconds >= 14400
            THEN 'FULL_DAY'
            ELSE 'HALF_DAY'
          END
          WHEN a.status = 'ABSENT' THEN 'ABSENT'
          WHEN a.status = 'LATE' THEN 'LATE'
          ELSE a.status
        END as attendanceType,
        -- Location tracking
        CASE 
          WHEN a.latitude IS NOT NULL AND a.longitude IS NOT NULL
          THEN 1
          ELSE 0
        END as hasLocation
      FROM Attendance a
      LEFT JOIN Employee e ON a.employeeId = e.id
      LEFT JOIN Office o ON a.officeId = o.id
      LEFT JOIN User u ON e.userId = u.id
      WHERE u.id = ${userId}
        AND a.date >= ${startDate.toISOString().split('T')[0]} 
        AND a.date <= ${endDate.toISOString().split('T')[0]}
      ORDER BY a.date DESC
    ` as any[];

    // Calculate summary statistics
    const summary = {
      totalDays: attendanceData.length,
      fullDays: attendanceData.filter((a: any) => a.attendanceType === 'FULL_DAY').length,
      halfDays: attendanceData.filter((a: any) => a.attendanceType === 'HALF_DAY').length,
      absentDays: attendanceData.filter((a: any) => a.attendanceType === 'ABSENT').length,
      lateDays: attendanceData.filter((a: any) => a.attendanceType === 'LATE').length,
      presentDays: attendanceData.filter((a: any) => a.status === 'PRESENT').length,
      totalWorkHours: attendanceData.reduce((sum: number, a: any) => sum + (a.totalWorkSeconds / 3600), 0),
      totalBreakTime: attendanceData.reduce((sum: number, a: any) => sum + (a.totalBreakSeconds / 60), 0),
      locationTrackingDays: attendanceData.filter((a: any) => a.hasLocation === 1).length,
      locationTrackingPercentage: attendanceData.length > 0 
        ? (attendanceData.filter((a: any) => a.hasLocation === 1).length / attendanceData.length) * 100 
        : 0
    };

    // Calculate location exit/entry count
    const locationTracking = attendanceData
      .filter((a: any) => a.hasLocation === 1)
      .map((a: any) => ({
        date: a.date,
        latitude: a.latitude,
        longitude: a.longitude,
        officeName: a.officeName,
        officeRadius: a.officeRadius,
        locationStatus: 'IN_OFFICE'
      }));

    // Calculate break details
    const breakDetails = attendanceData
      .filter((a: any) => a.totalBreakSeconds > 0)
      .map((a: any) => ({
        date: a.date,
        breakStartTime: a.breakStartTime,
        breakMinutes: Math.round(a.totalBreakSeconds / 60),
        breakType: a.totalBreakSeconds >= 3600 ? 'LONG_BREAK' : a.totalBreakSeconds >= 1800 ? 'STANDARD_BREAK' : 'SHORT_BREAK'
      }));

    res.json({
      success: true,
      data: {
        period: {
          month: monthNum,
          year: yearNum,
          startDate: startDate.toISOString().split('T')[0],
          endDate: endDate.toISOString().split('T')[0]
        },
        summary,
        attendanceRecords: attendanceData.map((a: any) => ({
          date: a.date,
          checkIn: a.checkIn,
          checkOut: a.checkOut,
          status: a.status,
          attendanceType: a.attendanceType,
          workHours: Math.round((a.totalWorkSeconds / 3600) * 100) / 100,
          breakMinutes: Math.round(a.totalBreakSeconds / 60),
          hasLocation: a.hasLocation === 1,
          location: a.hasLocation === 1 ? {
            latitude: a.latitude,
            longitude: a.longitude,
            officeName: a.officeName,
            officeRadius: a.officeRadius
          } : null
        })),
        locationTracking,
        breakDetails
      }
    });

  } catch (error) {
    console.error('Mobile comprehensive report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate comprehensive report.',
      errorCode: 'MOBILE_COMPREHENSIVE_ERROR'
    });
  }
};
