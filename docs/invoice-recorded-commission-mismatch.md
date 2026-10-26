# Invoice Details recorded commission mismatch

## Root cause

`calculateInvoiceCommission` treated completeness of approved item snapshots as completeness of the recorded employee total. When product snapshots were missing or their amounts did not sum to the approved `CommissionTransaction.commissionAmount`, it returned null in the normal amount fields while retaining the persisted amount only as `recordedCommissionAmount`. Webhook Activity Logs already displayed the employee transaction's persisted amount. The Flutter detail screen read the normal amount fields and rendered null as `0.00`; its product footer could also manufacture a zero by summing unknown item amounts. A recorded rate and Approved badge could therefore accompany a misleading zero total.

## Fix

- Approved/paid detail responses retain valid persisted `commissionAmount`, `commissionEarned`, `commission`, `totalCommission` and `newCommission` consistently, including recorded numeric zero. The original amount remains in `recordedCommissionAmount` for compatibility. Missing or non-finite stored amounts remain unknown; approval status alone does not establish a value.
- Item breakdown completeness is independent of the total. Missing/inconsistent allocations remain null, with `itemCommissionState: UNRESOLVED`, reconciliation text, and the existing historical-reconciliation status. The response does not distribute a stored total among products, apply current rates, or calculate a replacement from invoice revenue. `calculatedCommissionAmount` stays null when no verified breakdown exists.
- Complete reconciled configured pending snapshots reuse the recorded values rather than evaluating newer policy. Provisional pending invoices retain the existing subcategory calculation/resolution behavior. Existing percentage, fixed, mixed, effective-date and inactive-rate rules are unchanged.
- Invoice lookup normalizes numeric, HWM and INV references, keeps the employee in every commission query, and rejects ambiguous matching rows. A legacy transaction-ID fallback must represent the same displayed bill, so a coincidentally equal database row ID cannot select another numbered invoice.
- Flutter binds the canonical total, supports the old approved-history `recordedCommissionAmount` response only when its source/state identify that contract, and preserves explicit numeric zero. Missing totals display “Pending verification”; unresolved product commissions display “Unresolved.” The product footer uses the canonical total instead of adding unknown allocations. Reconciliation messages remain visible alongside approval status.

No commission amount, rate, approval, payroll, ledger or invoice records in the configured application database were rewritten. No schema migration or API path changes are required.

## Bill 11885 and database verification

A read-only audit of the database configured by this checkout found no Bill 11885 under bill/invoice aliases, transaction ID 11885, primary/legacy webhook records or HRM commission documents/ledger entries. Its production persisted value therefore could not be independently confirmed here. The user was asked which deployment contains the bill; no connection credentials were copied or printed.

A disposable local PostgreSQL database reproduced Bill 11885 with persisted sale 999, commission 9.99, recorded rate 1%, APPROVED status, and unavailable item history. The actual mobile HTTP detail endpoint and Webhook Activity Logs endpoint both returned commission 9.99; detail gross/sale values stayed 999. Stored values were unchanged after detail reads. This proves the mapping with those persisted values, not the contents of the absent production bill.

## Validation

Passed:
- Backend `npm run build`.
- `node scripts/test_invoice_recorded_amount.cjs`: recorded Bill 11885 totals, absent/inconsistent item snapshots, approved/paid/configured-pending snapshots, confirmed zero, genuinely missing stored amount, unresolved pending records, aliases, employee scoping, another invoice with a different amount, transaction-ID collision and ambiguous records.
- `npm run test:mobile:invoice-subcategory` against a separately created disposable database: **49 integration checks**. Includes actual invoice/webhook HTTP agreement for the Bill 11885 fixture, read-only detail behavior, item recovery, configured zero, mixed/fixed/effective/inactive rates, mapping failures, isolated invoice/store/employee lookups, approvals and frozen history. The temporary PostgreSQL cluster is stopped after testing.
- `flutter test test/invoice_subcategory_commission_test.dart test/commission_wallet_completeness_test.dart test/webhook_activity_commission_test.dart`: **30 tests**, including Bill 11885 summary/footer at 320/390 widths, old-response compatibility, zero/null distinctions, pending and approved states, webhook amounts and missing mappings.
- Targeted Flutter analysis: no issues.
- `flutter build apk --debug --no-pub`: built `build/app/outputs/flutter-apk/app-debug.apk`. The tool emitted an existing firebase_core/Kotlin migration warning; compilation succeeded.

The live deployed Bill 11885 still needs an acceptance check after deploying the backend and updated mobile build. If its persisted employee commission is 9.99, it will be shown without recalculating 1% of 999 or altering stored financial data.

## Files for this change

Backend:
- `src/services/invoiceCommissionService.ts`
- `scripts/test_mobile_invoice_subcategory_commission.ts`
- `scripts/test_invoice_recorded_amount.cjs` (new)
- This report.

Mobile:
- `lib/features/commission/data/models/commission_models.dart`
- `lib/screens/commission/commission_detail_screen.dart`
- `test/invoice_subcategory_commission_test.dart`

Unrelated concurrent campaign/upload work in the backend was left intact.
