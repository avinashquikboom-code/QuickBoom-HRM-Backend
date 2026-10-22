# RKD payroll and mobile wallet integration

## Accounting policy

The approved RkdRequest.commissionAmount is the authoritative amount. Approval preserves the existing unique CommissionTransaction audit mirror, using billId RKD-<request ID>. It does not create a cash WalletTransaction or increment Wallet.availableBalance. The mobile wallet displays an approved earning, not withdrawable funds. No wallet-credit or salary-paid notification is emitted merely for approval.

The payroll period is the IST month/year of approval, matching the existing creation-at-approval commission timing. Existing lockedPayslip rules treat Approved, Paid, Disbursed and Completed as finalized. Per the user's explicit decision, an approval for a finalized period remains eligible but awaits manual payroll adjustment: salaryMonth/year stay null and no historical slip is modified. There is no automatic carry-forward or new manual-adjustment API/UI.

RKD is a separate variable earning included in total earnings and net salary. Ordinary commission remains separate in take-home according to existing payroll rules. Example with no deductions: fixed gross 15,000 + RKD 1,500 = total earnings/net salary 16,500; ordinary commission 200 gives take-home 16,700. RKD is excluded from ordinary commission aggregation, commission-wallet metrics/history and standalone commission settlement, avoiding duplicate counting/payment and fictitious sales metrics.

## Implementation

- Approval serializes by RKD request and payroll period in a transaction, records reviewer/time, and creates a single existing ledger mirror/history entry. Retries do not create a second ledger credit. Approved requests cannot be reopened through the review workflow. Approval is eligibility; isSalaryCredited remains false until a payslip snapshot is successfully saved.
- Existing salaryMonth, salaryYear, payrollId, isSalaryCredited and salaryCreditedAt fields track allocation/inclusion. Saving a payslip binds the included approved requests atomically with the stored payroll figures. A changed RKD amount during calculation causes rollback and requires recalculation. Finalized rows remain immutable.
- Locked slip views derive the RKD breakdown from bound requests only, while preserving stored net salary and ordinary commission. Late approvals do not change the frozen breakdown. Finalization and disbursement check that eligible RKD references were included before proceeding.
- The shared payroll calculator, regular save path and existing payroll automation path use the same formula and snapshot logic. Salary-slip JSON and PDF expose RKD Incentive separately; PDF also includes the RKD references. Flutter parses and renders the same separate earning and totals.
- The existing employee wallet API returns rkdEarnings projected from approved requests, with amount, description, approval date, reference, period, inclusion flag and status. Flutter shows those in the existing wallet salary tab. Pending/rejected requests are excluded, and availableBalance remains unchanged.
- Approval notifies eligibility only. Successful publication/snapshot updates use the existing salary availability notifications after commit. RKD update notifications have revision references that Flutter resolves back to the employee/pay period. FCM outcome handling remains in the shared notification helper; provider acceptance does not prove device display.

## Files changed

Backend:
- src/services/rkdPayrollService.ts — allocation/snapshot/wallet projection helpers and ordinary commission filter.
- src/services/rkdNotificationWorkflow.ts — transactional approval, period eligibility, one audit mirror and approval notification.
- src/services/payrollService.ts — calculator, snapshots, stored/open views and salary availability updates.
- src/services/payrollAutomationService.ts — reuse the shared snapshot save path.
- src/services/commissionService.ts — exclude RKD from sales/ordinary commission metrics.
- src/controllers/rkdController.ts — refresh an existing unlocked slip after successful approval.
- src/controllers/payrollController.ts — finalization/payment consistency checks and PDF inputs.
- src/controllers/employee/employeeController.ts — wallet earning projection.
- src/controllers/employeeCommissionController.ts — separate RKD from ordinary mobile commission views.
- src/controllers/commissionController.ts — exclude RKD from standalone commission settlements.
- src/utils/salaryGross.ts — RKD included once in earnings/net and display reconciliation.
- src/utils/salarySlipPdfGenerator.ts — separate line and reference list.
- scripts/test_rkd_payroll_wallet.cjs — mocked workflow/calculation/snapshot/wallet API/PDF coverage.
- scripts/test_rkd_workflow.cjs — align approval expectation with eligibility versus actual slip inclusion.
- scripts/test_attendance_payroll_notifications.cjs — empty RKD fixture for unrelated payroll tests.

Flutter:
- lib/features/payroll/data/salary_totals.dart
- lib/features/payroll/data/payroll_notification_target.dart
- lib/features/payroll/presentation/providers/employee_payroll_viewmodel.dart
- lib/features/payroll/presentation/widgets/unified_salary_slip_widget.dart
- lib/features/wallet/presentation/screens/employee_wallet_view.dart
- lib/features/wallet/presentation/widgets/rkd_earnings_widget.dart
- test/rkd_payroll_wallet_test.dart

## Database migrations and safety

None. The implementation reuses existing fields/models and the unique billId/employeeId commission reference. No production writes, data clearing/backfill, Docker/deployment configuration changes, service restart or deployment was performed. Financial sends/writes in tests were mocked.

Historical approved RKD records lacking an allocation are shown awaiting manual adjustment. Historical finalized slips that previously included RKD under commission retain their stored values; this change does not guess at, reclassify or pay those historical amounts again. Review those records through an authorized reconciliation before any manual adjustment.

## Tests

- npm run build: passed.
- scripts/test_rkd_payroll_wallet.cjs: passed with mocked DB and FCM. Covers pending submission, concurrent/retried approval, single ledger/history entry, correct approval period, earning/commission/net/take-home arithmetic, save rollback, saved inclusion references, PDF definition, actual wallet controller response, unchanged cash balance, finalized slip preservation, late-approval adjustment hold, and rejection exclusion.
- scripts/test_rkd_workflow.cjs: all 8 existing controller workflow cases passed.
- scripts/test_rkd_route_ids.cjs: passed.
- npm run test:payroll-settlement and npm run test:salary-gross: passed.
- Existing attendance/payroll notification and expense notification regression scripts: passed.
- Flutter RKD widget/totals, payroll navigation, date-wise salary and overflow suites: all 24 tests passed together.
- Flutter analyze on the 7 changed Dart production/test files: no issues.

## Live end-to-end verification remains pending

The read-only configured database diagnostic still returns ECONNREFUSED. An Android device is now connected, but the changed backend is not reachable/deployed for a live financial workflow, and the new mobile build has not been installed for this flow. No real approval, salary generation, wallet balance mutation or FCM send was performed against production.

Before release, verify on a reachable non-production database and the connected device: submit a sales employee request, approve as authorized HR, generate/publish a slip, compare its RKD line and references to the wallet earning, repeat approval/finalization/payment calls, and verify pending/rejected exclusion and a finalized-period manual-adjustment hold. Verify real PostgreSQL rollback/locking and notification DB/provider/device outcomes. Mock serialization and a PDF definition assertion do not substitute for real concurrent database tests, rendered PDF layout inspection, or Android tray/tap verification.

The accounting decision is resolved: finalized-period approvals await manual adjustment. Execution of those adjustments and reconciliation of legacy unallocated/historically included RKD remain deliberate HR/accounting work; no automatic historical mutation is enabled.
