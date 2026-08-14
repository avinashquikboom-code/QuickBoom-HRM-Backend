import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';
const PdfPrinter = require('pdfmake');

// Primary color for all PDF reports
const PRIMARY_COLOR = '#14B8A6';

// ==========================================
// Comprehensive Attendance Report Controller
// ==========================================

/**
 * @swagger
 * /api/attendance/comprehensive-report:
 *   get:
 *     summary: Get comprehensive attendance report
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: month
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 12
 *         description: Month number (1-12)
 *       - in: query
 *         name: year
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 2020
 *           maximum: 2030
 *         description: Year
 *       - in: query
 *         name: employeeId
 *         required: false
 *         schema:
 *           type: integer
 *         description: Specific employee ID
 *       - in: query
 *         name: departmentId
 *         required: false
 *         schema:
 *           type: integer
 *         description: Specific department ID
 *       - in: query
 *         name: includeLocationTracking
 *         required: false
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Include location tracking data
 *       - in: query
 *         name: includeBreakDetails
 *         required: false
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Include break time details
 *     responses:
 *       200:
 *         description: Comprehensive attendance report generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ComprehensiveAttendanceReport'
 *       400:
 *         description: Bad request - missing or invalid parameters
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       500:
 *         description: Internal server error
 */
export const getComprehensiveAttendanceReport = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { 
      employeeId, 
      month, 
      year, 
      departmentId,
      includeLocationTracking = true,
      includeBreakDetails = true 
    } = req.query;

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
    
    // Validate month and year
    if (monthNum < 1 || monthNum > 12 || yearNum < 2020 || yearNum > 2030) {
      res.status(400).json({
        success: false,
        message: 'Invalid month or year.',
        errorCode: 'INVALID_DATE_PARAMS'
      });
      return;
    }

    // Build date range for the month
    const monthPadded = String(monthNum).padStart(2, '0');
    const lastDayNum = new Date(yearNum, monthNum, 0).getDate();
    const lastDayPadded = String(lastDayNum).padStart(2, '0');
    const startDateStr = `${yearNum}-${monthPadded}-01`;
    const endDateStr = `${yearNum}-${monthPadded}-${lastDayPadded}`;

    console.log(`📊 [ATTENDANCE] Generating comprehensive report for ${monthNum}/${yearNum}`);

    // Get attendance data with comprehensive details
    const attendanceData = await prisma.$queryRaw`
      SELECT 
        a.id,
        a.employeeId,
        a.date,
        a.checkIn,
        a.checkOut,
        a.status,
        a.notes,
        a.latitude,
        a.longitude,
        a.isFingerprintCheckIn,
        a.isFingerprintCheckOut,
        a.isOnBreak,
        a.breakStartTime,
        a.totalBreakSeconds,
        a.createdAt,
        a.updatedAt,
        e.employeeCode,
        e.firstName,
        e.lastName,
        e.email,
        d.name as departmentName,
        o.name as officeName,
        u.email as userEmail,
        p.fullName,
        -- Calculate work hours
        CASE 
          WHEN a.checkIn IS NOT NULL AND a.checkOut IS NOT NULL
          THEN EXTRACT(EPOCH FROM (a.checkOut - a.checkIn)) - a.totalBreakSeconds
          ELSE 0
        END as totalWorkSeconds,
        -- Calculate break hours
        CASE 
          WHEN a.totalBreakSeconds > 0
          THEN a.totalBreakSeconds
          ELSE 0
        END as totalBreakSeconds,
        -- Determine attendance type (FULL_DAY, HALF_DAY, ABSENT)
        CASE 
          WHEN a.status = 'PRESENT' AND a.checkIn IS NOT NULL AND a.checkOut IS NOT NULL
          THEN CASE 
            WHEN EXTRACT(EPOCH FROM (a.checkOut - a.checkIn)) - a.totalBreakSeconds >= 14400 -- 4 hours
            THEN 'FULL_DAY'
            ELSE 'HALF_DAY'
          END
          WHEN a.status = 'ABSENT' THEN 'ABSENT'
          WHEN a.status = 'LEAVE' THEN 'LEAVE'
          ELSE 'UNKNOWN'
        END as attendanceType,
        -- Location tracking count
        CASE 
          WHEN a.latitude IS NOT NULL AND a.longitude IS NOT NULL
          THEN 1
          ELSE 0
        END as hasLocation
      FROM Attendance a
      LEFT JOIN Employee e ON a.employeeId = e.id
      LEFT JOIN Department d ON e.departmentId = d.id
      LEFT JOIN Office o ON a.officeId = o.id
      LEFT JOIN User u ON e.userId = u.id
      LEFT JOIN Profile p ON u.id = p.userId
      WHERE a.date >= ${startDateStr} 
        AND a.date <= ${endDateStr}
        ${employeeId ? `AND a.employeeId = ${parseInt(employeeId as string)}` : ''}
        ${departmentId ? `AND e.departmentId = ${parseInt(departmentId as string)}` : ''}
      ORDER BY a.date DESC, e.firstName, e.lastName
    ` as any[];

    // Get location exit/entry tracking
    let locationTracking: any[] = [];
    if (includeLocationTracking === 'true') {
      locationTracking = await prisma.$queryRaw`
        SELECT 
          a.employeeId,
          a.date,
          a.checkIn,
          a.checkOut,
          a.latitude,
          a.longitude,
          e.firstName,
          e.lastName,
          -- Count location changes for the day
          (SELECT COUNT(*) FROM Attendance a2 
           WHERE a2.employeeId = a.employeeId 
             AND a2.date = a.date 
             AND a2.latitude IS NOT NULL 
             AND a2.longitude IS NOT NULL) as locationUpdates,
          -- Determine if employee left office area
          CASE 
            WHEN a.latitude IS NOT NULL AND a.longitude IS NOT NULL
            THEN 'IN_OFFICE'
            ELSE 'OUT_OF_OFFICE'
          END as locationStatus
        FROM Attendance a
        LEFT JOIN Employee e ON a.employeeId = e.id
        WHERE a.date >= ${startDateStr} 
          AND a.date <= ${endDateStr}
          ${employeeId ? `AND a.employeeId = ${parseInt(employeeId as string)}` : ''}
        ORDER BY a.date DESC, a.checkIn
      ` as any[];
    }

    // Get break details
    let breakDetails = [];
    if (includeBreakDetails === 'true') {
      breakDetails = await prisma.$queryRaw`
        SELECT 
          a.employeeId,
          a.date,
          a.breakStartTime,
          a.totalBreakSeconds,
          a.isOnBreak,
          e.firstName,
          e.lastName,
          -- Calculate break duration in minutes
          CASE 
            WHEN a.totalBreakSeconds > 0
            THEN ROUND(a.totalBreakSeconds / 60.0, 2)
            ELSE 0
          END as breakMinutes,
          -- Break type detection
          CASE 
            WHEN a.totalBreakSeconds >= 3600 THEN 'LONG_BREAK' -- > 1 hour
            WHEN a.totalBreakSeconds >= 1800 THEN 'STANDARD_BREAK' -- 30 mins to 1 hour
            WHEN a.totalBreakSeconds > 0 THEN 'SHORT_BREAK' -- < 30 mins
            ELSE 'NO_BREAK'
          END as breakType
        FROM Attendance a
        LEFT JOIN Employee e ON a.employeeId = e.id
        WHERE a.date >= ${startDateStr} 
          AND a.date <= ${endDateStr}
          ${employeeId ? `AND a.employeeId = ${parseInt(employeeId as string)}` : ''}
          AND a.totalBreakSeconds > 0
        ORDER BY a.date DESC, a.breakStartTime
      ` as any[];
    }

    // Calculate monthly summaries
    const monthlySummary = calculateMonthlySummary(attendanceData as any[], monthNum, yearNum);

    // Calculate daily summaries
    const dailySummaries = calculateDailySummaries(attendanceData as any[]);

    // Calculate employee-wise summaries
    const employeeSummaries = calculateEmployeeSummaries(attendanceData as any[]);

    res.json({
      success: true,
      message: 'Comprehensive attendance report generated successfully.',
      data: {
        period: {
          month: monthNum,
          year: yearNum,
          startDate: startDateStr,
          endDate: endDateStr,
          totalDays: lastDayNum
        },
        summary: monthlySummary,
        dailySummaries,
        employeeSummaries,
        attendanceRecords: attendanceData,
        locationTracking: includeLocationTracking === 'true' ? locationTracking : undefined,
        breakDetails: includeBreakDetails === 'true' ? breakDetails : undefined,
        metrics: {
          totalEmployees: new Set((attendanceData as any[]).map(a => a.employeeId)).size,
          totalRecords: attendanceData.length,
          averageWorkHours: monthlySummary.averageWorkHours,
          averageBreakTime: monthlySummary.averageBreakTime,
          locationTrackingCompliance: monthlySummary.locationTrackingCompliance
        }
      }
    });

  } catch (error) {
    console.error('Comprehensive attendance report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate comprehensive attendance report.',
      errorCode: 'COMPREHENSIVE_ATTENDANCE_ERROR'
    });
  }
};

