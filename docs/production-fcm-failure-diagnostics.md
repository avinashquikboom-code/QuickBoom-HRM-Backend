# FCM rejection investigation — 21 October 2026

## Confirmed evidence and production limitation

The reported aggregate (one saved notification, zero accepted device messages, one failed recipient, zero unknown outcomes and zero device-less recipients) is a known provider/configuration rejection. It does not identify the Firebase error code. The running production container, its credential path, and its failed recipient's registration have **not** been inspected: the configured SSH alias points to 13.202.136.71 and timed out. The API currently resolves to 69.62.80.20, so that alias does not identify the API host. No production deployment or configuration change was made. The production root cause remains unconfirmed until the actual error is obtained from that host.

The code previously swallowed credential initialization errors, cached a mock Firebase app, and converted the original cause to `messaging/not-configured`. Per-device Firebase responses retained codes for history but did not log the provider message. These are confirmed diagnostic defects, not proof of a particular production credential/token failure.

## Pipeline traced

1. Existing HR/admin send controllers resolve active employees and their canonical local `Employee.userId`. `persistAndPush` deduplicates those recipients, creates a PENDING Notification and awaits `FirebaseNotificationService.sendNotificationToUser`.
2. That sender unions active `FCMToken.token` and `Device.fcmToken` rows using the same userId, removes duplicates and batches up to 500 tokens. A record in either store explains why “no registered devices” may be zero even when Firebase rejects all tokens.
3. The authenticated `/api/devices/register` upserts Device, synchronizes FCMToken ownership and retires the previous installation token. Recipient identity is the application's local integer Employee/User association, not the upstream HopKid GUID. The schema has employee office/branch relations, but no independent FCM tenant/project association; this app uses the quickboom-hrm Firebase project. No tenant model, audience expansion or duplicate API was added.
4. `src/config/firebase.ts` initializes one Firebase Admin app. Its credential loader reads FIREBASE_SERVICE_ACCOUNT_PATH first, then GOOGLE_APPLICATION_CREDENTIALS; absent either explicit path it checks established default files, JSON env and the three individual env fields. Paths resolve in the backend process working directory. An explicit inaccessible/invalid path now fails with the original precise error instead of falling back silently.
5. The actual provider call is `getMessaging(app).sendEachForMulticast`. Per-device errors now log code, redacted message, category, notification ID and a SHA-256 token fingerprint. Only permanent invalid/unregistered token errors deactivate/delete registrations. Credential/project/permission/transient errors retain registrations.
6. Notification history and existing API summaries retain actual Firebase acceptance counts. Known configuration/credential/permission exceptions are FAILED; an uncertain transport exception is UNKNOWN. SENT still means provider acceptance, not device delivery. The existing `/api/devices/test-push` also now returns zero acceptance and failure when Firebase rejects a send, rather than always claiming it was sent. Employee test sends are restricted to their own account.

## Credential/project checks actually performed

The local JSON credential file is readable, valid service-account JSON, and contains a valid RSA private key. Its project is `quickboom-hrm`, matching:

- Android `google-services.json`: project `quickboom-hrm`, sender ID `706418474557`, package `org.quickboom.hrm`.
- The backend's real Firebase response: `projects/quickboom-hrm/messages/...`.

The local process selects GOOGLE_APPLICATION_CREDENTIALS; FIREBASE_SERVICE_ACCOUNT_PATH is not set locally. Its file-loading behavior was tested separately with generated test keys. This does **not** certify the production variable or file. Credential fields and raw device tokens were not printed or committed.

## Real Android test

A connected CPH2321 running org.quickboom.hrm supplied its current cached FCM token internally via ADB. Only its fingerprint (`cb710c84f6bec40c`) was printed. The existing backend initialized the configured credential and Firebase accepted a validation-only request. That response used `fake_message_id`, which was not counted as a delivered/real message.

The existing `sendPush` helper then sent one real labelled test notification:

- Title: Quickboom FCM verification
- Body: Android test device push verification
- Real FCM acceptance ID: `projects/quickboom-hrm/messages/0:1792605260272585%f01a3e83f01a3e83`
- A subsequent Android notification-manager inspection found that title and body under org.quickboom.hrm on `general_notifications`.

Thus real FCM acceptance and notification posting on this test phone succeeded from the local backend credential. This bypassed production recipient lookup and does not establish that the failed production recipient has the same token or that production is repaired. The app was not reset, reinstalled or logged out. System-tray tapping and every foreground/background/terminated lifecycle were not tested in this run.

## Safe production diagnosis

After deploying this code through the existing workflow, run these read-only commands in the existing backend container:

