import { Request, Response } from 'express';
import { prisma } from '../../utils/db';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';
import { webSocketService } from '../..';
const PdfPrinter = require('pdfmake');

// Helper function to calculate distance between two coordinates
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c; // Distance in meters
}

// Helper function to check if user is within geofence
function isWithinGeofence(userLat: number, userLon: number, officeLat: number, officeLon: number, maxRadius: number): boolean {
  const distance = calculateDistance(userLat, userLon, officeLat, officeLon);
  return distance <= maxRadius;
}

// Helper function to resolve/normalize timezone abbreviations to standard IANA timezone identifiers
function resolveTimezone(tz: string | undefined | null, fallback: string = 'Asia/Kolkata'): string {
  if (!tz) return fallback;
  const normalized = tz.trim().toUpperCase();
  const mapping: { [key: string]: string } = {
    'IST': 'Asia/Kolkata',
    'UTC': 'UTC',
    'GMT': 'UTC',
    'EST': 'America/New_York',
    'EDT': 'America/New_York',
    'CST': 'America/Chicago',
    'CDT': 'America/Chicago',
    'MST': 'America/Denver',
    'MDT': 'America/Denver',
    'PST': 'America/Los_Angeles',
    'PDT': 'America/Los_Angeles',
  };
  const mapped = mapping[normalized] || tz;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: mapped });
    return mapped;
  } catch (e) {
    console.warn(`⚠️ Invalid timezone [${tz}] or mapped [${mapped}], falling back to ${fallback}`);
    return fallback;
  }
}

// Helper function to get local date string in YYYY-MM-DD format based on timezone
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
  } catch (e) {
    console.error('Error formatting local date string:', e);
    return dateInput.toISOString().split('T')[0];
  }
}


// Mobile Punch In
export const mobilePunchIn = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { latitude, longitude, notes, photo, clientTimestamp, timezone, isFingerprint = false } = req.body;
    
    // Enhanced logging for debugging
    console.log('🕒 MOBILE PUNCH IN REQUEST:', {
      timestamp: new Date().toISOString(),
      clientTimestamp,
      timezone,
      latitude,
      longitude,
      isFingerprint,
      userId: req.user?.id
    });
    
    if (latitude === undefined || longitude === undefined || latitude === null || longitude === null) {
      res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required.',
        errorCode: 'MISSING_LOCATION'
      });
      return;
    }

    // Get employee information
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
      include: {
        office: true,
        user: {
          include: { profile: true }
        }
      }
    });

    if (!employee) {
      res.status(404).json({
        success: false,
        message: 'Employee record not found.',
        errorCode: 'EMPLOYEE_NOT_FOUND'
      });
      return;
    }

    if (!employee.office) {
      res.status(400).json({
        success: false,
        message: 'No office assigned to employee.',
        errorCode: 'NO_OFFICE_ASSIGNED'
      });
      return;
    }

    // Determine the punch-in time with timezone handling
    let punchInTime: Date;
    if (clientTimestamp) {
      punchInTime = new Date(clientTimestamp);
      console.log('✅ Using client timestamp for punch-in:', punchInTime.toISOString());
    } else {
      punchInTime = new Date();
      console.log('📅 No client timestamp provided, using server timestamp');
    }

    // Check if already punched in today
    const profileTimezone = employee.user?.profile?.timezone || 'Asia/Kolkata';
    const userTimezone = resolveTimezone(timezone as string, profileTimezone);
    const today = getLocalDateString(userTimezone, punchInTime);
    const existingAttendance = await prisma.attendance.findFirst({
      where: {
        employeeId: employee.id,
        date: today,
        checkIn: { not: null }
      }
    });

    if (existingAttendance && existingAttendance.checkIn) {
      res.status(400).json({
        success: false,
        message: 'Already punched in today.',
        errorCode: 'ALREADY_PUNCHED_IN',
        data: {
          checkInTime: existingAttendance.checkIn,
          status: existingAttendance.status
        }
      });
      return;
    }

    // Check geofence (allow 0.0 for simulator testing in non-production environments)
    let punchLat = latitude;
    let punchLon = longitude;
    if (latitude === 0 && longitude === 0 && process.env.NODE_ENV !== 'production') {
      console.log('⚠️ Simulator location (0.0) detected. Bypassing geofence check for testing and mocking with office location.');
      punchLat = employee.office.latitude;
      punchLon = employee.office.longitude;
    } else {
      const isWithinRadius = isWithinGeofence(
        latitude, 
        longitude, 
        employee.office.latitude, 
        employee.office.longitude, 
        employee.office.maxPunchRadiusMeters
      );

      if (!isWithinRadius) {
        res.status(400).json({
          success: false,
          message: 'Location is outside the allowed geofence.',
          errorCode: 'OUTSIDE_GEOFENCE',
          data: {
            distance: calculateDistance(latitude, longitude, employee.office.latitude, employee.office.longitude),
            maxRadius: employee.office.maxPunchRadiusMeters,
            officeLocation: {
              latitude: employee.office.latitude,
              longitude: employee.office.longitude
            }
          }
        });
        return;
      }
    }
    
    // Create attendance record
    const attendance = await prisma.attendance.create({
      data: {
        employeeId: employee.id,
        officeId: employee.office.id,
        date: today,
        checkIn: punchInTime,
        status: 'PRESENT',
        notes: notes || '',
        latitude: punchLat,
        longitude: punchLon,
        isFingerprintCheckIn: isFingerprint,
      },
      include: {
        employee: {
          include: {
            user: {
              include: { profile: true }
            }
          }
        },
        office: true
      }
    });

    console.log('✅ PUNCH IN SUCCESSFUL:', {
      attendanceId: attendance.id,
      checkInTime: attendance.checkIn?.toISOString() || 'not set',
      timezone: timezone || 'not provided',
      clientTimestampUsed: clientTimestamp ? 'yes' : 'no'
    });
    
    // Broadcast real-time attendance update
    try {
      await webSocketService.broadcastAttendanceUpdate(employee.id, {
        type: 'punch_in',
        employeeId: employee.id,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        timestamp: attendance.checkIn,
        location: { latitude: attendance.latitude, longitude: attendance.longitude },
        status: 'PRESENT'
      });
    } catch (wsError) {
      console.error('❌ Failed to broadcast attendance update:', wsError);
    }
    
    res.json({
      success: true,
      message: 'Punched in successfully.',
      data: {
        id: attendance.id,
        employeeId: attendance.employeeId,
        checkIn: attendance.checkIn,
        checkInTime: attendance.checkIn,
        checkOut: null,
        isOnBreak: attendance.isOnBreak,
        breakStartTime: attendance.breakStartTime,
        totalBreakSeconds: attendance.totalBreakSeconds,
        location: {
          latitude: attendance.latitude,
          longitude: attendance.longitude
        },
        office: {
          name: attendance.office?.name,
          address: attendance.office?.address
        },
        status: attendance.status,
        notes: attendance.notes,
        timezone: timezone || 'UTC',
        timestampSource: clientTimestamp && attendance.checkIn && Math.abs(new Date(clientTimestamp).getTime() - attendance.checkIn.getTime()) <= 30 * 60 * 1000 ? 'client' : 'server'
      }
    });
  } catch (error) {
    console.error('Mobile punch in error:', error);
    res.status(500).json({
      success: false,
      message: 'Error during punch in.',
      errorCode: 'PUNCH_IN_ERROR'
    });
  }
};

