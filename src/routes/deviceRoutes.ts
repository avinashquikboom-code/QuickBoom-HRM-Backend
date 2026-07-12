import { Router, Request, Response } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../utils/db';

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
    const { token, platform } = req.body;

    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    if (!token || !platform) {
      res.status(400).json({ success: false, message: 'token and platform are required' });
      return;
    }

    // Upsert the device token globally (since one device token belongs to one user at a time)
    const device = await prisma.device.upsert({
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

    console.log(`[DeviceRoutes] Registered token for user ${userId} on platform ${platform}`);

    res.json({
      success: true,
      message: 'Device registered successfully',
      device
    });
  } catch (error) {
    console.error('[DeviceRoutes] Failed to register device:', error);
    res.status(500).json({ success: false, message: 'Failed to register device' });
  }
});

/**
 * @swagger
 * /api/devices/unregister:
 *   post:
 *     summary: Unregister device FCM token (POST)
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
 *             properties:
 *               token:
 *                 type: string
 *     responses:
 *       200:
 *         description: Device unregistered successfully
 *   delete:
 *     summary: Unregister device FCM token (DELETE)
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
 *             properties:
 *               token:
 *                 type: string
 *     responses:
 *       200:
 *         description: Device unregistered successfully
 */
const unregisterDevice = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { token } = req.body;

    if (!token) {
      res.status(400).json({ success: false, message: 'token is required' });
      return;
    }

    await prisma.device.deleteMany({
      where: { fcmToken: token }
    });

    console.log(`[DeviceRoutes] Unregistered token: ${token}`);

    res.json({
      success: true,
      message: 'Device unregistered successfully'
    });
  } catch (error) {
    console.error('[DeviceRoutes] Failed to unregister device:', error);
    res.status(500).json({ success: false, message: 'Failed to unregister device' });
  }
};

router.post('/unregister', unregisterDevice);
router.delete('/unregister', unregisterDevice);

export default router;
