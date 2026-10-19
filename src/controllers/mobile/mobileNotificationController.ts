import { Response } from 'express';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';
import { prisma } from '../../utils/db';

/**
 * Fetch user's notifications
 */
export const fetchMyNotifications = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    // Fetch notifications by userId (works for both employees and HR users)
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user?.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const unreadCount = notifications.filter(n => !n.isRead).length;

    const formattedNotifications = notifications.map(n => ({
      id: n.id.toString(),
      title: n.title,
      body: n.body,
      category: n.category,
      deliveryStatus: n.deliveryStatus,
      imageUrl: n.imageUrl || null,
      actionUrl: n.actionUrl || null,
      actionId: n.actionId || null,
      actionType: n.actionType || null,
      isRead: n.isRead,
      readAt: n.readAt ? n.readAt.toISOString() : null,
      createdAt: n.createdAt.toISOString(),
    }));

    res.json({
      success: true,
      data: {
        notifications: formattedNotifications,
        unreadCount,
      },
    });
  } catch (error) {
    console.error('Fetch notifications error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch notifications' });
  }
};

/**
 * Fetch single notification by ID (with authorization check)
 */
export const getNotificationById = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { notificationId, id } = req.params;
    const targetId = notificationId || id;
    const numId = parseInt(Array.isArray(targetId) ? targetId[0] : targetId, 10);

    if (isNaN(numId)) {
      res.status(400).json({ success: false, message: 'Invalid notification ID' });
      return;
    }

    const notification = await prisma.notification.findFirst({
      where: {
        id: numId,
        userId: req.user?.id,
      },
    });

    if (!notification) {
      res.status(404).json({ success: false, message: 'Notification not found' });
      return;
    }

    res.json({
      success: true,
      data: {
        id: notification.id.toString(),
        title: notification.title,
        body: notification.body,
        category: notification.category,
        imageUrl: notification.imageUrl || null,
        actionUrl: notification.actionUrl || null,
        actionId: notification.actionId || null,
        actionType: notification.actionType || null,
        isRead: notification.isRead,
        readAt: notification.readAt ? notification.readAt.toISOString() : null,
        createdAt: notification.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Get notification by ID error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch notification' });
  }
};

/**
 * Mark notification as read
 */
export const markNotificationAsRead = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { notificationId, id } = req.params;
    const targetId = notificationId || id;
    const numId = parseInt(Array.isArray(targetId) ? targetId[0] : targetId, 10);

    const notification = await prisma.notification.findFirst({
      where: {
        id: numId,
        userId: req.user?.id,
      },
    });

    if (!notification) {
      res.status(404).json({ success: false, message: 'Notification not found' });
      return;
    }

    const now = new Date();
    await prisma.notification.update({
      where: { id: numId },
      data: {
        isRead: true,
        readAt: now,
      },
    });

    res.json({ success: true, message: 'Notification marked as read' });
  } catch (error) {
    console.error('Mark notification as read error:', error);
    res.status(500).json({ success: false, message: 'Failed to mark notification as read' });
  }
};

/**
 * Mark all notifications as read
 */
export const markAllNotificationsAsRead = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const now = new Date();
    await prisma.notification.updateMany({
      where: {
        userId: req.user?.id,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: now,
      },
    });

    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    console.error('Mark all notifications as read error:', error);
    res.status(500).json({ success: false, message: 'Failed to mark all notifications as read' });
  }
};

/**
 * Save FCM token for push notifications
 */
export const saveFCMToken = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { fcmToken, platform } = req.body;

  if (!fcmToken) {
    res.status(400).json({ success: false, message: 'FCM token is required.' });
    return;
  }

  if (!req.user || !req.user.id) {
    res.status(401).json({ success: false, message: 'Authentication required.' });
    return;
  }

  try {
    // Check if token already exists for this user
    const existingToken = await prisma.fCMToken.findFirst({
      where: {
        userId: req.user.id,
        token: fcmToken,
      },
    });

    if (existingToken) {
      // Update the existing token
      await prisma.fCMToken.update({
        where: { id: existingToken.id },
        data: {
          platform: platform || 'unknown',
          lastUsedAt: new Date(),
          isActive: true,
        },
      });
    } else {
      // Create new token
      await prisma.fCMToken.create({
        data: {
          userId: req.user.id,
          token: fcmToken,
          platform: platform || 'unknown',
          isActive: true,
        },
      });

      // Deactivate old tokens for this user (keep only last 5 active tokens)
      const userTokens = await prisma.fCMToken.findMany({
        where: {
          userId: req.user.id,
          isActive: true,
          token: { not: fcmToken },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (userTokens.length > 4) {
        // Deactivate tokens beyond the 5 most recent
        const tokensToDeactivate = userTokens.slice(4);
        await prisma.fCMToken.updateMany({
          where: {
            id: { in: tokensToDeactivate.map(t => t.id) },
          },
          data: {
            isActive: false,
          },
        });
      }
    }

    console.log(`✅ FCM token saved for user ${req.user.email}`);
    res.json({ 
      success: true, 
      message: 'FCM token saved successfully.' 
    });
  } catch (error) {
    console.error('Save FCM token error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to save FCM token.' 
    });
  }
};

/**
 * Remove FCM token (on logout)
 */
export const removeFCMToken = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { fcmToken } = req.body;

  if (!fcmToken) {
    res.status(400).json({ success: false, message: 'FCM token is required.' });
    return;
  }

  if (!req.user || !req.user.id) {
    res.status(401).json({ success: false, message: 'Authentication required.' });
    return;
  }

  try {
    await prisma.fCMToken.updateMany({
      where: {
        userId: req.user.id,
        token: fcmToken,
      },
      data: {
        isActive: false,
      },
    });

    console.log(`🗑️ FCM token removed for user ${req.user.email}`);
    res.json({ 
      success: true, 
      message: 'FCM token removed successfully.' 
    });
  } catch (error) {
    console.error('Remove FCM token error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to remove FCM token.' 
    });
  }
};
