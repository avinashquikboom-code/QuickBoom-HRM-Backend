# Product-wise rate and earned commission recovery

The product card already rendered the numeric fields it received. The missing values came from two gaps: historical reconciliation blanked all item-level values if any item snapshot was incomplete, and legacy product fields were not normalized consistently in the API/model.

Changes:

- Normalize saved product aliases (commissionPercent/commissionPercentage/productCommissionRate and productCommission/commissionEarned/earnedCommission, including existing direct/case variants) into canonical commissionRate and commissionAmount fields. Explicit canonical null/zero stays authoritative.
- Keep individually recorded rates and known amounts when other item history is missing. Do not invent the missing remainder or sum unknown amounts into a confirmed zero.
- Recover multi-product history from immutable HRM ledger snapshots no later than approval/payment time. Require one matching sale document in the same store, no competing employee recipient, valid item identities, and an exact match to the employee's recorded commission total. Later postings and ambiguous same-time snapshots cannot replace approved history.
- For one identified non-return product that covers the employee's entire invoice, expose the recorded percentage and recorded earned amount directly. Require employee attribution or an employee-owned saved item, matching product/variant, quantity, full sale coverage and no shared invoice recipient. Unverified post-approval raw payloads cannot establish item history. This is a projection of recorded fields; it does not multiply the invoice by a current rate.
- Match products using line ID/product ID/variant instead of selecting the first matching product or relying on array indexes. This prevents repeated-product variants and ledger ordering from swapping names or amounts.
- Flutter reads the same legacy aliases and renders canonical rate/amount in the existing card. Genuine missing/ambiguous records still show the existing review state.

No financial records, payroll rules, subcategory rules or rates were rewritten. The configured application database was not updated. Bill 11885 was absent from that database during the prior audit; the numeric 999 / 9.99 case is verified using persisted isolated fixtures, not claimed as a live production check.

Files for this follow-up:
- Backend: src/services/invoiceCommissionService.ts; scripts/test_invoice_recorded_amount.cjs; scripts/test_mobile_invoice_subcategory_commission.ts.
- Mobile: lib/features/commission/data/models/commission_models.dart; test/invoice_subcategory_commission_test.dart.

Verification:
- Backend production build passed.
- Recorded invoice service regressions passed (aliases, partial data, single-product mapping, shared recipients, variants, missing values, immutable ledger recovery and cross-invoice isolation).
- Disposable PostgreSQL invoice integration suite: 51 checks, including historical multi-product ledger rates/amounts, exclusion of later postings, shared-recipient protection, and a single-product Bill 11885 fixture returning rate 1% and earned amount 9.99 while sale remains 999.
- Mobile invoice/webhook/wallet suite: 33 tests. Product card tests at widths 320 and 390 verify 1% and 9.99 on the card and consistent totals in the header/footer; zero/null alias precedence also tested.
- Flutter analysis completed separately.
- Android debug APK built at build/app/outputs/flutter-apk/app-debug.apk.

Deploy the backend update and install the updated mobile build to use the fix in the running application. Records with no verifiable item evidence still require the original item snapshots or an accounting review; an invoice-wide amount is never spread across ambiguous products.
