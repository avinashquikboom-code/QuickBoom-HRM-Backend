import { Response } from 'express';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';
import { prisma, ensureBankEditTable } from '../../utils/db';
import { pushNotificationService } from '../../services/pushNotificationService';
import { firebaseNotificationService } from '../../services/firebaseNotificationService';
import { CommissionService } from '../../services/commissionService';
import { getEffectiveUserPermissions } from '../../utils/permissionHelper';

// Helper to fetch active Employee profile associated with the authenticated user
const getEmployeeFromRequest = async (req: AuthenticatedRequest) => {
  if (!req.user) return null;

  const userObj = req.user as any;

  // 1. Primary lookup: Employee linked to User ID
  let emp = await prisma.employee.findUnique({
    where: { userId: userObj.id },
    include: { department: true, office: true, store: true, user: { include: { profile: true } } },
  });

  if (emp) return emp;

  // 2. Fallback lookup by employeeID if available on user object
  if (userObj.employeeID) {
    emp = await prisma.employee.findFirst({
      where: { employeeID: userObj.employeeID },
      include: { department: true, office: true, store: true, user: { include: { profile: true } } },
    });
    if (emp) return emp;
  }

  // 3. Fallback lookup by email or employee code
  if (userObj.email) {
    const code = userObj.email.split('@')[0];
    emp = await prisma.employee.findFirst({
      where: {
        OR: [
          { employeeCode: { equals: code, mode: 'insensitive' } },
          { user: { email: { equals: userObj.email, mode: 'insensitive' } } },
        ],
      },
      include: { department: true, office: true, store: true, user: { include: { profile: true } } },
    });
  }

  return emp;
};

// ==========================================
// 1. Profile Management
// ==========================================

export const fetchEmployeeProfile = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const employee = await getEmployeeFromRequest(req);

    if (employee && employee.user && employee.user.profile) {
      const { profile } = employee.user;
      const userPermissions = await getEffectiveUserPermissions(employee.user.id);
      res.json({
        success: true,
        employee: {
          id: employee.id.toString(),
          employeeCode: employee.employeeCode,
          firstName: employee.firstName,
          lastName: employee.lastName,
          name: `${employee.firstName} ${employee.lastName}`,
          designation: employee.designation,
          status: employee.status,
          department: employee.department?.name || 'Unassigned',
          office: employee.office?.name || 'Unassigned',
          storeId: employee.storeId ? employee.storeId.toString() : (employee.store?.id ? employee.store.id.toString() : null),
          storeName: employee.store?.name || null,
          joinDate: employee.createdAt.toISOString(),
        },
        profile: {
          id: profile.id,
          email: profile.email,
          fullName: profile.fullName,
          phone: profile.phone,
          avatarUrl: profile.avatarUrl,
          bio: profile.bio,
          timezone: profile.timezone,
          timezoneLabel: profile.timezoneLabel,
          clearanceLevel: profile.clearanceLevel,
          clearanceLabel: profile.clearanceLabel,
        },
        user: {
          role: employee.user?.role || 'EMPLOYEE',
          isActive: employee.user?.isActive ?? true,
          permissions: userPermissions,
        },
        permissions: userPermissions,
      });
      return;
    }

    // Fallback: If no employee record exists (e.g. for SUPER_ADMIN or ADMIN), fetch user and profile directly
    if (req.user) {
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        include: { profile: true },
      });

      if (user && user.profile) {
        const userPermissions = await getEffectiveUserPermissions(user.id);
        res.json({
          success: true,
          employee: {
            id: user.id.toString(),
            employeeCode: user.role === 'SUPER_ADMIN' ? 'SA001' : 'AD001',
            firstName: user.profile.fullName.split(' ')[0] || 'Admin',
            lastName: user.profile.fullName.split(' ').slice(1).join(' ') || '',
            name: user.profile.fullName,
            designation: user.role === 'SUPER_ADMIN' ? 'Super Admin' : 'Administrator',
            status: 'active',
            department: 'Management',
            office: 'Headquarters',
            joinDate: user.createdAt.toISOString(),
          },
          profile: {
            id: user.profile.id,
            email: user.profile.email,
            fullName: user.profile.fullName,
            phone: user.profile.phone,
            avatarUrl: user.profile.avatarUrl,
            bio: user.profile.bio,
            timezone: user.profile.timezone,
            timezoneLabel: user.profile.timezoneLabel,
            clearanceLevel: user.profile.clearanceLevel,
            clearanceLabel: user.profile.clearanceLabel,
          },
          user: {
            role: user.role,
            isActive: user.isActive,
            permissions: userPermissions,
          },
          permissions: userPermissions,
        });
        return;
      }
    }

    res.status(404).json({ success: false, message: 'Employee profile not found.' });
  } catch (error) {
    console.error('Fetch employee profile error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch profile.' });
  }
};


export const updateEmployeeProfile = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { fullName, phone, bio, email } = req.body;

  try {
    const employee = await getEmployeeFromRequest(req);
    if (!employee || !employee.user || !employee.user.profile) {
      res.status(404).json({ success: false, message: 'Profile not found.' });
      return;
    }

    const updatedProfile = await prisma.profile.update({
      where: { id: employee.user.profile.id },
      data: {
        fullName: fullName !== undefined ? fullName.trim() : employee.user.profile.fullName,
        phone: phone !== undefined ? phone.trim() : employee.user.profile.phone,
        bio: bio !== undefined ? bio.trim() : employee.user.profile.bio,
        ...(email !== undefined && email.trim() !== '' ? { email: email.trim().toLowerCase() } : {}),
      },
    });

    // Also update Employee name fields if full name is updated
    if (fullName) {
      const parts = fullName.trim().split(' ');
      const firstName = parts[0] || '';
      const lastName = parts.slice(1).join(' ') || '';
      await prisma.employee.update({
        where: { id: employee.id },
        data: { firstName, lastName },
      });
    }

    res.json({
      success: true,
      message: 'Profile updated successfully!',
      profile: {
        id: updatedProfile.id,
        email: updatedProfile.email,
        fullName: updatedProfile.fullName,
        phone: updatedProfile.phone,
        avatarUrl: updatedProfile.avatarUrl,
        bio: updatedProfile.bio,
      },
    });
  } catch (error) {
    console.error('Update employee profile error:', error);
    res.status(500).json({ success: false, message: 'Failed to update profile.' });
  }
};

export const uploadEmployeeAvatar = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { avatarUrl, imageBase64 } = req.body;
  let urlToSave = avatarUrl || imageBase64;

  if (!urlToSave) {
    res.status(400).json({ success: false, message: 'Avatar image content is required.' });
    return;
  }

  try {
    const employee = await getEmployeeFromRequest(req);
    if (!employee || !employee.user || !employee.user.profile) {
      res.status(404).json({ success: false, message: 'Profile not found.' });
      return;
    }

    const updatedProfile = await prisma.profile.update({
      where: { id: employee.user.profile.id },
      data: { avatarUrl: urlToSave },
    });

    res.json({
      success: true,
      message: 'Avatar updated successfully!',
      avatarUrl: updatedProfile.avatarUrl,
    });
  } catch (error) {
    console.error('Upload avatar error:', error);
    res.status(500).json({ success: false, message: 'Failed to upload avatar.' });
  }
};

export const removeEmployeeAvatar = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const employee = await getEmployeeFromRequest(req);
    if (!employee || !employee.user || !employee.user.profile) {
      res.status(404).json({ success: false, message: 'Profile not found.' });
      return;
    }

    await prisma.profile.update({
      where: { id: employee.user.profile.id },
      data: { avatarUrl: '/favicon.svg' },
    });

    res.json({
      success: true,
      message: 'Avatar removed successfully!',
      avatarUrl: '/favicon.svg',
    });
  } catch (error) {
    console.error('Remove avatar error:', error);
    res.status(500).json({ success: false, message: 'Failed to remove avatar.' });
  }
};

// ==========================================
// 2. Attendance Operations
// ==========================================

