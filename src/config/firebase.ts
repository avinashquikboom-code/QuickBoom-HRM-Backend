import admin from 'firebase-admin';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Firebase Admin SDK configuration
let firebaseApp: admin.app.App | null = null;
let isRealAppInitialized = false;

export const initializeFirebase = (): admin.app.App => {
  if (firebaseApp) {
    return firebaseApp;
  }

  try {
    // Check if Firebase app already exists in admin.apps
    if (admin.apps.length > 0 && admin.apps[0]) {
      firebaseApp = admin.apps[0]!;
      console.log('✅ [FirebaseInit] Firebase Admin SDK already initialized, using existing app');
      return firebaseApp;
    }

    let serviceAccount: any = null;

    // 1. Check FIREBASE_SERVICE_ACCOUNT env var (JSON string or file path)
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const raw = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
      if (raw.startsWith('{')) {
        try {
          serviceAccount = JSON.parse(raw);
          console.log('✅ [FirebaseInit] Loaded credentials from FIREBASE_SERVICE_ACCOUNT env JSON');
        } catch (e) {
          console.error('❌ [FirebaseInit] Failed to parse FIREBASE_SERVICE_ACCOUNT JSON env:', e);
        }
      } else {
        try {
          if (existsSync(raw)) {
            serviceAccount = JSON.parse(readFileSync(raw, 'utf8'));
            console.log(`✅ [FirebaseInit] Loaded credentials from file path in FIREBASE_SERVICE_ACCOUNT: ${raw}`);
          }
        } catch (e) {
          console.error(`❌ [FirebaseInit] Failed to read file at FIREBASE_SERVICE_ACCOUNT path (${raw}):`, e);
        }
      }
    }

    // 2. Check GOOGLE_APPLICATION_CREDENTIALS env var (file path)
    if (!serviceAccount && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      const filePath = process.env.GOOGLE_APPLICATION_CREDENTIALS.trim();
      try {
        if (existsSync(filePath)) {
          serviceAccount = JSON.parse(readFileSync(filePath, 'utf8'));
          console.log(`✅ [FirebaseInit] Loaded credentials from GOOGLE_APPLICATION_CREDENTIALS: ${filePath}`);
        }
      } catch (e) {
        console.error(`❌ [FirebaseInit] Failed to read GOOGLE_APPLICATION_CREDENTIALS file (${filePath}):`, e);
      }
    }

    // 3. Check firebase-service-account.json in project root
    if (!serviceAccount) {
      const serviceAccountPath = join(process.cwd(), 'firebase-service-account.json');
      if (existsSync(serviceAccountPath)) {
        try {
          serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
          console.log(`✅ [FirebaseInit] Loaded credentials from local file: ${serviceAccountPath}`);
        } catch (e) {
          console.error('❌ [FirebaseInit] Failed to read firebase-service-account.json:', e);
        }
      }
    }

    // 4. Check explicit environment variables
    if (
      !serviceAccount &&
      process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_PRIVATE_KEY &&
      process.env.FIREBASE_CLIENT_EMAIL
    ) {
      console.log('✅ [FirebaseInit] Loaded credentials from FIREBASE_PROJECT_ID / PRIVATE_KEY / CLIENT_EMAIL env vars');
      serviceAccount = {
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_CLIENT_ID || '',
        auth_uri: 'https://accounts.google.com/o/oauth2/auth',
        token_uri: 'https://oauth2.googleapis.com/token',
      };
    }

    if (!serviceAccount) {
      console.warn('⚠️ [FirebaseInit] No valid Firebase env/file credentials configured. Defaulting to mock app.');
      if (admin.apps.length > 0 && admin.apps[0]) {
        firebaseApp = admin.apps[0]!;
      } else {
        firebaseApp = admin.initializeApp({
          projectId: 'quickboom-mock',
        });
      }
      return firebaseApp;
    }

    // Initialize Firebase Admin SDK as default app
    if (admin.apps.length > 0 && admin.apps[0]) {
      firebaseApp = admin.apps[0]!;
    } else {
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id,
      });
      isRealAppInitialized = true;
    }

    console.log(`✅ [FirebaseInit] Firebase Admin SDK initialized successfully for project: "${serviceAccount.project_id || 'default'}"`);
    return firebaseApp;
  } catch (error) {
    console.error('❌ [FirebaseInit] Failed to initialize Firebase:', error);
    console.warn('⚠️ [FirebaseInit] Using fallback mock app.');
    if (admin.apps.length > 0 && admin.apps[0]) {
      firebaseApp = admin.apps[0]!;
    } else {
      firebaseApp = admin.initializeApp({
        projectId: 'quickboom-mock',
      });
    }
    return firebaseApp;
  }
};

