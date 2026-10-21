import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

/** Send a notification directly to one FCM registration token. */
export async function sendPush(
  token: string,
  title: string,
  body: string,
  data: Record<string, string> = {},
): Promise<{ success: true; messageId: string }> {
  try {
    const app = getApps()[0] ?? initializeApp({
      credential: applicationDefault(),
    });

    const messageId = await getMessaging(app).send({
      token,
      notification: { title, body },
      data,
      android: {
        priority: 'high',
        notification: {
          channelId: 'general_notifications',
        },
      },
    });

    return { success: true, messageId };
  } catch (error) {
    console.error('FCM send failed:', error);
    throw error;
  }
}
