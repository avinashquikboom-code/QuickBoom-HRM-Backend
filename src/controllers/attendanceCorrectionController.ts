import { Request, Response } from 'express';
import { prisma } from '../utils/db';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { firebaseNotificationService } from '../services/firebaseNotificationService';
import { getEffectiveUserPermissions } from '../utils/permissionHelper';

// Helper to safely extract single string from params
function getSingleParam(param: string | string[] | undefined): string | undefined {
  if (!param) return undefined;
  return Array.isArray(param) ? param[0] : param;
}

// Helper: Recalculate Payslip if affected by attendance change
async function recalculatePayslipIfPresent(employeeId: number, targetDate: Date) {
  try {
    const month = targetDate.getMonth() + 1;
    const year = targetDate.getFullYear();

    const payslip = await prisma.payslip.findFirst({
      where: { employeeId, month, year },
    });

    if (!payslip) return;

    const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
    const attendances = await prisma.attendance.findMany({
      where: {
        employeeId,
        date: { startsWith: monthPrefix },
      },
    });

    const presentRecords = attendances.filter(
      (a) => a.status === 'PRESENT' || a.status === 'LATE' || a.status === 'HALF_DAY' || a.checkIn !== null
    );
    const presentCount = presentRecords.length;

    const salaryStructure = await prisma.salaryStructure.findUnique({
      where: { employeeId },
    });

    const gross = salaryStructure?.grossSalary || salaryStructure?.monthlySalary || payslip.baseSalary || 25000;
    const basic = salaryStructure?.basicSalary || Math.round(gross * 0.5);
    const workingDays = 25;
    const perDayRate = gross / workingDays;

    const newNetSalary = Math.max(0, Math.round(presentCount * perDayRate));

    await prisma.payslip.update({
      where: { id: payslip.id },
      data: {
        netSalary: newNetSalary,
        updatedAt: new Date(),
      },
    });
    console.log(`📊 Recalculated payslip #${payslip.id} for employee #${employeeId}: new netSalary=${newNetSalary}`);
  } catch (error) {
    console.error('Error recalculating payslip for correction:', error);
  }
}

// Helper: Send Notification to Employee
async function notifyEmployee(
  employeeId: number,
  title: string,
  message: string,
  type: string = 'ATTENDANCE_CORRECTION',
  extraData?: Record<string, string>
) {
  try {
    await prisma.notification.create({
      data: {
        employeeId,
        title,
        body: message,
        category: 'ATTENDANCE',
        actionType: type,
        isRead: false,
      },
    });

    const emp = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { userId: true },
    });

    if (emp?.userId) {
      try {
        await firebaseNotificationService.sendNotificationToUser(emp.userId, title, message, {
          type,
          screen: '/attendance/corrections',
          action: 'open_details',
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
          ...extraData,
        });
      } catch (fcmErr) {
        console.warn(`[notifyEmployee] FCM notification skipped or failed for user ${emp.userId}:`, fcmErr);
      }
    }
  } catch (error) {
    console.error('Error sending notification to employee:', error);
  }
}

// Helper: Send Notification to HR / Admin Team
async function notifyHRTeam(title: string, message: string) {
  try {
    const hrEmployees = await prisma.employee.findMany({
      where: {
        user: {
          role: { in: ['SUPER_ADMIN', 'ADMIN', 'HR', 'PLATFORM_ADMIN', 'STORE_MANAGER'] },
        },
      },
      select: { id: true, userId: true },
    });

    for (const hr of hrEmployees) {
      await prisma.notification.create({
        data: {
          employeeId: hr.id,
          title,
          body: message,
          category: 'ATTENDANCE',
          actionType: 'ATTENDANCE_CORRECTION_REQUEST',
          isRead: false,
        },
      });
    }

    const hrRoles = ['HR', 'ADMIN', 'SUPER_ADMIN', 'PLATFORM_ADMIN', 'STORE_MANAGER'];
    for (const role of hrRoles) {
      try {
        await firebaseNotificationService.sendNotificationToRole(role, title, message, {
          type: 'ATTENDANCE_CORRECTION_REQUEST',
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
        });
      } catch (fcmErr) {
        // Silently skip if no FCM tokens exist for the role
      }
    }
  } catch (error) {
    console.error('Error notifying HR team:', error);
  }
}

