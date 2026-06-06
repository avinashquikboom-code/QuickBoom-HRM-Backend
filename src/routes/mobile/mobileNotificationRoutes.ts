import { Router } from 'express';
import {
  saveFCMToken,
  removeFCMToken
} from '../../controllers/mobile/mobileNotificationController';
import { authenticateToken } from '../../middlewares/authMiddleware';

const router = Router();

/**
 * @swagger
 * /api/employee/fcm-token:
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
router.post('/fcm-token', authenticateToken, saveFCMToken);

export default router;
