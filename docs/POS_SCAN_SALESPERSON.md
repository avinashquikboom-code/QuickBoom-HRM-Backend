# POS scanning and salesperson delivery — 23 October 2026

## Root causes and final behavior

The scanner already called the real POS backend, but a failed exact lookup could fall through to a paginated substring search and automatically add its only result. A partial/random code could therefore select a different registered code. Automatic additions now require an exact barcode/SKU lookup or an exact product name/product code. Partial product names expose choices; partial barcode/SKU/product-code matches do not substitute a variant. A missing code shows exactly:

> Product not found. Please verify the barcode or register this product first.

Quick Catalog and its background request are removed. The cart starts empty. Both scanner fields feed one ordered lookup queue, using actual variant UUIDs and selected-store stock. The submitted field is cleared synchronously, so duplicate Enter submissions see an empty field; a genuinely new repeated scan still increments quantity. Successful additions retain focus and do not erase a subsequent code being typed. Exact barcode matches take precedence over SKU collisions.

Salesperson choices previously fell back to the general employee list when the eligible list was empty and could auto-attribute the logged-in employee. The terminal now loads the existing store-scoped `/salespeople` API directly, shows an explicit searchable **Select Salesperson** control for the bill, and retains per-item overrides. Selection is optional because the current schema/configuration has no required-salesperson rule. A row explicitly cleared to Unassigned remains unassigned instead of inheriting the bill salesperson during checkout or receipt rendering.

The dropdown was also clipped by the cart/payment scroll containers. Its menu now renders in an anchored overlay so search and selection remain clickable. It displays names and employee codes, never a UUID as a name.

## Identifiers and persistence

`Employee.id` is an integer primary key in this application. `Employee.employeeID` is an optional external GUID/string. `POSSale.salespersonId` and `POSSaleItem.salespersonId` are existing integer foreign keys to the real Employee row. Those relationships are preserved; no integer/UUID column conversions or fabricated employee IDs were introduced. Invoice/history responses expose the related employee's actual `employeeID` alongside their name. Tests verify that the saved FK resolves to the selected employee and their existing GUID.

Checkout validates active store-assigned employees against the same existing eligibility helper used by the salesperson list, and rejects disabled linked user accounts. The existing commission calculations/helper were not changed. The existing transaction, Decimal pricing/GST, split tenders, invoice sequence, idempotency and conditional stock deductions remain authoritative.

## Authorized new-barcode registration

After a real lookup miss, an operator with both catalog and stock permissions can open **Register this product**. Other users receive an instruction to ask an authorized catalog manager. The dialog requires actual product name/code, SKU, barcode, cost/selling prices, GST, opening quantity and reason; size/color remain optional under the existing catalog rules.

The existing `POST /api/v1/pos/products` accepts an optional `openingStock: { storeId, quantity, reason }` for one-variant registration. It checks `pos.catalog`, `pos.inventory`, store scope, input values and store activity, then creates the product/variant and existing OPENING stock movement/balance in the same transaction. Invalid stock/store setup rolls everything back. Existing SKU/barcode uniqueness remains enforced. The frontend only adds the product after reloading the saved variant through the scan queue. Unknown scans never write products automatically.

## APIs

No new endpoint or duplicate catalog/inventory system was added.

- `GET /api/v1/pos/products/lookup`: exact barcode, then exact SKU; existing case-insensitive fallback retained.
- `GET /api/v1/pos/products`: optional `searchMode=name` restricts suggestions to product-name substrings and exact product codes, excluding barcode/SKU substrings. Existing callers without this parameter retain their catalog search behavior.
- `POST /api/v1/pos/products`: optional atomic opening-stock registration described above; existing callers remain supported.
- `GET /api/v1/pos/salespeople`: existing endpoint now uses the shared store-scope helper and excludes disabled linked user accounts.
- `POST /api/v1/pos/sales`: existing salesperson relationships are validated; explicit null line attribution is preserved. Authenticated quote, sale and exchange API boundaries require registered variant IDs and reject catalog-free manual rows before billing.
- Existing sale/history/detail responses include the selected employee's external GUID and actual name. Quotes, payments, receipts and reprints continue through their existing APIs.

## Files

Frontend (`HRM-Admin-Pannel`):

- Modified `src/features/pos/POSBillingScreen.tsx` — remove Quick Catalog, strict lookup/queue, registration handoff, bill/row salesperson selection.
- Modified `src/features/pos/SalespersonDropdownCell.tsx` — accessible search label and unclipped anchored menu.
- Added `src/features/pos/POSProductRegistration.tsx` — authorized database-backed registration dialog.
- Modified `src/features/pos/posReceipt.ts` — preserve explicit unassigned item attribution.
- Modified `scripts/test_pos_e2e.cjs` and `scripts/test_pos_selection.cjs` — real integration coverage and updated not-found message.