/**
 * @swagger
 * /api/attendance/trends:
 *   get:
 *     summary: Get attendance trends analysis
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         required: false
 *         schema:
 *           type: string
 *           enum: [monthly]
 *           default: monthly
 *         description: Analysis period
 *       - in: query
 *         name: months
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 12
 *           default: 6
 *         description: Number of months to analyze
 *     responses:
 *       200:
 *         description: Attendance trends generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AttendanceTrends'
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       500:
 *         description: Internal server error
 */
export const getAttendanceTrends = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { period = 'monthly', months = 6 } = req.query;
    
    const monthsCount = parseInt(months as string);
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - monthsCount + 1);

    console.log(`📈 [TRENDS] Generating attendance trends for ${period} (${monthsCount} months)`);

    const trendsData = await prisma.$queryRaw`
      SELECT 
        DATE_TRUNC('month', a.date) as month,
        COUNT(*) as totalRecords,
        COUNT(CASE WHEN a.status = 'PRESENT' THEN 1 END) as presentDays,
        COUNT(CASE WHEN a.status = 'ABSENT' THEN 1 END) as absentDays,
        COUNT(CASE WHEN a.status = 'LEAVE' THEN 1 END) as leaveDays,
        COUNT(CASE WHEN a.checkIn IS NOT NULL AND a.checkOut IS NOT NULL THEN 1 END) as completeDays,
        AVG(CASE 
          WHEN a.checkIn IS NOT NULL AND a.checkOut IS NOT NULL
          THEN EXTRACT(EPOCH FROM (a.checkOut - a.checkIn)) - a.totalBreakSeconds
          ELSE NULL
        END) as avgWorkSeconds,
        AVG(a.totalBreakSeconds) as avgBreakSeconds,
        COUNT(CASE WHEN a.latitude IS NOT NULL AND a.longitude IS NOT NULL THEN 1 END) as locationTrackedDays,
        COUNT(DISTINCT a.employeeId) as uniqueEmployees
      FROM Attendance a
      WHERE a.date >= ${startDate.toISOString().split('T')[0]} 
        AND a.date <= ${endDate.toISOString().split('T')[0]}
      GROUP BY DATE_TRUNC('month', a.date)
      ORDER BY month DESC
    ` as any[];

    res.json({
      success: true,
      data: {
        period: period,
        monthsAnalyzed: monthsCount,
        trends: trendsData.map(trend => ({
          month: trend.month,
          totalRecords: parseInt(trend.totalrecords),
          presentDays: parseInt(trend.presentdays),
          absentDays: parseInt(trend.absentdays),
          leaveDays: parseInt(trend.leavedays),
          completeDays: parseInt(trend.completedays),
          averageWorkHours: parseFloat(trend.avgworkseconds) / 3600,
          averageBreakTime: parseFloat(trend.avgbreakseconds) / 60,
          locationTrackingCompliance: parseFloat(trend.locationtrackeddays) / parseInt(trend.totalrecords) * 100,
          uniqueEmployees: parseInt(trend.uniqueemployees)
        }))
      }
    });

  } catch (error) {
    console.error('Attendance trends error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate attendance trends.',
      errorCode: 'ATTENDANCE_TRENDS_ERROR'
    });
  }
};

