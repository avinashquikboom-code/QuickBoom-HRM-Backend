# Fashion POS architecture and implementation plan

## Verified dependencies (before implementation)
- Express 5 / TypeScript 6, Prisma 7.8 PostgreSQL adapter, existing `src/utils/db.ts` singleton. Routes mounted in `src/index.ts`; existing APIs use `/api`, POS can safely occupy `/api/v1/pos`.
- User, Employee, Store and Branch IDs are integers. Sales and credit documents use UUID strings. POS uses UUID database keys and integer foreign keys without converting existing tables.
- Store is the retail location (employees, commission policy and transactions reference it). Branch is a separate geofence entity without store linkage; POS `storeId` means retail branch.
- User has Role, UserPermission JSON; RolePermission JSON supplies role defaults. Employee links user and store. No relational Company, Customer, Product, Category, Brand or Supplier model exists. SystemSetting.company is JSON, not a tenant boundary. No company isolation can be inferred.
- Existing Sales is employee-level HopKid attribution, not an itemized invoice. CreditNote and SalesExchange likewise serve external commission adjustments. New POS sale documents must not mutate these external records.
- CommissionTransaction uses Float, unique billId+employeeId, approval and payroll settlement. Commission policy includes integer external product/category IDs; these cannot be equated to POS UUIDs. Automatic commission accrual requires a confirmed applicability/reversal policy; preserve attribution without inventing it.
- Next 16 App Router `(admin)` layout, Tailwind 4 and shadcn primitives; shared Axios `api` supplies portal authentication and `/api` proxy.
- Existing auth accepts static development tokens. POS additionally verifies JWT signature and loads active database role; production requires configured JWT_SECRET.
- Existing uncommitted payroll/PDF changes are outside scope and must remain untouched.

## Dependency map
User/permissions + Employee + Store -> POS authorization -> product catalog -> variant/store balances + movement ledger -> register/session -> atomic invoice/items/payments -> original-value returns -> reports. Transfer dispatch/receipt shares the ledger. Frontend uses existing Axios and admin layout. Payroll and attendance remain existing modules.

## Implementation order
1. Add additive models, generate migration offline, inspect SQL; never apply to configured database automatically.
2. Add strict payload validation, current-role permissions and store scoping; transactional services with row locks, ledger, Decimal totals, idempotency.
3. Catalog, inventory, transfers and register workflows; checkout, returns and reports.
4. Connect admin pages to actual APIs, including receipt printing; no sample business data.
5. Prisma validation, type checks, financial unit tests and available regressions. Database concurrency tests require an explicitly isolated test database; never run them against production.

## Initial explicit policies
Integer apparel quantities; tax-exclusive prices, per-line half-up tax rounding, no extra cash rounding; full settlement only. Returns refund original per-unit amounts, damaged stock is quarantined. Payments are manually recorded tenders, not gateway verification. No card credentials accepted. Discounts require `pos.discount`. No automatic attendance writes. No inferred company tenancy or automatic payroll writes.


## Final implementation notes
See POS_DELIVERY.md for route/model inventory, test evidence, limitations and deployment commands. Order discounts and audited price overrides were implemented after the initial core workflow verification. The final migration was re-generated and re-tested offline against a fresh isolated PostgreSQL database. No configured HRM database migration was applied.
