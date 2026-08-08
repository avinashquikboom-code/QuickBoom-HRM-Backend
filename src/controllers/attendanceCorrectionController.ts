import { Request, Response } from 'express';
import { prisma } from '../utils/db';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import notificationService from '../services/notificationService';

// Helper to safely extract single string from params
function getSingleParam(param: string | string[] | undefined): string | undefined {
  if (!param) return undefined;
  return Array.isArray(param) ? param[0] : param;
}

// 1. Employee apply for attendance correction
export const applyCorrectionRequest = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const employee = await prisma.employee.findUnique({
      where: { userId },
    });
    if (!employee) return res.status(404).json({ error: 'Employee record not found' });

    const { attendanceDate, requestedStatus, reason, supportingDoc } = req.body;

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

    // Auto-fetch current attendance status for this date from DB
    const dateStr = targetDate.toISOString().split('T')[0];
    const attendanceRecord = await prisma.attendance.findFirst({
      where: {
        employeeId: employee.id,
        date: dateStr,
      },
    });

    let currentStatus = 'ABSENT';
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

// 2. Employee get my corrections
export const getMyCorrections = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const employee = await prisma.employee.findUnique({
      where: { userId },
    });
    if (!employee) return res.status(404).json({ error: 'Employee record not found' });

    const requests = await prisma.attendanceCorrectionRequest.findMany({
      where: {
        employeeId: employee.employeeCode,
      },
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
      return {
        ...r,
        employeeName: emp ? `${emp.firstName} ${emp.lastName}` : r.employeeId,
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
        employeeName: employee ? `${employee.firstName} ${employee.lastName}` : request.employeeId,
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

    if (status === 'APPROVED') {
      if (employee) {
        const dateStr = request.attendanceDate.toISOString().split('T')[0];

        const existingAttendance = await prisma.attendance.findFirst({
          where: {
            employeeId: employee.id,
            date: dateStr,
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
              date: dateStr,
              checkIn: request.attendanceDate,
              status: request.requestedStatus,
            },
          });
        }
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

// 6. HR Correction Reports summary
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
    const empNameMap = new Map(employees.map((e) => [e.employeeCode, `${e.firstName} ${e.lastName}`]));

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