/**
 * @swagger
 * /api/attendance/location-tracking:
 *   get:
 *     summary: Get location tracking report
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date (YYYY-MM-DD)
 *       - in: query
 *         name: endDate
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: End date (YYYY-MM-DD)
 *       - in: query
 *         name: employeeId
 *         required: false
 *         schema:
 *           type: integer
 *         description: Specific employee ID
 *     responses:
 *       200:
 *         description: Location tracking report generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LocationTrackingReport'
 *       400:
 *         description: Bad request - missing or invalid parameters
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       500:
 *         description: Internal server error
 */
export const getLocationTrackingReport = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { employeeId, startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      res.status(400).json({
        success: false,
        message: 'Start date and end date are required.',
        errorCode: 'MISSING_DATE_PARAMS'
      });
      return;
    }

    console.log(`📍 [LOCATION] Generating location tracking report`);

    const locationData = await prisma.$queryRaw`
      SELECT 
        a.employeeId,
        a.date,
        a.checkIn,
        a.checkOut,
        a.latitude,
        a.longitude,
        a.status,
        e.firstName,
        e.lastName,
        e.employeeCode,
        o.name as officeName,
        o.latitude as officeLatitude,
        o.longitude as officeLongitude,
        -- Calculate distance from office (simplified)
        CASE 
          WHEN a.latitude IS NOT NULL AND a.longitude IS NOT NULL 
               AND o.latitude IS NOT NULL AND o.longitude IS NOT NULL
          THEN 6371 * ACOS(
            COS(RADIANS(a.latitude)) * COS(RADIANS(o.latitude)) *
            COS(RADIANS(o.longitude) - RADIANS(a.longitude)) +
            SIN(RADIANS(a.latitude)) * SIN(RADIANS(o.latitude))
          )
          ELSE NULL
        END as distanceFromOffice,
        -- Location status
        CASE 
          WHEN a.latitude IS NOT NULL AND a.longitude IS NOT NULL
          THEN 'TRACKED'
          ELSE 'NOT_TRACKED'
        END as locationStatus,
        -- Office compliance
        CASE 
          WHEN a.latitude IS NOT NULL AND a.longitude IS NOT NULL 
               AND o.latitude IS NOT NULL AND o.longitude IS NOT NULL
               AND 6371 * ACOS(
                 COS(RADIANS(a.latitude)) * COS(RADIANS(o.latitude)) *
                 COS(RADIANS(o.longitude) - RADIANS(a.longitude)) +
                 SIN(RADIANS(a.latitude)) * SIN(RADIANS(o.latitude))
               ) <= 0.5 -- Within 500m
          THEN 'IN_OFFICE_AREA'
          ELSE 'OUTSIDE_OFFICE_AREA'
        END as officeCompliance
      FROM Attendance a
      LEFT JOIN Employee e ON a.employeeId = e.id
      LEFT JOIN Office o ON a.officeId = o.id
      WHERE a.date >= ${startDate} 
        AND a.date <= ${endDate}
        ${employeeId ? `AND a.employeeId = ${parseInt(employeeId as string)}` : ''}
      ORDER BY a.date DESC, a.checkIn
    ` as any[];

    // Calculate location statistics
    const locationStats = {
      totalRecords: locationData.length,
      trackedRecords: locationData.filter((l: any) => l.locationStatus === 'TRACKED').length,
      officeCompliantRecords: locationData.filter((l: any) => l.officeCompliance === 'IN_OFFICE_AREA').length,
      averageDistance: locationData
        .filter((l: any) => l.distanceFromOffice !== null)
        .reduce((sum: number, l: any) => sum + parseFloat(l.distanceFromOffice), 0) / 
        locationData.filter((l: any) => l.distanceFromOffice !== null).length,
      locationTrackingPercentage: (locationData.filter((l: any) => l.locationStatus === 'TRACKED').length / locationData.length) * 100,
      officeCompliancePercentage: (locationData.filter((l: any) => l.officeCompliance === 'IN_OFFICE_AREA').length / locationData.length) * 100
    };

    res.json({
      success: true,
      data: {
        period: { startDate, endDate },
        statistics: locationStats,
        locationRecords: locationData,
        insights: {
          trackingCompliance: locationStats.locationTrackingPercentage,
          officeCompliance: locationStats.officeCompliancePercentage,
          averageDistanceFromOffice: locationStats.averageDistance
        }
      }
    });

  } catch (error) {
    console.error('Location tracking report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate location tracking report.',
      errorCode: 'LOCATION_TRACKING_ERROR'
    });
  }
};

