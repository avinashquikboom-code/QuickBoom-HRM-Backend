import { initializeApp, cert, getApps, App } from 'firebase-admin/app';
import { getMessaging as getAdminMessaging, Messaging } from 'firebase-admin/messaging';
import { loadFirebaseCredentials } from './firebaseCredentials';
import { safeFcmError } from '../utils/fcmErrors';

let firebaseApp: App | null = null;

export const initializeFirebase = (): App => {
  if (firebaseApp) return firebaseApp;
  try {
    const existing = getApps()[0];
    if (existing) {
      const projectId = existing.options.projectId || (existing.options.credential as any)?.projectId;
      if (projectId !== 'quickboom-hrm') {
        throw Object.assign(new Error('Existing Firebase app does not match the Android Firebase project'), { code: 'firebase/project-mismatch' });
      }
      firebaseApp = existing;
      return existing;
    }
    const { credential, diagnostics } = loadFirebaseCredentials();
    firebaseApp = initializeApp({ credential: cert(credential), projectId: credential.projectId });
    console.info('[FirebaseInit] Initialized', { source: diagnostics.source, projectId: diagnostics.projectId });
    return firebaseApp;
  } catch (error) {
    console.error('[FirebaseInit] Initialization failed', safeFcmError(error));
    // Preserve the actual cause; never cache a mock app or silently ignore a bad path.
    throw error;
  }
};

export const getFirebaseApp = (): App => firebaseApp || initializeFirebase();
export const getMessaging = (): Messaging => getAdminMessaging(getFirebaseApp());

// Exporting required types for other services
export interface FirebaseNotification {
  title: string;
  body: string;
  imageUrl?: string;
  icon?: string;
  click_action?: string;
  sound?: string;
  badge?: string;
  color?: string;
}

export interface NotificationPriority {
  high?: boolean;
  normal?: boolean;
}

export interface NotificationOptions {
  priority?: NotificationPriority;
  ttl?: number;
  contentAvailable?: boolean;
  imageUrl?: string;
}

export interface FirebaseMessagePayload {
  notification: FirebaseNotification;
  data?: Record<string, string>;
  android?: any;
  apns?: any;
  webpush?: any;
}

export const initializeFirebaseFromDb = async (): Promise<App> => {
  return initializeFirebase(); // Simplified for the modern imports as per user request
};

export interface FirebaseUserTarget {
  tokens: string[];
  userId?: string;
  role?: string;
  department?: string;
}
