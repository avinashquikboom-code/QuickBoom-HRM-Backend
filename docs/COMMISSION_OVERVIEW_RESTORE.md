# Commission Overview earnings restoration

## Scope and status

The existing My Wallet > Commission Overview screen, existing mobile activity/wallet/bill APIs, existing approval API and existing HRM process API are reused. No new endpoint was added. No production mapping or rate was guessed, no HopKid POS application file was modified, and no production financial record was rewritten.

The updated debug APK was built and installed in place on the connected CPH2321 phone, preserving login/data. Live Commission Overview still reports 11 unresolved invoices, today's recorded sales 14569, commission 0, and configuration-required cards for HWM-131/130/129. The warning/card message is now explicit. Pull-to-refresh was exercised and the screen remained functional. A screenshot was saved at /private/tmp/hrm-commission-overview-after.png.

Production reconciliation has NOT run. The configured SSH alias GSRKHVK_AWS_SUBHAM_PUBLIC still timed out connecting to 13.202.136.71:22. The previous phone session lacks raw-webhook/admin authorization. Actual production mappings therefore remain unverified; the green badge cannot truthfully be manufactured for those 11 invoices.

## Confirmed defects corrected

1. The product metadata reader accepted subcategoryExternalId and related explicit aliases, but commission normalization accepted only a smaller ID list. A verified upstream external ID could be discarded before resolution. Normalization now reuses extractProductLineMeta for the same exact subcategory identity. Name-based guesses are not introduced.
2. Mobile activity correlated transactions using numbers that could be derived from internal database IDs. It now correlates exact persisted bill/invoice identities for the employee and supplied store, rejects ambiguous matches, and preserves unique historical matches with a missing legacy store field. Raw payload commission values are not accounting authority.
3. Activity responses now expose commissionEarned and commissionAmount consistently from the saved accounting record, plus explicit completeness flags. Older approved/paid values remain their recorded amounts. Unresolved nulls remain null.
4. Pending invoices could remain stored at zero after a valid mapping was added. An explicit administrator reconciliation operation now previews pending invoices using the existing prepareInvoiceApproval/shared subcategory calculator. Applying reviewed transaction IDs freezes the resolved item snapshot using the existing approval convention, records CommissionHistory and HrmCommissionAudit, and adjusts only the pending invoice's wallet delta. Missing configuration/data blocks the entry. Approved/paid records are not selected or changed.
5. Invoice persistence and wallet credit previously used different transactions, and concurrent first deliveries could both observe no invoice row. Invoice creation now takes a transaction advisory lock before checking rows. Wallet credit participates in that same transaction and serializes updates for an employee. Failure rolls back both accounting and credit; a retry cannot create an extra credit. The existing external-invoice approval path likewise credits its calculated delta atomically; an already approved/paid invoice returns without another credit.
6. Daily/yesterday/week/month metrics exclude unresolved provisional commission amounts, sum currency with Decimal, and round to the existing two-decimal rule. Tests reproduced and corrected a 70.89999999999999 aggregate while the item/header amount was correct.
7. Flutter retains the existing green earned badge, colors, type sizes, padding, card structure and navigation. It uses backend commissionEarned (legacy commissionAmount only if the newer key is absent), never a Flutter percentage calculation. Explicit missing configuration cannot become a fabricated green zero badge. A configured zero remains valid. Unresolved cards say Commission configuration required and wrap on narrow screens. Manual wallet refresh and app resume signal the activity widget to reload too; existing commission WebSocket subscriptions reload both views.

## Older versus newer records

The accessible local database includes older approved subcategory snapshots with populated IDs/rates, newer pending missing-mapping snapshots, and test/legacy employee-fallback snapshots. It is not the production database and contains test data, so these records do not establish the authoritative mapping for the real 11 invoices. Tests explicitly compare a recorded approved amount to newly unresolved/reconciled invoices and preserve the older value, including a historical null storeId.

