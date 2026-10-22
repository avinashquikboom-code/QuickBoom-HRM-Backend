import { Request, Response } from 'express';
import { prisma } from '../utils/db';
import { notifyEmployee, sendHRNotification } from '../utils/hrNotificationHelper';
import { getWebSocketInstance } from '../utils/websocketSingleton';

async function auditRequest(req: Request, action: string, employeeId: number) {
  try {
    await prisma.auditLog.create({ data: { action, employeeId,
      userId: (req as any).user?.id || null,
      ipAddress: req.ip || null, deviceInfo: req.headers['user-agent'] || null,
    } });
  } catch { console.warn('[AccessRequest] Audit record unavailable', { action }); }
}

export const createAccessRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) { res.status(401).json({ success: false, message: 'Unauthorized' }); return; }
    const employee = await prisma.employee.findFirst({ where: { userId }, include: { department: true, office: true } });
    if (!employee) { res.status(404).json({ success: false, message: 'Employee profile not found' }); return; }
    const { reason = 'Requested access via mobile app', requestedFromTime, requestedToTime } = req.body;
    const featureName = String(req.body.featureName || req.body.permissionKey || '').trim();
    if (!featureName || !String(reason).trim()) {
      res.status(400).json({ success: false, message: 'Feature and reason are required' }); return;
    }
    const fromDate = req.body.requestedFromDate ? new Date(req.body.requestedFromDate) : new Date();
    const toDate = req.body.requestedToDate ? new Date(req.body.requestedToDate) : new Date(Date.now() + 30 * 86400000);
    if (!Number.isFinite(fromDate.getTime()) || !Number.isFinite(toDate.getTime()) || fromDate > toDate) {
      res.status(400).json({ success: false, message: 'Invalid access date range' }); return;
    }
    const result = await prisma.$transaction(async tx => {
      const key = `access-request:${employee.id}:${featureName}`;
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      const existing = await tx.featureAccessRequest.findFirst({ where: { employeeId: employee.id, featureName, status: 'PENDING' } });
      if (existing) return { request: existing, created: false };
      const request = await tx.featureAccessRequest.create({ data: {
        employeeId: employee.id, featureName, reason: String(reason).trim(),
        requestedFromDate: fromDate, requestedToDate: toDate, requestedFromTime, requestedToTime, status: 'PENDING',
      }, include: { employee: { include: { department: true, office: true } } } });
      return { request, created: true };
    });
    if (result.created) {
      await auditRequest(req, 'ACCESS_REQUEST_SUBMITTED', employee.id);
      await sendHRNotification({
        title: 'Module Access Requested',
        message: `${employee.firstName} ${employee.lastName} requested access to ${featureName}. Reference: ${result.request.id}.`,
        category: 'GENERAL', actionType: 'ACCESS_REQUEST_SUBMITTED', actionId: result.request.id,
        employeeId: employee.id, requiredModuleId: 'pa-access-requests', excludeUserId: userId,
        deduplicate: true, extraData: { requestId: result.request.id, featureName },
      });
    }
    res.status(result.created ? 201 : 200).json({ success: true,
      message: result.created ? 'Access request submitted successfully.' : 'Request already pending.',
      data: result.request, requestId: result.request.id,
    });
  } catch (error) {
    console.error('Error creating access request:', error);
    res.status(500).json({ success: false, message: 'Unable to create access request' });
  }
};

export const getAccessRequests = async (req: Request, res: Response): Promise<void> => {
  try {
    const { status } = req.query;
    const whereClause: any = {};
    if (status && typeof status === 'string' && status !== 'ALL') {
      whereClause.status = status.toUpperCase();
    }

    const requests = await prisma.featureAccessRequest.findMany({
      where: whereClause,
      include: {
        employee: {
          include: {
            department: true,
            office: true,
          },
        },
      },
      orderBy: { appliedOn: 'desc' },
    });

    res.json({ success: true, count: requests.length, data: requests });
  } catch (error: any) {
    console.error('Error fetching access requests:', error);
    res.status(500).json({ success: false, message: error?.message || 'Server error fetching access requests' });
  }
};

