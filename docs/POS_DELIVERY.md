# Fashion POS delivery

## Status
A functional POS extension is implemented and tested. **Do not describe the entire requested production rollout as complete:** automatic commission posting/payroll credit is blocked on business policy and external product mapping, and there is no company tenant model to enforce. Deployment to the configured HRM database has not been performed.

## Implemented functionality
- Shared HRM JWT authentication, active-account checks, current database roles, role/user JSON permissions and store authorization. Static development tokens are rejected for POS. Production requires JWT_SECRET.
- Products and variants: product creation/edit/deactivation, variant creation/update API, unique SKU and barcode, metadata/category hierarchy, images, size-chart JSON, costs/prices/taxes, search, pagination and atomic JSON bulk import (up to 100 products).
- Generated barcodes, keyboard-scanner lookup/add, Code128 label preview/printing through JsBarcode.
- Per-store/per-variant resellable and damaged balances, authorized signed adjustments/opening receipts, physical count reconciliation, low-stock thresholds and append-only API movement history. Every quantity change writes a ledger movement in the same transaction.
- Transfers: draft, authorized source dispatch, authorized destination receipt; retry-safe state transitions.
- Registers: configuration, one open session per register enforced by a PostgreSQL partial unique index, opening cash, cashier/employee attribution, authorized idempotent cash movements, close/count/expected cash/variance and session history.
- Billing: product/variant search, scanner Enter, F2/F8 shortcuts, quantity/removal, permission-gated unit/order discounts and audited price overrides, walk-in customer snapshots, existing employee salesperson selection, server quote, full/split tenders and receipt/invoice print.
- Checkout: server Decimal calculations, exact settlement, serializable transactions with bounded retries, register/catalog locks, conditional stock decrement, advisory-lock idempotency, invoice sequence, immutable invoice/item/payment snapshots and audit records.
- Full/partial returns: original quantity eligibility, exact cumulative refund allocation, separate damaged stock, register cash sufficiency, original document linkage and retry protection.
- Exchanges compose original refund and replacement sale in one database transaction. Both gross tenders are recorded; net additional payment/refund is returned. Atomic rollback is tested. Full invoice reversal restores stock through a refund and preserves the original document.
- Reports/dashboard: real database totals, daily trend, sales/store/cashier/salesperson, product/brand/category/size/color dimensions, payment/refund methods, refunds, low stock, current cost valuation, open sessions, tax-exclusive revenue, snapshot COGS and gross margin. IST date ranges support up to 366 days. Detailed dimensions/returns use page/pageSize; headline totals cover the full range.

## HRM entities reused
User, Employee, Store, Role, RolePermission, UserPermission and SystemSetting.currency. Existing Branch is a geofence entity and is not interchangeable with retail Store. Existing external Sales, CreditNote, SalesExchange, CommissionTransaction, attendance and payroll workflows remain untouched. No relational customer/supplier/brand/company model existed; customer and brand values are snapshots/metadata rather than duplicate HRM entities.

## New Prisma entities
POSCategory (self-referencing category hierarchy), POSProduct (category), POSProductVariant (product), POSInventoryBalance (unique store+variant), POSStockMovement (store+variant+user), POSRegister (store), POSSession (register+cashier+employee), POSSale (store+session+cashier+salesperson), POSSaleItem (sale+variant), POSSalePayment (sale), POSReturn (sale+session+user), POSReturnItem (return+original item), POSStockTransfer (source/destination stores), POSStockTransferItem (transfer+variant), POSAuditLog (user), POSCashMovement (session+user).

POS IDs use PostgreSQL UUID columns; all foreign keys into existing HRM entities remain integers. Money uses NUMERIC/Prisma Decimal. Historical HRM ID types are unchanged. Exchange references are retained in POSAuditLog metadata under EXCHANGE_COMPLETED (original sale, return, replacement sale and difference).

## Migration
`prisma/migrations/20261023120000_fashion_pos/migration.sql` is generated offline from the pre-POS schema. It only creates POS tables/indexes/FKs, an invoice sequence, a partial open-register index and POS-specific checks. No DROP, TRUNCATE, data reset, existing HRM data update or existing HRM column conversion. The exact final SQL was successfully applied to a fresh isolated database containing the pre-POS schema, followed by all 29 POS checks. The temporary database server was stopped after validation.

