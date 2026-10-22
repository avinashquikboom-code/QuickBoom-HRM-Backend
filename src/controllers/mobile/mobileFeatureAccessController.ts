import { Response } from 'express';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';
import { prisma } from '../../utils/db';

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

export { createAccessRequest as requestFeatureAccess } from '../accessRequestController';