export const fetchEmployeeTodayAttendance = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const todayStr = new Date().toISOString().split('T')[0];

  try {
    const employee = await getEmployeeFromRequest(req);
    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found.' });
      return;
    }

    const attendance = await prisma.attendance.findFirst({
      where: {
        employeeId: employee.id,
        date: todayStr,
      },
    });

    res.json({
      success: true,
      todayRecord: attendance
        ? {
            id: attendance.id.toString(),
            employeeId: attendance.employeeId.toString(),
            date: attendance.date,
            checkIn: attendance.checkIn ? attendance.checkIn.toISOString() : null,
            checkOut: attendance.checkOut ? attendance.checkOut.toISOString() : null,
            status: attendance.status,
            isFingerprintCheckIn: attendance.isFingerprintCheckIn,
            isFingerprintCheckOut: attendance.isFingerprintCheckOut,
            isOnBreak: attendance.isOnBreak,
            breakStartTime: attendance.breakStartTime ? attendance.breakStartTime.toISOString() : null,
            totalBreakSeconds: attendance.totalBreakSeconds,
          }
        : null,
    });
  } catch (error) {
    console.error('Fetch today attendance error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch attendance.' });
  }
};

export const fetchEmployeeAttendanceHistory = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { limit = '30', page = '1' } = req.query;
  const limitInt = parseInt(limit as string, 10);
  const pageInt = parseInt(page as string, 10);
  const skip = (pageInt - 1) * limitInt;

  try {
    const employee = await getEmployeeFromRequest(req);
    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found.' });
      return;
    }

    const total = await prisma.attendance.count({
      where: { employeeId: employee.id },
    });

    const records = await prisma.attendance.findMany({
      where: { employeeId: employee.id },
      orderBy: { date: 'desc' },
      skip,
      take: limitInt,
    });

    const mapped = records.map((att) => ({
      id: att.id.toString(),
      employeeId: att.employeeId.toString(),
      date: att.date,
      checkIn: att.checkIn ? att.checkIn.toISOString() : null,
      checkOut: att.checkOut ? att.checkOut.toISOString() : null,
      status: att.status,
      isFingerprintCheckIn: att.isFingerprintCheckIn,
      isFingerprintCheckOut: att.isFingerprintCheckOut,
      isOnBreak: att.isOnBreak,
      breakStartTime: att.breakStartTime ? att.breakStartTime.toISOString() : null,
      totalBreakSeconds: att.totalBreakSeconds,
    }));

    res.json({
      success: true,
      total,
      page: pageInt,
      limit: limitInt,
      history: mapped,
    });
  } catch (error) {
    console.error('Fetch attendance history error:', error);
    res.status(500).json({ success: false, message: 'Failed to load history.' });
  }
};

export const employeeCheckIn = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { latitude, longitude, viaFingerprint = false } = req.body;
  const todayStr = new Date().toISOString().split('T')[0];
  const now = new Date();

  try {
    const employee = await getEmployeeFromRequest(req);
    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found.' });
      return;
    }

    console.log(`Check-in attempt: Employee ID ${employee.id}, Date: ${todayStr}`);

    // Check if check-in already exists for today
    const existing = await prisma.attendance.findFirst({
      where: { employeeId: employee.id, date: todayStr },
    });

    console.log('Existing attendance record:', existing);

    // Only block check-in if there's a valid check-in time
    if (existing && existing.checkIn) {
      console.log('Already checked in today with time:', existing.checkIn);
      res.status(400).json({ success: false, message: 'Already checked in for today.' });
      return;
    }

    // Determine status (Late if check-in is past 09:15 AM)
    const isLate = now.getHours() > 9 || (now.getHours() === 9 && now.getMinutes() > 15);
    const status = isLate ? 'LATE' : 'PRESENT';

    let record;
    if (existing) {
      // If record was created (e.g. pre-marked ABSENT/WEEKEND), update it
      console.log('Updating existing attendance record:', existing.id);
      record = await prisma.attendance.update({
        where: { id: existing.id },
        data: {
          checkIn: now,
          status,
          isFingerprintCheckIn: !!viaFingerprint,
          latitude: latitude ? parseFloat(latitude) : null,
          longitude: longitude ? parseFloat(longitude) : null,
          officeId: employee.officeId,
        },
      });
    } else {
      console.log('Creating new attendance record');
      record = await prisma.attendance.create({
        data: {
          employeeId: employee.id,
          date: todayStr,
          checkIn: now,
          status,
          isFingerprintCheckIn: !!viaFingerprint,
          latitude: latitude ? parseFloat(latitude) : null,
          longitude: longitude ? parseFloat(longitude) : null,
          officeId: employee.officeId,
        },
      });
    }

    res.status(201).json({
      success: true,
      message: isLate ? 'Checked in successfully (Marked Late).' : 'Checked in successfully (On Time).',
      record: {
        id: record.id.toString(),
        employeeId: record.employeeId.toString(),
        date: record.date,
        checkIn: record.checkIn ? record.checkIn.toISOString() : null,
        status: record.status,
        isFingerprintCheckIn: record.isFingerprintCheckIn,
      },
    });
  } catch (error) {
    console.error('Check-in error:', error);
    res.status(500).json({ success: false, message: 'Failed to record check-in.' });
  }
};

export const employeeCheckOut = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { viaFingerprint = false } = req.body;
  const todayStr = new Date().toISOString().split('T')[0];
  const now = new Date();

  try {
    const employee = await getEmployeeFromRequest(req);
    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found.' });
      return;
    }

    const record = await prisma.attendance.findFirst({
      where: { employeeId: employee.id, date: todayStr },
    });

    if (!record || !record.checkIn) {
      res.status(400).json({ success: false, message: 'You have not checked in today.' });
      return;
    }

    if (record.checkOut) {
      res.status(400).json({ success: false, message: 'Already checked out for today.' });
      return;
    }

    // Resolve any active break before checkout
    let extraBreakSeconds = 0;
    let clearBreakStartTime = false;
    if (record.isOnBreak && record.breakStartTime) {
      extraBreakSeconds = Math.floor((now.getTime() - record.breakStartTime.getTime()) / 1000);
      clearBreakStartTime = true;
    }

    const updated = await prisma.attendance.update({
      where: { id: record.id },
      data: {
        checkOut: now,
        isOnBreak: false,
        breakStartTime: clearBreakStartTime ? null : undefined,
        totalBreakSeconds: record.totalBreakSeconds + extraBreakSeconds,
        isFingerprintCheckOut: !!viaFingerprint,
      },
    });

    res.json({
      success: true,
      message: 'Checked out successfully!',
      record: {
        id: updated.id.toString(),
        employeeId: updated.employeeId.toString(),
        date: updated.date,
        checkIn: updated.checkIn ? updated.checkIn.toISOString() : null,
        checkOut: updated.checkOut ? updated.checkOut.toISOString() : null,
        status: updated.status,
        totalBreakSeconds: updated.totalBreakSeconds,
      },
    });
  } catch (error) {
    console.error('Check-out error:', error);
    res.status(500).json({ success: false, message: 'Failed to record check-out.' });
  }
};

export const startEmployeeBreak = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const todayStr = new Date().toISOString().split('T')[0];
  const now = new Date();

  try {
    const employee = await getEmployeeFromRequest(req);
    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found.' });
      return;
    }

    const record = await prisma.attendance.findFirst({
      where: { employeeId: employee.id, date: todayStr },
    });

    if (!record || !record.checkIn || record.checkOut) {
      res.status(400).json({ success: false, message: 'Must be checked in and not checked out to take break.' });
      return;
    }

    if (record.isOnBreak) {
      res.status(400).json({ success: false, message: 'You are already on a break.' });
      return;
    }

    const updated = await prisma.attendance.update({
      where: { id: record.id },
      data: {
        isOnBreak: true,
        breakStartTime: now,
      },
    });

    res.json({
      success: true,
      message: 'Break started.',
      isOnBreak: updated.isOnBreak,
      breakStartTime: updated.breakStartTime?.toISOString() || null,
    });
  } catch (error) {
    console.error('Start break error:', error);
    res.status(500).json({ success: false, message: 'Failed to record break start.' });
  }
};

export const endEmployeeBreak = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const todayStr = new Date().toISOString().split('T')[0];
  const now = new Date();

  try {
    const employee = await getEmployeeFromRequest(req);
    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found.' });
      return;
    }

    const record = await prisma.attendance.findFirst({
      where: { employeeId: employee.id, date: todayStr },
    });

    if (!record || !record.isOnBreak || !record.breakStartTime) {
      res.status(400).json({ success: false, message: 'You are not on an active break.' });
      return;
    }

    const breakDurationSeconds = Math.floor((now.getTime() - record.breakStartTime.getTime()) / 1000);

    const updated = await prisma.attendance.update({
      where: { id: record.id },
      data: {
        isOnBreak: false,
        breakStartTime: null,
        totalBreakSeconds: record.totalBreakSeconds + breakDurationSeconds,
      },
    });

    res.json({
      success: true,
      message: 'Break ended.',
      isOnBreak: updated.isOnBreak,
      totalBreakSeconds: updated.totalBreakSeconds,
    });
  } catch (error) {
    console.error('End break error:', error);
    res.status(500).json({ success: false, message: 'Failed to record break end.' });
  }
};

