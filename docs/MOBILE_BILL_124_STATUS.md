# Mobile HWM-124: investigation and verification

The supplied phone screenshots identify HWM-124, WAREHOUSE, sale amount 2000, one unnamed product, pending commission, and a missing subcategory mapping. They do not identify the product or its applicable rate. This is distinct from the earlier ARKION/HWM-123 report.

## Actual affected-data check

Read-only queries against the configured normal database (localhost:5432/quickboom_hrm) returned no CommissionTransaction for bill 124/HWM-124 and no HopkidWebhookLog for billId 124. That database currently has 28 POS products and 3 HRM mappings, but they cannot establish the identity or category of the screenshot's invoice. The affected deployment was subsequently retested through the connected phone session; see the live evidence below. No rate, product identity, mapping, or financial amount was invented for it.

## Confirmed code defects corrected

- Saved item recovery selected mappings without the sale-date cutoff and could prepopulate a future mapping before the effective-dated resolver ran. Recovery now leaves mapping resolution to the sale-date resolver, with exact variant precedence over product-wide mappings.
- Recovery guessed subcategory identifiers from category-name slugs, inferred product identity from non-unique names, and inferred tax basis from current policies or an unconditional NET_EX_TAX default. Those financial inferences were removed.
- The resolver created catalog and rate records during reads, including guessed name matches, backdated 2020 effective dates, hardcoded creator IDs and current POS rates. Resolution now reads only actual external subcategory IDs and explicitly configured HRM mappings/rates; missing rates return HISTORICAL_OR_CURRENT_RATE_MISSING.
- Saved placeholder names were not enriched from an exact persisted product primary key, and the display array was built before recovery. Exact primary-key catalog names now feed both the item breakdown and purchased-products list. Existing genuine source names remain intact. Unknown products cannot be named from a guessed variant/category.
- Webhook persistence spread the recovered result and then overwrote its productName with the old placeholder. It now retains the recovered catalog name. New invoice/salesman allocations no longer invent prod-N/SALESMAN-N catalog IDs or treat employee names as product names; missing identity remains a data error.

The fix is in backend processing, not a Flutter serializer workaround. Employee commission percentages are not fallbacks. Approved/paid financial snapshots retain their existing freeze/reconciliation behavior. No HopKid POS application files, schema migrations, production records, or normal local database records were changed by this work.

## Files

- src/hrmCommission/resolution.ts
- src/services/invoiceItemRecovery.ts
- src/services/invoiceCommissionService.ts
- src/controllers/webhookController.ts
- scripts/test_mobile_invoice_subcategory_commission.ts
- scripts/diagnose_mobile_invoice.ts

## Verification

The mobile API regression suite uses a guarded isolated PostgreSQL database on localhost:55439 whose name contains hrm_commission_test. It verifies exact-name recovery for raw and saved items, matching purchase/breakdown names, effective mapping selection, no future-only mapping use, no guessed category-name IDs, no inherited POS rates, explicit missing-configuration/data errors, actual HTTP response fields, webhook persistence, and preserved approved history. Configured fixture: eligible sales 2000 at a configured 5% gives 100; this is not HWM-124 or a proposed rate for it.

The existing 24-check external ingestion suite and all 12 Flutter invoice model/widget tests passed. Backend TypeScript checks pass. Flutter renders server nulls as unavailable and does not invent a commission; no APK/UI change was needed for the confirmed backend defects.

## Required affected-deployment follow-up

Deploy the backend change, then run the read-only diagnostic against the affected database:

    npx ts-node --transpile-only scripts/diagnose_mobile_invoice.ts 124

It sets its database transaction READ ONLY and emits product/configuration evidence without credentials or customer details. It does not correct or import anything. An authorized operator must verify the original product ID and its authoritative catalog mapping, configure the correct sale-date HRM mapping/rate and verified amount basis if missing, and retrieve missing original invoice lines if necessary. Then retest GET /api/mobile/commission/bill/124 for the affected employee and inspect the phone screen. The screenshot's unknown product cannot safely be assigned a name/category/rate without that evidence.

## Connected Android phone investigation — 26 October 2026

Accessed the existing debuggable `org.quickboom.hrm` session on the connected CPH2321 phone. No reinstall, login clearing, credential export, or production writes were performed. Requested the actual API through the app's existing authenticated client, without extracting the bearer token.

- Live GET /api/mobile/commission/bill/124: success response, HWM-124, sale 2000, SAVED_PRODUCT_BREAKDOWN, productID `00000000-0000-0000-0000-000000000000`, Unknown Product, subcategory/rate/commission null, MISSING_CONFIGURATION, hasMissingInvoiceData false. This proves a missing product identity is incorrectly accepted as a mappable product by the deployed normalizer.
- Live GET /api/mobile/commission/bill/123: success response, HWM-123, sale 2130, ARKION UUID `0e0b727a-6322-48b1-afe9-0e9e3a23d03e`, variant 0/Cream, SAVED_PRODUCT_BREAKDOWN, subcategory/rate/commission null, SUBCATEGORY_MAPPING_REQUIRED. No authoritative subcategory or rate was recovered.
- Employee webhook feed contains bill 124 raw-log reference `76423b40-9d8e-4c4f-97d5-7e21523bf4f1` and event ID `f1698f6a-faf8-4e73-bf83-fac8b5dbcacd`; bill 123 raw-log reference `94b69790-c518-4ea7-8b89-ff54fdb779a3`. The feed reports SUCCESS and commission 0, but does not expose raw line items. That status does not establish configured commission.
- Requesting the bill-124 raw-log UUID through the authorized mobile invoice endpoint returns `Invoice store is missing`. Requesting its protected webhook detail through the same account returns `Forbidden. You do not have permissions to perform this action.` No role change or permission bypass was attempted.

Additional correction: `src/hrmCommission/normalize.ts` rejects the exact all-zero Guid.Empty product ID as PRODUCT_ID_MISSING before mapping/rate resolution. This applies to ingestion as well as mobile reads, so a supplied subcategory cannot give an unidentified product commission or auto-approve it. Existing approved history remains frozen. Three added integration tests cover the actual saved-data shape, a raw line with an otherwise configured subcategory, and webhook persistence staying pending with a data error. All 39 mobile integration checks, all 24 external ingestion checks, and TypeScript compilation passed.

This change has NOT been deployed to the affected server. The phone still shows missing configuration. Actual resolution requires an authorized server operator to inspect the above raw logs, repair the invoice/product/store linkage using authoritative records, and supply the verified effective-dated ARKION mapping/rate. Phone access alone does not grant that server permission. A corrected live response has not been obtained; the production issue remains unresolved.
