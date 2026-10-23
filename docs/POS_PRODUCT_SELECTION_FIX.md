# POS product selection fix — 23 October 2026

## Root cause and trace

`/pos` renders POSBillingScreen. Both search forms submitted to handleBarcodeSubmit, which queried the paginated `/api/v1/pos/products` endpoint, looked for the first exact SKU/barcode among that page, then unconditionally displayed “Choose the correct size and color from the search results.” A normal product-name search, a plain SKU without size/color choices, and a missing code all reached the same error. The error also remained visible after a successful option click. The first-match loop could pick incorrectly when one SKU equalled a different variant's barcode, and a scan could be missed outside the returned page. Cart stock checks summed every returned balance, rather than explicitly checking selectedStoreId. Duplicate scans silently clamped quantity at the stock limit.

The products API applies the existing POS authentication/read permission and store scope, then queries POSProduct with POSProductVariant and store-filtered POSInventoryBalance. Pricing, tax, SKU/barcode and inventory all belong to POSProductVariant; POSProduct has no independent price or stock. Checkout continues to resolve variantId and calculate authoritative discounts/GST, lock and deduct store stock, and persist invoice/receipt snapshots using the existing service.

## Behavior after the fix

- Added authenticated `GET /api/v1/pos/products/lookup?storeId=...&code=...` before the product UUID route. It queries exact SKU OR barcode directly through Prisma, independently of name-search pagination. It returns up to two matches to expose cross-namespace ambiguity, with the parent product and only the requested store's balances. Inactive matches remain identifiable so the terminal can explain why they cannot be sold. No first-match shortcut is used.
- An exact unique scan resolves the actual variant ID, SKU, barcode, price, tax and store stock. Repeated scans increment the same cart line; exceeding stock is an explicit error.
- A name/product-code search with multiple SKU choices opens the existing dropdown without an error. Each choice displays its applicable size/color, SKU, selling price and selected-store stock; unavailable choices are disabled and explain their status. The cashier explicitly selects the exact option.
- A uniquely resolved product with one SKU can be added directly. Missing dimensions are omitted from its label; a SKU with neither size nor color is labelled Standard.
- Size and color are optional in catalog creation/edit validation and forms. This supports size-only, color-only and plain products without schema changes. SKU, selling price, cost and tax validation are retained. A plain product still has one base SKU row, as required by the existing inventory/checkout architecture. A genuinely empty product with zero SKU rows has no price/stock to sell and receives an actionable catalog-setup message rather than invented SKU/price data.
- Selection checks explicitly filter stock by the selected store's numeric ID. The store name (including HOPKID-VDR-ECOM) is never hardcoded into application logic. A lookup response arriving after a store switch is ignored.
- Missing, inactive, out-of-stock and ambiguous codes have distinct messages. Editing a search or successfully selecting an option clears prior selection errors.

## Files changed

Backend:
- `src/pos/routes.ts`: exact store-scoped SKU/barcode lookup.
- `src/pos/service.ts`: allow omitted size/color on the existing sellable SKU model.
- `scripts/test_pos_selection.ts`: guarded isolated-database HTTP/checkout tests.
- `package.json`: `test:pos:selection` script.
- `docs/POS_PRODUCT_SELECTION_FIX.md`: this report.

Frontend:
- `src/features/pos/POSBillingScreen.tsx`: search/scan resolution, variant choices, cart/stock handling and error recovery.
- `src/features/pos/productSelection.ts`: shared store-stock, option label and availability helpers.
- `src/features/pos/POSWorkspace.tsx`: optional dimension inputs and catalog instructions.
- `src/features/pos/POSOperations.tsx`: optional dimension editing.
- `scripts/test_pos_selection.cjs`: browser regression coverage.
- `package.json`: `test:pos:selection` script.

No database schema/migrations, production records, authentication/permission rules, discounts, GST calculations, inventory posting, payment logic or receipt-printing logic were changed.

## Verification

- Backend build: passed.
- Frontend production build and focused POS ESLint: passed. Repository-wide frontend TypeScript retains its existing errors in RegisterUserWithRights.tsx, PayrollPage.tsx and commissionService.ts; no changed selection file diagnostics were reported.
- **8 real PostgreSQL/HTTP selection checks passed**: manual search, exact barcode and SKU lookup, checkout, authoritative GST/price, exact variant ID and store-only stock deduction for both dimensions, size-only, color-only and plain SKUs; insufficient-stock rollback; inactive rejection; ambiguous cross-namespace codes; missing code/invalid store; store permission enforcement.
- **Browser selection regression passed**: both/size/color/plain selection, exact non-first variant scan, duplicate increments and stock cap, unavailable/inactive/missing/ambiguous/empty products, error correction, selected-store stock despite another store's positive stock, and a stale scan response after changing stores. Browser API fixtures are mocked; real backend behavior is checked separately above.
- **47 existing POS integration checks passed**, preserving finance, discounts, GST, stock ledger, sales, returns, registers, permissions and commissions.
- Existing **real end-to-end browser flow passed** with actual HRM login and POS APIs: persisted checkout/invoice/stock, receipt preview, refund, stock restoration, reports and tablet layout.

Run `npm run test:pos:selection` in each repository. Backend fixtures require matching DATABASE_URL and POS_TEST_DATABASE_URL pointing to an isolated localhost PostgreSQL database on port 55439 whose name contains pos_test. Browser tests require a completed Next production build and installed Google Chrome (CHROME_PATH can override its path).

Production data for HOPKID-VDR-ECOM was not modified or tested with a live transaction; verification used isolated fixtures. Deploy backend and frontend together because the terminal now uses the new exact lookup route.