// ==========================================
// 3. Leave Requests
// ==========================================

export const fetchLeavesAndBalances = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const employee = await getEmployeeFromRequest(req);
    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found.' });
      return;
    }

    const leaveRequests = await prisma.leaveRequest.findMany({
      where: { employeeId: employee.id },
      orderBy: { appliedOn: 'desc' },
    });

    // Compute remaining leave balance (Casual: 12, Sick: 10, Earned: 15)
    const casualTotal = 12;
    const sickTotal = 10;
    const earnedTotal = 15;

    const normalizeType = (t: string): string => {
      const u = (t || '').toUpperCase().trim();
      if (['CASUAL', 'CASUAL LEAVE', 'CL', 'CASUAL_LEAVE'].includes(u)) return 'CASUAL';
      if (['SICK', 'SICK LEAVE', 'SL', 'SICK_LEAVE'].includes(u)) return 'SICK';
      if (['EARNED', 'EARNED LEAVE', 'EL', 'EARNED_LEAVE', 'PAID', 'PAID LEAVE', 'PL'].includes(u)) return 'EARNED';
      return u;
    };

    // Helper to calculate total days for approved leaves by type
    const getUsedDays = (targetCategory: string) => {
      return leaveRequests
        .filter((l) => l.status === 'APPROVED' && normalizeType(l.type) === targetCategory)
        .reduce((sum, l) => {
          const diffTime = Math.abs(l.toDate.getTime() - l.fromDate.getTime());
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
          return sum + diffDays;
        }, 0);
    };

    const casualUsed = getUsedDays('CASUAL');
    const sickUsed = getUsedDays('SICK');
    const earnedUsed = getUsedDays('EARNED');

    res.json({
      success: true,
      balance: {
        casualTotal,
        casualUsed,
        casualRemaining: Math.max(0, casualTotal - casualUsed),
        sickTotal,
        sickUsed,
        sickRemaining: Math.max(0, sickTotal - sickUsed),
        earnedTotal,
        earnedUsed,
        earnedRemaining: Math.max(0, earnedTotal - earnedUsed),
      },
      leaves: leaveRequests.map((l) => ({
        id: l.id.toString(),
        employeeId: l.employeeId.toString(),
        employeeName: `${employee.firstName} ${employee.lastName}`,
        department: employee.department?.name || 'Unassigned',
        type: l.type.toLowerCase(), // frontend enum uses lowercase
        fromDate: l.fromDate.toISOString(),
        toDate: l.toDate.toISOString(),
        reason: l.reason,
        status: l.status.toLowerCase(), // frontend enum uses lowercase
        appliedOn: l.appliedOn.toISOString(),
        reviewedBy: l.reviewedBy,
        reviewNote: l.reviewNote,
      })),
    });
  } catch (error) {
    console.error('Fetch leaves error:', error);
    res.status(500).json({ success: false, message: 'Failed to load leaves.' });
  }
};

export const applyEmployeeLeave = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { type, fromDate, toDate, reason, leaveCategory = 'PLANNED' } = req.body;

  console.log('=== EMPLOYEE LEAVE CREATION API CALLED ===');
  console.log('Request body:', { type, fromDate, toDate, reason, leaveCategory });
  console.log('User making request:', req.user?.email, 'User ID:', req.user?.id);

  if (!type || !fromDate || !toDate || !reason) {
    res.status(400).json({ success: false, message: 'All parameters (type, fromDate, toDate, reason) are required.' });
    return;
  }

  try {
    const employee = await getEmployeeFromRequest(req);
    if (!employee) {
      console.error('Employee not found for leave request');
      res.status(404).json({ success: false, message: 'Employee not found.' });
      return;
    }

    console.log('Creating leave request for employee:', employee.id, employee.firstName, employee.lastName);

    let deductionApplied = false;
    if (leaveCategory === 'UNPLANNED') {
      const holidays = await prisma.holiday.findMany();
      const festivalDates = new Set(holidays.map(h => h.date.toISOString().split('T')[0]));
      
      const start = new Date(fromDate);
      const end = new Date(toDate);
      
      const isSundayOrFestival = (date: Date): boolean => {
        if (date.getDay() === 0) return true;
        const dateStr = date.toISOString().split('T')[0];
        return festivalDates.has(dateStr);
      };

      const dayBefore = new Date(start);
      dayBefore.setDate(dayBefore.getDate() - 1);

      const dayAfter = new Date(end);
      dayAfter.setDate(dayAfter.getDate() + 1);

      if (isSundayOrFestival(dayBefore) || isSundayOrFestival(dayAfter)) {
        deductionApplied = true;
      }
    }

    const leave = await prisma.leaveRequest.create({
      data: {
        employeeId: employee.id,
        type: type.toUpperCase(), // Map e.g. "casual" to "CASUAL"
        fromDate: new Date(fromDate),
        toDate: new Date(toDate),
        reason: reason.trim(),
        status: 'PENDING',
        leaveCategory: leaveCategory.toUpperCase(),
        deductionApplied,
      },
    });

    console.log('Leave request created successfully:', leave.id, 'Status:', leave.status, 'Applied on:', leave.appliedOn);

    res.status(201).json({
      success: true,
      message: 'Leave application submitted successfully!',
      leave: {
        id: leave.id.toString(),
        employeeId: leave.employeeId.toString(),
        employeeName: `${employee.firstName} ${employee.lastName}`,
        department: employee.department?.name || 'Unassigned',
        type: leave.type.toLowerCase(),
        fromDate: leave.fromDate.toISOString(),
        toDate: leave.toDate.toISOString(),
        reason: leave.reason,
        status: leave.status.toLowerCase(),
        appliedOn: leave.appliedOn.toISOString(),
      },
    });

    // Notify HR and Admin users asynchronously
    (async () => {
      try {
        const adminUsers = await prisma.user.findMany({
          where: {
            role: {
              in: ['SUPER_ADMIN', 'ADMIN', 'HR', 'PLATFORM_ADMIN']
            },
            isActive: true
          }
        });

        if (adminUsers.length > 0) {
          const employeeName = `${employee.firstName} ${employee.lastName}`;
          const title = `New Leave Request`;
          const body = `${employeeName} has applied for ${leave.type.toLowerCase()} leave from ${new Date(fromDate).toLocaleDateString()} to ${new Date(toDate).toLocaleDateString()}.`;

          // 1. Create database notifications
          try {
            await Promise.all(
              adminUsers.map(user =>
                prisma.notification.create({
                  data: {
                    title,
                    body,
                    category: 'LEAVE',
                    userId: user.id,
                    actionId: leave.id.toString(),
                    actionType: 'leave_request'
                  }
                })
              )
            );
          } catch (dbNotifyError) {
            console.error('Database leave notifications creation error:', dbNotifyError);
          }

          // 2. Broadcast WebSockets for live updates
          try {
            const { getWebSocketInstance } = require('../../utils/websocketSingleton');
            const wsInstance = getWebSocketInstance();
            if (wsInstance) {
              wsInstance.getServer().emit('newNotification', {
                title,
                body,
                type: 'LEAVE',
                category: 'LEAVE',
                actionId: leave.id.toString(),
                actionType: 'leave_request',
                createdAt: new Date().toISOString()
              });
            }
          } catch (wsError) {
            console.error('Failed to broadcast leave websocket notification:', wsError);
          }

          // 3. Send Firebase Push Notifications
          try {
            const adminUserIds = adminUsers.map(u => u.id);
            const pushTitle = 'New Leave Application';
            const pushBody = `New leave request from ${employeeName}`;
            pushNotificationService.sendPush(
              adminUserIds,
              pushTitle,
              pushBody,
              {
                screen: 'leave_requests',
                id: leave.id.toString()
              }
            ).catch(err => console.error('Failed to send leave submit push notification:', err));
          } catch (pushError) {
            console.error('Failed to send FCM push notifications for leave request:', pushError);
          }
        }
      } catch (bgError) {
        console.error('Background leave request notification error:', bgError);
      }
    })();
  } catch (error) {
    console.error('Apply leave error:', error);
    res.status(500).json({ success: false, message: 'Failed to apply for leave.' });
  }
};

