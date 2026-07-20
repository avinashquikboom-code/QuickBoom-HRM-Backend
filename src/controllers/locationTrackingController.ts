import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';
import { firebaseNotificationService } from '../services/firebaseNotificationService';

const lastBreachNotificationMap = new Map<number, number>(); // employeeId -> timestamp ms

// POST /api/mobile/location/ping
export const pingLocation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { lat, lon, timestamp, status } = req.body;
    if (lat === undefined || lon === undefined || !timestamp || !status) {
      res.status(400).json({ success: false, message: 'lat, lon, timestamp, and status are required.' });
      return;
    }

    const employee = await prisma.employee.findFirst({
      where: { userId: req.user?.id },
      include: { office: true } // In this schema, 'Branch' model is mapped, but Employee links to Office / Store. Let's see if Employee has branch relation.
    });

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found.' });
      return;
    }

    const isOutside = status === 'OUT_OF_BOUNDS';

    // Get last history to check transition
    const lastHistory = await prisma.locationHistory.findFirst({
      where: { employeeId: employee.id },
      orderBy: { at: 'desc' }
    });

    // Store in LocationHistory
    const pingAt = new Date(timestamp);
    const newHistory = await prisma.locationHistory.create({
      data: {
        employeeId: employee.id,
        latitude: parseFloat(lat),
        longitude: parseFloat(lon),
        isOutside,
        at: pingAt
      }
    });

    // Cleanup records older than 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    try {
      await prisma.locationHistory.deleteMany({
        where: {
          employeeId: employee.id,
          at: { lt: thirtyDaysAgo }
        }
      });
    } catch (cleanupError) {
      console.error('Failed to cleanup location history:', cleanupError);
    }

    // Geofence transition breach check
    if (lastHistory && lastHistory.isOutside !== isOutside) {
      // Transition detected! This is a breach event.
      const nowMs = Date.now();
      const lastNotificationTime = lastBreachNotificationMap.get(employee.id) || 0;

      if (nowMs - lastNotificationTime > 60 * 60 * 1000) {
        // Send throttled FCM to HR
        const transitionType = isOutside ? 'left' : 'entered';
        const officeName = employee.office?.name || 'office';
        try {
          await firebaseNotificationService.sendNotificationToRole(
            'HR',
            'Geofence Breach Alert',
            `${employee.firstName} ${employee.lastName} has ${transitionType} the geofence boundary of ${officeName}.`,
            {
              click_action: 'GEOFENCE_BREACH',
              employeeId: employee.id.toString(),
              status
            }
          );
          lastBreachNotificationMap.set(employee.id, nowMs);
        } catch (fcmError) {
          console.error('Failed to send geofence FCM notification to HR:', fcmError);
        }
      }
    }

    res.json({ success: true, message: 'Location ping processed successfully.', data: newHistory });
  } catch (error) {
    console.error('Location ping error:', error);
    res.status(500).json({ success: false, message: 'Failed to process location ping.' });
  }
};
