# RKD reimbursements: payroll output parity

## Code-level causes found

1. `getEmployeePayrollHistory` returned raw Payslip rows. RKD is stored in RkdRequest, not a Payslip column, so that path omitted the resolved RKD entries, combined reimbursements and final payable total.
2. The admin SalarySlip component, Flutter unified slip and PDF generator still printed RKD under earnings in addition to reimbursements, even though the shared settlement excludes RKD from salary gross/net. The displayed earning lines consequently disagreed with their gross total.
3. Flutter recomputed take-home instead of accepting the backend's total. Its typed model also interpreted a combined reimbursement total as ordinary expenses, then added RKD again. Its wallet settlement exposed only ordinary expenses as the reimbursement amount.
4. The RKD query could admit an uncredited assignment into a finalized snapshot or a request already credited to another payroll. Equal-amount fallback entries also invented per-request splits when only IDs were available.

These are verified code paths and test reproductions. The affected production employee/period was not available for live verification.

## Changes and calculation policy

Approved RkdRequest.commissionAmount remains authoritative. Source references remain RKD-<id>; no Expense or wallet cash transactions are created. Draft eligibility requires the correct employee, assigned period and an uncredited request unlinked or linked to that payroll. Previously credited requests can appear only in their own payroll snapshot. Frozen output includes only credited requests linked to that exact payslip; late/uncredited requests cannot change its totals.

Payroll history now uses resolveFullPayslipView, matching admin slips, mobile slips, salary detail and PDF. Existing history aliases remain. Wallet responses expose totalReimbursements alongside expenseReimbursement. Backend and both clients preserve the distinct RKD request entries and their original unequal amounts.

Existing formula is retained:

- Total Earnings = salary structure gross + existing eligible extra earnings.
- Net Salary = Total Earnings - Total Deductions, using the existing floor at zero.
- Total Reimbursements = approved ordinary expense reimbursement + eligible RKD incentive.
- Take-Home = Net Salary + Total Reimbursements + eligible ordinary commission.

RKD is excluded from ordinary commission and is printed only in reimbursements. Flutter uses backend netSalary, totalReimbursements and totalTakeHomePay when present, with calculation fallback for older responses. The PDF receives the backend reimbursement total directly; it no longer lists RKD as a gross earning. Existing attendance, deductions, approval amount, history, reference and paid-payroll locks are preserved. No schema change, migration, production data change, deployment or restart.

## API fields

`rkdIncentive`, `rkdRequests` (id, reference, original amount, description/status), `rkdReferences`, `expenseReimbursement`, `totalReimbursements`, `netSalary`, `totalTakeHomePay`, and `netInWords`. Existing nested earnings fields remain compatible.

## Verified shared scenario

The test submits and approves two requests for the same employee and period, saves/regenerates a draft, calls actual local authenticated routers/controllers/services and exports their JSON. DB/FCM are mocked. Different-employee requests, previously credited requests linked to another payroll, pending/rejected/cancelled requests and late uncredited assignments are excluded.

| Output | RKD | Ordinary expenses | Total reimbursements | Net salary | Take-home |
|---|---:|---:|---:|---:|---:|
| GET /api/payroll/admin/slips?month=ALL | 1,750 | 250 | 2,000 | 15,000 | 17,200 |
| GET /api/mobile/payroll/slips | 1,750 | 250 | 2,000 | 15,000 | 17,200 |
| GET /api/payroll/history/10?limit=all | 1,750 | 250 | 2,000 | 15,000 | 17,200 |
| GET /api/salary/slip | 1,750 | 250 | 2,000 | 15,000 | 17,200 |
| GET /api/employee/wallet | 1,750 | 250 | 2,000 | 15,000 | 17,200 |
| Admin React SalarySlip rendering | 1,750 | 250 | 2,000 | 15,000 | 17,200 |
| Flutter UnifiedSalarySlipWidget rendering | 1,750 | 250 | 2,000 | 15,000 | 17,200 |
| Official generated PDF | 1,750 | 250 | 2,000 | 15,000 | 17,200 |

Each output preserves RKD-1 = 500 and RKD-2 = 1,250. The actual PDF was text-extracted and visually rendered/inspected: single reimbursement entry per request, gross 15,000, reimbursement total 2,000 and “Seventeen Thousand Two Hundred Rupees Only.” Paid regeneration preserves the stored slip and excludes late/uncredited additions. Zero-eligible and rejected/cancelled scenarios produce RKD = 0.

## Tests

- Backend `npm run build`: passed.
- Backend `node scripts/test_rkd_payroll_wallet.cjs --reimbursements`: passed, including actual HTTP parity, PDF generation, multiple amounts, recalculation, exclusion and finalization cases.
- Backend `node scripts/test_rkd_adjustment.cjs`: passed.
- Backend `npm run test:salary-gross`: 26 passed.
- Backend `npm run test:payroll-settlement`: passed.
- Backend `node scripts/test_rkd_workflow.cjs`: eight passed.
- PDF `scripts/test_rkd_reimbursement_pdf.py` with the bundled Python/pypdf runtime: passed.
- Admin `node scripts/test_rkd_reimbursement_render.cjs`: actual React component renders shared HTTP JSON correctly.
- Admin full compiler comparison: nine pre-existing unrelated diagnostics, identical with HEAD version of the changed component; no new errors.
- Flutter `test/rkd_reimbursement_parity_test.dart`, `test/rkd_payroll_wallet_test.dart`, `test/date_wise_salary_test.dart`, `test/date_wise_salary_widget_overflow_test.dart`: 31 passed. Raw salary detail JSON is rendered through its actual map-based path; typed payslip JSON uses PayslipModel.
- Targeted Flutter analysis: no issues.

Live production browser/API data, PostgreSQL transaction contention and physical Android interaction remain unverified. Shared fixtures are synthetic responses from actual local endpoints, not production records.

## Files changed

Backend:
- src/services/rkdPayrollService.ts
- src/services/payrollService.ts
- src/controllers/payrollController.ts
- src/controllers/mobile/mobilePayrollController.ts
- src/controllers/employee/employeeController.ts
- src/utils/salarySlipPdfGenerator.ts
- scripts/test_rkd_adjustment.cjs (resolver mock)
- scripts/test_rkd_payroll_wallet.cjs
- scripts/test_rkd_reimbursement_pdf.py
- scripts/fixtures/rkd_reimbursements_api.json
- docs/rkd-reimbursement-parity.md

Admin:
- src/components/SalarySlip/SalarySlip.tsx
- scripts/test_rkd_reimbursement_render.cjs

Flutter:
- lib/features/payroll/data/salary_totals.dart
- lib/features/payroll/presentation/providers/employee_payroll_viewmodel.dart
- lib/features/payroll/presentation/widgets/unified_salary_slip_widget.dart
- lib/features/wallet/presentation/screens/employee_wallet_view.dart
- test/rkd_reimbursement_parity_test.dart