// ==========================================
// 4. Shift Information
// ==========================================

export const fetchEmployeeShift = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const employee = await getEmployeeFromRequest(req);
    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found.' });
      return;
    }

    const assignment = await prisma.shiftAssignment.findFirst({
      where: {
        employeeId: employee.id,
        effectiveTo: null, // active assignment
      },
      include: { shift: true },
    });

    if (assignment) {
      res.json({
        success: true,
        assignment: {
          employeeId: employee.id.toString(),
          employeeName: `${employee.firstName} ${employee.lastName}`,
          department: employee.department?.name || 'Unassigned',
          shift: {
            id: assignment.shift.id.toString(),
            name: assignment.shift.name,
            startTime: assignment.shift.startTime,
            endTime: assignment.shift.endTime,
            workingDays: assignment.shift.workingDays,
            graceMinutes: assignment.shift.graceMinutes,
            breakMinutes: assignment.shift.graceMinutes,
            color: assignment.shift.color,
          },
          effectiveFrom: assignment.effectiveFrom.toISOString(),
        },
      });
      return;
    }

    // Fallback if no explicit ShiftAssignment record exists: build shift from employee.shiftTypeId
    const shiftType = employee.shiftTypeId || 'MORNING';
    let name = 'Morning Shift';
    let startTime = '09:00';
    let endTime = '18:00';
    let color = '#3BA38B';

    if (shiftType === 'EVENING') {
      name = 'Evening Shift';
      startTime = '14:00';
      endTime = '23:00';
      color = '#F59E0B';
    } else if (shiftType === 'NIGHT') {
      name = 'Night Shift';
      startTime = '22:00';
      endTime = '07:00';
      color = '#6366F1';
    } else if (shiftType === 'ON_FIELD') {
      name = 'On Field Shift';
      startTime = '09:00';
      endTime = '18:00';
      color = '#EC4899';
    }

    res.json({
      success: true,
      assignment: {
        employeeId: employee.id.toString(),
        employeeName: `${employee.firstName} ${employee.lastName}`,
        department: employee.department?.name || 'Operations',
        shift: {
          id: shiftType,
          name,
          startTime,
          endTime,
          workingDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
          graceMinutes: 15,
          breakMinutes: 60,
          color,
        },
        effectiveFrom: employee.createdAt ? employee.createdAt.toISOString() : new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Fetch shift error:', error);
    res.status(500).json({ success: false, message: 'Failed to load shift assignments.' });
  }
};

// ==========================================
// 5. Expenses Claims
// ==========================================

export const fetchEmployeeExpenses = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const employee = await getEmployeeFromRequest(req);
    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found.' });
      return;
    }

    const expenses = await prisma.expense.findMany({
      where: { employeeId: employee.id },
      orderBy: { submittedOn: 'desc' },
    });

    res.json({
      success: true,
      expenses: expenses.map((e) => ({
        id: e.id.toString(),
        employeeId: e.employeeId.toString(),
        employeeName: `${employee.firstName} ${employee.lastName}`,
        department: employee.department?.name || 'Unassigned',
        category: e.category.toLowerCase(), // frontend enum uses lowercase
        amount: e.amount,
        description: e.description,
        date: e.date.toISOString(),
        status: e.status.toLowerCase(), // frontend enum uses lowercase
        submittedOn: e.submittedOn.toISOString(),
        reviewedBy: e.reviewedBy,
        reviewNote: e.reviewNote,
        hasReceipt: e.hasReceipt,
        receiptUrl: e.receiptUrl,
        receiptPdfUrl: e.receiptPdfUrl,   // ← include generated receipt PDF URL
      })),
    });
  } catch (error) {
    console.error('Fetch expenses error:', error);
    res.status(500).json({ success: false, message: 'Failed to load expenses.' });
  }
};

export const createEmployeeExpense = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { category, amount, description, date, imageBase64 } = req.body;

  if (!category || amount === undefined || !description || !date) {
    res.status(400).json({ success: false, message: 'Category, amount, description, and date are required.' });
    return;
  }

  try {
    const employee = await getEmployeeFromRequest(req);
    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found.' });
      return;
    }

    // ── Receipt file handling ──────────────────────────────────────────────────
    let savedReceiptUrl: string | null = null;
    if (imageBase64 && typeof imageBase64 === 'string' && imageBase64.length > 0) {
      try {
        const MAX_BASE64_SIZE = 7 * 1024 * 1024; // ~5 MB decoded
        if (imageBase64.length > MAX_BASE64_SIZE) {
          res.status(400).json({ success: false, message: 'Receipt file too large. Maximum 5 MB allowed.' });
          return;
        }

        // Strip optional "data:image/...;base64," prefix
        const base64Data = imageBase64.includes(',')
          ? imageBase64.split(',')[1]
          : imageBase64;

        // Detect extension from mime prefix (jpeg/png/pdf fallback)
        const mimeMatch = imageBase64.match(/^data:(image\/\w+|application\/pdf);base64,/);
        let ext = 'jpg';
        if (mimeMatch) {
          const mime = mimeMatch[1];
          if (mime === 'image/png') ext = 'png';
          else if (mime === 'application/pdf') ext = 'pdf';
        }

        const fs = await import('fs');
        const path = await import('path');
        const uploadsDir = path.join(process.cwd(), 'uploads', 'receipts');
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }

        const filename = `receipt_${employee.id}_${Date.now()}.${ext}`;
        const filePath = path.join(uploadsDir, filename);
        await fs.promises.writeFile(filePath, Buffer.from(base64Data, 'base64'));
        savedReceiptUrl = `/uploads/receipts/${filename}`;
      } catch (fileErr) {
        console.error('Failed to save receipt file:', fileErr);
        // Non-fatal: continue expense creation without receipt
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    const expense = await prisma.expense.create({
      data: {
        employeeId: employee.id,
        category: category.toUpperCase(),
        amount: parseFloat(amount),
        description: description.trim(),
        date: new Date(date),
        status: 'PENDING',
        hasReceipt: !!savedReceiptUrl,
        receiptUrl: savedReceiptUrl,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Expense filed successfully!',
      expense: {
        id: expense.id.toString(),
        employeeId: expense.employeeId.toString(),
        employeeName: `${employee.firstName} ${employee.lastName}`,
        department: employee.department?.name || 'Unassigned',
        category: expense.category.toLowerCase(),
        amount: expense.amount,
        description: expense.description,
        date: expense.date.toISOString(),
        status: expense.status.toLowerCase(),
        submittedOn: expense.submittedOn.toISOString(),
        hasReceipt: expense.hasReceipt,
        receiptUrl: expense.receiptUrl,
        receiptPdfUrl: null,
      },
    });
  } catch (error) {
    console.error('Create expense error:', error);
    res.status(500).json({ success: false, message: 'Failed to file expense.' });
  }
};

// ==========================================
// 6. Tasks Claims
// ==========================================

export const fetchEmployeeTasks = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const employee = await getEmployeeFromRequest(req);
    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found.' });
      return;
    }

    const tasks = await prisma.task.findMany({
      where: { assignedToId: employee.id },
      include: {
        assignedBy: { include: { profile: true } },
      },
      orderBy: { dueDate: 'asc' },
    });

    res.json({
      success: true,
      tasks: tasks.map((t) => ({
        id: t.id.toString(),
        title: t.title,
        description: t.description,
        assignedToId: t.assignedToId.toString(),
        assignedToName: `${employee.firstName} ${employee.lastName}`,
        assignedById: t.assignedById.toString(),
        assignedByName: t.assignedBy.profile?.fullName || 'Manager',
        projectName: t.projectName,
        dueDate: t.dueDate.toISOString(),
        createdAt: t.createdAt.toISOString(),
        status: t.status.toLowerCase().replace('_', ''), // e.g. "IN_PROGRESS" to "inProgress" to match front-end enum
        priority: t.priority.toLowerCase(), // matches front-end enum "low", "medium", "high"
      })),
    });
  } catch (error) {
    console.error('Fetch tasks error:', error);
    res.status(500).json({ success: false, message: 'Failed to load tasks.' });
  }
};

