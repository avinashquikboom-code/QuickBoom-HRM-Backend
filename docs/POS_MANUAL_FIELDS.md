# Manual POS billing without Size / Color

Manual billing rows and the inline POS product-registration form no longer collect Size or Color. Manual quote/checkout payloads omit both fields and do not require a catalog product or variant. The backend ignores legacy optional manual size/color input and stores blank snapshot values; catalog variant metadata and database relations remain unchanged. The extra optional manual SKU input was removed so the row contains only the requested cashier fields.

No migration or endpoint change is required.

Validation:
- Production frontend build passed (existing configuration skips TypeScript validation).
- Backend TypeScript check passed; corrected POS register ordering to use the existing id field instead of nonexistent createdAt.
- Frontend TypeScript reports existing errors in access-control, payroll and commissionService; no POS TypeScript errors. These unrelated modules were not edited.
- Focused frontend ESLint: no errors, four existing unused-variable warnings.
- PostgreSQL catalog/manual suite: all four checks passed, including manual UPI sale, mixed cash sale and refunds without fabricated inventory.
- Real Chrome test scripts/test_pos_manual_fields.cjs: single and multiple manual-only sales, percentage and fixed discounts, 18% GST, exact cash payment, saved invoices, absent size/color/variant payloads, and receipt print invocation passed. Uses guarded local isolated PostgreSQL fixtures and real POS APIs.

Not deployed to production. Printing was verified through the browser print invocation and rendered receipt; no physical printer used.