// 1. Employee apply for attendance correction
export const applyCorrectionRequest = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const permissions = await getEffectiveUserPermissions(userId);
    if (!permissions.canRequestAttendanceCorrection) {
      return res.status(403).json({ error: 'Permission denied: HR must enable "Request Attendance Correction" permission for your account.' });
    }

    const employee = await prisma.employee.findUnique({
      where: { userId },
    });
    if (!employee) return res.status(404).json({ error: 'Employee record not found' });

    const { attendanceDate, currentStatus: inputCurrentStatus, requestedStatus, reason, supportingDoc } = req.body;

    if (!attendanceDate || !requestedStatus || !reason) {
      return res.status(400).json({ error: 'attendanceDate, requestedStatus, and reason are required.' });
    }

    const targetDate = new Date(attendanceDate);
    if (isNaN(targetDate.getTime())) {
      return res.status(400).json({ error: 'Invalid attendanceDate format' });
    }

    // Validate: past 30 days limit
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    if (targetDate < thirtyDaysAgo) {
      return res.status(400).json({ error: 'Attendance corrections can only be requested for dates within the past 30 days.' });
    }

    const dateStart = new Date(targetDate);
    dateStart.setHours(0, 0, 0, 0);
    const dateEnd = new Date(targetDate);
    dateEnd.setHours(23, 59, 59, 999);

    // Validate: cannot apply if already have PENDING request for same date
    const existingPending = await prisma.attendanceCorrectionRequest.findFirst({
      where: {
        employeeId: employee.employeeCode,
        attendanceDate: {
          gte: dateStart,
          lte: dateEnd,
        },
        status: 'PENDING',
      },
    });

    if (existingPending) {
      return res.status(400).json({ error: 'A pending correction request already exists for this date.' });
    }

    // Auto-fetch current attendance status for this date from DB if available
    const dateStr = targetDate.toISOString().split('T')[0];
    const attendanceRecord = await prisma.attendance.findFirst({
      where: {
        employeeId: employee.id,
        date: dateStr,
      },
    });

    let currentStatus = inputCurrentStatus || 'ABSENT';
    if (attendanceRecord) {
      currentStatus = attendanceRecord.status || 'PRESENT';
    }

    // Create correction request row
    const requestRow = await prisma.attendanceCorrectionRequest.create({
      data: {
        employeeId: employee.employeeCode,
        attendanceDate: targetDate,
        currentStatus,
        requestedStatus,
        reason,
        supportingDoc: supportingDoc || null,
        status: 'PENDING',
      },
    });

    const empName = `${employee.firstName} ${employee.lastName}`.trim();
    const dateFormatted = targetDate.toISOString().split('T')[0];
    await notifyHRTeam(
      `Attendance Correction Request: ${empName}`,
      `Attendance correction request from ${empName} on ${dateFormatted}: ${currentStatus} → ${requestedStatus}`
    );

    return res.json({
      success: true,
      message: 'Attendance correction request submitted successfully.',
      requestId: requestRow.id,
      request: requestRow,
    });
  } catch (error) {
    console.error('Error applying for attendance correction:', error);
    return res.status(500).json({ error: 'Server error creating attendance correction request' });
  }
};

