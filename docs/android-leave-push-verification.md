# Android leave push investigation and verification

## Status

The updated backend sender and physical Android app successfully delivered controlled LEAVE notification payloads in foreground, background and terminated states. This is not a declaration that the original production failure is resolved. Its exact Firebase Admin error, production credential-file accessibility, and production recipient association remain unverified because the production server/recipient were not made accessible. The configured SSH alias previously timed out and resolves to a different host than api.voxiqai.com.

The reported aggregate (saved=1, accepted=0, failed recipients=1, no-device recipients=0) proves a known push/configuration rejection with registered token records. It does not identify whether those records are invalid or whether the sender credentials/permissions are wrong. No Flutter permission/channel diagnosis can explain Firebase accepting zero messages by itself.

## Actual leave trace

`mobileLeaveController.createLeaveRequest` persists the LeaveRequest and awaits `notifyEmployee` for the employee's submission confirmation, then `sendHRNotification` for permission-filtered HR/admin recipients. Approval/rejection paths also await `notifyEmployee`. Notification history is persisted before provider dispatch, explaining why an in-app record can exist even when FCM rejects every token.

`notifyEmployee` resolves the canonical local employee/user association. FirebaseNotificationService looks up active FCMToken and Device registrations under that userId, unions and deduplicates the tokens, loads the established Firebase credential configuration, and awaits `sendEachForMulticast`. The FCM payload contains `notification.title` and `notification.body`; leave data fields, including notification ID, employee ID, action/leave ID, route, category and type, are strings.

The authorization filter in sendHRNotification still selects active HR/admin users with the existing role/user permission checks. This patch does not introduce tenant or role bypasses. The schema has no separate Firebase tenant/project model. The physical phone's current token/employee GUID do not match any records in the configured **local** database; this is not evidence about production registrations. No token was copied into another account and no production leave was created for testing.

## Confirmed defects corrected

1. HR leave dispatch used one multicast result to update every recipient's pending history record. One stale HR token could make another recipient's history FAILED/PARTIAL, and all recipients could receive the same provider message ID in history. It also matched pending rows by action fields rather than their exact newly created IDs. HR dispatch now reuses the existing per-user helper, preserving permissions and recording each exact recipient's own outcome.
2. The leave helper still used an outdated hardcoded exception list. The existing credential-file/project validation errors could be classified UNKNOWN even though the failure was established. It now uses the shared safe error classification and logs the original redacted code/message. A success response without a provider message ID is UNKNOWN, never SENT.
3. Leave FCM messages used general_notifications while the foreground handler selected leave_notifications. Both existed, but leave sends now consistently use leave_notifications, matching the existing Flutter leave channel.
4. The WebSocket callback read an envelope as a flat notification, and could display a local banner after the app was backgrounded. The callback now unwraps the payload, only displays while resumed, and shares notification IDs with FCM for existing deduplication. Android continues to display background/terminated notification payloads itself; the background handler does not create a second banner.
5. The previous leave test copied the helper implementation instead of importing production code. It now exercises the actual helper with mocked dependencies. New recipient-isolation coverage checks actual HR helper behavior.

These defects are confirmed from source and tests. They do not establish the Firebase error behind the original production zero-acceptance summary.

## Firebase and Android checks

- Existing Firebase initialization uses DefaultFirebaseOptions before runApp and registers the top-level, entry-point-marked background handler.
- Existing permission request and AndroidManifest POST_NOTIFICATIONS declaration remain intact. The physical device permission was granted.
- Existing foreground Firebase handler displays through flutter_local_notifications. Existing Android leave channel has high importance; successful notification posting confirms it is usable on this device.
- Selected local service-account JSON is readable, valid and belongs to quickboom-hrm. Android project is quickboom-hrm, sender 706418474557, package org.quickboom.hrm. Successful real FCM sends verify that local credential has sender access.
- The established loader supports FIREBASE_SERVICE_ACCOUNT_PATH. The local process actually selected GOOGLE_APPLICATION_CREDENTIALS. Neither this local success nor an SDK initialization alone proves the production FIREBASE_SERVICE_ACCOUNT_PATH points to an accessible file.
- No Docker, schema, notification API, authentication or Riverpod architecture changes were made for this task.