// Mobile Punch Out
export const mobilePunchOut = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { latitude, longitude, notes, clientTimestamp, timezone, isFingerprint = false } = req.body;
    
    // Enhanced logging for debugging
    console.log('🕒 MOBILE PUNCH OUT REQUEST:', {
      timestamp: new Date().toISOString(),
      clientTimestamp,
      timezone,
      latitude,
      longitude,
      isFingerprint,
      userId: req.user?.id
    });

    // Get employee information
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
      include: {
        user: {
          include: { profile: true }
        }
      }
    });

    if (!employee) {
      res.status(404).json({
        success: false,
        message: 'Employee record not found.',
        errorCode: 'EMPLOYEE_NOT_FOUND'
      });
      return;
    }

    // Determine the punch-out time with timezone handling
    let punchOutTime: Date;
    if (clientTimestamp) {
      punchOutTime = new Date(clientTimestamp);
      console.log('✅ Using client timestamp for punch-out:', punchOutTime.toISOString());
    } else {
      punchOutTime = new Date();
      console.log('📅 No client timestamp provided, using server timestamp');
    }

    // Get today's attendance record
    const profileTimezone = employee.user?.profile?.timezone || 'Asia/Kolkata';
    const userTimezone = resolveTimezone(timezone as string, profileTimezone);
    const today = getLocalDateString(userTimezone, punchOutTime);
    const attendance = await prisma.attendance.findFirst({
      where: {
        employeeId: employee.id,
        date: today,
        checkIn: { not: null },
        checkOut: null
      }
    });

    if (!attendance) {
      res.status(400).json({
        success: false,
        message: 'No active punch in found for today.',
        errorCode: 'NO_ACTIVE_PUNCH_IN'
      });
      return;
    }

    // Check if on break
    if (attendance.isOnBreak) {
      res.status(400).json({
        success: false,
        message: 'Cannot punch out while on break. Please end break first.',
        errorCode: 'STILL_ON_BREAK'
      });
      return;
    }

    // Update attendance with punch out
    let punchLat = latitude;
    let punchLon = longitude;
    if (latitude === 0 && longitude === 0 && process.env.NODE_ENV !== 'production') {
      console.log('⚠️ Simulator location (0.0) detected for punch out.');
      punchLat = attendance.latitude || 0;
      punchLon = attendance.longitude || 0;
    } else {
      if (latitude === undefined || latitude === null) punchLat = attendance.latitude || 0;
      if (longitude === undefined || longitude === null) punchLon = attendance.longitude || 0;
    }

    const updatedAttendance = await prisma.attendance.update({
      where: { id: attendance.id },
      data: {
        checkOut: punchOutTime,
        latitude: punchLat,
        longitude: punchLon,
        notes: notes || attendance.notes,
        status: 'PRESENT',
        isFingerprintCheckOut: isFingerprint
      },
      include: {
        employee: {
          include: {
            user: {
              include: { profile: true }
            }
          }
        },
        office: true
      }
    });

    // Calculate work duration
    const workDuration = updatedAttendance.checkOut && updatedAttendance.checkIn 
      ? updatedAttendance.checkOut.getTime() - updatedAttendance.checkIn.getTime()
      : 0;

    const workHours = Math.floor(workDuration / (1000 * 60 * 60));
    const workMinutes = Math.floor((workDuration % (1000 * 60 * 60)) / (1000 * 60));

    console.log('✅ PUNCH OUT SUCCESSFUL:', {
      attendanceId: updatedAttendance.id,
      checkInTime: updatedAttendance.checkIn?.toISOString(),
      checkOutTime: updatedAttendance.checkOut?.toISOString(),
      workDurationMinutes: Math.floor(workDuration / (1000 * 60)),
      timezone: timezone || 'not provided',
      clientTimestampUsed: clientTimestamp ? 'yes' : 'no'
    });
    
    // Broadcast real-time attendance update
    try {
      await webSocketService.broadcastAttendanceUpdate(employee.id, {
        type: 'punch_out',
        employeeId: employee.id,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        timestamp: updatedAttendance.checkOut,
        location: { latitude: updatedAttendance.latitude, longitude: updatedAttendance.longitude },
        status: 'COMPLETED',
        workDuration: {
          hours: workHours,
          minutes: workMinutes,
          totalMinutes: Math.floor(workDuration / (1000 * 60))
        }
      });
    } catch (wsError) {
      console.error('❌ Failed to broadcast attendance update:', wsError);
    }

    res.json({
      success: true,
      message: 'Punched out successfully.',
      data: {
        id: updatedAttendance.id,
        employeeId: updatedAttendance.employeeId,
        checkIn: updatedAttendance.checkIn,
        checkInTime: updatedAttendance.checkIn,
        checkOut: updatedAttendance.checkOut,
        checkOutTime: updatedAttendance.checkOut,
        isOnBreak: updatedAttendance.isOnBreak,
        breakStartTime: updatedAttendance.breakStartTime,
        totalBreakSeconds: updatedAttendance.totalBreakSeconds,
        workDuration: {
          hours: workHours,
          minutes: workMinutes,
          totalMinutes: Math.floor(workDuration / (1000 * 60))
        },
        location: {
          latitude: updatedAttendance.latitude,
          longitude: updatedAttendance.longitude
        },
        status: updatedAttendance.status,
        timezone: timezone || 'UTC',
        timestampSource: clientTimestamp && updatedAttendance.checkOut && updatedAttendance.checkIn && 
          Math.abs(new Date(clientTimestamp).getTime() - updatedAttendance.checkOut.getTime()) <= 30 * 60 * 1000 ? 'client' : 'server'
      }
    });
  } catch (error) {
    console.error('Mobile punch out error:', error);
    res.status(500).json({
      success: false,
      message: 'Error during punch out.',
      errorCode: 'PUNCH_OUT_ERROR'
    });
  }
};