// Helper functions
function calculateMonthlySummary(attendanceData: any[], month: number, year: number) {
  const totalDays = attendanceData.length;
  const presentDays = attendanceData.filter(a => a.status === 'PRESENT').length;
  const absentDays = attendanceData.filter(a => a.status === 'ABSENT').length;
  const leaveDays = attendanceData.filter(a => a.status === 'LEAVE').length;
  const fullDays = attendanceData.filter(a => a.attendanceType === 'FULL_DAY').length;
  const halfDays = attendanceData.filter(a => a.attendanceType === 'HALF_DAY').length;
  
  const totalWorkSeconds = attendanceData.reduce((sum, a) => sum + (parseFloat(a.totalworkseconds) || 0), 0);
  const totalBreakSeconds = attendanceData.reduce((sum, a) => sum + (parseFloat(a.totalbreakseconds) || 0), 0);
  const locationTrackedDays = attendanceData.filter(a => a.hasLocation === 1).length;
  
  return {
    totalDays,
    presentDays,
    absentDays,
    leaveDays,
    fullDays,
    halfDays,
    averageWorkHours: totalWorkSeconds / totalDays / 3600,
    averageBreakTime: totalBreakSeconds / totalDays / 60,
    locationTrackingCompliance: (locationTrackedDays / totalDays) * 100,
    attendancePercentage: (presentDays / totalDays) * 100,
    punctualityRate: (fullDays / totalDays) * 100
  };
}

