# HWM-130 commission investigation and fix

## Verified scope and current status

Live GET /api/mobile/commission/bill/130 was requested through the connected phone's existing authenticated HRM client. It returned HTTP 200, HWM-130, sale 2320, ARKION UUID 05bd67b2-2658-43ec-bdb7-6af249bacd4d, variant 0/Cream, SAVED_PRODUCT_BREAKDOWN, MISSING_CONFIGURATION / SUBCATEGORY_MAPPING_REQUIRED, and null subcategory/rate/commission. Its date/createdAt was 2026-10-26T04:43:11.000Z.

The configured normal local database initially had no invoice 130. A later read-only diagnostic found a different local HWM-130 record created at 2026-10-26T11:16:17.203Z, no POSProduct row for the specified UUID, and an HRM mapping to subcategory c7c567bb-395c-4012-9bdc-7fdb74d240a0. That subcategory is named Shirts, externalId shirts, with a stored 4.5% NET_EX_TAX rate; both mapping and rate have an effective date in 2020. No matching HRM configuration audit entries were found. These local records do not prove the production relationship or historical effective date. This work did not create or change them and did not copy them into production.

The production database/product master has not been accessed. Therefore the precise underlying production condition (absent product category, absent HRM mapping, or mismatched identity) remains unverified. The actual live invoice is not claimed fixed. The final debugger retest could not reconnect (local VM service ECONNREFUSED); the earlier authenticated live response above remains the last confirmed server result.

## Architecture and actual defects

Webhook processing calls calculateInvoiceCommission, which normalizes original line items or recovers saved productBreakdown, resolves subcategory and rate, computes eligible revenue and item commission, then persists the result. The mobile bill controller calls mobileInvoiceDetail and the same calculator. Approval freezes snapshots; approved/paid data uses its recorded snapshot and reconciliation rules.

Actual Prisma identities:

- POSProduct.id is a UUID. POSProduct.categoryId is the declared FK to POSCategory.id; the category query explicitly includes category.
- HrmCommissionMapping stores exact productId, optional variantId, subcategoryId and effectiveFrom. subcategoryId identifies HrmCommissionSubcategory.id.
- HrmCommissionSubcategory.externalId identifies its upstream category; names are display text.
- HrmCommissionRate identifies the HRM subcategory, store/global scope, amount basis, percentage/fixed type, fixed unit/line basis and effective date.

The resolver had name/slug guessing and swallowed database errors. It now reads exact external IDs, dated product/variant mappings, or an exact persisted product-category association whose category ID/externalCommissionCategoryId matches a unique HRM externalId. A catalog association updated after the sale cannot establish historical mapping; use an audited dated HRM mapping instead. Conflicting catalog identities return missing configuration. Read paths create no mappings or rates.

Webhook processing also had a separate fallback to direct/policy/employee rates after the shared calculator failed. A regression reproduced auto-approval/employee-rate commission for an invalid Guid.Empty line. This fallback was removed for the external invoice item path. Nulls, missing reason and actionable message from the shared calculation now persist into the saved breakdown.

Mixed-rate complete invoices legitimately have null header commissionPercent. Completeness now checks configured item snapshots rather than falsely treating that header as missing configuration.

## Active rules and migration

The existing HRM rate model had no active/inactive field. The narrow migration adds HrmCommissionRate.isActive, default true, preserving existing rules. The existing audited POST /api/hrm/subcategory-commissions/rates endpoint accepts optional boolean isActive; omitted means true. Inactivation is a new effective-dated version, not an edit to financial snapshots. The applicable latest store/global version is chosen first. An inactive chosen version returns SUBCATEGORY_RATE_INACTIVE; it cannot silently revive an older/global rule.

Run the migration on the intended deployment before restarting the changed backend:

    npx prisma migrate deploy
    npx prisma generate

Do not migrate a different local database and assume the server was updated. Migration was applied only to the isolated test database by this work.

## Calculation and persistence

Existing Decimal eligible-revenue selection and half-up two-decimal rounding remain unchanged. Percentage = verified eligible revenue × configured percentage / 100. Fixed UNIT = configured value × quantity; fixed LINE = configured value once. Configured zero is valid. Missing amount basis remains a data error. Employee percentages are not a fallback. New configured invoices save subcategory ID/name, rate, commission type/basis, rate ID, eligible sale and item amount using the shared result.

Pending historical invoices can resolve an existing dated verified mapping at read time; no financial backfill or approved-record rewrite is needed. If source identities cannot be verified, the API preserves missing configuration with an instruction to verify the exact product ID and create an effective-dated HRM mapping/rule. Mobile already consumes nulls and the backend configurationMessage; a regression verifies inactive-rate messaging without inventing amounts.

## Tests

Guarded isolated PostgreSQL localhost:55439/hrm_commission_test_reports:

- 46 mobile invoice integration checks passed, including the exact HWM-130 reference and product UUID through the real mobile controller with explicitly configured test records.
- 24 external ingestion checks passed.
- 16 Flutter model/widget tests passed, including inactive-rule messages, nulls, configured zero, mixed rates, fixed rates, historical snapshots and narrow widths.
- Backend TypeScript compilation and diff whitespace checks passed.

The HWM-130 test fixture explicitly configures 5% and verifies 2320 × 5% = 116. This is a test fixture, NOT the verified rate/amount for the real invoice. Other tests cover exact catalog identity resolution, rejection of guessed names, mapping effective dates, inactive latest-version blocking, fixed per-unit/per-line rounding, webhook snapshots, no employee fallback and historical preservation.

## Required production evidence and verification

An authorized server operator should run this read-only diagnostic from the deployed backend directory with its existing database configuration:

    npx ts-node --transpile-only scripts/diagnose_mobile_invoice.ts 130 05bd67b2-2658-43ec-bdb7-6af249bacd4d

It uses a READ ONLY transaction and reports invoice identity, original/saved lines, exact product/category relation, mappings, subcategories, rates and migration availability, including when the invoice itself is absent. It emits no credentials or customer data. It also works before the active-field migration.

Only after catalog/admin evidence establishes the correct subcategory and effective date should the existing audited mapping/rate endpoints be used. Then retest the actual employee GET /api/mobile/commission/bill/130 and phone screen: persisted subcategory/name and applicable rate, verified eligible revenue, item/header total equality, and COMPLETE only when all required inputs are valid. Otherwise preserve the actionable error. No server access details have been supplied, so production correction/deployment and this successful live verification remain pending.

## Changed files

- prisma/schema.prisma
- prisma/migrations/20261026100000_hrm_commission_rate_active/migration.sql
- src/hrmCommission/resolution.ts
- src/hrmCommission/routes.ts
- src/services/invoiceCommissionService.ts
- src/services/invoiceCommissionCompleteness.ts
- src/controllers/webhookController.ts
- scripts/diagnose_mobile_invoice.ts
- scripts/test_mobile_invoice_subcategory_commission.ts
- QuickBoom-HRM-App/test/invoice_subcategory_commission_test.dart

No HopKid POS application files were changed. Product/catalog information was read from the existing backend models; no guessed production mapping, arbitrary rate, or approved financial correction was applied.
