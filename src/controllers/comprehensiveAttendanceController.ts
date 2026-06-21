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
    const startDate = new Date(yearNum, monthNum - 1, 1);
    const endDate = new Date(yearNum, monthNum, 0); // Last day of month

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
            WHEN EXTRACT(EPOCH FROM (a.checkOut - a.checkOut)) - a.totalBreakSeconds >= 14400 -- 4 hours
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
      WHERE a.date >= ${startDate.toISOString().split('T')[0]} 
        AND a.date <= ${endDate.toISOString().split('T')[0]}
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
        WHERE a.date >= ${startDate.toISOString().split('T')[0]} 
          AND a.date <= ${endDate.toISOString().split('T')[0]}
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
        WHERE a.date >= ${startDate.toISOString().split('T')[0]} 
          AND a.date <= ${endDate.toISOString().split('T')[0]}
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
          startDate: startDate.toISOString().split('T')[0],
          endDate: endDate.toISOString().split('T')[0],
          totalDays: endDate.getDate()
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
    const startDate = new Date(yearNum, monthNum - 1, 1);
    const endDate = new Date(yearNum, monthNum, 0);

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
      WHERE a.date >= ${startDate.toISOString().split('T')[0]}
        AND a.date <= ${endDate.toISOString().split('T')[0]}
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

    // Generate PDF
    const printer = new PdfPrinter({
      Roboto: {
        normal: 'Helvetica',
        bold: 'Helvetica-Bold',
        italics: 'Helvetica-Oblique',
        bolditalics: 'Helvetica-BoldOblique'
      }
    });

    const docDefinition = {
      content: [
        {
          canvas: [
            {
              type: 'rect',
              x: -20,
              y: -60,
              w: 595,
              h: 50,
              color: PRIMARY_COLOR
            }
          ]
        },
        {
          text: 'Comprehensive Attendance Report',
          style: 'header',
          color: 'white',
          alignment: 'center',
          margin: [0, -45, 0, 20]
        },
        {
          text: `Period: ${monthNum}/${yearNum}`,
          style: 'subheader',
          margin: [0, 0, 0, 10]
        },
        {
          text: `Generated by: ${req.user?.email || 'Admin'}`,
          style: 'subheader',
          margin: [0, 0, 0, 10]
        },
        {
          text: `Generated on: ${new Date().toLocaleDateString()}`,
          style: 'subheader',
          margin: [0, 0, 0, 20]
        },
        ...employees.map((emp, index) => [
          {
            text: `Employee: ${emp.firstName} ${emp.lastName} (${emp.employeeCode})`,
            style: 'subheader',
            margin: [0, 20, 0, 10],
            pageBreak: index > 0 ? 'before' : undefined
          },
          {
            columns: [
              {
                text: `Department: ${emp.departmentName || 'N/A'}`,
                style: 'normal'
              },
              {
                text: `Office: ${emp.officeName || 'N/A'}`,
                style: 'normal'
              }
            ],
            margin: [0, 0, 0, 10]
          },
          {
            text: 'Attendance Details',
            style: 'tableHeader',
            margin: [0, 0, 0, 10]
          },
          {
            table: {
              headerRows: 1,
              widths: ['auto', '*', '*', 'auto', 'auto'],
              body: [
                [
                  { text: 'Date', style: 'tableHeader' },
                  { text: 'Check In', style: 'tableHeader' },
                  { text: 'Check Out', style: 'tableHeader' },
                  { text: 'Status', style: 'tableHeader' },
                  { text: 'Work Hours', style: 'tableHeader' }
                ],
                ...emp.attendances.map((att: any) => [
                  att.date,
                  att.checkin ? new Date(att.checkin).toLocaleTimeString() : '--:--',
                  att.checkout ? new Date(att.checkout).toLocaleTimeString() : '--:--',
                  att.status,
                  att.totalworkseconds ? `${(parseFloat(att.totalworkseconds) / 3600).toFixed(2)}h` : '--'
                ])
              ]
            },
            margin: [0, 0, 0, 30]
          }
        ])
      ],
      pageMargins: [40, 60, 40, 60],
      styles: {
        header: {
          fontSize: 18,
          bold: true,
          margin: [0, 0, 0, 10]
        },
        subheader: {
          fontSize: 14,
          bold: true,
          margin: [0, 0, 0, 5]
        },
        normal: {
          fontSize: 12
        },
        tableHeader: {
          fontSize: 11,
          bold: true,
          color: PRIMARY_COLOR,
          margin: [0, 5, 0, 5]
        }
      }
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
