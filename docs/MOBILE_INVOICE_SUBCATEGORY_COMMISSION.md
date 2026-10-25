# Mobile Invoice Details: subcategory commission

## Root cause

Invoice Details calls GET /api/mobile/commission/bill/:billId through MobileCommissionService.fetchBillDetail and parses CommissionDetail from features/commission/data/models/commission_models.dart. The screen is screens/commission/commission_detail_screen.dart (not the employee performance-summary screen with a similar name).

Previously the header read CommissionTransaction.commissionAmount/commissionPercent, reconstructed update amounts, and ultimately fell back to Employee.commissionPercentage. Product-Wise Commission independently consumed productBreakdown or recalculated raw lines through a policy resolver that also allowed employee/direct payload overrides. Flutter inferred missing rates/amounts, treated explicit zero like missing data, and summed products independently for the footer. Some backend branches preferred productPrice/unit price before discounted line revenue. The webhook metadata parser also omitted nested invoice.lineItems/items/products.

These separate sources explain a header of ₹12.45 at a recorded 1% alongside product rows showing 0%. The reported production invoice was not fetched or rewritten; tests reproduce that inconsistency with stored fixture data.

## Backend flow and formula

The invoice service and HRM projection share strict resolution through the existing tables:

external product/variant → explicit external subcategory ID, or effective-dated HrmCommissionMapping → HrmCommissionSubcategory → HrmCommissionRate effective on the original sale date.

An exact store-specific rate takes precedence over a global rate. No product/category name matching, local POS catalog fallback, hardcoded rate/basis, employee default, or incoming POS commission override is allowed for new invoice commission. Generic net amounts require the administrator-verified HRM source contract; unit price × quantity is never guessed to be discounted eligible revenue.

For each item, percentage commission is half-up paise rounding of eligible discounted revenue × configured rate / 100. Fixed UNIT commission is the configured amount × quantity; fixed LINE is once per line. Zero eligible revenue earns zero. Invoice commission is the decimal sum of the rounded item commissions. Different percentage/fixed rates remain separate item values; the header says Multiple subcategory rates rather than inventing a uniform percentage. Existing prices, GST, discounts, and invoice totals are not modified. Purchased-product prices, when available, remain source unit prices and are not derived from commission revenue.

New external invoice ingestion in our HRM backend uses this same service and stores the resolved item snapshots in existing CommissionTransaction.productBreakdown. Employee ownership/attribution and existing database identities remain for authorization/accounting compatibility, but employee rates no longer supply invoice item earnings. Incomplete invoices are PENDING with explicit null/missing item configuration and no automatic wallet earning. Complete invoices follow the existing automatic approval/earning policy with the actual subcategory total.

## API compatibility and states

The existing GET URL and {success,data} envelope remain. Existing invoice/customer/store/employee attribution fields are retained. The response adds or formalizes:

- commissionSource, commissionState, rateDisplay, approvalStatus, hasMissingConfiguration.
- commissionAmount, commissionEarned, totalCommission, newCommission, calculatedCommissionAmount: the same item-sum value when complete; null when a total cannot be verified. Explicit zero stays zero.
- eligibleSaleAmount: the sum of eligible item amounts, distinct from the original bill saleAmount.
- productCommissionBreakdown entries: product name/ID, sale-item reference, SKU/variant, quantity, subcategory ID/name, eligibleSaleAmount/saleAmount, commissionRate, commissionType, fixedBasis, basis, rateId, commissionAmount, commissionState, missingReason, configurationMessage.
- recordedCommissionAmount and reconciliationMessage for approved history.

A mixed invoice at 1000 × 5% plus 2000 × 3% returns item amounts 50 and 60, total 110, commissionRate null and rateDisplay Multiple subcategory rates. Missing mapping/rate or unverified net revenue returns a missing-configuration state, null rate/earning for affected items, and a null invoice earning total. It does not substitute an employee rate or report the partial known amount as a complete invoice total. A valid configured 0% returns numeric zero and a complete state.

Unknown/unauthorized invoices return 404 instead of fabricated approved empty bills or cross-employee/live-fetch fallbacks. Stored payload selection is scoped to the authorized invoice's store so a reused invoice number from another branch cannot supply the product data. Existing router authentication and permission gates remain in place.

## Approval and historical accounting

Approved and paid transactions are read from their saved item snapshots. GET never updates accounting. Current rate changes cannot recalculate their values, including an explicitly approved zero. If saved item amounts sum to the recorded approved amount, those historical amounts/rates are displayed as recorded. Missing saved rates are not inferred from money ratios.

If saved item amounts are missing or do not reconcile (including ₹12.45 recorded against zero product amounts), the API returns HISTORICAL_RECONCILIATION_REQUIRED. The app displays Historical detail unavailable, retains the separate Recorded approved commission: ₹12.45, and explains that accounting review is required. It does not invent item allocations or change the approved database amount to force a match.

The existing approval controller resolves a pending external invoice before approval, refuses incomplete data/configuration with 409, and freezes the actual item snapshots and amount under a row lock with CommissionHistory. Approving again is idempotent; PAID is not downgraded. Shared-employee legacy invoices require explicit accounting allocation review (409) rather than writing the full invoice commission to multiple employee records. Their employee ownership is not repurposed or removed.

External invoice updates acquire the same commission-row locks, preserve approved/paid monetary snapshots, and record REVIEW_REQUIRED history when amounts differ. Cancellation/return processors retain their existing reversal path; unrelated employee commission policies, targets, RKD, and payroll formulas are not replaced. The separate HRM projection's original-value refund and cancellation rules are regression-tested. This change does not silently settle historical discrepancies or create new historical payouts.