// Start Break
export const startBreak = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
      include: {
        office: true,
        user: {
          include: { profile: true }
        }
      }
    });

    if (!employee) {
      res.status(404).json({
        success: false,
        message: 'Employee record not found.',
        errorCode: 'EMPLOYEE_NOT_FOUND'
      });
      return;
    }

    if (!employee.office) {
      res.status(400).json({
        success: false,
        message: 'No office assigned to employee.',
        errorCode: 'NO_OFFICE_ASSIGNED'
      });
      return;
    }

    const { latitude, longitude, clientTimestamp } = req.body;

    if (latitude === undefined || longitude === undefined || latitude === null || longitude === null) {
      res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required.',
        errorCode: 'MISSING_LOCATION'
      });
      return;
    }

    // Check geofence (allow 0.0 for simulator testing in non-production environments)
    if (latitude === 0 && longitude === 0 && process.env.NODE_ENV !== 'production') {
      console.log('⚠️ Simulator location (0.0) detected. Bypassing geofence check for testing.');
    } else {
      const isWithinRadius = isWithinGeofence(
        latitude, 
        longitude, 
        employee.office.latitude, 
        employee.office.longitude, 
        employee.office.maxPunchRadiusMeters
      );

      if (!isWithinRadius) {
        res.status(400).json({
          success: false,
          message: 'Location is outside the allowed geofence.',
          errorCode: 'OUTSIDE_GEOFENCE',
          data: {
            distance: calculateDistance(latitude, longitude, employee.office.latitude, employee.office.longitude),
            maxRadius: employee.office.maxPunchRadiusMeters,
            officeLocation: {
              latitude: employee.office.latitude,
              longitude: employee.office.longitude
            }
          }
        });
        return;
      }
    }

    let breakStartTime: Date;
    if (clientTimestamp) {
      breakStartTime = new Date(clientTimestamp);
      console.log('✅ Using client timestamp for break start:', breakStartTime.toISOString());
    } else {
      breakStartTime = new Date();
      console.log('📅 No client timestamp provided for break start, using server timestamp');
    }

    // Get today's attendance record
    const userTimezone = employee.user?.profile?.timezone || 'Asia/Kolkata';
    const today = getLocalDateString(userTimezone, breakStartTime);
    const attendance = await prisma.attendance.findFirst({
      where: {
        employeeId: employee.id,
        date: today,
        checkIn: { not: null },
        checkOut: null
      }
    });

    if (!attendance) {
      res.status(400).json({
        success: false,
        message: 'No active attendance found.',
        errorCode: 'NO_ACTIVE_ATTENDANCE'
      });
      return;
    }

    if (attendance.isOnBreak) {
      res.status(400).json({
        success: false,
        message: 'Already on break.',
        errorCode: 'ALREADY_ON_BREAK'
      });
      return;
    }

    // Start break
    const updatedAttendance = await prisma.attendance.update({
      where: { id: attendance.id },
      data: {
        isOnBreak: true,
        breakStartTime: breakStartTime
      }
    });

    res.json({
      success: true,
      message: 'Break started successfully.',
      data: {
        breakStartTime: updatedAttendance.breakStartTime,
        status: 'ON_BREAK'
      }
    });
  } catch (error) {
    console.error('Start break error:', error);
    res.status(500).json({
      success: false,
      message: 'Error starting break.',
      errorCode: 'START_BREAK_ERROR'
    });
  }
};

