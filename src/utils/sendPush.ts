import { getFirebaseApp, getMessaging } from '../config/firebase';

/** Send a notification directly to one FCM registration token. */
export async function sendPush(
  token: string,
  title: string,
  body: string,
  data: Record<string, string> = {},
): Promise<{ success: true; messageId: string }> {
  try {
    // Reuses the established Firebase Admin initialization
    getFirebaseApp();
    const messaging = getMessaging();

    const messageId = await messaging.send({
      token,
      notification: { title, body },
      data,
      android: {
        priority: 'high',
        notification: {
          channelId: 'general_notifications',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
    });

    return { success: true, messageId };
  } catch (error) {
    console.error('FCM send failed:', error);
    throw error;
  }
}
