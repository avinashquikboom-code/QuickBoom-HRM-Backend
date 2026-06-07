import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { join } from 'path';

// Firebase Admin SDK configuration
let firebaseApp: admin.app.App | null = null;

export const initializeFirebase = (): admin.app.App => {
  if (firebaseApp) {
    return firebaseApp;
  }

  try {
    // Check if Firebase app already exists
    const existingApps = admin.getApps();
    if (existingApps.length > 0) {
      firebaseApp = existingApps[0]; // Use the first existing app
      console.log('✅ Firebase Admin SDK already initialized, using existing app');
      return firebaseApp;
    }

    // Check if we have a service account key file
    const serviceAccountPath = join(process.cwd(), 'firebase-service-account.json');
    
    let serviceAccount;
    let useMock = false;
    
    try {
      // Try to read service account file
      serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
    } catch (error) {
      // Check if environment variables are fully present
      if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
        console.log('Firebase service account file not found, using environment variables');
        serviceAccount = {
          project_id: process.env.FIREBASE_PROJECT_ID,
          private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          client_email: process.env.FIREBASE_CLIENT_EMAIL,
          client_id: process.env.FIREBASE_CLIENT_ID || '',
          auth_uri: 'https://accounts.google.com/o/oauth2/auth',
          token_uri: 'https://oauth2.googleapis.com/token',
        };
      } else {
        useMock = true;
      }
    }

    if (useMock) {
      console.warn('⚠️ Firebase credentials not fully configured. Using mock Firebase for development.');
      firebaseApp = admin.initializeApp({
        projectId: 'quickboom-mock',
      }, 'mock-app');
      return firebaseApp;
    }

    // Initialize Firebase Admin SDK
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
    });

    console.log('✅ Firebase Admin SDK initialized successfully');
    return firebaseApp;
    
  } catch (error) {
    console.error('❌ Failed to initialize Firebase:', error);
    // For development, we'll create a mock app instead of throwing an error
    console.warn('⚠️ Using mock Firebase for development - notifications will not be sent');
    firebaseApp = admin.initializeApp({
      projectId: 'quickboom-mock',
    }, 'mock-app');
    return firebaseApp;
  }
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
