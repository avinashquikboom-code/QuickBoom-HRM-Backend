# HopKid POS redesign and backend integration — 23 October 2026

## Implementation and root causes

The existing Next.js POS and Express `/api/v1/pos` architecture are retained. The terminal uses the existing Prisma/PostgreSQL product variants, store balances, customers, registers, employees, quotes, sales, tenders and receipt snapshots. No parallel inventory or billing system was introduced.

The earlier product-selection defect is documented in `POS_PRODUCT_SELECTION_FIX.md`: scanning searched a paginated product list, could miss an exact variant, and sent ordinary name searches into an error instead of a usable selection flow. That exact-lookup/cart correction was already present when this work started. Additional defects found and corrected here:

- An in-progress lookup caused subsequent scanner submissions to be discarded. Lookups now queue in order, with a short duplicate-Enter guard. Successful asynchronous additions do not erase the next code being typed. Store changes invalidate queued work for the previous store.
- A search dropdown could remain visible behind the variant picker. Only the relevant chooser is displayed, and cross-product fallback choices use their own parent product.
- The terminal maintained a second floating-point tax/order-discount calculator. It now displays the existing backend Decimal quote and blocks checkout while quotes or scans are pending, including the F8 shortcut.
- Receipt retrieval occurred before clearing a committed cart. A failed receipt fetch therefore left an already-sold cart active. The save acknowledgement now clears it, retains the saved invoice ID, and provides receipt-only reprint recovery.
- A lost sale response could leave retry behavior dependent on subsequent form edits. An unresolved-checkout dialog keeps the cart unchanged and retries the exact payload/key. The real browser test intentionally drops a successful HTTP response after the server commits, then verifies the identical retry and a single inventory deduction.

## UI and behavior

The fullscreen HopKid terminal retains branding, store/register/cashier information, IST clock, authorized store selection, customer selection/walk-in details, scanner input, cart variants, quantity/discount/salesperson controls, summary, configured tenders and footer navigation. Inventory navigation is not reintroduced.

Quick Catalog is loaded independently of typed searches, uses real store-filtered balances/prices, shows product images when available, variant labels and prices, and links View All to the existing product catalog. Autocomplete is debounced. Disabled methods cannot silently remain the selected tender when another configured method is available. Register, catalog, payment-method and quote failures are surfaced in the terminal.

The attachment contained a textual specification but no design image. Exact visual comparison to a separate reference image remains unavailable.

## APIs reused and changed

Reused existing authenticated APIs:

- `GET /context`, `/registers`, `/products`, `/customers`, `/payment-methods`
- `GET /products/lookup?storeId=...&code=...`
- `POST /quote`, `POST /sales`, `GET /sales/:id`
- Existing register operations, history, returns and reports

All paths above are relative to `/api/v1/pos`. No duplicate endpoint was added. Lookup now resolves an exact barcode before an exact SKU, then retains the existing case-insensitive fallback. Sale detail includes the cashier's email and existing profile full name for the receipt, without exposing authentication fields.

Financial authority remains the existing service: tax-exclusive prices, half-up two-decimal line tax, proportional allocation of order-discount cents and no additional cash rounding. Serializable checkout, advisory-lock idempotency, stock checks, transaction rollback, invoice numbering and persisted snapshots remain in the existing backend.

## Changed implementation and test files

Frontend (`HRM-Admin-Pannel`):

- `src/features/pos/POSBillingScreen.tsx`
- `src/features/pos/SalespersonDropdownCell.tsx` (concurrent extraction; reconciled focus/reset behavior)
- `src/features/pos/POSSettingsModal.tsx`
- `src/features/pos/POSThermalReceiptModal.tsx`
- `src/features/pos/posReceipt.ts`
- `scripts/test_pos_e2e.cjs`

Backend (`QuickBoom-HRM-Backend`):

- `src/pos/routes.ts`
- `scripts/test_pos_selection.ts`
- `scripts/serve_pos_e2e.ts`
- `docs/POS_REDESIGN_VERIFICATION.md` (new)

