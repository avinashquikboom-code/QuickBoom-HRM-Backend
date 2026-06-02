import { Request, Response } from 'express';
import { prisma } from '../../utils/db';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';

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

// Mobile Punch In
export const mobilePunchIn = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { latitude, longitude, notes, photo } = req.body;
    
    if (!latitude || !longitude) {
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

    // Check if already punched in today
    const today = new Date().toISOString().split('T')[0];
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

    // Check geofence
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

    // Create attendance record
    const attendance = await prisma.attendance.create({
      data: {
        employeeId: employee.id,
        officeId: employee.office.id,
        date: today,
        checkIn: new Date(),
        status: 'PRESENT',
        notes: notes || '',
        latitude,
        longitude,
        isFingerprintCheckIn: false,
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

    res.json({
      success: true,
      message: 'Punched in successfully.',
      data: {
        id: attendance.id,
        checkInTime: attendance.checkIn,
        location: {
          latitude: attendance.latitude,
          longitude: attendance.longitude
        },
        office: {
          name: attendance.office?.name,
          address: attendance.office?.address
        },
        status: attendance.status,
        notes: attendance.notes
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
    const { latitude, longitude, notes } = req.body;

    // Get employee information
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

    // Get today's attendance record
    const today = new Date().toISOString().split('T')[0];
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
    const updatedAttendance = await prisma.attendance.update({
      where: { id: attendance.id },
      data: {
        checkOut: new Date(),
        latitude: latitude || attendance.latitude,
        longitude: longitude || attendance.longitude,
        notes: notes || attendance.notes,
        status: 'PRESENT'
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

    res.json({
      success: true,
      message: 'Punched out successfully.',
      data: {
        id: updatedAttendance.id,
        checkInTime: updatedAttendance.checkIn,
        checkOutTime: updatedAttendance.checkOut,
        workDuration: {
          hours: workHours,
          minutes: workMinutes,
          totalMinutes: Math.floor(workDuration / (1000 * 60))
        },
        location: {
          latitude: updatedAttendance.latitude,
          longitude: updatedAttendance.longitude
        },
        status: updatedAttendance.status
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

    // Get today's attendance record
    const today = new Date().toISOString().split('T')[0];
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
        breakStartTime: new Date()
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

    // Get today's attendance record
    const today = new Date().toISOString().split('T')[0];
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
    const breakEndTime = new Date();
    const breakDuration = attendance.breakStartTime 
      ? breakEndTime.getTime() - attendance.breakStartTime.getTime()
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

    const today = new Date().toISOString().split('T')[0];
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