export const updateEmployeeTaskStatus = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  const { status } = req.body; // Expecting frontend formats like: "todo", "inProgress", "completed"

  if (!status) {
    res.status(400).json({ success: false, message: 'Status is required.' });
    return;
  }

  const taskIdInt = parseInt(id as string, 10);
  if (isNaN(taskIdInt)) {
    res.status(400).json({ success: false, message: 'Invalid Task ID.' });
    return;
  }

  // Map camelCase status from frontend to DB SnakeCase formats
  let dbStatus = 'TODO';
  if (status === 'inProgress') {
    dbStatus = 'IN_PROGRESS';
  } else if (status === 'underReview') {
    dbStatus = 'UNDER_REVIEW';
  } else if (status === 'completed') {
    dbStatus = 'COMPLETED';
  } else if (status === 'overdue') {
    dbStatus = 'OVERDUE';
  }

  try {
    const employee = await getEmployeeFromRequest(req);
    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee profile not found.' });
      return;
    }

    const existingTask = await prisma.task.findUnique({
      where: { id: taskIdInt },
    });

    if (!existingTask || existingTask.assignedToId !== employee.id) {
      res.status(404).json({ success: false, message: 'Task not found or unauthorized.' });
      return;
    }

    const updatedTask = await prisma.task.update({
      where: { id: taskIdInt },
      data: { status: dbStatus },
    });

    res.json({
      success: true,
      message: 'Task status updated successfully!',
      task: {
        id: updatedTask.id.toString(),
        status: status, // return back frontend format
      },
    });
  } catch (error) {
    console.error('Update task status error:', error);
    res.status(500).json({ success: false, message: 'Failed to update task status.' });
  }
};

// ==========================================
// 7. Notifications
// ==========================================

export const fetchEmployeeNotifications = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const employee = await getEmployeeFromRequest(req);
    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found.' });
      return;
    }

    const notifications = await prisma.notification.findMany({
      where: { employeeId: employee.id },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      notifications: notifications.map((n) => ({
        id: n.id.toString(),
        title: n.title,
        body: n.body,
        category: n.category.toLowerCase(),
        createdAt: n.createdAt.toISOString(),
        isRead: n.isRead,
        actionId: n.actionId,
        actionType: n.actionType,
      })),
    });
  } catch (error) {
    console.error('Fetch notifications error:', error);
    res.status(500).json({ success: false, message: 'Failed to load notifications.' });
  }
};

export const markEmployeeNotificationRead = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { id } = req.params;
  const notifIdInt = parseInt(id as string, 10);

  if (isNaN(notifIdInt)) {
    res.status(400).json({ success: false, message: 'Invalid Notification ID.' });
    return;
  }

  try {
    const employee = await getEmployeeFromRequest(req);
    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found.' });
      return;
    }

    const notification = await prisma.notification.findUnique({
      where: { id: notifIdInt },
    });

    if (!notification || notification.employeeId !== employee.id) {
      res.status(404).json({ success: false, message: 'Notification not found.' });
      return;
    }

    await prisma.notification.update({
      where: { id: notifIdInt },
      data: { isRead: true },
    });

    res.json({
      success: true,
      message: 'Notification marked as read.',
    });
  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({ success: false, message: 'Failed to update notification.' });
  }
};

export const markAllEmployeeNotificationsRead = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const employee = await getEmployeeFromRequest(req);
    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found.' });
      return;
    }

    await prisma.notification.updateMany({
      where: { employeeId: employee.id, isRead: false },
      data: { isRead: true },
    });

    res.json({
      success: true,
      message: 'All notifications marked as read.',
    });
  } catch (error) {
    console.error('Mark all notifications read error:', error);
    res.status(500).json({ success: false, message: 'Failed to update notifications.' });
  }
};

// ==========================================
// 8. Aggregated Dashboard metrics
// ==========================================

export const fetchEmployeeDashboardStats = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const todayStr = new Date().toISOString().split('T')[0];

  try {
    const employee = await getEmployeeFromRequest(req);
    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found.' });
      return;
    }

    // A. Fetch active shift
    const assignment = await prisma.shiftAssignment.findFirst({
      where: { employeeId: employee.id, effectiveTo: null },
      include: { shift: true },
    });

    // B. Today's attendance
    const todayAttendance = await prisma.attendance.findFirst({
      where: { employeeId: employee.id, date: todayStr },
    });

    // C. Leave statistics
    const totalLeaves = await prisma.leaveRequest.findMany({
      where: { employeeId: employee.id },
    });
    const pendingLeavesCount = totalLeaves.filter((l) => l.status === 'PENDING').length;

    // Leave balances
    const casualTotal = 12;
    const sickTotal = 10;
    const earnedTotal = 15;

    const normalizeType = (t: string): string => {
      const u = (t || '').toUpperCase().trim();
      if (['CASUAL', 'CASUAL LEAVE', 'CL', 'CASUAL_LEAVE'].includes(u)) return 'CASUAL';
      if (['SICK', 'SICK LEAVE', 'SL', 'SICK_LEAVE'].includes(u)) return 'SICK';
      if (['EARNED', 'EARNED LEAVE', 'EL', 'EARNED_LEAVE', 'PAID', 'PAID LEAVE', 'PL'].includes(u)) return 'EARNED';
      return u;
    };

    const getUsedDays = (targetCategory: string) => {
      return totalLeaves
        .filter((l) => l.status === 'APPROVED' && normalizeType(l.type) === targetCategory)
        .reduce((sum, l) => {
          const diffTime = Math.abs(l.toDate.getTime() - l.fromDate.getTime());
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
          return sum + diffDays;
        }, 0);
    };

    const casualUsed = getUsedDays('CASUAL');
    const sickUsed = getUsedDays('SICK');
    const earnedUsed = getUsedDays('EARNED');

    // D. Tasks statistics (combine legacy Task and HrTask)
    const identifiers: string[] = [
      String(employee.id),
      ...(employee.employeeID ? [employee.employeeID] : []),
      ...(employee.employeeCode ? [employee.employeeCode] : []),
      ...(req.user?.id ? [String(req.user.id)] : []),
      ...(req.user?.email ? [req.user.email] : []),
    ];
    const uniqueIdentifiers = [...new Set(identifiers)];

    const [legacyTasksList, hrTasksList] = await Promise.all([
      prisma.task.findMany({
        where: { assignedToId: employee.id },
      }),
      prisma.hrTask.findMany({
        where: { assignedTo: { in: uniqueIdentifiers } },
      }),
    ]);

    const totalTaskCount = legacyTasksList.length + hrTasksList.length;
    const completedLegacy = legacyTasksList.filter((t) => t.status === 'COMPLETED').length;
    const completedHr = hrTasksList.filter((t) => t.status === 'COMPLETED').length;
    const completedTasksCount = completedLegacy + completedHr;
    const pendingTasksCount = totalTaskCount - completedTasksCount;

    // E. Fetch recent announcements
    const announcements = await prisma.announcement.findMany({
      take: 3,
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      stats: {
        tasks: {
          total: totalTaskCount,
          completed: completedTasksCount,
          pending: pendingTasksCount,
        },
        leaves: {
          pendingRequests: pendingLeavesCount,
          balances: {
            casualRemaining: Math.max(0, casualTotal - casualUsed),
            sickRemaining: Math.max(0, sickTotal - sickUsed),
            earnedRemaining: Math.max(0, earnedTotal - earnedUsed),
          },
        },
      },
      shift: assignment
        ? {
            name: assignment.shift.name,
            timing: `${assignment.shift.startTime} - ${assignment.shift.endTime}`,
            color: assignment.shift.color,
          }
        : null,
      todayRecord: todayAttendance
        ? {
            id: todayAttendance.id.toString(),
            date: todayAttendance.date,
            checkIn: todayAttendance.checkIn ? todayAttendance.checkIn.toISOString() : null,
            checkOut: todayAttendance.checkOut ? todayAttendance.checkOut.toISOString() : null,
            status: todayAttendance.status,
            isOnBreak: todayAttendance.isOnBreak,
            breakStartTime: todayAttendance.breakStartTime ? todayAttendance.breakStartTime.toISOString() : null,
            totalBreakSeconds: todayAttendance.totalBreakSeconds,
          }
        : null,
      announcements: announcements.map((a) => ({
        id: a.id.toString(),
        title: a.title,
        content: a.content,
        category: a.category.toLowerCase(),
        publishedBy: a.publishedBy,
        createdAt: a.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('Fetch employee dashboard error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch dashboard metrics.' });
  }
};

// ==========================================
// 7. Holiday Management
// ==========================================

export const fetchEmployeeHolidays = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const currentYear = new Date().getFullYear();
    
    // Fetch holidays for the current year
    const holidays = await prisma.holiday.findMany({
      where: {
        date: {
          gte: new Date(currentYear, 0, 1), // Start of current year
          lt: new Date(currentYear + 1, 0, 1), // Start of next year
        }
      },
      orderBy: {
        date: 'asc'
      }
    });

    // Format holidays for mobile app
    const formattedHolidays = holidays.map(holiday => ({
      id: holiday.id.toString(),
      name: holiday.name,
      date: holiday.date && !isNaN(new Date(holiday.date).getTime()) ? new Date(holiday.date).toISOString().split('T')[0] : '', // Format as YYYY-MM-DD
      isPublic: holiday.isPublic,
      description: holiday.description,
    }));

    res.json({
      success: true,
      holidays: formattedHolidays,
    });
  } catch (error) {
    console.error('Fetch holidays error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch holidays.' });
  }
};

