import admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();

let isInitialized = false;

// Initialize Firebase Admin SDK
// It looks for GOOGLE_APPLICATION_CREDENTIALS environment variable
// Or you can pass a JSON object to credential.cert()
try {
  if (!admin.apps.length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      // Direct JSON parsing from env
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
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
  }
} catch (error) {
  console.error("Firebase Admin initialization error:", error);
}

export const messaging = isInitialized ? admin.messaging() : null;
export default admin;
