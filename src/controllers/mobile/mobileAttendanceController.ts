import { Request, Response } from 'express';
import { prisma } from '../../utils/db';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';
import { getWebSocketInstance } from '../../utils/websocketSingleton';
import geofenceService from '../../services/geofenceService';
import { Role } from '@prisma/client';
import { getEffectiveUserPermissions } from '../../utils/permissionHelper';
const PdfPrinter = require('pdfmake');
import auditLogService from '../../services/auditLogService';
import { logActivity } from '../../utils/activityLogger';

// Primary color for all PDF reports
const PRIMARY_COLOR = '#3BA38B';

// Interface for attendance with office data
interface AttendanceWithOffice {
  id: number;
  employeeId: number;
  officeId: number | null;
  date: string;
  checkIn: Date | null;
  checkOut: Date | null;
  status: string;
  notes: string | null;
  latitude: number | null;
  longitude: number | null;
  isFingerprintCheckIn: boolean;
  isFingerprintCheckOut: boolean;
  isOnBreak: boolean;
  breakStartTime: Date | null;
  totalBreakSeconds: number;
  isRemoteWork: boolean;
  createdAt: Date;
  updatedAt: Date;
  office?: {
    id: number;
    name: string;
    code: string | null;
    address: string;
    latitude: number;
    longitude: number;
    idealRadiusMeters: number;
    maxPunchRadiusMeters: number;
    isActive: boolean;
    subscriptionPlan: string;
    billingCycle: string;
    invoiceStatus: string;
    createdAt: Date;
    updatedAt: Date;
  } | null;
}

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
    const { latitude, longitude } = req.body;

    console.log('=== MOBILE ATTENDANCE PUNCH IN API CALLED ===');
    console.log('Request body:', { latitude, longitude });
    console.log('User making request:', req.user?.email, 'User ID:', req.user?.id);

    // Generate internal notes and timestamp
    const notes = 'Punch in recorded via mobile app';
    const clientTimestamp = new Date().toISOString();
    const timezone = 'Asia/Kolkata';
    const isFingerprint = false;

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

    // Get employee information with shift assignment
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
      include: {
        office: true,
        user: {
          include: { profile: true }
        },
        shiftAssignments: {
          where: {
            effectiveFrom: { lte: new Date() },
            OR: [
              { effectiveTo: null },
              { effectiveTo: { gte: new Date() } }
            ]
          },
          include: {
            shift: true
          },
          orderBy: { effectiveFrom: 'desc' },
          take: 1
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
        message: 'No office assigned to employee. Please contact HR.',
        errorCode: 'NO_OFFICE_ASSIGNED'
      });
      return;
    }

    // Check if office has valid coordinates
    if (!employee.office.latitude || !employee.office.longitude) {
      console.log('⚠️ Office coordinates are missing. Bypassing geofence check.');
      // Allow punch in without geofence if office coordinates are not set
    }

    // Use server timestamp for punch-in
    const punchInTime = new Date();
    console.log('✅ Using server timestamp for punch-in:', punchInTime.toISOString());

    // Fetch enableGeofence from settings
    const systemSettings = await prisma.systemSetting.findUnique({
      where: { id: 1 }
    });
    const rawAttendance = (systemSettings?.attendance as any) || {};
    const enableGeofence = rawAttendance.enableGeofence !== undefined ? rawAttendance.enableGeofence : true;

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
    
    // Enhanced debugging for geofence
    console.log('📍 Geofence Debug Info:', {
      userLocation: { latitude, longitude },
      environment: process.env.NODE_ENV
    });
    
    if (enableGeofence) {
      if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) {
        console.log('⚠️ Location coordinates are null/undefined. Using office location as fallback.');
        punchLat = employee.office.latitude || 0;
        punchLon = employee.office.longitude || 0;
      } else if (latitude === 0 && longitude === 0) {
        console.log('⚠️ Simulator location (0.0) detected. Bypassing geofence check.');
        punchLat = employee.office.latitude || 0;
        punchLon = employee.office.longitude || 0;
      } else {
        const geofenceResult = await geofenceService.checkGeofence(latitude, longitude, employee.id);
        
        console.log('📏 Geofence Service Result:', {
          isWithinGeofence: geofenceResult.isWithinGeofence,
          distance: Math.round(geofenceResult.distance),
          maxRadius: geofenceResult.maxRadius,
          officeName: geofenceResult.officeName
        });

        const isWithinRadius = process.env.NODE_ENV === 'production' 
          ? geofenceResult.isWithinGeofence 
          : geofenceResult.distance <= (geofenceResult.maxRadius * 50); // 50x more lenient in development

        if (!isWithinRadius) {
          res.status(400).json({
            success: false,
            message: `Location is outside the allowed geofence. Distance: ${Math.round(geofenceResult.distance)}m, Max allowed: ${geofenceResult.maxRadius}m`,
            errorCode: 'OUTSIDE_GEOFENCE',
            data: {
              distance: Math.round(geofenceResult.distance),
              maxRadius: geofenceResult.maxRadius,
              userLocation: { latitude, longitude }
            }
          });
          return;
        }
        
        punchLat = latitude;
        punchLon = longitude;
      }
    }
    
    // Calculate late arrival based on shift assignment
    let attendanceStatus = 'PRESENT';
    let isLate = false;
    
    if (employee.shiftAssignments.length > 0) {
      const activeShiftAssignment = employee.shiftAssignments[0];
      const shift = activeShiftAssignment.shift;
      
      // Check if today is a working day for this shift
      const dayOfWeek = punchInTime.toLocaleDateString('en-US', { weekday: 'long' });
      if (shift.workingDays.includes(dayOfWeek)) {
        // Parse shift start time
        const [shiftHours, shiftMinutes] = shift.startTime.split(':').map(Number);
        const shiftStartTime = new Date(punchInTime);
        shiftStartTime.setHours(shiftHours, shiftMinutes, 0, 0);
        
        // Add grace minutes
        const graceTime = new Date(shiftStartTime.getTime() + shift.graceMinutes * 60000);
        
        // Check if punch-in is after grace time
        if (punchInTime > graceTime) {
          attendanceStatus = 'LATE';
          isLate = true;
          console.log('⏰ Late arrival detected:', {
            shiftStartTime: shiftStartTime.toISOString(),
            graceTime: graceTime.toISOString(),
            punchInTime: punchInTime.toISOString(),
            graceMinutes: shift.graceMinutes
          });
        }
      }
    }
    
    // Check if remote work is active for this punch-in
    const empIdStr = String(employee.id);
    const activeRemoteReq = await prisma.remoteWorkRequest.findFirst({
      where: {
        employeeId: empIdStr,
        status: 'APPROVED',
        fromDate: { lte: punchInTime },
        toDate: { gte: punchInTime }
      }
    });
    const isRemote = Boolean(activeRemoteReq);

    // Create attendance record
    const attendance = await prisma.attendance.create({
      data: {
        employeeId: employee.id,
        officeId: employee.office.id,
        date: today,
        checkIn: punchInTime,
        status: attendanceStatus,
        notes: notes || (isRemote ? 'Punch in recorded via Remote Work' : 'Punch in recorded via mobile app'),
        latitude: punchLat,
        longitude: punchLon,
        isFingerprintCheckIn: isFingerprint,
        isRemoteWork: isRemote,
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

    // Audit Log
    await auditLogService.log({
      userId: employee.userId || undefined,
      employeeId: employee.id,
      branchId: employee.officeId || undefined,
      ipAddress: req.ip || req.socket.remoteAddress,
      deviceInfo: req.headers['user-agent'] || 'Mobile App',
      action: 'ATTENDANCE_PUNCH_IN',
    });

    console.log('✅ PUNCH IN SUCCESSFUL:', {
      attendanceId: attendance.id,
      checkInTime: attendance.checkIn?.toISOString() || 'not set',
      timezone: timezone || 'not provided',
      clientTimestampUsed: clientTimestamp ? 'yes' : 'no'
    });
    
    // Broadcast real-time attendance update
    try {
      await getWebSocketInstance().broadcastAttendanceUpdate(employee.id, {
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

    logActivity({
      actorId: req.user?.id,
      actorName: `${employee.firstName} ${employee.lastName}`,
      actorRole: req.user?.role || 'EMPLOYEE',
      source: 'MOBILE',
      action: 'ATTENDANCE_CHECK_IN',
      entityType: 'Attendance',
      entityId: attendance.id,
      description: `Employee ${employee.firstName} ${employee.lastName} punched in (${attendance.office?.name || 'Office'})`,
      metadata: { latitude, longitude, checkInTime: attendance.checkIn },
      ipAddress: req.ip || null,
      userAgent: req.headers['user-agent'] || null,
      status: 'SUCCESS'
    }).catch(() => null);

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
        notes: notes,
        clientTimestamp: clientTimestamp,
        timezone: timezone || 'UTC',
        timestampSource: 'server'
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
    const {
      latitude,
      longitude,
      notes = 'Punch out recorded via mobile app',
      clientTimestamp = new Date().toISOString(),
      timezone = 'Asia/Kolkata',
      isFingerprint = false
    } = req.body;

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
        },
        office: true,
        department: true
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

    // Use server timestamp for punch-out
    const punchOutTime = new Date();
    console.log('✅ Using server timestamp for punch-out:', punchOutTime.toISOString());

    // Fetch enableGeofence from settings
    const systemSettings = await prisma.systemSetting.findUnique({
      where: { id: 1 }
    });
    const rawAttendance = (systemSettings?.attendance as any) || {};
    const enableGeofence = rawAttendance.enableGeofence !== undefined ? rawAttendance.enableGeofence : true;
    const enablePunchOutGeofence = rawAttendance.enablePunchOutGeofence !== undefined ? rawAttendance.enablePunchOutGeofence : false;

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

    // Check geofence for punch out (same logic as punch in)
    let punchLat = latitude;
    let punchLon = longitude;
    
    // Enhanced debugging for geofence
    console.log('📍 Punch Out Geofence Debug Info:', {
      userLocation: { latitude, longitude },
      environment: process.env.NODE_ENV
    });
    
    if (enableGeofence && enablePunchOutGeofence) {
      if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) {
        console.log('⚠️ Location coordinates are null/undefined for punch out. Using punch-in location as fallback.');
        punchLat = attendance.latitude || (employee.office ? employee.office.latitude : 0);
        punchLon = attendance.longitude || (employee.office ? employee.office.longitude : 0);
      } else if (latitude === 0 && longitude === 0) {
        console.log('⚠️ Simulator location (0.0) detected for punch out. Bypassing geofence check.');
        punchLat = attendance.latitude || (employee.office ? employee.office.latitude : 0);
        punchLon = attendance.longitude || (employee.office ? employee.office.longitude : 0);
      } else {
        const geofenceResult = await geofenceService.checkGeofence(latitude, longitude, employee.id);
        
        console.log('📏 Geofence Service Result for Punch Out:', {
          isWithinGeofence: geofenceResult.isWithinGeofence,
          distance: Math.round(geofenceResult.distance),
          maxRadius: geofenceResult.maxRadius,
          officeName: geofenceResult.officeName
        });

        const isWithinRadius = process.env.NODE_ENV === 'production' 
          ? geofenceResult.isWithinGeofence 
          : geofenceResult.distance <= (geofenceResult.maxRadius * 50); // 50x more lenient in development

        if (!isWithinRadius) {
          res.status(400).json({
            success: false,
            message: `Location is outside the allowed geofence for punch out. Distance: ${Math.round(geofenceResult.distance)}m, Max allowed: ${geofenceResult.maxRadius}m`,
            errorCode: 'OUTSIDE_GEOFENCE',
            data: {
              distance: Math.round(geofenceResult.distance),
              maxRadius: geofenceResult.maxRadius,
              userLocation: { latitude, longitude }
            }
          });
          return;
        }
        
        punchLat = latitude;
        punchLon = longitude;
      }
    } else {
      console.log('⚠️ Geofence validation is disabled for punch out. Bypassing check.');
      punchLat = latitude || attendance.latitude || 0;
      punchLon = longitude || attendance.longitude || 0;
    }

    // Calculate total break time including current break if any
    const totalBreakSec = attendance.totalBreakSeconds;
    
    // Work duration in milliseconds
    const checkInTime = attendance.checkIn ? new Date(attendance.checkIn) : new Date();
    const workDurationMs = punchOutTime.getTime() - checkInTime.getTime();
    const netWorkHours = (workDurationMs / 1000 - totalBreakSec) / 3600;

    const fullDayMinHoursSetting = rawAttendance.fullDayMinHours !== undefined ? Number(rawAttendance.fullDayMinHours) : 8;
    const halfDayMinHoursSetting = rawAttendance.halfDayMinHours !== undefined ? Number(rawAttendance.halfDayMinHours) : 4;

    let calculatedStatus = 'PRESENT';
    if (netWorkHours < halfDayMinHoursSetting) {
      calculatedStatus = 'ABSENT';
    } else if (netWorkHours < fullDayMinHoursSetting) {
      calculatedStatus = 'HALF_DAY';
    } else {
      calculatedStatus = attendance.status === 'LATE' ? 'LATE' : 'PRESENT';
    }

    const updatedAttendance = await prisma.attendance.update({
      where: { id: attendance.id },
      data: {
        checkOut: punchOutTime,
        latitude: punchLat,
        longitude: punchLon,
        notes: notes || attendance.notes,
        status: calculatedStatus,
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

    // Audit Log
    await auditLogService.log({
      userId: employee.userId || undefined,
      employeeId: employee.id,
      branchId: employee.officeId || undefined,
      ipAddress: req.ip || req.socket.remoteAddress,
      deviceInfo: req.headers['user-agent'] || 'Mobile App',
      action: 'ATTENDANCE_PUNCH_OUT',
    });

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
      await getWebSocketInstance().broadcastAttendanceUpdate(employee.id, {
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

    logActivity({
      actorId: req.user?.id,
      actorName: `${employee.firstName} ${employee.lastName}`,
      actorRole: req.user?.role || 'EMPLOYEE',
      source: 'MOBILE',
      action: 'ATTENDANCE_CHECK_OUT',
      entityType: 'Attendance',
      entityId: updatedAttendance.id,
      description: `Employee ${employee.firstName} ${employee.lastName} punched out (${workHours}h ${workMinutes}m worked)`,
      metadata: { checkOutTime: updatedAttendance.checkOut, workHours, workMinutes },
      ipAddress: req.ip || null,
      userAgent: req.headers['user-agent'] || null,
      status: 'SUCCESS'
    }).catch(() => null);

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
        notes: notes,
        clientTimestamp: clientTimestamp,
        timezone: timezone || 'UTC',
        timestampSource: 'server'
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

// Attendance Correction Request
export const requestAttendanceCorrection = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { attendanceId, correctionType, requestedCheckIn, requestedCheckOut, reason } = req.body;

    if (!attendanceId || !correctionType || !reason) {
      res.status(400).json({
        success: false,
        message: 'Attendance ID, correction type, and reason are required.',
        errorCode: 'MISSING_REQUIRED_FIELDS'
      });
      return;
    }

    // Get employee information
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
      include: { user: true }
    });

    if (!employee) {
      res.status(404).json({
        success: false,
        message: 'Employee record not found.',
        errorCode: 'EMPLOYEE_NOT_FOUND'
      });
      return;
    }

    // Get attendance record
    const attendance = await prisma.attendance.findFirst({
      where: { 
        id: parseInt(attendanceId),
        employeeId: employee.id
      }
    });

    if (!attendance) {
      res.status(404).json({
        success: false,
        message: 'Attendance record not found.',
        errorCode: 'ATTENDANCE_NOT_FOUND'
      });
      return;
    }

    // Create correction request
    const correctionRequest = await prisma.attendanceCorrection.create({
      data: {
        attendanceId: attendance.id,
        employeeId: employee.id,
        correctionType,
        requestedCheckIn: requestedCheckIn ? new Date(requestedCheckIn) : null,
        requestedCheckOut: requestedCheckOut ? new Date(requestedCheckOut) : null,
        originalCheckIn: attendance.checkIn,
        originalCheckOut: attendance.checkOut,
        reason,
        status: 'PENDING',
        requestedBy: req.user?.email || 'Unknown'
      }
    });

    // Send notification to HR
    await prisma.notification.create({
      data: {
        title: 'Attendance Correction Request',
        body: `${employee.firstName} ${employee.lastName} has requested a ${correctionType.toLowerCase()} correction for ${attendance.date}.`,
        category: 'ATTENDANCE',
        actionId: correctionRequest.id.toString(),
        actionType: 'ATTENDANCE_CORRECTION'
      }
    });

    // Broadcast real-time update
    try {
      await getWebSocketInstance().broadcastNotification(employee.id, {
        title: 'Attendance Correction Requested',
        body: `Your attendance correction request for ${attendance.date} has been submitted for review.`,
        type: 'attendance_correction',
        attendanceId: attendance.id,
        status: 'PENDING'
      });
    } catch (wsError) {
      console.error('❌ Failed to broadcast attendance correction update:', wsError);
    }

    res.json({
      success: true,
      message: 'Attendance correction request submitted successfully.',
      correctionRequest
    });
  } catch (error) {
    console.error('Attendance correction request error:', error);
    res.status(500).json({
      success: false,
      message: 'Error submitting attendance correction request.',
      errorCode: 'CORRECTION_REQUEST_ERROR'
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

    // Save multiple breaks in BreakRecord
    await prisma.breakRecord.create({
      data: {
        attendanceId: attendance.id,
        startTime: breakStartTime
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

    // Update active BreakRecord
    const activeBreakRecord = await prisma.breakRecord.findFirst({
      where: {
        attendanceId: attendance.id,
        endTime: null
      },
      orderBy: { startTime: 'desc' }
    });

    if (activeBreakRecord) {
      const durationSec = Math.floor(breakDuration / 1000);
      await prisma.breakRecord.update({
        where: { id: activeBreakRecord.id },
        data: {
          endTime: breakEndTimeVar,
          duration: durationSec
        }
      });
    }

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
        office: true,
        breakRecords: true
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
      breakRecords: attendance?.breakRecords || [],
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
          office: true,
          breakRecords: true
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

    const attendanceHistory = attendances.map((att: any) => {
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
        breakRecords: att.breakRecords || [],
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

    interface AttendanceStats {
      totalDays: number;
      presentDays: number;
      absentDays: number;
      lateDays: number;
      halfDays: number;
      leaveDays: number;
      totalWorkMinutes: number;
      totalBreakMinutes: number;
    }

    const stats = attendances.reduce((acc: AttendanceStats, att: AttendanceWithOffice) => {
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
    const targetMonth = (month as string) || getLocalDateString('Asia/Kolkata').slice(0, 7);

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
    const present = attendances.filter((a: any) => a.status === 'PRESENT').length;
    const late = attendances.filter((a: any) => a.status === 'LATE').length;
    const absent = attendances.filter((a: any) => a.status === 'ABSENT').length;
    const halfDay = attendances.filter((a: any) => a.status === 'HALF_DAY').length;
    const leave = attendances.filter((a: any) => a.status === 'LEAVE').length;
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

    const generatedOn = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });

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

    const docDefinition: any = {
      pageSize: 'A4',
      pageOrientation: 'portrait',
      pageMargins: [36, 40, 36, 45],
      footer: (currentPage: number, pageCount: number) => ({
        columns: [
          { text: `HOPKID  •  Employee Attendance Report`, style: 'footer', alignment: 'left' },
          { text: `Generated on ${generatedOn}  •  Page ${currentPage} of ${pageCount}`, style: 'footer', alignment: 'right' },
        ],
        margin: [36, 12, 36, 0],
      }),
      content: [
        // ── HEADER BANNER
        {
          canvas: [
            { type: 'rect', x: -36, y: -40, w: 595, h: 80, color: '#0F172A' },
            { type: 'rect', x: -36, y: 40, w: 595, h: 4, color: PRIMARY_COLOR },
          ],
        },
        {
          columns: [
            {
              stack: [
                { text: 'HOPKID  •  MY ATTENDANCE REPORT', fontSize: 8, bold: true, color: PRIMARY_COLOR, margin: [0, -68, 0, 2] },
                { text: `${employee.firstName} ${employee.lastName}`, fontSize: 16, bold: true, color: 'white', margin: [0, 0, 0, 2] },
                { text: `Code: ${employee.employeeCode}  •  Dept: ${employee.department?.name || 'Operations'}  •  Store: ${employee.office?.name || 'Headquarters'}`, fontSize: 9, color: '#94A3B8' },
              ],
            },
            {
              stack: [
                { text: `Month: ${targetMonth}`, fontSize: 10, bold: true, color: 'white', alignment: 'right', margin: [0, -68, 0, 4] },
                { text: `Generated On: ${generatedOn}`, fontSize: 8, color: '#94A3B8', alignment: 'right' },
              ],
            },
          ],
          margin: [0, 0, 0, 20],
        },

        // ── SUMMARY STAT CARDS
        {
          columns: [
            {
              stack: [
                { text: totalDays.toString(), fontSize: 18, bold: true, color: PRIMARY_COLOR, alignment: 'center' },
                { text: 'TOTAL DAYS', fontSize: 7, bold: true, color: '#64748B', alignment: 'center', margin: [0, 2, 0, 0] },
              ],
              alignment: 'center',
            },
            {
              stack: [
                { text: present.toString(), fontSize: 18, bold: true, color: '#059669', alignment: 'center' },
                { text: 'PRESENT', fontSize: 7, bold: true, color: '#64748B', alignment: 'center', margin: [0, 2, 0, 0] },
              ],
              alignment: 'center',
            },
            {
              stack: [
                { text: late.toString(), fontSize: 18, bold: true, color: '#D97706', alignment: 'center' },
                { text: 'LATE', fontSize: 7, bold: true, color: '#64748B', alignment: 'center', margin: [0, 2, 0, 0] },
              ],
              alignment: 'center',
            },
            {
              stack: [
                { text: (absent + leave).toString(), fontSize: 18, bold: true, color: '#DC2626', alignment: 'center' },
                { text: 'ABSENT/LEAVE', fontSize: 7, bold: true, color: '#64748B', alignment: 'center', margin: [0, 2, 0, 0] },
              ],
              alignment: 'center',
            },
            {
              stack: [
                { text: `${attendanceRate}%`, fontSize: 18, bold: true, color: '#6366F1', alignment: 'center' },
                { text: 'RATE', fontSize: 7, bold: true, color: '#64748B', alignment: 'center', margin: [0, 2, 0, 0] },
              ],
              alignment: 'center',
            },
          ],
          margin: [0, 0, 0, 14],
        },
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 523, y2: 0, lineWidth: 1, lineColor: '#E2E8F0' }], margin: [0, 0, 0, 14] },

        // ── ATTENDANCE DETAILS TABLE
        { text: 'Daily Attendance Details', bold: true, fontSize: 11, color: '#0F172A', margin: [0, 0, 0, 8] },
        {
          table: {
            headerRows: 1,
            dontBreakRows: true,
            widths: [80, 85, 85, 55, 75, '*'],
            body: [
              [
                { text: 'Date', style: 'colHeader' },
                { text: 'Check In', style: 'colHeader' },
                { text: 'Check Out', style: 'colHeader' },
                { text: 'Break', style: 'colHeader', alignment: 'center' },
                { text: 'Work Hours', style: 'colHeader', alignment: 'center' },
                { text: 'Status', style: 'colHeader', alignment: 'center' },
              ],
              ...attendances.map((att: AttendanceWithOffice, i: number) => [
                { text: formatDateStr(att.date), fontSize: 8, color: '#0F172A', fillColor: i % 2 === 0 ? '#F8FAFC' : 'white' },
                { text: att.checkIn ? new Date(att.checkIn).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }) : '—', fontSize: 8, color: '#374151', fillColor: i % 2 === 0 ? '#F8FAFC' : 'white' },
                { text: att.checkOut ? new Date(att.checkOut).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }) : '—', fontSize: 8, color: '#374151', fillColor: i % 2 === 0 ? '#F8FAFC' : 'white' },
                { text: att.totalBreakSeconds > 0 ? `${Math.floor(att.totalBreakSeconds / 60)}m` : '—', fontSize: 8, color: '#374151', alignment: 'center', fillColor: i % 2 === 0 ? '#F8FAFC' : 'white' },
                { text: formatWorkHours(att.checkIn, att.checkOut, att.totalBreakSeconds), fontSize: 8, color: '#0F172A', alignment: 'center', bold: true, fillColor: i % 2 === 0 ? '#F8FAFC' : 'white' },
                {
                  text: att.status,
                  fontSize: 7,
                  bold: true,
                  color: statusColor(att.status),
                  fillColor: statusBg(att.status),
                  alignment: 'center',
                },
              ])
            ]
          },
          layout: {
            hLineWidth: (i: number) => (i === 0 || i === 1) ? 1.5 : 0.5,
            vLineWidth: () => 0,
            hLineColor: (i: number) => i === 0 || i === 1 ? PRIMARY_COLOR : '#E2E8F0',
            paddingLeft: () => 6,
            paddingRight: () => 6,
            paddingTop: () => 5,
            paddingBottom: () => 5,
          },
          margin: [0, 0, 0, 16]
        }
      ],
      styles: {
        colHeader: { fontSize: 8, bold: true, color: 'white', fillColor: PRIMARY_COLOR, alignment: 'left' },
        footer: { fontSize: 8, color: '#94A3B8' }
      },
      defaultStyle: { font: 'Roboto' }
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
    const targetMonth = (month as string) || getLocalDateString('Asia/Kolkata').slice(0, 7);

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
        employeeId: { in: employees.map((emp: any) => emp.id) },
        date: {
          startsWith: targetMonth,
        },
      },
      orderBy: { date: 'asc' },
    });

    // Group attendances by employee
    const attendanceByEmployee: Record<number, typeof attendances> = {};
    attendances.forEach((att: AttendanceWithOffice) => {
      if (!attendanceByEmployee[att.employeeId]) {
        attendanceByEmployee[att.employeeId] = [];
      }
      attendanceByEmployee[att.employeeId].push(att);
    });

    // Create employee data for PDF
    const employeeData = employees.map((emp: any) => {
      const empAtts = attendanceByEmployee[emp.id] || [];
      const present = empAtts.filter((a: AttendanceWithOffice) => a.status === 'PRESENT').length;
      const late = empAtts.filter((a: AttendanceWithOffice) => a.status === 'LATE').length;
      const absent = empAtts.filter((a: AttendanceWithOffice) => a.status === 'ABSENT').length;
      const halfDay = empAtts.filter((a: AttendanceWithOffice) => a.status === 'HALF_DAY').length;
      const leave = empAtts.filter((a: AttendanceWithOffice) => a.status === 'LEAVE').length;
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

    const generatedOn = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });

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

    const docDefinition: any = {
      pageSize: 'A4',
      pageOrientation: 'landscape',
      pageMargins: [20, 25, 20, 30],
      footer: (currentPage: number, pageCount: number) => ({
        columns: [
          { text: `HOPKID  •  HR Attendance Summary Report`, style: 'footer', alignment: 'left' },
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
                { text: 'HOPKID  •  HR MANAGEMENT REPORTS', fontSize: 8, bold: true, color: PRIMARY_COLOR, margin: [0, -58, 0, 2] },
                { text: 'HR Attendance Report', fontSize: 15, bold: true, color: 'white', margin: [0, 0, 0, 2] },
                { text: `Organisation-wide employee logs  •  Month: ${targetMonth}`, fontSize: 8, color: '#94A3B8' },
              ],
            },
            {
              stack: [
                { text: `Month: ${targetMonth}`, fontSize: 10, bold: true, color: 'white', alignment: 'right', margin: [0, -58, 0, 4] },
                { text: `Generated By: ${user.employee?.firstName || user.email} (${user.role})`, fontSize: 8, color: '#94A3B8', alignment: 'right' },
                { text: `Generated On: ${generatedOn}`, fontSize: 8, color: '#94A3B8', alignment: 'right' },
              ],
            },
          ],
          margin: [0, 0, 0, 16],
        },

        // ── EMPLOYEE SECTIONS
        ...employeeData.map((empData: any, index: number) => [
          {
            columns: [
              { text: `Employee: ${empData.employee.firstName} ${empData.employee.lastName} (${empData.employee.employeeCode})`, bold: true, fontSize: 10, color: '#0F172A' },
              { text: `Dept: ${empData.employee.department?.name || 'Operations'}  •  Store: ${empData.employee.office?.name || 'Headquarters'}  •  Rate: ${empData.attendanceRate}%`, fontSize: 8, color: '#64748B', alignment: 'right' },
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
                ...empData.attendances.map((att: AttendanceWithOffice, i: number) => [
                  { text: formatDateStr(att.date), fontSize: 7.5, color: '#0F172A', fillColor: i % 2 === 0 ? '#F8FAFC' : 'white' },
                  { text: empData.employee.employeeCode, fontSize: 7.5, color: '#64748B', fillColor: i % 2 === 0 ? '#F8FAFC' : 'white' },
                  { text: `${empData.employee.firstName} ${empData.employee.lastName}`, fontSize: 7.5, color: '#0F172A', fillColor: i % 2 === 0 ? '#F8FAFC' : 'white' },
                  { text: empData.employee.office?.name ? empData.employee.office.name.replace(/-/g, '- ') : 'Headquarters', fontSize: 7.5, color: '#64748B', fillColor: i % 2 === 0 ? '#F8FAFC' : 'white' },
                  { text: empData.employee.department?.name || 'Operations', fontSize: 7.5, color: '#64748B', fillColor: i % 2 === 0 ? '#F8FAFC' : 'white' },
                  { text: att.checkIn ? new Date(att.checkIn).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }) : '—', fontSize: 7.5, color: '#374151', fillColor: i % 2 === 0 ? '#F8FAFC' : 'white' },
                  { text: att.checkOut ? new Date(att.checkOut).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }) : '—', fontSize: 7.5, color: '#374151', fillColor: i % 2 === 0 ? '#F8FAFC' : 'white' },
                  { text: att.totalBreakSeconds > 0 ? `${Math.floor(att.totalBreakSeconds / 60)}m` : '—', fontSize: 7.5, color: '#374151', alignment: 'center', fillColor: i % 2 === 0 ? '#F8FAFC' : 'white' },
                  { text: formatWorkHours(att.checkIn, att.checkOut, att.totalBreakSeconds), fontSize: 7.5, color: '#0F172A', alignment: 'center', bold: true, fillColor: i % 2 === 0 ? '#F8FAFC' : 'white' },
                  {
                    text: att.status,
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

// Fetch all employees' attendance (Scoped by Employee Rights & Role Data Scope)
export const fetchAllEmployeesAttendance = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ success: false, message: 'Unauthorized', errorCode: 'UNAUTHORIZED' });
    return;
  }

  const userRole = req.user?.role;
  const isHRAdmin = [Role.HR, Role.ADMIN, Role.SUPER_ADMIN, Role.PLATFORM_ADMIN].includes(userRole as any);
  const isStoreManager = userRole === Role.STORE_MANAGER;

  // 1. Employee Rights & Role Verification
  const userPerms = await getEffectiveUserPermissions(userId);
  const hasAccess = isHRAdmin || isStoreManager || Boolean(userPerms.canViewAttendance);

  if (!hasAccess) {
    res.status(403).json({
      success: false,
      message: 'Access denied. You do not have permission to view attendance history.',
      errorCode: 'ACCESS_DENIED'
    });
    return;
  }

  // 2. Fetch Employee Record for Data Scoping
  const employee = await prisma.employee.findFirst({
    where: { userId },
    include: { office: true, department: true }
  });

  if (!employee) {
    res.status(404).json({
      success: false,
      message: 'Employee record not found for authenticated user.',
      errorCode: 'EMPLOYEE_NOT_FOUND'
    });
    return;
  }

  const { from, to, limit = '50', page = '1', employeeId, departmentId, officeId } = req.query;
  const limitInt = Math.min(500, Math.max(1, parseInt(limit as string, 10) || 50));
  const pageInt = Math.max(1, parseInt(page as string, 10) || 1);
  const skip = (pageInt - 1) * limitInt;

  const whereClause: any = {};

  // 3. Date Range Filter
  if (from || to) {
    whereClause.date = {};
    if (from) whereClause.date.gte = from as string;
    if (to) whereClause.date.lte = to as string;
  }

  // 4. Data Scope Enforcement
  if (isHRAdmin) {
    // HR/Admin: Full organisation scope with optional query filters
    if (employeeId) whereClause.employeeId = parseInt(employeeId as string, 10);
    if (departmentId) whereClause.employee = { departmentId: parseInt(departmentId as string, 10) };
    if (officeId) whereClause.officeId = parseInt(officeId as string, 10);
  } else if (isStoreManager) {
    // Store Manager: Scoped to assigned store
    if (employee.officeId) {
      whereClause.officeId = employee.officeId;
    }
    if (employeeId) {
      whereClause.employeeId = parseInt(employeeId as string, 10);
    }
  } else {
    // Regular Employee: Strictly scoped to OWN attendance records only
    whereClause.employeeId = employee.id;
  }

  try {
    const total = await prisma.attendance.count({ where: whereClause });

    const records = await prisma.attendance.findMany({
      where: whereClause,
      include: {
        employee: {
          include: {
            department: true,
            user: {
              include: {
                profile: true
              }
            }
          }
        },
        office: true,
      },
      orderBy: { date: 'desc' },
      skip,
      take: limitInt,
    });

    const mappedRecords = records.map((att) => ({
      id: att.id,
      date: att.date,
      checkIn: att.checkIn ? att.checkIn.toISOString() : null,
      checkOut: att.checkOut ? att.checkOut.toISOString() : null,
      status: att.status,
      notes: att.notes,
      employee: {
        id: att.employee.id,
        employeeCode: att.employee.employeeCode,
        firstName: att.employee.firstName,
        lastName: att.employee.lastName,
        designation: att.employee.designation,
        department: att.employee.department ? {
          id: att.employee.department.id,
          name: att.employee.department.name
        } : null,
        email: att.employee.user?.email,
        phone: att.employee.user?.profile?.phone,
      },
      office: att.office
        ? {
            id: att.office.id,
            name: att.office.name,
            address: att.office.address,
          }
        : null,
      isOnBreak: att.isOnBreak,
      breakStartTime: att.breakStartTime ? att.breakStartTime.toISOString() : null,
      totalBreakSeconds: att.totalBreakSeconds,
      latitude: att.latitude,
      longitude: att.longitude,
    }));

    res.json({
      success: true,
      from: from || null,
      to: to || null,
      page: pageInt,
      limit: limitInt,
      total,
      records: mappedRecords,
      data: mappedRecords,
      attendances: mappedRecords
    });
  } catch (error) {
    console.error('Fetch all employees attendance error:', error);
    res.status(500).json({ success: false, message: 'Failed to load attendance data.', errorCode: 'FETCH_ATTENDANCE_ERROR' });
  }
};

// Get monthly work schedule for employee
export const getMonthlyWorkSchedule = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { month, year } = req.query;
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
      include: {
        shiftAssignments: {
          include: {
            shift: true,
          },
          where: {
            effectiveFrom: { lte: new Date() },
            OR: [
              { effectiveTo: null },
              { effectiveTo: { gte: new Date() } },
            ],
          },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
        office: true,
      },
    });

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found' });
      return;
    }

    // Default to current month if not provided
    const now = new Date();
    const targetMonth = month ? parseInt(month as string) : now.getMonth() + 1;
    const targetYear = year ? parseInt(year as string) : now.getFullYear();

    // Get all days in the month
    const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();
    const schedule = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(targetYear, targetMonth - 1, day);
      const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, etc.

      // Check if it's a weekend (Saturday = 6, Sunday = 0)
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

      // Get shift details if available
      let shiftDetails: {
        id: number;
        name: string;
        startTime: string;
        endTime: string;
        shiftType: string | null;
      } | null = null;
      const currentShiftAssignment = employee.shiftAssignments && employee.shiftAssignments.length > 0 ? employee.shiftAssignments[0] : null;
      if (currentShiftAssignment?.shift && !isWeekend) {
        shiftDetails = {
          id: currentShiftAssignment.shift.id,
          name: currentShiftAssignment.shift.name,
          startTime: currentShiftAssignment.shift.startTime,
          endTime: currentShiftAssignment.shift.endTime,
          shiftType: employee.shiftTypeId || null,
        };
      }

      schedule.push({
        date: date.toISOString().split('T')[0],
        dayOfWeek: dayOfWeek,
        isWeekend: isWeekend,
        shift: shiftDetails,
        office: employee.office ? {
          id: employee.office.id,
          name: employee.office.name,
          address: employee.office.address,
        } : null,
      });
    }

    res.json({
      success: true,
      data: {
        month: targetMonth,
        year: targetYear,
        employee: {
          id: employee.id,
          employeeCode: employee.employeeCode,
          name: `${employee.firstName} ${employee.lastName}`,
          designation: employee.designation,
        },
        schedule: schedule,
      },
    });
  } catch (error) {
    console.error('Get monthly work schedule error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch work schedule.' });
  }
};