function calculateDailySummaries(attendanceData: any[]) {
  const dailyMap = new Map();
  
  attendanceData.forEach(record => {
    const date = record.date;
    if (!dailyMap.has(date)) {
      dailyMap.set(date, {
        date,
        totalEmployees: 0,
        presentCount: 0,
        absentCount: 0,
        leaveCount: 0,
        fullDayCount: 0,
        halfDayCount: 0,
        averageWorkHours: 0,
        averageBreakTime: 0,
        locationTrackedCount: 0
      });
    }
    
    const summary = dailyMap.get(date);
    summary.totalEmployees++;
    
    if (record.status === 'PRESENT') summary.presentCount++;
    else if (record.status === 'ABSENT') summary.absentCount++;
    else if (record.status === 'LEAVE') summary.leaveCount++;
    
    if (record.attendanceType === 'FULL_DAY') summary.fullDayCount++;
    else if (record.attendanceType === 'HALF_DAY') summary.halfDayCount++;
    
    if (record.hasLocation === 1) summary.locationTrackedCount++;
  });
  
  return Array.from(dailyMap.values()).sort((a, b) => b.date.localeCompare(a.date));
}

function calculateEmployeeSummaries(attendanceData: any[]) {
  const employeeMap = new Map();
  
  attendanceData.forEach(record => {
    const employeeId = record.employeeId;
    if (!employeeMap.has(employeeId)) {
      employeeMap.set(employeeId, {
        employeeId,
        employeeCode: record.employeecode,
        firstName: record.firstname,
        lastName: record.lastname,
        departmentName: record.departmentname,
        totalDays: 0,
        presentDays: 0,
        absentDays: 0,
        leaveDays: 0,
        fullDays: 0,
        halfDays: 0,
        averageWorkHours: 0,
        averageBreakTime: 0,
        locationTrackedDays: 0,
        totalWorkSeconds: 0,
        totalBreakSeconds: 0
      });
    }
    
    const summary = employeeMap.get(employeeId);
    summary.totalDays++;
    summary.totalWorkSeconds += parseFloat(record.totalworkseconds) || 0;
    summary.totalBreakSeconds += parseFloat(record.totalbreakseconds) || 0;
    
    if (record.status === 'PRESENT') summary.presentDays++;
    else if (record.status === 'ABSENT') summary.absentDays++;
    else if (record.status === 'LEAVE') summary.leaveDays++;
    
    if (record.attendanceType === 'FULL_DAY') summary.fullDays++;
    else if (record.attendanceType === 'HALF_DAY') summary.halfDays++;
    
    if (record.hasLocation === 1) summary.locationTrackedDays++;
    
    // Calculate averages
    summary.averageWorkHours = summary.totalWorkSeconds / summary.totalDays / 3600;
    summary.averageBreakTime = summary.totalBreakSeconds / summary.totalDays / 60;
  });
  
  return Array.from(employeeMap.values()).sort((a, b) => a.firstName.localeCompare(b.firstName));
}

/**
 * @swagger
 * /api/attendance/comprehensive-report/download:
 *   get:
 *     summary: Download comprehensive attendance report as PDF
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: month
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 12
 *         description: Month number (1-12)
 *       - in: query
 *         name: year
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 2020
 *           maximum: 2030
 *         description: Year
 *       - in: query
 *         name: employeeId
 *         required: false
 *         schema:
 *           type: integer
 *         description: Specific employee ID
 *       - in: query
 *         name: departmentId
 *         required: false
 *         schema:
 *           type: integer
 *         description: Specific department ID
 *     responses:
 *       200:
 *         description: PDF file generated successfully
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: Bad request - missing or invalid parameters
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       500:
 *         description: Internal server error
 */