Existing/concurrent store-authentication, stock-message and salesperson work was preserved. Git commits and additional salesperson changes arrived in the shared workspace during implementation; this list describes this task's changes rather than claiming ownership of every current Git diff.

## Database

This redesign introduced no new tables or migrations. The concurrently added `20261023180000_pos_sale_item_salesperson` migration was applied only to the guarded localhost test database to align it with the regenerated Prisma client. Production was not migrated, reset, dropped or used for test sales. Deploy the current workspace migrations through the normal reviewed deployment process before using a Prisma client that expects their columns.

## Executed verification

- Frontend production build: passed with the existing type-check bypass described below.
- Backend TypeScript: passed.
- Existing salary-gross regressions: 26/26 passed; payroll-all-cases: all 12 scenarios passed.
- Focused frontend POS ESLint: passed at the last completed verification.
- Real PostgreSQL POS regression suite: the initial run passed all 47 checks. A final rerun after concurrent salesperson/commission changes passed core checkout/finance/stock/authorization checks but stopped at `scripts/test_pos.ts:976`: its expected commission-return identifier was not found (`P2025`). The current full suite is therefore **not marked passed**. Reconcile the concurrent commission return identifiers and test expectation before release; unrelated commission logic was not rewritten as part of this redesign.
- Real PostgreSQL selection suite: 8 checks passed, including size/color/plain variants, exact barcode priority, checkout, inactive/out-of-stock behavior and store permissions.
- Real HTTP context suite: 12 checks passed, including unauthenticated requests, missing employee/store assignments, inactive stores, forbidden stores and malformed store IDs.
- Browser selection suite: passed. Its API fixtures are mocked; the PostgreSQL and end-to-end suites separately exercise the real backend.
- Real browser/API/PostgreSQL suite: single-product checkout and refund; queued sequential/repeated scans; multi-product discounts/GST; rejected underpayment; lost-response retry; persisted invoice/payment/stock consistency; receipt-load failure followed by reprint without another sale; reports and tablet layout passed. The final expanded rerun passed split Cash/UPI, both 58/80 mm print-layout assertions, and an explicit check that the checkout button remains inside the 1280×800 viewport.
- Repository-wide frontend TypeScript remains blocked by pre-existing access-control, payroll and commission-service diagnostics. A successful Next build skips type checking under the project's existing configuration and does not establish repository-wide type safety.

The tested multi-product invoice used two ₹100 units with a 10% item discount, one ₹199.95 unit, and ₹7.01 order discount. Persisted subtotal ₹399.95, total discount ₹27.01, GST ₹32.38 and payable ₹405.32 matched the server quote and saved tenders (₹100 Cash + ₹305.32 UPI). Stock decreased exactly once despite dropping the first successful checkout response.

All database fixtures used `hopkid_pos_test_verified` on localhost port 55439 with matching `DATABASE_URL`/`POS_TEST_DATABASE_URL`. No live production login, sale or hardware-printer test was performed.

## Printing and remaining requirements

POS Settings provides 58/80 mm thermal width and “Open print dialog after checkout.” Checkout controls remain outside the scrollable tender form on desktop/laptop screens. Set the matching paper size in the operating-system printer driver and select the intended thermal printer in the browser. This uses the browser print dialog; silent printing requires separately configured kiosk/agent support and was not claimed or tested. Print failures never require another sale.

Receipts use saved item/tender/tax snapshots, size/color, cashier profile, customer details and Code128 invoice reference. The browser test intercepts `window.print` to verify invocation; it cannot prove paper output or detect cancellation in a native print dialog. A 58 mm PDF and browser screenshots were generated under `/tmp` for local inspection.

CARD/UPI are recorded tenders under the existing backend policy. No payment-gateway settlement integration or credentials were supplied. Existing production schema/configuration, real store assignments, registers and printer setup need deployment/staging verification before rollout.
