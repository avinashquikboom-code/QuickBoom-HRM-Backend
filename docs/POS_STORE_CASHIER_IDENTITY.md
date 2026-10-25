# Store register cashier identity

The dedicated store-password login authenticates a shared terminal User. Previously register opening copied its userId but had no human employeeId to save; summary and bill queries consequently followed the terminal's empty employee/profile relationships and returned Unknown Cashier. Session history also omitted the direct employee relationship on one route, and bill APIs followed cashierId (the audit User) rather than the register session's human employee.

Store login is unchanged. Opening a register now requires cashierEmployeeId, selected from active employees assigned to the authenticated store. Both opening APIs validate that employee's active store assignment and name before saving the existing POSSession.employeeId. Concurrent cashiers on one terminal are distinguished by employeeId; selecting another cashier cannot silently resume an occupied register. No schema migration is needed.

Session opening/current/closing/history and register reconciliation reports use the session employee before the owner's user relationship. Bill detail/list/session sales and exports use their session employee while preserving POSSale.cashierId as the audit user. Item salespeople and commission attribution remain separate. Imported HR user relationships accept only unambiguous external-ID matches and never reassign a record linked to another user.

Legacy terminal sessions with null employeeId remain unchanged and can be inspected and closed. They cannot create new bills; close them and open a new session with an explicit cashier. A missing historical identity remains unknown rather than being assigned to a current store employee.

## Verification

Use an isolated local PostgreSQL database (localhost/127.0.0.1 port 55439, database name containing pos_test). Set DATABASE_URL and POS_TEST_DATABASE_URL to that same test database; never use production. Apply the existing schema and migrations, including POSInvoiceSequence.

Backend:
- npm run build
- npm run test:pos:cashier-names
- npm run test:pos:store-cashiers

Frontend:
- npm run build
- npm run test:pos:store-cashiers

The new backend suite covers three named cashiers across two stores plus an empty store, missing/invalid/inactive/foreign-store selections, integer-string normalization, simultaneous cashier sessions, register conflicts, real checkout, unchanged bill/item salesperson IDs, bill list/detail/session history, summary, current sessions, reconciliation, CSV exports, closing, and legacy null cashier IDs. The browser suite runs a real store-password login against local APIs and PostgreSQL, checks an initially unselected required dropdown, store-specific options, opening request data, and the selected cashier in the closing summary.

## Changed files

Backend: src/pos/auth.ts, src/pos/cashierIdentity.ts, src/pos/service.ts, src/pos/routes.ts, src/pos/reports.ts, src/pos/billExports.ts, scripts/test_pos_store_cashiers.ts, scripts/serve_pos_store_auth_e2e.ts, package.json, and this document.

Frontend: src/features/pos/POSOpeningModal.tsx, src/features/pos/POSBillingScreen.tsx, scripts/test_pos_store_cashiers.cjs, and package.json. Existing history/receipt components consume the corrected cashier.employee response without styling changes.
