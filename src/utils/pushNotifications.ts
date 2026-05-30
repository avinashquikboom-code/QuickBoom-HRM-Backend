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
  userId: number,
  title: string,
  body: string,
  data?: Record<string, string>
) {
  if (!messaging) {
    console.warn('Firebase Admin not initialized. Skipping push notification.');
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { fcmTokens: true },
    });

    if (!user || !user.fcmTokens || user.fcmTokens.length === 0) {
      console.log(`No FCM tokens found for user ${userId}. Skipping push.`);
      return;
    }

    const payload = {
      notification: { title, body },
      data: data || {},
      tokens: user.fcmTokens,
    };

    const response = await messaging.sendEachForMulticast(payload);
    
    // Optionally remove invalid tokens
    if (response.failureCount > 0) {
      const failedTokens: string[] = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          failedTokens.push(user.fcmTokens[idx]);
        }
      });
      
      if (failedTokens.length > 0) {
        // Remove invalid tokens from DB
        await prisma.user.update({
          where: { id: userId },
          data: {
            fcmTokens: {
              set: user.fcmTokens.filter(token => !failedTokens.includes(token))
            }
          }
        });
        console.log(`Removed ${failedTokens.length} invalid FCM tokens for user ${userId}`);
      }
    }
    
    console.log(`Successfully sent ${response.successCount} push notifications to user ${userId}`);
  } catch (error) {
    console.error('Error sending push notification:', error);
  }
}