export const normalizePermissionKey = (featureName: string): string => {
  if (!featureName) return 'canViewProfile';
  const clean = featureName.trim();

  if (clean.startsWith('canView') || clean.startsWith('canLog') || clean.startsWith('canApply') || clean.startsWith('canSubmit') || clean.startsWith('canRequest')) {
    return clean;
  }

  const map: Record<string, string> = {
    'dashboard': 'canViewGeofence',
    'Dashboard': 'canViewGeofence',
    'attendance': 'canViewAttendance',
    'Attendance': 'canViewAttendance',
    'Attendance Reports': 'canViewAttendance',
    'leave': 'canViewLeaveBalance',
    'Leave': 'canViewLeaveBalance',
    'Leave Reports': 'canViewLeaveBalance',
    'sales': 'canLogSale',
    'Sales': 'canLogSale',
    'Sales Reports': 'canLogSale',
    'wallet': 'canViewSalary',
    'Wallet': 'canViewSalary',
    'commission': 'canViewCommission',
    'Commission': 'canViewCommission',
    'Commission Reports': 'canViewCommission',
    'salary': 'canViewSalary',
    'Salary': 'canViewSalary',
    'payroll': 'canViewSalary',
    'Payroll': 'canViewSalary',
    'expenses': 'canViewExpenses',
    'Expenses': 'canViewExpenses',
    'Expense Claims': 'canViewExpenses',
    'Expense Reports': 'canViewExpenses',
    'tasks': 'canViewTasks',
    'Tasks': 'canViewTasks',
    'shift': 'canViewShiftGuidelines',
    'Shift': 'canViewShiftGuidelines',
    'Shift Guidelines': 'canViewShiftGuidelines',
    'remote_work': 'canViewRemoteWorkStatus',
    'Remote Work': 'canViewRemoteWorkStatus',
    'notifications': 'canViewNotifications',
    'Notifications': 'canViewNotifications',
    'profile': 'canViewProfile',
    'Profile': 'canViewProfile',
    'store': 'canViewStore',
    'Store': 'canViewStore',
    'reports': 'canViewReports',
    'Reports': 'canViewReports',
    'analytics': 'canViewAnalytics',
    'Analytics': 'canViewAnalytics',
    'audit_logs': 'canViewAuditLogs',
    'Audit Logs': 'canViewAuditLogs',
    'settings': 'canViewSettings',
    'Settings': 'canViewSettings',
  };

  return map[clean] || map[clean.toLowerCase()] || `canView${clean.charAt(0).toUpperCase() + clean.slice(1)}`;
};


