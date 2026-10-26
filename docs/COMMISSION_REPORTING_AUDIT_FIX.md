# Commission reports and webhook audit verification

## Status and limits

Code fixes and isolated database/browser verification are complete. Production recovery is NOT verified. The configured normal database (`localhost:5432/quickboom_hrm`) contained no ARKION product, bill 123, HRM subcategories, mappings, or rates when inspected. The existing SSH deployment connection timed out. No production import, mapping correction, deployment, or historical financial rewrite was performed.

Other commits landed during this investigation. This report describes the reporting/audit work, not unrelated product synchronization or resolver changes incorporated by those commits.

## Confirmed code findings

| Screen | Finding | Correction |
| --- | --- | --- |
| Current HRM subcategory report | Undefined report data was rendered as zero KPIs and an empty report. The report queries the HRM ledger, which remains empty when ingestion is disabled, its receive-date cutoff excludes deliveries, or source/configuration exceptions prevent projection. Which of these applies in production remains unknown. | Render loading/error states, clear stale responses, and expose scoped pipeline counts, import enablement, cutoff, and exceptions. Do not enable an unverified source contract automatically. |
| Previous dashboard / report | Components called shared `/api/admin/commission/*` services backed by `POSRetailCommission`, not the external HopKid HRM ledger. Existing external webhook transactions alone cannot populate this separate POS ledger. | These two screen components use `externalCommissionReporting.ts`; shared POS services and POS application code remain unchanged. Rankings, KPIs, reports, and ledger come from the same HRM source. Fixed rates display their unit/line basis. |
| Report totals and export | Summing per-subcategory bill counts double-counts mixed-category bills. The shared CSV endpoint is separate from the visible HRM report. | Deduplicate eligible original sale documents for the global bill KPI. CSV uses the same filtered report API and returned rows. |
| Audit server | Old reads loaded all employees, sales, credits, exchanges, commissions and payloads into application memory, suppressed query failures as empty arrays, fabricated events from commission transactions, and treated raw receipts as successful processing. | SQL projects real persisted deliveries, paginates payloads, returns count diagnostics, propagates database failures, and distinguishes raw receipts from processed/failed/ignored projections. Exact duplicate payloads in both ingress tables are represented by the primary WebhookLog. Distinct deliveries are not collapsed merely because their bill IDs match. |
| Audit authentication | Shared authentication bypasses `/api/webhook/*`. Adding role-protected audit reads without excluding audit paths from that bypass produced HTTP 401 at the real path; isolated tests mounted at `/webhook` originally missed this. | Audit logs/stats are excluded from the public delivery-path exemption. Audit readers require an HRM admin/HR session; employee and POS sessions are denied. Delivery endpoints retain existing behavior. The regression test uses `/api/webhook`. |
| Audit frontend | Statistics failures were console-only, errors could look like zero totals, requests had the global 60-second timeout, and only the latest 5,000 records were loaded silently. The original logs request already had `finally`; that alone was not an indefinite-loading fix. | Explicit errors and unavailable KPIs, 20-second request timeout, response validation, stale-request protection, and a visible total plus a load-older-deliveries action. Client-side table filters explicitly apply to loaded deliveries. |

The existing IST sale-date parser and exclusive next-day upper bound were retained and tested. Reporting does not replace verified mappings/rates with employee percentages. It reads existing snapshots and signed reversal entries without rewriting them.

## API and database flow

- Current report: `GET /api/hrm/subcategory-commissions/report`.
- Dashboard: the same report endpoint for selected period, IST today and current month.
- Rankings: selected-period report rows; ledger: `GET /api/hrm/subcategory-commissions/ledger`.
- Report/CSV: the same report endpoint, store/subcategory/search/date filters and original sale-date basis.
- Dropdown/configuration: `GET /api/hrm/subcategory-commissions/configuration`.
- Pipeline counts: `GET /api/hrm/subcategory-commissions/diagnostics` (existing report-role/store authorization).
- Audit: `GET /api/webhook/logs`, `GET /api/webhook/stats`, and `GET /api/webhook/logs/:id`.
- Explicit admin import: `POST /api/hrm/subcategory-commissions/process`; disabled imports return a configuration error. Existing exception retries remain audited.

