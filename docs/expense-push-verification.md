# Expense submission and review push notifications — 22 October 2026

## Confirmed root causes

1. `createEmployeeExpense` persisted a claim and returned without notifying any approver.
2. HR approval/rejection called Firebase directly rather than the shared persistence-and-delivery helper. They did not create notification history, discarded the provider result, and swallowed FCM errors. A successful expense review therefore did not establish successful push.
3. Review updates were unconditional, so a retried or concurrent request could send the same decision repeatedly.
4. Expense payloads used expenseId, while the Flutter resolver ignored that field and opened a generic expense view without selecting the claim.
5. The shared route/permission mapping did not classify EXPENSE. The existing finance/expense approval module is pa-payroll (`HRM-Admin-Pannel/src/lib/roleAccess.ts`), not a new expense permission. Existing review APIs permit HR/admin roles; the Expense model has no assigned manager/team-leader approval field. The fix preserves that workflow instead of inventing a new audience.

The earlier **production** zero-acceptance error is still not identified: the production runtime/logs were not available. The exact error observed in the controlled malformed-token test below is not substituted for that historical production failure.

## Implementation

- Submission calls the existing permission-filtered HR notification helper only after the expense insert commits. It includes employee name, amount, category and claim ID. A failed insert/rollback does not dispatch. Recipients with pa-payroll denied are excluded.
- Approval/rejection use an atomic compare-and-set status transition and call notifyEmployee after the committed update, using Expense.employee.userId. Existing receipt generation remains intact. Same-status retries skip dispatch; concurrent stale updates cannot both claim the same transition.
- Shared helpers persist PENDING then record SENT/PARTIAL/FAILED/UNKNOWN/IN_APP_ONLY with provider IDs/error codes. Existing responses retain their fields and add notificationDelivery. Business success is separate from FCM acceptance and physical device delivery.
- EXPENSE maps to /expenses and pa-payroll. Payloads include string actionId/entityId/expenseId, status and amount; the actual FCM message includes notification title/body. The existing general_notifications Android channel is used by backend and Flutter expense handling.
- Flutter now reads legacy expenseId as well as actionId/entityId. Employee/HR views accept a validated claim ID, highlight the matching authorized card and scroll it into view. Missing/unavailable IDs remain on the existing overview. No API is added for looking up another employee's expenses.
- Firebase credentials and Android project remain quickboom-hrm. The local process used the existing GOOGLE_APPLICATION_CREDENTIALS file. FIREBASE_SERVICE_ACCOUNT_PATH remains supported and validated by the shared loader; production path accessibility remains unverified.
- Firebase sometimes returns messaging/invalid-argument for a malformed registration token. Only the exact observed provider message `The registration token is not a valid FCM registration token` now qualifies that code for permanent-token cleanup. Other invalid-argument payload/configuration errors do not retire registrations. Invalid/unregistered token codes continue to clean both stores; credential/permission/transient failures preserve tokens. Logs use safe messages and token fingerprints, never full tokens/keys.

## Necessary schema change and rollout

Durable submission retry protection requires identifying an operation independently of claim content. Deduplicating by amount/date/description would incorrectly merge legitimate identical expenses; an in-memory cache would fail across processes/restarts. Therefore one optional unique Expense.submissionKey was added, with migration `20261022000100_expense_submission_key`. It stores a SHA-256 hash scoped to the authenticated employee and client request ID. Existing rows remain valid with NULL keys.

Flutter generates a request ID, retains it for retrying the same unsuccessful submission, and clears it after a successful response. The API also accepts Idempotency-Key. Reusing a key with different category/amount/date/description returns 409; replaying the same operation returns the existing claim and does not notify again. Older callers omitting a key remain compatible, but cannot obtain durable retry protection; update them to send a stable key per logical submission.

**The migration was prepared and validated only in a disposable test schema. Public/local application tables and production schema were not altered. Apply the migration through the existing Prisma migration workflow before deploying the updated backend.** Docker/deployment source settings were not changed.

This is at-most-once dispatch per claimed operation, not a durable notification outbox. A server crash after claim/status commit but before dispatch still requires inspecting history and making an explicit controlled notification retry; repeating a successful expense operation does not blindly resend.

## Four cases: real APIs, isolated PostgreSQL, real Firebase, physical Android

`scripts/verify_expense_device_flow.cjs` ran actual authenticated Express routes with application-issued test JWTs, real Prisma/PostgreSQL and real Firebase Admin sends. Database access was bound to a disposable schema with cloned table structures, its own sequences, its own Role enum, and the actual new migration. The existing authenticated device registration API registered the phone sequentially to isolated fixture accounts for each role. This did not change production registrations or the phone's stored login.

Fixture owner: employee 50/user 100. Authorized HR approver: user 900. HR user 901 had pa-payroll denied and was excluded. One physical CPH2321 was used sequentially for the approver and owner device roles. This is a controlled local integration environment, not evidence of the current production account mapping.

