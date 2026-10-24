# Cancelled invoice accounting

The existing sale states are `COMPLETED`, `PARTIALLY_RETURNED`, `RETURNED`, and
`CANCELLED` (stored as strings). Reporting explicitly recognizes the first three;
unknown, draft, pending, failed and cancelled states do not enter sales facts.
Original sale events and ordinary returns retain the existing posting-date
accounting: gross collection includes the original invoice, while net collection,
net revenue and margin deduct posted refunds. Returned invoice counts remain
original invoice counts, as before. A cancelled invoice and its cancellation
credit are both excluded from sales reports, avoiding a second deduction.

`src/pos/salesAccounting.ts` supplies the Prisma and parameterized SQL predicates.
They cover dashboard/daily report aggregates, invoice counts, store/cashier and
salesperson totals, payment grouping, daily charts, product dimensions, GST,
COGS, margins, top sellers, and grouped day/week/month/store/employee analytics.
Year totals use the existing date range (up to 366 days). Report print/export
views consume these same backend responses. The salesperson query also now
handles an omitted store filter for consolidated reports.

Register cash is a movement ledger. Returned sales and refunded cancellations
retain their original receipt in the original session; refunds leave the drawer
of the session that pays them. This applies to summaries, session history,
closing calculations and cash availability checks. Administrative cancellation
(single, bulk or data management) is an existing no-payout void: its payment is
excluded, and no refund is invented. Use the refund cancellation endpoint when
money is actually paid back. Closed-session cash snapshots are preserved.
Session payment fields describe receipts before separately listed refunds.

Administrative voids now share one transaction-protected reversal path. They
restore inventory with a stock ledger entry, reject outstanding commission
proposals, and create reviewable debits for approved/paid commission under the
existing approval rules. Partially/fully returned invoices must use item returns
instead of administrative voids, preventing double stock restoration. Locks,
serializable transactions and Prisma/adapter conflict retries protect repeated
and concurrent cancellation. A cancelled invoice cannot be returned again.

Invoices, items, payment records, original numbers/amounts and audit logs remain.
Cancellation audit logs record the user and timestamp; explicit metadata also
captures invoice, amount, reason and cancellation time. History list/detail
endpoints intentionally retain cancelled invoices and their original amounts.
Their list counts count history records, not completed sales. Selection totals
and administrative deletion previews are similarly operational selections.
The History UI already renders CANCELLED and invalidates the shared POS query
cache after cancellation. No schema or frontend changes are needed.
Existing explicit permanent-deletion tools were not invoked or expanded.

## Verification

`npm run build`

`npm run test:pos:cancelled-sales` requires matching `DATABASE_URL` and
`POS_TEST_DATABASE_URL` on localhost port 55439 with `pos_test` in the database
name. It creates isolated fixtures and rejects other databases.

The suite verifies the 1000 + 500 + cancelled 300 = 1500 example, store and
consolidated reports, date dimensions/year range, payment totals, GST, employee
sales and commissions, pending/draft/failed exclusion, history/audit retention,
repeated/concurrent/bulk voids, inventory, ordinary partial/full refunds,
cash closing, and cancellation refunded in a later register session.

Existing full billing tests: 10 scenarios passed. Existing register opening,
closing and reconciliation tests: 15 scenarios passed. The general `test:pos`
suite stops at its existing financial payload rejection assertion (line 61),
before database integration. Pricing validation was not changed by this fix.
Browser refresh/print/export were inspected via their shared data/query paths;
no browser end-to-end run was performed for this change.