## API routes
All routes are mounted on the existing Express app under `/api/v1/pos` and return `{ success, data }` or `{ success: false, message }`.

| Method | Relative path | Permission |
|---|---|---|
| GET | /context | Any POS permission |
| GET / POST | /categories | read / catalog |
| GET / POST | /products | read / catalog |
| POST | /products/import | catalog |
| GET / PATCH | /products/:id | read / catalog |
| POST | /products/:id/variants | catalog |
| PATCH | /variants/:id | catalog |
| GET | /inventory | read |
| GET | /inventory/movements | inventory |
| POST | /inventory/adjustments | inventory |
| POST | /inventory/reconciliations | inventory |
| PATCH | /inventory/:id | inventory (threshold only) |
| GET / POST | /transfers | inventory |
| POST | /transfers/:id/dispatch | inventory + source store |
| POST | /transfers/:id/receive | inventory + destination store |
| GET / POST | /registers | read / configure |
| POST | /registers/:id/open | sell |
| POST | /registers/:id/close | reconcile |
| GET | /registers/:id/sessions | read |
| POST | /sessions/:id/cash-movements | reconcile |
| POST | /quote | sell (+ discount when used) |
| GET / POST | /sales | read / sell |
| GET | /sales/:id | read + store |
| POST | /sales/:id/returns | refund |
| POST | /sales/:id/exchanges | refund + sell |
| POST | /sales/:id/cancel | refund |
| GET | /reports/daily-sales, /reports/inventory, /reports/employee-sales | reports |
| GET | /access/users | Administrator only |
| PATCH | /access/users/:userId | Administrator only |

`POST /sales` completes atomically; there is deliberately no separate draft completion route. There are no unsafe hold/reservation endpoints. Reports aliases share the verified aggregation implementation rather than duplicating business logic.

## Frontend routes
The existing `(admin)` layout hosts the Next.js optional catch-all `/pos/[[...path]]`, serving `/pos/dashboard`, `/pos/billing`, `/pos/products`, `/pos/products/new`, `/pos/inventory`, `/pos/inventory/transfers`, `/pos/registers`, `/pos/sales`, `/pos/sales/[id]`, `/pos/returns`, `/pos/reports`, `/pos/settings`. The main sidebar links to the workspace. Existing portal sessions can access POS; backend permissions remain authoritative. Screens use existing Tailwind/shadcn controls and shared Axios authentication/proxy.

## Permissions and onboarding
SUPER_ADMIN and ADMIN have full POS access. Other users require explicit `pos.read`, `pos.sell`, `pos.catalog`, `pos.inventory`, `pos.discount`, `pos.priceOverride`, `pos.refund`, `pos.reconcile`, `pos.reports`, `pos.configure` as appropriate. Use POS Settings to grant rights via existing UserPermission records. Non-administrators require an Employee with an assigned Store. An administrator configures registers; each cashier opens their own session. Grant read+sell to a cashier, adding other permissions only as required. No new broad default permissions are seeded into production.

## Explicit policies and remaining limitations
- No automatic commission accrual or payroll write. A confirmed mapping from POS UUID products/categories to existing external integer policy IDs, eligible revenue basis, fixed-policy quantity semantics, paid-commission reversal policy and approval workflow is required. Salesperson identity is persisted per invoice. Payroll remains exclusively HRM.
- No relational company tenant exists. Store restrictions are enforced; company-level isolation cannot be inferred from SystemSetting.company JSON.
- Tax-exclusive price, integer apparel quantities, half-up per-line two-decimal tax, no extra cash rounding. Order discounts allocate cents proportionally across eligible taxable lines, with the remainder allocated deterministically; refunds preserve the original allocated revenue and tax. Price overrides require pos.priceOverride and a stored audit reason. Return policy refunds original values without a time window; confirm legal/tax/return policy before rollout.
- Gross margin is tax-exclusive net revenue minus snapshot COGS. Resellable returns reverse original COGS; damaged refunds retain the original cost as loss. This is not operating profit. Inventory valuation uses current variant cost, excludes damaged/in-transit units and is not a FIFO/weighted-average accounting ledger.
- Payments and refunds are manually recorded and reconciled tenders. No gateway credentials/webhooks were supplied. A recorded CARD/UPI tender is not independent proof of settlement. No raw PAN/CVV fields exist.
- Exchanges currently record an original refund and full replacement tender, exposing the net difference. There is no exchange-credit tender or net-only payment-provider integration.
- No customer master, supplier/purchasing document module, online reservations, held carts or configurable payment-method catalog. Product archival replaces destructive deletion. Bulk import is JSON; a CSV mapping UI and bulk price editor are not included.
- Variant pricing update and size-chart/attribute editing are available through validated APIs; the product UI currently exposes product metadata editing and variant creation, not a full variant price/size-chart editor.
- No live production login, attendance, payroll settlement or gateway tests were run. Existing check failures below require separate resolution before a production release.

