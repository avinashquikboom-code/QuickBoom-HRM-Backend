# HopKid POS scanning, salesperson selection and manual billing

Verified locally on 23 October 2026. The user subsequently authorized **manual billing**; that instruction supersedes the earlier requirement that every billed line first have a catalog record.

## Delivered behavior and root causes

The original scanner fallback could automatically add the only result from a partial barcode/SKU search. The terminal now tries exact barcode/SKU lookup first. Name suggestions exclude barcode/SKU substrings, and partial product codes cannot silently substitute a different product. Unique exact names/codes can resolve directly; variant choices remain explicit when necessary.

Unknown scans show the requested message: “Product not found. Please verify the barcode or register this product first.” They never insert products or manual rows automatically. Quick Catalog and its background query are removed. Keyboard scans feed an ordered queue, duplicate Enter submissions see an already-cleared input, and a genuinely repeated scan increments quantity subject to selected-store stock. Product size/color remain visible beneath long names.

Salespeople previously fell back to the general employee list and their dropdown could be clipped by cart/payment scrolling. The terminal now uses the existing store-scoped eligible-salespeople API, with searchable bill selection and per-row overrides. The popup renders outside scroll clipping. Names and employee codes are displayed rather than UUIDs. Attribution remains optional under the existing configuration. Explicitly unassigned rows stay unassigned in saved documents and receipts.

## Explicit manual billing

**Add Item Manually** creates an editable row only when the cashier requests it. A name, positive quantity and unit price, valid GST, and valid discounts are required before checkout. The API requires `manual: true`; omitting both a variant ID and explicit manual intent is rejected. A manual row cannot also claim a catalog variant ID.

The cashier enters the manual price/GST; the server validates the inputs and computes authoritative Decimal totals using the existing rounding/discount pipeline. Manual lines are saved as invoice snapshots with `variantId = null`, salesperson association and payment/tax details. They create no catalog products, variants, inventory balances or stock movements. Catalog lines in a mixed bill still resolve current prices/taxes and deduct stock transactionally. Returns restore only catalog stock; manual lines refund their saved amounts without inventing stock.

Entering a barcode in an explicit manual row can offer conversion to a real catalog match, with cashier confirmation. Unknown scanner input itself never becomes a manual line or silently substitutes an item.

## Optional authorized registration

A genuine lookup miss offers product registration only to users with catalog and stock permissions. The dialog saves an actual product, variant, SKU/barcode, prices, tax, selected-store opening quantity and reason. The existing product-create API persists catalog records and the existing OPENING stock movement/balance in one transaction. A failed store/stock validation rolls everything back. The terminal reloads the saved variant through the scan queue before adding it to the cart.

## Relationships and financial integrity

`Employee.id` is the existing integer primary key. `Employee.employeeID` is an optional external GUID/string. Existing sale/item `salespersonId` integer foreign keys retain the real Employee relationship, and invoice/history responses expose that employee's actual GUID and name. No identifier-column conversion or fabricated employee UUID was introduced.

Selected employees must be active, eligible under the existing helper, assigned to the store and not attached to a disabled user account. Bill/item relationships, server quotes, persisted receipts, split tenders, transaction rollback, idempotency and catalog stock protection are retained. Unrelated payroll, attendance, expenses and commission calculation formulas were not rewritten by this task.

## APIs reused and updated

All paths are relative to `/api/v1/pos`. No duplicate endpoint or inventory system was created.

- `GET /products/lookup`: exact barcode priority, then SKU, retaining the case-insensitive ambiguity fallback.
- `GET /products?searchMode=name`: name suggestions plus exact product codes; no barcode/SKU substring substitution. Other existing catalog search modes remain available.
- `POST /products`: optional `openingStock: { storeId, quantity, reason }` for authorized atomic one-variant registration.
- `GET /salespeople`: existing store scope and eligibility rules, excluding disabled linked users.
- `POST /quote`, `POST /sales`: accept registered variants or explicitly marked manual lines. Prices/GST/tenders and selected employees are validated server-side.
- `GET /sales`, `GET /sales/:id`: preserve bill/item salesperson names and external employee GUIDs.
- Existing return, report, register, customer, payment and receipt operations are reused.

## Files changed or integrated

Frontend (`HRM-Admin-Pannel`):