Existing exact-ID/effective-date mapping and active-rate resolution remain in use. The prior HWM-130 investigation and required rate-activation migration are documented in HWM_130_COMMISSION_FIX.md. No arbitrary catalog sync or backdated mapping is performed here.

## Controlled server reconciliation

Run from the deployed backend using its existing database configuration and a real administrator user ID. Ensure all repository migrations, including the prior isActive migration, have been applied before restarting the changed backend.

Preview only (no financial writes):

    npx ts-node --transpile-only scripts/reconcile_pending_invoice_commissions.ts --actor-id ADMIN_USER_ID

Inspect each READY/BLOCKED result. Where configuration is absent, verify the product's authoritative category, exact HRM subcategory mapping, store/global active rate, sale-date applicability and eligible-sale basis. Use the existing audited configuration endpoints; do not copy an unverified local rate or backdate a current category by assumption.

Apply only explicit transaction IDs reviewed in the preview:

    npx ts-node --transpile-only scripts/reconcile_pending_invoice_commissions.ts --actor-id ADMIN_USER_ID --transaction-id REVIEWED_TRANSACTION_ID --apply

Repeat --transaction-id for additional reviewed IDs. Apply without explicit IDs is rejected. The operator deliberately approves only the pending invoices with verified complete calculations; approved/paid snapshots are untouched. Incomplete or shared-allocation invoices remain blocked for review. Repeating the apply does not repeat credits.

The existing POST /api/hrm/subcategory-commissions/process also accepts reconcilePendingInvoices=true, dryRun=true/false, transactionIds and limit. It retains its existing administrator authorization and enabled-import requirement. Its existing source projection still runs; dryRun previews the additional reconciliation, not the entire original projection operation. Normal calls without the flag keep their original response/behavior. Apply requires an explicit reviewed ID list.

After processing, check the actual employee's existing APIs:

- /api/mobile/commission/webhook-logs: SUCCESS and identical commissionEarned/commissionAmount for a resolved invoice, nulls and configuration flags for unresolved ones.
- /api/employee/commission/wallet: today's aggregate equals the persisted eligible commissions and includes no provisional missing-configuration credit.
- /api/mobile/commission/bill/INVOICE_REFERENCE: configured subcategory/rate, eligible sale, item amounts and header total reconcile.

Then refresh the installed phone app and verify the existing green Commission Earned +₹XX.XX badge. The amount must be the server result. No successful production result is claimed until these checks pass.

## Verification

Isolated database only: localhost:55439/hrm_commission_test_reports, guarded by the integration scripts.

- 9 Commission Overview integration checks: dry-run/no writes; concurrent reconciliation once; retry/history preservation; blocked mapping/non-admin denial; transaction rollback; concurrent first webhook delivery; verified external subcategory alias persistence; real primary/raw source activity amounts; wallet/bill/aggregate consistency.
- 46 existing mobile invoice integration checks passed after the transaction/approval changes.
- 24 external ingestion regression checks passed after canonical subcategory extraction.
- 26 Flutter model/widget checks passed, including the legacy +1.29 example from fixture data, other actual fixture amounts, configured zero, absent configuration, reversals, and narrow-width layout. The focused 10 badge tests also passed after the wrapping change.
- TypeScript compilation, Flutter analysis for changed wallet/activity screens, and diff whitespace checks passed.
- Debug APK build and in-place device installation succeeded.

No fixture rate is proposed for a real invoice. Regression fixtures configure their own policies explicitly.

## Files

Backend: src/hrmCommission/normalize.ts; src/controllers/mobile/mobileCommissionController.ts; src/controllers/webhookController.ts; src/controllers/commissionController.ts; src/utils/commissionHelper.ts; src/services/commissionService.ts; src/services/pendingInvoiceReconciliation.ts; src/hrmCommission/routes.ts; scripts/reconcile_pending_invoice_commissions.ts; scripts/test_commission_overview_reconciliation.ts.

Flutter: lib/features/commission/presentation/widgets/webhook_logs_widget.dart; lib/features/commission/presentation/screens/commission_wallet_view.dart; test/webhook_activity_commission_test.dart.
