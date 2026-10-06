import { initializeApp, cert, getApps, App } from 'firebase-admin/app';
import { getMessaging as getAdminMessaging, Messaging } from 'firebase-admin/messaging';
import dotenv from 'dotenv';
dotenv.config();

let isInitialized = false;
let firebaseApp: App | null = null;

try {
  if (getApps().length === 0) {
    if (
      process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_PRIVATE_KEY &&
      process.env.FIREBASE_CLIENT_EMAIL
    ) {
      firebaseApp = initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
      });
      isInitialized = true;
    } else {
      console.warn("Firebase Admin: Missing explicit env vars.");
    }
  } else {
    firebaseApp = getApps()[0];
    isInitialized = true;
  }
} catch (error) {
  console.error("Firebase Admin initialization error:", error);
}

export const getMessaging = (): Messaging | null => {
  try {
    if (isInitialized && firebaseApp) {
      return getAdminMessaging(firebaseApp);
    }
    return null;
  } catch (e) {
    console.warn("Firebase Admin: Messaging service unavailable:", e);
    return null;
  }
};

export const messaging = isInitialized ? getMessaging() : null;
