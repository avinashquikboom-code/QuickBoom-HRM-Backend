import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';

// Helper to fetch active Employee profile associated with the authenticated user
const getEmployeeFromRequest = async (req: AuthenticatedRequest) => {
  if (!req.user) return null;
  return await prisma.employee.findUnique({
    where: { userId: req.user.id },
    include: { department: true, office: true, user: { include: { profile: true } } },
  });
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

    if (!employee || !employee.user || !employee.user.profile) {
      res.status(404).json({ success: false, message: 'Employee profile not found.' });
      return;
    }

    const { profile } = employee.user;

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
    });
  } catch (error) {
    console.error('Fetch employee profile error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch profile.' });
  }
};

export const updateEmployeeProfile = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { fullName, phone, bio } = req.body;

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

    // Check if check-in already exists for today
    const existing = await prisma.attendance.findFirst({
      where: { employeeId: employee.id, date: todayStr },
    });

    if (existing && existing.checkIn) {
      res.status(400).json({ success: false, message: 'Already checked in for today.' });
      return;
    }

    // Determine status (Late if check-in is past 09:15 AM)
    const isLate = now.getHours() > 9 || (now.getHours() === 9 && now.getMinutes() > 15);
    const status = isLate ? 'LATE' : 'PRESENT';

    let record;
    if (existing) {
      // If record was created (e.g. pre-marked ABSENT/WEEKEND), update it
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

    // Helper to calculate total days for approved leaves by type
    const getUsedDays = (type: string) => {
      return leaveRequests
        .filter((l) => l.status === 'APPROVED' && l.type === type)
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
  const { type, fromDate, toDate, reason } = req.body;

  if (!type || !fromDate || !toDate || !reason) {
    res.status(400).json({ success: false, message: 'All parameters (type, fromDate, toDate, reason) are required.' });
    return;
  }

  try {
    const employee = await getEmployeeFromRequest(req);
    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found.' });
      return;
    }

    const leave = await prisma.leaveRequest.create({
      data: {
        employeeId: employee.id,
        type: type.toUpperCase(), // Map e.g. "casual" to "CASUAL"
        fromDate: new Date(fromDate),
        toDate: new Date(toDate),
        reason: reason.trim(),
        status: 'PENDING',
      },
    });

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

    res.json({
      success: true,
      assignment: assignment
        ? {
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
          }
        : null,
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

    const expense = await prisma.expense.create({
      data: {
        employeeId: employee.id,
        category: category.toUpperCase(),
        amount: parseFloat(amount),
        description: description.trim(),
        date: new Date(date),
        status: 'PENDING',
        hasReceipt: !!imageBase64,
        receiptUrl: imageBase64 || null,
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

    const getUsedDays = (type: string) => {
      return totalLeaves
        .filter((l) => l.status === 'APPROVED' && l.type === type)
        .reduce((sum, l) => {
          const diffTime = Math.abs(l.toDate.getTime() - l.fromDate.getTime());
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
          return sum + diffDays;
        }, 0);
    };

    const casualUsed = getUsedDays('CASUAL');
    const sickUsed = getUsedDays('SICK');
    const earnedUsed = getUsedDays('EARNED');

    // D. Tasks statistics
    const totalTasks = await prisma.task.findMany({
      where: { assignedToId: employee.id },
    });
    const completedTasksCount = totalTasks.filter((t) => t.status === 'COMPLETED').length;
    const pendingTasksCount = totalTasks.filter((t) => t.status !== 'COMPLETED').length;

    // E. Fetch recent announcements
    const announcements = await prisma.announcement.findMany({
      take: 3,
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      stats: {
        tasks: {
          total: totalTasks.length,
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