// ==========================================
// 8. Document Management
// ==========================================

export const fetchEmployeeDocuments = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const employee = await getEmployeeFromRequest(req);
    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found.' });
      return;
    }

    // Fetch payslips (documents) for the employee
    const payslips = await prisma.payslip.findMany({
      where: { employeeId: employee.id },
      orderBy: { year: 'desc', month: 'desc' },
    });

    // Fetch public documents
    const publicDocuments = await prisma.document.findMany({
      where: { isPublic: true },
      orderBy: { createdAt: 'desc' },
    });

    // Format payslips as documents
    const payslipDocuments = payslips.map(payslip => {
      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ];
      const monthIndex = (payslip.month >= 1 && payslip.month <= 12) ? payslip.month - 1 : 0;
      const monthName = monthNames[monthIndex];

      return {
        id: payslip.id.toString(),
        title: `${monthName} ${payslip.year} Payslip`,
        type: 'payslip',
        date: new Date(payslip.year, payslip.month, 1).toISOString().split('T')[0],
        fileSize: '1.2 MB',
        isDownloadable: true,
      };
    });

    // Format public documents
    const formattedPublicDocs = publicDocuments.map(doc => ({
      id: doc.id.toString(),
      title: doc.title,
      type: doc.type,
      date: doc.date.toISOString().split('T')[0],
      fileSize: doc.fileSize,
      isDownloadable: true,
    }));

    // Combine all documents
    const allDocuments = [...payslipDocuments, ...formattedPublicDocs];

    res.json({
      success: true,
      documents: allDocuments,
    });
  } catch (error) {
    console.error('Fetch documents error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch documents.' });
  }
};

// ==========================================
// Wallet Management
// ==========================================

export const fetchEmployeeWallet = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const employee = await getEmployeeFromRequest(req);
    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found.' });
      return;
    }

    // Get or create wallet
    let wallet = await prisma.wallet.findUnique({
      where: { employeeId: employee.id },
      include: {
        transactions: {
          orderBy: { date: 'desc' },
          take: 10,
        },
      },
    });

    // Get salary structure
    const salaryStructure = await prisma.salaryStructure.findUnique({
      where: { employeeId: employee.id },
    });

    const defaultLimit = salaryStructure?.salaryAdvanceLimit !== undefined && salaryStructure?.salaryAdvanceLimit !== null
      ? salaryStructure.salaryAdvanceLimit
      : 25000;

    // If wallet doesn't exist, create one
    if (!wallet) {
      const last4Phone = employee.mobileNumber
        ? employee.mobileNumber.replace(/\D/g, '').slice(-4)
        : '0000';
      const cardNumber = `HK-${employee.employeeCode}-${last4Phone}`;
      wallet = await prisma.wallet.create({
        data: {
          employeeId: employee.id,
          availableBalance: 0,
          advanceLimit: defaultLimit,
          pendingClaims: 0,
          cardNumber,
        },
        include: {
          transactions: {
            orderBy: { date: 'desc' },
            take: 10,
          },
        },
      });
    }

    // Get latest payslip for upcoming salary info
    const latestPayslip = await prisma.payslip.findFirst({
      where: { employeeId: employee.id },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });

    const registeredSalary = salaryStructure
      ? (salaryStructure.grossSalary || salaryStructure.monthlySalary || salaryStructure.basicSalary || 0)
      : 0;

    let estimatedNetSalary = 0;
    if (salaryStructure && registeredSalary > 0) {
      const gross = registeredSalary;
      const basic = salaryStructure.basicSalary || Math.round(gross * 0.5);
      const pf = salaryStructure.pfEnabled ? Math.round(basic * ((salaryStructure.employeePfRate || 12) / 100)) : 0;
      const esic = salaryStructure.esicEnabled ? Math.round(gross * ((salaryStructure.employeeEsicRate || 0.75) / 100)) : 0;
      estimatedNetSalary = Math.max(0, gross - (pf + esic));
    }

    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    // Calculate current month commission for this employee using the unified source of truth (CommissionService)
    const monthMetrics = await CommissionService.getMonthlyMetrics(employee.id);
    const currentCommission = Math.round(monthMetrics.commission || 0);

    const isCurrentMonthPayslip = latestPayslip && latestPayslip.month === currentMonth && latestPayslip.year === currentYear;

    const upcomingSalary = isCurrentMonthPayslip
      ? latestPayslip.netSalary
      : estimatedNetSalary;

    const upcomingSalaryWithCommission = isCurrentMonthPayslip
      ? Math.round(latestPayslip.netSalary)
      : Math.round(estimatedNetSalary + currentCommission);

    const allAdvances = await prisma.salaryAdvance.findMany({
      where: {
        walletId: wallet.id,
      },
      orderBy: { requestedOn: 'desc' },
    });

    // Authoritative Advance Limit Calculation
    const effectiveLimit = salaryStructure?.salaryAdvanceLimit !== undefined && salaryStructure?.salaryAdvanceLimit !== null
      ? salaryStructure.salaryAdvanceLimit
      : (wallet.advanceLimit || 0);

    const pendingAdvances = allAdvances.filter(a => a.status === 'PENDING');
    const approvedAdvances = allAdvances.filter(a => a.status === 'APPROVED');

    const pendingAmount = pendingAdvances.reduce((sum, a) => sum + (a.amount || 0), 0);
    const approvedAmount = approvedAdvances.reduce((sum, a) => sum + (a.remainingAmount > 0 ? a.remainingAmount : 0), 0);
    const totalAdvanceUsed = pendingAmount + approvedAmount;
    const remainingAdvanceLimit = Math.max(0, effectiveLimit - totalAdvanceUsed);
    const canApply = remainingAdvanceLimit > 0;

    const activeAdvance = allAdvances.find(a => ['PENDING', 'APPROVED'].includes(a.status)) || null;

    const pendingExpenses = await prisma.expense.aggregate({
      where: {
        employeeId: employee.id,
        status: { in: ['PENDING', 'pending'] },
      },
      _sum: {
        amount: true,
      },
    });
    const calculatedPendingClaims = (pendingExpenses._sum?.amount || 0) + (wallet.pendingClaims || 0);

    res.json({
      success: true,
      wallet: {
        id: wallet.id.toString(),
        availableBalance: wallet.availableBalance,
        advanceLimit: effectiveLimit,
        usedAmount: totalAdvanceUsed,
        usedAdvance: totalAdvanceUsed,
        pendingAmount,
        pendingAdvance: pendingAmount,
        approvedAmount,
        approvedAdvance: approvedAmount,
        remainingAmount: remainingAdvanceLimit,
        remainingAdvance: remainingAdvanceLimit,
        remainingAdvanceLimit,
        canApply,
        pendingClaims: calculatedPendingClaims,
        cardNumber: wallet.cardNumber,
        isActive: wallet.isActive,
        registeredSalary,
        upcomingSalary: upcomingSalaryWithCommission,
        baseUpcomingSalary: upcomingSalary,
        commissionAmount: currentCommission,
        grossSalary: registeredSalary,
        netSalary: upcomingSalaryWithCommission,
        activeAdvance: activeAdvance ? {
          id: activeAdvance.id.toString(),
          amount: activeAdvance.amount,
          months: activeAdvance.months,
          monthlyEmi: activeAdvance.monthlyEmi > 0 
            ? activeAdvance.monthlyEmi 
            : Math.round((activeAdvance.amount / (activeAdvance.months || 1)) * 100) / 100,
          paidAmount: activeAdvance.paidAmount,
          remainingAmount: activeAdvance.status === 'APPROVED' ? activeAdvance.remainingAmount : activeAdvance.amount,
          paidEmis: activeAdvance.paidEmis,
          pendingEmis: Math.max(0, (activeAdvance.months || 1) - activeAdvance.paidEmis),
          status: activeAdvance.status,
          requestedOn: activeAdvance.requestedOn.toISOString(),
          approvedAt: activeAdvance.approvedAt ? activeAdvance.approvedAt.toISOString() : null,
          reviewedBy: activeAdvance.reviewedBy,
          reviewNote: activeAdvance.reviewNote,
        } : null,
        advances: allAdvances.map(adv => ({
          id: adv.id.toString(),
          amount: adv.amount,
          months: adv.months,
          reason: adv.reason,
          monthlyEmi: adv.monthlyEmi > 0 
            ? adv.monthlyEmi 
            : Math.round((adv.amount / (adv.months || 1)) * 100) / 100,
          paidAmount: adv.paidAmount,
          remainingAmount: adv.status === 'APPROVED' ? adv.remainingAmount : adv.amount,
          paidEmis: adv.paidEmis,
          pendingEmis: Math.max(0, (adv.months || 1) - adv.paidEmis),
          status: adv.status,
          requestedOn: adv.requestedOn.toISOString(),
          approvedAt: adv.approvedAt ? adv.approvedAt.toISOString() : null,
          reviewedAt: adv.reviewedAt ? adv.reviewedAt.toISOString() : null,
          reviewedBy: adv.reviewedBy,
          reviewNote: adv.reviewNote,
        })),
        transactions: wallet.transactions.map(tx => ({
          id: tx.id.toString(),
          title: tx.title,
          category: tx.category,
          amount: tx.amount,
          date: tx.date.toISOString(),
          status: tx.status,
          isCredit: tx.isCredit,
          description: tx.description,
        })),
        salary: salaryStructure ? {
          monthlySalary: salaryStructure.monthlySalary,
          grossSalary: salaryStructure.grossSalary,
          basicSalary: salaryStructure.basicSalary,
          hra: salaryStructure.hra,
          medicalAllowance: salaryStructure.medicalAllowance,
          travelAllowance: salaryStructure.travelAllowance,
          specialAllowance: salaryStructure.specialAllowance,
          incentive: salaryStructure.incentive,
          bonus: salaryStructure.bonus,
          salaryAdvanceLimit: effectiveLimit,
        } : null,
      },
    });
  } catch (error) {
    console.error('Fetch wallet error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch wallet data.' });
  }
};

