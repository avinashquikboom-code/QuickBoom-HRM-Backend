import { Request, Response } from 'express';
import { prisma } from '../utils/db';
import { firebaseNotificationService } from '../services/firebaseNotificationService';

/**
 * Map module names to internal EmployeePermission JSON keys
 */
const MODULE_TO_PERMISSION_KEY: Record<string, string> = {
  'Attendance': 'canViewAttendance',
  'Leave': 'canViewLeaveBalance',
  'Sales': 'canLogSale',
  'Wallet': 'canViewSalary',
  'Commission': 'canViewCommission',
  'Expenses': 'canViewExpenses',
  'Tasks': 'canViewTasks',
  'Shift Guidelines': 'canViewShiftGuidelines',
  'Remote Work': 'canViewRemoteWorkStatus',
};

/**
 * Create a new module access request from mobile app
 */
export const createAccessRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const employee = await prisma.employee.findFirst({
      where: { userId },
      include: {
        department: true,
        office: true,
      },
    });

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee profile not found' });
      return;
    }

    const { featureName, reason = 'Requested access via mobile app' } = req.body;
    if (!featureName) {
      res.status(400).json({ success: false, message: 'Feature / Module name is required' });
      return;
    }

    // Check if there is already a PENDING request for this feature
    const existingPending = await prisma.featureAccessRequest.findFirst({
      where: {
        employeeId: employee.id,
        featureName,
        status: 'PENDING',
      },
    });

    if (existingPending) {
      res.status(200).json({
        success: true,
        message: 'An access request for this module is already pending approval.',
        data: existingPending,
      });
      return;
    }

    const now = new Date();
    const accessRequest = await prisma.featureAccessRequest.create({
      data: {
        employeeId: employee.id,
        featureName,
        reason,
        requestedFromDate: now,
        requestedToDate: now,
        status: 'PENDING',
      },
      include: {
        employee: {
          include: {
            department: true,
            office: true,
          },
        },
      },
    });

    // Create Audit Log entry
    try {
      await prisma.auditLog.create({
        data: {
          action: 'ACCESS_REQUEST_SUBMITTED',
          employeeId: employee.id,
          userId: employee.userId ?? null,
          ipAddress: req.ip || null,
          deviceInfo: req.headers['user-agent'] || null,
        },
      });
    } catch (auditErr) {
      console.warn('AuditLog creation notice:', auditErr);
    }

    res.status(201).json({
      success: true,
      message: 'Access request submitted successfully.',
      data: accessRequest,
    });
  } catch (error: any) {
    console.error('Error creating access request:', error);
    res.status(500).json({ success: false, message: error?.message || 'Server error creating access request' });
  }
};

/**
 * List all access requests for Admin/HR Panel
 */
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

/**
 * Comprehensive mapping & normalization of module names to internal permission keys
 */
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

/**
 * Approve access request, update UserPermission in DB atomically, send FCM notification & log audit
 */