// End Break
export const endBreak = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
      include: {
        office: true,
        user: {
          include: { profile: true }
        }
      }
    });

    if (!employee) {
      res.status(404).json({
        success: false,
        message: 'Employee record not found.',
        errorCode: 'EMPLOYEE_NOT_FOUND'
      });
      return;
    }

    if (!employee.office) {
      res.status(400).json({
        success: false,
        message: 'No office assigned to employee.',
        errorCode: 'NO_OFFICE_ASSIGNED'
      });
      return;
    }

    const { latitude, longitude, clientTimestamp } = req.body;

    if (latitude === undefined || longitude === undefined || latitude === null || longitude === null) {
      res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required.',
        errorCode: 'MISSING_LOCATION'
      });
      return;
    }

    // Check geofence (allow 0.0 for simulator testing in non-production environments)
    if (latitude === 0 && longitude === 0 && process.env.NODE_ENV !== 'production') {
      console.log('⚠️ Simulator location (0.0) detected. Bypassing geofence check for testing.');
    } else {
      const isWithinRadius = isWithinGeofence(
        latitude, 
        longitude, 
        employee.office.latitude, 
        employee.office.longitude, 
        employee.office.maxPunchRadiusMeters
      );

      if (!isWithinRadius) {
        res.status(400).json({
          success: false,
          message: 'Location is outside the allowed geofence.',
          errorCode: 'OUTSIDE_GEOFENCE',
          data: {
            distance: calculateDistance(latitude, longitude, employee.office.latitude, employee.office.longitude),
            maxRadius: employee.office.maxPunchRadiusMeters,
            officeLocation: {
              latitude: employee.office.latitude,
              longitude: employee.office.longitude
            }
          }
        });
        return;
      }
    }

    let breakEndTime: Date;
    if (clientTimestamp) {
      breakEndTime = new Date(clientTimestamp);
      console.log('✅ Using client timestamp for break end:', breakEndTime.toISOString());
    } else {
      breakEndTime = new Date();
      console.log('📅 No client timestamp provided for break end, using server timestamp');
    }

    // Get today's attendance record
    const userTimezone = employee.user?.profile?.timezone || 'Asia/Kolkata';
    const today = getLocalDateString(userTimezone, breakEndTime);
    const attendance = await prisma.attendance.findFirst({
      where: {
        employeeId: employee.id,
        date: today,
        isOnBreak: true
      }
    });

    if (!attendance) {
      res.status(400).json({
        success: false,
        message: 'No active break found.',
        errorCode: 'NO_ACTIVE_BREAK'
      });
      return;
    }

    // Calculate break duration and update attendance
    const breakEndTimeVar = breakEndTime;
    const breakDuration = attendance.breakStartTime 
      ? breakEndTimeVar.getTime() - attendance.breakStartTime.getTime()
      : 0;

    const updatedAttendance = await prisma.attendance.update({
      where: { id: attendance.id },
      data: {
        isOnBreak: false,
        breakStartTime: null,
        totalBreakSeconds: attendance.totalBreakSeconds + Math.floor(breakDuration / 1000)
      }
    });

    const breakMinutes = Math.floor(breakDuration / (1000 * 60));

    res.json({
      success: true,
      message: 'Break ended successfully.',
      data: {
        breakEndTime,
        breakDuration: {
          minutes: breakMinutes,
          seconds: Math.floor(breakDuration / 1000)
        },
        totalBreakTimeToday: updatedAttendance.totalBreakSeconds,
        status: 'ACTIVE'
      }
    });
  } catch (error) {
    console.error('End break error:', error);
    res.status(500).json({
      success: false,
      message: 'Error ending break.',
      errorCode: 'END_BREAK_ERROR'
    });
  }
};

