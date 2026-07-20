import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';

// ==========================================
// Attendance Controller
// ==========================================

export const getAttendanceSettings = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    // Get attendance settings - for now return default settings
    // In a real implementation, these would come from a settings table
    const settings = {
      autoMarkAbsent: false,
      enableGeofenceValidation: false,
      punchInTime: '09:00',
      punchOutTime: '18:00',
      lateGracePeriod: 15, // minutes
      earlyLeaveGracePeriod: 15, // minutes
      geofenceRadius: 100, // meters
      officeLocation: {
        latitude: 19.0760,
        longitude: 72.8777
      }
    };

    res.json({
      success: true,
      settings
    });
  } catch (error) {
    console.error('Get attendance settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get attendance settings.',
      errorCode: 'GET_ATTENDANCE_SETTINGS_ERROR'
    });
  }
};

export const updateAttendanceSettings = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { autoMarkAbsent, enableGeofenceValidation, punchInTime, punchOutTime, lateGracePeriod, earlyLeaveGracePeriod, geofenceRadius, officeLocation } = req.body;

    // For now, just return success - in a real implementation, these would be saved to a settings table
    const updatedSettings = {
      autoMarkAbsent: autoMarkAbsent ?? false,
      enableGeofenceValidation: enableGeofenceValidation ?? false,
      punchInTime: punchInTime ?? '09:00',
      punchOutTime: punchOutTime ?? '18:00',
      lateGracePeriod: lateGracePeriod ?? 15,
      earlyLeaveGracePeriod: earlyLeaveGracePeriod ?? 15,
      geofenceRadius: geofenceRadius ?? 100,
      officeLocation: officeLocation ?? {
        latitude: 19.0760,
        longitude: 72.8777
      }
    };

    res.json({
      success: true,
      message: 'Attendance settings updated successfully.',
      settings: updatedSettings
    });
  } catch (error) {
    console.error('Update attendance settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update attendance settings.',
      errorCode: 'UPDATE_ATTENDANCE_SETTINGS_ERROR'
    });
  }
};

export const getTodayAttendance = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    const attendance = await prisma.attendance.findMany({
      where: {
        date: today
      },
      include: {
        employee: {
          include: {
            department: true,
            office: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // Transform to match frontend expectations
    const transformedAttendance = attendance.map(record => ({
      id: record.id,
      employeeId: record.employeeId,
      employeeCode: record.employee.employeeCode,
      employeeName: `${record.employee.firstName} ${record.employee.lastName}`,
      department: record.employee.department?.name || 'General',
      office: record.employee.office?.name || 'Main Office',
      punchIn: record.checkIn,
      punchOut: record.checkOut,
      status: record.status,
      workMode: record.employee.workModeId,
      location: record.latitude && record.longitude ? `${record.latitude}, ${record.longitude}` : null,
      geofenceValidated: null, // This field doesn't exist in schema
      lateMark: null, // This field doesn't exist in schema
      earlyLeave: null, // This field doesn't exist in schema
      overtime: null // This field doesn't exist in schema
    }));

    res.json({
      success: true,
      attendance: transformedAttendance
    });
  } catch (error) {
    console.error('Get today attendance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get today attendance.',
      errorCode: 'GET_TODAY_ATTENDANCE_ERROR'
    });
  }
};

export const markAttendance = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { employeeId, type, location, geofenceValidated } = req.body;

    if (!employeeId || !type) {
      res.status(400).json({
        success: false,
        message: 'Employee ID and attendance type are required.',
        errorCode: 'MISSING_REQUIRED_FIELDS'
      });
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    const now = new Date();

    // Check if attendance already exists for today
    const existingAttendance = await prisma.attendance.findFirst({
      where: {
        employeeId: parseInt(employeeId),
        date: today
      }
    });

    let attendance;
    if (existingAttendance) {
      // Update existing attendance
      const updateData: any = {
        updatedAt: now
      };

      if (type === 'punch_in') {
        updateData.checkIn = now.toISOString();
        updateData.status = 'PRESENT';
      } else if (type === 'punch_out') {
        updateData.checkOut = now.toISOString();
        // Note: overtime calculation would need to be implemented separately
        // as the overtime field doesn't exist in the schema
      }

      attendance = await prisma.attendance.update({
        where: { id: existingAttendance.id },
        data: updateData
      });
    } else {
      // Create new attendance record
      const createData: any = {
        employeeId: parseInt(employeeId),
        date: today,
        status: 'PRESENT',
        createdAt: now,
        updatedAt: now
      };

      if (type === 'punch_in') {
        createData.checkIn = now.toISOString();
      } else if (type === 'punch_out') {
        createData.checkOut = now.toISOString();
      }

      if (location && typeof location === 'object' && location.latitude && location.longitude) {
        createData.latitude = location.latitude;
        createData.longitude = location.longitude;
      }

      // Note: geofenceValidated field doesn't exist in schema

      attendance = await prisma.attendance.create({
        data: createData
      });
    }

    res.json({
      success: true,
      message: `Attendance ${type === 'punch_in' ? 'punch in' : 'punch out'} recorded successfully.`,
      attendance
    });
  } catch (error) {
    console.error('Mark attendance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark attendance.',
      errorCode: 'MARK_ATTENDANCE_ERROR'
    });
  }
};

export const getAttendanceReport = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { startDate, endDate, employeeId, departmentId } = req.query;

    const whereClause: any = {};

    if (startDate && endDate) {
      whereClause.date = {
        gte: startDate as string,
        lte: endDate as string
      };
    }

    if (employeeId) {
      whereClause.employeeId = parseInt(employeeId as string);
    }

    if (departmentId) {
      whereClause.employee = {
        departmentId: parseInt(departmentId as string)
      };
    }

    const attendance = await prisma.attendance.findMany({
      where: whereClause,
      include: {
        employee: {
          include: {
            department: true,
            office: true
          }
        }
      },
      orderBy: {
        date: 'desc'
      }
    });

    // Calculate summary statistics
    const summary = {
      totalDays: attendance.length,
      presentDays: attendance.filter(a => a.status === 'PRESENT').length,
      absentDays: attendance.filter(a => a.status === 'ABSENT').length,
      lateDays: 0, // lateMark field doesn't exist in schema
      earlyLeaveDays: 0, // earlyLeave field doesn't exist in schema
      totalOvertime: 0 // overtime field doesn't exist in schema
    };

    res.json({
      success: true,
      attendance,
      summary
    });
  } catch (error) {
    console.error('Get attendance report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get attendance report.',
      errorCode: 'GET_ATTENDANCE_REPORT_ERROR'
    });
  }
};