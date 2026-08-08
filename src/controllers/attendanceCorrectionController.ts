import { Response } from 'express';
import { prisma } from '../utils/db';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { firebaseNotificationService } from '../services/firebaseNotificationService';

// 1. Employee: Submit Attendance Correction Request
export const submitCorrectionRequest = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { date, currentStatus, requestedStatus, reason } = req.body;

    if (!date || !requestedStatus || !reason) {
      res.status(400).json({
        success: false,
        message: 'Missing required fields: date, requestedStatus, reason',
      });
      return;
    }

    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
    });

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee profile not found' });
      return;
    }

    const targetDate = new Date(date);
    const empIdentifier = employee.employeeID || String(employee.id);

    // Check if there is already a PENDING request for that date
    const startOfTarget = new Date(targetDate);
    startOfTarget.setHours(0, 0, 0, 0);
    const endOfTarget = new Date(targetDate);
    endOfTarget.setHours(23, 59, 59, 999);

    const existingPending = await prisma.attendanceCorrectionRequest.findFirst({
      where: {
        employeeId: empIdentifier,
        status: 'PENDING',
        date: {
          gte: startOfTarget,
          lte: endOfTarget,
        },
      },
    });

    if (existingPending) {
      res.status(400).json({
        success: false,
        message: 'You already have a pending correction request for this date.',
      });
      return;
    }

    const correction = await prisma.attendanceCorrectionRequest.create({
      data: {
        employeeId: empIdentifier,
        date: targetDate,
        currentStatus: currentStatus || 'ABSENT',
        requestedStatus: requestedStatus.toUpperCase(),
        reason: reason.trim(),
        status: 'PENDING',
        appliedOn: new Date(),
      },
    });

    // Notify HR via FCM and DB notification
    const employeeName = `${employee.firstName} ${employee.lastName}`.trim();
    const dateFormatted = targetDate.toISOString().split('T')[0];

    try {
      firebaseNotificationService.sendAppNotification({
        role: 'HR',
        title: 'Attendance Correction Request',
        body: `Attendance correction from ${employeeName} on ${dateFormatted}`,
        category: 'attendance',
        screen: 'attendance_corrections',
        type: 'attendance_correction_submitted',
        actionId: correction.id,
      }).catch(err => console.error('FCM HR push error:', err));
    } catch (e) {
      console.error('Notification error:', e);
    }

    res.status(201).json({
      success: true,
      message: 'Attendance correction request submitted successfully.',
      correction,
    });
  } catch (error) {
    console.error('Submit correction request error:', error);
    res.status(500).json({ success: false, message: 'Failed to submit correction request.' });
  }
};

// 2. Employee: Get Own Attendance Correction Requests
export const getMyCorrectionRequests = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
    });

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee profile not found' });
      return;
    }

    const empIdentifier = employee.employeeID || String(employee.id);

    const requests = await prisma.attendanceCorrectionRequest.findMany({
      where: {
        OR: [
          { employeeId: empIdentifier },
          { employeeId: String(employee.id) },
        ],
      },
      orderBy: { appliedOn: 'desc' },
    });

    res.json({
      success: true,
      requests,
    });
  } catch (error) {
    console.error('Get my correction requests error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch correction requests.' });
  }
};

// 3. HR: Get All Correction Requests (Filtered)
export const getHRCorrectionRequests = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { status, fromDate, toDate, employeeId } = req.query as {
      status?: string;
      fromDate?: string;
      toDate?: string;
      employeeId?: string;
    };

    const where: any = {};

    if (status && status !== 'ALL') {
      where.status = status.toUpperCase();
    }

    if (fromDate && toDate) {
      where.date = {
        gte: new Date(fromDate),
        lte: new Date(toDate),
      };
    }

    if (employeeId) {
      where.employeeId = employeeId;
    }

    const rawRequests = await prisma.attendanceCorrectionRequest.findMany({
      where,
      orderBy: { appliedOn: 'desc' },
    });

    // Fetch employee metadata for rich display
    const employeeIds = Array.from(new Set(rawRequests.map((r: any) => String(r.employeeId))));
    const numericIds = employeeIds.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
    const employees = await prisma.employee.findMany({
      where: {
        OR: [
          { employeeID: { in: employeeIds } },
          { id: { in: numericIds } },
        ],
      },
      include: {
        office: true,
        department: true,
      },
    });

    const empMap = new Map<string, any>();
    employees.forEach((emp: any) => {
      if (emp.employeeID) empMap.set(emp.employeeID, emp);
      empMap.set(String(emp.id), emp);
    });

    const requests = rawRequests.map((r: any) => {
      const emp = empMap.get(r.employeeId);
      return {
        ...r,
        employee: emp
          ? {
              id: emp.id,
              employeeCode: emp.employeeCode,
              name: `${emp.firstName} ${emp.lastName}`.trim(),
              designation: emp.designation,
              officeName: emp.office?.name || 'N/A',
              departmentName: emp.department?.name || 'N/A',
            }
          : {
              id: r.employeeId,
              employeeCode: r.employeeId,
              name: 'Employee (' + r.employeeId + ')',
              designation: 'Staff',
              officeName: 'N/A',
              departmentName: 'N/A',
            },
      };
    });

    res.json({
      success: true,
      requests,
    });
  } catch (error) {
    console.error('Get HR correction requests error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch HR correction requests.' });
  }
};

