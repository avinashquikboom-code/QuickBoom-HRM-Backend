# Attendance correction and payroll push fixes

## Findings and changes

- `src/controllers/attendanceCorrectionController.ts`: single and bulk rejection used to notify before saving. All decisions now claim a PENDING request before dispatch; approvals change attendance within that same transaction. Repeated or competing reviews cannot emit the same decision again. Submission/resubmission checks are serialized per employee/date. Business employee identifiers take precedence over legacy numeric IDs, and correction IDs are included in database and push payloads.
- `src/utils/hrNotificationHelper.ts`: opt-in event deduplication uses existing notification rows and PostgreSQL transaction advisory locks, without a schema change. Correction recipients now include STORE_MANAGER, matching the existing correction route's reviewer roles; the existing pa-attendance permission filtering still applies. The current routes grant global correction review to these roles; they do not implement an assigned manager/team leader queue. This change preserves that workflow rather than granting new approver access to a reporting manager with an unsupported role.
- `src/services/payrollService.ts`: notification creation was duplicated (direct database insert plus sendAppNotification), exposed net pay, and was repeated on regeneration. Publication now uses notifyEmployee once, only after an employee-visible Approved/PAID slip exists. Approved is the existing saved/generated state, with no independent publication field. Draft/rejected slips are excluded. Notification text contains the period, without salary amounts. Successful saves and both approval endpoints use this publication check.
- `src/controllers/payrollController.ts`: process-run no longer notifies every input employee regardless of individual failure. Disbursement by payslip ID previously skipped the employee push entirely. Individual and bulk payment now resolve recipients/periods from persisted slips, claim Approved -> Paid once, and commit advance recovery in the same transaction before notification. Retried/concurrent payments cannot repeat recovery or push. Approval/rejection cannot revert Paid records. Payload actionId is employeeId-month-year, which Flutter already understands.
- `src/services/firebaseNotificationService.ts`: Android payloads now select the existing attendance_notifications and payroll_notifications channels rather than general_notifications for both events.
- Flutter `lib/core/services/notification_service.dart`: STORE_MANAGER taps now resolve to the existing approver screens. Existing initialization, Android 13 permission request/manifest declaration, token registration/refresh, foreground local notifications, background system notification payloads, and cold-start handling were inspected. Existing correction routing opens correction management for approvers and the correction screen for employees; payroll routing selects the accessible employee/period slip.

Disbursement and salary-paid are the same Approved -> Paid transition in the current APIs. They intentionally produce one employee SALARY_PAID alert, rather than two messages for one operation. These endpoints mark payroll paid; they do not independently verify a bank transfer.

## Verification performed

- `tsc --noEmit`: passed.
- `node scripts/test_attendance_payroll_notifications.cjs`: passed with mocked database/FCM. Covers submitted, approved, rejected, published, individual disbursement/paid and bulk disbursement events; recipient and period mapping, database records, provider acceptance/rejection, failed saves, concurrent/repeated retries, and advance recovery count. Mocked transaction serialization does not replace a real PostgreSQL concurrency/rollback test.
- `node scripts/test_fcm_payload.cjs`: passed, including attendance/payroll channel IDs, token union/deduplication, batching and permanent invalid-token removal.
- `node scripts/test_fcm_failure_diagnostics.cjs`: passed; preserves original initialization error and safe SDK diagnostics, and only removes confirmed permanently invalid tokens.
- `node scripts/test_device_push_outcome.cjs`: passed; zero acceptance and provider failure are distinct from acceptance.
- `node scripts/test_expense_notification_flow.cjs`: passed shared helper regression checks.
- Flutter payroll, leave and expense notification navigation tests: all 10 passed.
- `flutter analyze lib/core/services/notification_service.dart`: no issues.
- Existing read-only `notificationPushDiagnostics.ts --configuration`: local service account parsed, RSA key validated, Firebase initialized, project quickboom-hrm matches Android. This does not verify API authorization, current device registration, or delivery.
- Existing read-only `notificationPushDiagnostics.ts --recent-failures`: could not connect to the configured database (ECONNREFUSED). No recipient token or historical provider failure could be verified. The earlier report of zero accepted messages remains unexplained by runtime evidence.

No production writes, deployment/restart, Docker/deployment edits, or schema changes were performed. All notification sends in the regression suite were mocked.

## Remaining end-to-end checks

In a reachable test environment with a registered Android device, exercise each event independently:

| Event | Expected recipient / persisted event | Push/tap checks still required |
| --- | --- | --- |
| Correction submitted | Authorized correction reviewers; ATTENDANCE_CORRECTION_REQUEST, request ID | FCM outcome; approver Android tray and correction management tap |
| Correction approved | Requesting employee; ATTENDANCE_CORRECTION_APPROVED | FCM outcome; employee tray and correction screen tap |
| Correction rejected | Requesting employee; ATTENDANCE_CORRECTION_REJECTED after save | FCM outcome; employee tray and correction screen tap |
| Slip published | Employee; PAYSLIP_GENERATED, employee-period key | No alert for draft; visible period slip after tap; no salary amounts in tray |
| Disbursement completed | Employee identified by persisted approved slip; SALARY_PAID | Saved Paid state, FCM outcome and intended employee device |
| Salary marked paid / retry | Same transition; no second record or push/recovery | Repeat individual and bulk calls, including simultaneous calls |

For every row, inspect notification userId/actionId/deliveryStatus/fcmMessageId/failureReason and the safe per-device SDK diagnostics. Test foreground, background and terminated launch; Android 13 permission grant/denial and channel settings. Android force-stop requires reopening the app before delivery is expected. Inspect recipient registrations using the existing employee-specific read-only diagnostic from the backend directory; do not print raw tokens. The client token's project cannot be inferred from its opaque string: matching client configuration and an actual successful provider send are needed.

Database row creation, FCM acceptance (SENT), and device receipt/display are separate facts. A stored FCM message ID proves acceptance only. Real Android tray display and tap behavior remain unverified here.

The existing architecture still has a process-crash window between business commit and notification creation, and between notification creation and FCM dispatch. Deduplication favors avoiding repeated pushes; it does not automatically resend existing FAILED/PENDING/UNKNOWN rows. Durable recovery across crashes would require a separately reviewed change to the existing job/outbox workflow. No exactly-once delivery guarantee is claimed.
