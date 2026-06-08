# Firebase Cloud Messaging (FCM) Integration Guide

## 🚀 Quick Setup for QuickBoom HRM

### 1. Firebase Project Setup

1. **Create Firebase Project**
   - Go to [Firebase Console](https://console.firebase.google.com/)
   - Click "Add project"
   - Name your project (e.g., "quickboom-hrm")
   - Enable Google Analytics (optional)

2. **Get Service Account Key**
   - Go to Project Settings > Service accounts
   - Click "Generate new private key"
   - Download the JSON file
   - Rename it to `firebase-service-account.json`
   - Place it in the root directory of your project

### 2. Environment Variables

Add these to your `.env` file:

```env
# Firebase Configuration
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_CLIENT_ID=123456789012345678901
```

### 3. Mobile App Integration

#### For Flutter/Dart
```dart
// Add to pubspec.yaml
dependencies:
  firebase_core: ^2.24.2
  firebase_messaging: ^14.7.10
  flutter_local_notifications: ^16.3.2

// Initialize Firebase
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp();
  
  // Get FCM token
  final fcmToken = await FirebaseMessaging.instance.getToken();
  print('FCM Token: $fcmToken');
  
  // Send token to backend
  await sendTokenToBackend(fcmToken);
}
```

#### For React Native
```javascript
// Install dependencies
npm install @react-native-firebase/app @react-native-firebase/messaging

// Get FCM token
import messaging from '@react-native-firebase/messaging';

const getToken = async () => {
  const token = await messaging().getToken();
  console.log('FCM Token:', token);
  // Send token to backend
  await sendTokenToBackend(token);
};
```

### 4. API Endpoints

#### Authentication Required
All notification endpoints require authentication and HR/Admin permissions:

```bash
# Test Firebase connection
GET /api/mobile/firebase/test-connection

# Send notification to specific user
POST /api/mobile/firebase/send-to-user
{
  "userId": 6,
  "title": "Attendance Reminder",
  "body": "Don't forget to punch in today!",
  "data": {
    "type": "attendance",
    "click_action": "ATTendance_SCREEN"
  }
}

# Send notification by role
POST /api/mobile/firebase/send-to-role
{
  "role": "EMPLOYEE",
  "title": "Holiday Announcement",
  "body": "Office will be closed tomorrow",
  "data": {
    "type": "holiday"
  }
}

# Send notification by department
POST /api/mobile/firebase/send-to-department
{
  "departmentId": 5,
  "title": "Meeting Reminder",
  "body": "Team meeting in 30 minutes",
  "data": {
    "type": "meeting"
  }
}

# Send notification to all users
POST /api/mobile/firebase/send-to-all
{
  "title": "System Maintenance",
  "body": "System will be down for maintenance",
  "data": {
    "type": "system"
  }
}
```

#### Public Test Endpoints (No Auth Required)
```bash
# Test Firebase connection
GET /api/mobile/firebase/public-test

# Send test notification (mock)
POST /api/mobile/firebase/public-send-test
{
  "title": "Test Notification",
  "body": "This is a test",
  "data": {
    "type": "test"
  }
}
```

### 5. Notification Triggers

The system automatically sends notifications for:

#### Attendance Events
- **Punch In**: "Welcome to work!"
- **Punch Out**: "Great work today!"
- **Break Start**: "Break time started"
- **Break End**: "Break time ended"

#### Leave Events
- **Leave Applied**: "Your leave request has been submitted"
- **Leave Approved**: "Your leave has been approved"
- **Leave Rejected**: "Your leave request was rejected"

#### System Events
- **Profile Updates**: "Your profile has been updated"
- **Password Changes**: "Your password was changed"
- **New Assignments**: "You have a new task assigned"

### 6. Notification Payload Format

#### Standard Notification
```json
{
  "notification": {
    "title": "Attendance Reminder",
    "body": "Don't forget to punch in today!",
    "icon": "/favicon.svg",
    "sound": "default",
    "badge": "1",
    "color": "#4CAF50"
  },
  "data": {
    "type": "attendance",
    "click_action": "ATTENDANCE_SCREEN",
    "timestamp": "2026-06-02T17:16:44.010Z"
  },
  "android": {
    "priority": "high",
    "ttl": 3600000,
    "notification": {
      "sound": "default",
      "clickAction": "FLUTTER_NOTIFICATION_CLICK",
      "color": "#4CAF50"
    }
  },
  "apns": {
    "payload": {
      "aps": {
        "sound": "default",
        "badge": 1,
        "contentAvailable": false
      }
    },
    "headers": {
      "apns-priority": "10"
    }
  }
}
```

### 7. Testing

#### Test Connection
```bash
curl http://localhost:5009/api/mobile/firebase/public-test
```

#### Test Notification
```bash
curl -X POST http://localhost:5009/api/mobile/firebase/public-send-test \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Notification",
    "body": "This is a test from QuickBoom HRM",
    "data": {
      "type": "test",
      "click_action": "FLUTTER_NOTIFICATION_CLICK"
    }
  }'
```

### 8. Production Deployment

For production deployment:

1. **Use Real Firebase Credentials**
   - Replace mock credentials with real Firebase project credentials
   - Ensure service account has proper permissions

2. **Environment Configuration**
   - Set all required environment variables
   - Use secure storage for private keys

3. **Error Handling**
   - Monitor failed tokens and remove them from database
   - Implement retry logic for failed notifications

4. **Rate Limiting**
   - Implement rate limiting for notification endpoints
   - Monitor Firebase quota usage

### 9. Troubleshooting

#### Common Issues

**"Firebase initialization failed"**
- Check service account file exists
- Verify environment variables are set
- Ensure private key format is correct

**"No FCM tokens found"**
- Users need to login with FCM token
- Check mobile app is sending tokens to backend
- Verify tokens are stored in database

**"Notification not received"**
- Check device has notifications enabled
- Verify app is in background/foreground
- Test with different notification types

#### Debug Mode
Enable debug logging:
```bash
# Set environment variable
DEBUG=firebase node dist/index.js
```

### 10. Security Considerations

- **Private Key Security**: Never commit private keys to version control
- **Token Validation**: Always validate FCM tokens before storing
- **Access Control**: Restrict notification endpoints to authorized users
- **Data Privacy**: Don't send sensitive data in notification payloads

---

## 📱 Mobile Integration Checklist

- [ ] Firebase project created
- [ ] Service account key downloaded
- [ ] Environment variables configured
- [ ] Mobile app integrated with FCM
- [ ] Token management implemented
- [ ] Notification handlers added
- [ ] Testing completed
- [ ] Production deployment ready

For support, check the Firebase documentation or contact the development team.
