# RKD duplicate submission and socket authentication

## Findings and behavior

- `POST /api/employee/rkd` rejects a nonempty sale reference already used by the same employee in PENDING or APPROVED state. A different requestId does not change that rule. Rejected/returned references retain the previous workflow's behavior.
- The reference is optional external sale/invoice identification, not the particulars/description field. There is no invoice foreign key or invoice verification API in this RKD workflow. No new requirement to select an internal invoice, invented reference format, or change in uniqueness scope was introduced. The form explains the distinction.
- requestId is already persisted as an employee-scoped SHA-256 submissionKey with a unique Prisma/database index. Exact replay returns the original result; changed payload with the same key returns 409. No migration is necessary.
- Previously, each new invocation generated a fresh ID, and ApiException validation messages became generic network errors in the view model. The provider now retains IDs per normalized payload while an outcome is uncertain, handles ApiException messages separately, and keeps the in-progress guard active through the history refresh. The form is disabled during submission and offers an owner-authorized details link on duplicate-reference errors.
- Successful form reset starts a new submission; other uncertain payloads retain their IDs. IDs are retained in the provider for the app session, not across process termination. The backend remains the authoritative idempotency store.
- A transaction-scoped advisory lock serializes submissions per employee/reference, closing the prior check/create race without changing schema or deleting existing data. Submission notifications still occur only on creation after commit.
- HTTP API calls already retry only once following successful 401 refresh; 400 is not automatically retried.

## WebSocket diagnosis and changes

Socket.IO expects `auth: {token: <raw access JWT>}`; a Bearer-prefixed value is invalid. HTTP and socket verification use the same backend verifyToken helper. The client previously reused a stored JWT without checking expiration or refreshing after rejection. The old server message hid whether the JWT was expired, invalid, or verification failed for another reason. These are code findings; the affected device's live token was not available and was not logged.

The client checks JWT expiration solely to decide whether to refresh; the server still verifies signatures, expiry and active accounts. The existing HTTP refresh operation is shared with sockets and deduplicated across concurrent refresh callers. Transport retries re-read the current token. Authentication rejection allows one refresh attempt, reconnects only after successful refresh, and stops on repeated rejection or inactive account. Explicit disconnect invalidates pending reconnects. Error logs omit handshake contents and raw tokens; server rejection codes distinguish TOKEN_EXPIRED, AUTH_INVALID, AUTH_REQUIRED, ACCOUNT_INACTIVE and AUTH_UNAVAILABLE.

## Verification

- `npm run build`: passed.
- `node scripts/test_rkd_submission_route.cjs --compiled`: real local HTTP routing/auth/controller/service, mocked DB/FCM; new valid requests, duplicate reference and owner request ID, same-key replay, changed-payload conflict, parallel competing references and parallel same-key retries, validation and failed persistence.
- `node scripts/test_rkd_workflow.cjs`: eight existing workflow scenarios passed, including approval/rejection and duplicate salary/notification prevention.
- `node scripts/test_websocket_auth.cjs`: real Socket.IO protocol over WebSocket with temporary test JWT key and mocked user lookup; valid, expired, invalid, missing, Bearer-prefixed, inactive-account tokens, and valid reconnection passed.
- Flutter tests cover provider double-tap protection, timeout retry retaining IDs even after edits, permanent validation error display/no retries, existing details loading, successful form reset, required input validation, token expiry refresh, refresh failure and malformed tokens. Existing timestamp, navigation, payroll/wallet regressions also pass.
- No production connection, database migration/data mutation, deployment or service restart was performed. Actual PostgreSQL advisory-lock contention is modeled in the HTTP test, not exercised against a live database. Physical Android interaction and the affected production session remain unverified.

## Files changed for this fix

Backend:
- `src/controllers/rkdController.ts`
- `src/services/rkdNotificationWorkflow.ts`
- `src/services/websocketService.ts`
- `scripts/test_rkd_submission_route.cjs`
- `scripts/test_websocket_auth.cjs`
- `docs/rkd-submission-and-socket-auth.md`

Flutter:
- `lib/core/services/api_service.dart`
- `lib/core/services/socket_authentication.dart`
- `lib/core/services/websocket_service.dart`
- `lib/features/rkd/presentation/providers/rkd_viewmodel.dart`
- `lib/features/rkd/presentation/screens/rkd_form_view.dart`
- `test/rkd_submission_test.dart`
- `test/socket_authentication_test.dart`

Flutter command: `flutter test test/rkd_submission_test.dart test/socket_authentication_test.dart test/rkd_timestamp_test.dart test/rkd_notification_navigation_test.dart test/rkd_payroll_wallet_test.dart` — 23 passed. Targeted Flutter analysis passed with no issues.
