import { campaignImageResponse } from '../../services/campaignImageService';
import { registerDeviceToken } from '../../services/deviceTokenService';
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
      campaignId: n.campaignId || null,
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
        notifications: await campaignImageResponse(formattedNotifications),
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
        campaignId: notification.campaignId || null,
        title: notification.title,
        body: notification.body,
        category: notification.category,
        imageUrl: notification.imageUrl ? (await campaignImageResponse({ imageUrl: notification.imageUrl })).imageUrl : null,
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

/** Update only the authenticated recipient's read state. */
const setNotificationReadState = (isRead: boolean) => async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  if (!req.user?.id) {
    res.status(401).json({ success: false, message: 'Authentication required.' });
    return;
  }

  const targetId = req.params.notificationId || req.params.id;
  const rawId = Array.isArray(targetId) ? targetId[0] : targetId;
  const notificationId = Number(rawId);
  if (!rawId || !/^[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(notificationId) || notificationId > 2147483647) {
    res.status(400).json({ success: false, message: 'Invalid notification ID' });
    return;
  }

  try {
    // Keep ownership in the write predicate, including during concurrent updates.
    const result = await prisma.notification.updateMany({
      where: { id: notificationId, userId: req.user.id },
      data: { isRead, readAt: isRead ? new Date() : null },
    });
    if (result.count === 0) {
      // Match existing recipient-scoped lookup semantics; do not expose other users' IDs.
      res.status(404).json({ success: false, message: 'Notification not found' });
      return;
    }
    res.json({ success: true, message: `Notification marked as ${isRead ? 'read' : 'unread'}` });
  } catch (error) {
    console.error('Update notification read state error:', error);
    res.status(500).json({ success: false, message: 'Failed to update notification read state' });
  }
};

export const markNotificationAsRead = setNotificationReadState(true);
export const markNotificationAsUnread = setNotificationReadState(false);

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

  if (typeof fcmToken !== 'string' || !fcmToken.trim() || fcmToken.length > 4096) {
    res.status(400).json({ success: false, message: 'FCM token is required.' });
    return;
  }

  if (!req.user || !req.user.id) {
    res.status(401).json({ success: false, message: 'Authentication required.' });
    return;
  }

  try {
    await registerDeviceToken(req.user.id, fcmToken, typeof platform === 'string' ? platform : 'unknown', req.body.previousToken);
    res.json({ 
      success: true, 
      message: 'FCM token saved successfully.' 
    });
  } catch (error) {
    console.error('Save FCM token error', { code: (error as any)?.code });
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

  if (typeof fcmToken !== 'string' || !fcmToken.trim() || fcmToken.length > 4096) {
    res.status(400).json({ success: false, message: 'FCM token is required.' });
    return;
  }

  if (!req.user || !req.user.id) {
    res.status(401).json({ success: false, message: 'Authentication required.' });
    return;
  }

  try {
    await prisma.$transaction([
      prisma.fCMToken.updateMany({ where: { userId: req.user.id, token: fcmToken }, data: { isActive: false } }),
      prisma.device.deleteMany({ where: { userId: req.user.id, fcmToken } }),
    ]);

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

/**
 * Acknowledge receipt of a notification on device (updates deliveryStatus to 'DELIVERED')
 */
export const acknowledgeDelivery = async (
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

    const updated = await prisma.notification.update({
      where: { id: numId },
      data: {
        deliveryStatus: 'DELIVERED',
      },
    });

    res.json({
      success: true,
      message: 'Delivery acknowledged',
      deliveryStatus: updated.deliveryStatus,
    });
  } catch (error) {
    console.error('Acknowledge notification delivery error:', error);
    res.status(500).json({ success: false, message: 'Failed to acknowledge delivery' });
  }
};