export const requestSalaryAdvance = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { amount, months, reason } = req.body;
    const employee = await getEmployeeFromRequest(req);

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found.' });
      return;
    }

    const numAmount = Number(amount);
    const numMonths = Math.max(1, Number(months) || 1);
    const cleanReason = reason ? String(reason).trim() : 'Salary Advance Request';

    if (isNaN(numAmount) || numAmount <= 0) {
      res.status(400).json({ success: false, message: 'Please enter a valid amount greater than 0.' });
      return;
    }

    // Atomic validation and creation inside database transaction to prevent race conditions
    const result = await prisma.$transaction(async (tx) => {
      // 1. Get or create wallet
      let wallet = await tx.wallet.findUnique({
        where: { employeeId: employee.id },
      });

      const salaryStructure = await tx.salaryStructure.findUnique({
        where: { employeeId: employee.id },
      });

      const effectiveLimit = salaryStructure?.salaryAdvanceLimit !== undefined && salaryStructure?.salaryAdvanceLimit !== null
        ? salaryStructure.salaryAdvanceLimit
        : (wallet?.advanceLimit || 0);

      if (!wallet) {
        const last4Phone = employee.mobileNumber
          ? employee.mobileNumber.replace(/\D/g, '').slice(-4)
          : '0000';
        wallet = await tx.wallet.create({
          data: {
            employeeId: employee.id,
            availableBalance: 0,
            advanceLimit: effectiveLimit,
            pendingClaims: 0,
            cardNumber: `HK-${employee.employeeCode}-${last4Phone}`,
          },
        });
      }

      // 2. Fetch active advances (PENDING and APPROVED)
      const activeAdvances = await tx.salaryAdvance.findMany({
        where: {
          walletId: wallet.id,
          status: { in: ['PENDING', 'APPROVED'] },
        },
        orderBy: { requestedOn: 'desc' },
      });

      // Prevent duplicate submissions caused by double tapping (within 4 seconds)
      const recentDup = activeAdvances.find(
        (a) =>
          a.amount === numAmount &&
          a.status === 'PENDING' &&
          Date.now() - new Date(a.requestedOn).getTime() < 4000
      );
      if (recentDup) {
        throw new Error('DUPLICATE_SUBMISSION');
      }

      // 3. Compute cumulative consumed amount
      const pendingSum = activeAdvances
        .filter((a) => a.status === 'PENDING')
        .reduce((sum, a) => sum + (a.amount || 0), 0);

      const approvedSum = activeAdvances
        .filter((a) => a.status === 'APPROVED')
        .reduce((sum, a) => sum + (a.remainingAmount > 0 ? a.remainingAmount : 0), 0);

      const totalActiveUsed = pendingSum + approvedSum;
      const remainingLimit = Math.max(0, effectiveLimit - totalActiveUsed);

      if (remainingLimit <= 0) {
        const err: any = new Error('LIMIT_EXHAUSTED');
        err.remainingLimit = 0;
        throw err;
      }

      if (numAmount > remainingLimit) {
        const err: any = new Error('LIMIT_EXCEEDED');
        err.remainingLimit = remainingLimit;
        throw err;
      }

      const calculatedEmi = Math.round((numAmount / numMonths) * 100) / 100;

      // 4. Create salary advance request
      const advance = await tx.salaryAdvance.create({
        data: {
          walletId: wallet.id,
          amount: numAmount,
          months: numMonths,
          monthlyEmi: calculatedEmi,
          remainingAmount: numAmount,
          reason: cleanReason,
          status: 'PENDING',
        },
      });

      // 5. Create transaction record
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          title: 'Salary Advance Request',
          category: 'Advance',
          amount: numAmount,
          date: new Date(),
          status: 'Processing',
          isCredit: false,
          description: `Salary advance requested: ₹${numAmount} (${numMonths} EMIs). Pending HR Approval.`,
        },
      });

      const newRemainingLimit = Math.max(0, remainingLimit - numAmount);

      return { advance, remainingLimit: newRemainingLimit };
    });

    // Notify HR of new salary advance request (in-app & FCM push outside app)
    firebaseNotificationService.sendAppNotification({
      role: 'HR',
      title: 'New Salary Advance Request',
      body: `${employee.firstName} ${employee.lastName || ''} requested a salary advance of ₹${numAmount}.`,
      category: 'advance',
      screen: 'salary_advance',
      type: 'salary_advance_request',
      actionId: result.advance.id.toString(),
    }).catch(err => console.error('Advance request notification error:', err));

    res.json({
      success: true,
      message: 'Salary advance request submitted successfully.',
      advance: {
        id: result.advance.id.toString(),
        amount: result.advance.amount,
        months: result.advance.months,
        monthlyEmi: result.advance.monthlyEmi,
        status: result.advance.status,
        requestedOn: result.advance.requestedOn.toISOString(),
      },
      remainingLimit: result.remainingLimit,
    });
  } catch (error: any) {
    if (error?.message === 'DUPLICATE_SUBMISSION') {
      res.status(400).json({
        success: false,
        message: 'Duplicate submission detected. Please wait a moment before submitting again.',
      });
      return;
    }

    if (error?.message === 'LIMIT_EXHAUSTED') {
      res.status(400).json({
        success: false,
        message: 'Advance salary limit exhausted. You have no remaining advance salary balance.',
        remainingLimit: 0,
      });
      return;
    }

    if (error?.message === 'LIMIT_EXCEEDED') {
      const formattedRem = error.remainingLimit?.toLocaleString('en-IN') || error.remainingLimit;
      res.status(400).json({
        success: false,
        message: `You can apply for a maximum of ₹${formattedRem}. Your remaining advance salary limit is ₹${formattedRem}.`,
        remainingLimit: error.remainingLimit,
      });
      return;
    }

    console.error('Request salary advance error:', error);
    res.status(500).json({ success: false, message: error?.message || 'Failed to submit salary advance request.' });
  }
};