export const resubmitCorrectionRequest = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const id = req.params.id as string;
    const { requestedStatus, reason, supportingDoc } = req.body;

    const employee = await prisma.employee.findUnique({
      where: { userId },
    });
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    // Step 1: Get original correction
    const original = await prisma.attendanceCorrectionRequest.findUnique({
      where: { id }
    });
    
    if (!original) {
      return res.status(404).json({ success: false, error: 'Correction not found' });
    }
    
    // Step 2: Verify can resubmit (only if REJECTED)
    if (original.status !== 'REJECTED') {
      return res.status(400).json({
        success: false,
        error: `Cannot resubmit ${original.status} correction. Only REJECTED can be resubmitted.`
      });
    }
    
    // Step 3: Verify employee owns this
    const isOwner = original.employeeId === employee.employeeCode ||
                    original.employeeId === String(employee.id) ||
                    original.employeeId === employee.employeeID;
    if (!isOwner) {
      return res.status(403).json({ success: false, error: 'Unauthorized: You can only resubmit your own correction requests.' });
    }
    
    const dateStart = new Date(original.attendanceDate);
    dateStart.setHours(0, 0, 0, 0);
    const dateEnd = new Date(original.attendanceDate);
    dateEnd.setHours(23, 59, 59, 999);

    // Step 4: Check no PENDING for same date
    const pendingConflict = await prisma.attendanceCorrectionRequest.findFirst({
      where: {
        employeeId: employee.employeeCode,
        attendanceDate: {
          gte: dateStart,
          lte: dateEnd,
        },
        status: 'PENDING',
        id: { not: id } // Exclude the current request being resubmitted
      }
    });
    
    if (pendingConflict) {
      return res.status(400).json({
        success: false,
        error: 'A pending correction request already exists for this date.'
      });
    }

    // Build a unified reason string that preserves the thread history
    const hrComment = original.reviewNote ? `\n\n[HR Rejection Note]: ${original.reviewNote}` : '';
    const oldReasonText = original.reason ? `\n[Original Reason]: ${original.reason}` : '';
    
    // Prevent nesting history forever if they resubmit multiple times
    let newReason = reason;
    if (original.reason.includes('--- Previous History ---')) {
      // It already has history, so just append the new stuff before the separator
      const parts = original.reason.split('--- Previous History ---');
      newReason = `${reason}\n\n--- Previous History ---${hrComment}\n[Previous Resubmit]: ${parts[0].trim()}\n\n[Older History]:${parts[1]}`;
    } else {
      newReason = `${reason}\n\n--- Previous History ---${hrComment}${oldReasonText}`;
    }

    // Step 6: Create NEW correction request
    const newCorrection = await prisma.attendanceCorrectionRequest.create({
      data: {
        employeeId: original.employeeId,
        attendanceDate: original.attendanceDate,
        currentStatus: original.currentStatus,
        requestedStatus,
        reason: newReason.trim(),
        supportingDoc: supportingDoc || original.supportingDoc,
        status: 'PENDING',
      }
    });

    console.log(`[AUDIT LOG] Employee ${userId} resubmitted correction for ${original.attendanceDate}: new id=${newCorrection.id}, old id=${id}`);
    
    const empName = `${employee.firstName} ${employee.lastName}`.trim();
    const dateFormatted = original.attendanceDate.toISOString().split('T')[0];
    
    // Step 7: Notify HR
    await notifyHRTeam(
      `Attendance Correction Resubmitted: ${empName}`,
      `Attendance correction resubmitted by ${empName} for ${dateFormatted}: ${original.currentStatus} → ${requestedStatus}`
    );
    
    return res.json({
      success: true,
      message: 'Request resubmitted successfully',
      requestId: newCorrection.id,
      request: newCorrection
    });
    
  } catch (error: any) {
    console.error('Resubmit error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to resubmit'
    });
  }
};

// 2. Employee get my corrections
export const getMyCorrections = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const permissions = await getEffectiveUserPermissions(userId);
    if (!permissions.canRequestAttendanceCorrection) {
      return res.status(403).json({ error: 'Permission denied: HR must enable "Request Attendance Correction" permission for your account.' });
    }

    const employee = await prisma.employee.findUnique({
      where: { userId },
    });
    if (!employee) return res.status(404).json({ error: 'Employee record not found' });

    const statusParam = getSingleParam(req.query.status as any);
    const where: any = { employeeId: employee.employeeCode };

    if (statusParam && statusParam !== 'ALL') {
      where.status = statusParam;
    }

    const requests = await prisma.attendanceCorrectionRequest.findMany({
      where,
      orderBy: {
        appliedOn: 'desc',
      },
    });

    return res.json({
      success: true,
      data: requests,
      requests,
    });
  } catch (error) {
    console.error('Error fetching employee correction requests:', error);
    return res.status(500).json({ error: 'Server error fetching my correction requests' });
  }
};

