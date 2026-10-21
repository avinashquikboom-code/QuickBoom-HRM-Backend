import { Messaging, BatchResponse, BaseMessage } from 'firebase-admin/messaging';
import { prisma } from '../utils/db';
import { getMessaging, FirebaseMessagePayload, FirebaseUserTarget, NotificationOptions } from '../config/firebase';
import { safeFcmError, tokenFingerprint, isPermanentFcmTokenError } from '../utils/fcmErrors';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';

export class FirebaseNotificationService {
  static getInstance() {
    throw new Error('Method not implemented.');
  }

  private getMessagingInstance(): Messaging {
    // Initialization failures must retain their original configuration error.
    return getMessaging();
  }

  // Send notification to specific FCM tokens
  async sendNotificationToTokens(
    tokens: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
    options?: NotificationOptions
  ): Promise<BatchResponse> {
    if (!tokens || tokens.length === 0) {
      throw new Error('No FCM tokens provided');
    }

    const messagingInstance = this.getMessagingInstance();
    const imageUrl = options?.imageUrl || data?.imageUrl || data?.image || undefined;

    const message: BaseMessage = {
      notification: {
        title,
        body,
        ...(imageUrl ? { imageUrl } : {}),
      },
      data: {
        ...data,
        ...(imageUrl ? { imageUrl, image: imageUrl } : {}),
        timestamp: new Date().toISOString(),
        type: data?.type || 'general',
      },
      android: {
        priority: options?.priority?.normal ? 'normal' : 'high',
        ttl: options?.ttl ? options.ttl * 1000 : 3600000,
        notification: {
          sound: 'default',
          channelId: data?.category?.toUpperCase() === 'LEAVE'
            ? 'leave_notifications' : 'general_notifications',
          clickAction: data?.click_action && !data.click_action.startsWith('/') ? data.click_action : 'FLUTTER_NOTIFICATION_CLICK',
          color: '#4CAF50',
          ...(imageUrl ? { imageUrl } : {}),
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
            contentAvailable: options?.contentAvailable || false,
            ...(imageUrl ? { 'mutable-content': 1 } : {}),
          },
        },
        headers: {
          'apns-priority': '10',
          'apns-push-type': 'alert',
        },
        ...(imageUrl ? { fcmOptions: { imageUrl } } : {}),
      },
      webpush: {
        notification: {
          title,
          body,
          ...(imageUrl ? { image: imageUrl } : {}),
          icon: '/favicon.svg',
          badge: '/favicon.svg',
          requireInteraction: true,
          actions: [
            {
              action: 'view',
              title: 'View Details'
            }
          ]
        },
        fcmOptions: {
          link: (data?.web_url || (data?.click_action && data.click_action.startsWith('/') ? data.click_action : undefined)) || '/notifications'
        }
      }
    };

