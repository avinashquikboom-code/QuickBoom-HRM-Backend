# Leave approval push flow — findings and verification

## Confirmed source causes

- Mobile approval (`POST /api/mobile/leave/hr/:id/approve`) and HR approval (`POST /api/hr/leaves/:id/approve`) already called the employee helper. They did not skip same-status retries and used unconditional updates, so retries/concurrent approvers could create duplicate history, sends and side effects. Mobile approval also invoked the balance deduction twice on initial approval.
- Admin status review launched notifyEmployee without awaiting it. A successful approval response did not establish that notification persistence or provider dispatch had completed.
- Policy auto-approval created an in-app Notification and broadcast a WebSocket update but never invoked FCM. This is a genuine missing-trigger path for outside-app delivery.
- The original production zero-acceptance failure is not diagnosed by these findings: its exact Firebase error and selected production credential/token require access to that production runtime. No production deployment was performed.

## Changes

`src/services/leaveReviewTransition.ts` uses a transaction and a status compare-and-set. The existing mobile/HR approve/reject controllers use it so only the winning state change executes side effects. Sequential same-status retries return success without sending again; conflicting concurrent decisions do not overwrite a newer review. Cancelled records cannot be reviewed. Admin review now uses an equivalent compare-and-set inside its existing balance/attendance transaction. No schema or unique-index change was required.

The mobile duplicate balance deduction was removed. Mobile approval titles now say Leave Request Approved and include dates. HR approval/rejection payload types consistently identify the decision, while retaining actionId as the actual leave ID.

Auto-approval now uses the existing notifyEmployee helper and awaits FCM. Admin review awaits that helper too. The helper returns its saved notification ID, deliveryStatus, provider message ID and failure code. Existing approval APIs retain their existing approval response and add notificationDelivery, distinguishing successful business approval from FAILED/UNKNOWN push delivery. No response claims FCM acceptance just because approval succeeded.

The existing Firebase initialization, credential-path support, per-user active token union, safe provider error logging, invalid-token cleanup and leave_notifications channel remain shared. Only invalid/unregistered tokens are removed; credential/permission/network failures retain registrations. No tokens, keys or credentials were printed. FIREBASE_SERVICE_ACCOUNT_PATH support is verified in code/tests, but the local sender selects GOOGLE_APPLICATION_CREDENTIALS; production file existence and project alignment remain unverified. Local credential/Android app both use quickboom-hrm and actual successful sends verify local sender access.

Existing Flutter initialization, Android permission request, registered background handler and foreground local notification handling were inspected and retained. Background notification payloads use Android's system display, avoiding a second local banner. The leave resolver now validates positive integer IDs before passing them to the existing employee/HR leave views. Those views fetch authorized records and highlight initialLeaveId; invalid destinations fall back to the overview. Authentication and Riverpod remain intact.

## Changed files for this approval task

Backend:
- src/services/leaveReviewTransition.ts (new)
- src/controllers/mobile/mobileLeaveController.ts
- src/controllers/hr/hrController.ts
- src/controllers/adminController.ts
- src/services/leaveManagementService.ts
- src/utils/hrNotificationHelper.ts (additive dispatch result)
- scripts/test_leave_approval_flow.cjs (new)
- scripts/test_leave_review_transition.ts (new)
- scripts/verify_android_leave_push.py (process-exit race handling in existing device test)
- docs/leave-approval-push-fix.md (this report)

Flutter:
- lib/core/services/notification_service.dart (leave destination delegation)
- lib/features/leave/presentation/screens/leave_notification_destination.dart (new)
- test/leave_notification_navigation_test.dart (new)

Earlier leave notification/channel/WebSocket edits remain present and were preserved. Docker files, deployment settings, database schema and production data were not modified.

## Actual tests

Passed:
- Backend npm run build.
- scripts/test_leave_approval_flow.cjs imports actual mobile, HR and admin controllers, transition helper and notifyEmployee with mocked DB/FCM. It covers six approval/rejection paths; intended employee user 100 rather than approver 900; awaited provider response; database history/provider ID; retry deduplication; one balance deduction; concurrent mobile/HR approval; rejected FCM token; unreadable credential error; and auto-approval now sending once. These tests are not real production sends or real leave API network requests.
- scripts/test_leave_review_transition.ts against the actual local PostgreSQL database: temporary leave creation, two concurrent approvals with exactly one winning transition, persisted APPROVED status/reviewedAt and a stale rejection that cannot overwrite it. The fixture was deleted. No employee balance/attendance was changed and no existing leave record was modified.
- Flutter analyze: no issues.
- flutter test test/leave_notification_navigation_test.dart: all three tests passed for employee leave selection, HR selection and invalid/missing IDs. These test destination construction; they do not prove a physical tap opened a real record.

Physical CPH2321 tests sent clearly labelled LEAVE_APPROVED notification payloads through the existing FirebaseNotificationService to the phone's cached token. They did not create or approve production leave records or verify production recipient lookup.

| State | Real FCM ID (under projects/quickboom-hrm/messages/) | Tray result |
| --- | --- | --- |
| Foreground | 0:1792607160463120%f01a3e83f01a3e83 | Exactly one matching approval test notification, leave_notifications |
| Background | 0:1792607163638052%f01a3e83f01a3e83 | Exactly one matching approval test notification, leave_notifications |
| Terminated | No new approval send certified | Test stopped because the app process remained present |

Android POST_NOTIFICATIONS was granted. The foreground/background messages returned accepted=1, rejected=0 and a real message ID. Terminated-state attempts were not counted as successful: run-as process termination reported unknown PID and process absence could not be certified. Force-stop/data reset was not used. Earlier generic leave-payload terminated tests passed (see android-leave-push-verification.md); that evidence is not substituted for a fresh approval test.

## Limits and next production verification

This change prevents duplicate dispatch from ordinary endpoint retries/concurrent reviews; it is not a durable outbox or a guarantee of exactly-once delivery across a server crash between the review transaction and notification dispatch. It deliberately does not auto-resend on an approval retry, which could duplicate an ambiguously accepted message. Existing explicit notification APIs remain available for controlled retries after inspecting provider outcomes.

Production approval-to-device end-to-end verification, the original recipient's exact SDK error, production FIREBASE_SERVICE_ACCOUNT_PATH accessibility, current token ownership and a physical tap into a real approved leave remain unverified. Local lookup previously found no employee GUID/token matching this production phone, so no test registration was reassigned to an unrelated local employee.

On the actual production host, inspect the existing diagnostics:

```bash
docker exec hrm-backend node dist/scripts/notificationPushDiagnostics.js --configuration
docker exec hrm-backend node dist/scripts/notificationPushDiagnostics.js --recent-failures
docker exec hrm-backend node dist/scripts/notificationPushDiagnostics.js --employee-code EMPLOYEE_CODE
```

Correlate the approval notification ID with the redacted Firebase rejection log. Verify the configured service-account file is readable inside the container and belongs to quickboom-hrm. Then approve one controlled test employee's pending leave, inspect notificationDelivery/history and the phone's tray, repeat the same approval to confirm no second notification, and tap the first notification to confirm its leave ID is selected. No production success is claimed until that full verification is completed.
