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
      // Direct JSON parsing from env
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      isInitialized = true;
    } else if (existsSync(serviceAccountPath)) {
      // Load from local service account file
      const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      isInitialized = true;
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      // Uses the default env path
      admin.initializeApp({
        credential: admin.credential.applicationDefault()
      });
      isInitialized = true;
    } else {
      console.warn("Firebase Admin: Missing credentials. Notifications will not be sent. Please set FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS in .env.");
    }
  } else {
    isInitialized = true;
  }
} catch (error) {
  console.error("Firebase Admin initialization error:", error);
}

export const messaging = isInitialized ? admin.messaging() : null;
export default admin;