| Case | API tested | Intended recipient | Database result | FCM result | Android tray | Navigation result |
| --- | --- | --- | --- | --- | --- | --- |
| Submission | POST /api/employee/expenses | Authorized HR 900; not owner 100 or denied HR 901 | Expense committed; one HR notification SENT; same request key returned the same claim without a second notification | accepted=1, rejected=0; real ID below | Exactly one matching Expense Claim Submitted record on general_notifications, app backgrounded | HR destination/claim selection unit test passed; physical HR tap not verified |
| Approval | POST /api/hr/expenses/:id/approve | Submitting owner 100, not reviewer 900 | APPROVED committed; owner notification SENT with provider ID; retry produced no second owner notification | accepted=1, rejected=0; real ID below | Exactly one matching Expense Claim Approved record, app backgrounded | Owner destination/claim selection unit test passed; physical matching-claim detail not verified |
| Rejection | POST /api/hr/expenses/:id/reject | Submitting owner 100, not reviewer 900 | REJECTED committed; owner notification SENT with provider ID | accepted=1, rejected=0; real ID below | Exactly one matching Expense Claim Rejected record, app backgrounded | Owner destination/claim selection unit test passed; physical matching-claim detail not verified |
| FCM failure | POST /api/hr/expenses/:id/approve after registering a deliberately malformed fixture token | Owner 100 | Approval committed; owner notification FAILED, failureReason=messaging/invalid-argument, fcmMessageId=NULL; malformed Device removed and FCMToken deactivated | accepted=0, rejected=1; actual SDK message: The registration token is not a valid FCM registration token | No valid device targeted; no delivery claimed | Not applicable to a rejected send |

Final real message IDs (all prefixed by `projects/quickboom-hrm/messages/`):
- Submission: `0:1792608903913169%f01a3e83f01a3e83`
- Approval: `0:1792608907449127%f01a3e83f01a3e83`
- Rejection: `0:1792608912675489%f01a3e83f01a3e83`

The final integration run verified malformed-token removal from both stores. All temporary schemas, claims, histories and registrations were removed afterward. No production data was cleared. Expense receipt PDF generation was stubbed in this test so it created no PDF files; the production receipt code was preserved.

## Android/lifecycle/navigation validation

- Firebase initialization, top-level background handler, Android 13+ permission request, existing token-refresh registration and foreground flutter_local_notifications handling were inspected and preserved. The physical POST_NOTIFICATIONS permission was granted.
- The updated APK built and was installed with adb install -r, preserving app data.
- All three real API-driven successful cases above posted one Android notification while backgrounded.
- An additional foreground EXPENSE_APPROVED payload was accepted with real ID `projects/quickboom-hrm/messages/0:1792609003759592%f01a3e83f01a3e83` and produced exactly one matching local notification on general_notifications.
- A fresh terminated-state test was attempted, but process termination could not be certified (run-as kill returned unknown PID while pidof still reported a process). No force-stop or data clear was used, and no terminated-state success is claimed.
- All three expense navigation unit tests passed: approver screen with claim ID; owner screen with claim ID for approval/rejection; invalid/missing IDs falling back safely.
- Physical tray-tap attempts eventually located a rejection entry, but the grouped notification panel remained open and My Expenses was not verified. Exact fixture-claim detail navigation is unverified. The phone still points at production for reads, while fixture claims existed only in the temporary local schema, so those fixtures cannot be presented as real production claim details.

## Automated tests and files

Passed:
- npm run build and tsc --noEmit.
- Flutter analyze: no issues.
- flutter test test/expense_notification_navigation_test.dart: 3 passed.
- flutter build apk --debug: passed; existing firebase_core Kotlin Gradle compatibility warning only.
- scripts/test_expense_notification_flow.cjs: actual controllers/shared workflow with mocked DB/FCM; submission audience/permission, sequential and concurrent keyed retries, key conflict, failed insert with no notification, approval/rejection owner targeting, committed state/history, repeated/concurrent review deduplication and accurate FCM rejection.
- scripts/verify_expense_device_flow.cjs: real API/DB/Firebase/Android integration described above.
- scripts/test_fcm_failure_diagnostics.cjs and test_fcm_payload.cjs: safe errors, permanent-token-only cleanup, no acceptance on rejection, batching and token-store union.
- scripts/test_fcm_configuration.cjs and test_push_diagnostics.cjs: credential source/path/project validation and secret-safe diagnostics.
- scripts/test_leave_hr_recipient_outcomes.cjs: existing helper behavior still passes after adding returned dispatch outcomes.

Backend files:
- prisma/schema.prisma
- prisma/migrations/20261022000100_expense_submission_key/migration.sql
- src/services/expenseNotificationWorkflow.ts
- src/controllers/employee/employeeController.ts
- src/controllers/hr/hrController.ts
- src/utils/hrNotificationHelper.ts
- src/utils/fcmErrors.ts
- src/services/firebaseNotificationService.ts
- scripts/test_expense_notification_flow.cjs
- scripts/test_fcm_failure_diagnostics.cjs
- scripts/verify_expense_device_flow.cjs
- docs/expense-push-verification.md

Flutter files:
- lib/features/expense/presentation/providers/expense_viewmodel.dart
- lib/features/expense/presentation/screens/employee_expenses_view.dart
- lib/features/expense/presentation/screens/hr_expenses_view.dart
- lib/features/expense/presentation/screens/expense_notification_destination.dart
- lib/core/services/notification_service.dart
- test/expense_notification_navigation_test.dart

## Remaining production verification

Apply the prepared migration, then roll out through the existing workflow. On the actual production host, inspect the established read-only notificationPushDiagnostics --configuration / --recent-failures / --employee-code commands and correlate the exact Firebase error with the failed production notification ID. Verify the selected service-account path is readable inside the runtime and belongs to quickboom-hrm, and that the current installation token is active under the intended user. No original-production error or production repair is claimed from these controlled tests.

Then use controlled production test accounts to submit, approve and reject a claim and physically tap each notification while signed into the intended role. Verify exact claim selection and supported terminated behavior before declaring the entire production issue resolved. No Docker or deployment-setting change is required by this patch.