// Get Today's Attendance Status
export const getTodayAttendance = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
      include: {
        office: true,
        user: {
          include: { profile: true }
        }
      }
    });

    if (!employee) {
      res.status(404).json({
        success: false,
        message: 'Employee record not found.',
        errorCode: 'EMPLOYEE_NOT_FOUND'
      });
      return;
    }

    const { clientTimestamp, timezone } = req.query;
    const profileTimezone = employee.user?.profile?.timezone || 'Asia/Kolkata';
    const userTimezone = resolveTimezone(timezone as string, profileTimezone);
    
    let dateInput = new Date();
    if (clientTimestamp) {
      dateInput = new Date(clientTimestamp as string);
    }
    const today = getLocalDateString(userTimezone, dateInput);
    
    const attendance = await prisma.attendance.findFirst({
      where: {
        employeeId: employee.id,
        date: today
      },
      include: {
        office: true
      }
    });

    const response = {
      id: attendance?.id,
      employeeId: employee.id,
      date: today,
      status: attendance?.status || 'ABSENT',
      checkIn: attendance?.checkIn,
      checkOut: attendance?.checkOut,
      isOnBreak: attendance?.isOnBreak || false,
      breakStartTime: attendance?.breakStartTime,
      totalBreakSeconds: attendance?.totalBreakSeconds || 0,
      notes: attendance?.notes || '',
      location: attendance ? {
        latitude: attendance.latitude,
        longitude: attendance.longitude
      } : null,
      office: employee.office ? {
        name: employee.office.name,
        address: employee.office.address,
        latitude: employee.office.latitude,
        longitude: employee.office.longitude,
        maxRadius: employee.office.maxPunchRadiusMeters
      } : null,
      canPunchIn: !attendance || (!attendance.checkIn && !attendance.checkOut),
      canPunchOut: attendance && attendance.checkIn && !attendance.checkOut && !attendance.isOnBreak,
      canStartBreak: attendance && attendance.checkIn && !attendance.checkOut && !attendance.isOnBreak,
      canEndBreak: attendance && attendance.isOnBreak
    };

    res.json({
      success: true,
      data: response
    });
  } catch (error) {
    console.error('Get today attendance error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching today\'s attendance.',
      errorCode: 'GET_TODAY_ATTENDANCE_ERROR'
    });
  }
};

