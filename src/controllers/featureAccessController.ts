import { Response } from 'express';
import { prisma } from '../utils/db';
import { sendPushNotification } from '../utils/pushNotifications';
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

export const requestFeatureAccess = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
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

    const { featureName, reason, requestedFromDate, requestedToDate, requestedFromTime, requestedToTime } = req.body;

    const request = await prisma.featureAccessRequest.create({
      data: {
        employeeId: employee.id,
        featureName,
        reason,
        requestedFromDate: new Date(requestedFromDate),
        requestedToDate: new Date(requestedToDate),
        requestedFromTime,
        requestedToTime,
        status: 'PENDING'
      }
    });

    res.json({ success: true, requestId: request.id });
  } catch (error) {
    console.error('Error in requestFeatureAccess:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

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

    // Notify Employee
    const employee = await prisma.employee.findUnique({ where: { id: Number(employeeId) } });
    if (employee && employee.userId) {
      await sendPushNotification(
        employee.userId,
        'Feature Access Updated',
        `Your access to ${featureName} has been ${isEnabled ? 'granted' : 'disabled'}.`
      );
    }

    res.json({ success: true, feature });
  } catch (error) {
    console.error('Error in updateFeatureAccess:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const processAccessRequest = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const requestId = req.params.requestId as string;
    const { status, reviewNote, validFromDate, validToDate, validFromTime, validToTime } = req.body;

    const accessReq = await prisma.featureAccessRequest.update({
      where: { id: requestId },
      data: {
        status,
        reviewNote,
        reviewedBy: req.user?.id?.toString(),
        reviewedAt: new Date()
      }
    });

    if (status === 'APPROVED') {
      await prisma.featureAccess.upsert({
        where: {
          employeeId_featureName: {
            employeeId: accessReq.employeeId,
            featureName: accessReq.featureName
          }
        },
        update: {
          isEnabled: true,
          validFromDate: validFromDate ? new Date(validFromDate) : accessReq.requestedFromDate,
          validToDate: validToDate ? new Date(validToDate) : accessReq.requestedToDate,
          validFromTime,
          validToTime,
          grantedBy: req.user?.id?.toString(),
          reason: reviewNote
        },
        create: {
          employeeId: accessReq.employeeId,
          featureName: accessReq.featureName,
          isEnabled: true,
          validFromDate: validFromDate ? new Date(validFromDate) : accessReq.requestedFromDate,
          validToDate: validToDate ? new Date(validToDate) : accessReq.requestedToDate,
          validFromTime,
          validToTime,
          grantedBy: req.user?.id?.toString(),
          reason: reviewNote
        }
      });
    }

    // Notify employee
    const employee = await prisma.employee.findUnique({ where: { id: accessReq.employeeId } });
    if (employee && employee.userId) {
      await sendPushNotification(
        employee.userId,
        'Access Request Update',
        `Your request for ${accessReq.featureName} has been ${status.toLowerCase()}.`
      );
    }

    res.json({ success: true, request: accessReq });
  } catch (error) {
    console.error('Error in processAccessRequest:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
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
