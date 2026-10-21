import dotenv from 'dotenv';
import { Messaging } from 'firebase-admin/messaging';
import { getMessaging as getConfiguredMessaging } from '../config/firebase';
import { safeFcmError } from '../utils/fcmErrors';
dotenv.config();

// Legacy nullable interface, backed by the same file/env credential loader.
export const getMessaging = (): Messaging | null => {
  try { return getConfiguredMessaging(); }
  catch (error) {
    console.warn('[FirebaseAdmin] Messaging unavailable', safeFcmError(error));
    return null;
  }
};
export const messaging = getMessaging();