## Flutter

The model accepts authoritative nullable amounts/rates and explicit zero; it performs no invoice commission calculations. Header, footer, and item rows use the same response. Each product shows its name, actual subcategory (or Not recorded), quantity, eligible sale amount, rate/type/basis and earned commission. Missing configuration shows an explanation and Unavailable, not 0%. The header shows the real approval status and preserves recorded historical approval information separately.

The product section opens expanded. Narrow header rows and labels wrap/share width, and the expansion tile has its own Material surface. Widget tests verify 320px and 390px layouts without overflow or Material assertions.

## Database, deployment and scope

No new migration is required for this fix: it reuses the existing HRM subcategory/mapping/rate tables and CommissionTransaction JSON snapshots/history. Deploy the backend before or alongside the updated Flutter app because older clients may coerce null values to zero. Existing HRM configuration tables must already be deployed, and actual rates/mappings and source amount semantics must be configured. No production database or third-party HopKid POS application/API/schema was modified or deployed during this work. Pre-existing unrelated workspace/POS changes are outside this fix.

## Files

Backend:
- src/services/invoiceCommissionService.ts: authorized invoice lookup, common calculations, frozen history and approval preparation.
- src/hrmCommission/resolution.ts: exact HRM product/subcategory/policy resolution.
- src/hrmCommission/projection.ts: shares the resolver without changing projection ledger behavior.
- src/hrmCommission/normalize.ts: verified amount/GST contract; removes unverified generic/unit-price guesses.
- src/controllers/mobile/mobileCommissionController.ts: existing bill-details route delegates to the common service.
- src/controllers/webhookController.ts: new invoice item calculations and historical-update protection; external POS transport remains unchanged.
- src/controllers/commissionController.ts: approval validation, frozen snapshots, locking and history.
- src/utils/commissionHelper.ts: nested invoice item-array support.
- scripts/test_mobile_invoice_subcategory_commission.ts and package.json: focused integration command.
- docs/MOBILE_INVOICE_SUBCATEGORY_COMMISSION.md: this report.

Flutter:
- lib/features/commission/data/models/commission_models.dart: authoritative invoice and item DTO parsing.
- lib/screens/commission/commission_detail_screen.dart: consistent totals, missing/historical states and responsive item details.
- test/invoice_subcategory_commission_test.dart: model and screen regression coverage.

## Verification

- test:mobile:invoice-subcategory: 27 isolated PostgreSQL/API integration groups passed (mixed rates, employee/override independence, exact mapping, configured zero, missing mapping/rate, fixed-unit rates, cross-store source scoping, header/item parity, historical mismatch and approved zero preservation, approval idempotency/authorization, unknown/cross-employee access, shared allocation guard, actual ingestion and frozen updates).
- test:hrm:subcategory-commission: existing 24 integration/API groups passed, including original-rate refunds, partial/full reversals, cancellations, exchanges, rounding and store/date reports.
- Flutter invoice_subcategory_commission_test.dart: 11 model/widget tests passed, including 320px/390px layouts and the reported mismatch.
- Flutter analyze for the two modified source files and the test: no issues.
- Backend npm run build: passed.
- Flutter Android debug APK build: passed; artifact build/app/outputs/flutter-apk/app-debug.apk. Existing firebase_core/Kotlin future-compatibility warning does not fail the build.
- Existing salary-gross regression suite: 26/26 checks passed.

Integration fixtures use only the isolated localhost HRM test database on port 55439; no live invoice or production payroll data was changed.


## HWM-121 saved-item recovery follow-up

The reported PRODUCT_LINES_MISSING state exposed a second source mismatch: product display could use CommissionTransaction.productBreakdown while normalization still received an empty raw invoice item list. Pending invoice calculation and approval now use the same recovered items. They also use existing HRM ledger line snapshots when the source payload is absent. Applied approved/paid history remains on the original immutable handling path.

src/services/invoiceItemRecovery.ts reconstructs recorded product/variant identity, quantity, actual external subcategory identity and verified eligible amount fields. It translates a saved HRM subcategory UUID back to its external ID. A recorded basis, recorded rate-version basis, or the existing verified generic-net source contract governs amount interpretation. It never guesses a rate, uses an employee percentage, multiplies unit price into eligible revenue, or matches a product/subcategory by its display name. Current configured rates are reused; no rate setting or database schema was changed.

The API reports itemDataSource as INVOICE_PAYLOAD, SAVED_PRODUCT_BREAKDOWN, HRM_LEDGER_SNAPSHOT, or UNAVAILABLE. INVOICE_DATA_MISSING is distinct from MISSING_CONFIGURATION. A known configured rate remains visible when an eligible amount cannot be verified; genuinely missing IDs/quantities/amount basis receive readable messages rather than PRODUCT_LINES_MISSING or a misleading instruction to configure an existing rate. The mobile screen renders Invoice item data unavailable for this state.

Eight added invoice checks cover saved BLAZO/1195 with existing configured rate, sparse payloads, verified generic net fields, stored rate-version basis, visible configured rate with unverified amount, missing catalog identity, ledger-only recovery and approval with recovered items. An additional Flutter widget test covers the distinct data-error message. All 27 invoice integration checks and 11 Flutter tests pass; analysis and backend build pass. Android debug APK was rebuilt for the new screen state.

The database configured in this workspace did not contain HWM-121 during a read-only inspection. This fix is validated against the matching saved-record fixture pattern, not by rewriting or claiming verification of that live invoice. Deploy the updated backend and mobile build to the environment serving that invoice. No live invoice or rate was modified.