export const fetchBankDetails = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    await ensureBankEditTable();

    const employee = await getEmployeeFromRequest(req);
    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee profile not found.' });
      return;
    }

    let latestRequest = null;
    try {
      latestRequest = await prisma.bankEditRequest.findFirst({
        where: { employeeId: employee.id },
        orderBy: { createdAt: 'desc' },
      });
    } catch (dbErr) {
      console.warn('BankEditRequest query exception ignored:', dbErr);
    }

    res.json({
      success: true,
      bankDetails: {
        bankName: employee.bankName || null,
        accountNumber: employee.accountNumber || null,
        ifscCode: employee.ifscCode || null,
        accountType: employee.accountType || 'Savings',
        branchName: employee.branchName || null,
        accountHolder: `${employee.firstName || ''} ${employee.lastName || ''}`.trim() || 'Account Holder',
      },
      latestRequest: latestRequest
        ? {
            id: latestRequest.id,
            status: latestRequest.status,
            reason: latestRequest.reason,
            createdAt: latestRequest.createdAt,
          }
        : null,
      canEditDirectly: latestRequest?.status === 'APPROVED',
    });
  } catch (error) {
    console.error('Fetch bank details error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch bank details.' });
  }
};

export const requestBankDetailsEdit = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    await ensureBankEditTable();

    const employee = await getEmployeeFromRequest(req);
    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee profile not found.' });
      return;
    }

    const { reason, bankName, accountNumber, ifscCode, accountType, branchName } = req.body;

    let existingPending = null;
    try {
      existingPending = await prisma.bankEditRequest.findFirst({
        where: { employeeId: employee.id, status: 'PENDING' },
      });
    } catch (e) {
      console.warn('BankEditRequest existingPending check warning:', e);
    }

    if (existingPending) {
      res.status(400).json({
        success: false,
        message: 'A bank edit request is already pending HR approval.',
      });
      return;
    }

    const editRequest = await prisma.bankEditRequest.create({
      data: {
        employeeId: employee.id,
        bankName: bankName || null,
        accountNumber: accountNumber || null,
        ifscCode: ifscCode || null,
        accountType: accountType || null,
        branchName: branchName || null,
        reason: reason || 'Requested permission to update bank account details',
        status: 'PENDING',
      },
    });

    try {
      const hrUsers = await prisma.user.findMany({
        where: { role: { in: ['HR', 'ADMIN', 'STORE_MANAGER'] } },
      });
      const hrUserIds = hrUsers.map((u) => u.id);
      if (hrUserIds.length > 0) {
        await pushNotificationService.sendPush(
          hrUserIds,
          'Bank Edit Request',
          `${employee.firstName} ${employee.lastName} requested permission to edit bank account details.`,
          { type: 'BANK_EDIT_REQUEST', requestId: editRequest.id.toString() }
        );
      }
    } catch (e) {
      console.error('Notification error:', e);
    }

    res.json({
      success: true,
      message: 'Bank details edit request submitted to HR.',
      request: editRequest,
    });
  } catch (error) {
    console.error('Request bank details edit error:', error);
    res.status(500).json({ success: false, message: 'Failed to submit request.' });
  }
};

export const updateBankDetails = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    await ensureBankEditTable();

    const employee = await getEmployeeFromRequest(req);
    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee profile not found.' });
      return;
    }

    const { bankName, accountNumber, ifscCode, accountType, branchName } = req.body;

    let approvedRequest = null;
    try {
      approvedRequest = await prisma.bankEditRequest.findFirst({
        where: { employeeId: employee.id, status: 'APPROVED' },
        orderBy: { createdAt: 'desc' },
      });
    } catch (e) {
      console.warn('BankEditRequest approved query warning:', e);
    }

    const isHrOrAdmin = req.user?.role?.includes('HR') || req.user?.role?.includes('ADMIN');

    if (!approvedRequest && !isHrOrAdmin) {
      res.status(403).json({
        success: false,
        message: 'Permission required. Please request HR approval before updating bank details.',
      });
      return;
    }

    const updatedEmployee = await prisma.employee.update({
      where: { id: employee.id },
      data: {
        bankName: bankName !== undefined ? bankName : employee.bankName,
        accountNumber: accountNumber !== undefined ? accountNumber : employee.accountNumber,
        ifscCode: ifscCode !== undefined ? ifscCode : employee.ifscCode,
        accountType: accountType !== undefined ? accountType : employee.accountType,
        branchName: branchName !== undefined ? branchName : employee.branchName,
      },
    });

    if (approvedRequest) {
      try {
        await prisma.bankEditRequest.update({
          where: { id: approvedRequest.id },
          data: { status: 'COMPLETED', decidedAt: new Date() },
        });
      } catch (e) {
        console.warn('BankEditRequest status update warning:', e);
      }
    }

    res.json({
      success: true,
      message: 'Bank details updated successfully.',
      bankDetails: {
        bankName: updatedEmployee.bankName,
        accountNumber: updatedEmployee.accountNumber,
        ifscCode: updatedEmployee.ifscCode,
        accountType: updatedEmployee.accountType,
        branchName: updatedEmployee.branchName,
        accountHolder: `${updatedEmployee.firstName || ''} ${updatedEmployee.lastName || ''}`.trim() || 'Account Holder',
      },
    });
  } catch (error) {
    console.error('Update bank details error:', error);
    res.status(500).json({ success: false, message: 'Failed to update bank details.' });
  }
};


/**
 * POST /api/employee/wallet/advance/:id/repay
 * Manually repay a portion of an active salary advance
 */
export const repaySalaryAdvance = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const { amount, paymentMethod } = req.body;
    const employee = await getEmployeeFromRequest(req);

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found.' });
      return;
    }

    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      res.status(400).json({ success: false, message: 'Please enter a valid repayment amount.' });
      return;
    }

    const advanceId = parseInt(id as string, 10);
    if (isNaN(advanceId)) {
      res.status(400).json({ success: false, message: 'Invalid advance ID.' });
      return;
    }

    const advance = await prisma.salaryAdvance.findFirst({
      where: {
        id: advanceId,
        wallet: { employeeId: employee.id }
      },
      include: { wallet: true }
    });

    if (!advance) {
      res.status(404).json({ success: false, message: 'Salary advance not found or unauthorized.' });
      return;
    }

    if (advance.status !== 'APPROVED') {
      res.status(400).json({ success: false, message: 'Only approved advances can be repaid.' });
      return;
    }

    if (advance.remainingAmount <= 0) {
      res.status(400).json({ success: false, message: 'This advance is already fully repaid.' });
      return;
    }

    const repayAmount = Math.min(numAmount, advance.remainingAmount);
    const newPaidAmount = advance.paidAmount + repayAmount;
    const newRemainingAmount = advance.remainingAmount - repayAmount;
    
    const emisPaidThisTime = advance.monthlyEmi > 0 ? Math.floor(repayAmount / advance.monthlyEmi) : 1;
    const newPaidEmis = advance.paidEmis + Math.max(1, emisPaidThisTime);

    let newStatus = advance.status;
    if (newRemainingAmount <= 0) {
      newStatus = 'COMPLETED';
    }

    const updatedAdvance = await prisma.$transaction(async (tx) => {
      // 1. Update the advance record
      const adv = await tx.salaryAdvance.update({
        where: { id: advance.id },
        data: {
          paidAmount: newPaidAmount,
          remainingAmount: newRemainingAmount,
          paidEmis: newPaidEmis,
          status: newStatus
        }
      });

      // 2. Log transaction in wallet history
      await tx.walletTransaction.create({
        data: {
          walletId: advance.walletId,
          title: 'Advance EMI Repayment',
          category: 'Repayment',
          amount: repayAmount,
          date: new Date(),
          status: 'Success',
          isCredit: false,
          description: `Manual repayment via ${paymentMethod || 'API'} for Advance #${advance.id}`,
        }
      });
      
      // Optionally deduct from wallet availableBalance if they are paying from wallet
      if (paymentMethod === 'WALLET') {
         await tx.wallet.update({
           where: { id: advance.walletId },
           data: {
             availableBalance: { decrement: repayAmount }
           }
         });
      }

      return adv;
    });

    res.status(200).json({
      success: true,
      message: 'Repayment processed successfully',
      advance: updatedAdvance
    });

  } catch (error) {
    console.error('Error in repaySalaryAdvance:', error);
    res.status(500).json({ success: false, message: 'Failed to process repayment.' });
  }
};