export const downloadComprehensiveAttendanceReport = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { employeeId, month, year, departmentId } = req.query;

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

    // Validate month and year
    if (monthNum < 1 || monthNum > 12 || yearNum < 2020 || yearNum > 2030) {
      res.status(400).json({
        success: false,
        message: 'Invalid month or year.',
        errorCode: 'INVALID_DATE_PARAMS'
      });
      return;
    }

    // Build date range for the month
    const monthPadded = String(monthNum).padStart(2, '0');
    const lastDayNum = new Date(yearNum, monthNum, 0).getDate();
    const lastDayPadded = String(lastDayNum).padStart(2, '0');
    const startDateStr = `${yearNum}-${monthPadded}-01`;
    const endDateStr = `${yearNum}-${monthPadded}-${lastDayPadded}`;

    console.log(`📊 [ATTENDANCE] Downloading comprehensive report for ${monthNum}/${yearNum}`);

    // Get attendance data
    const attendanceData = await prisma.$queryRaw`
      SELECT
        a.id,
        a.employeeId,
        a.date,
        a.checkIn,
        a.checkOut,
        a.status,
        a.notes,
        a.latitude,
        a.longitude,
        a.totalBreakSeconds,
        e.employeeCode,
        e.firstName,
        e.lastName,
        e.email,
        d.name as departmentName,
        o.name as officeName,
        -- Calculate work hours
        CASE
          WHEN a.checkIn IS NOT NULL AND a.checkOut IS NOT NULL
          THEN EXTRACT(EPOCH FROM (a.checkOut - a.checkIn)) - a.totalBreakSeconds
          ELSE 0
        END as totalWorkSeconds
      FROM Attendance a
      LEFT JOIN Employee e ON a.employeeId = e.id
      LEFT JOIN Department d ON e.departmentId = d.id
      LEFT JOIN Office o ON a.officeId = o.id
      WHERE a.date >= ${startDateStr}
        AND a.date <= ${endDateStr}
        ${employeeId ? `AND a.employeeId = ${parseInt(employeeId as string)}` : ''}
        ${departmentId ? `AND e.departmentId = ${parseInt(departmentId as string)}` : ''}
      ORDER BY e.firstName, e.lastName, a.date
    ` as any[];

    // Group by employee
    const employeeMap = new Map();
    attendanceData.forEach((record: any) => {
      const empId = record.employeeid;
      if (!employeeMap.has(empId)) {
        employeeMap.set(empId, {
          employeeId: empId,
          employeeCode: record.employeecode,
          firstName: record.firstname,
          lastName: record.lastname,
          departmentName: record.departmentname,
          officeName: record.officename,
          attendances: []
        });
      }
      employeeMap.get(empId).attendances.push(record);
    });

    const employees = Array.from(employeeMap.values());

    const generatedOn = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const monthLabel = `${months[monthNum - 1]} ${yearNum}`;

    const statusColor = (s: string) => {
      switch (s) {
        case 'PRESENT': return '#059669';
        case 'LATE': return '#D97706';
        case 'HALF_DAY': return '#4F46E5';
        case 'LEAVE': return '#7C3AED';
        case 'ABSENT': return '#DC2626';
        default: return '#64748B';
      }
    };

    const statusBg = (s: string) => {
      switch (s) {
        case 'PRESENT': return '#ECFDF5';
        case 'LATE': return '#FFFBEB';
        case 'HALF_DAY': return '#EEF2FF';
        case 'LEAVE': return '#F5F3FF';
        case 'ABSENT': return '#FEF2F2';
        default: return '#F1F5F9';
      }
    };

    const formatDateStr = (dateStr: string): string => {
      if (!dateStr) return '—';
      const parts = dateStr.split('-');
      if (parts.length !== 3) return dateStr;
      const mIdx = parseInt(parts[1], 10) - 1;
      const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${parts[2]} ${shortMonths[mIdx]} ${parts[0]}`;
    };

    const formatWorkHours = (checkIn?: Date | string | null, checkOut?: Date | string | null, breakSec: number = 0): string => {
      if (!checkIn || !checkOut) return '—';
      const inTime = new Date(checkIn);
      const outTime = new Date(checkOut);
      if (isNaN(inTime.getTime()) || isNaN(outTime.getTime())) return '—';
      const diffSec = Math.floor((outTime.getTime() - inTime.getTime()) / 1000) - (breakSec || 0);
      if (diffSec <= 0) return '0m';
      const hours = Math.floor(diffSec / 3600);
      const mins = Math.floor((diffSec % 3600) / 60);
      if (hours === 0) return `${mins}m`;
      if (mins === 0) return `${hours}h`;
      return `${hours}h ${mins}m`;
    };

    const totalRecords = attendanceData.length;
    const totalPresent = attendanceData.filter((a: any) => a.status === 'PRESENT').length;
    const totalLate = attendanceData.filter((a: any) => a.status === 'LATE').length;
    const totalAbsent = attendanceData.filter((a: any) => a.status === 'ABSENT').length;
    const totalWorkSec = attendanceData.reduce((sum: number, a: any) => sum + (parseFloat(a.totalworkseconds) || 0), 0);
    const avgWorkHoursStr = totalRecords > 0 ? `${(totalWorkSec / totalRecords / 3600).toFixed(1)}h` : '0h';

    const printer = new PdfPrinter({
      Roboto: {
        normal: 'Helvetica',
        bold: 'Helvetica-Bold',
        italics: 'Helvetica-Oblique',
        bolditalics: 'Helvetica-BoldOblique'
      }
    });

    const docDefinition: any = {
      pageSize: 'A4',
      pageOrientation: 'landscape',
      pageMargins: [20, 25, 20, 30],
      footer: (currentPage: number, pageCount: number) => ({
        columns: [
          { text: `HopKid HRM  •  Comprehensive Attendance Report`, style: 'footer', alignment: 'left' },
          { text: `Generated on ${generatedOn}  •  Page ${currentPage} of ${pageCount}`, style: 'footer', alignment: 'right' },
        ],
        margin: [20, 8, 20, 0],
      }),
      content: [
        // ── HEADER BANNER
        {
          canvas: [
            { type: 'rect', x: -20, y: -25, w: 842, h: 72, color: '#0F172A' },
            { type: 'rect', x: -20, y: 47, w: 842, h: 4, color: PRIMARY_COLOR },
          ],
        },
        {
          columns: [
            {
              stack: [
                { text: 'HOPKID HRM  •  ENTERPRISE REPORTS', fontSize: 8, bold: true, color: PRIMARY_COLOR, margin: [0, -58, 0, 2] },
                { text: 'Comprehensive Attendance Report', fontSize: 15, bold: true, color: 'white', margin: [0, 0, 0, 2] },
                { text: `Organisation-wide detailed logs  •  Period: ${monthLabel}`, fontSize: 8, color: '#94A3B8' },
              ],
            },
            {
              stack: [
                { text: `Period: ${monthLabel}`, fontSize: 10, bold: true, color: 'white', alignment: 'right', margin: [0, -58, 0, 4] },
                { text: `Generated By: ${req.user?.email || 'Admin'}`, fontSize: 8, color: '#94A3B8', alignment: 'right' },
                { text: `Generated On: ${generatedOn}`, fontSize: 8, color: '#94A3B8', alignment: 'right' },
              ],
            },
          ],
          margin: [0, 0, 0, 16],
        },

        // ── KPI SUMMARY STAT CARDS
        {
          columns: [
            {
              stack: [
                { text: totalRecords.toString(), fontSize: 18, bold: true, color: PRIMARY_COLOR, alignment: 'center' },
                { text: 'TOTAL RECORDS', fontSize: 7, bold: true, color: '#64748B', alignment: 'center', margin: [0, 2, 0, 0] },
              ],
              alignment: 'center',
            },
            {
              stack: [
                { text: totalPresent.toString(), fontSize: 18, bold: true, color: '#059669', alignment: 'center' },
                { text: 'PRESENT DAYS', fontSize: 7, bold: true, color: '#64748B', alignment: 'center', margin: [0, 2, 0, 0] },
              ],
              alignment: 'center',
            },
            {
              stack: [
                { text: totalLate.toString(), fontSize: 18, bold: true, color: '#D97706', alignment: 'center' },
                { text: 'LATE ARRIVALS', fontSize: 7, bold: true, color: '#64748B', alignment: 'center', margin: [0, 2, 0, 0] },
              ],
              alignment: 'center',
            },
            {
              stack: [
                { text: totalAbsent.toString(), fontSize: 18, bold: true, color: '#DC2626', alignment: 'center' },
                { text: 'ABSENT DAYS', fontSize: 7, bold: true, color: '#64748B', alignment: 'center', margin: [0, 2, 0, 0] },
              ],
              alignment: 'center',
            },
            {
              stack: [
                { text: avgWorkHoursStr, fontSize: 18, bold: true, color: '#6366F1', alignment: 'center' },
                { text: 'AVG WORK / DAY', fontSize: 7, bold: true, color: '#64748B', alignment: 'center', margin: [0, 2, 0, 0] },
              ],
              alignment: 'center',
            },
          ],
          margin: [0, 0, 0, 12],
        },
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 802, y2: 0, lineWidth: 1, lineColor: '#E2E8F0' }], margin: [0, 0, 0, 12] },

        // ── EMPLOYEE SECTIONS
        ...employees.map((emp, index) => [
          {
            columns: [
              { text: `Employee: ${emp.firstName} ${emp.lastName} (${emp.employeeCode})`, bold: true, fontSize: 10, color: '#0F172A' },
              { text: `Department: ${emp.departmentName || 'Operations'}  •  Store: ${emp.officeName || 'Headquarters'}`, fontSize: 8, color: '#64748B', alignment: 'right' },
            ],
            margin: [0, 6, 0, 6],
            pageBreak: index > 0 ? 'before' : undefined
          },
          {
            table: {
              headerRows: 1,
              dontBreakRows: true,
              widths: [48, 38, 75, 70, 60, 48, 48, 28, 42, 45, '*'],
              body: [
                [
                  { text: 'Date', style: 'colHeader' },
                  { text: 'Code', style: 'colHeader' },
                  { text: 'Employee Name', style: 'colHeader' },
                  { text: 'Store / Branch', style: 'colHeader' },
                  { text: 'Department', style: 'colHeader' },
                  { text: 'Check In', style: 'colHeader' },
                  { text: 'Check Out', style: 'colHeader' },
                  { text: 'Break', style: 'colHeader', alignment: 'center' },
                  { text: 'Work Hours', style: 'colHeader', alignment: 'center' },
                  { text: 'Status', style: 'colHeader', alignment: 'center' },
                  { text: 'Notes / Remarks', style: 'colHeader' }
                ],
                ...emp.attendances.map((att: any, i: number) => [
                  { text: formatDateStr(att.date), fontSize: 7.5, color: '#0F172A', fillColor: i % 2 === 0 ? '#F8FAFC' : 'white' },
                  { text: emp.employeeCode, fontSize: 7.5, color: '#64748B', fillColor: i % 2 === 0 ? '#F8FAFC' : 'white' },
                  { text: `${emp.firstName} ${emp.lastName}`, fontSize: 7.5, color: '#0F172A', fillColor: i % 2 === 0 ? '#F8FAFC' : 'white' },
                  { text: emp.officeName ? emp.officeName.replace(/-/g, '- ') : 'Headquarters', fontSize: 7.5, color: '#64748B', fillColor: i % 2 === 0 ? '#F8FAFC' : 'white' },
                  { text: emp.departmentName || 'Operations', fontSize: 7.5, color: '#64748B', fillColor: i % 2 === 0 ? '#F8FAFC' : 'white' },
                  { text: att.checkin ? new Date(att.checkin).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }) : '—', fontSize: 7.5, color: '#374151', fillColor: i % 2 === 0 ? '#F8FAFC' : 'white' },
                  { text: att.checkout ? new Date(att.checkout).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }) : '—', fontSize: 7.5, color: '#374151', fillColor: i % 2 === 0 ? '#F8FAFC' : 'white' },
                  { text: att.totalbreakseconds > 0 ? `${Math.floor(att.totalbreakseconds / 60)}m` : '—', fontSize: 7.5, color: '#374151', alignment: 'center', fillColor: i % 2 === 0 ? '#F8FAFC' : 'white' },
                  { text: formatWorkHours(att.checkin, att.checkout, att.totalbreakseconds), fontSize: 7.5, color: '#0F172A', alignment: 'center', bold: true, fillColor: i % 2 === 0 ? '#F8FAFC' : 'white' },
                  {
                    text: att.status || 'ABSENT',
                    fontSize: 7,
                    bold: true,
                    color: statusColor(att.status),
                    fillColor: statusBg(att.status),
                    alignment: 'center',
                  },
                  { text: att.notes || '—', fontSize: 7.5, color: '#64748B', fillColor: i % 2 === 0 ? '#F8FAFC' : 'white' }
                ])
              ]
            },
            layout: {
              hLineWidth: (i: number) => (i === 0 || i === 1) ? 1.5 : 0.5,
              vLineWidth: () => 0,
              hLineColor: (i: number) => i === 0 || i === 1 ? PRIMARY_COLOR : '#E2E8F0',
              paddingLeft: () => 4,
              paddingRight: () => 4,
              paddingTop: () => 3.5,
              paddingBottom: () => 3.5,
            },
            margin: [0, 0, 0, 14]
          }
        ]).flat()
      ],
      styles: {
        colHeader: { fontSize: 7.5, bold: true, color: 'white', fillColor: PRIMARY_COLOR, alignment: 'left' },
        footer: { fontSize: 7.5, color: '#94A3B8' }
      },
      defaultStyle: { font: 'Roboto' }
    };

    const pdfDoc = printer.createPdfKitDocument(docDefinition);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="comprehensive-attendance-report-${monthNum}-${yearNum}.pdf"`);

    pdfDoc.pipe(res);
    pdfDoc.end();

  } catch (error) {
    console.error('Download comprehensive report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download comprehensive report.',
      errorCode: 'DOWNLOAD_COMPREHENSIVE_REPORT_ERROR'
    });
  }
};