// 4. HR: Review (Approve / Reject) Attendance Correction Request
export const reviewCorrectionRequest = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, reviewNote } = req.body; // APPROVED or REJECTED

    if (!status || !['APPROVED', 'REJECTED'].includes(status.toUpperCase())) {
      res.status(400).json({
        success: false,
        message: 'Status must be APPROVED or REJECTED.',
      });
      return;
    }

    const request = await prisma.attendanceCorrectionRequest.findUnique({
      where: { id: String(id) },
    });

    if (!request) {
      res.status(404).json({ success: false, message: 'Correction request not found.' });
      return;
    }

    if (request.status !== 'PENDING') {
      res.status(400).json({
        success: false,
        message: `Request has already been ${request.status.toLowerCase()}.`,
      });
      return;
    }

    const hrUserId = String(req.user?.id || 'HR');
    const newStatus = status.toUpperCase();

    const updatedRequest = await prisma.attendanceCorrectionRequest.update({
      where: { id: String(id) },
      data: {
        status: newStatus,
        reviewedBy: hrUserId,
        reviewedAt: new Date(),
        reviewNote: reviewNote ? reviewNote.trim() : null,
      },
    });

    // Find the associated employee
    const employee = await prisma.employee.findFirst({
      where: {
        OR: [
          { employeeID: request.employeeId },
          { id: isNaN(parseInt(request.employeeId)) ? undefined : parseInt(request.employeeId) },
        ],
      },
      include: { user: true },
    });

    if (newStatus === 'APPROVED' && employee) {
      const dateStr = request.date.toISOString().split('T')[0];

      // Auto-update attendance table
      const existingAttendance = await prisma.attendance.findFirst({
        where: {
          employeeId: employee.id,
          date: dateStr,
        },
      });

      if (existingAttendance) {
        await prisma.attendance.update({
          where: { id: existingAttendance.id },
          data: {
            status: request.requestedStatus,
            notes: `Corrected via request ${request.id} (Note: ${reviewNote || 'Approved by HR'})`,
          },
        });
      } else {
        await prisma.attendance.create({
          data: {
            employeeId: employee.id,
            officeId: employee.officeId,
            date: dateStr,
            status: request.requestedStatus,
            notes: `Created via correction request ${request.id}`,
          },
        });
      }
    }

    // Audit Trail Logging
    await prisma.auditLog.create({
      data: {
        userId: req.user?.id,
        employeeId: employee?.id,
        action: `ATTENDANCE_CORRECTION_${newStatus}`,
        deviceInfo: `Request ID: ${request.id}, Requested: ${request.requestedStatus}, Note: ${reviewNote || 'None'}`,
      },
    });

    // FCM Notification to employee
    if (employee?.userId) {
      const notifBody = newStatus === 'APPROVED'
        ? `✅ Attendance corrected to ${request.requestedStatus}`
        : `❌ Request rejected: ${reviewNote || 'No review note provided'}`;

      firebaseNotificationService.sendAppNotification({
        userId: employee.userId,
        title: `Attendance Correction ${newStatus === 'APPROVED' ? 'Approved' : 'Rejected'}`,
        body: notifBody,
        category: 'attendance',
        screen: 'attendance',
        type: newStatus === 'APPROVED' ? 'correction_approved' : 'correction_rejected',
        actionId: request.id,
      }).catch(err => console.error('FCM Employee push error:', err));
    }

    res.json({
      success: true,
      message: `Correction request ${newStatus.toLowerCase()} successfully.`,
      request: updatedRequest,
    });
  } catch (error) {
    console.error('Review correction request error:', error);
    res.status(500).json({ success: false, message: 'Failed to review correction request.' });
  }
};
