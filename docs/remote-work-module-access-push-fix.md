# Remote work and module access push notification fixes

## Findings

Remote work submission sent directly to HR only, without a database notification or standard type/category/route fields. Employee decisions were saved first, but repeated reviews sent again, only numeric employee references were handled, and rejection text omitted the date range. The nonstandard click_action did not match Android's registered FLUTTER_NOTIFICATION_CLICK intent. Flutter also evaluated ATTENDANCE before REMOTE_WORK, sending an otherwise well-formed remote notification to attendance. HR remote notifications opened personal history because there was no mobile approval destination.

Module access had four submission implementations and two review implementations. The main access-requests API created no submission notification. Other submission APIs sent directly to selected roles without per-recipient history or delivery outcomes. The alternate review API saved APPROVED before granting FeatureAccess. The main approval API swallowed feature-grant errors and could approve an unlinked employee without granting user permissions; it attempted unsafe account linking by partial email. Review retries repeated pushes. The alternate feature controller used a legacy sender that omitted Device registrations and deactivated tokens on every provider error, including credential/transient failures.

The remote/feature reviewer routes checked authentication but lacked reviewer role/module authorization. Notification recipient filtering and review authorization now use the same roles and module permission policy.

## Behavior implemented

- All events use the existing notifyEmployee/sendHRNotification flow: database records, safe provider diagnostics, FCM message IDs, status persistence, and standard payload/navigation fields.
- Remote submissions serialize overlap checks and writes per employee, exclude the requester from approver recipients, include name/date range/reference, and notify only after commit. Repeated decisions claim their expected status once. Rejected requests can still resubmit in place; the persisted appliedOn marks the submission round so old notifications do not suppress new-round events. Revocation remains supported from APPROVED.
- The existing workflow has no assigned approver field or manager-specific remote/module review queue. Submission notifications target active SUPER_ADMIN, PLATFORM_ADMIN, ADMIN and HR reviewers allowed pa-remote-work or pa-access-requests, excluding the requester. This preserves the admin approval workflow rather than inventing a reporting-manager assignment.
- Existing module submission APIs share one implementation and serialize the pending check/create. All existing response shapes retain requestId/data; failed submissions dispatch nothing. Missing employee profiles are rejected rather than substituting a user ID for an employee ID.
- Both module review APIs share a PENDING status claim. The main module workflow commits UserPermission, FeatureAccess and request approval together. The legacy feature-window workflow commits FeatureAccess and approval together, retaining its requested date/time bounds without creating a permanent UserPermission override. Grant failures roll back the approval. Missing linked user accounts must be fixed explicitly before approval; no partial-email auto-linking occurs. Rejection does not grant access.
- Repeat reviews return the existing result; conflicting decisions return 409. Existing notifications are deduplicated using existing rows and transaction locks, without new database fields.
- Existing remote review/list and module review/list/direct-grant routes now require the appropriate approver roles and module permissions. No new APIs were added.
- Flutter handles remote/module events before broad attendance/employee categories. Submission taps open the referenced request in a small approval screen using the existing APIs. Decision taps open personal remote history or current module-access state, including when the requester is an HR user. Foreground remote messages use the existing attendance channel. Module access uses the existing general channel.

## Files changed for this task

Backend:
- src/controllers/remoteWorkController.ts
- src/controllers/accessRequestController.ts
- src/controllers/featureAccessController.ts
- src/controllers/mobile/mobileFeatureAccessController.ts
- src/controllers/permissionController.ts
- src/routes/remoteWorkRoutes.ts
- src/routes/accessRequestRoutes.ts
- src/routes/featureAccessRoutes.ts
- src/utils/hrNotificationHelper.ts
- src/utils/requestApprovalPermissions.ts
- scripts/test_remote_module_notifications.cjs

Flutter:
- lib/core/services/notification_service.dart
- lib/features/notification/presentation/screens/request_notification_destination.dart
- test/remote_module_notification_navigation_test.dart

## Verification performed

- Backend tsc --noEmit passed on the final workspace. An intermediate run encountered three unrelated RKD parameter typing errors; those were resolved by other workspace activity, not by this task.
- scripts/test_remote_module_notifications.cjs passed with mocked database/FCM, covering the six requested events independently, all four submission aliases, both review APIs, exact recipients, names/date/module/reference payloads, database records/provider IDs, concurrent/repeated retries, resubmission, failed submissions/reviews, grant rollback, unlinked users, denied reviewers, and retained mismatched-credential failure codes when zero device messages are accepted.
- Existing attendance/payroll, expense, FCM payload and FCM failure diagnostic regression scripts passed.
- Flutter notification navigation tests passed: 20 tests across remote/module, payroll, leave and expense destinations. These verify destination selection and references, not actual Android taps or live approval HTTP traffic.
- Flutter analysis of the notification service, new screens and navigation test: no issues.
- Source inspection confirmed Firebase initialization, token registration/refresh, Android POST_NOTIFICATIONS permission, existing channels, foreground local notification handling, background notification payload display and cold-start tap handling. No duplicate background local notification was added.
- Existing read-only Firebase configuration diagnostic passed locally: RSA credentials parse, initialization succeeds, and backend/Android project is quickboom-hrm. This does not verify Firebase API authorization or a recipient's token project.
- Existing read-only recent-failures database diagnostic returned ECONNREFUSED. Recipient token registrations and the historical zero-acceptance provider error could not be inspected. No real FCM sends were attempted.
- ADB devices -l returned an empty device list. No Android device was available for tray/tap verification.

## Remaining end-to-end verification

| Scenario | Expected recipient/event | Still needs live verification |
| --- | --- | --- |
| Remote submitted | Authorized remote-work reviewers, excluding requester; REMOTE_WORK_REQUEST | Actual DB recipients, recipient registrations, FCM acceptance/failure, Android tray and referenced approval tap |
| Remote approved | Requesting employee; REMOTE_WORK_APPROVED after save | DB outcome, FCM response, tray and personal history tap |
| Remote rejected | Requesting employee; REMOTE_WORK_REJECTED with dates after save | Same, including repeated review and rejected-request resubmission |
| Module requested | Authorized access-request reviewers, excluding requester; ACCESS_REQUEST_SUBMITTED | DB outcome, FCM response, tray and exact request tap for every API alias |
| Module approved/granted | Requesting user; ACCESS_REQUEST_APPROVED after actual grant commits | Real transaction rollback/concurrency, granted permission/feature state, tray and current access screen |
| Module rejected | Requesting user; ACCESS_REQUEST_REJECTED after save, no grant | DB outcome, FCM response, tray/access screen and retry behavior |

Repeat each with Android foreground, background and terminated launch, with Android 13 permission/channel settings checked. Force-stopped apps require reopening before normal FCM delivery resumes. Inspect notification deliveryStatus/fcmMessageId/failureReason and safe per-device SDK diagnostics, without printing raw tokens. Tokens are opaque: their project cannot be established from the string alone; inspect client configuration and a real provider send.

Database creation, FCM acceptance and device display are separate outcomes. SENT means provider acceptance, not confirmed tray display. The prior live zero-acceptance report remains unresolved until the database/provider evidence is reachable.

The existing architecture still has a crash window after business commit and before notification creation/send. Deduplication does not automatically resend existing FAILED/PENDING/UNKNOWN rows or guarantee exactly-once delivery. No new notification architecture, schema, Docker/deployment settings, production writes, production restart or deployment was introduced.