// 3. HR list correction requests
export const getHRAttendanceCorrections = async (req: Request, res: Response) => {
  try {
    const statusParam = getSingleParam(req.query.status as any);
    const fromParam = getSingleParam(req.query.from as any);
    const toParam = getSingleParam(req.query.to as any);
    const empParam = getSingleParam(req.query.employeeId as any);

    const where: any = {};
    if (statusParam && statusParam !== 'ALL') {
      where.status = statusParam;
    }
    if (empParam) {
      where.employeeId = empParam;
    }
    if (fromParam || toParam) {
      where.attendanceDate = {};
      if (fromParam) where.attendanceDate.gte = new Date(fromParam);
      if (toParam) where.attendanceDate.lte = new Date(toParam);
    }

    const requests = await prisma.attendanceCorrectionRequest.findMany({
      where,
      orderBy: {
        appliedOn: 'desc',
      },
    });

    // Map with employee details
    const employeeCodes = [...new Set(requests.map((r) => r.employeeId))];
    const employees = await prisma.employee.findMany({
      where: { employeeCode: { in: employeeCodes } },
      select: { id: true, employeeCode: true, firstName: true, lastName: true, designation: true, office: { select: { name: true } } },
    });
    const empMap = new Map(employees.map((e) => [e.employeeCode, e]));

    const formatted = requests.map((r) => {
      const emp = empMap.get(r.employeeId);
      const isoDate = r.attendanceDate ? new Date(r.attendanceDate).toISOString() : null;
      return {
        ...r,
        date: isoDate,
        dateToCorrect: isoDate,
        attendanceDate: isoDate,
        employeeName: emp ? `${emp.firstName} ${emp.lastName}`.trim() : r.employeeId,
        designation: emp?.designation || 'Staff',
        branch: emp?.office?.name || 'Main Office',
      };
    });

    return res.json({
      success: true,
      data: formatted,
      requests: formatted,
    });
  } catch (error) {
    console.error('Error fetching HR attendance corrections:', error);
    return res.status(500).json({ error: 'Server error fetching attendance correction requests' });
  }
};

// 4. HR get single correction detail
export const getHRAttendanceCorrectionDetail = async (req: Request, res: Response) => {
  try {
    const id = getSingleParam(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid ID' });

    const request = await prisma.attendanceCorrectionRequest.findUnique({
      where: { id },
    });
    if (!request) return res.status(404).json({ error: 'Correction request not found' });

    const employee = await prisma.employee.findFirst({
      where: { employeeCode: request.employeeId },
      include: { office: true, user: { select: { email: true } } },
    });

    return res.json({
      success: true,
      request: {
        ...request,
        employeeName: employee ? `${employee.firstName} ${employee.lastName}`.trim() : request.employeeId,
        employeeEmail: employee?.user?.email || '',
        designation: employee?.designation || 'Staff',
        branch: employee?.office?.name || 'Main Office',
      },
    });
  } catch (error) {
    console.error('Error fetching correction detail:', error);
    return res.status(500).json({ error: 'Server error fetching correction detail' });
  }
};

// 5. HR Review (Approve/Reject) correction request
export const reviewHRAttendanceCorrection = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = getSingleParam(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid ID' });

    const reviewerId = req.user?.email || String(req.user?.id || 'HR');
    const { status, reviewNote, approvalEffectDate } = req.body;

    if (!status || (status !== 'APPROVED' && status !== 'REJECTED')) {
      return res.status(400).json({ error: 'status must be APPROVED or REJECTED' });
    }

    const request = await prisma.attendanceCorrectionRequest.findUnique({
      where: { id },
    });
    if (!request) return res.status(404).json({ error: 'Correction request not found' });

    const employee = await prisma.employee.findFirst({
      where: { employeeCode: request.employeeId },
    });

    const dateFormatted = request.attendanceDate.toISOString().split('T')[0];

    if (status === 'APPROVED') {
      if (employee) {
        const existingAttendance = await prisma.attendance.findFirst({
          where: {
            employeeId: employee.id,
            date: dateFormatted,
          },
        });

        if (existingAttendance) {
          await prisma.attendance.update({
            where: { id: existingAttendance.id },
            data: { status: request.requestedStatus },
          });
        } else {
          await prisma.attendance.create({
            data: {
              employeeId: employee.id,
              officeId: employee.officeId || 1,
              date: dateFormatted,
              checkIn: request.attendanceDate,
              status: request.requestedStatus,
            },
          });
        }

        // Recalculate affected salary slip if any
        await recalculatePayslipIfPresent(employee.id, request.attendanceDate);

        // Notify employee of approval
        await notifyEmployee(
          employee.id,
          'Attendance Correction Approved',
          `✅ Attendance corrected for ${dateFormatted}. Salary updated accordingly.`,
          'ATTENDANCE_CORRECTION_APPROVED',
          { correctionId: String(request.id) }
        );
      }
    } else if (status === 'REJECTED') {
      if (employee) {
        const noteText = reviewNote ? `. Reason: ${reviewNote}` : '';
        await notifyEmployee(
          employee.id,
          'Attendance Correction Rejected',
          `❌ Correction rejected for ${dateFormatted}${noteText}`,
          'ATTENDANCE_CORRECTION_REJECTED',
          { correctionId: String(request.id) }
        );
      }
    }

    const updated = await prisma.attendanceCorrectionRequest.update({
      where: { id },
      data: {
        status,
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        reviewNote: reviewNote || null,
        approvalEffectDate: approvalEffectDate ? new Date(approvalEffectDate) : new Date(),
      },
    });

    console.log(`🔒 [AUDIT LOG] HR ${reviewerId} reviewed AttendanceCorrectionRequest ${id}: status=${status}`);

    return res.json({
      success: true,
      message: `Correction request ${status.toLowerCase()} successfully`,
      request: updated,
    });
  } catch (error) {
    console.error('Error reviewing attendance correction:', error);
    return res.status(500).json({ error: 'Server error reviewing attendance correction' });
  }
};