// Get Attendance History
export const getAttendanceHistory = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { page = 1, limit = 10, month, year } = req.query;
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id }
    });

    if (!employee) {
      res.status(404).json({
        success: false,
        message: 'Employee record not found.',
        errorCode: 'EMPLOYEE_NOT_FOUND'
      });
      return;
    }

    // Build date filter
    let dateFilter = {};
    if (month && year) {
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const endDate = `${year}-${String(month).padStart(2, '0')}-31`;
      dateFilter = {
        date: {
          gte: startDate,
          lte: endDate
        }
      };
    }

    const skip = (Number(page) - 1) * Number(limit);
    
    const [attendances, total] = await Promise.all([
      prisma.attendance.findMany({
        where: {
          employeeId: employee.id,
          ...dateFilter
        },
        include: {
          office: true
        },
        orderBy: {
          date: 'desc'
        },
        skip,
        take: Number(limit)
      }),
      prisma.attendance.count({
        where: {
          employeeId: employee.id,
          ...dateFilter
        }
      })
    ]);

    const attendanceHistory = attendances.map(att => {
      const workDuration = att.checkIn && att.checkOut 
        ? att.checkOut.getTime() - att.checkIn.getTime()
        : 0;
      
      const workHours = Math.floor(workDuration / (1000 * 60 * 60));
      const workMinutes = Math.floor((workDuration % (1000 * 60 * 60)) / (1000 * 60));
      const breakMinutes = Math.floor((att.totalBreakSeconds || 0) / 60);

      return {
        id: att.id,
        employeeId: att.employeeId,
        date: att.date,
        status: att.status,
        checkIn: att.checkIn,
        checkOut: att.checkOut,
        workDuration: {
          hours: workHours,
          minutes: workMinutes,
          totalMinutes: Math.floor(workDuration / (1000 * 60))
        },
        breakTime: {
          minutes: breakMinutes,
          seconds: att.totalBreakSeconds || 0
        },
        notes: att.notes,
        location: att.latitude && att.longitude ? {
          latitude: att.latitude,
          longitude: att.longitude
        } : null,
        office: att.office ? {
          name: att.office.name,
          address: att.office.address
        } : null,
        isFingerprintCheckIn: att.isFingerprintCheckIn,
        isFingerprintCheckOut: att.isFingerprintCheckOut
      };
    });

    res.json({
      success: true,
      data: {
        attendances: attendanceHistory,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit))
        }
      }
    });
  } catch (error) {
    console.error('Get attendance history error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching attendance history.',
      errorCode: 'GET_ATTENDANCE_HISTORY_ERROR'
    });
  }
};