export const approveAccessRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const reviewerId = (req as any).user?.id || 'HR Admin';

    const accessRequest = await prisma.featureAccessRequest.findUnique({
      where: { id },
      include: { employee: true },
    });

    if (!accessRequest) {
      res.status(404).json({ success: false, message: 'Access request not found' });
      return;
    }

    const employee = accessRequest.employee;
    let userId = employee.userId;

    // Auto-link/provision User if employee record was unlinked
    if (!userId) {
      const user = await prisma.user.findFirst({
        where: { email: { contains: employee.employeeCode.toLowerCase() } }
      });
      if (user) {
        userId = user.id;
        await prisma.employee.update({
          where: { id: employee.id },
          data: { userId: user.id }
        });
      }
    }

    const permKey = normalizePermissionKey(accessRequest.featureName);

    // Atomic transaction: Update AccessRequest, UserPermission, and FeatureAccess
    const [updatedRequest] = await prisma.$transaction(async (tx) => {
      const updatedReq = await tx.featureAccessRequest.update({
        where: { id },
        data: {
          status: 'APPROVED',
          reviewedBy: String(reviewerId),
          reviewedAt: new Date(),
          reviewNote: req.body.reviewNote || 'Approved by HR Admin',
        },
        include: { employee: true },
      });

      if (userId) {
        const existingUserPerm = await tx.userPermission.findUnique({
          where: { userId },
        });

        const currentPerms = (existingUserPerm?.permissions as Record<string, boolean>) || {};
        currentPerms[permKey] = true;

        // Automatically enable related operational flags for full module access
        if (permKey === 'canViewCommission') currentPerms['canLogSale'] = true;
        if (permKey === 'canViewLeaveBalance') currentPerms['canApplyLeave'] = true;
        if (permKey === 'canViewExpenses') currentPerms['canSubmitExpenseClaim'] = true;
        if (permKey === 'canViewSalary') currentPerms['canDownloadSalaryPDF'] = true;

        await tx.userPermission.upsert({
          where: { userId },
          create: {
            userId,
            permissions: currentPerms,
          },
          update: {
            permissions: currentPerms,
          },
        });
      }

      // Upsert FeatureAccess record for mobile status query
      try {
        await tx.featureAccess.upsert({
          where: {
            employeeId_featureName: {
              employeeId: employee.id,
              featureName: accessRequest.featureName,
            }
          },
          create: {
            employeeId: employee.id,
            featureName: accessRequest.featureName,
            isEnabled: true,
            reason: 'Approved by HR',
          },
          update: {
            isEnabled: true,
            reason: 'Approved by HR',
            updatedAt: new Date(),
          }
        });
      } catch (faErr) {
        console.warn('FeatureAccess upsert notice:', faErr);
      }

      // Create Audit Log entry
      try {
        await tx.auditLog.create({
          data: {
            action: 'ACCESS_REQUEST_APPROVED',
            userId: typeof reviewerId === 'number' ? reviewerId : (Number(reviewerId) || null),
            employeeId: accessRequest.employeeId,
            ipAddress: req.ip || null,
            deviceInfo: req.headers['user-agent'] || null,
          },
        });
      } catch (auditErr) {
        console.warn('AuditLog creation notice:', auditErr);
      }

      return [updatedReq];
    });

    // Broadcast permission update event via WebSocket for instant live mobile sync
    try {
      if (userId) {
        const { getWebSocketInstance } = require('../utils/websocketSingleton');
        const ws = getWebSocketInstance();
        if (ws) {
          await ws.broadcastPermissionUpdate(userId, {
            userId,
            featureName: accessRequest.featureName,
            permissionKey: permKey,
            status: 'APPROVED',
            permissionGranted: true,
          });
        }
      }
    } catch (wsErr) {
      console.warn('WebSocket broadcast notice:', wsErr);
    }

    // Send FCM Push Notification to employee
    try {
      if (userId) {
        await firebaseNotificationService.sendNotificationToUser(
          userId,
          'Access Request Approved',
          `Your request for ${accessRequest.featureName} access has been approved. Mobile features unlocked.`,
          { type: 'ACCESS_REQUEST_APPROVED', featureName: accessRequest.featureName, permissionKey: permKey }
        );
      }
    } catch (fcmErr) {
      console.warn('FCM push notification notice:', fcmErr);
    }

    res.json({
      success: true,
      message: `Access granted for ${accessRequest.featureName}.`,
      data: updatedRequest,
    });
  } catch (error: any) {
    console.error('Error approving access request:', error);
    res.status(500).json({ success: false, message: error?.message || 'Server error approving access request' });
  }
};

/**
 * Reject access request, send FCM notification & log audit
 */
export const rejectAccessRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const reviewerId = (req as any).user?.id || 'HR Admin';

    const accessRequest = await prisma.featureAccessRequest.findUnique({
      where: { id },
      include: { employee: true },
    });

    if (!accessRequest) {
      res.status(404).json({ success: false, message: 'Access request not found' });
      return;
    }

    const updatedRequest = await prisma.featureAccessRequest.update({
      where: { id },
      data: {
        status: 'REJECTED',
        reviewedBy: String(reviewerId),
        reviewedAt: new Date(),
        reviewNote: req.body.reviewNote || 'Rejected by HR Admin',
      },
      include: { employee: true },
    });

    // Send FCM Push Notification to employee
    try {
      const userId = accessRequest.employee.userId;
      if (userId) {
        await firebaseNotificationService.sendNotificationToUser(
          userId,
          'Access Request Rejected',
          `Your request for ${accessRequest.featureName} access has been rejected.`,
          { type: 'ACCESS_REQUEST_REJECTED', featureName: accessRequest.featureName }
        );
      }
    } catch (fcmErr) {
      console.warn('FCM push notification notice:', fcmErr);
    }

    // Audit Log entry
    try {
      await prisma.auditLog.create({
        data: {
          action: 'ACCESS_REQUEST_REJECTED',
          userId: typeof reviewerId === 'number' ? reviewerId : (Number(reviewerId) || null),
          employeeId: accessRequest.employeeId,
          ipAddress: req.ip || null,
          deviceInfo: req.headers['user-agent'] || null,
        },
      });
    } catch (auditErr) {
      console.warn('AuditLog creation notice:', auditErr);
    }

    res.json({
      success: true,
      message: `Access request for ${accessRequest.featureName} rejected.`,
      data: updatedRequest,
    });
  } catch (error: any) {
    console.error('Error rejecting access request:', error);
    res.status(500).json({ success: false, message: error?.message || 'Server error rejecting access request' });
  }
};