- `src/features/pos/POSBillingScreen.tsx`: scanner queue, strict lookup, removal of Quick Catalog, visible dimensions, manual rows, bill/row salesperson selection and registration handoff.
- `src/features/pos/SalespersonDropdownCell.tsx`: searchable anchored overlay with actual names.
- `src/features/pos/POSProductRegistration.tsx`: real catalog/opening-stock registration dialog.
- `src/features/pos/posReceipt.ts`: item-level salesperson/unassigned rendering, using saved invoice data.
- `scripts/test_pos_e2e.cjs`, `scripts/test_pos_selection.cjs`: updated browser coverage.

Backend (`QuickBoom-HRM-Backend`):

- `src/pos/routes.ts`: lookup/search contracts, salesperson scope/filtering and GUID/name projections.
- `src/pos/service.ts`: atomic optional opening stock, employee validation, explicit manual intent, catalog/manual pricing and persistence.
- `src/pos/validation.ts`: optional manual text validation integrated from the concurrent manual-item implementation.
- `prisma/schema.prisma`, `prisma/migrations/20261023200000_pos_manual_sale_items/migration.sql`: nullable sale-item variant relation for manual snapshots.
- `scripts/serve_pos_e2e.ts`: isolated employee/GUID fixtures.
- `scripts/test_pos_scan_salesperson.ts`: guarded real HTTP/PostgreSQL verification.
- `scripts/test_pos_catalog_and_manual.ts`: guarded catalog/manual/mixed checkout and return verification.
- `package.json`: scan/salesperson test command.
- `docs/POS_SCAN_SALESPERSON.md`: this report.

Some of these changes were implemented/committed concurrently in the shared repositories and then integrated and tested here. Existing POS navigation changes were retained.

## Migration and deployment

Manual billing reuses the existing migration `20261023200000_pos_manual_sale_items`, which drops NOT NULL on `POSSaleItem.variantId`; existing catalog rows/foreign keys are retained. It was applied only to the isolated localhost test database. No production database was migrated or reset. Deploy the reviewed migration with the matching backend/frontend through the normal deployment process before enabling manual sales in another database.

## Executed verification

All fixture writes target `hopkid_pos_test_verified` at localhost port 55439 with matching `DATABASE_URL` and `POS_TEST_DATABASE_URL`. Both targeted backend test scripts reject other destinations before writing.

- **12 real HTTP/PostgreSQL scan/salesperson checks passed**: real registration and OPENING balances/ledger; no-write unknown/partial-code lookup; exact variant/store stock; name search; registration permissions/rollback; eligible employee GUID/name; idempotent saved sale/payment/stock; invoice/history/receipt names; explicit unassigned items; invalid/inactive/cross-store salesperson rejection; forbidden stores; and explicit manual intent without fabricated catalog records.
- **4 catalog/manual PostgreSQL checks passed**: catalog-only sale, manual-only sale without stock changes, mixed sale with catalog-only deduction, and mixed refund with correct stock restoration.
- **Real browser → Express → PostgreSQL suite passed**: HRM login; valid barcode/name and repeated/sequential scans; duplicate Enter suppression; unknown/partial-code rejection; no Quick Catalog; searchable salesperson selection and saved GUID/name; real product/variant/stock registration before catalog billing; explicit manual/catalog mixed checkout; saved GST/payments/receipt; no fake products; exact stock changes; lost-response retry; split Cash/UPI; receipt-fetch failure/reprint without another sale; reports and laptop/tablet layout.
- Existing PostgreSQL variant suite: **8 checks passed**; browser selection suite: **passed**. The latter uses API fixtures; the suites above independently use the real backend/database.
- Backend TypeScript, focused POS ESLint and frontend production build: **passed**. The existing Next configuration skips type checking; repository-wide frontend TypeScript still has previously identified access-control, payroll and commission-service diagnostics.
- The broader existing `test:pos` suite is **not marked passed**: core finance/concurrency/rollback/stock/authorization checks passed before its previously observed commission-refund identifier assertion at `scripts/test_pos.ts:976` failed with `P2025`. Commission formulas were not changed to hide that failure.

Verified examples: catalog subtotal ₹399.95 − discounts ₹27.01 + GST ₹32.38 = ₹405.32, split as ₹100 Cash + ₹305.32 UPI. A manual ₹50 item at 5% GST plus a catalog ₹100 item at 5% GST saved a ₹157.50 mixed invoice, with stock deducted only for the catalog item.

Printing tests intercept `window.print` and verify saved-invoice reprint recovery and 58/80 mm CSS widths. Physical printer output and production deployment were not tested. The earlier cross-chat policy conflict is resolved by the user's explicit approval of manual billing.