export async function reviewAccessRequest(req: Request, res: Response, status: 'APPROVED' | 'REJECTED', useRequestedWindow = false): Promise<void> {
  try {
    const id = String(req.params.id || req.params.requestId);
    const reviewerId = (req as any).user?.id;
    const result = await prisma.$transaction(async tx => {
      const request = await tx.featureAccessRequest.findUnique({ where: { id }, include: { employee: true } });
      if (!request) return { kind: 'missing' as const };
      // All grants for this employee serialize JSON permission merges as well.
      const lockKey = `module-grant:${request.employeeId}`;
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
      if (status === 'APPROVED' && !request.employee.userId) return { kind: 'unlinked' as const };
      const claim = await tx.featureAccessRequest.updateMany({ where: { id, status: 'PENDING' }, data: {
        status, reviewedBy: String(reviewerId), reviewedAt: new Date(), reviewNote: req.body.reviewNote || null,
      } });
      if (!claim.count) {
        const current = await tx.featureAccessRequest.findUnique({ where: { id }, include: { employee: true } });
        return { kind: 'existing' as const, request: current! };
      }
      if (status === 'APPROVED') {
        const userId = request.employee.userId!;
        const permissionKey = normalizePermissionKey(request.featureName);
        const existing = await tx.userPermission.findUnique({ where: { userId } });
        const permissions = { ...((existing?.permissions as Record<string, boolean>) || {}), [permissionKey]: true };
        if (permissionKey === 'canViewCommission') permissions.canLogSale = true;
        if (permissionKey === 'canViewLeaveBalance') permissions.canApplyLeave = true;
        if (permissionKey === 'canViewExpenses') permissions.canSubmitExpenseClaim = true;
        if (permissionKey === 'canViewSalary') permissions.canDownloadSalaryPDF = true;
        // The legacy feature-window API grants FeatureAccess only; do not turn
        // its temporary grant into an unbounded UserPermission override.
        if (!useRequestedWindow) await tx.userPermission.upsert({ where: { userId }, create: { userId, permissions }, update: { permissions } });
        const validFromDate = req.body.validFromDate ? new Date(req.body.validFromDate) : useRequestedWindow ? request.requestedFromDate : null;
        const validToDate = req.body.validToDate ? new Date(req.body.validToDate) : useRequestedWindow ? request.requestedToDate : null;
        if ((validFromDate && !Number.isFinite(validFromDate.getTime())) || (validToDate && !Number.isFinite(validToDate.getTime())) ||
          (validFromDate && validToDate && validFromDate > validToDate)) throw new Error('Invalid grant date range');
        const grant = {
          isEnabled: true, validFromDate, validToDate,
          validFromTime: req.body.validFromTime ?? (useRequestedWindow ? request.requestedFromTime : null),
          validToTime: req.body.validToTime ?? (useRequestedWindow ? request.requestedToTime : null),
          grantedBy: String(reviewerId), reason: req.body.reviewNote || 'Approved by HR',
        };
        // Grant errors must roll back approval and permission updates, not be swallowed.
        await tx.featureAccess.upsert({ where: { employeeId_featureName: { employeeId: request.employeeId, featureName: request.featureName } },
          create: { employeeId: request.employeeId, featureName: request.featureName, ...grant }, update: grant,
        });
      }
      const updated = await tx.featureAccessRequest.findUnique({ where: { id }, include: { employee: true } });
      return { kind: 'changed' as const, request: updated! };
    });
    if (result.kind === 'missing') { res.status(404).json({ success: false, message: 'Access request not found' }); return; }
    if (result.kind === 'unlinked') { res.status(409).json({ success: false, message: 'Link the requester to their user account before granting access.' }); return; }
    const request = result.request;
    if (result.kind === 'existing') {
      res.status(request.status === status ? 200 : 409).json({ success: request.status === status, data: request, request, message: 'Request already reviewed.' }); return;
    }
    await auditRequest(req, `ACCESS_REQUEST_${status}`, request.employeeId);
    if (status === 'APPROVED') {
      try { await getWebSocketInstance()?.broadcastPermissionUpdate(request.employee.userId!, {
        userId: request.employee.userId, featureName: request.featureName,
        permissionKey: normalizePermissionKey(request.featureName), status, permissionGranted: true,
      }); } catch { console.warn('[AccessRequest] Permission broadcast unavailable'); }
    }
    const notificationDelivery = await notifyEmployee({
      employeeId: request.employeeId, userId: request.employee.userId,
      title: status === 'APPROVED' ? 'Module Access Approved' : 'Module Access Rejected',
      message: `Your request for ${request.featureName} access has been ${status.toLowerCase()}.`,
      category: 'GENERAL', actionType: `ACCESS_REQUEST_${status}`, actionId: request.id,
      screen: '/access-requests', clickRoute: '/access-requests', deduplicate: true,
      extraData: { requestId: request.id, featureName: request.featureName, status },
    });
    res.json({ success: true, message: `Access request ${status.toLowerCase()}.`, data: request, request, notificationDelivery });
  } catch (error) {
    console.error('Error reviewing access request:', error);
    res.status(500).json({ success: false, message: 'Unable to review access request' });
  }
}

export const approveAccessRequest = (req: Request, res: Response) => reviewAccessRequest(req, res, 'APPROVED');
export const rejectAccessRequest = (req: Request, res: Response) => reviewAccessRequest(req, res, 'REJECTED');
