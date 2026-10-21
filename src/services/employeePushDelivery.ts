import { safeFcmError } from '../utils/fcmErrors';
import { prisma } from '../utils/db';
import { firebaseNotificationService } from './firebaseNotificationService';

export interface PushTarget { id?: number | null; userId: number | null }
export interface PushContent { title: string; body: string; category: string; actionId?: string; actionType?: string }
export async function persistAndPush(targets: PushTarget[], content: PushContent) {
  const unique = [...new Map(targets.map(t => [t.userId == null ? `employee:${t.id}` : `user:${t.userId}`, t])).values()];
  let firstNotification: Awaited<ReturnType<typeof prisma.notification.update>> | undefined;
  const summary = { recipients: unique.length, notificationsCreated: 0, acceptedTokens: 0, failedTokens: 0, noTokenRecipients: 0, failedRecipients: 0, unknownRecipients: 0 };
  console.info('[NotificationDelivery] Request resolved', { recipients: unique.length, category: content.category });
  for (let offset = 0; offset < unique.length; offset += 10) {
    await Promise.all(unique.slice(offset, offset + 10).map(async target => {
      const notification = await prisma.notification.create({ data: { ...content, employeeId: target.id ?? null, userId: target.userId, deliveryStatus: 'PENDING' } });
      summary.notificationsCreated++;
      let deliveryStatus = 'IN_APP_ONLY', failureReason: string | null = null, fcmMessageId: string | null = null;
      try {
        if (target.userId != null) {
          const result = await firebaseNotificationService.sendNotificationToUser(target.userId, content.title, content.body, { id: String(notification.id), category: content.category, type: content.actionType || 'GENERAL', actionId: content.actionId || '', click_action: 'FLUTTER_NOTIFICATION_CLICK' });
          summary.acceptedTokens += result.successCount;
          summary.failedTokens += result.failureCount;
          const unverified = result.responses.length !== result.successCount + result.failureCount;
          deliveryStatus = unverified ? 'UNKNOWN' : result.failureCount ? result.successCount ? 'PARTIAL' : 'FAILED' : result.successCount ? 'SENT' : 'IN_APP_ONLY';
          fcmMessageId = result.responses.find(r => r.success)?.messageId || null;
          const codes = [...new Set(result.responses.filter(r => !r.success).map(r => r.error?.code || 'messaging/unknown-error'))];
          if (codes.length) { failureReason = codes.join(', '); console.warn('[NotificationDelivery] FCM rejected tokens', { notificationId: notification.id, codes }); }
        }
      } catch (error: any) {
        const code = typeof error?.code === 'string' && /^[a-zA-Z0-9/_-]+$/.test(error.code) ? error.code : 'messaging/unknown-outcome';
        const diagnostic = safeFcmError(error);
        deliveryStatus = ['configuration', 'credentials', 'permission', 'token'].includes(diagnostic.category) ? 'FAILED' : 'UNKNOWN';
        failureReason = code;
        console.warn('[NotificationDelivery] Push failed', { notificationId: notification.id, ...safeFcmError(error) });
      }
      if (deliveryStatus === 'IN_APP_ONLY') summary.noTokenRecipients++;
      if (deliveryStatus === 'FAILED' || deliveryStatus === 'PARTIAL') summary.failedRecipients++;
      if (deliveryStatus === 'UNKNOWN') summary.unknownRecipients++;
      const saved = await prisma.notification.update({ where: { id: notification.id }, data: { deliveryStatus, failureReason, fcmMessageId } });
      if (unique.length === 1) firstNotification = saved;
    }));
  }
  console.info('[NotificationDelivery] Completed', summary);
  return { ...summary, notification: firstNotification };
}
export function deliveryMessage(summary: Awaited<ReturnType<typeof persistAndPush>>) {
  return `Saved ${summary.notificationsCreated} notification(s). FCM accepted ${summary.acceptedTokens} device message(s); ${summary.failedRecipients} recipient(s) had push failures, ${summary.unknownRecipients} have unverified outcomes, and ${summary.noTokenRecipients} have no registered device. Device delivery is not verified.`;
}
