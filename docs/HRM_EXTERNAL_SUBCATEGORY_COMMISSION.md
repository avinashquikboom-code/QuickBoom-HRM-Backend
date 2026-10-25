# HRM commission projection for external Hopkid sales

## Scope and source of truth

This implementation calculates subcategory commission in HRM from the HopkidWebhookLog.rawPayload records already stored by the existing integration. It makes no outbound Hopkid calls and does not modify the external POS, its configuration, billing, prices, discounts, GST, APIs, or database. Existing webhook handlers, employee commission transactions, wallets, payroll, and their integrations are not changed. Earlier local POS work already present in the repository is not used or reverted by this module.

The admin Commission page defaults to **Hopkid subcategory commissions**. Previous dashboard/report views remain available for compatibility. The new HRM report never derives a rate or grouping from employees, source commission overrides, product category names, or the local POS catalog.

## Data requirements and explicit exceptions

The normalizer accepts invoice/credit-note objects in data or at the root, and lineItems/items/products/SalesProductList/CreditNoteProducts. Each document must supply a stable ID, an existing HRM store ID, and its original business date. Each product line needs a product ID, positive quantity, and either a stable line ID or an unambiguous product/variant combination. Variants/SKUs are exact identifiers, not display-name guesses. Missing or unrecognized data is held for review; no employee is created or required.

Subcategory is resolved from a distinct external subcategory ID (subcategoryId/subCategoryId/SubCategoryID/SubCategoryId/subcategory_id) or an administrator-maintained effective-dated product+variant mapping. A generic CategoryID or subcategory name alone is not sufficient. HRM stores the authoritative external subcategory ID, name, and optional parent category ID separately from POS models.

Eligible revenue uses explicit netAmountExTax/taxableAmount or netAmountInclTax, with recorded tax to convert between bases when available. Existing generic productNetAmount/netAmount/lineTotal/creditAmount fields are used only after an administrator records their verified tax basis and confirms that item and bill discounts are already allocated. No calculation changes external invoice amounts. A supplied but unverified refund amount is held, rather than silently replaced with a quantity-based estimate.

Inspect representative real Hopkid invoices, credit notes, cancellations, and exchanges before enabling import. Actual external API contracts were not verified or changed. Sparse payloads remain visible exceptions; this worker does not fetch the external POS or assume that the local POS product tree is its catalog.

## HRM-only configuration and calculation

Administrators register subcategories, append product mapping versions, and append commission rate versions. Policies are scoped to an optional HRM store (storeKey 0 means all stores) and an explicit effective-from instant. Store-specific policies take precedence over global ones; the latest policy effective on the original sale date is selected. Missing historical/current policies exclude the entire document as an exception. They never fall back to current employee rates or today's policy.

Policy types are PERCENTAGE and FIXED. Basis is NET_EX_TAX or NET_INCL_TAX. Fixed amounts are per UNIT or LINE. Rates must be nonnegative, finite, at most four decimal places, and no greater than 100 for percentages. Configuration versions cannot duplicate the same subcategory/store/effective instant. Creating a new effective version updates future behavior without editing completed snapshots. API actions are audited; database constraints also validate policies.

Percentage commission is eligible net revenue × rate / 100, rounded half-up to paise. Fixed UNIT commission is rate × quantity; fixed LINE commission is the configured amount once per line. Zero eligible revenue earns zero, including fixed policies. Applied subcategory, rate/version, basis, quantity, eligible revenue, and commission are copied into HRM line state and immutable ledger entries.

## Documents, revisions, returns, and historical safety

The projection reads logs independently of legacy employee matching. Import starts disabled. Once explicitly configured and enabled, a separate HRM worker reads up to 100 previously unprocessed logs per minute, ordered by receipt time and ID from the configured ingest-since date. Administrators can process a batch or retry exceptions. Successful and unsupported-event receipts are not repeatedly processed; exceptions require review and retry.

A normalized economic fingerprint deduplicates repeated deliveries even if employee information or delivery metadata differs. Original source logs are never updated. Store-scoped PostgreSQL advisory locks serialize document processing across worker instances, protecting refund limits and duplicate events. A transaction contains all document/line/ledger changes and receipt completion.

Invoice updates retain existing line policies and append signed economic deltas. Conflicting changes without a strictly newer source update timestamp are held. Older timestamped versions cannot overwrite newer state. Product/variant identities cannot be reassigned to an existing sale line. Invoice revisions that affect lines with existing refunds require explicit reconciliation rather than silently rewriting refunded earnings.

Credit notes must identify an original invoice in the same store and an exact original line, or a unique matching product/variant. Refund revenue and quantity cannot exceed the original sale across credit notes. Quantity-only returns allocate from original discounted snapshots. Percentage reversals allocate against original eligible revenue; fixed reversals allocate by original quantity. Cumulative rounding ensures full returns reverse the exact original commission. Credit-note cancellation appends a restoring entry; it does not delete the original debit.

