import { initializeApp, cert, getApps, App } from 'firebase-admin/app';
import { getMessaging as getAdminMessaging, Messaging } from 'firebase-admin/messaging';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

let firebaseApp: App | null = null;
let isRealAppInitialized = false;

export const initializeFirebase = (): App => {
  if (firebaseApp) return firebaseApp;

  try {
    if (getApps().length > 0) {
      firebaseApp = getApps()[0];
      return firebaseApp;
    }

    let serviceAccount: any = null;

    if (
      process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_PRIVATE_KEY &&
      process.env.FIREBASE_CLIENT_EMAIL
    ) {
      serviceAccount = {
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      };
    }

    if (!serviceAccount) {
      console.warn('⚠️ No Firebase credentials found. Using mock app.');
      firebaseApp = initializeApp({ projectId: 'mock-project' });
      return firebaseApp;
    }

    firebaseApp = initializeApp({
      credential: cert(serviceAccount)
    });
    
    isRealAppInitialized = true;
    console.log('✅ [FirebaseInit] Firebase Admin SDK initialized successfully');
    return firebaseApp;
  } catch (error) {
    console.error('❌ [FirebaseInit] Failed to initialize Firebase:', error);
    firebaseApp = getApps().length > 0 ? getApps()[0] : initializeApp({ projectId: 'mock-project' });
    return firebaseApp;
  }
};

export const getFirebaseApp = (): App => {
  if (!firebaseApp) return initializeFirebase();
  return firebaseApp;
};

export const getMessaging = (): Messaging => {
  const app = getFirebaseApp();
  return getAdminMessaging(app);
};

// Exporting required types for other services
export interface FirebaseNotification {
  title: string;
  body: string;
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
