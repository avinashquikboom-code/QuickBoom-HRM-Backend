import { messaging } from '../lib/firebaseAdmin';
import { prisma } from './db';

/**
 * Send a push notification via Firebase Cloud Messaging
 * @param userId - The user ID to send the notification to
 * @param title - Notification title
 * @param body - Notification body
 * @param data - Optional extra data payload
 */
export async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, string>
) {
  if (!messaging) {
    console.warn('Firebase Admin not initialized. Skipping push notification.');
    return;
  }

  try {
    const fcmTokens = await prisma.fCMToken.findMany({
      where: { userId, isActive: true },
      select: { token: true, id: true },
    });

    if (!fcmTokens || fcmTokens.length === 0) {
      console.log(`No FCM tokens found for user ${userId}. Skipping push.`);
      return;
    }

    const tokenStrings = fcmTokens.map(t => t.token);
    const payload = {
      notification: { title, body },
      data: data || {},
      tokens: tokenStrings,
    };

    const response = await messaging.sendEachForMulticast(payload);
    
    // Optionally remove invalid tokens
    if (response.failureCount > 0) {
      const failedTokens: string[] = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          failedTokens.push(tokenStrings[idx]);
        }
      });
      
      if (failedTokens.length > 0) {
        // Deactivate invalid tokens from DB
        await prisma.fCMToken.updateMany({
          where: {
            userId,
            token: { in: failedTokens },
          },
          data: {
            isActive: false,
          },
        });
        console.log(`Deactivated ${failedTokens.length} invalid FCM tokens for user ${userId}`);
      }
    }
    
    console.log(`Successfully sent ${response.successCount} push notifications to user ${userId}`);
  } catch (error) {
    console.error('Error sending push notification:', error);
  }
}