// Get Attendance Statistics
export const getAttendanceStats = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { month, year } = req.query;
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id }
    });

    if (!employee) {
      res.status(404).json({
        success: false,
        message: 'Employee record not found.',
        errorCode: 'EMPLOYEE_NOT_FOUND'
      });
      return;
    }

    // Build date filter
    let dateFilter = {};
    if (month && year) {
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const endDate = `${year}-${String(month).padStart(2, '0')}-31`;
      dateFilter = {
        date: {
          gte: startDate,
          lte: endDate
        }
      };
    } else {
      // Default to current month
      const now = new Date();
      const startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const endDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-31`;
      dateFilter = {
        date: {
          gte: startDate,
          lte: endDate
        }
      };
    }

    const attendances = await prisma.attendance.findMany({
      where: {
        employeeId: employee.id,
        ...dateFilter
      }
    });

    const stats = attendances.reduce((acc, att) => {
      const workDuration = att.checkIn && att.checkOut 
        ? att.checkOut.getTime() - att.checkIn.getTime()
        : 0;
      
      acc.totalDays += 1;
      acc.presentDays += att.status === 'PRESENT' ? 1 : 0;
      acc.absentDays += att.status === 'ABSENT' ? 1 : 0;
      acc.lateDays += att.status === 'LATE' ? 1 : 0;
      acc.halfDays += att.status === 'HALF_DAY' ? 1 : 0;
      acc.leaveDays += ['LEAVE', 'WEEKEND', 'HOLIDAY'].includes(att.status) ? 1 : 0;
      acc.totalWorkMinutes += Math.floor(workDuration / (1000 * 60));
      acc.totalBreakMinutes += Math.floor((att.totalBreakSeconds || 0) / 60);
      
      return acc;
    }, {
      totalDays: 0,
      presentDays: 0,
      absentDays: 0,
      lateDays: 0,
      halfDays: 0,
      leaveDays: 0,
      totalWorkMinutes: 0,
      totalBreakMinutes: 0
    });

    const totalWorkHours = Math.floor(stats.totalWorkMinutes / 60);
    const remainingWorkMinutes = stats.totalWorkMinutes % 60;
    const totalBreakHours = Math.floor(stats.totalBreakMinutes / 60);
    const remainingBreakMinutes = stats.totalBreakMinutes % 60;

    res.json({
      success: true,
      data: {
        period: month && year ? `${year}-${String(month).padStart(2, '0')}` : 'Current Month',
        totalDays: stats.totalDays,
        presentDays: stats.presentDays,
        absentDays: stats.absentDays,
        lateDays: stats.lateDays,
        halfDays: stats.halfDays,
        leaveDays: stats.leaveDays,
        attendanceRate: stats.totalDays > 0 ? (stats.presentDays / stats.totalDays * 100).toFixed(1) : '0',
        totalWorkTime: {
          hours: totalWorkHours,
          minutes: remainingWorkMinutes,
          totalMinutes: stats.totalWorkMinutes
        },
        totalBreakTime: {
          hours: totalBreakHours,
          minutes: remainingBreakMinutes,
          totalMinutes: stats.totalBreakMinutes
        },
        averageWorkHoursPerDay: stats.presentDays > 0 ? (stats.totalWorkMinutes / stats.presentDays / 60).toFixed(2) : '0'
      }
    });
  } catch (error) {
    console.error('Get attendance stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching attendance statistics.',
      errorCode: 'GET_ATTENDANCE_STATS_ERROR'
    });
  }
};

// Generate attendance report PDF for download (Employee - own attendance)
export const downloadMyAttendanceReport = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
      include: { office: true, department: true },
    });

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found' });
      return;
    }

    const { month } = req.query;
    const targetMonth = (month as string) || new Date().toISOString().slice(0, 7);

    const attendances = await prisma.attendance.findMany({
      where: {
        employeeId: employee.id,
        date: {
          startsWith: targetMonth,
        },
      },
      orderBy: { date: 'asc' },
    });

    // Calculate attendance statistics
    const present = attendances.filter((a) => a.status === 'PRESENT').length;
    const late = attendances.filter((a) => a.status === 'LATE').length;
    const absent = attendances.filter((a) => a.status === 'ABSENT').length;
    const halfDay = attendances.filter((a) => a.status === 'HALF_DAY').length;
    const leave = attendances.filter((a) => a.status === 'LEAVE').length;
    const totalDays = attendances.length;
    const attendanceRate = totalDays > 0 
      ? Math.round(((present + late + halfDay * 0.5) / totalDays) * 100)
      : 100;

    // PDF document definition
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
          text: 'Attendance Report',
          style: 'header',
          alignment: 'center',
          margin: [0, 0, 0, 20]
        },
        {
          columns: [
            {
              text: `Employee: ${employee.firstName} ${employee.lastName}`,
              style: 'subheader'
            },
            {
              text: `Employee Code: ${employee.employeeCode}`,
              style: 'subheader'
            }
          ],
          margin: [0, 0, 0, 10]
        },
        {
          columns: [
            {
              text: `Department: ${employee.department?.name || 'N/A'}`,
              style: 'normal'
            },
            {
              text: `Office: ${employee.office?.name || 'N/A'}`,
              style: 'normal'
            }
          ],
          margin: [0, 0, 0, 10]
        },
        {
          text: `Month: ${targetMonth}`,
          style: 'normal',
          margin: [0, 0, 0, 20]
        },
        {
          text: 'Attendance Summary',
          style: 'subheader',
          margin: [0, 0, 0, 10]
        },
        {
          ul: [
            `Present: ${present} days`,
            `Late: ${late} days`,
            `Absent: ${absent} days`,
            `Half Day: ${halfDay} days`,
            `Leave: ${leave} days`,
            `Attendance Rate: ${attendanceRate}%`
          ],
          margin: [0, 0, 0, 20]
        },
        {
          text: 'Daily Attendance Details',
          style: 'subheader',
          margin: [0, 0, 0, 10]
        },
        {
          table: {
            headerRows: 1,
            widths: ['*', '*', '*', '*'],
            body: [
              ['Date', 'Check In', 'Check Out', 'Status'],
              ...attendances.map(att => [
                att.date,
                att.checkIn ? new Date(att.checkIn).toLocaleTimeString() : '--:--',
                att.checkOut ? new Date(att.checkOut).toLocaleTimeString() : '--:--',
                att.status
              ])
            ]
          }
        }
      ],
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
        }
      }
    };

    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="attendance-report-${employee.employeeCode}-${new Date().toISOString().split('T')[0]}.pdf"`);
    
    pdfDoc.pipe(res);
    pdfDoc.end();
  } catch (error) {
    console.error('Download my attendance report error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to download attendance report.',
      errorCode: 'DOWNLOAD_MY_ATTENDANCE_REPORT_ERROR'
    });
  }
};