export const initializeFirebaseFromDb = async (): Promise<admin.app.App> => {
  if (firebaseApp && isRealAppInitialized) {
    return firebaseApp;
  }

  const syncApp = initializeFirebase();
  if (isRealAppInitialized) {
    return syncApp;
  }

  try {
    const { prisma } = await import('../utils/db');
    const setting = await prisma.systemSetting.findFirst();
    const integrations = (setting?.integrations as any) || {};

    let serviceAccount: any = null;

    const rawKey = (
      integrations.firebaseServiceAccountJson ||
      integrations.firebaseServiceAccount ||
      integrations.firebaseServerKey ||
      ''
    ).toString().trim();

    if (rawKey.startsWith('{')) {
      try {
        serviceAccount = JSON.parse(rawKey);
        console.log('✅ [FirebaseInit] Loaded credentials from DB SystemSetting integrations JSON');
      } catch (e) {
        console.error('❌ [FirebaseInit] Failed to parse DB integrations JSON:', e);
      }
    } else if (integrations.firebaseProjectId && integrations.firebasePrivateKey && integrations.firebaseClientEmail) {
      serviceAccount = {
        project_id: integrations.firebaseProjectId.trim(),
        private_key: integrations.firebasePrivateKey.replace(/\\n/g, '\n'),
        client_email: integrations.firebaseClientEmail.trim(),
      };
      console.log('✅ [FirebaseInit] Loaded credentials from DB SystemSetting explicit fields');
    }

    if (serviceAccount && serviceAccount.project_id) {
      if (admin.apps.length > 0) {
        await Promise.all(admin.apps.map(app => app?.delete().catch(() => {})));
      }
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id,
      });
      isRealAppInitialized = true;
      console.log(`✅ [FirebaseInit] Successfully loaded & initialized Firebase from DB Admin Panel integrations for project: "${serviceAccount.project_id}"`);
      return firebaseApp;
    }
  } catch (error) {
    console.warn('⚠️ [FirebaseInit] DB integration lookup warning:', error);
  }

  return syncApp;
};

export const getFirebaseApp = (): admin.app.App => {
  if (!firebaseApp) {
    return initializeFirebase();
  }
  return firebaseApp;
};

export const getMessaging = (): admin.messaging.Messaging => {
  const app = getFirebaseApp();
  return admin.messaging(app);
};

// Firebase notification types
export interface FirebaseNotification {
  title: string;
  body: string;
  icon?: string;
  click_action?: string;
  sound?: string;
  badge?: string;
  tag?: string;
  color?: string;
}

export interface FirebaseMessagePayload {
  notification: FirebaseNotification;
  data?: Record<string, string>;
  android?: admin.messaging.AndroidConfig;
  apns?: admin.messaging.ApnsConfig;
  webpush?: admin.messaging.WebpushConfig;
}

export interface FirebaseUserTarget {
  tokens: string[];
  userId?: string;
  role?: string;
  department?: string;
}

export interface NotificationPriority {
  high?: boolean;
  normal?: boolean;
}

export interface NotificationOptions {
  priority?: NotificationPriority;
  ttl?: number;
  collapseKey?: string;
  mutableContent?: boolean;
  contentAvailable?: boolean;
}
