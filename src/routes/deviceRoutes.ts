import { Router, Request, Response } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';
import { pushNotificationService } from '../services/pushNotificationService';

const router = Router();

// Apply auth middleware to protect registration and unregistration
router.use(authMiddleware);

/**
 * @swagger
 * /api/devices/register:
 *   post:
 *     summary: Register or update device FCM token
 *     tags: [Devices]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - platform
 *             properties:
 *               token:
 *                 type: string
 *                 description: FCM registration token
 *               platform:
 *                 type: string
 *                 description: Device operating system (e.g. android, ios)
 *     responses:
 *       200:
 *         description: Device registered successfully
 *       400:
 *         description: Missing token or platform
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/register', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { token, platform, previousToken } = req.body;

    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    if (typeof token !== 'string' || !token.trim() || token.length > 4096 || typeof platform !== 'string' || !['android', 'ios', 'web'].includes(platform.toLowerCase())) {
      res.status(400).json({ success: false, message: 'token and platform are required' });
      return;
    }

    // Upsert the device token globally (since one device token belongs to one user at a time)
    const device = await prisma.$transaction(async tx => {
      const device = await tx.device.upsert({
        where: { fcmToken: token },
        update: {
          userId,
          platform: platform.toLowerCase(),
          updatedAt: new Date(),
        },
        create: {
          userId,
          fcmToken: token,
          platform: platform.toLowerCase(),
          updatedAt: new Date(),
        },
      });

      if (typeof previousToken === 'string' && previousToken !== token && previousToken.length <= 4096) {
        await tx.device.deleteMany({ where: { fcmToken: previousToken, userId } });
        await tx.fCMToken.updateMany({ where: { token: previousToken, userId }, data: { isActive: false } });
      }
      // A token belongs to the currently authenticated account across both stores.
      await tx.fCMToken.updateMany({ where: { token, userId: { not: userId } }, data: { isActive: false } });
      await tx.fCMToken.upsert({
        where: { userId_token: { userId, token } },
        update: { isActive: true, platform: platform.toLowerCase(), lastUsedAt: new Date() },
        create: { userId, token, platform: platform.toLowerCase() }
      });
      return device;
    });

    console.log(`[DeviceRoutes] Registered token for user ${userId} on platform ${platform}`);

    res.json({
      success: true,
      message: 'Device registered successfully',
      device: { id: device.id, userId: device.userId, platform: device.platform, createdAt: device.createdAt, updatedAt: device.updatedAt }
    });
  } catch (error) {
    console.error('[DeviceRoutes] Failed to register device', { code: (error as any)?.code });
    res.status(500).json({ success: false, message: 'Failed to register device' });
  }
});

const unregisterDevice = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { token } = req.body;

    if (typeof token !== 'string' || !token.trim()) {
      res.status(400).json({ success: false, message: 'token is required' });
      return;
    }

    const userId = req.user!.id;
    await prisma.$transaction([
      prisma.device.deleteMany({ where: { fcmToken: token, userId } }),
      prisma.fCMToken.updateMany({ where: { token, userId }, data: { isActive: false } })
    ]);
    console.log('[DeviceRoutes] Device unregistered', { userId });

    res.json({
      success: true,
      message: 'Device unregistered successfully'
    });
  } catch (error) {
    console.error('[DeviceRoutes] Failed to unregister device', { code: (error as any)?.code });
    res.status(500).json({ success: false, message: 'Failed to unregister device' });
  }
};

router.post('/unregister', unregisterDevice);
router.delete('/unregister', unregisterDevice);

router.post('/test-push', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const { targetUserId, title, body, data } = req.body;
    const recipientIds = targetUserId ? [parseInt(String(targetUserId), 10)] : [userId];

    await pushNotificationService.sendPush(
      recipientIds,
      title || 'Test Notification',
      body || 'This is a test push notification from Hopkid HRM server',
      data || { type: 'test' }
    );

    res.json({
      success: true,
      message: `Test push notification sent to user(s): ${recipientIds.join(', ')}`,
    });
  } catch (error) {
    console.error('[DeviceRoutes] Test push failed:', error);
    res.status(500).json({ success: false, message: 'Failed to send test push notification' });
  }
});

export default router;