    try {
      // Chunk tokens in batches of 500 (FCM sendEachForMulticast max limit)
      const CHUNK_SIZE = 500;
      const combinedResponses: any[] = [];
      let totalSuccess = 0;
      let totalFailure = 0;

      for (let i = 0; i < tokens.length; i += CHUNK_SIZE) {
        const tokenBatch = tokens.slice(i, i + CHUNK_SIZE);
        const batchResponse = await messagingInstance.sendEachForMulticast({
          tokens: tokenBatch,
          ...message,
        });

        batchResponse.responses.forEach((response, index) => {
          if (!response.success) console.warn('[FirebaseNotificationService] FCM rejected device', {
            notificationId: data?.id || null,
            tokenFingerprint: tokenFingerprint(tokenBatch[index]),
            ...safeFcmError(response.error, tokenBatch),
          });
        });
        combinedResponses.push(...batchResponse.responses);
        totalSuccess += batchResponse.successCount;
        totalFailure += batchResponse.failureCount;

        if (batchResponse.failureCount > 0) {
          const failedTokens = batchResponse.responses
            .flatMap((resp, index) =>
              !resp.success && isPermanentFcmTokenError(resp.error)
                ? [tokenBatch[index]] : []
            );

          await this.removeInvalidTokens(failedTokens);
        }
      }

      console.log(`📱 Firebase Notification Sent:`, {
        successCount: totalSuccess,
        failureCount: totalFailure,
        totalTokens: tokens.length,
      });

      return {
        responses: combinedResponses,
        successCount: totalSuccess,
        failureCount: totalFailure,
      };
    } catch (error) {
      console.error('[FirebaseNotificationService] Send failed', safeFcmError(error, tokens));
      throw error;
    }
  }

  // Send notification to specific user by user ID (both mobile and web push)
  async sendNotificationToUser(
    userId: number,
    title: string,
    body: string,
    data?: Record<string, string>,
    options?: NotificationOptions
  ): Promise<BatchResponse> {
    const [fcmTokens, deviceTokens] = await Promise.all([
      prisma.fCMToken.findMany({
        where: { 
          userId: userId,
          isActive: true 
        },
        select: { token: true }
      }),
      prisma.device.findMany({
        where: { userId },
        select: { fcmToken: true }
      }),
    ]);

    const allTokens = [
      ...fcmTokens.map(t => t.token),
      ...deviceTokens.map(d => d.fcmToken as string),
    ].filter((t): t is string => Boolean(t && t.trim().length > 0));

    const tokens = Array.from(new Set(allTokens));

    if (tokens.length === 0) {
      console.log(`ℹ️ [FirebaseNotificationService] User ${userId} has no active FCM/Device tokens.`);
      return { responses: [], successCount: 0, failureCount: 0 };
    }

    return this.sendNotificationToTokens(tokens, title, body, data, options);
  }

  // Send notification to users by role
  async sendNotificationToRole(
    role: string,
    title: string,
    body: string,
    data?: Record<string, string>,
    options?: NotificationOptions
  ): Promise<BatchResponse> {
    const roleUpper = role.toUpperCase();
    const fcmTokens = await prisma.fCMToken.findMany({
      where: { 
        isActive: true,
        user: {
          role: roleUpper as any,
          isActive: true,
        }
      },
      select: { token: true }
    });

    // Include devices even when some users of this role already have FCMToken rows.
    const devices = await prisma.device.findMany({
        where: {
          user: {
            role: roleUpper as any,
            isActive: true,
          }
        },
        select: { fcmToken: true }
      });
    const tokens = Array.from(new Set([
      ...fcmTokens.map(t => t.token),
      ...devices.map(d => d.fcmToken),
    ].filter((token): token is string => Boolean(token?.trim()))));

    if (tokens.length === 0) {
      console.warn(`[FirebaseNotificationService] No active users with FCM tokens found for role: ${role}`);
      return { responses: [], successCount: 0, failureCount: 0 };
    }

    return this.sendNotificationToTokens(tokens, title, body, data, options);
  }

  // Send notification to users by department
  async sendNotificationToDepartment(
    departmentId: number,
    title: string,
    body: string,
    data?: Record<string, string>,
    options?: NotificationOptions
  ): Promise<BatchResponse> {
    const fcmTokens = await prisma.fCMToken.findMany({
      where: {
        isActive: true,
        user: {
          isActive: true,
          employee: {
            departmentId,
          }
        }
      },
      select: { token: true }
    });

    const tokens = fcmTokens.map(t => t.token);

    if (tokens.length === 0) {
      throw new Error(`No active users with FCM tokens found for department: ${departmentId}`);
    }

    return this.sendNotificationToTokens(tokens, title, body, data, options);
  }

  // Send notification to all active users
  async sendNotificationToAll(
    title: string,
    body: string,
    data?: Record<string, string>,
    options?: NotificationOptions
  ): Promise<BatchResponse> {
    const fcmTokens = await prisma.fCMToken.findMany({
      where: {
        isActive: true,
        user: {
          isActive: true,
        }
      },
      select: { token: true }
    });

    const tokens = fcmTokens.map(t => t.token);

    if (tokens.length === 0) {
      throw new Error('No active users with FCM tokens found');
    }

    return this.sendNotificationToTokens(tokens, title, body, data, options);
  }

  // Remove invalid tokens from database
  private async removeInvalidTokens(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;

    try {
      await prisma.device.deleteMany({ where: { fcmToken: { in: tokens } } });
      // Deactivate invalid tokens
      await prisma.fCMToken.updateMany({
        where: {
          token: {
            in: tokens
          }
        },
        data: {
          isActive: false
        }
      });

      console.log(`🗑️ Deactivated ${tokens.length} invalid FCM tokens from database`);
    } catch (error) {
      console.error('[FirebaseNotificationService] Invalid-token cleanup failed', { code: (error as any)?.code });
    }
  }

  // Helper to send full notification (In-app DB + FCM Push outside app)
  async sendAppNotification(params: {
    userId?: number;
    role?: string;
    title: string;
    body: string;
    category: string;
    screen: string;
    type: string;
    actionId?: string;
  }): Promise<void> {
    const { userId, role, title, body, category, screen, type, actionId } = params;
    const payloadData: Record<string, string> = {
      screen,
      type,
      category,
      title,
      body,
      actionId: actionId || '',
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
    };

    if (userId) {
      try {
        const employee = await prisma.employee.findUnique({
          where: { userId },
        });

        // 1. In-App DB Notification
        await prisma.notification.create({
          data: {
            userId,
            employeeId: employee?.id ?? null,
            title,
            body,
            category: category.toUpperCase(),
            actionType: type,
            actionId: actionId || '',
            isRead: false,
          },
        });
      } catch (err) {
        console.error('Failed to create in-app notification for user:', err);
      }

      // 2. FCM Push (Outside App)
      try {
        await this.sendNotificationToUser(userId, title, body, payloadData, { priority: { high: true } });
      } catch (fcmErr: any) {
        console.warn(`FCM push to user ${userId} skipped or failed:`, fcmErr?.message || fcmErr);
      }
    } else if (role) {
      try {
        const targetUsers = await prisma.user.findMany({
          where: { role: role as any, isActive: true },
          include: { employee: true },
        });

        for (const u of targetUsers) {
          await prisma.notification.create({
            data: {
              userId: u.id,
              employeeId: u.employee?.id ?? null,
              title,
              body,
              category: category.toUpperCase(),
              actionType: type,
              actionId: actionId || '',
              isRead: false,
            },
          });
        }
      } catch (err) {
        console.error(`Failed to create in-app notification for role ${role}:`, err);
      }

      // FCM Push to Role (Outside App)
      try {
        await this.sendNotificationToRole(role, title, body, payloadData, { priority: { high: true } });
      } catch (fcmErr: any) {
        console.warn(`FCM push to role ${role} skipped or failed:`, fcmErr?.message || fcmErr);
      }
    }
  }

  // Test Firebase connection
  async testConnection(): Promise<boolean> {
    try {
      // Try to get app info
      const app = getMessaging();
      console.log('✅ Firebase messaging service is ready');
      return true;
    } catch (error) {
      console.error('❌ Firebase connection test failed:', error);
      return false;
    }
  }
}

// Export singleton instance
export const firebaseNotificationService = new FirebaseNotificationService();
