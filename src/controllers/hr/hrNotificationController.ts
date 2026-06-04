import { Response } from 'express';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';
import { prisma } from '../../utils/db';

/**
 * Send a notification to a specific employee
 */
export const sendNotification = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { employeeId, title, body, category = 'GENERAL', actionId, actionType } = req.body;

  if (!employeeId || !title || !body) {
    res.status(400).json({ success: false, message: 'employeeId, title, and body are required.' });
    return;
  }

  try {
    const employee = await prisma.employee.findUnique({
      where: { id: parseInt(employeeId) },
    });

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found.' });
      return;
    }

    const notification = await prisma.notification.create({
      data: {
        employeeId: employee.id,
        title,
        body,
        category: category.toUpperCase(),
        actionId,
        actionType,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Notification sent successfully.',
      notification,
    });
  } catch (error) {
    console.error('Error sending notification:', error);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

/**
 * Broadcast an announcement to all employees
 */
export const broadcastAnnouncement = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { title, content, category = 'GENERAL' } = req.body;

  if (!title || !content) {
    res.status(400).json({ success: false, message: 'title and content are required.' });
    return;
  }

  try {
    const publishedBy = req.user?.email || 'HR Department';

    const announcement = await prisma.announcement.create({
      data: {
        title,
        content,
        category: category.toUpperCase(),
        publishedBy,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Announcement broadcasted successfully.',
      announcement,
    });
  } catch (error) {
    console.error('Error broadcasting announcement:', error);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};