Persistence flow: receiver -> `HopkidWebhookLog` raw receipt / `WebhookLog` processing audit -> enabled HRM worker -> `HrmCommissionInbox` -> normalization, verified subcategory/rate resolution -> transactional `HrmCommissionDocument`, `HrmCommissionLine`, `HrmCommissionEvent`, `HrmCommissionLedger`. `HrmCommissionSettings.ingestSince` is a delivery receive-time cutoff; reporting can use original sale date or posting date. Existing `CommissionTransaction` and `Sales` rows are not silently converted into verified ledger entries.

Additional tables: `HrmCommissionSubcategory`, `HrmCommissionMapping`, `HrmCommissionRate`, `HrmCommissionAudit`, `Store`, `Employee`, `User`. Audit enrichment reads only relevant persisted identities; it does not calculate commissions from employee rates.

## Files

Backend: `src/hrmCommission/routes.ts`, `src/controllers/webhookAuditReadRoutes.ts`, `src/controllers/webhookLogsController.ts`, `src/middlewares/authMiddleware.ts`, `scripts/test_commission_reporting_audit.ts`, `scripts/serve_commission_ui_harness.ts`.

Admin: `src/services/externalCommissionReporting.ts`, `src/features/commission/pages/ExternalSubcategoryCommission.tsx`, `CommissionDashboard.tsx`, `CommissionReports.tsx`, `WebhookLogsPage.tsx`, and `scripts/build_commission_ui_harness.cjs`.

Some of these files were incorporated into concurrent commits during the run; the final working-tree diff alone does not list the whole reporting change.

## Verification

- Backend and admin TypeScript checks passed.
- 13 reporting/audit API integration checks passed against real PostgreSQL in the isolated `hrm_commission_test_reports` database on localhost:55439. Covers populated/empty ranges and stores, full IST end day and next-day exclusion, subcategory/search/invoice consistency, pagination, missing mapping exceptions, pipeline counts, duplicate replay, scope denial, real success/failure/receipt audit statuses, duplicate storage, unauthorized reads, invalid inputs, and HTTP 500 on simulated database failure.
- Existing external ingestion suite: 24 checks passed, including rounding, returns/cancellations, linked exchanges, effective rates, no employee-rate fallback, duplicate delivery, and authorization.
- Actual React screen components were bundled into a clearly marked local UI harness. API requests went to the isolated database-backed server. The harness substitutes only the API client and test authentication and does not validate the full production login shell or styling.
- Browser-observed dashboard ledger and rankings populated. Filtered report displayed a persisted fixture: eligible sales 2130, configured rate 5%, commission 106.50, one bill and one unit. The downloaded CSV contained the same single row and amounts.
- Current ingestion screen displayed persisted report rows and pipeline/exception diagnostics.
- Audit screen displayed stored events and nonzero statistics; a genuinely empty store filter produced a completed empty state; a simulated HTTP 503 produced a visible error and unavailable KPIs, with no fetching spinner or successful-empty claim.

Reproduce API tests by applying existing migrations to an isolated localhost:55439 database whose name includes `hrm_commission_test`, then running the two TypeScript test scripts with that DATABASE_URL. Both reject other database destinations before creating fixtures. Build the optional UI harness with the admin script, then start the guarded backend harness server on localhost:55441. Query `?scenario=audit-empty` or `?scenario=audit-error` to verify those paths. This harness must never be deployed.

## Production work still required

Read diagnostics on the affected deployment. An authorized administrator must establish whether deliveries are absent, ingestion is disabled/cut off, or exceptions identify missing source data, mappings or effective policies. Verify the authoritative catalog and sale-date amount basis before adding configuration. Process retained historical logs only after reviewing historical policies; retry recorded exceptions after correction. If original source payloads are unavailable, obtain an authoritative historical export rather than inventing events. Approved/paid historical totals require the existing auditable reconciliation process.

Retest the affected real API responses and production UI after deployment. ARKION/bill 123 remains unverified; the 5% UI fixture is not its rate or a proposed catalog mapping.
