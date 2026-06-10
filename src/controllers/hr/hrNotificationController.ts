import { Response } from 'express';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';
import { prisma } from '../../utils/db';
import { firebaseNotificationService } from '../../services/firebaseNotificationService';

// ─────────────────────────────────────────────────────────────
// Helper: send FCM push to an employee's registered devices.
// Silently ignores errors (e.g. no FCM token registered yet).
// ─────────────────────────────────────────────────────────────
async function pushToEmployee(
  userId: number,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<void> {
  try {
    await firebaseNotificationService.sendNotificationToUser(userId, title, body, data, {
      priority: { high: true },
    });
    console.log(`📱 [FCM] Push sent to userId=${userId}`);
  } catch (err: any) {
    // "User not found or has no active FCM tokens" is expected for web-only users
    console.warn(`⚠️ [FCM] Push skipped for userId=${userId}:`, err?.message ?? err);
  }
}

// ─────────────────────────────────────────────────────────────
// POST /api/hr/notifications/send
// Send a targeted notification to a specific employee.
// Saves to DB (visible in mobile app notification list) AND
// triggers an FCM push notification to the employee's device(s).
// ─────────────────────────────────────────────────────────────
export const sendNotification = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  console.log('🔔 [NOTIFICATION] Send notification started');
  console.log('🔔 [NOTIFICATION] User:', req.user?.email, 'Role:', req.user?.role);

  const { employeeId, title, body, category = 'GENERAL', actionId, actionType } = req.body;

  console.log('🔔 [NOTIFICATION] Request data:', { employeeId, title, body, category, actionId, actionType });

  if (!employeeId || !title || !body) {
    console.log('🔔 [NOTIFICATION] Missing required fields');
    res.status(400).json({ success: false, message: 'employeeId, title, and body are required.' });
    return;
  }

  try {
    console.log('🔔 [NOTIFICATION] Looking up employee:', employeeId);
    const employee = await prisma.employee.findUnique({
      where: { id: parseInt(employeeId) },
      include: { user: { select: { id: true } } },
    });

    if (!employee) {
      console.log('🔔 [NOTIFICATION] Employee not found:', employeeId);
      res.status(404).json({ success: false, message: 'Employee not found.' });
      return;
    }

    console.log('🔔 [NOTIFICATION] Employee found:', { id: employee.id, name: `${employee.firstName} ${employee.lastName}` });

    // 1️⃣ Persist the notification (shows in mobile notification list)
    const notification = await prisma.notification.create({
      data: {
        employeeId: employee.id,
        userId: employee.userId ?? undefined,
        title,
        body,
        category: category.toUpperCase(),
        actionId,
        actionType,
      },
    });

    console.log('🔔 [NOTIFICATION] DB notification created:', { id: notification.id });

    // 2️⃣ Fire FCM push (non-blocking — does NOT affect API response)
    if (employee.userId) {
      pushToEmployee(employee.userId, title, body, {
        type: (actionType ?? 'GENERAL').toLowerCase(),
        category: category.toUpperCase(),
        ...(actionId ? { actionId } : {}),
        ...(actionType ? { actionType } : {}),
      });
    }

    res.status(201).json({
      success: true,
      message: 'Notification sent successfully.',
      notification,
    });

    console.log('🔔 [NOTIFICATION] Response sent successfully');
  } catch (error) {
    console.error('Error sending notification:', error);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

// ─────────────────────────────────────────────────────────────
// POST /api/hr/announcements/broadcast
// Broadcast an announcement to all active employees.
// Saves to Announcement table AND pushes FCM to all EMPLOYEE-role users.
// ─────────────────────────────────────────────────────────────
export const broadcastAnnouncement = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  console.log('📢 [ANNOUNCEMENT] Broadcast started');
  console.log('📢 [ANNOUNCEMENT] User:', req.user?.email, 'Role:', req.user?.role);

  const { title, content, body, category = 'GENERAL' } = req.body;
  // Support both `content` (legacy) and `body` field names
  const messageBody = body ?? content;

  console.log('📢 [ANNOUNCEMENT] Request data:', { title, messageBody, category });

  if (!title || !messageBody) {
    console.log('📢 [ANNOUNCEMENT] Missing required fields');
    res.status(400).json({ success: false, message: 'title and body (or content) are required.' });
    return;
  }

  try {
    const publishedBy = req.user?.email || 'HR Department';

    // 1️⃣ Persist the announcement
    const announcement = await prisma.announcement.create({
      data: {
        title,
        content: messageBody,
        category: category.toUpperCase(),
        publishedBy,
      },
    });

    console.log('📢 [ANNOUNCEMENT] Announcement created:', { id: announcement.id, title: announcement.title });

    // 2️⃣ Persist individual notifications for all active employees so
    //    they appear in the mobile notification feed.
    const activeEmployees = await prisma.employee.findMany({
      where: { status: 'active', userId: { not: null } },
      select: { id: true, userId: true },
    });

    if (activeEmployees.length > 0) {
      await prisma.notification.createMany({
        data: activeEmployees.map((emp) => ({
          employeeId: emp.id,
          userId: emp.userId!,
          title,
          body: messageBody,
          category: category.toUpperCase(),
          actionId: announcement.id.toString(),
          actionType: 'ANNOUNCEMENT',
          isRead: false,
        })),
        skipDuplicates: true,
      });

      console.log(`📢 [ANNOUNCEMENT] ${activeEmployees.length} DB notifications created`);
    }

    // 3️⃣ Fire FCM broadcast to all EMPLOYEE-role users (non-blocking)
    firebaseNotificationService
      .sendNotificationToRole('EMPLOYEE', title, messageBody, {
        type: 'announcement',
        announcementId: announcement.id.toString(),
        category: category.toUpperCase(),
        publishedBy,
      })
      .then(() => console.log('📢 [FCM] Announcement push broadcast successful'))
      .catch((err: any) =>
        console.warn('⚠️ [FCM] Announcement broadcast push skipped:', err?.message ?? err)
      );

    res.status(201).json({
      success: true,
      message: 'Announcement broadcasted successfully.',
      announcement,
    });

    console.log('📢 [ANNOUNCEMENT] Response sent successfully');
  } catch (error) {
    console.error('Error broadcasting announcement:', error);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};
