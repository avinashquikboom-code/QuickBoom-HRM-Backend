import { Response } from 'express';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';
import { prisma } from '../../utils/db';

/**
 * Send a notification to a specific employee
 */
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
    });

    if (!employee) {
      console.log('🔔 [NOTIFICATION] Employee not found:', employeeId);
      res.status(404).json({ success: false, message: 'Employee not found.' });
      return;
    }

    console.log('🔔 [NOTIFICATION] Employee found:', { id: employee.id, name: `${employee.firstName} ${employee.lastName}` });
    console.log('🔔 [NOTIFICATION] Creating notification...');
    
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

    console.log('🔔 [NOTIFICATION] Notification created successfully:', { id: notification.id, title: notification.title });

    res.status(201).json({
      success: true,
      message: 'Notification sent successfully.',
      notification,
    });
    
    console.log('🔔 [NOTIFICATION] Send notification response sent successfully');
  } catch (error) {
    console.error('Error sending notification:', error);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

/**
 * Broadcast an announcement to all employees
 */
export const broadcastAnnouncement = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  console.log('📢 [ANNOUNCEMENT] Broadcast announcement started');
  console.log('📢 [ANNOUNCEMENT] User:', req.user?.email, 'Role:', req.user?.role);
  
  const { title, content, category = 'GENERAL' } = req.body;

  console.log('📢 [ANNOUNCEMENT] Request data:', { title, content, category });

  if (!title || !content) {
    console.log('📢 [ANNOUNCEMENT] Missing required fields');
    res.status(400).json({ success: false, message: 'title and content are required.' });
    return;
  }

  try {
    const publishedBy = req.user?.email || 'HR Department';
    console.log('📢 [ANNOUNCEMENT] Published by:', publishedBy);
    console.log('📢 [ANNOUNCEMENT] Creating announcement...');

    const announcement = await prisma.announcement.create({
      data: {
        title,
        content,
        category: category.toUpperCase(),
        publishedBy,
      },
    });

    console.log('📢 [ANNOUNCEMENT] Announcement created successfully:', { id: announcement.id, title: announcement.title });

    res.status(201).json({
      success: true,
      message: 'Announcement broadcasted successfully.',
      announcement,
    });
    
    console.log('📢 [ANNOUNCEMENT] Broadcast announcement response sent successfully');
  } catch (error) {
    console.error('Error broadcasting announcement:', error);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};
