# Push notification delivery investigation — 20 October 2026

## Confirmed defects

1. The individual and broadcast HR controllers launched FCM work without awaiting it and returned “sent successfully” after history persistence. Push exceptions were swallowed. The UI therefore could report success without a single accepted device message.
2. The admin send page used raw fetch for department/role sends, omitting the shared authenticated Axios configuration and never checking response.ok. A 401/403/500 could produce its unconditional success message.
3. Department sends queried only FCMToken, while the mobile registration endpoint stored Device rows. Individual sends already merged these token stores. This made registration reachability inconsistent across modes.
4. Broadcast history targeted all active employees, while its push targeted only EMPLOYEE-role users. The two recipient sets did not agree.
5. Invalid tokens were deactivated in FCMToken but retained in the Device fallback. Logout deleted by token alone and logged the complete token. Token ownership was not synchronized across the two stores.
6. The history UI labelled every unread record “Delivered”, without delivery evidence.

These are verified source defects. They do not establish the actual FCM response for the reported production recipient; that requires configured sender credentials, an identified test employee and a real push.

## Implemented changes

All four existing endpoints now use a shared persistAndPush helper, saving history as PENDING and awaiting the existing FirebaseNotificationService. The response retains success/message and existing count/announcement/individual-notification fields, with an additive delivery summary. success describes processing/history persistence; provider results determine the separate push outcome. Client feedback uses that result instead of assuming delivery.

- POST /api/hr/notifications/send
- POST /api/hr/announcements/broadcast
- POST /api/admin/notifications/send-department
- POST /api/admin/notifications/send-role

The helper resolves no second, different audience for push. All modes deliver to their exact active recipient snapshot, and use the per-user token union. Broadcast includes all active employees with active accounts across roles. Department/role endpoints now explicitly require the same admin/HR roles as the other send endpoints. Ordinary employees cannot use them for bulk targeting.

History statuses: SENT = FCM accepted all attempted token messages; PARTIAL = some accepted and some rejected; FAILED = known push/configuration rejection; UNKNOWN = provider outcome cannot be established; IN_APP_ONLY = no registered device or linked account. SENT is not verified Android display/delivery. Provider message IDs and sanitized error codes are stored using existing Notification fields. No automatic retries were added, and errors advise checking history before manual retry. Work is bounded to ten recipient operations concurrently, with existing FCM token batching at 500. A large audience may outlast an HTTP timeout; durable queued bulk dispatch remains separate work. Do not blindly resubmit a timed-out broadcast.

Missing Firebase credentials now fail explicitly rather than returning a synthetic successful-looking send path. Expired/invalid tokens are cleaned from both registration stores. Registration updates Device and FCMToken transactionally, deactivates another account’s old mapping for the same token, and supports previousToken for this installation’s rotation without removing other devices. Logout cleanup is scoped to the authenticated account. Registration responses no longer echo raw tokens. Diagnostic logs contain counts/IDs/error codes; Flutter request/response logging redacts token/password/authorization/private-key fields.

Flutter keeps its existing Firebase initialization, Android channels, foreground local notification handler, background handler and tap routing. Handlers are registered before initial token retrieval and guarded against duplicate subscription. Token refresh supplies the previous token so the server can retire the installation’s old registration. Existing uncommitted notification service/WebSocket changes were preserved.

No schema migration or deployment file change was required. Existing Notification.deliveryStatus/failureReason/fcmMessageId and FCMToken/Device fields are reused. This assumes the deployment has applied its established notification schema migrations; missing production tables/columns still require the separately verified schema recovery process.

## Actual device/configuration evidence

An authorized Android CPH2321 was connected. Read-only ADB checks showed:

- org.quickboom.hrm installed, version 1.0.0, target SDK 36.
- POST_NOTIFICATIONS granted.
- App process running, stopped=false.
- android/app/google-services.json and firebase_options.dart both identify project quickboom-hrm and Android package org.quickboom.hrm.

The local backend environment has none of FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY configured. No keys, authorization tokens, full FCM tokens or private service account contents were printed. Production credential state and the phone’s authenticated employee ID have not been verified. The approved phone was not reinstalled, reset, logged out or force-stopped.

**Real FCM acceptance and visible device receipt: NOT TESTED.** No real production employee or organization-wide test push was sent. The user requested all-employee broadcast support, which is implemented; test data verifies that audience without notifying the real organization.

## Verification performed

- npm run build: backend passed.
- npm run build: frontend passed. Its existing configuration skips type validation. Standalone TypeScript checking still reports pre-existing RegisterRole/SALESMAN and commission transaction typing errors outside these changes.
- flutter analyze lib/core/services/notification_service.dart lib/core/services/api_service.dart: passed.
- node scripts/test_push_delivery.cjs: 11 checks passed with mocked database/FCM: acceptance vs delivery, deduplication, no tokens, partial failure, missing credentials, uncertain transport outcome, individual/department/role/broadcast selection, response compatibility and invalid targets.
- node scripts/test_fcm_payload.cjs: passed notification title/body, channel match, token-store union/deduplication, invalid token cleanup, 500-token batching and missing sender configuration checks. No network FCM send occurred.
- node scripts/test_device_registration.cjs: passed transactional ownership synchronization, installation token rotation, scoped logout, validation and raw-token response exclusion.
- node scripts/test_push_send_ui.cjs: passed browser checks that all four modes authenticate, reject HTTP failures, show provider acceptance separately from delivery, and do not claim success when the recipient has no registered device. APIs were fully mocked.

## Remaining real-device verification

Configure the existing backend environment/secret setup for the same quickboom-hrm Firebase project. Do not paste a private key into chat or commit it. The existing code expects FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY. Verify production configuration independently; the missing values above refer to this local environment only.

Identify the test employee signed into the approved phone. A read-only diagnostic is included in the backend image after build:

```bash
docker exec hrm-backend node dist/scripts/notificationPushDiagnostics.js TEST_EMPLOYEE_INTEGER_ID
```

It reports active account/employee state, registration counts, configured project ID and credential-presence booleans, without printing tokens or secrets. Replace the placeholder with the actual employee ID. It sends no messages.

Then deploy backend/admin/mobile changes through the existing workflow, reopen/log in on the test app, and verify registration. Send to that individual test employee first, inspect delivery summary/history/provider error codes, and verify display in foreground, background and normally terminated states. Verify other modes only with controlled test accounts. Do not confuse a backend accepted message with visible device receipt.

Android foreground notifications require the local display handler. Background notification payloads are displayed by the system, so this app’s background handler deliberately does not display another local banner. An Android force-stop blocks FCM until the user manually reopens the app; it is not equivalent to normal background/termination. See [Firebase Flutter receive-message documentation](https://firebase.google.com/docs/cloud-messaging/flutter/receive-messages).

## Files

Backend: src/services/employeePushDelivery.ts (new); src/services/firebaseNotificationService.ts; src/config/firebase.ts; src/controllers/hr/hrNotificationController.ts; src/controllers/adminController.ts; src/controllers/mobile/mobileNotificationController.ts; src/routes/adminRoutes.ts; src/routes/deviceRoutes.ts; src/scripts/notificationPushDiagnostics.ts (new); scripts/test_push_delivery.cjs, test_fcm_payload.cjs, test_device_registration.cjs (new).

Admin: src/features/notifications/pages/SendNotificationPage.tsx; NotificationsPage.tsx; src/services/notificationService.ts; scripts/test_push_send_ui.cjs (new).

Flutter: lib/core/services/notification_service.dart and api_service.dart. Earlier uncommitted notification provider/detail-sheet edits were not reverted.
