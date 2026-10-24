# POS reports and discount corrections

## Discount rules

Fixed item discounts retain the existing **per-unit** convention. New typed
item inputs use `discountType: "percent" | "amount"` and `discountValue`.
Legacy `discountPerUnit` remains supported as a fixed per-unit amount. Mixing
both input forms is rejected. Percentage values are validated between zero and
100. Discounts are calculated with Prisma Decimal on gross line value, rounded
half-up to two decimal places, then deducted before the stored GST rate applies.
This fixes early per-unit percentage rounding on multi-unit decimal prices.

`finance.ts` supplies `lineTotals` and `billTotals` for both quote and checkout.
The frontend renders their server quote snapshots, rather than running a second
floating-point pricing engine. Blank manual rows no longer issue empty quotes.
Typed discounts are validated independently on the backend using catalog prices
or authorized overrides, quantities, eligibility flags and the existing tax
configuration. Negative discounts and discounts exceeding price/eligible base
are rejected. Empty discount values mean zero. Percentage/fixed decimal inputs
are accepted and final currency amounts are rounded to two places.

Bill discounts apply once, proportionally across eligible post-item-discount
bases before tax. The existing UI offers a fixed rupee bill discount; its design
is preserved. The API also supports `orderDiscountType: "percent"` where needed.
Quote responses expose separate `itemDiscountTotal` and `orderDiscountTotal`.
Fully discounted invoices can complete for zero, without fabricating a positive
payment or inserting forbidden zero-valued payment records. Receipts show
“No payment due”. Legacy request hashes retain their original shape so retries
of previously saved legacy payloads remain compatible.

New completion audit metadata records item discount type/value/amount, actual
bill discount allocation, tendered amount and change. No historical totals or
schema fields are rewritten.

## Reports

The existing `/pos/reports` navigation now opens a responsive dedicated page:

- Summary: collected sales, net collected, completed/recognized invoice count,
  cancellations, items, discounts, GST, cash/card/UPI, average bill and refunds.
- Sales: hour/day/week/month grouping, custom periods, equal previous-period
  comparison, sales/payment/store/top-product and discount/GST charts.
- Invoices: identity, customer/contact, cashier, salesperson, item count,
  subtotal/discount/tax/total, tenders, status, view/print/PDF actions.
- Payments: saved receipts/references, split indicators, tender/change when
  recorded, grouped day/store/method totals.
- Products: saved product/barcode/SKU, units, gross, discounts, net before GST,
  collected GST, average selling price, best sellers and active zero-sale items.
- Discounts: invoice details and date/store/cashier groups with recorded item,
  bill, percentage/fixed and unclassified historical discount totals.
- Tax: stored taxable base/rate/GST by invoice, store and date. Separate
  CGST/SGST/IGST values were not stored, so they are shown as unavailable.
- Employees: distinct bills, attributed item sales/discounts/quantity, average
  bill and explicitly invoice-level tender details (no invented apportionment).
- Stores: distinct recognized/cancelled bills, discounts, GST and tender totals.
- Registers: original opening balance, actual cash receipts/refunds/movements,
  expected/actual cash, variance, times, staff and status. Closed snapshots stay
  intact. Report sessions overlap the selected period; ordinary History retains
  its existing opening-date filter.
- Cancellations: original invoice/amount, reason, user/time and stock-ledger
  evidence when available. Manual items have no stock ledger requirement.
- Returns: actual refund records, original invoice, method, reason and posting
  date, including cancellation payouts for operational audit.
- Advanced: the existing report explorer and commission review are preserved.

Today, yesterday, last 7/30 days, this/previous month, custom dates, authorized
stores/all authorized stores, employee, tender, status, search, sorting,
pagination, reset and refresh are supported. Register status uses Open/Closed;
payment/search controls do not reinterpret a register's physical cash ledger.
Dates use IST and the existing validated maximum 366-day report range.

Employee filters match invoices containing that employee. The employee table
attributes individual items, while summary cards retain whole matching invoice
values. Payment totals are never multiplied through item joins. Recognized
sale/return states retain original-invoice accounting, ordinary refunds reduce
net collected on posting date, and cancelled invoices and cancellation credits
are excluded together. Physically deleted invoices contribute no facts.

Historical item discount types, tendered cash and change cannot be reconstructed
reliably and remain unavailable when absent. Existing legacy bill discount audit
amounts are usable. No tax jurisdiction split is inferred from a single GST rate.

## APIs and export

All new APIs enforce `pos.reports`, explicit store scope and validated filters:

- `GET /api/v1/pos/reports/overview`
- `GET /api/v1/pos/reports/details?report=sales|invoices|payments|products|discounts|tax|employees|stores|sessions|cancelled|returns`
- `GET /api/v1/pos/reports/export?report=...&format=csv|xlsx`

Details support `page`, `pageSize` (max 100), `direction`, `groupBy`, `from`,
`to`, `storeId`, `employeeId`, `paymentMode`, `status` and `search`.
Report CSV/Excel exports read all matching pages in one repeatable-read snapshot (up to one million rows per export).
CSV is quoted and protected against spreadsheet formula injection. A two-minute
transaction bounds long exports. Print includes report/store/date/generated-time
metadata, summary and current detail page, with matching count/page disclosed.
Bill exports reuse the existing authenticated PDF/CSV/Excel flow and inherit
current date/status/tender/employee/search filters; all-store users must choose
one explicit store for bill export. Existing Print/Slip/bill export paths remain.

## Main files

Backend: `src/pos/finance.ts`, `src/pos/service.ts`, `src/pos/reporting.ts`,
`src/pos/routes.ts`, `src/pos/billExports.ts`,
`scripts/test_pos_discounts_reports.ts`, `scripts/test_pos_manual_items.ts`,
`package.json` and this note.

Frontend: `src/features/pos/POSBillingScreen.tsx`,
`src/features/pos/POSReports.tsx`, `src/features/pos/POSWorkspace.tsx`,
`src/features/pos/POSBillExportDialog.tsx`,
`src/features/pos/billExportClient.ts`, `src/features/pos/posReceipt.ts`,
`src/features/pos/receipt.css`,
`scripts/test_pos_discounts_reports.cjs`, `package.json`.

## Verification

Backend and frontend production builds and independent frontend TypeScript
checking passed. Seventeen backend regression groups cover the seven requested
examples, decimal rounding, multiple products and bill discounts, zero invoices,
invalid inputs, split payments/receipts, all eleven report SQL paths, grouped
payments/discounts, deleted/cancelled bills, multi-store access, previous periods,
refunds/cancellation credits, register cash and filtered real-API CSV/Excel.
Thirteen existing manual-billing scenarios passed after updating a stale
employee-validation assertion to the current wording.

Chrome end-to-end verification passed discount type/quantity changes, bill
allocation, payment/change, saved totals, receipt print-document contents,
report summaries/tabs/search/grouping, CSV/report print, filtered bill exports
and mobile layout, plus report print-media inspection, with no browser runtime errors or invalid quote responses
for the valid input flow. Tests use isolated local PostgreSQL, never production.