// Generate attendance report PDF for HR (all employees or specific employee)
export const downloadAttendanceReport = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { month, employeeId } = req.query;
    const targetMonth = (month as string) || new Date().toISOString().slice(0, 7);

    // Check if user is HR or Admin
    const user = await prisma.user.findUnique({
      where: { id: req.user?.id },
      include: { employee: true }
    });

    if (!user || (user.role !== 'HR' && user.role !== 'ADMIN')) {
      res.status(403).json({ success: false, message: 'Access denied. HR or Admin role required.' });
      return;
    }

    let employees;
    if (employeeId) {
      // Specific employee report
      employees = await prisma.employee.findMany({
        where: { id: parseInt(employeeId as string) },
        include: { office: true, department: true },
      });
    } else {
      // All employees report
      employees = await prisma.employee.findMany({
        include: { office: true, department: true },
      });
    }

    const attendances = await prisma.attendance.findMany({
      where: {
        employeeId: { in: employees.map(emp => emp.id) },
        date: {
          startsWith: targetMonth,
        },
      },
      orderBy: { date: 'asc' },
    });

    // Group attendances by employee
    const attendanceByEmployee: Record<number, typeof attendances> = {};
    attendances.forEach((att) => {
      if (!attendanceByEmployee[att.employeeId]) {
        attendanceByEmployee[att.employeeId] = [];
      }
      attendanceByEmployee[att.employeeId].push(att);
    });

    // Create employee data for PDF
    const employeeData = employees.map((emp) => {
      const empAtts = attendanceByEmployee[emp.id] || [];
      const present = empAtts.filter((a) => a.status === 'PRESENT').length;
      const late = empAtts.filter((a) => a.status === 'LATE').length;
      const absent = empAtts.filter((a) => a.status === 'ABSENT').length;
      const halfDay = empAtts.filter((a) => a.status === 'HALF_DAY').length;
      const leave = empAtts.filter((a) => a.status === 'LEAVE').length;
      const totalDays = empAtts.length;
      const attendanceRate = totalDays > 0 
        ? Math.round(((present + late + halfDay * 0.5) / totalDays) * 100)
        : 100;

      return {
        employee: emp,
        attendances: empAtts,
        present,
        late,
        absent,
        halfDay,
        leave,
        totalDays,
        attendanceRate
      };
    });

    // PDF document definition
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
          text: 'HR Attendance Report',
          style: 'header',
          alignment: 'center',
          margin: [0, 0, 0, 20]
        },
        {
          text: `Month: ${targetMonth}`,
          style: 'subheader',
          margin: [0, 0, 0, 20]
        },
        {
          text: `Generated by: ${user.employee?.firstName || user.email} (${user.role})`,
          style: 'normal',
          margin: [0, 0, 0, 20]
        },
        ...employeeData.map((empData, index) => [
          {
            text: `Employee: ${empData.employee.firstName} ${empData.employee.lastName} (${empData.employee.employeeCode})`,
            style: 'subheader',
            margin: [0, 20, 0, 10],
            pageBreak: index > 0 ? 'before' : undefined
          },
          {
            columns: [
              {
                text: `Department: ${empData.employee.department?.name || 'N/A'}`,
                style: 'normal'
              },
              {
                text: `Office: ${empData.employee.office?.name || 'N/A'}`,
                style: 'normal'
              }
            ],
            margin: [0, 0, 0, 10]
          },
          {
            text: 'Attendance Summary',
            style: 'subheader',
            margin: [0, 0, 0, 10]
          },
          {
            ul: [
              `Present: ${empData.present} days`,
              `Late: ${empData.late} days`,
              `Absent: ${empData.absent} days`,
              `Half Day: ${empData.halfDay} days`,
              `Leave: ${empData.leave} days`,
              `Attendance Rate: ${empData.attendanceRate}%`
            ],
            margin: [0, 0, 0, 20]
          },
          {
            text: 'Daily Attendance Details',
            style: 'subheader',
            margin: [0, 0, 0, 10]
          },
          {
            table: {
              headerRows: 1,
              widths: ['*', '*', '*', '*'],
              body: [
                ['Date', 'Check In', 'Check Out', 'Status'],
                ...empData.attendances.map(att => [
                  att.date,
                  att.checkIn ? new Date(att.checkIn).toLocaleTimeString() : '--:--',
                  att.checkOut ? new Date(att.checkOut).toLocaleTimeString() : '--:--',
                  att.status
                ])
              ]
            },
            margin: [0, 0, 0, 30]
          }
        ])
      ],
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
        }
      }
    };

    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="hr-attendance-report-${new Date().toISOString().split('T')[0]}.pdf"`);
    
    pdfDoc.pipe(res);
    pdfDoc.end();
  } catch (error) {
    console.error('Download attendance report error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to download attendance report.',
      errorCode: 'DOWNLOAD_ATTENDANCE_REPORT_ERROR'
    });
  }
};
