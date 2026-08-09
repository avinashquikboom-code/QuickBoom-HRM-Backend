import admin from 'firebase-admin';
import dotenv from 'dotenv';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

dotenv.config();

let isInitialized = false;

// Initialize Firebase Admin SDK
try {
  if (!admin.apps.length) {
    const serviceAccountPath = join(process.cwd(), 'firebase-service-account.json');
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount)
        });
        isInitialized = true;
      } catch (e) {
        console.error("Firebase Admin: Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:", e);
      }
    } else if (existsSync(serviceAccountPath)) {
      try {
        const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount)
        });
        isInitialized = true;
      } catch (e) {
        console.error("Firebase Admin: Failed to read firebase-service-account.json:", e);
      }
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      try {
        admin.initializeApp({
          credential: admin.credential.applicationDefault()
        });
        isInitialized = true;
      } catch (e) {
        console.error("Firebase Admin: Failed to initialize applicationDefault:", e);
      }
    } else if (
      process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_PRIVATE_KEY &&
      process.env.FIREBASE_CLIENT_EMAIL
    ) {
      try {
        admin.initializeApp({
          credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          })
        });
        isInitialized = true;
      } catch (e) {
        console.error("Firebase Admin: Failed to initialize with explicit env vars:", e);
      }
    } else {
      console.warn("Firebase Admin: Missing credentials. Notifications will be disabled.");
    }
  } else {
    isInitialized = true;
  }
} catch (error) {
  console.error("Firebase Admin initialization error:", error);
}

export const getMessaging = (): admin.messaging.Messaging | null => {
  try {
    if (admin.apps.length > 0 && admin.apps[0]) {
      return admin.messaging(admin.apps[0]);
    }
    return null;
  } catch (e) {
    console.warn("Firebase Admin: Messaging service unavailable:", e);
    return null;
  }
};

export const messaging = isInitialized && admin.apps.length > 0 ? getMessaging() : null;
export default admin;
