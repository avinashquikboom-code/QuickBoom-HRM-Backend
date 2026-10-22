# RKD payroll adjustment validation

## Contract and diagnosis

The existing route is `POST /api/hr/rkd/:id/adjust`, behind authentication, HR/Admin role checks and the `pa-commission` approval permission. Its payload is `{ "month": 11, "year": 2026 }`. The ID is a positive Prisma Int. It schedules an existing APPROVED request's amount into an open payroll period; it does not adjust commissionAmount, require a reason, or change approval status. The admin service already used the correct field names.

Production logs/response bodies for requests 1 and 2 were not available. The supplied AxiosError alone does not establish which validation failed; the response JSON and submitted body have been requested. No production records were accessed or modified.

Real local HTTP calls against the router/controller with a controlled finalized October payroll reproduced:

```json
{"success":false,"message":"Payroll for 10/2026 is already finalized/paid. Please select an open payroll period.","errorCode":"RKD_PAYROLL_LOCKED"}
```

The other existing 400 branches are an invalid month/year or a non-APPROVED request. Selecting an open period succeeds; finalized-period validation is preserved. This reproduction does not prove which branch the reported production requests hit.

## Changes

- Validate JSON objects, finite whole month/year values and ranges. Stop accepting arrays, partial numeric strings and fractional values through parseInt coercion. Return descriptive messages, error codes and field details.
- Serialize status/period checks and allocation with the existing RKD review and payroll period transaction locks.
- Return the persisted result for same-period retries after credit; reject moving a credited request to another period. Do not reset a credited request and count it again.
- Read refreshed markers after draft payroll recalculation, fixing the stale response that previously reported isSalaryCredited=false after a successful save.
- Admin service validates IDs and periods before posting the same existing contract. The modal displays the backend explanation/field errors inline, uses a synchronous ref guard plus disabled controls to block duplicate submissions, and refreshes the list/details after success. A refresh failure after successful allocation is reported as a refresh failure, not a failed adjustment.
- Approval status, commission amount, sale-reference checks, commission audit history and payroll formulas are unchanged. No schema changes, migrations, production writes or deployments.

## Verification

- Backend `npm run build`: passed.
- Backend `node scripts/test_rkd_adjustment.cjs`: passed; real local HTTP route with mocked DB/payroll, valid open period, locked period response bodies, invalid/missing fields and IDs, unsupported statuses, 401/403 permissions, fresh persisted markers, same-period retries and prevention of moving a credited request. Amounts remain unchanged. Controlled draft-save failure retains an allocated but uncredited request.
- Backend `node scripts/test_rkd_route_ids.cjs`: passed, including the adjustment handler.
- Backend `node scripts/test_rkd_payroll_wallet.cjs`: passed; approval, payroll snapshot/PDF, wallet, rejection, finalization and retry accounting regressions.
- Admin `node scripts/test_rkd_adjustment.cjs`: passed; exact endpoint/body, integer/finite validation before HTTP, server and field-level error extraction.
- Admin `tsc --noEmit --incremental false`: nine existing errors in RegisterUserWithRights.tsx, PayrollPage.tsx and commissionService.ts. Compiler comparison using HEAD versions of the changed RKD files in memory produces identical diagnostics; no new errors from this fix.
- Flutter `flutter test test/rkd_payroll_wallet_test.dart`: seven passed, covering RKD adjustment visibility and salary/wallet totals.

Production-specific cause, actual PostgreSQL lock contention, browser interaction and physical Android updates remain unverified. Backend adjustment tests use controlled state; the Flutter regression uses existing synthetic API fixtures.

## Files

Backend:
- `src/controllers/rkdController.ts`
- `scripts/test_rkd_adjustment.cjs`
- `scripts/test_rkd_route_ids.cjs`
- `docs/rkd-adjustment-validation.md`

Admin:
- `src/features/rkd/pages/RkdRequestsPage.tsx`
- `src/services/rkdService.ts`
- `scripts/test_rkd_adjustment.cjs`

## Existing open-period selection fix

The reported October default came from calendar-based month/year state and from copying the request's previous allocation, without checking the employee's actual payroll status. The modal now reads `GET /api/payroll/history/:employeeId?limit=all`, sorts editable periods chronologically and defaults to the earliest existing open period for that employee. Year and month options are derived from those records. There is no hardcoded replacement period or automatic creation/reopening.

The existing history API now accepts `limit=all`; default `limit=12` behavior is unchanged. History reads do not generate or modify payroll. The admin slips API was intentionally not used because it auto-generates payroll on some GET requests. Payroll runs are aggregate processing jobs, whereas the employee's Payslip record is the lock/status authority used by adjustment.

Editable states are Draft, Pending and Pending Approval (case/whitespace normalized). Approved, Paid, Disbursed, Completed, Rejected, Cancelled and unknown states cannot be selected. The backend uses the same editable-state rule, requires the employee's target payslip to exist, and checks it under the existing payroll period lock. Same-period retries after credit still return the persisted result without resetting credit or modifying finalized records.

When no editable employee period exists, Confirm Adjustment is disabled and the modal displays: "No open payroll period is available. Please create or reopen a payroll period before proceeding." Loading/failed reads also prevent confirmation. Client validation checks that the selected year/month is a member of the fetched employee period list. Success refreshes request details, the RKD list and payroll history, and names the selected month/year.

Additional changed files: backend `src/controllers/payrollController.ts`, `src/services/rkdPayrollService.ts`; period filtering is in the existing admin `src/services/rkdService.ts`. Existing adjustment page/controller/tests were extended.

Verification: backend build passed; adjustment HTTP tests passed for missing/closed/open periods, other employees/empty history, retained default history limit and all-history reads, correct payroll ID, and idempotent retries. Payroll/wallet/PDF and route-ID regressions passed. Admin selector/service tests passed for earliest open period, year rollover, closed/foreign exclusions and empty availability; authentication regressions passed. Full admin type-check retains the same nine pre-existing unrelated diagnostics, confirmed by an in-memory comparison with HEAD versions of the changed RKD files. No browser or production database end-to-end verification was performed.
