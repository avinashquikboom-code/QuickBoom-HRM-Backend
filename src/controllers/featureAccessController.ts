import { reviewAccessRequest } from './accessRequestController';
import { Response } from 'express';
import { prisma } from '../utils/db';
import { notifyEmployee } from '../utils/hrNotificationHelper';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';

const getEmployeeByUserId = async (userId: number) => {
  return await prisma.employee.findUnique({
    where: { userId }
  });
};

export const getEmployeeFeatureAccess = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const employee = await getEmployeeByUserId(userId);
    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found' });
      return;
    }

    const features = await prisma.featureAccess.findMany({
      where: { employeeId: employee.id }
    });

    const now = new Date();
    // Time in HH:mm based on server timezone
    const currentTime = now.toTimeString().substring(0, 5); 

    const processedFeatures = features.map(f => {
      let isEnabled = f.isEnabled;
      let reason = f.reason || 'Always allowed';

      // Check date bounds
      if (isEnabled && f.validFromDate && new Date(f.validFromDate) > now) {
        isEnabled = false;
        reason = `Disabled until ${f.validFromDate.toISOString().split('T')[0]}`;
      }
      if (isEnabled && f.validToDate && new Date(f.validToDate) < now) {
        isEnabled = false;
        reason = `Access expired on ${f.validToDate.toISOString().split('T')[0]}`;
      }

      // Check time bounds
      if (isEnabled && f.validFromTime && f.validToTime) {
        if (currentTime < f.validFromTime || currentTime > f.validToTime) {
          isEnabled = false;
          reason = `Available ${f.validFromTime} - ${f.validToTime}`;
        }
      }

      return {
        name: f.featureName,
        enabled: isEnabled,
        reason: reason,
        validFrom: f.validFromDate ? f.validFromDate.toISOString().split('T')[0] : null,
        validUntil: f.validToDate ? f.validToDate.toISOString().split('T')[0] : null,
        validFromTime: f.validFromTime,
        validToTime: f.validToTime
      };
    });

    res.json({ success: true, features: processedFeatures });
  } catch (error) {
    console.error('Error in getEmployeeFeatureAccess:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export { createAccessRequest as requestFeatureAccess } from './accessRequestController';

export const getPendingAccessRequests = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const requests = await prisma.featureAccessRequest.findMany({
      where: { status: 'PENDING' },
      include: {
        employee: { select: { firstName: true, lastName: true, employeeCode: true } }
      }
    });
    res.json({ success: true, requests });
  } catch (error) {
    console.error('Error in getPendingAccessRequests:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const updateFeatureAccess = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const employeeId = req.params.employeeId as string;
    const featureName = req.params.featureName as string;
    const { isEnabled, validFromDate, validToDate, validFromTime, validToTime, reason } = req.body;

    const previous = await prisma.featureAccess.findUnique({ where: { employeeId_featureName: { employeeId: Number(employeeId), featureName } } });
    const feature = await prisma.featureAccess.upsert({
      where: {
        employeeId_featureName: {
          employeeId: Number(employeeId),
          featureName
        }
      },
      update: {
        isEnabled,
        validFromDate: validFromDate ? new Date(validFromDate) : null,
        validToDate: validToDate ? new Date(validToDate) : null,
        validFromTime,
        validToTime,
        reason,
        grantedBy: req.user?.id?.toString()
      },
      create: {
        employeeId: Number(employeeId),
        featureName,
        isEnabled,
        validFromDate: validFromDate ? new Date(validFromDate) : null,
        validToDate: validToDate ? new Date(validToDate) : null,
        validFromTime,
        validToTime,
        reason,
        grantedBy: req.user?.id?.toString()
      }
    });

    const changed = !previous || ['isEnabled', 'validFromDate', 'validToDate', 'validFromTime', 'validToTime', 'reason'].some(key =>
      String((previous as any)[key] ?? '') !== String((feature as any)[key] ?? ''));
    if (changed) await notifyEmployee({ employeeId: Number(employeeId), title: 'Module Access Updated',
      message: `Your access to ${featureName} has been ${isEnabled ? 'granted' : 'disabled'}.`,
      category: 'GENERAL', actionType: 'MODULE_ACCESS_UPDATED', actionId: `${employeeId}-${featureName}`,
      screen: '/access-requests', clickRoute: '/access-requests', extraData: { featureName },
    });

    res.json({ success: true, feature });
  } catch (error) {
    console.error('Error in updateFeatureAccess:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const processAccessRequest = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const status = String(req.body.status || '').toUpperCase();
  if (status !== 'APPROVED' && status !== 'REJECTED') {
    res.status(400).json({ success: false, message: 'Status must be APPROVED or REJECTED' }); return;
  }
  await reviewAccessRequest(req, res, status, true);
};

export const getAllEmployeeFeatures = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const employeeId = req.params.employeeId as string;
        const features = await prisma.featureAccess.findMany({
            where: { employeeId: Number(employeeId) }
        });
        res.json({ success: true, features });
    } catch (error) {
        console.error('Error fetching employee features:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
}
