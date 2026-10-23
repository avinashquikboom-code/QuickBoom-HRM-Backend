# POS billing redesign verification

The billing screen uses the full-width POS shell with a compact header, store/customer/mobile/search controls above the editable table, a right-hand bill summary and tender panel, and bottom History/Products/Settings links. Small screens stack cards; the table scrolls horizontally within its card. Manual row editing no longer performs barcode lookups or opens catalog confirmation dialogs. Explicit scanner/search remains connected to real catalog APIs.

Existing quote, checkout, employee, stores, product, history and receipt APIs are reused. Manual item prices, discounts, quantities, GST, customer fields and salesperson associations persist through transactional checkout. No mock production data or new endpoint contracts were introduced.

Following the user's later explicit approval, the Size/Color removal migration is authorized for POS catalog and invoice snapshot columns. Prisma/service types align with that structure. No unrelated HRM tables were changed. Migration SQL was tested directly on the isolated local fixture database; migrate deploy rejected that fixture database with P3005 because it has no migration baseline. No production migration was run.

Validation:
- Frontend production Next build: passed with the repository's existing ignoreBuildErrors setting.
- Backend production TypeScript build: passed.
- Frontend focused POS ESLint and diff whitespace checks: passed.
- Full frontend tsc: existing errors remain in RegisterUserWithRights, PayrollPage and commissionService. No POS TypeScript errors. These files were left unchanged to respect the POS-only scope.
- PostgreSQL catalog/manual suite: all four tests passed (catalog stock, manual UPI, mixed cash, refunds).
- scripts/test_pos_manual_fields.cjs with real Chrome, Express APIs and isolated PostgreSQL: passed one/two/three item manual sales, percentage/fixed discounts, 18% GST, Cash/Card/UPI, customer and employee persistence, invoice totals, receipt printing, no manual catalog requests/dialogs, and 1440/768/390px layout checks.
- Browser screenshots: /tmp/hopkid-pos-redesign-1440.png, /tmp/hopkid-pos-redesign-768.png, /tmp/hopkid-pos-redesign-390.png.
- Docker production build: NOT VERIFIED. Docker executable/runtime is absent on this host. Existing Dockerfiles were inspected; no container result is claimed.
- Not deployed. Physical printer output was not tested; browser receipt rendering and print invocation were tested.

Primary UI changes: HRM-Admin-Pannel/src/features/pos/POSBillingScreen.tsx and scripts/test_pos_manual_fields.cjs. Integration changes: QuickBoom-HRM-Backend/prisma/schema.prisma, prisma/migrations/20261023220000_remove_pos_size_color/migration.sql and src/pos/service.ts, with POS operations/report alignment for the approved schema.