## Verification
- Prisma validation and client generation: pass.
- Backend build / TypeScript: pass.
- Isolated PostgreSQL suite (`scripts/test_pos.ts`): financial math, uniqueness, stock scope, register exclusivity, split payment, idempotent retries/conflicts, concurrent oversell prevention, rollback, snapshots, returns, transfers, reports/margin, cash movements, exchange atomicity, JWT/permission/store checks, cancellation, physical reconciliation and ledger consistency. Final result: **29 checks passed** against a fresh isolated database after applying the exact final migration.
- Browser contract suite (`scripts/test_pos_ui.cjs`): desktop/tablet billing, server quotes, checkout request without trusted client totals, invoice/refund controls, Code128 SVG label, product submission and horizontal overflow. Pass. These UI API responses are mocked; PostgreSQL transaction tests exercise the real backend separately.
- Production frontend build: pass using existing `ignoreBuildErrors: true`; this does **not** imply clean repository-wide TypeScript.
- POS page/component focused ESLint: pass. Repository-wide frontend TypeScript reports pre-existing errors in RegisterUserWithRights.tsx, PayrollPage.tsx and commissionService.ts. Existing `npm run lint` invokes unsupported `next lint` on Next 16. Existing permission helper files also contain `no-assign-module-variable` errors.
- Existing salary-gross: 26/26 pass; payroll-all-cases: 12/12 pass; payroll-settlement: pass; authoritative commission rate/precedence: 16/16 pass.
- Existing attendance-summary fails its unpaid-leave classification assertion. POS does not modify attendance code.

## Exact local/deployment commands
From the workspace root:

```sh
cd QuickBoom-HRM-Backend
npm ci
npx prisma validate
npx prisma generate
npm run build
npm run test:pos
# Unit checks above do not write fixtures unless POS_TEST_DATABASE_URL is supplied.
# Integration fixture writes require localhost port 55439 and a database name containing pos_test:
DATABASE_URL='postgresql://YOUR_LOCAL_USER@127.0.0.1:55439/hopkid_pos_test' POS_TEST_DATABASE_URL='postgresql://YOUR_LOCAL_USER@127.0.0.1:55439/hopkid_pos_test' JWT_SECRET='isolated-test-secret' NODE_ENV=production npm run test:pos
# Start normal local backend with your existing local environment:
npm run dev
```

In another terminal:

```sh
cd HRM-Admin-Pannel
npm ci
# Existing local backend proxy; do not accidentally use the production fallback:
NEXT_PUBLIC_API_URL=http://localhost:5004 BACKEND_API_URL=http://localhost:5004 npm run dev
npx eslint src/features/pos/POSWorkspace.tsx 'src/app/(admin)/pos/[[...path]]/page.tsx'
npx tsc --noEmit --incremental false
npm run build
npm run test:pos:ui
```

The browser test launches installed Google Chrome at the macOS standard path; adjust executablePath for other systems. It launches a built Next server on 3198 and mocks API responses. Production build fetches existing Google Fonts and needs network access.

Safe release order: take and verify an existing PostgreSQL backup, review migration SQL and existing migration status, apply/test on staging with representative HRM data, confirm business policies and permissions, then use the established deployment process. With DATABASE_URL deliberately set to the intended staging/production database:

```sh
cd QuickBoom-HRM-Backend
npx prisma migrate status
npx prisma migrate deploy
npx prisma generate
npm run build
# Restart through the existing deployment/process manager.
```

Then deploy the admin build through the existing Docker/deployment configuration. Retain the existing BACKEND_API_URL/NEXT_PUBLIC_API_URL, set a strong JWT_SECRET consistently with HRM, and run a scoped smoke sale/return/register-close on staging before rollout. Do not use migrate reset, db push, or resolve migration history speculatively against production. Roll back application deployment if needed while retaining additive POS tables/data; do not delete financial documents as rollback.
