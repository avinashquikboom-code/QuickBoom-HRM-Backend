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

    // 1. Check explicit file path in env or default secrets locations
    const candidatePaths = [
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
      process.env.GOOGLE_APPLICATION_CREDENTIALS,
      join(__dirname, '../../secrets/firebase-service-account.json'),
      join(process.cwd(), 'secrets/firebase-service-account.json'),
      join(process.cwd(), 'firebase-service-account.json'),
    ].filter(Boolean) as string[];

    for (const filePath of candidatePaths) {
      if (existsSync(filePath)) {
        try {
          const raw = readFileSync(filePath, 'utf-8');
          serviceAccount = JSON.parse(raw);
          console.log(`🔑 [FirebaseInit] Loaded service account credentials from: ${filePath}`);
          break;
        } catch (err) {
          console.warn(`⚠️ [FirebaseInit] Failed to parse credentials at ${filePath}:`, err);
        }
      }
    }

    // 2. Check JSON string in env
    if (!serviceAccount && process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      try {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      } catch (err) {
        console.warn('⚠️ [FirebaseInit] Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON env var:', err);
      }
    }

    // 3. Check individual env variables
    if (
      !serviceAccount &&
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
    console.error('[FirebaseInit] Initialization failed', { code: (error as any)?.code, name: (error as any)?.name });
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
  if (app.options.projectId === 'mock-project') {
    throw Object.assign(new Error('Firebase credentials are not configured'), { code: 'messaging/not-configured' });
  }
  return getAdminMessaging(app);
};

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