## Physical device evidence

The debug APK was built and installed with `adb install -r`, preserving existing app data. The final lifecycle run occurred after the installation returned Success. No app data was cleared and the account was not logged out.

Device: connected physical CPH2321, org.quickboom.hrm. The current token was used internally; only its fingerprint was inspected. For each state the existing FirebaseNotificationService sent a clearly labelled leave-payload test, returned accepted=1/rejected=0 with a real provider message ID, and Android notification-manager inspection found exactly one matching title/body record on leave_notifications.

| State | Test title | Real FCM message ID suffix | Android records |
| --- | --- | --- | --- |
| Foreground | HRM leave foreground 1792606564 | 0:1792606565237220%f01a3e83f01a3e83 | 1 |
| Background | HRM leave background 1792606564 | 0:1792606569676624%f01a3e83f01a3e83 | 1 |
| Terminated | HRM leave terminated 1792606564 | 0:1792606574504724%f01a3e83f01a3e83 | 1 |

All IDs have the prefix `projects/quickboom-hrm/messages/`. Termination used an app-owned process kill after backgrounding because Android's `am kill` left the process alive; process absence and forceStopped=false were verified before sending. Force-stop was not used. The app was reopened after testing.

These were real Firebase sends and real Android notification records, not mocked device delivery. They were controlled leave **payload** tests, not new leave submissions through the production leave API, and did not exercise production employee/token lookup. Duplicate simultaneous WebSocket+FCM transport was verified through shared IDs/source behavior, not a live production leave event.

The opt-in reusable script is `scripts/verify_android_leave_push.py`. Run it from the backend directory with the updated debug app installed, a connected authorized phone and valid local sender credentials. It sends three notifications and changes app lifecycle state; it does not submit business leave requests.

## Automated verification

Passed:
- Backend `npm run build`.
- `node scripts/test_leave_push_delivery.cjs`: actual production helper, eight subtests plus suite; acceptance/message ID, no devices, invalid token, missing configuration, transient exception, success without message ID, unreadable path and delivery-ack update fixture.
- `node scripts/test_leave_hr_recipient_outcomes.cjs`: actual HR helper; permission exclusion, string data, separate notification IDs and different successful/failed recipient outcomes.
- `node scripts/test_fcm_payload.cjs`: token union/deduplication, permanent-token cleanup, payload/channel, batching and unavailable sender.
- `flutter analyze`: no issues.
- `flutter build apk --debug`: passed. Flutter emitted an existing firebase_core Kotlin Gradle compatibility warning.
- Final physical-device lifecycle run: all three states accepted by Firebase, exactly one matching Android record each.

## Remaining production steps

Using the existing deployment workflow, deploy the backend change and app update. On the actual production host, use the existing safe diagnostics:

```bash
docker exec hrm-backend node dist/scripts/notificationPushDiagnostics.js --configuration
docker exec hrm-backend node dist/scripts/notificationPushDiagnostics.js --recent-failures
docker exec hrm-backend node dist/scripts/notificationPushDiagnostics.js --employee-code EMPLOYEE_CODE
```

Inspect `[FirebaseNotificationService] FCM rejected device` for the exact original SDK code and redacted message, correlated by notification ID. Verify the current phone token fingerprint is active under the correct production user and employee before a controlled leave submission. Check acceptance and the tray on the intended employee and authorized HR test account.

If FIREBASE_SERVICE_ACCOUNT_PATH is set, its path must be readable **inside** hrm-backend. A host-only path does not satisfy this. Existing Docker deployment files do not declare a secret-file mount. If the file is absent, use an already available container secret path, or the already supported FIREBASE_SERVICE_ACCOUNT_JSON in the existing backend runtime env file and remove stale path overrides. Recreate the container through the established workflow. No Docker source change is required for the JSON-env alternative. Do not commit or paste credentials. See production-fcm-failure-diagnostics.md for error-specific configuration fixes.