// 6. HR Bulk Review Attendance Corrections
export const bulkReviewHRAttendanceCorrections = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const reviewerId = req.user?.email || String(req.user?.id || 'HR');
    const { ids, status, reviewNote } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }
    if (!status || (status !== 'APPROVED' && status !== 'REJECTED')) {
      return res.status(400).json({ error: 'status must be APPROVED or REJECTED' });
    }

    const requests = await prisma.attendanceCorrectionRequest.findMany({
      where: { id: { in: ids }, status: 'PENDING' },
    });

    let processedCount = 0;

    for (const request of requests) {
      const employee = await prisma.employee.findFirst({
        where: { employeeCode: request.employeeId },
      });

      const dateFormatted = request.attendanceDate.toISOString().split('T')[0];

      if (status === 'APPROVED' && employee) {
        const existingAttendance = await prisma.attendance.findFirst({
          where: { employeeId: employee.id, date: dateFormatted },
        });

        if (existingAttendance) {
          await prisma.attendance.update({
            where: { id: existingAttendance.id },
            data: { status: request.requestedStatus },
          });
        } else {
          await prisma.attendance.create({
            data: {
              employeeId: employee.id,
              officeId: employee.officeId || 1,
              date: dateFormatted,
              checkIn: request.attendanceDate,
              status: request.requestedStatus,
            },
          });
        }

        await recalculatePayslipIfPresent(employee.id, request.attendanceDate);
        await notifyEmployee(
          employee.id,
          'Attendance Correction Approved',
          `✅ Attendance corrected for ${dateFormatted}.`,
          'ATTENDANCE_CORRECTION_APPROVED',
          { correctionId: String(request.id) }
        );
      } else if (status === 'REJECTED' && employee) {
        const noteText = reviewNote ? `. Reason: ${reviewNote}` : '';
        await notifyEmployee(
          employee.id,
          'Attendance Correction Rejected',
          `❌ Correction rejected for ${dateFormatted}${noteText}`,
          'ATTENDANCE_CORRECTION_REJECTED',
          { correctionId: String(request.id) }
        );
      }

      await prisma.attendanceCorrectionRequest.update({
        where: { id: request.id },
        data: {
          status,
          reviewedBy: reviewerId,
          reviewedAt: new Date(),
          reviewNote: reviewNote || null,
          approvalEffectDate: new Date(),
        },
      });

      processedCount++;
    }

    return res.json({
      success: true,
      message: `Bulk review completed: ${processedCount} requests updated to ${status}`,
      processedCount,
    });
  } catch (error) {
    console.error('Error bulk reviewing corrections:', error);
    return res.status(500).json({ error: 'Server error bulk reviewing corrections' });
  }
};

