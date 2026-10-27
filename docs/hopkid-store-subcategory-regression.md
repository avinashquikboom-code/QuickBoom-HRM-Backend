# HopKid store resolution before subcategory calculation

Git comparison:

- `6983913` used the previous policy evaluator inside employee grouping.
- `98baab6` introduced the subcategory invoice calculator before employee grouping with `meta.storeId ?? 0`. Its normalizer rejects zero with `STORE_ID_MISSING`.
- `b3dd751` added branch/store-name recovery at invoice persistence, after item calculation, so the saved store could be recovered while the item snapshot still recorded the earlier failure.
- `509ed6e` moved calculation after seller lookup but used only `metaStoreId || salesman.storeId`. It still omitted branch/store-code resolution and stopped processing an item with no direct store.

The fix passes the original extracted metadata to `resolveInvoiceStore` before invoking the existing subcategory calculator. Persistence uses that same verified store. Branch IDs are resolved through Branch and a unique Store name; they are not assumed to share the Store primary-key namespace. Store-name and document matches with multiple possible stores produce `STORE_MAPPING_AMBIGUOUS`.

No rates, product mappings, or source-amount contracts are created or updated. Each existing product/variant/subcategory mapping and effective-dated subcategory rule remains authoritative. Mixed subcategories still calculate each line separately and sum the rounded line commissions. Missing store data remains unresolved and says `Invoice store mapping unavailable` instead of alleging missing invoice products. A numeric provisional total alone does not establish a completed calculation, and no percentage is inferred from invoice totals.

Repair uses the existing locked, audited pending-invoice reconciliation. It now reads the saved webhook metadata before resolving the store. A preview does not persist recovered store metadata. Apply updates the existing transaction, posts only the commission delta to the wallet, and broadcasts the existing refresh event. APPROVED/PAID rows are excluded; repeated apply does not credit them again. Existing return projections and finalized snapshots keep their existing calculation paths.

Run from the backend directory with an existing administrator ID:

```sh
./node_modules/.bin/ts-node --transpile-only scripts/reconcile_pending_invoice_commissions.ts --actor-id ADMIN_ID --bill-id 12032 --bill-id 12028 --bill-id 12016 --bill-id 12015 --bill-id 11978
```

After checking READY amounts and store/product data, run the same command with `--apply`. These commands select explicit bill aliases and only PENDING external invoices. No administrator ID or store ID is invented by the script.

Flutter uses the explicit completed calculation state plus a finite API amount to restore its existing green SUCCESS badge and Commission Earned presentation. Delivery status remains separate. Missing store/configuration/data states cannot become SUCCESS. The existing per-product cards, invoice refresh, and wallet refresh remain in use.

Validation:

- `scripts/test_hopkid_store_subcategory_regression.cjs`: exact branch/code/name/seller resolution, branch/store numeric collision, duplicate-name rejection, independent subcategory rates, genuine missing-store state, original-metadata repair, no-write preview, delta-only wallet repair, repeated apply, and preservation of the provided finalized examples using isolated recorded fixtures.
- Existing recorded-history, product mapping, and webhook-status regressions.
- Flutter commission model, activity, invoice, and wallet regressions, including successful calculation with an older delivery status and a genuine missing store despite successful webhook delivery.

The configured live database refused the read-only diagnostic (`ECONNREFUSED`). The affected live invoices were not inspected or recalculated, and the working-invoice examples above were not represented as live database verification.

## Files changed for this regression

Backend:
- `src/controllers/webhookController.ts`: carry original metadata into store resolution before calculation; persist the same store.
- `src/services/invoiceCommissionService.ts`: verified and unambiguous store resolution; metadata-first reconciliation; accurate missing-store errors; no-write preview.
- `src/utils/commissionHelper.ts`: uppercase StoreID/BranchID payload aliases and strict numeric ID parsing.
- `src/services/invoiceCommissionCompleteness.ts`: provisional totals cannot prove a pending invoice is resolved.
- `src/services/recordedInvoiceCommission.ts`: preserve genuine missing-data errors and configured rates; no inferred percentage.
- `scripts/reconcile_pending_invoice_commissions.ts`: explicit bill selectors for the existing guarded repair operation.
- `scripts/test_hopkid_store_subcategory_regression.cjs`: isolated regression and idempotent wallet repair tests.
- `docs/hopkid-store-subcategory-regression.md`: Git comparison, validation and repair instructions.

Flutter:
- `lib/features/commission/data/commission_response.dart`: successful calculation controls the activity badge; explicit errors remain unresolved.
- `lib/features/commission/data/commission_models.dart`: wallet transactions use recorded rates and authoritative resolution state.
- `lib/features/commission/data/models/commission_models.dart`: per-product and invoice values preserve unknown rates/amounts and payout status.
- `lib/screens/commission/commission_detail_screen.dart`: do not display missing commission as zero or silently promote approval status.
- `lib/features/commission/presentation/widgets/webhook_logs_widget.dart`: existing SUCCESS badge and Commission Earned styling; accurate missing-store message.
- `lib/features/commission/presentation/screens/webhook_logs_screen.dart`: calculation badge is independent of delivery state.
- `test/commission_response_sync_test.dart`: completed-calculation badge and missing-store regression coverage.

Existing wallet and invoice refresh code from the preceding synchronization fix is retained. Unrelated working-tree changes are not part of this regression's file list.

## API and catalog contract follow-up

The calculator itself now resolves missing/zero store context from verified invoice metadata using the shared resolver before normalization. A caller's legacy zero cannot erase a known store. Store/branch numeric collisions remain errors; no arbitrary store or future policy is selected.

`productWiseCommission` and `productCommissionBreakdown` return the same line data. Invoice `products` now carries those same identifiers and line details rather than dropping them to name/quantity/price only. Each line exposes product/variant identity, quantity, invoice-derived unit price and line total, resolved subcategory, configured rate, earned commission and calculation state. Mixed-rate invoice headers retain a null single rate and `Multiple subcategory rates`.

Catalog variant aliases (UUID, SKU or barcode) are resolved only within the matching persisted product. Variant-specific rules take precedence over product-wide rules. Subcategory mapping and rate queries retain their invoice-date constraints. No category-name guessing, percentage inference, or future-rate fallback is used. The mobile transaction/bill endpoints preserve unresolved nulls instead of substituting provisional totals.

Flutter's existing detail model accepts `productWiseCommission` and preserves the additional line identifiers and monetary fields. The existing product-wise card renders each line's API rate and amount. No GetX controller exists on these paths; the existing Riverpod/StatefulWidget refresh implementation is retained.

Additional files in this follow-up:
- `src/hrmCommission/resolution.ts`
- `src/controllers/mobile/mobileCommissionController.ts`
- `src/services/invoiceCommissionService.ts`
- `src/services/recordedInvoiceCommission.ts`
- `scripts/test_invoice_mapping_recovery.ts`
- `scripts/test_hopkid_store_subcategory_regression.cjs`
- Flutter `lib/features/commission/data/models/commission_models.dart`
- Flutter `test/commission_response_sync_test.dart`

Validation: 41 Flutter commission tests passed; Dart analysis reported no issues. Backend TypeScript, recorded-history, webhook-state, exact catalog mapping, mixed-rate invoice updates, missing-store resolution, no-future-rate selection and wallet repair idempotency regressions passed. Live reprocessing was again blocked by `ECONNREFUSED`; no live invoice or payout was changed.
