# POS bill exports

POS History now has an Export action beside Print, Slip and the existing
cancellation/deletion actions. Export Bills opens a responsive dialog with the
authorized store list, selected/all matching invoice modes, count preview,
Today/This Week/This Month/Custom/All Dates, status, payment mode and format.
Selections reuse the existing row and page checkboxes and persist across pages.
Changing the export store switches to the explicitly labelled all-matching mode;
selected bills cannot silently be transferred to another store.

## APIs

Both endpoints use the existing POS authentication and `pos.read` permission:

- `POST /api/v1/pos/bill-exports/preview` returns `{success:true,data:{count,storeId}}`.
- `POST /api/v1/pos/bill-exports/download` returns a downloadable binary/CSV response.

JSON body:

```json
{
  "storeId": 1,
  "format": "pdf",
  "saleIds": ["invoice-uuid"],
  "from": "2026-10-01",
  "to": "2026-10-24",
  "status": "ALL",
  "paymentMode": "ALL",
  "paper": "80",
  "detailed": false
}
```

Only `storeId` is mandatory. Omit `saleIds` for all matching invoices in that
store; otherwise select 1-1000 unique invoice IDs. Every selected ID must exist
and match the same store and filters. Missing, foreign or mismatched IDs reject
the entire selection. Store-locked POS sessions and ordinary employee store
permissions are enforced by the backend even if a client tampers with filters.

Dates are inclusive IST calendar dates; supply both or neither. All Dates omits
the boundaries. Custom ranges may span multiple years. Week starts Monday.
Statuses: ALL, COMPLETED, CANCELLED, PARTIALLY_RETURNED, RETURNED. Payment filters:
ALL, CASH, CARD, UPI; a split tender matches if any saved payment uses that mode.
The exported breakdown still contains all its payments.

## Formats and accounting

- PDF: HopKid logo/tagline, saved invoice identity and status, store/address,
  cashier, salesperson, customer, product/barcode, quantities, prices, discounts,
  GST, subtotal, rounding, total and tender breakdown, plus a Code128 barcode.
  The individual filename is the original invoice number. Supports the current
  printer's 58/80 mm paper or A4. Thermal page height is measured from wrapped
  text. Combined PDFs start every invoice on a new page; long invoices have
  continuation headers and keep item groups and the closing summary together.
- CSV: UTF-8 BOM, quoted fields and formula-injection protection. One invoice
  per row, or optional detailed item rows. All requested invoice columns are
  included. In detailed mode invoice fields repeat for context, so those
  columns must not be summed across item rows as a revenue report.
- Excel: the same summary/detail columns in `.xlsx`, using ExcelJS streaming.
  Additional worksheets are created when a sheet reaches one million rows.

Downloads read persisted snapshots inside one repeatable-read transaction.
Payments are fetched as nested records, never joined into invoice sums/counts.
CSV and Excel use cursor batches of 100 invoices with backpressure for CSV.
PDF is limited to 500 invoices per request with a clear 413 error; use narrower
filters or CSV/Excel for larger selections. The client timeout is three minutes;
the database read transaction is bounded at two minutes. Individual and combined
PDFs are generated on the backend with embedded Unicode fonts. The existing
invoice UI, printing and Slip rendering are unchanged.

Exports show cancelled invoice amounts and statuses when requested. They do not
calculate a completed-sales/revenue summary, alter accounting, delete records,
cancel bills or create payments. The existing completed-sales status rules in
reports remain intact. Preview counts are export record counts for the selected
filters. Invoice data changes between preview and download are revalidated at
download time. Download responses use private/no-store caching.

## Files

Backend: `src/pos/billExports.ts`, `src/pos/routes.ts`,
`scripts/test_pos_bill_exports.ts`, `package.json`, `package-lock.json`, this note.
`jsbarcode` matches the existing frontend library and supplies PDF vector bars.

Frontend: `src/features/pos/POSHistoryModal.tsx`,
`src/features/pos/POSBillExportDialog.tsx`,
`src/features/pos/billExportClient.ts`, `scripts/test_pos_bill_exports.cjs`,
`package.json`.

Concurrent cancellation/deletion changes in service/history files are separate
from this export implementation and were preserved.

## Verification

- Backend `npm run build`: passed.
- Frontend `npm run build`: passed (Google Fonts required network access).
- Frontend `npx tsc --noEmit`: passed independently of Next's type-check setting.
- Backend `npm run test:pos:bill-exports`: 12 checks passed against isolated
  PostgreSQL on localhost port 55439: completed/cancelled PDFs, selection,
  filters/IST boundary, CSV/detail/Excel values, authentication, store access,
  malformed/empty results, 601-invoice batching/PDF limit and no mutations.
- Frontend `npm run test:pos:bill-exports`: six Chrome verification groups passed
  against the real production UI and isolated Express/PostgreSQL backend:
  individual PDF, selected CSV and duplicate-click prevention, custom-range
  cancelled Excel, mobile/empty results, simulated download/preview failures,
  and retained Print/Slip controls with no browser runtime errors.
- Rendered 58 mm, 80 mm and A4 PDFs with Poppler; inspected complete long-invoice
  page contact sheets. Extracted PDF text verifies GST, rupee glyphs, original
  totals/statuses, all 60 items, continuation headers and no blank pages.

Both test scripts require an explicit isolated POS test database. Production
invoices were neither exported nor changed during verification.
