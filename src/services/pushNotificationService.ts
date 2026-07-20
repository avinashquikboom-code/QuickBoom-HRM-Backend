import * as admin from 'firebase-admin';
import { prisma } from '../utils/db';
import { getMessaging } from '../config/firebase';

export class PushNotificationService {
  private messaging: admin.messaging.Messaging | null = null;

  private getMessagingInstance(): admin.messaging.Messaging {
    if (!this.messaging) {
      this.messaging = getMessaging();
    }
    return this.messaging;
  }

  /**
   * Send push notification to a list of users by their userIds (asynchronously/fire-and-forget)
   * Never blocks the request path. Logs failures.
   */
  async sendPush(
    userIds: string[],
    title: string,
    body: string,
    data?: Record<string, string>
  ): Promise<void> {
    try {
      if (!userIds || userIds.length === 0) {
        return;
      }

      // 1. Fetch active devices for the user IDs
      const devices = await prisma.device.findMany({
        where: {
          userId: { in: userIds }
        },
        select: {
          fcmToken: true
        }
      });

      const tokens = devices.map(d => d.fcmToken);
      if (tokens.length === 0) {
        console.log(`[PushNotificationService] No registered devices found for users: ${userIds.join(', ')}`);
        return;
      }

      // Ensure data keys and values are strings
      const payloadData: Record<string, string> = {};
      if (data) {
        Object.entries(data).forEach(([key, val]) => {
          payloadData[key] = String(val);
        });
      }

      const message = {
        tokens,
        notification: {
          title,
          body,
        },
        data: payloadData,
        android: {
          priority: 'high' as const,
          notification: {
            sound: 'default',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          }
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1
            }
          }
        }
      };

      console.log(`[PushNotificationService] Sending push to users: ${userIds.join(', ')} (tokens count: ${tokens.length})`);
      const response = await this.getMessagingInstance().sendEachForMulticast(message);
      
      console.log(`[PushNotificationService] FCM Multicast Result: success=${response.successCount}, failure=${response.failureCount}`);

      if (response.failureCount > 0) {
        const tokensToDelete: string[] = [];
        
        response.responses.forEach((resp, idx) => {
          if (!resp.success && resp.error) {
            const errorCode = resp.error.code;
            const token = tokens[idx];
            console.error(`[PushNotificationService] FCM token delivery failed. Error code: ${errorCode}, Message: ${resp.error.message}`);
            
            // Delete token on invalid / unregistered errors
            if (
              errorCode === 'messaging/registration-token-not-registered' ||
              errorCode === 'messaging/invalid-registration-token' ||
              errorCode === 'messaging/mismatched-credential'
            ) {
              tokensToDelete.push(token);
            }
          }
        });

        if (tokensToDelete.length > 0) {
          await prisma.device.deleteMany({
            where: {
              fcmToken: { in: tokensToDelete }
            }
          });
          console.log(`[PushNotificationService] Deleted ${tokensToDelete.length} unregistered FCM tokens from DB`);
        }
      }
    } catch (error) {
      console.error('[PushNotificationService] Failed to send multicast push notifications:', error);
    }
  }
}

export const pushNotificationService = new PushNotificationService();
