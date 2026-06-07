import { Router } from 'express';
import {
  saveFCMToken,
  removeFCMToken,
  fetchMyNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead
} from '../../controllers/mobile/mobileNotificationController';
import { authenticateToken } from '../../middlewares/authMiddleware';

const router = Router();

// Apply auth middleware to all routes
router.use(authenticateToken);

/**
 * @swagger
 * /api/mobile/notifications:
 *   get:
 *     summary: Fetch user's notifications (Mobile)
 *     tags: [Mobile - Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Notifications fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     notifications:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           title:
 *                             type: string
 *                           body:
 *                             type: string
 *                           category:
 *                             type: string
 *                           isRead:
 *                             type: boolean
 *                           createdAt:
 *                             type: string
 *                             format: date-time
 *                     unreadCount:
 *                       type: integer
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/', fetchMyNotifications);

/**
 * @swagger
 * /api/mobile/notifications/:notificationId/read:
 *   put:
 *     summary: Mark notification as read (Mobile)
 *     tags: [Mobile - Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: notificationId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Notification marked as read
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Notification not found
 *       500:
 *         description: Server error
 */
router.put('/:notificationId/read', markNotificationAsRead);

/**
 * @swagger
 * /api/mobile/notifications/read-all:
 *   put:
 *     summary: Mark all notifications as read (Mobile)
 *     tags: [Mobile - Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All notifications marked as read
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.put('/read-all', markAllNotificationsAsRead);

/**
 * @swagger
 * /api/mobile/notifications/fcm-token:
 *   post:
 *     summary: Save FCM token for push notifications
 *     tags: [Mobile - Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fcmToken
 *             properties:
 *               fcmToken:
 *                 type: string
 *                 description: Firebase Cloud Messaging token
 *                 example: "fcm_token_here"
 *               platform:
 *                 type: string
 *                 description: Platform (ios/android/web)
 *                 example: "android"
 *     responses:
 *       200:
 *         description: FCM token saved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "FCM token saved successfully."
 *       400:
 *         description: Bad request (missing fcmToken)
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/fcm-token', saveFCMToken);

/**
 * @swagger
 * /api/mobile/notifications/fcm-token:
 *   delete:
 *     summary: Remove FCM token (on logout)
 *     tags: [Mobile - Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fcmToken
 *             properties:
 *               fcmToken:
 *                 type: string
 *                 description: Firebase Cloud Messaging token to remove
 *     responses:
 *       200:
 *         description: FCM token removed successfully
 *       400:
 *         description: Bad request (missing fcmToken)
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.delete('/fcm-token', removeFCMToken);

export default router;