Cancelled, deleted, inactive, or fully returned invoice statuses zero the remaining contribution, including existing partial credits without double reversal. Tombstones prevent a cancelled document from being automatically resurrected. Partially returned invoices retain their original sale contribution while linked credit notes represent the returns. Ambiguous references or states are exceptions.

An exchange with explicit IsOld line directions, stable exchange identity, and original-invoice references is normalized into linked return and replacement documents. Both sides commit in one transaction; an invalid replacement rolls back the return. The returned side uses original snapshots; replacements use their own sale-date policy.

Historical imports are opt-in through ingest-since and explicitly dated mapping/rate versions. Missing historical evidence remains unresolved. Existing employee commission, payroll settlements, and earlier ledger records are never overwritten or reclassified. This is the staged report/projection cutover approved in the plan; disabling legacy employee commission feeding into payroll is a separate business decision.

## Reports and APIs

All routes are HRM-owned under `/api/hrm/subcategory-commissions`:

- GET `/configuration`: source settings, subcategories, mappings, effective rate history, and administrator capability.
- PUT `/settings`: explicit enable/disable, receipt cutoff, and source amount contract.
- POST `/subcategories`, `/mappings`, `/rates`: audited HRM configuration.
- GET `/exceptions`, POST `/exceptions/:id/retry`, POST `/process`: administrator-only import management.
- GET `/report`: subcategory and store summaries with applied rate/basis, eligible net sales, net commission, reversals, net units, and distinct earning sale transactions. Fully reversed lines do not count as eligible transactions.
- GET `/ledger`: paginated immutable entries with source references and calculation snapshots.

Reports accept from/to inclusive IST calendar dates (maximum 366 days), optional storeId/subcategoryId, and dateBasis sale or posting. Sale basis attributes reversals to the original sale date; posting basis uses the receipt date and exposes late adjustments in the period received. Rate changes can produce separate rows for one subcategory; decimal totals aggregate them without assuming a uniform rate.

Administrator roles manage configuration; authorized HR readers can report; store managers are restricted to their token's assigned store. Employee and POS-store-session credentials are rejected. Existing API endpoints are preserved, and the new projection has no employee-payroll relationships.

## Database and rollout

The additive migration is `20261026010000_hrm_external_subcategory_commission`. It creates only these ten HRM-owned tables: HrmCommissionSettings, HrmCommissionSubcategory, HrmCommissionMapping, HrmCommissionRate, HrmCommissionInbox, HrmCommissionDocument, HrmCommissionLine, HrmCommissionEvent, HrmCommissionLedger, HrmCommissionAudit. No existing table is altered and no data is backfilled by the migration.

Before deployment, review the pending migration queue. Do not apply unrelated pending POS migrations as part of this rollout. Apply the HRM migration through the normal reviewed deployment process and regenerate Prisma Client. No production migration was executed during implementation.

After deployment, verify real source fields against invoices, configure actual external IDs and historical/current policies, choose an explicit receipt cutoff, and enable HRM import. Review exceptions and compare sample invoice/refund calculations before relying on the report. Configuration changes do not resolve exceptions automatically: retry after correcting missing evidence. Payroll stays on its existing behavior.

## Verification

- Backend production TypeScript build: passed.
- Frontend Next.js production build: passed (existing Google Fonts require network access).
- Frontend standalone TypeScript check: passed.
- All 17 repository migrations applied to a fresh isolated localhost test database at port 55439; the new migration created only HRM tables.
- `test:hrm:subcategory-commission`: 24 integration/API groups passed. Coverage includes mixed rates; employee/POS-override independence; duplicate/concurrent delivery; historical policies; discount/GST contracts; explicit missing-data exceptions; fixed line/unit rounding; original-value partial/full refunds; returned/cancelled invoices; credit cancellation; source revisions; linked exchanges and rollback; exact store/subcategory report totals; invalid/duplicate configuration; authorization and store scope; and absence of writes to legacy commission/POS records.
- `test:salary-gross`: 26/26 existing salary regression checks passed.
- No live external Hopkid calls, production fixture writes, production import, or payroll changes were performed.

Backend files: prisma/schema.prisma (new Hrm models only), the new migration, src/hrmCommission/{normalize,projection,routes,worker}.ts, src/index.ts (new HRM route and independent worker registration), scripts/test_hrm_external_subcategory_commission.ts, package.json, and this document. Frontend files: src/features/commission/pages/ExternalSubcategoryCommission.tsx and src/app/(admin)/commission/page.tsx. Other pre-existing workspace changes are outside this module.
