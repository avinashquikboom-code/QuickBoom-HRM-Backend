# Hopkid POS subcategory commission

Verification scope: this document covers the local POS checkout/configuration/ledger changes. Concurrent edits appeared during final verification in src/controllers/commissionController.ts, src/controllers/commissionReportController.ts, src/routes/commissionRoutes.ts, additional functions in src/pos/retailCommissions.ts, and extra POSRetailCommission schema indexes. Those edits were preserved. The combined backend compiles, but their standalone reporting/synchronization paths and additional indexes were not covered by the completed integration/migration tests.

## Catalog and scope

POS variants belong to POSProduct; POSProduct.categoryId points to POSCategory. POSCategory already has a parentId tree. The exact assigned category with a parent is the product subcategory. Root-only, absent category, and manual lines are explicitly excluded (NO_SUBCATEGORY); child categories without a rate are excluded (NO_CONFIGURED_RATE). No category, employee, external numeric mapping, or name is guessed as a fallback.

Existing CommissionPolicy, CommissionTransaction, employee commissionPercentage, mobile commission endpoints, payroll aggregation, and external Hopkid invoice webhook handlers form the HRM commission subsystem. New local POS checkout no longer uses those policies or writes employee/payroll commissions. The external invoice webhook subsystem remains unchanged. It does not receive a new outbound event from POS checkout. Legacy employee commission history remains stored, and the local POS refund/void handlers preserve its existing behavior.

## Configuration and calculation

Administrators configure one rate directly on each child POSCategory through PATCH /api/v1/pos/categories/:id/commission and POS > Subcategory commission > Configure subcategory rates. The catalog configuration is global across stores. pos.configure plus an administrator session are required; store-login credentials cannot update global rates. Each change is audited. Clearing both fields to null explicitly disables the subcategory rate. Rates accept finite nonnegative numbers with up to four decimal places; percentage is limited to 100. One category row inherently prevents duplicate rate configurations; the migration also adds a database validation constraint.

Store commissionEnabled must be enabled. Existing commissionBasis selects NET_EX_TAX or NET_INCL_TAX and fixedCommissionBasis selects UNIT or LINE. Configured refund policy remains REVIEW_ADJUSTMENT. Existing lineTotal and taxTotal snapshots already include allocated item and bill discounts. Percentage commission = rounded eligible amount × rate / 100. Fixed commission = rounded configured amount × quantity for UNIT, or the configured amount once for LINE. All commission amounts use decimal arithmetic and existing half-up paise rounding. Prices, GST, discounts, payments, salesperson attribution, and invoice totals are unchanged.

Each sale item stores its applied subcategory ID/name, commission type/rate, revenue/fixed basis, eligible amount, quantity, commission amount, and exclusion reason in POSRetailCommission. Unique saleItemId and a non-overwriting upsert protect snapshots from duplicate accrual. Existing checkout idempotency and serializable transactions protect requests and stock/payment atomicity. Repeated administrative voids return without requiring a refund key; refunded cancellation retries return the same sale/return identifiers and response shape as the original request. Future rate/catalog edits do not rewrite completed snapshots.

## Returns, cancellations, deletion, and reports

Partial returns allocate commission and eligible revenue cumulatively from original snapshots. Full returns reverse the exact original amount, including rounding residuals. Return request idempotency and unique adjustment event keys prevent duplicate debits. Refund/cancellation/deletion debits enter POSRetailCommissionAdjustment as PENDING for explicit review by pos.commissionApprove. A decision and mandatory reason are audited; repeat review is rejected. These reviews never modify employee payroll. Net operational commission reports already reflect returned goods and exclude cancelled/deleted bills, independently of review outcome.

Cancellation marks retail snapshots CANCELLED; permanent deletion marks them DELETED. Snapshot and adjustment records deliberately retain scalar sale/catalog identifiers without cascading foreign keys, so audit records survive permitted bill deletion. Existing permanent deletion permissions and accounting restrictions are unchanged. Existing approved/paid legacy employee commissions retain their original reviewed adjustment behavior.

GET /api/v1/pos/commissions/subcategories reports by store, applied subcategory, saved rate/type and basis, with eligible net sales, commission, units, and distinct transactions per group. Store and overall totals use decimal sums. The POS panel provides from/to filters; dates follow existing inclusive IST calendar-day handling (maximum 366 days). Returns restate the original sale period in this commission view, matching the prior pending-proposal adjustment behavior. Separate adjustment review uses adjustment posting dates. The report never groups by employee. GET /commissions/adjustments and POST /commissions/adjustments/:id/review expose the retail review queue; the local POS /commissions and /commissions/:transactionId/review retain legacy history compatibility.

## Migration and rollout

20261025120000_retail_subcategory_commission is additive: two nullable category fields, their validation constraint, POSRetailCommission, POSRetailCommissionAdjustment, and indexes. No legacy records are rewritten, deleted, backfilled, or reinterpreted using today's catalog rates. Old employee commission history stays in its original ledger; the new report starts with post-deployment retail snapshots.

Apply the migration with `prisma migrate deploy` and regenerate Prisma Client before running the updated backend. Configure actual subcategory rates and confirm store basis/enabled settings before relying on the new report. No production database migration was executed during implementation.

## Verification

- Backend TypeScript production build: passed.
- Admin frontend Next.js production build: passed (Google Fonts require network access).
- Frontend `tsc --noEmit`: passed.
- All 16 repository migrations, including this migration: applied successfully to a fresh isolated localhost PostgreSQL test database on port 55439.
- `test:pos:subcategory-commission`: 13 integration checks passed: mixed categories, discounted net/GST calculation, explicit exclusions, duplicate checkout/accrual, rate-history preservation, partial/full refunds, fixed unit/line rates and rounding, tax-inclusive basis, cancellations/deletion, rate validation and authorization, unique reviewable debits, employee-rate independence, and store/date authorization.
- `test:pos:discounts-reports`: 17 regression groups passed, including HTTP report exports, invoice totals, cash reconciliation, returns, and deletion.
- `test:pos:cancelled-sales`: 13 regression checks passed, including concurrent voids, refund retry responses, historical approved employee commission reversals, inventory/GST restoration, and cash reconciliation. Cancellation regression was updated to use cancelSale for retained cancelled history rather than permanent deleteSale, and explicitly seed a pre-migration approved employee commission for legacy reversal coverage.

Changed implementation files: prisma/schema.prisma, the migration above, src/pos/retailCommissions.ts, src/pos/commissions.ts, src/pos/service.ts, src/pos/routes.ts, package.json, scripts/test_pos_subcategory_commission.ts, scripts/test_pos_cancelled_sales.ts, HRM-Admin-Pannel/src/features/pos/POSOperations.tsx, HRM-Admin-Pannel/src/features/pos/POSHistoryModal.tsx, and this document. Flutter employee/mobile screens and unrelated HRM logic are unchanged.