```bash
docker exec hrm-backend node dist/scripts/notificationPushDiagnostics.js --configuration
docker exec hrm-backend node dist/scripts/notificationPushDiagnostics.js --recent-failures
docker exec hrm-backend node dist/scripts/notificationPushDiagnostics.js --employee-code EMPLOYEE_CODE
```

The first reports selected source, resolved path, readability/JSON/key validation, project comparison and initialization error. It does not authenticate to Firebase; use real acceptance to verify that. The second reports recent notification IDs, recipient IDs and stored failure codes without printing notification content or tokens. The third correlates active employee/user association with token fingerprints in both stores. After one controlled retry to that test employee, look for `[FirebaseNotificationService] FCM rejected device` in container logs for the exact original SDK code and redacted message.

## Exact configuration fixes, conditional on the observed error

- `firebase/credential-file-unreadable`: FIREBASE_SERVICE_ACCOUNT_PATH must name a readable **container** path, not just a host path. For an already mounted file at `/app/secrets/firebase-service-account.json`, set `FIREBASE_SERVICE_ACCOUNT_PATH=/app/secrets/firebase-service-account.json` in the existing backend runtime environment. First verify that exact path exists/readable inside the running container. Do not assume a file is included because it exists on the host.
- Existing Dockerfile.deploy copies dist and dependencies to its production stage, but does not copy secret files; existing deploy scripts/compose supply env files and do not declare a secret-file mount. If no runtime mount exists, the supported configuration-only alternative is to remove stale FIREBASE_SERVICE_ACCOUNT_PATH and GOOGLE_APPLICATION_CREDENTIALS entries and set FIREBASE_SERVICE_ACCOUNT_JSON to the valid **single-line** JSON for quickboom-hrm in the existing backend.env. JSON private-key newlines must remain escaped as `\n`. Recreate the container through the existing workflow to apply env changes. Do not put the key in chat, source control, an image, or command-line arguments. No Docker source change is needed for this alternative.
- `firebase/credential-json-invalid`, `firebase/credential-fields-invalid`, `firebase/credential-key-invalid`: replace the selected secret with an intact valid service-account JSON for quickboom-hrm. Do not put a Firebase client config/google-services.json in place of a service-account credential.
- `firebase/project-mismatch` / `messaging/mismatched-credential`: compare selected sender project with the Android build's quickboom-hrm project. Correct the selected sender secret. If the installed build previously used a different project, obtain its current token and register it through the existing authenticated device endpoint; do not delete tokens merely because the sender is misconfigured.
- `app/invalid-credential`, `messaging/authentication-error`: inspect the redacted message for an expired/revoked/invalid signing key or OAuth failure; install a valid key for the same project and restart using the established workflow.
- `messaging/insufficient-permission`: verify the selected service account is authorized to send FCM messages in quickboom-hrm and that the Firebase Cloud Messaging API is enabled. Do not grant broad administrative roles to work around a path/token problem.
- `messaging/registration-token-not-registered` / `messaging/invalid-registration-token`: retire only the rejected registration. Reopen/sign in on the test Android installation and verify its new token registers to the correct authenticated user through the existing endpoint. A backend secret change does not repair an invalid device token.
- transient network/rate/server errors: preserve registrations, inspect outbound DNS/TLS/connectivity and provider status, then retry with backoff when appropriate. An uncertain transport exception is not proof of acceptance and is not automatically retried by this patch.

## Validation

Passed:

- `npm run build`.
- `node scripts/test_fcm_configuration.cjs`: explicit path resolution/precedence, missing file, JSON/key validation, project mismatch, env compatibility, safe message redaction and failure classification.
- `node scripts/test_fcm_failure_diagnostics.cjs`: original configuration errors survive, rejected tokens count zero acceptance, logs contain redacted diagnostics, only invalid/unregistered registrations are removed.
- `node scripts/test_device_push_outcome.cjs`: existing test API reflects rejection, missing devices, acceptance and configuration errors; employee cannot target another user.
- `node scripts/test_fcm_payload.cjs`: token-store union, batching, payload/channel and invalid-token cleanup.
- `node scripts/test_push_delivery.cjs`: 13 existing flow checks.
- `node scripts/test_push_diagnostics.cjs`: read-only diagnostics and secret exclusion.
- `node scripts/test_device_registration.cjs`: existing ownership/rotation/logout behavior.
- Real FCM validation, real accepted push and matching Android notification-manager record as described above.

No schema, Firebase client configuration, duplicate notification API or Docker deployment source changes were made. Production runtime verification and the failed recipient's exact error remain blocked on the actual production host/access and recipient identification.