Backend (`QuickBoom-HRM-Backend`):

- Modified `src/pos/routes.ts` — restricted name suggestions, exact barcode priority, salesperson scope/filtering and external employee GUID projections.
- Modified `src/pos/service.ts` — optional transactional opening stock, selected-employee validation and explicit null item attribution.
- Modified `scripts/serve_pos_e2e.ts` — isolated real employee/GUID fixtures.
- Added `scripts/test_pos_scan_salesperson.ts` — guarded real HTTP/PostgreSQL checks.
- Modified `package.json` — `test:pos:scan-salesperson` command.
- Added this report.

Existing workspace edits to POS navigation, workspace and salesperson test files were retained. Other chats made commits in the shared repositories during this work; this list describes the implementation touched for this request, rather than claiming ownership of every Git commit/diff.

## Database and deployment

No Prisma schema changes or database migrations were needed for this request. The existing sale-item salesperson relation/migration is reused. No production database was migrated, reset or used for tests. Deploy the matching frontend and backend together because the terminal uses the new `searchMode=name` and optional `openingStock` contract.

## Verification

All database tests use matching `DATABASE_URL` and `POS_TEST_DATABASE_URL` targeting `hopkid_pos_test_verified` on localhost port 55439. The new test refuses other destinations before writing fixtures.

- New real HTTP/PostgreSQL scan/salesperson suite: **12 checks passed** — real registration and OPENING ledger/balance, missing/partial-code no-write behavior, exact UUID/stock lookup, name search, registration rollback/permissions, eligible list/GUID/name, idempotent saved sale/payment/stock, history/receipt names, explicit unassigned rows, invalid/inactive/cross-store employee rejection and authorization, including explicit rejection of catalog-free manual lines.
- Existing PostgreSQL variant-selection suite: **8 checks passed** — both dimensions, size-only, color-only and plain variants; stock/inactive rejection; exact-barcode priority; invalid/missing stores and scope.
- Existing browser selection suite: **passed**. This suite uses API fixtures; the end-to-end and PostgreSQL suites independently verify real backend behavior.
- Focused POS ESLint and backend TypeScript: passed at completed checks.
- Next production build: passed. Existing `ignoreBuildErrors` configuration skips type checking; repository-wide frontend TypeScript still reports pre-existing access-control, payroll and commission-service errors, with no changed-POS diagnostics in the executed check.

- **Final real browser → Express → PostgreSQL suite: passed.** Actual HRM login; valid barcode and exact product-name scans; multiple variants; repeated scans; duplicate Enter suppression; unknown/partial code rejection; searchable salesperson selection; actual employee GUID/name in saved invoice/history/receipt; authorized registration of a previously unknown product, variant and opening stock before billing; discount/GST/payment/stock reconciliation; Cash/UPI split; lost-response retry with the same key; receipt failure/reprint without another sale; reports and laptop/tablet layout.
- New registration example verified: ₹75.25 exclusive price + ₹3.76 GST = ₹79.01 persisted invoice, with stock moving from 3 registered units to 2 after one sale.
- Multi-product example verified: ₹399.95 subtotal − ₹27.01 discounts + ₹32.38 GST = ₹405.32, paid with ₹100 Cash + ₹305.32 UPI. A dropped successful response followed by retry deducted stock only once.
- **Broad existing `test:pos` suite: not passed.** Core finance, idempotency, concurrent overselling, rollback, stock, authorization and related checks passed before the suite stopped at `scripts/test_pos.ts:976`: its expected commission-refund transaction identifier was absent (`P2025`). This is the previously observed commission-refund expectation; commission calculations were left unchanged as requested.

A separate concurrent `pos_manual_sale_items` schema/migration appeared during final verification. It is outside this request, was not applied to the database by this work, and is not required for the verified registration-required barcode flow. Checkout was kept catalog-backed, with an explicit API guard against manual unregistered rows. Review the separate nullable-variant schema/migration work independently before deployment.

 Physical printer output and production deployment are not tested. Browser print invocation, 58/80 mm CSS widths and saved-invoice reprint recovery are tested with printing intercepted, avoiding a native print dialog.

## Shared-checkout status at the final audit

The registration-required implementation and its real-browser flow passed the checks above. Afterwards another chat continued modifying these same files, removed the registration-only API/service guards and their manual-line rejection test, and introduced catalog-free manual billing. The latest harness therefore reports 11 checks, not the 12-check registration-only suite described above. These edits conflict with the request to register product/variant/price/stock before billing. The current shared checkout is **not certified as the tested registration-only revision**. Integration is awaiting a pause of the competing edits or an explicit change of the requested manual-billing policy. No production database changes were made by this task.
