import * as admin from 'firebase-admin';
import { prisma } from '../utils/db';
import { getMessaging, FirebaseMessagePayload, FirebaseUserTarget, NotificationOptions } from '../config/firebase';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';

export class FirebaseNotificationService {
  private messaging = getMessaging();

  // Send notification to specific FCM tokens
  async sendNotificationToTokens(
    tokens: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
    options?: NotificationOptions
  ): Promise<admin.messaging.BatchResponse> {
    if (!tokens || tokens.length === 0) {
      throw new Error('No FCM tokens provided');
    }

    const message: FirebaseMessagePayload = {
      notification: {
        title,
        body,
        icon: '/favicon.svg',
        sound: 'default',
        badge: '1',
        color: '#4CAF50',
      },
      data: {
        ...data,
        timestamp: new Date().toISOString(),
        type: data?.type || 'general',
      },
      android: {
        priority: options?.priority?.high ? 'high' : 'normal',
        ttl: options?.ttl ? options.ttl * 1000 : 3600000, // Convert to milliseconds
        notification: {
          sound: 'default',
          clickAction: data?.click_action || 'FLUTTER_NOTIFICATION_CLICK',
          color: '#4CAF50',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
            contentAvailable: options?.contentAvailable || false,
          },
        },
        headers: {
          'apns-priority': options?.priority?.high ? '10' : '5',
        },
      },
      webpush: {
        notification: {
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
          link: data?.click_action || 'https://hrmportal.com'
        }
      }
    };

    try {
      const response = await this.messaging.sendEachForMulticast({
        tokens,
        ...message,
      });

      // Log results for debugging
      console.log(`📱 Firebase Notification Sent:`, {
        successCount: response.successCount,
        failureCount: response.failureCount,
        totalTokens: tokens.length,
      });

      // Handle failed tokens
      if (response.failureCount > 0) {
        const failedTokens = response.responses
          .filter((resp: any, index: number) => !resp.success)
          .map((_: any, index: number) => tokens[index]);
        
        console.warn('⚠️ Failed tokens:', failedTokens);
        
        // Optionally remove invalid tokens from database
        await this.removeInvalidTokens(failedTokens);
      }

      return response;
    } catch (error) {
      console.error('❌ Firebase notification error:', error);
      throw new Error(`Failed to send notification: ${(error as Error).message}`);
    }
  }

  // Send notification to specific user by user ID
  async sendNotificationToUser(
    userId: number,
    title: string,
    body: string,
    data?: Record<string, string>,
    options?: NotificationOptions
  ): Promise<admin.messaging.BatchResponse> {
    const fcmTokens = await prisma.fCMToken.findMany({
      where: { 
        userId: userId,
        isActive: true 
      },
      select: { token: true }
    });

    if (!fcmTokens || fcmTokens.length === 0) {
      throw new Error('User not found or has no active FCM tokens');
    }

    const tokens = fcmTokens.map(t => t.token);
    return this.sendNotificationToTokens(tokens, title, body, data, options);
  }

  // Send notification to users by role
  async sendNotificationToRole(
    role: string,
    title: string,
    body: string,
    data?: Record<string, string>,
    options?: NotificationOptions
  ): Promise<admin.messaging.BatchResponse> {
    const fcmTokens = await prisma.fCMToken.findMany({
      where: { 
        isActive: true,
        user: {
          role: role as any,
          isActive: true,
        }
      },
      select: { token: true }
    });

    const tokens = fcmTokens.map(t => t.token);

    if (tokens.length === 0) {
      throw new Error(`No active users with FCM tokens found for role: ${role}`);
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
  ): Promise<admin.messaging.BatchResponse> {
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
  ): Promise<admin.messaging.BatchResponse> {
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
      console.error('❌ Error removing invalid tokens:', error);
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
