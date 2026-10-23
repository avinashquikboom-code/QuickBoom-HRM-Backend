# POS checkout conflict investigation and fix

## Evidence and root cause

The exact message originates in src/pos/routes.ts: Prisma P2002 (unique constraint) and P2034 (serialization failure) were both translated to the same 409 response without recording the underlying target.

Before the fix, scripts/test_pos_checkout_conflict.ts --reproduce created a register occupied by cashier A and submitted a manual sale as cashier B through the actual POST /api/v1/pos/sales route. Prisma failed creating POSSession with `Unique constraint failed on the fields: (registerId)`, and the API returned the exact reported generic message. ensureOrOpenSession selected the first active register without excluding occupied registers. This violated PostgreSQL POSSession_one_open_register, a unique partial index for sessions with closedAt IS NULL. The function also swallowed invalid preferred-session ownership failures.

Read-only inspection of the configured database confirmed this index, sale idempotency and invoice uniqueness, and nullable manual variant relationships. The inspected invoice sequence was 82, ahead of the latest invoice 77; this inspection did not show sequence drift. Existing accessible test/PostgreSQL logs contain serialization failures, but historic production request logs were not available. The reproduced occupied-register failure is confirmed; the specific historic screenshot request cannot be attributed definitively without its production database-error log.

The frontend already retained a request key and immutable payload after response loss and cleared them after acknowledged success. However its submission lock was acquired after awaiting a quote. Rapid F8/double-submit during that await could enter multiple handlers. The lock now wraps the entire handler synchronously before any await.

## Changes

- POSBillingScreen.tsx: acquire the submission guard and processing state before quote validation; preserve existing cart/key/payload recovery on failure and new-key creation for new bills. No UI redesign.
- src/pos/service.ts: serialize register allocation, reuse only owned sessions or available active registers, preserve explicit session errors, and return an actionable conflict if configured registers are occupied/inactive. Keep the database unique constraint and stock/transaction controls. All idempotency fast/recovery paths check cashier, store and request hash before returning an original sale; a changed payload with the same key remains a 409. Committed-sale recovery after concurrency errors is read outside a failed transaction only when checkout owns that transaction.
- src/pos/routes.ts: log safe database error code/model/constraint target, without customer/payment/request payloads, so future incidents identify the actual constraint.
- scripts/inspect_pos_conflict.ts: read-only index/sequence/aggregate diagnostics.
- scripts/test_pos_checkout_conflict.ts: guarded real-route PostgreSQL regression.
- HRM-Admin-Pannel/scripts/test_pos_checkout_retry.cjs: real browser double-submit and response-loss regression.

No database migration is needed. Manual products do not require variants, size, color or fabricated catalog records. Employee/customer associations remain intact. GST remains exclusive: entered unit price minus discounts is the taxable base; GST is added. Decimal rounding and order-discount allocation were not changed. Example: 100 less 10 discount plus 18% GST = 106.20. Recorded payments must equal server grand total.

## Verification

- Reproduced exact P2002 occupied-register error before fixing.
- Real backend API/PostgreSQL tests passed: occupied-register clear error, available-register recovery, other-cashier ownership rejection, concurrent identical-key requests yielding one invoice/payment, same-key replay returning original, changed-payload rejection, new keys producing new sales, single/multiple manual lines, item/order discounts, GST, CASH/CARD/UPI and payment/server-total agreement. Expected serialization retries occurred and recovered.
- Real Chrome tests passed: rapid double-click sends one request; simulated timeout after server commit preserves cart and retries byte-equivalent payload with same key; next bill on the same page uses a new key; one/two/three manual lines, customer and salesperson persistence, CASH/CARD/UPI and receipt print calls.
- Backend production TypeScript build passed. Frontend production build and focused POS ESLint passed.
- Full frontend tsc still reports pre-existing access-control/payroll/commissionService errors; no POS errors. Existing Next build configuration skips type validation. Those unrelated files were not modified.
- Docker build was attempted but could not run: docker command is not installed. No Docker success is claimed.

Only isolated test-database fixture writes were made. Production was not migrated or deployed. Both chats remain running at the user's request, so subsequent workspace changes require fresh verification.
