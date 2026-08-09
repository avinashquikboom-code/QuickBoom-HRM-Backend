import { Response } from 'express';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';
import { prisma } from '../../utils/db';
import { firebaseNotificationService } from '../../services/firebaseNotificationService';
import { Role } from '@prisma/client';

export const getFeatureAccess = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id }
    });

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found.' });
      return;
    }

    const features = await prisma.featureAccess.findMany({
      where: { employeeId: employee.id }
    });

    const now = new Date();
    const hhmm = now.toTimeString().slice(0, 5); // "14:30"

    const formattedFeatures = features.map(f => {
      let active = f.isEnabled;
      let statusReason = f.reason;

      if (active) {
        if (f.validFromDate && now < f.validFromDate) {
          active = false;
          statusReason = `Available from ${f.validFromDate.toLocaleDateString()}`;
        } else if (f.validToDate && now > f.validToDate) {
          active = false;
          statusReason = 'Access expired';
        } else if (f.validFromTime || f.validToTime) {
          if (f.validFromTime && hhmm < f.validFromTime) {
            active = false;
            statusReason = `Available after ${f.validFromTime}`;
          } else if (f.validToTime && hhmm > f.validToTime) {
            active = false;
            statusReason = `Available until ${f.validToTime}`;
          }
        }
      } else {
        if (!statusReason) statusReason = 'Access disabled. Tap to request.';
      }

      return {
        name: f.featureName,
        active,
        reason: statusReason,
        validFrom: f.validFromDate,
        validTo: f.validToDate,
        validFromTime: f.validFromTime,
        validToTime: f.validToTime,
      };
    });

    res.status(200).json({ success: true, features: formattedFeatures });
  } catch (error) {
    console.error('Error fetching feature access:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const requestFeatureAccess = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id }
    });

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found.' });
      return;
    }

    const { featureName, reason, requestedFromDate, requestedToDate, requestedFromTime, requestedToTime } = req.body;

    if (!featureName || !reason || !requestedFromDate || !requestedToDate) {
      res.status(400).json({ success: false, message: 'Missing required fields.' });
      return;
    }

    const fromDate = new Date(requestedFromDate);
    const toDate = new Date(requestedToDate);

    if (toDate < fromDate) {
      res.status(400).json({ success: false, message: 'To date must be after from date.' });
      return;
    }

    const existingPending = await prisma.featureAccessRequest.findFirst({
      where: {
        employeeId: employee.id,
        featureName,
        status: 'PENDING'
      }
    });

    if (existingPending) {
      res.status(400).json({ success: false, message: 'A pending request for this feature already exists.' });
      return;
    }

    const request = await prisma.featureAccessRequest.create({
      data: {
        employeeId: employee.id,
        featureName,
        reason,
        requestedFromDate: fromDate,
        requestedToDate: toDate,
        requestedFromTime,
        requestedToTime
      }
    });

    // Send FCM to HR/ADMIN
    await firebaseNotificationService.sendNotificationToRole(
      Role.HR,
      'New Feature Access Request',
      `${employee.firstName} ${employee.lastName} requested access to ${featureName}`
    );
    await firebaseNotificationService.sendNotificationToRole(
      Role.SUPER_ADMIN,
      'New Feature Access Request',
      `${employee.firstName} ${employee.lastName} requested access to ${featureName}`
    );

    res.status(201).json({ success: true, requestId: request.id });
  } catch (error) {
    console.error('Error requesting feature access:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