// 7. HR Export Attendance Corrections Report (CSV)
export const exportHRAttendanceCorrections = async (req: Request, res: Response) => {
  try {
    const requests = await prisma.attendanceCorrectionRequest.findMany({
      orderBy: { appliedOn: 'desc' },
    });

    const employeeCodes = [...new Set(requests.map((r) => r.employeeId))];
    const employees = await prisma.employee.findMany({
      where: { employeeCode: { in: employeeCodes } },
      select: { employeeCode: true, firstName: true, lastName: true },
    });
    const empMap = new Map(employees.map((e) => [e.employeeCode, `${e.firstName} ${e.lastName}`.trim()]));

    let csvContent = 'ID,Employee Code,Employee Name,Attendance Date,Current Status,Requested Status,Reason,Status,Applied On,Reviewed By,Reviewed At,Review Note\n';

    requests.forEach((r) => {
      const name = empMap.get(r.employeeId) || r.employeeId;
      const attDate = r.attendanceDate.toISOString().split('T')[0];
      const appliedDate = r.appliedOn.toISOString();
      const revAt = r.reviewedAt ? r.reviewedAt.toISOString() : '';
      const escReason = `"${(r.reason || '').replace(/"/g, '""')}"`;
      const escNote = `"${(r.reviewNote || '').replace(/"/g, '""')}"`;

      csvContent += `${r.id},${r.employeeId},"${name}",${attDate},${r.currentStatus},${r.requestedStatus},${escReason},${r.status},${appliedDate},${r.reviewedBy || ''},${revAt},${escNote}\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="corrections_report.csv"');
    return res.send(csvContent);
  } catch (error) {
    console.error('Error exporting corrections:', error);
    return res.status(500).json({ error: 'Server error exporting corrections' });
  }
};

// 8. HR Correction Reports summary
export const getHRAttendanceCorrectionReports = async (req: Request, res: Response) => {
  try {
    const fromParam = getSingleParam(req.query.from as any);
    const toParam = getSingleParam(req.query.to as any);

    const where: any = {};
    if (fromParam || toParam) {
      where.attendanceDate = {};
      if (fromParam) where.attendanceDate.gte = new Date(fromParam);
      if (toParam) where.attendanceDate.lte = new Date(toParam);
    }

    const requests = await prisma.attendanceCorrectionRequest.findMany({
      where,
    });

    const totalRequests = requests.length;
    const approvedCount = requests.filter((r) => r.status === 'APPROVED').length;
    const rejectedCount = requests.filter((r) => r.status === 'REJECTED').length;
    const pendingCount = requests.filter((r) => r.status === 'PENDING').length;

    // Group by employee
    const empMap: Record<string, { totalRequests: number; approved: number; rejected: number; pending: number }> = {};
    requests.forEach((r) => {
      if (!empMap[r.employeeId]) {
        empMap[r.employeeId] = { totalRequests: 0, approved: 0, rejected: 0, pending: 0 };
      }
      empMap[r.employeeId].totalRequests += 1;
      if (r.status === 'APPROVED') empMap[r.employeeId].approved += 1;
      if (r.status === 'REJECTED') empMap[r.employeeId].rejected += 1;
      if (r.status === 'PENDING') empMap[r.employeeId].pending += 1;
    });

    const employees = await prisma.employee.findMany({
      where: { employeeCode: { in: Object.keys(empMap) } },
      select: { employeeCode: true, firstName: true, lastName: true },
    });
    const empNameMap = new Map(employees.map((e) => [e.employeeCode, `${e.firstName} ${e.lastName}`.trim()]));

    const byEmployee = Object.keys(empMap).map((code) => ({
      employeeCode: code,
      name: empNameMap.get(code) || code,
      ...empMap[code],
    }));

    return res.json({
      success: true,
      report: {
        totalRequests,
        approvedCount,
        rejectedCount,
        pendingCount,
        byEmployee,
      },
    });
  } catch (error) {
    console.error('Error generating correction reports:', error);
    return res.status(500).json({ error: 'Server error generating correction reports' });
  }
};
