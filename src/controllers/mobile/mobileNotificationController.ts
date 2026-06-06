import { Response } from 'express';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';
import { prisma } from '../../utils/db';

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
